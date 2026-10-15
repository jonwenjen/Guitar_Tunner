// Heterodyne "virtual strobe" engine.
//
// A mechanical strobe tuner (Peterson SC-5000-II, StroboPLUS) spins a patterned disc
// at exactly the reference frequency and lights it with the incoming signal. If the
// string matches the reference, the pattern stands still; if it is sharp the pattern
// drifts one way, flat the other, at a speed equal to the beat frequency.
//
// We do the same thing numerically: mix the signal with a complex oscillator at
// h·f_ref for each harmonic h, low-pass the product, and watch the phase of what is
// left. The phase is the pattern's angle; its slope is the beat (Δf) in Hz. Fitting the
// slope over a few hundred milliseconds gives sub-cent precision without any FFT bin
// limits, and because we only look at the fundamental band, string inharmonicity
// (sharp upper partials) does not pull the reading.

export class StrobeEngine {
  constructor(sampleRate, { harmonics = [1, 2, 3, 4], decim = 64, windowSec = 0.35 } = {}) {
    this.sampleRate = sampleRate;
    this.harmonics = harmonics;
    this.decim = decim;
    this.windowLen = Math.max(16, Math.round((windowSec * sampleRate) / decim));
    const H = harmonics.length;
    this.pr = new Float64Array(H); this.pi = new Float64Array(H); // oscillator phasor
    this.rr = new Float64Array(H); this.ri = new Float64Array(H); // per-sample rotation
    this.i1 = new Float64Array(H); this.q1 = new Float64Array(H);
    this.i2 = new Float64Array(H); this.q2 = new Float64Array(H);
    this.phase = new Float64Array(H);
    this.mag = new Float64Array(H);
    // Phase history for harmonics 1 and 2 (unwrapped), used for the Δf fit.
    this.histT = new Float64Array(this.windowLen);
    this.histP = [new Float64Array(this.windowLen), new Float64Array(this.windowLen)];
    this.histW = [new Float64Array(this.windowLen), new Float64Array(this.windowLen)];
    this.unwrapped = new Float64Array(2);
    this.lastRaw = new Float64Array(2);
    this.ref = 0;
    this.level = 0;
    this.n = 0;
    this.reset();
  }

  reset() {
    this.pr.fill(1); this.pi.fill(0);
    this.i1.fill(0); this.q1.fill(0); this.i2.fill(0); this.q2.fill(0);
    this.phase.fill(0); this.mag.fill(0);
    this.histCount = 0; this.histHead = 0;
    this.unwrapped.fill(0); this.lastRaw.fill(0);
    this.counter = 0;
    this.sinceReset = 0;
  }

  /** Set the reference (target) frequency. Resets the lock when it moves. */
  setReference(freq) {
    if (!(freq > 0)) { this.ref = 0; this.reset(); return; }
    if (this.ref && Math.abs(1200 * Math.log2(freq / this.ref)) < 0.01) return;
    this.ref = freq;
    const sr = this.sampleRate;
    this.harmonics.forEach((h, k) => {
      const w = (2 * Math.PI * h * freq) / sr;
      this.rr[k] = Math.cos(w);
      this.ri[k] = -Math.sin(w); // e^{-iw}: mixes the signal down to baseband
    });
    // Low-pass corner: wide enough to keep about ±50 cents of beat in the passband,
    // narrow enough to reject the neighbouring harmonic (f_ref away) by ~60 dB.
    this.fc = Math.max(3, 0.03 * freq);
    this.alpha = 1 - Math.exp((-2 * Math.PI * this.fc) / sr);
    this.reset();
  }

  /** Feed consecutive audio samples. */
  process(samples) {
    if (!this.ref) {
      for (let n = 0; n < samples.length; n++) {
        const v = samples[n];
        this.level += 0.0005 * (v * v - this.level);
      }
      return;
    }
    const H = this.harmonics.length;
    const a = this.alpha;
    const { pr, pi, rr, ri, i1, q1, i2, q2 } = this;
    for (let n = 0; n < samples.length; n++) {
      const v = samples[n];
      this.level += 0.0005 * (v * v - this.level);
      for (let k = 0; k < H; k++) {
        const I = v * pr[k];
        const Q = v * pi[k];
        i1[k] += a * (I - i1[k]); q1[k] += a * (Q - q1[k]);
        i2[k] += a * (i1[k] - i2[k]); q2[k] += a * (q1[k] - q2[k]);
        const nr = pr[k] * rr[k] - pi[k] * ri[k];
        const ni = pr[k] * ri[k] + pi[k] * rr[k];
        pr[k] = nr; pi[k] = ni;
      }
      if (++this.counter >= this.decim) {
        this.counter = 0;
        this._snapshot();
      }
    }
  }

