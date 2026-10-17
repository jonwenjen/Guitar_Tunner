// "Fit this guitar": turn a few strums into a per-guitar intonation model, saddle
// advice, and the open-string offsets that suit that particular instrument.
//
// 1. Fretting error. Pressing a string onto a fret stretches it, so fretted notes come
//    out sharp; how much depends on action, nut height, string core and saddle setback
//    (Varieschi & Gower 2010). Per string we fit
//        Δ(k) = α + β·u(k) + γ·v(k)           (cents, fret k ≥ 1; Δ(0) = 0)
//    with u(k) = 2^(k/12) − 1, the shape of a saddle-position error, and
//    v(k) = x₁₂/x_k − 1, the shape of a nut-height error that fades up the neck.
// 2. Saddle advice. Moving the saddle back by δ adds −1731·δ·u(k)/L cents at fret k, so
//    δ = β·L/1731 removes the slope and leaves an even error the tuning can absorb.
// 3. Best tuning. Open-string offsets o_s are chosen by least squares over the chords the
//    guitar is played in: keep every sounding note near equal temperament, and/or make the
//    overtones that two strings share coincide so they do not beat. Using the guitar's own
//    measured overtones (inharmonicity) follows the finding that minimising sensory
//    dissonance with real, slightly sharp overtones reproduces expert piano tuning
//    (Giordano 2015; Hinrichsen 2012). The cost is quadratic, so the optimum is exact.

import { parseNote, midiToFreq } from './music.js';
import { partialProfile, DEFAULT_B } from './poly.js';

export const FRET_U = (k) => Math.pow(2, k / 12) - 1;
export const FRET_V = (k) => 0.5 / (1 - Math.pow(2, -k / 12)) - 1;
export const MEASURE_FRETS = [2, 7, 12];
export const SCALE_PRESETS = [610, 628, 635, 648, 650];
const CENTS_PER_UNIT = 1200 / Math.LN2; // 1731.2

/**
 * Fit the fretting-error model to measured points.
 * @param {{k:number, d:number}[]} points fret number and error in cents (fretted vs open × 2^(k/12))
 */
export function fitFretModel(points) {
  const pts = points.filter((p) => Number.isFinite(p.d) && p.k > 0);
  if (!pts.length) return { alpha: 0, beta: 0, gamma: 0, n: 0 };
  if (pts.length === 1) return { alpha: pts[0].d, beta: 0, gamma: 0, n: 1 };
  if (pts.length === 2) {
    const [a, b] = pts;
    const beta = (b.d - a.d) / (FRET_U(b.k) - FRET_U(a.k));
    return { alpha: a.d - beta * FRET_U(a.k), beta, gamma: 0, n: 2 };
  }
  // Ridge on γ: the nut term only moves the answer when the low fret clearly asks for it.
  const mu = 1;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  for (const p of pts) {
    const row = [1, FRET_U(p.k), FRET_V(p.k)];
    for (let i = 0; i < 3; i++) {
      b[i] += row[i] * p.d;
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j];
    }
  }
  A[2][2] += mu;
  const [alpha, beta, gamma] = solveLinear(A, b);
  return { alpha, beta, gamma, n: pts.length };
}

/** Predicted fretting error (cents) at fret k. */
export function fretError(model, k, scale = 1) {
  if (!model || k <= 0) return 0;
  return scale * (model.alpha + model.beta * FRET_U(k) + model.gamma * FRET_V(k));
}

/** Saddle move in mm (positive = away from the neck) that removes the error's slope. */
export function saddleAdvice(model, scaleMm) {
  return ((model?.beta || 0) * scaleMm) / CENTS_PER_UNIT;
}

