// Sweetened tunings: small per-string cent offsets applied on top of equal temperament.
//
// Peterson tuners ship hundreds of these presets ("degrees of harmony or consonance").
// Their exact tables are proprietary, so this module builds sweeteners from first
// principles and documents how each number is derived:
//
//   • Just chord      – for open/modal tunings, move each string part-way toward the
//                       5-limit just interval it forms with the chord root.
//   • Open-chord fit  – for standard-shape tunings, a least-squares fit of the six
//                       open strings that brings the common first-position chords
//                       (E A D G C Em Am Dm) closest to just intonation, pulled back
//                       toward equal temperament by a ridge penalty.
//   • Strobe-style GTR – user-measured offsets of Peterson's guitar preset (unofficial).
//   • Custom          – your own open-string and 12th-fret offsets (Feiten-style).
//
// Offsets are arrays of six numbers, 6th string first (low → high), in cents.

import { parseNote, pitchClass, JUST_DEVIATION } from './music.js';
import { optimizeOffsets } from './guitar-fit.js';

export const SWEETENERS = [
  { id: 'equal', name: 'Equal (no sweetening)', kind: 'fixed',
    about: 'Every string exactly on its equal-tempered pitch. Best when you play with keyboards or in many keys.' },
  { id: 'just-chord', name: 'Just chord', kind: 'just', usesSweetness: true,
    about: 'For open and modal tunings: each string moves toward the pure (5-limit just) interval it forms with the chord root — fifths +2.0¢, major thirds −13.7¢, minor thirds +15.6¢ — scaled by the sweetness amount, then centred so the chord as a whole stays at concert pitch.',
    sources: ['barbour1951', 'sethares2005'] },
  { id: 'open-chords', name: 'Open-chord fit', kind: 'lsq', usesSweetness: true,
    about: 'For standard-shape tunings: a least-squares fit of the six open strings that brings the first-position E, A, D, G, C, Em, Am and Dm chords closest to just intonation. Frets are equal-tempered, so the fit is a compromise; sweetness sets how far it may move from equal temperament.',
    sources: ['barbour1951', 'varieschi2010'] },
  { id: 'strobe-gtr', name: 'Strobe-style GTR (measured)', kind: 'fixed',
    open: [-2.3, 0, 0, -0.4, -2.1, -2.3],
    about: 'Offsets that guitarists measured from a Peterson StroboFlip’s guitar preset and posted publicly (6th→1st: −2.3, 0, 0, −0.4, −2.1, −2.3). Unofficial; designed for standard tuning.',
    sources: ['umgf', 'petersonFeiten'] },
  { id: 'guitar-fit', name: 'This guitar (measured)', kind: 'profile', usesSweetness: true,
    about: 'Offsets fitted to one guitar from four strums — open strings and a barre at the 2nd, 7th and 12th frets. Each open string is set so that, over common chords, notes land closest to equal temperament (goal at the left) or shared overtones beat least (goal at the right), using that guitar’s own fretting error and string stiffness.',
    sources: ['varieschi2010', 'giordano2015', 'hinrichsen2012'] },
  { id: 'custom', name: 'Custom', kind: 'custom',
    about: 'Your own offsets for each open string, plus separate 12th-fret targets for setting intonation — the structure used by the Buzz Feiten system.',
    sources: ['feiten1997', 'petersonFeiten'] },
];

export function findSweetener(id) {
  return SWEETENERS.find((s) => s.id === id) || SWEETENERS[0];
}

const ZERO = () => [0, 0, 0, 0, 0, 0];
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Compute offsets for a tuning.
 * @returns {{open:number[], fret12:number[], applies:boolean, note?:string}}
 */
