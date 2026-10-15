import test from 'node:test';
import assert from 'node:assert/strict';
import { pluckedString } from './synth.mjs';
import { analyse } from './helpers.mjs';
import { TUNINGS, findTuning } from '../www/js/tunings.js';
import { TEMPERAMENTS, temperamentOffset } from '../www/js/temperaments.js';
import { SWEETENERS, sweetenerOffsets, justChordOffsets, openChordFit } from '../www/js/sweeteners.js';
import { computeTargets, chromaticTarget, StringTracker, TunedTracker } from '../www/js/tuner-core.js';
import { parseNote, cents, noteLabel } from '../www/js/music.js';

test('every library tuning has six parseable notes, sources, and sane string ranges', () => {
  const ids = new Set();
  for (const t of TUNINGS) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`);
    ids.add(t.id);
    assert.equal(t.notes.length, 6, t.id);
    const midis = t.notes.map(parseNote);
    for (const m of midis) assert.ok(m >= parseNote('A1') && m <= parseNote('C5'), `${t.id} ${noteLabel(m)}`);
    assert.ok(t.about && t.about.length > 20, `${t.id} about`);
    assert.ok(t.sources && t.sources.length, `${t.id} sources`);
  }
});

test('auto string detection picks the right string in every tuning', () => {
  const sweet = { open: [0, 0, 0, 0, 0, 0], fret12: [0, 0, 0, 0, 0, 0] };
  for (const t of TUNINGS) {
    const targets = computeTargets({ notes: t.notes, sweet });
    targets.forEach((target, i) => {
      for (const detune of [-18, 12]) {
        const sig = pluckedString({ f0: target.freq * Math.pow(2, detune / 1200), seconds: 0.7, fundamentalGain: i === 0 ? 0.3 : 1 });
        const { mpm } = analyse(sig, target.freq, { skipSec: 0.15 });
        const tracker = new StringTracker();
        let got = -1;
        for (const f of mpm) got = tracker.update(f, targets);
        assert.equal(got, i, `${t.id}: ${target.label} at ${detune} ¢ identified as ${targets[got]?.label}`);
      }
    });
  }
});

test('string tracker holds the current string against a single stray reading', () => {
  const targets = computeTargets({ notes: findTuning('standard').notes });
  const tr = new StringTracker();
  assert.equal(tr.update(110, targets), 1);
  assert.equal(tr.update(147, targets), 1); // one frame of D3 is not enough
  assert.equal(tr.update(147, targets), 2);
});

test('temperaments match published offsets', () => {
  const rel = (id) => {
    const t = TEMPERAMENTS.find((x) => x.id === id);
    return t.offsets.map((v) => +(v - t.offsets[0]).toFixed(1));
  };
  assert.deepEqual(rel('werckmeister3'), [0, -9.8, -7.8, -5.9, -9.8, -2, -11.7, -3.9, -7.8, -11.7, -3.9, -7.8]);
  const qcm = rel('meantone');
  assert.equal(qcm[4], -13.7); // pure major third C–E
  assert.equal(qcm[1], -23.9);
  const pyth = rel('pythagorean');
  assert.equal(pyth[7], 2); // pure fifth
  for (const t of TEMPERAMENTS) assert.equal(temperamentOffset(t, 9, 0), 0, `${t.id} keeps A at 0`);
});

test('just-chord sweetener for DADGAD resembles the measured strobe preset', () => {
  const o = justChordOffsets(findTuning('dadgad'), 0.85);
  const measured = [-0.6, 1.1, -0.6, -1.2, 1.1, -0.6];
  o.forEach((v, i) => assert.ok(Math.abs(v - measured[i]) < 0.8, `string ${6 - i}: ${v} vs ${measured[i]}`));
  assert.ok(Math.abs(o.reduce((a, b) => a + b, 0)) < 0.05, 'centred on average pitch');
});

test('open-chord fit stays gentle and is zero at zero sweetness', () => {
  assert.deepEqual(openChordFit(0), [0, 0, 0, 0, 0, 0]);
  const o = openChordFit(1);
  for (const v of o) assert.ok(Math.abs(v) < 2, `offset ${v}`);
});

test('sweeteners report when they do not apply', () => {
  const just = SWEETENERS.find((s) => s.id === 'just-chord');
  const lsq = SWEETENERS.find((s) => s.id === 'open-chords');
  assert.equal(sweetenerOffsets(just, findTuning('standard')).applies, false);
  assert.equal(sweetenerOffsets(lsq, findTuning('open-g')).applies, false);
  assert.equal(sweetenerOffsets(lsq, findTuning('drop-d')).applies, true);
});

test('targets combine calibration, capo, temperament and sweetener', () => {
  const sweet = { open: [0, 0, 0, 0, -2.1, 0] };
  const t = computeTargets({ notes: findTuning('standard').notes, a4: 442, capo: 2, sweet });
  assert.equal(t[1].label, 'B2'); // A2 + capo 2
  const plain = 442 * Math.pow(2, (parseNote('B3') + 2 - 69) / 12);
  assert.ok(Math.abs(cents(t[4].freq, plain) + 2.1) < 1e-9);
  assert.ok(Math.abs(cents(t[0].freq12, t[0].freq * 2)) < 1e-9);
});

test('chromatic target follows the temperament', () => {
  const wk3 = TEMPERAMENTS.find((x) => x.id === 'werckmeister3');
  const e4 = 440 * Math.pow(2, -5 / 12);
  const c = chromaticTarget(e4, { temperament: wk3, temperamentRoot: 0 });
  assert.equal(c.label, 'E4');
  assert.ok(Math.abs(c.offset - temperamentOffset(wk3, 4, 0)) < 1e-9);
});

test('tuned tracker needs a steady reading inside the tolerance', () => {
  const tt = new TunedTracker();
  assert.equal(tt.update(0, 0.4, 0.3, 1), false);
  assert.equal(tt.update(0, 0.4, 0.4, 1), true);
  assert.equal(tt.tuned[0], true);
  tt.update(0, 12, 0.1, 1);
  assert.equal(tt.tuned[0], false);
});
