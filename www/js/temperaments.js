// Historical temperaments, computed from their definitions rather than typed-in tables.
// Each is a circle of 12 fifths starting at C (C–G–D–A–E–B–F♯–C♯–G♯–D♯–A♯–F–C);
// a fifth's size is 700 cents + δ. The resulting per-note offsets are relative to
// equal temperament and normalised so that A stays at 0 (A4 keeps its calibration).
//
// These are the same eight families a Peterson Strobe Center 5000-II ships with
// (EQU, PYT, JMI, 4MT, KLN, KRN, WK3, YNG), see J. M. Barbour, "Tuning and
// Temperament: A Historical Survey" (1951) for the definitions.

import { JUST_RATIOS } from './music.js';

const PURE = 1200 * Math.log2(3 / 2) - 700;          // +1.955 ¢
const PC = 12 * 1200 * Math.log2(3 / 2) - 7 * 1200;  // Pythagorean comma 23.460 ¢
const SC = 1200 * Math.log2(81 / 80);                 // syntonic comma 21.506 ¢
const SCHISMA = PC - SC;                              // 1.954 ¢

// Order of the fifths around the circle, by pitch class.
const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

function fromFifths(deltas) {
  const pos = new Array(12).fill(0);
  let p = 0;
  for (let i = 0; i < 12; i++) {
    const pc = CIRCLE[i];
    pos[pc] = ((p % 1200) + 1200) % 1200 - pc * 100;
    if (pos[pc] > 600) pos[pc] -= 1200;
    if (pos[pc] < -600) pos[pc] += 1200;
    p += 700 + deltas[i];
  }
  return normaliseToA(pos);
}

function normaliseToA(offsets) {
  const a = offsets[9];
  return offsets.map((v) => round1(v - a));
}

const round1 = (v) => Math.round(v * 100) / 100;

// δ per fifth, in circle order C-G, G-D, D-A, A-E, E-B, B-F♯, F♯-C♯, C♯-G♯, G♯-D♯, D♯-A♯, A♯-F, F-C
const pyth = [PURE, PURE, PURE, PURE, PURE, PURE, PURE, PURE, PURE - PC, PURE, PURE, PURE];
const qcm = (() => { const m = PURE - SC / 4; return [m, m, m, m, m, m, m, m, -11 * m, m, m, m]; })();
const wk3 = (() => { const t = PURE - PC / 4; return [t, t, t, PURE, PURE, t, PURE, PURE, PURE, PURE, PURE, PURE]; })();
const krn3 = (() => { const t = PURE - SC / 4; return [t, t, t, t, PURE, PURE, PURE - SCHISMA, PURE, PURE, PURE, PURE, PURE]; })();
const young = (() => { const t = PURE - PC / 6; return [t, t, t, t, t, t, PURE, PURE, PURE, PURE, PURE, PURE]; })();
const kellner = (() => { const t = PURE - PC / 5; return [t, t, t, t, PURE, t, PURE, PURE, PURE, PURE, PURE, PURE]; })();

export const TEMPERAMENTS = [
  { id: 'equal', name: 'Equal temperament', short: 'EQU', offsets: new Array(12).fill(0),
    about: 'Twelve identical semitones. Every key sounds the same; the default for fretted instruments.' },
  { id: 'pythagorean', name: 'Pythagorean', short: 'PYT', offsets: fromFifths(pyth),
    about: 'Eleven pure 3:2 fifths from E♭ to G♯; the leftover comma falls on one wolf fifth. Bright, wide thirds.' },
  { id: 'just-major', name: 'Just major', short: 'JMI', offsets: normaliseToA(JUST_RATIOS.map((r, i) => 1200 * Math.log2(r) - 100 * i)),
    about: '5-limit just intonation on the selected key: pure 5:4 thirds and 3:2 fifths in that key only.' },
  { id: 'meantone', name: '¼-comma meantone', short: '4MT', offsets: fromFifths(qcm),
    about: 'Fifths narrowed by a quarter syntonic comma so eight major thirds are pure. Renaissance standard.' },
  { id: 'werckmeister3', name: 'Werckmeister III', short: 'WK3', offsets: fromFifths(wk3),
    about: 'Four fifths narrowed by ¼ Pythagorean comma (1691). All keys usable, each with its own colour.' },
  { id: 'kirnberger3', name: 'Kirnberger III', short: 'KRN', offsets: fromFifths(krn3),
    about: 'Four ¼-syntonic-comma fifths from C to E give a pure C–E third (1779).' },
  { id: 'young', name: 'Young II', short: 'YNG', offsets: fromFifths(young),
    about: 'Thomas Young (1800): six fifths from C to F♯ narrowed by ⅙ Pythagorean comma, the rest pure.' },
  { id: 'kellner', name: 'Kellner', short: 'KLN', offsets: fromFifths(kellner),
    about: 'H. A. Kellner’s 1977 reconstruction of a Bach temperament: five fifths narrowed by ⅕ comma.' },
];

/**
 * Offset in cents for a pitch class under a temperament rooted on `rootPc`
 * (0 = C). Rotating the root moves the "good" keys; A stays the calibration note.
 */
export function temperamentOffset(temperament, pc, rootPc = 0) {
  if (!temperament || temperament.id === 'equal') return 0;
  const o = temperament.offsets;
  const rel = (p) => o[((p - rootPc) % 12 + 12) % 12];
  return round1(rel(pc) - rel(9));
}