// ── Chord sets ───────────────────────────────────────────────────────────
// Frets per string, 6th → 1st; null = not played. Weight = how much the chord counts.
const STD_CHORDS = [
  { name: 'E', frets: [0, 2, 2, 1, 0, 0], w: 1 },
  { name: 'A', frets: [null, 0, 2, 2, 2, 0], w: 1 },
  { name: 'D', frets: [null, null, 0, 2, 3, 2], w: 1 },
  { name: 'G', frets: [3, 2, 0, 0, 0, 3], w: 1 },
  { name: 'C', frets: [null, 3, 2, 0, 1, 0], w: 1 },
  { name: 'Em', frets: [0, 2, 2, 0, 0, 0], w: 1 },
  { name: 'Am', frets: [null, 0, 2, 2, 1, 0], w: 1 },
  { name: 'Dm', frets: [null, null, 0, 2, 3, 1], w: 1 },
  { name: 'F', frets: [1, 3, 3, 2, 1, 1], w: 0.6 },
  { name: 'B♭', frets: [null, 1, 3, 3, 3, 1], w: 0.5 },
  { name: 'Bm', frets: [null, 2, 4, 4, 3, 2], w: 0.5 },
  { name: 'G (barre)', frets: [3, 5, 5, 4, 3, 3], w: 0.5 },
  { name: 'A (barre)', frets: [5, 7, 7, 6, 5, 5], w: 0.4 },
  { name: 'C (barre)', frets: [null, 3, 5, 5, 5, 3], w: 0.4 },
  { name: 'D (barre)', frets: [null, 5, 7, 7, 7, 5], w: 0.3 },
];
const DROP_CHORDS = [
  { name: 'open', frets: [0, 0, 0, 0, 0, 0], w: 0.6 },
  { name: 'D', frets: [0, null, 0, 2, 3, 2], w: 1 },
  { name: 'D5', frets: [0, 0, 0, null, null, null], w: 0.8 },
  { name: 'G', frets: [5, 5, 5, 4, 3, 3], w: 0.6 },
  { name: 'A', frets: [7, 7, 7, 6, 5, 5], w: 0.5 },
  { name: 'A (open)', frets: [null, 0, 2, 2, 2, 0], w: 0.8 },
  { name: 'C', frets: [null, 3, 2, 0, 1, 0], w: 0.8 },
  { name: 'F5', frets: [3, 3, 3, null, null, null], w: 0.5 },
  { name: 'G5', frets: [5, 5, 5, null, null, null], w: 0.5 },
];
const OPEN_CHORDS = [
  { name: 'open', frets: [0, 0, 0, 0, 0, 0], w: 1 },
  { name: 'barre 2', frets: [2, 2, 2, 2, 2, 2], w: 0.4 },
  { name: 'barre 3', frets: [3, 3, 3, 3, 3, 3], w: 0.3 },
  { name: 'barre 5', frets: [5, 5, 5, 5, 5, 5], w: 0.6 },
  { name: 'barre 7', frets: [7, 7, 7, 7, 7, 7], w: 0.6 },
];

export function chordSet(tuning) {
  if (tuning.shape === 'std') return STD_CHORDS;
  if (tuning.shape === 'drop') return DROP_CHORDS;
  return OPEN_CHORDS;
}

// ── Optimizer ────────────────────────────────────────────────────────────

const PAIR_WINDOW = 35; // cents: partial pairs closer than this beat (or roughen) audibly
const MAX_PARTIAL = 8;

/**
 * Best open-string offsets for one guitar in one tuning.
 * @param {object} p
 * @param {string[]} p.notes            current tuning (6th → 1st)
 * @param {object} p.tuning             tuning object (for its chord set)
 * @param {object} p.profile            measured guitar profile (see makeProfile)
 * @param {number} p.goal               0 = closest to equal temperament, 1 = most beat-free chords
 * @returns {{open:number[], fret12:number[], used:boolean[], errors:number[]}}
 */
