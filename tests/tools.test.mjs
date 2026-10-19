import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, decodeWav, joinClips } from '../www/js/wav.js';
import { estimateBridge, planBridge, simulatePass, responseMatrix } from '../www/js/bridge.js';
import { rng } from './synth.mjs';

test('WAV export round-trips samples and the JSON comment', () => {
  const sr = 48000;
  const a = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.5);
  const b = Float32Array.from({ length: 501 }, (_, i) => Math.cos(i / 7) * 0.25);
  const { samples, starts } = joinClips([a, b], sr, 0.01);
  assert.deepEqual(starts, [0, 1000 + 480]);
  const meta = JSON.stringify({ kind: 'strum-check', notes: ['E2', 'A2'], note: 'F♯ 中文' });
  const bytes = encodeWav(samples, sr, { comment: meta });
  const back = decodeWav(bytes);
  assert.equal(back.sampleRate, sr);
  assert.equal(back.samples.length, samples.length);
  assert.equal(back.comment, meta);
  for (let i = 0; i < samples.length; i += 97) assert.ok(Math.abs(back.samples[i] - samples[i]) < 1 / 16000);
  // Odd-length comment keeps word alignment; no comment also works.
  assert.equal(decodeWav(encodeWav(a, sr, { comment: 'x' })).comment, 'x');
  assert.equal(decodeWav(encodeWav(a, sr)).comment, null);
});

// A floating bridge: tightening one string lowers the others by its share q_i.
function bridgeGuitar(q) {
  const R = responseMatrix(q);
  return { R, apply: (x, j, d) => x.map((v, i) => v + R[i][j] * d) };
}

test('floating bridge: two strums measure the coupling, one planned pass lands every string', () => {
  const trueQ = [0.16, 0.19, 0.22, 0.26, 0.2, 0.17];
  const g = bridgeGuitar(trueQ);
  const r = rng(42);
  const noisy = (x) => x.map((v) => v + (r() * 2 - 1) * 0.4); // strum readings ±0.4 ¢
  let x = [6, -9, 4, 12, -5, 3];
  // Calibration: detune the 6th string by +30 ¢ and strum again.
  const before = noisy(x);
  x = g.apply(x, 0, 30);
  const after = noisy(x);
  const est = estimateBridge(before, after, 0);
  assert.ok(est.ok);
  est.q.forEach((q, i) => assert.ok(Math.abs(q - trueQ[i]) < 0.06, `q${i} ${q.toFixed(3)} vs ${trueQ[i]}`));
  // Plan from a fresh strum, then tune low to high, each string stopped at its temporary target.
  const order = [0, 1, 2, 3, 4, 5];
  const plan = planBridge(noisy(x), est.q, order);
  const y = simulatePassTrue(x, g, order, plan.tau);
  const naive = simulatePassTrue(x, g, order, [0, 0, 0, 0, 0, 0]);
  const worst = (v) => Math.max(...v.map(Math.abs));
  assert.ok(worst(y) < 2, `planned pass worst ${worst(y).toFixed(2)} ¢`);
  assert.ok(worst(naive) > 5, `naive pass worst ${worst(naive).toFixed(2)} ¢`);
  // With the exact model the plan is exact.
  const exact = planBridge(x, trueQ, order);
  assert.ok(worst(simulatePass(x, trueQ, order, exact.tau)) < 1e-9);
});

// Tune each string to its temporary target on the *true* guitar.
function simulatePassTrue(x, g, order, tau) {
  let y = x.slice();
  for (const j of order) y = g.apply(y, j, tau[j] - y[j]);
  return y;
}

test('floating bridge: refuses tiny or unread test changes', () => {
  assert.equal(estimateBridge([0, 0, 0, 0, 0, 0], [3, -1, -1, -1, -1, -1], 0).reason, 'small');
  assert.equal(estimateBridge([null, 0, 0, 0, 0, 0], [30, -5, -5, -5, -5, -5], 0).reason, 'unread');
  const fixedBridge = estimateBridge([0, 0, 0, 0, 0, 0], [30, 0.2, -0.1, 0, 0.1, -0.2], 0);
  assert.ok(fixedBridge.ok);
  assert.ok(Math.max(...fixedBridge.q.map(Math.abs)) < 0.02, 'a fixed bridge measures ~no coupling');
});
