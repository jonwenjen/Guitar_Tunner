// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { pluckedString, sine } from './synth.mjs';
import { cents, parseNote, midiToFreq } from '../www/js/music.js';
import { analyse } from './helpers.mjs';
import { PitchDetector } from '../www/js/pitch.js';
import { StrobeEngine } from '../www/js/strobe-engine.js';

const SR = 48000;
const STANDARD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map((n) => midiToFreq(parseNote(n)));

test('MPM finds the right note on every standard string, including a weak fundamental', () => {
  for (const f of STANDARD) {
    for (const fundamentalGain of [1, 0.15]) {
      const sig = pluckedString({ f0: f, fundamentalGain, seconds: 1.2 });
      const { mpm } = analyse(sig, f);
      assert.ok(mpm.length > 10, `detections for ${f}`);
      for (const est of mpm) {
        assert.ok(Math.abs(cents(est, f)) < 8, `${f.toFixed(1)} Hz (fund ×${fundamentalGain}) read ${est.toFixed(2)} Hz`);
      }
    }
  }
});

test('strobe reading is within 0.15 cent of the true fundamental', () => {
  for (const f of STANDARD) {
    for (const detune of [-20, -4.3, 0, 2.7, 15]) {
      const B = 6e-5;
      const truth = f * Math.pow(2, detune / 1200);
      const sig = pluckedString({ f0: truth, B, seconds: 1.6 });
      const fundamental = truth * Math.sqrt(1 + B); // partial 1 of a stiff string
      const { strobe } = analyse(sig, f, { skipSec: 0.8 });
      assert.ok(strobe.length > 5, `strobe locks on ${f.toFixed(1)} Hz at ${detune} ¢`);
      for (const est of strobe) {
        assert.ok(Math.abs(cents(est, fundamental)) < 0.15, `${f.toFixed(1)} Hz ${detune} ¢: error ${cents(est, fundamental).toFixed(3)} ¢`);
      }
    }
  }
});

test('strobe phase advances when sharp and retreats when flat (clockwise = sharp)', () => {
  for (const [detune, sign] of [[+3, 1], [-3, -1]]) {
    const ref = 110;
    const sig = sine({ f: ref * Math.pow(2, detune / 1200), seconds: 1.5 });
    const se = new StrobeEngine(SR);
    se.setReference(ref);
    se.process(sig.subarray(0, SR));
    const r = se.read();
    assert.ok(r.valid);
    assert.equal(Math.sign(r.deltaHz), sign);
    assert.ok(Math.abs(r.cents - detune) < 0.05, `cents ${r.cents}`);
  }
});

test('strobe falls back to the 2nd harmonic when the fundamental is almost missing', () => {
  const f = STANDARD[0];
  const truth = f * Math.pow(2, -6 / 1200);
  const sig = pluckedString({ f0: truth, B: 0, fundamentalGain: 0.03, seconds: 1.6 });
  const { strobe, engine } = analyse(sig, f, { skipSec: 0.8 });
  assert.ok(strobe.length > 5);
  assert.equal(engine.read().source, 2);
  for (const est of strobe) assert.ok(Math.abs(cents(est, truth)) < 0.3);
});

test('silence does not produce a reading', () => {
  const pd = new PitchDetector(SR, 4096);
  const r = pd.detect(new Float32Array(4096), { gateDb: -60 });
  assert.equal(r.freq, 0);
});
