// Coarse pitch detection with the McLeod Pitch Method (MPM).
// McLeod, P. & Wyvill, G. (2005). "A smarter way to find pitch." Proc. ICMC.
// The normalized square difference function (NSDF) is computed with an FFT so
// a 4096-sample window costs O(N log N) instead of O(N·maxLag).
//
// This detector answers "which note / which string is ringing?". The fine,
// sub-cent reading comes from the heterodyne strobe engine (strobe-engine.js),
// which locks onto the fundamental once the note is known.

import { FFT } from './fft.js';

export class PitchDetector {
  /**
   * @param {number} sampleRate
   * @param {number} size analysis window length (power of two)
   */
  constructor(sampleRate, size = 4096) {
    this.sampleRate = sampleRate;
    this.size = size;
    this.fft = new FFT(size * 2);
    this.re = new Float64Array(size * 2);
    this.im = new Float64Array(size * 2);
    this.x = new Float64Array(size);
    this.nsdf = new Float64Array(size);
  }

  /**
   * @param {Float32Array|Float64Array} buf at least `size` samples; the last `size` are used
   * @param {object} opts
   * @returns {{freq:number, clarity:number, rms:number, db:number} | {freq:0, clarity:0, rms:number, db:number}}
   */
  detect(buf, opts = {}) {
    const {
      minFreq = 55,
      maxFreq = 1500,
      threshold = 0.9, // MPM "k": pick the first key maximum ≥ k·highest
      minClarity = 0.6,
      gateDb = -60,
      refine = true,
    } = opts;
    const N = this.size;
    const sr = this.sampleRate;
    const x = this.x;
    const off = buf.length - N;

    let mean = 0;
    for (let i = 0; i < N; i++) mean += buf[off + i];
    mean /= N;
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const v = buf[off + i] - mean;
      x[i] = v;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / N);
    const db = 20 * Math.log10(rms + 1e-12);
    if (db < gateDb) return { freq: 0, clarity: 0, rms, db };

    // Autocorrelation via FFT (zero-padded to 2N to avoid circular wrap).
    const re = this.re, im = this.im;
    re.fill(0); im.fill(0);
    re.set(x);
    this.fft.transform(re, im, false);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft.transform(re, im, true);
    const scale = 1 / re.length;

    // NSDF n(τ) = 2 r(τ) / m(τ), with m(τ) = Σ x_j² + x_{j+τ}² updated incrementally.
    const nsdf = this.nsdf;
    const maxLag = Math.min(N - 1, Math.ceil(sr / minFreq) + 2);
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
      m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
    }

    // Key maxima: the highest point of each positive lobe after the first negative-going zero crossing.
    const minLag = Math.max(2, Math.floor(sr / maxFreq));
    let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    const peaks = [];
    let highest = 0;
    while (tau < maxLag) {
      while (tau < maxLag && nsdf[tau] <= 0) tau++;
      let best = -1, bestVal = -Infinity;
      while (tau < maxLag && nsdf[tau] > 0) {
        if (nsdf[tau] > bestVal) { bestVal = nsdf[tau]; best = tau; }
        tau++;
      }
      if (best > 0 && best >= minLag && best < maxLag - 1) {
        peaks.push(best);
        if (bestVal > highest) highest = bestVal;
      }
    }
    if (!peaks.length || highest < minClarity) return { freq: 0, clarity: highest, rms, db };

    const cutoff = threshold * highest;
    let chosen = peaks[0];
    for (const p of peaks) {
      if (nsdf[p] >= cutoff) { chosen = p; break; }
    }
    const [tau0, clarity] = parabolic(nsdf, chosen);
    let freq = sr / tau0;

    // Refinement: the NSDF also peaks at whole multiples of the period. Interpolating
    // the peak at k·T and dividing by k shrinks the interpolation error k times.
    if (refine) {
      const limit = Math.min(maxLag - 2, Math.floor(N * 0.55));
      const kMax = Math.min(8, Math.floor(limit / tau0));
      for (let k = kMax; k >= 2; k--) {
        const guess = Math.round(k * tau0);
        let p = guess;
        for (let d = -3; d <= 3; d++) {
          const t = guess + d;
          if (t > 1 && t < limit && nsdf[t] > nsdf[p]) p = t;
        }
        if (nsdf[p] < 0.5 * clarity || nsdf[p] < nsdf[p - 1] || nsdf[p] < nsdf[p + 1]) continue;
        const [tk] = parabolic(nsdf, p);
        const f = (sr * k) / tk;
        if (Math.abs(1200 * Math.log2(f / freq)) < 25) { freq = f; break; }
      }
    }
    return { freq, clarity, rms, db };
  }
}

/** Parabolic interpolation around index i → [refined index, refined value]. */
export function parabolic(arr, i) {
  const a = arr[i - 1], b = arr[i], c = arr[i + 1];
  const denom = a - 2 * b + c;
  if (Math.abs(denom) < 1e-12) return [i, b];
  const shift = 0.5 * (a - c) / denom;
  return [i + shift, b - 0.25 * (a - c) * shift];
}
