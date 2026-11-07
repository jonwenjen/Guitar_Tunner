import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRING_SETS, findSet, resolveSet, parseGauge, tensionKg, LB_TO_KG, setbackMm, compareSets,
  recommendSets, idealGauges, gaugeForTension, stiffnessB, estimatePlainGauge, matchPlain, actionFor, centsPerMm,
} from '../www/js/strings.js';
import { parseNote, midiToFreq } from '../www/js/music.js';

const STD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map((n) => midiToFreq(parseNote(n)));
const DADGAD = ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'].map((n) => midiToFreq(parseNote(n)));
const SCALE = 25.5 * 25.4;
const action = [0, 1, 2, 3, 4, 5].map((i) => actionFor(i));

test('catalog: six descending gauges, plain 1st and 2nd strings, known references', async () => {
  const { REFERENCES } = await import('../www/js/references.js');
  const ids = new Set();
  for (const s of STRING_SETS) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`); ids.add(s.id);
    assert.equal(s.gauges.length, 6, s.id);
    for (let i = 1; i < 6; i++) assert.ok(s.gauges[i] < s.gauges[i - 1], `${s.id} not descending`);
    assert.deepEqual(s.wound, [true, true, true, true, false, false]);
    assert.ok(REFERENCES[s.src], `${s.id}: unknown source ${s.src}`);
  }
  assert.ok(STRING_SETS.length >= 30);
});

test("tension model matches D'Addario's published EJ16 and EJ11 tensions", () => {
  const ej16 = findSet('dad-ej16'), ej11 = findSet('dad-ej11');
  const pub16 = [24.95, 28.93, 29.93, 30.03, 23.31, 23.36];
  const pub11 = [25.1, 28.4, 29.5, 29.4, 23.3, 23.3];
  ej16.gauges.forEach((d, i) => {
    const t = tensionKg(d, ej16.wound[i], ej16.material, STD[i], SCALE) / LB_TO_KG;
    assert.ok(Math.abs(t / pub16[i] - 1) < 0.005, `EJ16 string ${6 - i}: ${t.toFixed(2)} vs ${pub16[i]}`);
  });
  ej11.gauges.forEach((d, i) => {
    const t = tensionKg(d, ej11.wound[i], ej11.material, STD[i], SCALE) / LB_TO_KG;
    assert.ok(Math.abs(t / pub11[i] - 1) < 0.025, `EJ11 string ${6 - i}: ${t.toFixed(2)} vs ${pub11[i]}`);
  });
});

test('compensation model reproduces the familiar saddle shape', () => {
  const s = findSet('dad-ej16');
  const S = s.gauges.map((d, i) => setbackMm(d, s.wound[i], s.material, STD[i], SCALE, action[i]));
  assert.ok(S[4] > S[5] + 1, 'plain B needs clearly more setback than high E');
  assert.ok(S[3] < S[4], 'wound G needs less than plain B');
  assert.ok(S[0] > S[1] && S[1] > S[2], 'bass strings need more toward the low E');
  S.forEach((v) => assert.ok(v > 0.8 && v < 6, `setback ${v.toFixed(2)} mm in a sensible range`));
});

test('changing gauge moves intonation a little; changing action moves it more', () => {
  const ej16 = resolveSet({ kind: 'catalog', id: 'dad-ej16' });
  const ej15 = resolveSet({ kind: 'catalog', id: 'dad-ej15' });
  const c = compareSets(ej15, ej16, { freqs: STD, scaleMm: SCALE, action });
  c.rows.forEach((r) => assert.ok(Math.abs(r.shift) < 1, `direct shift ${r.shift.toFixed(2)} ¢`));
  assert.ok(c.dTotal < -0.15, `10-47 is much lower tension than 12-53 (${(c.dTotal * 100).toFixed(0)}%)`);
  assert.ok(c.rows[0].sens > 0.4, `0.1 mm more action on the low E: +${c.rows[0].sens.toFixed(2)} ¢`);
});

test('DADGAD on a guitar set up for 12-53: heavier low strings restore the tension', () => {
  const ej16 = findSet('dad-ej16');
  const target = ej16.gauges.map((d, i) => tensionKg(d, ej16.wound[i], ej16.material, STD[i], SCALE));
  const ideal = idealGauges(target, ej16.wound, ej16.material, { freqs: DADGAD, scaleMm: SCALE });
  assert.ok(ideal[0] > 0.058, `low D needs ${ideal[0]}`);
  assert.ok(ideal[4] >= 0.018 && ideal[5] >= 0.013, `B→A and E→D strings get heavier: ${ideal}`);
  assert.equal(ideal[1], 0.042, 'A string unchanged');
  // Standard tuning: the closest sets to EJ16 are the 12-53 lights.
  const rec = recommendSets(target, { freqs: STD, scaleMm: SCALE });
  assert.ok(rec[0].rms < 0.01, rec[0].set.id);
  assert.ok(['dad-ej16', 'elx-16052', 'gib-pb12', 'dad-ej11', 'elx-11052'].includes(rec[0].set.id));
  // Same gauges in the same alloy are one suggestion, with every brand listed.
  const pb1253 = rec.find((r) => r.sets.some((x) => x.id === 'dad-ej16'));
  assert.deepEqual(pb1253.sets.map((x) => x.id).sort(), ['dad-ej16', 'elx-16052', 'gib-pb12']);
  assert.equal(new Set(rec.map((r) => `${r.set.material}:${r.set.gauges}`)).size, rec.length);
  // DADGAD: recommendations are heavier than 12-53.
  const recD = recommendSets(target, { freqs: DADGAD, scaleMm: SCALE }, { limit: 40 });
  const keep = recD.find((r) => r.sets.some((x) => x.id === 'dad-ej16'));
  assert.ok(recD[0].rms < keep.rms * 0.8, `${recD[0].set.id} ${recD[0].rms.toFixed(3)} vs keeping 12-53 ${keep.rms.toFixed(3)}`);
  assert.ok(recD[0].set.gauges[5] >= 0.013, 'heavier treble strings for the lowered 1st and 2nd strings');
  assert.ok(Math.abs(gaugeForTension(tensionKg(0.042, true, 'pb', 110, SCALE), true, 'pb', 110, SCALE) - 0.042) < 1e-5);
});

test('gauge input, custom sets and the plain-string estimate', () => {
  assert.equal(parseGauge('.012'), 0.012);
  assert.equal(parseGauge('12'), 0.012);
  assert.ok(Math.abs(parseGauge('0.30', 'mm') - 0.01181) < 1e-4);
  assert.ok(Number.isNaN(parseGauge('abc')));
  const custom = resolveSet({ kind: 'custom', gauges: [0.054, 0.044, 0.034, 0.025, 0.016, 0.012], wound: [true, true, true, true, false, false], material: 'b8020' });
  assert.ok(custom && custom.custom && custom.label.startsWith('12-54'));
  assert.equal(resolveSet({ kind: 'custom', gauges: [0.054, 0.044] }), null);
  assert.equal(resolveSet({ kind: 'unknown' }), null);
  // Stiffness of a plain .016 B string gives back .016.
  const B = stiffnessB(0.016, false, 'pb', STD[4], SCALE);
  assert.ok(Math.abs(estimatePlainGauge(B, STD[4], SCALE) - 0.016) < 1e-6);
  const est = [null, null, null, null, estimatePlainGauge(stiffnessB(0.017, false, 'pb', STD[4], SCALE), STD[4], SCALE), estimatePlainGauge(stiffnessB(0.013, false, 'pb', STD[5], SCALE), STD[5], SCALE)];
  assert.equal(matchPlain(est)[0].set.gauges[5], 0.013);
  assert.ok(centsPerMm(648) > 2.6 && centsPerMm(648) < 2.7);
});

test('string choices from storage and files are made safe', async () => {
  const { sanitizeSel, sanitizeSetup, selFromValue, selValue, getSetup, setSetup, inch } = await import('../www/js/strings-ui.js');
  assert.deepEqual(sanitizeSel({ kind: 'catalog', id: 'dad-ej16' }), { kind: 'catalog', id: 'dad-ej16' });
  assert.deepEqual(sanitizeSel({ kind: 'catalog', id: 'nope' }), { kind: 'unknown' });
  assert.deepEqual(sanitizeSel(null), { kind: 'unknown' });
  assert.deepEqual(sanitizeSel({ kind: 'custom', gauges: [0.053, 0.042, 0.032, 0.024, 0.016, 0.012] }).wound, [true, true, true, true, false, false]);
  assert.deepEqual(sanitizeSel({ kind: 'custom', gauges: [5, 0.042, 0.032, 0.024, 0.016, 0.012] }), { kind: 'unknown' });
  const s = sanitizeSetup({ current: { kind: 'catalog', id: 'mar-ma540' }, actionBass: 99, unit: 'x', scaleMm: 645 });
  assert.equal(s.actionBass, 2.4);
  assert.equal(s.unit, 'in');
  assert.equal(s.scaleMm, 645);
  assert.equal(selValue(s.current), 'mar-ma540');
  assert.deepEqual(selFromValue('unknown'), { kind: 'unknown' });
  assert.equal(selFromValue('custom', { kind: 'catalog', id: 'dad-ej16' }), null); // caller starts a custom set
  const S = {};
  setSetup(S, 'g1', { design: { kind: 'catalog', id: 'dad-ej16' } });
  assert.equal(getSetup(S, 'g1').design.id, 'dad-ej16');
  assert.equal(getSetup(S, 'default').current.kind, 'unknown');
  assert.equal(inch(0.053), '.053');
  assert.equal(inch(0.0095), '.0095');
  assert.equal(inch(0.01), '.010');
});
