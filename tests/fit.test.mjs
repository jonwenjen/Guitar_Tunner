import test from 'node:test';
import assert from 'node:assert/strict';
import { strum, SYNTH_B } from './synth.mjs';
import { analyzeStrum } from '../www/js/poly.js';
import {
  fitFretModel, fretError, saddleAdvice, optimizeOffsets, makeProfile, openReference, MEASURE_FRETS, chordSet,
} from '../www/js/guitar-fit.js';
import { findTuning, TUNINGS } from '../www/js/tunings.js';
import { parseNote, midiToFreq } from '../www/js/music.js';

const SR = 48000;
const REAL = { noiseDb: -42, glideCents: 6, glideTau: 0.23, jitterCents: 0.3 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('fret model: exact through two points, recovers α β γ from three', () => {
  const two = fitFretModel([{ k: 7, d: 2 }, { k: 12, d: 3.5 }]);
  near(fretError(two, 7), 2, 1e-9, 'fret 7');
  near(fretError(two, 12), 3.5, 1e-9, 'fret 12');
  const truth = { alpha: 1.2, beta: 2.5, gamma: 0.4 };
  const three = fitFretModel(MEASURE_FRETS.map((k) => ({ k, d: fretError(truth, k) })));
  for (const k of [3, 5, 7, 9, 12]) near(fretError(three, k), fretError(truth, k), 0.25, `fret ${k}`);
  assert.equal(fretError(three, 0), 0);
});

test('saddle advice: β cents over the scale length, ≈0.37 mm per cent at 648 mm', () => {
  near(saddleAdvice({ beta: 4 }, 648), 1.497, 0.01, '4 cents');
  near(saddleAdvice({ beta: -1 }, 628), -0.363, 0.01, 'flat → forward');
});

test('optimizer: a perfect guitar needs no offsets; a sharp-fretting string is tuned flat', () => {
  const tuning = findTuning('standard');
  const zero = { strings: tuning.notes.map((n) => ({ midi: parseNote(n), B: 0, model: { alpha: 0, beta: 0, gamma: 0 } })) };
  optimizeOffsets({ notes: tuning.notes, tuning, profile: zero, goal: 0 }).open.forEach((v) => near(v, 0, 1e-6, 'zero'));
  // Only the G string frets sharp (+4 cents everywhere): equal-temperament goal tunes it flat,
  // by the share of chords where it is fretted, and leaves the others alone.
  const g = structuredClone(zero);
  g.strings[3].model = { alpha: 4, beta: 0, gamma: 0 };
  const r = optimizeOffsets({ notes: tuning.notes, tuning, profile: g, goal: 0 });
  assert.ok(r.open[3] < -1 && r.open[3] > -4, `G offset ${r.open[3]}`);
  [0, 1, 2, 4, 5].forEach((i) => near(r.open[i], 0, 1e-6, `string ${6 - i}`));
  // Closed form: −4 × (weight of chords with the G string fretted) / (weight of chords using it)
  let fretted = 0, all = 0;
  for (const ch of chordSet(tuning)) {
    const k = ch.frets[3];
    if (k === null) continue;
    all += ch.w;
    if (k > 0) fretted += ch.w;
  }
  near(r.open[3], -4 * fretted / all, 0.02, 'closed form');
});

test('optimizer: stiff strings make the beat-free goal stretch the high E above the low E', () => {
  const tuning = findTuning('standard');
  const stiff = { strings: tuning.notes.map((n, i) => ({ midi: parseNote(n), B: SYNTH_B[i] * 2, model: { alpha: 0, beta: 0, gamma: 0 } })) };
  const r = optimizeOffsets({ notes: tuning.notes, tuning, profile: stiff, goal: 0.97, chords: [{ frets: [0, null, null, null, null, 0], w: 1 }] });
  // E2's 4th partial is sharp by ~2.9 cents at this stiffness; the beat-free E4 follows it.
  assert.ok(r.open[5] - r.open[0] > 2, `E4 − E2 = ${r.open[5] - r.open[0]}`);
});

test('every tuning gets a chord set the optimizer can use', () => {
  for (const t of TUNINGS) {
    const profile = { strings: t.notes.map((n, i) => ({ midi: parseNote(n), B: SYNTH_B[i], model: { alpha: 1.5, beta: 1, gamma: 0.2 } })) };
    const r = optimizeOffsets({ notes: t.notes, tuning: t, profile, goal: 0.5 });
    r.open.forEach((v) => assert.ok(Number.isFinite(v) && Math.abs(v) <= 15, `${t.id}: ${v}`));
  }
});

test('end to end: four synthetic strums give the guitar’s fretting errors and saddle advice', () => {
  const tuning = findTuning('standard');
  const targets = tuning.notes.map((n) => midiToFreq(parseNote(n)));
  const openDet = [0.8, -0.5, 0.3, -1.1, 0.6, -0.2];
  const truth = [
    { alpha: 1.2, beta: 2.5, gamma: 0.3 }, { alpha: 1.0, beta: 1.8, gamma: 0.2 }, { alpha: 0.8, beta: 1.0, gamma: 0.2 },
    { alpha: 2.0, beta: 3.5, gamma: 0.5 }, { alpha: 1.5, beta: 0.5, gamma: 0.3 }, { alpha: 1.3, beta: -0.6, gamma: 0.2 },
  ];
  const make = (k) => targets.map((t, i) => {
    const B = SYNTH_B[i] * Math.pow(2, (2 * k) / 12);
    const f1 = t * Math.pow(2, (100 * k + openDet[i] + fretError(truth[i], k)) / 1200);
    return { f0: f1 / Math.sqrt(1 + B), B };
  });
  const open = analyzeStrum(strum({ strings: make(0), seed: 21, ...REAL }), SR, targets.map((f) => ({ freq: f })));
  const refs = openReference(open, targets);
  const frets = {};
  for (const k of MEASURE_FRETS) {
    frets[k] = analyzeStrum(strum({ strings: make(k), seed: 30 + k, ...REAL }), SR,
      refs.map((r) => ({ freq: r.freq * Math.pow(2, k / 12), B: r.B * Math.pow(2, (2 * k) / 12) })));
  }
  const profile = makeProfile({ name: 'Test', scaleMm: 648, notes: tuning.notes, open, frets, targets });
  profile.strings.forEach((s, i) => {
    for (const k of [3, 5, 7, 12]) near(fretError(s.model, k), fretError(truth[i], k), 0.35, `string ${6 - i} fret ${k}`);
    near(s.saddleMm, (truth[i].beta * 648) / 1731, 0.3, `string ${6 - i} saddle`);
  });
  const r = optimizeOffsets({ notes: tuning.notes, tuning, profile, goal: 0 });
  // Fretted notes all run sharp on this guitar, so every open string is tuned a little flat.
  r.open.forEach((v, i) => assert.ok(v < -0.5 && v > -5, `string ${6 - i}: ${v}`));
});

test('profile measured in standard rescales for a lower tuning', () => {
  const std = findTuning('standard');
  const dadgad = findTuning('dadgad');
  const profile = { strings: std.notes.map((n) => ({ midi: parseNote(n), B: 5e-5, model: { alpha: 2, beta: 0, gamma: 0 } })) };
  const a = optimizeOffsets({ notes: std.notes, tuning: std, profile, goal: 0 });
  const b = optimizeOffsets({ notes: dadgad.notes, tuning: dadgad, profile, goal: 0 });
  // Low string dropped E → D: less tension, more fretting sharpness, larger correction.
  assert.ok(b.open[0] < a.open[0] - 0.05, `${b.open[0]} vs ${a.open[0]}`);
});