export function sweetenerOffsets(sweetener, tuning, { sweetness = 0.5, anchor = 'average', custom, profile } = {}) {
  const sw = typeof sweetener === 'string' ? findSweetener(sweetener) : sweetener;
  const res = { open: ZERO(), fret12: ZERO(), applies: true };
  if (!sw || sw.id === 'equal') return res;

  if (sw.kind === 'fixed') {
    res.open = sw.open.slice();
    res.fret12 = (sw.fret12 || sw.open).slice();
    if (sw.id === 'strobe-gtr' && tuning.shape !== 'std' && tuning.shape !== 'drop') {
      res.note = 'Measured for standard tuning; applied by string number.';
      res.noteKey = 'gtrByString';
    }
    return res;
  }
  if (sw.kind === 'profile') {
    if (!profile) return { ...res, applies: false, noteKey: 'needProfile', note: 'Measure a guitar first.' };
    const r = optimizeOffsets({ notes: tuning.notes, tuning, profile, goal: sweetness });
    return { open: r.open, fret12: r.fret12, applies: true };
  }
  if (sw.kind === 'custom') {
    res.open = (custom?.open || ZERO()).map(Number);
    res.fret12 = (custom?.fret12 || ZERO()).map(Number);
    return res;
  }
  if (sw.kind === 'just') {
    if (tuning.root === undefined || tuning.root === null) {
      return { ...res, applies: false, noteKey: 'justNeedsChord', note: 'Just chord needs a chordal tuning (open, modal or slack key).' };
    }
    res.open = justChordOffsets(tuning, sweetness, anchor);
    res.fret12 = res.open.slice();
    return res;
  }
  if (sw.kind === 'lsq') {
    if (tuning.shape !== 'std' && tuning.shape !== 'drop') {
      return { ...res, applies: false, noteKey: 'lsqNeedsShapes', note: 'Open-chord fit needs standard or drop-tuning chord shapes.' };
    }
    res.open = openChordFit(sweetness);
    if (tuning.shape === 'drop') {
      // In drop tunings the 6th string doubles the 4th an octave down: give it the same offset.
      res.open[0] = res.open[2];
      res.note = '6th string matches the 4th (octave) in drop tunings.';
      res.noteKey = 'dropMatches';
    }
    res.fret12 = res.open.slice();
    return res;
  }
  return res;
}

/** Just-chord sweetener for a tuning with a declared root pitch class. */
export function justChordOffsets(tuning, sweetness = 0.5, anchor = 'average') {
  const root = tuning.root;
  const raw = tuning.notes.map((n) => {
    const iv = (pitchClass(parseNote(n)) - root + 12) % 12;
    return JUST_DEVIATION[iv] * sweetness;
  });
  let shift = 0;
  if (anchor === 'average') shift = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((v) => round2(v - shift));
}

// First-position chord shapes in standard tuning: frets per string (6th→1st), null = not played.
export const OPEN_CHORDS = [
  { name: 'E', root: 4, frets: [0, 2, 2, 1, 0, 0] },
  { name: 'A', root: 9, frets: [null, 0, 2, 2, 2, 0] },
  { name: 'D', root: 2, frets: [null, null, 0, 2, 3, 2] },
  { name: 'G', root: 7, frets: [3, 2, 0, 0, 0, 3] },
  { name: 'C', root: 0, frets: [null, 3, 2, 0, 1, 0] },
  { name: 'Em', root: 4, frets: [0, 2, 2, 0, 0, 0] },
  { name: 'Am', root: 9, frets: [null, 0, 2, 2, 1, 0] },
  { name: 'Dm', root: 2, frets: [null, null, 0, 2, 3, 1] },
];
const STANDARD_PC = [4, 9, 2, 7, 11, 4];

/**
 * Least-squares open-chord sweetener.
 * Unknowns: six string offsets o_s and one free reference r_c per chord.
 * Minimise Σ_c Σ_s∈c (o_s − r_c − d_cs)² + λ Σ_s o_s², where d_cs is the just-intonation
 * deviation of that chord tone. λ shrinks toward equal temperament as sweetness → 0.
 */
export function openChordFit(sweetness = 0.5, chords = OPEN_CHORDS) {
  if (sweetness <= 0) return ZERO();
  const s = Math.min(1, sweetness);
  const lambda = (3 * (1 - s)) / s + 0.05;
  const S = 6, C = chords.length, U = S + C;
  const A = Array.from({ length: U }, () => new Float64Array(U));
  const b = new Float64Array(U);
  chords.forEach((ch, c) => {
    ch.frets.forEach((f, s2) => {
      if (f === null) return;
      const iv = ((STANDARD_PC[s2] + f - ch.root) % 12 + 12) % 12;
      const d = JUST_DEVIATION[iv];
      // residual = o_s − r_c − d  → gradient terms
      const ri = S + c;
      A[s2][s2] += 1; A[s2][ri] -= 1; b[s2] += d;
      A[ri][s2] -= 1; A[ri][ri] += 1; b[ri] -= d;
    });
  });
  for (let s2 = 0; s2 < S; s2++) A[s2][s2] += lambda;
  const x = solve(A, b);
  return x.slice(0, S).map(round2);
}

/** Gaussian elimination with partial pivoting. */
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}
