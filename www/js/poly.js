// Polyphonic strum analysis: read all six strings from one strum.
//
// The expected pitch of every string is known (the current targets), so this is
// not blind multi-pitch transcription. Each string is a stiff string whose n-th
// partial sits at n·f0·√(1 + B·n²) (Fletcher 1964). In fourths/fifths tunings many
// partials of different strings coincide within ~2 cents (A2×3 ≈ E4, E2×3 ≈ B3…),
// which no window of a decaying strum can separate. So, as in polyphonic tuner
// designs, we predict where every partial of every string should be, ignore the
// ones another string shares, and fit each string's f0 and inharmonicity B to its
// own clean partials (Barbancho et al. 2012 use the same inharmonicity relations to
// tell strings apart). Strings with too few clean partials — octave-doubled strings
// in open tunings — are reported as unsure rather than guessed.

import { FFT } from './fft.js';

const ffts = new Map();
const getFFT = (n) => {
  if (!ffts.has(n)) ffts.set(n, new FFT(n));
  return ffts.get(n);
};

/** Typical inharmonicity per string position (6th → 1st) for a steel-string guitar. */
export const DEFAULT_B = [1.0e-4, 7e-5, 5e-5, 6e-5, 4e-5, 1.5e-5];

const CENT = Math.pow(2, 1 / 1200);
const cents = (a, b) => 1200 * Math.log2(a / b);

/**
 * First sample of a strum: short-term energy jumps well above its running level.
 * @returns {number} sample index, or -1
 */
export function findOnset(x, sampleRate, { hop = 256, ratio = 8, gateDb = -50, skipSec = 0 } = {}) {
  const hops = Math.floor(x.length / hop);
  const startHop = Math.ceil((skipSec * sampleRate) / hop);
  let slow = -1;
  for (let h = 0; h < hops; h++) {
    let e = 0;
    const o = h * hop;
    for (let i = 0; i < hop; i++) e += x[o + i] * x[o + i];
    e /= hop;
    if (slow < 0) { slow = e; continue; }
    const db = 10 * Math.log10(e + 1e-20);
    if (h >= startHop && h > 2 && db > gateDb && e > ratio * Math.max(slow, 1e-12)) return o;
    slow = 0.85 * slow + 0.15 * e;
  }
  return -1;
}

function blackman(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / (N - 1);
    w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
  }
  return w;
}

/** Magnitude spectrum (linear) of x[start..start+N) with a Blackman window, zero-padded ×pad. */
function spectrum(x, start, N, sampleRate, fmax, pad = 4) {
  let M = 1;
  while (M < N * pad) M <<= 1;
  M = Math.min(M, 1 << 19);
  const fft = getFFT(M);
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  const w = blackman(N);
  let mean = 0;
  for (let i = 0; i < N; i++) mean += x[start + i];
  mean /= N;
  for (let i = 0; i < N; i++) re[i] = (x[start + i] - mean) * w[i];
  fft.transform(re, im, false);
  const df = sampleRate / M;
  const K = Math.min(M / 2, Math.ceil(fmax / df) + 8);
  const mag = new Float64Array(K);
  for (let k = 0; k < K; k++) mag[k] = Math.hypot(re[k], im[k]);
  return { mag, df, T: N / sampleRate };
}

const db = (v) => 20 * Math.log10(v + 1e-20);

/** Linear magnitude at an arbitrary frequency (linear interpolation between bins). */
function magAt(spec, f) {
  const k = f / spec.df;
  const i = Math.floor(k);
  if (i < 0 || i + 1 >= spec.mag.length) return 0;
  const t = k - i;
  return spec.mag[i] * (1 - t) + spec.mag[i + 1] * t;
}

/** Strongest peak within [f-hw, f+hw], refined by parabolic interpolation on dB. */
function peakNear(spec, f, hw) {
  const { mag, df } = spec;
  const lo = Math.max(1, Math.floor((f - hw) / df));
  const hi = Math.min(mag.length - 2, Math.ceil((f + hw) / df));
  if (hi <= lo) return null;
  let best = lo;
  for (let k = lo + 1; k <= hi; k++) if (mag[k] > mag[best]) best = k;
  if (best === lo || best === hi) return null; // rising toward the edge: not this partial
  const a = db(mag[best - 1]), b = db(mag[best]), c = db(mag[best + 1]);
  const den = a - 2 * b + c;
  const shift = Math.abs(den) < 1e-12 ? 0 : (0.5 * (a - c)) / den;
  return { f: (best + shift) * df, amp: Math.pow(10, (b - 0.25 * (a - c) * shift) / 20) };
}

