import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, specFor, cleanInputs, MODELS, findModel, STYLES } from '../www/js/health.js';
import { REFERENCES } from '../www/js/references.js';

const keys = (r) => r.findings.map((f) => f.key);
const find = (r, k) => r.findings.find((f) => f.key === k);
const healthy = {
  rh: 50, stringsAge: 'new', relief: 0.2, rod: 'ok', actionBass: 2.5, actionTreble: 1.8, nutBass: 0.5, nutTreble: 0.42,
  saddleBass: 3.2, saddleTreble: 3.0, straight: 'ok', bridge: 'ok', belly: 'normal', sunken: 'no', fretWear: 'none',
  fretEnds: 'no', cracks: 'no', buzz: [], nutBind: 'no',
};

test('built-in guitars: specs, sources and guessed fields', () => {
  assert.deepEqual(MODELS.map((m) => m.id), ['truetone-gc8css', 'stanford-psom20', 'yamaha-apx4a']);
  for (const m of MODELS) for (const r of m.refs) assert.ok(REFERENCES[r], `${m.id} ref ${r}`);
  assert.equal(findModel('yamaha-apx4a').scaleMm, 634);
  assert.equal(findModel('yamaha-apx4a').pickup, 'piezo');
  const s = specFor({ model: 'stanford-psom20', spec: { scaleMm: 648 } });
  assert.equal(s.scaleMm, 648);
  assert.ok(!s.guessed.includes('scaleMm'), 'a value the player entered is no longer a guess');
  assert.ok(s.guessed.includes('nutMm'));
  assert.equal(specFor({ model: 'nope' }).id, 'custom');
});

test('a healthy guitar comes out fine, with nothing missing', () => {
  const r = evaluate({ model: 'stanford-psom20', inputs: healthy });
  const bad = r.findings.filter((f) => !['ok', 'info', 'need'].includes(f.level));
  assert.deepEqual(bad, []);
  assert.deepEqual(r.missing, []);
  assert.ok(keys(r).includes('reliefOk') && keys(r).includes('actionOk') && keys(r).includes('angleOk'));
  assert.ok(keys(r).includes('noMeasure'), 'asks for a measurement');
});

test('neck reset: high action, little saddle left, straightedge below the bridge top', () => {
  const r = evaluate({ model: 'yamaha-apx4a', inputs: { ...healthy, actionBass: 3.5, actionTreble: 2.6, saddleBass: 2.2, saddleTreble: 2.0, straight: 'low' } });
  const reset = find(r, 'resetNeeded');
  assert.equal(reset.level, 'luthier');
  assert.ok(reset.params.left < 2.5);
  const hi = r.findings.filter((f) => f.key === 'actionHigh');
  assert.equal(hi.length, 2);
  // 3.5 mm → middle of 2.38–2.78: lower by 0.92 mm, saddle by twice that.
  assert.ok(Math.abs(hi[0].params.d - 0.92) < 0.01 && Math.abs(hi[0].params.s - 1.84) < 0.01);
  assert.ok(keys(r).includes('pickup'), 'under-saddle pickup note');
  assert.ok(keys(r).includes('resetValue'), 'laminate body: weigh the cost');
  // The setup order: action before neck angle.
  assert.ok(keys(r).indexOf('actionHigh') < keys(r).indexOf('resetNeeded'));
});

test('suspect the neck angle without a straightedge; saddle short with a good angle', () => {
  const r = evaluate({ inputs: { ...healthy, actionBass: 3.3, saddleBass: 2.3, straight: 'unknown' } });
  assert.equal(find(r, 'resetSuspect').level, 'watch');
  assert.ok(r.missing.includes('straight'));
  const r2 = evaluate({ inputs: { ...healthy, actionBass: 3.3, saddleBass: 2.3 } });
  assert.equal(find(r2, 'saddleShort').level, 'tech');
});

test('relief first: out-of-range relief makes the action advice provisional', () => {
  const r = evaluate({ inputs: { ...healthy, relief: 0.6, actionBass: 3.2, rod: 'maxed' } });
  assert.equal(find(r, 'rodMaxed').level, 'luthier');
  assert.equal(find(r, 'actionHigh').level, 'watch');
  assert.ok(keys(r).includes('actionAfterRelief'));
  const low = evaluate({ inputs: { ...healthy, relief: 0.02, buzz: ['low'] } });
  assert.equal(find(low, 'reliefLow').level, 'diy');
  assert.ok(keys(low).includes('buzzLowRelief'));
});

