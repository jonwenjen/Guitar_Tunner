import test from 'node:test';
import assert from 'node:assert/strict';
import { strum, SYNTH_B, rng } from './synth.mjs';
import { analyzeStrum, findOnset } from '../www/js/poly.js';
import { StrumCapture } from '../www/js/strum-capture.js';
import { parseNote, midiToFreq } from '../www/js/music.js';

const SR = 48000;
// Realistic conditions: room noise, a 6-cent pitch glide decaying over 0.23 s
// (tension modulation, Hodgkinson et al. 2010) and partials that stray ±0.3 cent.
const REAL = { noiseDb: -42, glideCents: 6, glideTau: 0.23, jitterCents: 0.3 };

function guitar(notes, det, { fret = 0, mute = [] } = {}) {
  return notes.map((n, i) => {
    if (mute.includes(i)) return null;
    const B = SYNTH_B[i] * Math.pow(2, (2 * fret) / 12);
    const f1 = midiToFreq(parseNote(n)) * Math.pow(2, (100 * fret + det[i]) / 1200);
    return { f0: f1 / Math.sqrt(1 + B), B };
  });
}
const targetsOf = (notes) => notes.map((n) => ({ freq: midiToFreq(parseNote(n)) }));

test('one strum reads all six strings of standard tuning to ±0.4 cent', () => {
  const notes = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  for (let trial = 0; trial < 5; trial++) {
    const r = rng(500 + trial);
    const det = notes.map(() => (r() * 2 - 1) * 10);
    const res = analyzeStrum(strum({ strings: guitar(notes, det), seed: 600 + trial, ...REAL }), SR, targetsOf(notes));
    assert.ok(res.ok);
    res.strings.forEach((s, i) => {
      assert.equal(s.state, 'ok', `trial ${trial} string ${6 - i}: ${s.state}`);
      assert.ok(Math.abs(s.cents - det[i]) < 0.4, `trial ${trial} string ${6 - i}: read ${s.cents.toFixed(2)}, true ${det[i].toFixed(2)}`);
    });
  }
});

test('drop D and strings far out of tune', () => {
  const notes = ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const det = [-35, 22, -14, 40, -28, 17];
  const res = analyzeStrum(strum({ strings: guitar(notes, det), seed: 41, ...REAL }), SR, targetsOf(notes));
  res.strings.forEach((s, i) => {
    assert.ok(s.heard, `string ${6 - i} heard`);
    assert.ok(Math.abs(s.cents - det[i]) < 0.6, `string ${6 - i}: ${s.cents.toFixed(2)} vs ${det[i]}`);
  });
});

test('open tunings: confident readings are right, octave-doubled strings are flagged instead of guessed', () => {
  for (const notes of [['D2', 'G2', 'D3', 'G3', 'B3', 'D4'], ['D2', 'A2', 'D3', 'G3', 'A3', 'D4']]) {
    for (let trial = 0; trial < 4; trial++) {
      const r = rng(700 + trial);
      const det = notes.map(() => (r() * 2 - 1) * 8);
      const res = analyzeStrum(strum({ strings: guitar(notes, det), seed: 800 + trial, ...REAL }), SR, targetsOf(notes));
      res.strings.forEach((s, i) => {
        if (s.state === 'ok') assert.ok(Math.abs(s.cents - det[i]) < 0.5, `${notes.join('')} string ${6 - i}: ${s.cents.toFixed(2)} vs ${det[i].toFixed(2)}`);
        else if (s.state === 'unsure') assert.ok(Math.abs(s.cents - det[i]) < 1.5, `unsure but far off: ${s.cents.toFixed(2)} vs ${det[i].toFixed(2)}`);
        else assert.ok(['shared', 'silent'].includes(s.state));
      });
    }
  }
});

test('barre strums read the fretted pitch, including the fretting error', () => {
  const notes = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const err = [3.1, 2.4, 2.0, 4.2, 2.8, 1.9];
  for (const k of [2, 7, 12]) {
    const res = analyzeStrum(strum({ strings: guitar(notes, err, { fret: k }), seed: 900 + k, ...REAL }), SR,
      notes.map((n, i) => ({ freq: midiToFreq(parseNote(n)) * Math.pow(2, k / 12), B: SYNTH_B[i] * Math.pow(2, (2 * k) / 12) })));
    res.strings.forEach((s, i) => {
      assert.equal(s.state, 'ok', `fret ${k} string ${6 - i}`);
      assert.ok(Math.abs(s.cents - err[i]) < 0.4, `fret ${k} string ${6 - i}: ${s.cents.toFixed(2)} vs ${err[i]}`);
    });
  }
});

test('muted strings are reported, silence is not a strum', () => {
  const notes = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const det = [1, -2, 0.5, 2, -1, 0];
  const res = analyzeStrum(strum({ strings: guitar(notes, det, { mute: [2] }), seed: 77, ...REAL }), SR, targetsOf(notes));
  assert.equal(res.strings[2].state, 'silent');
  for (const i of [0, 1, 3, 4, 5]) assert.equal(res.strings[i].state, 'ok');
  const quiet = new Float32Array(SR * 3);
  const r = rng(3);
  for (let i = 0; i < quiet.length; i++) quiet[i] = (r() * 2 - 1) * 0.002;
  assert.equal(analyzeStrum(quiet, SR, targetsOf(notes)).ok, false);
});

test('streaming capture finds the strum and hands the analyzer a usable clip', () => {
  const notes = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
  const det = [2, -3, 1, -1, 2.5, -0.5];
  const x = strum({ strings: guitar(notes, det), seed: 88, seconds: 4, leadSec: 1.2, ...REAL });
  const trueOnset = findOnset(x, SR);
  const cap = new StrumCapture(SR);
  let state = 'waiting';
  for (let i = 0; i < x.length && state !== 'done'; i += 1024) state = cap.push(x.subarray(i, i + 1024));
  assert.equal(state, 'done');
  const { samples, onset } = cap.result();
  assert.ok(samples.length >= 2.4 * SR);
  // The captured onset is the same sample the offline detector finds.
  for (let k = 0; k < 64; k++) assert.equal(samples[onset + k], x[trueOnset + k]);
  const res = analyzeStrum(samples, SR, targetsOf(notes), { onset });
  res.strings.forEach((s, i) => assert.ok(Math.abs(s.cents - det[i]) < 0.4, `string ${6 - i}`));
});

test('capture gives up after the timeout', () => {
  const cap = new StrumCapture(SR, { timeoutSec: 1 });
  const silence = new Float32Array(1024);
  let state;
  for (let i = 0; i < 60; i++) state = cap.push(silence);
  assert.equal(state, 'timeout');
});