/** Local noise floor: a low percentile of magnitudes within ±span Hz. */
function noiseNear(spec, f, span = 30) {
  const { mag, df } = spec;
  const lo = Math.max(0, Math.floor((f - span) / df));
  const hi = Math.min(mag.length - 1, Math.ceil((f + span) / df));
  const vals = [];
  const step = Math.max(1, Math.floor((hi - lo) / 160));
  for (let k = lo; k <= hi; k += step) vals.push(mag[k]);
  vals.sort((p, q) => p - q);
  return vals[Math.floor(vals.length * 0.3)] || 1e-12;
}

const partialFreq = (f0, B, n) => n * f0 * Math.sqrt(1 + B * n * n);

/**
 * Robust weighted fit of (f_n/n)² = f0² + f0²·B·n² (Tukey biweight on cent residuals).
 * Falls back to a fixed B when the partial numbers do not spread enough to see the stretch.
 */
function fitString(peaks, Bprior) {
  if (!peaks.length) return null;
  const solve = (wts) => {
    const ns = peaks.map((p, i) => (wts[i] > 0 ? p.n * p.n : null)).filter((v) => v !== null);
    const used = ns.length;
    const spread = used ? Math.max(...ns) - Math.min(...ns) : 0;
    if (used >= 3 && spread >= 15) {
      let Sw = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
      peaks.forEach((p, i) => {
        const w = wts[i];
        if (!(w > 0)) return;
        const x = p.n * p.n;
        const y = (p.f / p.n) ** 2;
        Sw += w; Sx += w * x; Sy += w * y; Sxx += w * x * x; Sxy += w * x * y;
      });
      const den = Sw * Sxx - Sx * Sx;
      if (den > 0) {
        const b = (Sw * Sxy - Sx * Sy) / den;
        const a = (Sy - b * Sx) / Sw;
        const B = b / a;
        if (a > 0 && B >= 0 && B < 8e-4) return { f0: Math.sqrt(a), B, fitted: true };
      }
    }
    let sw = 0, sum = 0;
    peaks.forEach((p, i) => {
      const w = wts[i];
      if (!(w > 0)) return;
      sw += w; sum += w * (p.f / (p.n * Math.sqrt(1 + Bprior * p.n * p.n)));
    });
    return sw ? { f0: sum / sw, B: Bprior, fitted: false } : null;
  };
  const base = peaks.map((p) => p.w);
  let fit = solve(base);
  for (let iter = 0; fit && iter < 6 && peaks.length > 2; iter++) {
    const r = residuals(peaks, fit);
    const absr = r.map(Math.abs).sort((a, b) => a - b);
    const mad = absr[Math.floor(absr.length / 2)];
    const c = 4.685 * Math.max(0.25, 1.4826 * mad);
    const wts = base.map((w, i) => {
      const u = r[i] / c;
      return Math.abs(u) >= 1 ? 0 : w * (1 - u * u) ** 2;
    });
    const next = solve(wts);
    if (!next) break;
    fit = next;
    fit.weights = wts;
  }
  if (fit && !fit.weights) fit.weights = base;
  return fit;
}

function residuals(peaks, fit) {
  return peaks.map((p) => cents(p.f, partialFreq(fit.f0, fit.B, p.n)));
}

/**
 * Analyze a strum.
 * @param {Float32Array} x            mono samples
 * @param {number} sampleRate
 * @param {Array<{freq:number, B?:number}|null>} expected  first-partial target per string (6th → 1st); null = ignore
 * @param {object} [opts]
 * @param {number} [opts.onset]       sample index of the strum (detected if omitted)
 * @param {number} [opts.skipSec=0.55] time after the onset to skip (attack and pitch glide)
 * @param {number} [opts.lenSec=1.6]   analysis window length
 * @param {number} [opts.searchCents=60] how far each string may be from its target
 * @returns {{ok:boolean, reason?:string, strings:Array}}
 *   strings[i].state: 'ok' (reliable), 'unsure' (read, but few clean overtones),
 *   'shared' (every useful overtone is shared with another string: pluck it alone),
 *   'silent' (not heard), 'skipped' (not requested)
 */
