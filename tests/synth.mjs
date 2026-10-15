// Synthetic guitar-like test signals.

/** Deterministic PRNG so test runs are repeatable. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A plucked stiff string: partial n sits at n·f0·sqrt(1 + B n²) (Fletcher 1964),
 * amplitude follows the pluck-position comb, higher partials decay faster.
 * @returns Float32Array
 */
export function pluckedString({
  f0, sampleRate = 48000, seconds = 1.5, B = 5e-5, pluck = 0.18, partials = 24,
  decay = 1.6, noiseDb = -50, seed = 7, fundamentalGain = 1, pitchGlideCents = 0,
} = {}) {
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);
  const rand = rng(seed);
  const phases = Array.from({ length: partials }, () => rand() * 2 * Math.PI);
  for (let n = 1; n <= partials; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > sampleRate * 0.45) break;
    let a = Math.abs(Math.sin(n * Math.PI * pluck)) / n;
    if (n === 1) a *= fundamentalGain;
    const tau = decay / (1 + 0.25 * n);
    const w = (2 * Math.PI * fn) / sampleRate;
    let ph = phases[n - 1];
    for (let i = 0; i < N; i++) {
      // Optional pitch glide: strings start slightly sharp after a hard pluck.
      const glide = pitchGlideCents ? Math.pow(2, (pitchGlideCents * Math.exp(-i / (0.08 * sampleRate))) / 1200) : 1;
      ph += w * glide;
      out[i] += a * Math.exp(-i / (tau * sampleRate)) * Math.sin(ph);
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const noiseAmp = Math.pow(10, noiseDb / 20);
  for (let i = 0; i < N; i++) out[i] = (0.5 * out[i]) / peak + noiseAmp * (rand() * 2 - 1);
  return out;
}

export function sine({ f, sampleRate = 48000, seconds = 1, amp = 0.5 }) {
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / sampleRate);
  return out;
}