  _snapshot() {
    const H = this.harmonics.length;
    for (let k = 0; k < H; k++) {
      // Keep the oscillator on the unit circle (rounding drift).
      const g = 1 / Math.hypot(this.pr[k], this.pi[k]);
      this.pr[k] *= g; this.pi[k] *= g;
      this.phase[k] = Math.atan2(this.q2[k], this.i2[k]);
      this.mag[k] = 2 * Math.hypot(this.i2[k], this.q2[k]);
    }
    this.sinceReset += this.decim;
    const idx = this.histHead;
    this.histT[idx] = this.sinceReset / this.sampleRate;
    for (let k = 0; k < 2 && k < H; k++) {
      let d = this.phase[k] - this.lastRaw[k];
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      this.unwrapped[k] += this.histCount ? d : 0;
      this.lastRaw[k] = this.phase[k];
      this.histP[k][idx] = this.unwrapped[k];
      this.histW[k][idx] = this.mag[k];
    }
    this.histHead = (idx + 1) % this.windowLen;
    if (this.histCount < this.windowLen) this.histCount++;
  }

  /** Weighted least-squares slope of unwrapped phase over the history window. */
  _fit(k, settle) {
    const n = this.histCount;
    const T = this.histT, P = this.histP[k], W = this.histW[k];
    let sw = 0, st = 0, sp = 0;
    let used = 0;
    for (let j = 0; j < n; j++) {
      if (T[j] < settle) continue;
      const w = W[j] * W[j];
      sw += w; st += w * T[j]; sp += w * P[j]; used++;
    }
    if (used < 8 || sw <= 0) return null;
    const tm = st / sw, pm = sp / sw;
    let stt = 0, stp = 0;
    for (let j = 0; j < n; j++) {
      if (T[j] < settle) continue;
      const w = W[j] * W[j];
      const dt = T[j] - tm;
      stt += w * dt * dt; stp += w * dt * (P[j] - pm);
    }
    if (stt <= 0) return null;
    const slope = stp / stt;
    let res = 0;
    for (let j = 0; j < n; j++) {
      if (T[j] < settle) continue;
      const w = W[j] * W[j];
      const e = P[j] - pm - slope * (T[j] - tm);
      res += w * e * e;
    }
    return { slope, residual: Math.sqrt(res / sw), span: stt / sw };
  }

  /**
   * Current reading.
   * deltaHz/cents are relative to the reference; `valid` means the lock is trustworthy.
   */
  read() {
    const levelRms = Math.sqrt(Math.max(this.level, 0));
    const out = {
      ref: this.ref, valid: false, deltaHz: 0, cents: 0, residual: 0,
      phases: Array.from(this.phase), mags: Array.from(this.mag), level: levelRms, source: 0,
    };
    if (!this.ref || this.histCount < 8) return out;
    // Ignore the filters' start-up transient (≈ three time constants).
    const settle = 3 / (2 * Math.PI * this.fc);
    const useSecond = this.harmonics.length > 1 && this.mag[0] < 0.25 * this.mag[1];
    const k = useSecond ? 1 : 0;
    const fit = this._fit(k, settle);
    if (!fit) return out;
    const h = this.harmonics[k];
    const deltaHz = fit.slope / (2 * Math.PI * h);
    const strength = this.mag[k] / (levelRms * Math.SQRT2 + 1e-12); // ~1 when this harmonic dominates
    out.deltaHz = deltaHz;
    out.cents = 1200 * Math.log2((this.ref + deltaHz) / this.ref);
    out.residual = fit.residual;
    out.source = h;
    out.valid = fit.residual < 0.5 && strength > 0.12 && Math.sqrt(fit.span) > 0.04;
    return out;
  }
}