export function analyzeStrum(x, sampleRate, expected, opts = {}) {
  const { skipSec = 0.55, lenSec = 1.6, searchCents = 60, fmax = 5000, maxPartials = 16 } = opts;
  let onset = opts.onset;
  if (onset === undefined || onset === null) onset = findOnset(x, sampleRate);
  if (onset < 0) return { ok: false, reason: 'no-strum', strings: [] };
  const start = Math.round(onset + skipSec * sampleRate);
  const N = Math.min(Math.round(lenSec * sampleRate), x.length - start);
  if (N < 0.7 * sampleRate) return { ok: false, reason: 'too-short', strings: [] };
  const spec = spectrum(x, start, N, sampleRate, fmax + 200);
  const R = 3 / spec.T; // Blackman main-lobe half width: closer partials cannot be told apart

  const S = expected.map((e, i) => (e && e.freq > 0 ? {
    index: i, target: e.freq, B: e.B ?? DEFAULT_B[i] ?? 5e-5, Bprior: e.B ?? DEFAULT_B[i] ?? 5e-5,
    unc: 3, // uncertainty of the current estimate, cents
  } : null));
  const active = S.filter(Boolean);
  for (const s of active) s.f0 = s.target / Math.sqrt(1 + s.B);

  const partialList = (s) => {
    const out = [];
    for (let n = 1; n <= maxPartials; n++) {
      const f = partialFreq(s.f0, s.B, n);
      if (f > fmax) break;
      out.push({ n, f });
    }
    return out;
  };
  // Clearance between partial f of string s and the nearest partial of any other string,
  // after allowing for how uncertain both estimates still are.
  const clearance = (s, f) => {
    let best = Infinity;
    for (const o of active) {
      if (o === s) continue;
      const k = Math.max(1, Math.round(f / o.f0));
      for (let n = Math.max(1, k - 2); n <= k + 2; n++) {
        const g = partialFreq(o.f0, o.B, n);
        const slack = (g * o.unc + f * s.unc) / 1731;
        best = Math.min(best, Math.abs(g - f) - slack);
      }
    }
    return best;
  };

  // ── Coarse: harmonic-sum scan over ±searchCents. All low partials count here, shared or
  // not: a shared partial is at most ~2 cents off, which only matters for the fine stage,
  // and it anchors strings whose clean partials are all high and weak. ──
  for (const s of active) {
    const use = partialList(s).filter((p) => p.n <= 10);
    let bestC = 0, bestScore = -1;
    const score = (c) => {
      const f0 = s.f0 * Math.pow(2, c / 1200);
      let sc = 0;
      for (const p of use) sc += Math.sqrt(magAt(spec, partialFreq(f0, s.B, p.n))) / p.n;
      return sc;
    };
    for (let c = -searchCents; c <= searchCents; c += 0.5) {
      const sc = score(c);
      if (sc > bestScore) { bestScore = sc; bestC = c; }
    }
    for (let c = bestC - 0.5; c <= bestC + 0.5; c += 0.05) {
      const sc = score(c);
      if (sc > bestScore) { bestScore = sc; bestC = c; }
    }
    s.f0 *= Math.pow(2, bestC / 1200);
    s.coarseF0 = s.f0;
  }

  // ── Fine: peak-pick clean partials, robust fit of f0 and B, update collisions, repeat ──
  let globalMax = 0;
  for (let iter = 0; iter < 4; iter++) {
    for (const s of active) {
      const peaks = [];
      let candidates = 0;
      for (const p of partialList(s)) {
        const d = clearance(s, p.f);
        if (d < R) continue;
        if (p.n <= 10) candidates++;
        const hw = Math.min(0.45 * (d + R) - 0.5 * R, Math.max(p.f * (CENT ** 8 - 1), 3 * spec.df));
        if (hw <= spec.df) continue;
        const pk = peakNear(spec, p.f, hw);
        if (!pk) continue;
        const snr = db(pk.amp) - db(noiseNear(spec, p.f));
        if (snr < 12) continue;
        const shared = d < 1.6 * R ? 0.35 : 1; // partly overlapped by a neighbour's lobe
        peaks.push({ n: p.n, f: pk.f, amp: pk.amp, snr, w: Math.sqrt(pk.amp) * p.n * shared });
      }
      s.candidates = candidates;
      // Are both of its lowest partials shared with other strings? Then silence at its clean
      // (higher, weaker) partials does not prove the string was muted.
      s.sharedLow = partialList(s).slice(0, 2).every((p) => clearance(s, p.f) < R);
      const fit = peaks.length >= 2 ? fitString(peaks, s.Bprior) : null;
      s.peaks = peaks;
      s.fit = fit;
      if (fit && Math.abs(cents(fit.f0, s.coarseF0)) < 8) {
        s.f0 = fit.f0;
        if (fit.fitted) s.B = fit.B;
        const kept = fit.weights.filter((w) => w > 0).length;
        s.unc = kept >= 3 ? 0.4 : 1.5;
      } else {
        s.f0 = s.coarseF0;
        s.unc = 3;
      }
      for (const p of peaks) globalMax = Math.max(globalMax, p.amp);
    }
  }

  // ── Report ──
  const strings = expected.map((e, i) => {
    const s = S[i];
    if (!s) return { index: i, state: 'skipped', heard: false, confident: false };
    const fit = s.fit;
    const freq = partialFreq(s.f0, s.B, 1); // first partial: what a single-string tuner reads
    const base = {
      index: i, freq, f0: s.f0, B: s.B, Bfitted: !!(fit && fit.fitted),
      cents: cents(freq, s.target), partials: [], rms: Infinity,
    };
    if (s.candidates < 2) return { ...base, state: 'shared', heard: false, confident: false };
    // Not readable from clean partials. If its (shared) low partials carry energy we cannot
    // tell whether it rang, so ask for a single pluck; otherwise it was not played.
    const notRead = () => {
      let e = 0;
      for (let n = 1; n <= 3; n++) e = Math.max(e, magAt(spec, partialFreq(s.f0, s.B, n)));
      const sharedEnergy = db(e) - db(globalMax) > -35;
      return { ...base, state: sharedEnergy && s.sharedLow ? 'shared' : 'silent', heard: false, confident: false };
    };
    if (!fit) return notRead();
    const kept = s.peaks.filter((_, k) => fit.weights[k] > 0);
    const loud = kept.reduce((m, p) => Math.max(m, p.amp), 0);
    if (kept.length < 2 || db(loud) - db(globalMax) < -40) return notRead();
    const r = residuals(kept, s);
    let wsum = 0, ss = 0;
    kept.forEach((p, k) => { wsum += p.w; ss += p.w * r[k] * r[k]; });
    const rms = Math.sqrt(ss / wsum);
    const lowPartials = kept.filter((p) => p.n <= 7).length;
    // Reliable: several clean partials that agree, either including low ones or enough
    // higher ones to pin down the stiffness used to extrapolate back to the first partial.
    const confident = kept.length >= 3 && rms < 1 && (lowPartials >= 2 || (kept.length >= 4 && !!(fit && fit.fitted)));
    return {
      ...base,
      state: confident ? 'ok' : 'unsure',
      heard: true,
      confident,
      partials: kept.map((p) => ({ n: p.n, f: p.f, amp: p.amp })).sort((a, b) => a.n - b.n),
      rms,
    };
  });
  return { ok: true, onset, strings };
}

/** Relative partial amplitudes (n = 1..count, max = 1) from an analyzed string; gaps filled by 1/n. */
export function partialProfile(str, count = 8) {
  const out = new Array(count).fill(0);
  if (str && str.partials && str.partials.length) {
    let max = 0;
    for (const p of str.partials) if (p.n <= count) { out[p.n - 1] = p.amp; max = Math.max(max, p.amp); }
    for (let n = 1; n <= count; n++) {
      if (!out[n - 1]) {
        // Unmeasured (shared with another string): assume the decay of a plucked string.
        out[n - 1] = max * 0.6 / n;
      }
    }
    const m = Math.max(...out);
    return out.map((v) => v / m);
  }
  return out.map((_, k) => 1 / (k + 1));
}
