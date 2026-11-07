// Guitar check-up: a luthier's checklist turned into findings.
//
// The player measures what they can (relief, action, nut height, saddle height, the
// straightedge test, humidity, symptoms); the app adds what the strobe measured on the
// same guitar (12th-fret error per string, sharp first frets) and the strings in use.
// Findings follow the order a setup is done in, because each step changes the next:
// humidity and strings → truss rod (relief) → nut → saddle height (action) → intonation,
// then the structural items a luthier handles (neck angle, bridge, top, frets).
//
// Rules of thumb and their sources (see docs/RESEARCH.md §10):
//  • Humidity 45–55 % RH; dry: low action, sunken top, sharp fret ends, hump at the body
//    joint, fret plane above the bridge; wet: high action, swollen top (Taylor Guitars).
//  • Relief 0.15–0.30 mm on an acoustic, capo at fret 1, string held at the heel, gap
//    at fret 7–8; truss rod in 1/8-turn steps (StewMac).
//  • Action at the 12th fret, Martin factory range: bass 2.38–2.78 mm, treble 1.59–1.98 mm.
//  • Nut: string 0.50 mm (bass) to 0.40 mm (treble) above the 1st fret (MusicNomad).
//  • Saddle: the 12th fret sits halfway, so the saddle moves twice the action change
//    (Haze Guitars); a healthy saddle stands 2.5–4 mm proud of the bridge (Joe's Vintage
//    Guitars).
//  • Neck angle: a straightedge on the frets should meet the top of the bridge; much lower
//    means a reset (Martin Keith, Acoustic Guitar 2022).
//  • Bridge: a slip of paper under the back edge means the joint is opening (Frank Ford).

import { FRET_V } from './guitar-fit.js';
import { parseNote, midiToFreq } from './music.js';
import { resolveSet, findSet, actionSensitivity, actionFor } from './strings.js';

// ── Built-in guitars ──────────────────────────────────────────────────────
// `guessed` lists the fields the maker does not publish: typical values for the body
// style, shown with a mark so the player checks them.
export const MODELS = [
  {
    id: 'truetone-gc8css', brand: 'Truetone', name: 'GC-8CSS',
    body: 'gc', cutaway: true, top: 'solid', backSides: 'solid', scaleMm: 645, nutMm: 43,
    joint: 'glued', rod: 'head', pickup: 'none',
    guessed: ['body', 'top', 'backSides', 'scaleMm', 'nutMm', 'joint', 'rod', 'pickup'],
    refs: ['truetoneGM1CSS', 'truetoneGM1C'],
  },
  {
    id: 'stanford-psom20', brand: 'Stanford', name: 'Performer PSOM-20',
    body: 'om', cutaway: false, top: 'solid', backSides: 'solid', scaleMm: 645, nutMm: 45,
    joint: 'glued', rod: 'head', pickup: 'none',
    woods: 'Solid Sitka spruce, solid rosewood; mahogany neck; ebony fingerboard and bridge; bone nut and saddle; scalloped forward-shifted X bracing',
    guessed: ['scaleMm', 'nutMm', 'joint', 'rod'],
    refs: ['stanfordPSOM20', 'stanfordPSRD20', 'stanfordOrigin'],
  },
  {
    id: 'yamaha-apx4a', brand: 'Yamaha', name: 'APX-4A',
    body: 'thin', cutaway: true, top: 'solid', backSides: 'laminate', scaleMm: 634, nutMm: 43,
    joint: 'glued', rod: 'head', pickup: 'piezo',
    woods: 'Spruce top; nato (or mahogany) back and sides; rosewood fingerboard and bridge; under-saddle piezo with preamp',
    guessed: ['top', 'backSides', 'joint'],
    refs: ['yamahaAPX4aBentley', 'yamahaAPX4aCME', 'yamahaAPX'],
  },
];
export const CUSTOM_SPEC = {
  id: 'custom', brand: '', name: '', body: 'other', cutaway: false, top: 'solid', backSides: 'unknown',
  scaleMm: 645, nutMm: 43, joint: 'unknown', rod: 'unknown', pickup: 'none', guessed: [], refs: [],
};
export const findModel = (id) => MODELS.find((m) => m.id === id) || null;
export const SPEC_FIELDS = ['body', 'top', 'backSides', 'scaleMm', 'nutMm', 'joint', 'rod', 'pickup'];
export const SPEC_OPTIONS = {
  body: ['d', 'om', 'gc', 'ga', 'thin', 'parlor', 'jumbo', 'other'],
  top: ['solid', 'laminate'],
  backSides: ['solid', 'laminate', 'unknown'],
  joint: ['glued', 'bolt', 'unknown'],
  rod: ['head', 'soundhole', 'unknown'],
  pickup: ['none', 'piezo', 'other'],
};