test('dry guitar: humidity first, with its symptoms', () => {
  const r = evaluate({ inputs: { ...healthy, rh: 30, fretEnds: 'yes', straight: 'high', buzz: ['high'] } });
  assert.equal(r.findings[0].key, 'rhDry');
  assert.ok(keys(r).includes('drySigns'));
  assert.equal(find(r, 'angleHigh').level, 'diy');
  assert.ok(keys(r).includes('buzzHighDry'));
});

test('bridge coming off is listed first; nut and frets', () => {
  const r = evaluate({ inputs: { ...healthy, bridge: 'gap', nutBass: 0.8, nutTreble: 0.15, buzz: ['open'], fretWear: 'grooves', nutBind: 'yes' } });
  assert.equal(r.findings[0].key, 'bridgeGap');
  assert.ok(Math.abs(find(r, 'nutHigh').params.d - 0.3) < 1e-9);
  assert.equal(find(r, 'nutLow').level, 'tech');
  assert.ok(keys(r).includes('buzzOpenNut') && keys(r).includes('fretGrooves') && keys(r).includes('nutBind'));
});

test('measured intonation: lowering the action first, then the saddle', () => {
  const mk = (beta, gamma = 0) => ({ model: { alpha: 0, beta, gamma }, points: [{ k: 2, d: 1 }, { k: 7, d: 1 }, { k: 12, d: beta }] });
  const profile = { scaleMm: 645, notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], strings: [mk(4, 2), mk(3), mk(2.5), mk(2), mk(1.2), mk(1)] };
  const r = evaluate({ inputs: { ...healthy, actionBass: 3.4, actionTreble: 2.0 } }, { profile });
  const act = find(r, 'intonAction');
  assert.ok(act && act.params.dir === 'flatter' && act.params.c > 0.3, JSON.stringify(act));
  const sad = find(r, 'intonSaddlePred');
  assert.ok(sad, keys(r).join());
  const six = sad.params.list.find((x) => x.i === 0);
  assert.ok(six.c < 4 && Math.sign(six.mm) === Math.sign(six.c), 'lower action takes cents off; the saddle fixes the rest');
  assert.ok(keys(r).includes('nutSharp'));
  const ok = evaluate({ inputs: healthy }, { profile: { ...profile, strings: profile.strings.map(() => mk(0.5)) } });
  assert.ok(keys(ok).includes('intonOk'));
});

test('inputs are cleaned and styles shift the targets', () => {
  const c = cleanInputs({ rh: 500, relief: 0.2, rod: 'banana', buzz: ['low', 'x'], straight: 'low', nutBass: '0.5' });
  assert.deepEqual(c, { relief: 0.2, straight: 'low', buzz: ['low'] });
  assert.ok(STYLES.light.bass[1] < STYLES.standard.bass[0] + 0.1);
  const light = evaluate({ style: 'light', inputs: { ...healthy, actionBass: 2.6 } });
  assert.ok(keys(light).includes('actionHigh'), 'a standard action is high for a light-touch setup');
});

test('check-ups read from a file are made safe', async () => {
  const { cleanCheck } = await import('../www/js/health-ui.js');
  assert.equal(cleanCheck(null), null);
  const c = cleanCheck({ id: 'c1', name: 'x'.repeat(80), model: 'yamaha-apx4a', style: 'nope', spec: { scaleMm: 650, joint: 'glue?', top: 'laminate' }, inputs: { relief: 0.3, straight: 'low', junk: 1 }, profileId: 5 });
  assert.equal(c.name.length, 40);
  assert.equal(c.style, 'standard');
  assert.deepEqual(c.spec, { top: 'laminate', scaleMm: 650 });
  assert.deepEqual(c.inputs, { relief: 0.3, straight: 'low' });
  assert.equal(c.profileId, null);
  assert.equal(cleanCheck({ id: 'c2', model: 'gibson-j45' }).model, 'custom');
});