export function optimizeOffsets({ notes, tuning, profile, goal = 0.5, chords }) {
  const midis = notes.map(parseNote);
  const strings = midis.map((m, s) => {
    const meas = profile.strings[s];
    if (!meas) return null;
    // Re-scale to the current tension: stretch and stiffness both go as 1/tension ∝ 1/f².
    const measMidi = meas.midi ?? m;
    const r = Math.pow(2, (2 * (measMidi - m)) / 12);
    return { model: meas.model, scale: r, B: (meas.B || 5e-5) * r, amps: meas.amps || [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12] };
  });
  const set = chords || chordSet(tuning);
  const n = 6;
  const AE = zeros(n), bE = new Array(n).fill(0); let wE = 0; // equal-temperament term
  const AB = zeros(n), bB = new Array(n).fill(0); let wB = 0; // beating term
  const used = new Array(n).fill(false);
  // Cents by which partial m of a stiff string lies above m × its first partial.
  const stretch = (B, m) => 600 * Math.log2((1 + B * m * m) / (1 + B));

  for (const ch of set) {
    const sounding = [];
    ch.frets.forEach((k, s) => {
      if (k === null || k === undefined || !strings[s]) return;
      const st = strings[s];
      const err = fretError(st.model, k, st.scale);
      const Bk = st.B * Math.pow(2, (2 * k) / 12);
      sounding.push({ s, k, err, Bk, pitch: 100 * (midis[s] + k), amps: st.amps });
      used[s] = true;
    });
    // (a) each note near equal temperament: (o_s + err)²
    for (const v of sounding) {
      AE[v.s][v.s] += ch.w;
      bE[v.s] -= ch.w * v.err;
      wE += ch.w;
    }
    // (b) coinciding partials of different strings: ((o_t − o_s) + c)²
    for (let i = 0; i < sounding.length; i++) {
      for (let j = i + 1; j < sounding.length; j++) {
        const p = sounding[i], q = sounding[j];
        if (p.s === q.s) continue;
        for (let a = 1; a <= MAX_PARTIAL; a++) {
          for (let b = 1; b <= MAX_PARTIAL; b++) {
            const nominal = q.pitch + 1200 * Math.log2(b) - (p.pitch + 1200 * Math.log2(a));
            if (Math.abs(nominal) > PAIR_WINDOW) continue;
            const freq = 440 * Math.pow(2, (p.pitch + 1200 * Math.log2(a) - 6900) / 1200);
            if (freq > 4000) continue;
            const c = nominal + (q.err + stretch(q.Bk, b)) - (p.err + stretch(p.Bk, a));
            const w = ch.w * (p.amps[a - 1] || 0) * (q.amps[b - 1] || 0) / (1 + (freq / 2500) ** 2);
            if (w <= 0) continue;
            // d = o_q − o_p + c
            AB[q.s][q.s] += w; AB[p.s][p.s] += w;
            AB[q.s][p.s] -= w; AB[p.s][q.s] -= w;
            bB[q.s] -= w * c; bB[p.s] += w * c;
            wB += w;
          }
        }
      }
    }
  }
  // Beating depends only on differences between strings, so a little of the
  // equal-temperament term always stays in to anchor the overall pitch.
  const g = Math.min(0.97, Math.max(0, goal));
  const A = zeros(n), b = new Array(n).fill(0);
  const lambda = 1e-3;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i][j] = (wE ? (1 - g) * AE[i][j] / wE : 0) + (wB ? g * AB[i][j] / wB : 0);
    }
    b[i] = (wE ? (1 - g) * bE[i] / wE : 0) + (wB ? g * bB[i] / wB : 0);
    A[i][i] += lambda * (used[i] ? 1 : 1000);
  }
  // Minimise oᵀAo − 2·(−b)ᵀo … written as A·o = b with b already carrying the sign.
  const o = solveLinear(A, b).map((v, i) => (used[i] ? clamp(v, -15, 15) : 0));
  const open = o.map(round2);
  // 12th-fret targets for intonation mode: where the 12th fret should read once the saddle
  // has removed the slope (β → 0), i.e. the open offset plus the even error α that remains.
  const fret12 = open.map((v, s) => (strings[s] ? round2(v + strings[s].scale * (strings[s].model?.alpha || 0)) : v));
  return { open, fret12, used };
}

/**
 * Reference for each open string: the measured open strum where it was read,
 * otherwise the tuner target (the wizard asks for a tuned guitar first).
 */
export function openReference(open, targets) {
  return targets.map((t, s) => {
    const o = open?.strings?.[s];
    if (o && o.heard) return { freq: o.freq, B: o.Bfitted ? o.B : (o.B || DEFAULT_B[s]), amps: partialProfile(o), measured: true };
    return { freq: t, B: DEFAULT_B[s], amps: partialProfile(null), measured: false };
  });
}

/** Assemble a profile from wizard measurements. */
export function makeProfile({ name, scaleMm, notes, open, frets, targets }) {
  // open:    analysis of the open strum (strings[] from analyzeStrum)
  // frets:   { [k]: analysis of the barre strum at fret k }
  // targets: first-partial target per string, used where the open strum did not read a string
  const midis = notes.map(parseNote);
  const refs = openReference(open, targets || midis.map((m) => midiToFreq(m)));
  const strings = midis.map((midi, s) => {
    const o = refs[s];
    const points = [];
    for (const [kStr, res] of Object.entries(frets || {})) {
      const k = Number(kStr);
      const f = res?.strings?.[s];
      if (!f || !f.heard) continue;
      points.push({ k, d: 1200 * Math.log2(f.freq / (o.freq * Math.pow(2, k / 12))) });
    }
    if (!o.measured && !points.length) return null;
    const model = fitFretModel(points);
    return {
      midi,
      B: o.B,
      amps: o.amps.map(round2),
      openMeasured: o.measured,
      points: points.map((p) => ({ k: p.k, d: round2(p.d) })),
      model: { alpha: round2(model.alpha), beta: round2(model.beta), gamma: round2(model.gamma) },
      saddleMm: Math.round(saddleAdvice(model, scaleMm) * 10) / 10,
    };
  });
  return {
    id: `g${Date.now().toString(36)}`,
    name,
    scaleMm,
    notes: notes.slice(),
    created: new Date().toISOString().slice(0, 10),
    strings,
  };
}

// ── helpers ──
const zeros = (n) => Array.from({ length: n }, () => new Array(n).fill(0));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Gaussian elimination with partial pivoting (small dense systems). */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-15) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-15 ? 0 : row[n] / row[i]));
}
