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
  decay = 1.6, noiseDb = -50, seed = 7, fundamentalGain = 1, pitchGlideCents = 0, glideTau = 0.08,
  partialJitterCents = 0,
} = {}) {
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);
  const rand = rng(seed);
  const phases = Array.from({ length: partials }, () => rand() * 2 * Math.PI);
  for (let n = 1; n <= partials; n++) {
    // Real partials wander a little from the stiff-string formula (body and bridge coupling).
    const jitter = partialJitterCents ? Math.pow(2, ((rand() * 2 - 1) * partialJitterCents) / 1200) : 1;
    const fn = n * f0 * Math.sqrt(1 + B * n * n) * (n === 1 ? 1 : jitter);
    if (fn > sampleRate * 0.45) break;
    let a = Math.abs(Math.sin(n * Math.PI * pluck)) / n;
    if (n === 1) a *= fundamentalGain;
    const tau = decay / (1 + 0.25 * n);
    const w = (2 * Math.PI * fn) / sampleRate;
    let ph = phases[n - 1];
    for (let i = 0; i < N; i++) {
      // Optional pitch glide: strings start slightly sharp after a hard pluck.
      const glide = pitchGlideCents ? Math.pow(2, (pitchGlideCents * Math.exp(-i / (glideTau * sampleRate))) / 1200) : 1;
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

/** Typical inharmonicity per string (6th → 1st) used by the synthetic strums. */
export const SYNTH_B = [1.1e-4, 7e-5, 5e-5, 9e-5, 4e-5, 1.4e-5];

/**
 * A strum: six plucked stiff strings started a few milliseconds apart (pick travel),
 * after `leadSec` of near-silence. `strings` entries are {f0, B, gain} or null (muted).
 * f0 is the harmonic base: the first partial sits at f0·√(1+B).
 */
export function strum({ strings, sampleRate = 48000, seconds = 3, leadSec = 0.4, spreadMs = 9, noiseDb = -55, seed = 11, glideCents = 3, glideTau = 0.08, decay = 2.2, jitterCents = 0 }) {
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);
  const rand = rng(seed);
  strings.forEach((s, i) => {
    if (!s) return;
    const delay = Math.round((leadSec + (i * spreadMs) / 1000) * sampleRate);
    const tone = pluckedString({
      f0: s.f0, B: s.B, sampleRate, seconds: seconds - delay / sampleRate, pluck: 0.13 + 0.03 * rand(),
      partials: 20, decay: decay * (1 - i * 0.06), noiseDb: -140, seed: seed * 7 + i, pitchGlideCents: glideCents,
      glideTau, partialJitterCents: jitterCents,
    });
    const g = (s.gain ?? 1) * (0.8 + 0.4 * rand());
    for (let k = 0; k < tone.length && delay + k < N; k++) out[delay + k] += g * tone[k];
  });
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[i]));
  const noiseAmp = Math.pow(10, noiseDb / 20);
  for (let i = 0; i < N; i++) out[i] = (0.6 * out[i]) / peak + noiseAmp * (rand() * 2 - 1);
  return out;
}