/** The spec a check uses: the model's values, then the player's corrections. */
export function specFor(check) {
  const base = findModel(check?.model) || CUSTOM_SPEC;
  const own = check?.spec || {};
  const out = { ...base, guessed: base.guessed.filter((f) => own[f] === undefined) };
  for (const f of SPEC_FIELDS) if (own[f] !== undefined && own[f] !== null && own[f] !== '') out[f] = own[f];
  return out;
}

// ── Targets ───────────────────────────────────────────────────────────────
// Standard = the factory ranges above. Light and heavy shift them for fingerstyle with a
// light touch, or for hard strumming and slide.
export const STYLES = {
  light: { bass: [2.0, 2.4], treble: [1.4, 1.75], relief: [0.10, 0.20] },
  standard: { bass: [2.38, 2.78], treble: [1.59, 1.98], relief: [0.15, 0.30] },
  heavy: { bass: [2.6, 3.0], treble: [1.8, 2.2], relief: [0.20, 0.35] },
};
export const NUT_TARGET = { bass: 0.50, treble: 0.40 }; // mm, string above the 1st fret
export const NUT_HIGH = 0.15;      // mm over the target: slots worth lowering
export const NUT_LOW = 0.20;       // mm under the target: may buzz open
export const SADDLE_OK = [2.5, 4.0]; // mm proud of the bridge
export const RH_OK = [45, 55];
export const BETA_WARN = 1.5;      // ¢ at the 12th fret worth correcting
export const NUT_WARN = 1.5;       // ¢ extra at the first frets
export const CROWN_RANGE = 1.0;    // mm the crown can move on a ~3 mm saddle
const CENTS_PER_MM_L = 1200 / Math.LN2; // × 1/L

export const INPUT_KEYS = [
  'rh', 'stringsAge', 'relief', 'rod', 'actionBass', 'actionTreble', 'nutBass', 'nutTreble',
  'saddleBass', 'saddleTreble', 'straight', 'bridge', 'belly', 'sunken', 'fretWear', 'fretEnds',
  'cracks', 'buzz', 'nutBind',
];
export const INPUT_OPTIONS = {
  stringsAge: ['unknown', 'new', 'mid', 'old'],
  rod: ['unknown', 'ok', 'stiff', 'maxed'],
  straight: ['unknown', 'high', 'ok', 'low'],
  bridge: ['unknown', 'ok', 'paper', 'gap'],
  belly: ['unknown', 'normal', 'pronounced'],
  sunken: ['unknown', 'no', 'yes'],
  fretWear: ['unknown', 'none', 'light', 'grooves'],
  fretEnds: ['unknown', 'no', 'yes'],
  cracks: ['unknown', 'no', 'yes'],
  nutBind: ['unknown', 'no', 'yes'],
};
export const BUZZ = ['open', 'low', 'mid', 'high'];
const NUM_RANGE = {
  rh: [5, 100], relief: [-0.5, 2], actionBass: [0.5, 8], actionTreble: [0.5, 8],
  nutBass: [0, 3], nutTreble: [0, 3], saddleBass: [0, 10], saddleTreble: [0, 10],
};
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Inputs read from storage or a file, made safe. */
export function cleanInputs(x) {
  const out = {};
  if (!x || typeof x !== 'object') return out;
  for (const [k, [lo, hi]] of Object.entries(NUM_RANGE)) if (isNum(x[k]) && x[k] >= lo && x[k] <= hi) out[k] = x[k];
  for (const [k, opts] of Object.entries(INPUT_OPTIONS)) if (opts.includes(x[k])) out[k] = x[k];
  if (Array.isArray(x.buzz)) out.buzz = BUZZ.filter((b) => x.buzz.includes(b));
  return out;
}

const mid = ([a, b]) => (a + b) / 2;

/**
 * Turn a check into findings.
 * @param {object} check    { model, spec, style, inputs }
 * @param {object} [ctx]
 * @param {object} [ctx.profile]  measured guitar (guitar-fit makeProfile), or null
 * @param {object} [ctx.strings]  { current: selection, design: selection, dTotal } from the Strings section
 * @param {number} [ctx.a4]
 * @returns {{findings: object[], counts: object, missing: string[], spec: object, targets: object}}
 */
