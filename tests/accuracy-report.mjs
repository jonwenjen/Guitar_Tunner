// Prints a Markdown accuracy table: autocorrelation (MPM) vs heterodyne strobe,
// on synthetic plucked stiff strings. Run: node tests/accuracy-report.mjs
import { pluckedString } from './synth.mjs';
import { analyse } from './helpers.mjs';
import { cents, parseNote, midiToFreq } from '../www/js/music.js';

const strings = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const stats = (a) => {
  if (!a.length) return { mean: NaN, max: NaN };
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  return { mean, max: Math.max(...a.map(Math.abs)) };
};
const f2 = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : 'n/a');

console.log('| String | Inharmonicity B | MPM mean error (¢) | MPM worst (¢) | Strobe mean error (¢) | Strobe worst (¢) |');
console.log('|---|---|---|---|---|---|');
for (const B of [2e-5, 6e-5, 1.5e-4]) {
  for (const n of strings) {
    const ref = midiToFreq(parseNote(n));
    const e = { mpm: [], strobe: [] };
    for (const detune of [-9, 0, 7]) {
      const truth = ref * Math.pow(2, detune / 1200);
      const fundamental = truth * Math.sqrt(1 + B);
      const sig = pluckedString({ f0: truth, B, seconds: 1.6, seed: 3 + detune });
      const { mpm, strobe } = analyse(sig, ref, { skipSec: 0.8 });
      e.mpm.push(...mpm.map((f) => cents(f, fundamental)));
      e.strobe.push(...strobe.map((f) => cents(f, fundamental)));
    }
    const m = stats(e.mpm), s = stats(e.strobe);
    console.log(`| ${n} | ${B.toExponential(1)} | ${f2(m.mean)} | ${m.max.toFixed(2)} | ${f2(s.mean)} | ${s.max.toFixed(2)} |`);
  }
}