export function evaluate(check, ctx = {}) {
  const spec = specFor(check);
  const style = STYLES[check?.style] ? check.style : 'standard';
  const T = STYLES[style];
  const x = cleanInputs(check?.inputs);
  const F = [];
  const add = (area, level, key, params = {}, digits = {}) => F.push({ area, level, key, params, digits });
  const missing = [];
  const scaleMm = ctx.profile?.scaleMm || spec.scaleMm || 645;

  // 1. Humidity: first, because a dry or swollen guitar gives the wrong numbers for everything else.
  const drySigns = [];
  if (x.fretEnds === 'yes') drySigns.push('fretEnds');
  if (x.sunken === 'yes') drySigns.push('sunken');
  if (x.straight === 'high') drySigns.push('angleHigh');
  const dry = isNum(x.rh) && x.rh < RH_OK[0] - 5;
  const wet = isNum(x.rh) && x.rh > RH_OK[1] + 5;
  if (isNum(x.rh)) {
    if (x.rh < RH_OK[0]) add('env', dry ? 'diy' : 'watch', 'rhDry', { rh: x.rh }, { rh: 0 });
    else if (x.rh > RH_OK[1]) add('env', wet ? 'diy' : 'watch', 'rhWet', { rh: x.rh }, { rh: 0 });
    else add('env', 'ok', 'rhOk', { rh: x.rh }, { rh: 0 });
  } else missing.push('rh');
  if (drySigns.length && !(isNum(x.rh) && x.rh >= RH_OK[0])) add('env', 'diy', 'drySigns', { signs: drySigns });

  // 2. Strings.
  if (x.stringsAge === 'old') add('strings', 'diy', 'oldStrings');
  const dT = ctx.strings?.dTotal;
  if (isNum(dT) && Math.abs(dT) > 0.08) add('strings', 'watch', dT > 0 ? 'tensionMore' : 'tensionLess', { pct: Math.abs(dT) * 100 }, { pct: 0 });

  // 3. Relief and truss rod.
  let reliefOff = false;
  if (isNum(x.relief)) {
    const [lo, hi] = T.relief;
    const p = { v: x.relief, min: lo, max: hi, rod: spec.rod };
    const dg = { v: 2, min: 2, max: 2 };
    if (x.relief < lo) { reliefOff = true; add('relief', 'diy', 'reliefLow', p, dg); }
    else if (x.relief > hi) {
      reliefOff = true;
      if (x.rod === 'maxed') add('relief', 'luthier', 'rodMaxed', p, dg);
      else add('relief', 'diy', 'reliefHigh', p, dg);
    } else add('relief', 'ok', 'reliefOk', p, dg);
  } else missing.push('relief');
  if (x.rod === 'stiff') add('relief', 'tech', 'rodStiff');

  // 4. Nut: height at the 1st fret, and what the measurement says about the first frets.
  const nutSides = [['bass', x.nutBass], ['treble', x.nutTreble]];
  let nutChecked = false;
  for (const [side, v] of nutSides) {
    if (!isNum(v)) continue;
    nutChecked = true;
    const target = NUT_TARGET[side];
    if (v > target + NUT_HIGH) add('nut', 'tech', 'nutHigh', { side, v, target, d: v - target }, { v: 2, target: 2, d: 2 });
    else if (v < target - NUT_LOW) add('nut', x.buzz?.includes('open') ? 'tech' : 'watch', 'nutLow', { side, v, target }, { v: 2, target: 2 });
  }
  if (nutChecked && !F.some((f) => f.area === 'nut')) add('nut', 'ok', 'nutOk');
  if (!nutChecked) missing.push('nut');
  const prof = ctx.profile && Array.isArray(ctx.profile.strings) ? ctx.profile : null;
  if (prof) {
    const sharp = prof.strings.map((s, i) => {
      if (!s || !s.model || !Array.isArray(s.points) || !s.points.some((p) => p.k <= 3)) return null;
      const c = (s.model.gamma || 0) * (FRET_V(1) - FRET_V(5));
      return c > NUT_WARN ? { i, c } : null;
    }).filter(Boolean);
    if (sharp.length) add('nut', 'tech', 'nutSharp', { list: sharp.map((s) => ({ i: s.i, c: s.c })) });
  }
  if (x.nutBind === 'yes') add('nut', 'diy', 'nutBind');

  // 5. Action at the 12th fret and saddle height.
  const sides = { bass: { v: x.actionBass, sad: x.saddleBass, range: T.bass }, treble: { v: x.actionTreble, sad: x.saddleTreble, range: T.treble } };
  const change = { bass: 0, treble: 0 }; // planned action change, mm
  let actionHigh = false;
  let actionChecked = false;
  let left = null; // lowest saddle height left after the planned change
  for (const [side, s] of Object.entries(sides)) {
    if (!isNum(s.v)) continue;
    actionChecked = true;
    const [lo, hi] = s.range;
    if (s.v > hi) {
      actionHigh = true;
      const d = s.v - mid(s.range);
      change[side] = -d;
      const after = isNum(s.sad) ? s.sad - 2 * d : null;
      if (after !== null) left = left === null ? after : Math.min(left, after);
      // Not enough saddle left: the neck angle finding says what to do instead.
      const level = reliefOff || (after !== null && after < SADDLE_OK[0]) ? 'watch' : 'diy';
      add('action', level, after === null ? 'actionHighNoSaddle' : 'actionHigh',
        { side, v: s.v, min: lo, max: hi, d, s: 2 * d, left: after }, { v: 1, min: 1, max: 1, d: 1, s: 1, left: 1 });
    } else if (s.v < lo) {
      const d = mid(s.range) - s.v;
      change[side] = d;
      const buzzing = (x.buzz || []).some((b) => b !== 'open');
      add('action', buzzing && !reliefOff ? 'diy' : 'watch', 'actionLow', { side, v: s.v, min: lo, max: hi, d, s: 2 * d }, { v: 1, min: 1, max: 1, d: 1, s: 1 });
    }
  }
  if (actionChecked && !F.some((f) => f.area === 'action')) add('action', 'ok', 'actionOk');
  if (!actionChecked) missing.push('action');
  if (reliefOff && F.some((f) => f.area === 'action' && f.level !== 'ok')) add('action', 'info', 'actionAfterRelief');
  for (const [side, s] of Object.entries(sides)) {
    if (!isNum(s.sad)) continue;
    if (s.sad > SADDLE_OK[1] + 0.5 && !actionHigh) add('action', 'watch', 'saddleTall', { side, v: s.sad, max: SADDLE_OK[1] }, { v: 1, max: 1 });
  }
  if (!isNum(x.saddleBass) && !isNum(x.saddleTreble)) missing.push('saddle');
  if (spec.pickup === 'piezo' && F.some((f) => f.area === 'action' && ['actionHigh', 'actionHighNoSaddle', 'actionLow'].includes(f.key))) add('action', 'info', 'pickup');

  // 6. Intonation from the measurement, after the planned action change.
  if (prof) {
    const sel = ctx.strings?.current;
    const set = resolveSet(sel) || findSet('dad-ej16');
    const bassA = isNum(x.actionBass) ? x.actionBass : 2.4;
    const trebA = isNum(x.actionTreble) ? x.actionTreble : 1.8;
    const rows = prof.strings.map((s, i) => {
      if (!s || !s.model) return null;
      const freq = midiToFreq(parseNote(prof.notes[i]), ctx.a4 || 440);
      const sens = actionSensitivity(set.gauges[i], set.wound[i], set.material, freq, scaleMm, actionFor(i, bassA, trebA));
      const dh = change.bass + ((change.treble - change.bass) * i) / 5;
      const beta = s.model.beta || 0;
      const after = beta + sens * (dh / 0.1);
      return { i, beta, after, shift: after - beta, mm: (after * scaleMm) / CENTS_PER_MM_L };
    });
    const known = rows.filter(Boolean);
    const moved = known.filter((r) => Math.abs(r.shift) >= 0.3);
    if (moved.length) {
      const maxShift = moved.reduce((a, r) => (Math.abs(r.shift) > Math.abs(a.shift) ? r : a));
      add('inton', 'info', 'intonAction', { c: Math.abs(maxShift.shift), dir: maxShift.shift < 0 ? 'flatter' : 'sharper' }, { c: 1 });
    }
    const off = known.filter((r) => Math.abs(r.after) > BETA_WARN);
    if (!known.length) { /* nothing measured */ }
    else if (!off.length) add('inton', 'ok', 'intonOk', { tol: BETA_WARN }, { tol: 1 });
    else {
      const planned = change.bass !== 0 || change.treble !== 0;
      add('inton', 'tech', planned ? 'intonSaddlePred' : 'intonSaddle', { list: off.map((r) => ({ i: r.i, c: r.after, mm: r.mm })) });
      const wide = off.filter((r) => Math.abs(r.mm) > CROWN_RANGE);
      if (wide.length) add('inton', 'tech', 'intonWide', { strings: wide.map((r) => r.i), lim: CROWN_RANGE }, { lim: 1 });
    }
  } else add('inton', 'need', 'noMeasure');

  // 7. Neck angle: is there enough saddle left to get the action down?
  const lowSaddle = left !== null && left < SADDLE_OK[0];
  const nowLow = [x.saddleBass, x.saddleTreble].some((v) => isNum(v) && v < SADDLE_OK[0]);
  if (x.straight === 'low') {
    if (actionHigh && (left === null || lowSaddle)) {
      add('angle', 'luthier', left === null ? 'resetNeededNoSaddle' : 'resetNeeded', { left, joint: spec.joint }, { left: 1 });
      add('angle', 'info', 'resetAlt');
      if (spec.top === 'laminate' || spec.backSides === 'laminate') add('angle', 'info', 'resetValue');
    } else if (actionHigh) add('angle', 'watch', 'angleLowSaddle', { left }, { left: 1 });
    else add('angle', 'watch', 'angleLowOk');
  } else if (x.straight === 'high') {
    add('angle', dry || drySigns.length > 1 ? 'diy' : 'watch', 'angleHigh');
  } else if (x.straight === 'ok') {
    if (actionHigh && lowSaddle) add('angle', 'tech', 'saddleShort', { left }, { left: 1 });
    else add('angle', 'ok', 'angleOk');
  } else {
    if (actionHigh && (lowSaddle || nowLow)) add('angle', 'watch', 'resetSuspect', { left: left ?? Math.min(...[x.saddleBass, x.saddleTreble].filter(isNum)) }, { left: 1 });
    missing.push('straight');
  }

  // 8. Bridge.
  if (x.bridge === 'gap') add('bridge', 'luthier', 'bridgeGap');
  else if (x.bridge === 'paper') add('bridge', 'luthier', 'bridgeLift');
  else if (x.bridge === 'ok') add('bridge', 'ok', 'bridgeOk');
  else missing.push('bridge');

  // 9. Top and cracks.
  if (x.belly === 'pronounced') add('top', actionHigh ? 'luthier' : 'watch', 'belly');
  if (x.cracks === 'yes') add('top', 'luthier', 'cracks');

  // 10. Frets and buzz.
  if (x.fretWear === 'grooves') add('frets', 'tech', 'fretGrooves');
  else if (x.fretWear === 'light') add('frets', 'watch', 'fretLight');
  const buzz = x.buzz || [];
  const reliefLow = isNum(x.relief) && x.relief < T.relief[0];
  const nutLow = F.some((f) => f.key === 'nutLow');
  if (buzz.includes('open')) add('frets', 'tech', nutLow ? 'buzzOpenNut' : 'buzzOpen');
  if (buzz.includes('low')) add('frets', reliefLow ? 'diy' : 'tech', reliefLow ? 'buzzLowRelief' : 'buzzLow');
  if (buzz.includes('mid')) add('frets', 'tech', 'buzzMid');
  if (buzz.includes('high')) add('frets', 'tech', drySigns.length || dry ? 'buzzHighDry' : 'buzzHigh');

  if (missing.length) add('missing', 'need', 'missing', { items: missing });

  // Urgent first, then the setup order.
  const AREA = ['bridgeUrgent', 'env', 'strings', 'relief', 'nut', 'action', 'inton', 'angle', 'bridge', 'top', 'frets', 'missing'];
  F.forEach((f, n) => { f.n = n; if (f.key === 'bridgeGap') f.area = 'bridgeUrgent'; });
  F.sort((a, b) => AREA.indexOf(a.area) - AREA.indexOf(b.area) || a.n - b.n);
  const counts = { luthier: 0, tech: 0, diy: 0, watch: 0, ok: 0, info: 0, need: 0 };
  for (const f of F) counts[f.level]++;
  for (const f of F) {
    delete f.n;
    if (f.area === 'bridgeUrgent') f.area = 'bridge';
  }
  return { findings: F, counts, missing, spec, targets: { style, ...T, nut: NUT_TARGET, saddle: SADDLE_OK } };
}
