// Acoustic string sets, string tension, and how gauge affects intonation.
//
// Catalog: gauges as published by the makers (checked against their own pages or
// retailers quoting them, see `src`). Gauges are in inches, 6th string first.
//
// Physics (all per string, at scale length L and open-string frequency f):
//   unit weight  μ   plain steel: 0.996 · 0.2836 lb/in³ · πd²/4
//                    bronze-wound: ρ_eff · πd²/4 · alloy, ρ_eff = 0.2565 − 0.85·max(0, d − 0.042)
//                    (fitted to D'Addario's published EJ16 tensions: every string within 0.1 %;
//                    the 80/20 factor 0.985 fits EJ11 within 2 %)
//   tension      T = μ (2 L f)² / 386.4                       (lb, with L in inches)
//   stiffness    B = π³ E d_c⁴ / (64 T L²)                    (Fletcher 1964), d_c = core diameter
//   setback      S = √(E I / T) + 2 R h² / L                  (mm, the saddle compensation the
//                    string needs: bending stiffness end correction plus the stretch of fretting
//                    at the 12th fret, R = E A_c / 2T, h = action at the 12th fret;
//                    after Varieschi & Gower 2010)
// Wound strings carry tension and stiffness in a hex core, taken here as
// d_c ≈ 0.0055 + 0.225 d (a typical construction; makers rarely publish cores).
// Moving the saddle back by ΔS lowers the 12th fret by 1731·ΔS/L cents.

const PI = Math.PI;
const E_STEEL = 30e6;          // psi
const IN = 25.4;               // mm per inch
const CENTS_PER_RATIO = 1200 / Math.LN2;

export const MATERIALS = {
  pb: { factor: 1 },          // phosphor bronze wrap
  b8020: { factor: 0.985 },   // 80/20 bronze
  b8515: { factor: 0.995 },   // 85/15 bronze
  nps: { factor: 0.91 },      // nickel-plated steel wrap (electric)
};

const W4 = [true, true, true, true, false, false];
const set = (id, brand, line, name, material, gauges, src) => ({ id, brand, line, name, material, gauges, wound: W4, src });

export const STRING_SETS = [
  set('dad-ej15', "D'Addario", 'EJ15 Phosphor Bronze', 'Extra Light', 'pb', [0.047, 0.039, 0.030, 0.023, 0.014, 0.010], 'stringsDaddario'),
  set('dad-ej26', "D'Addario", 'EJ26 Phosphor Bronze', 'Custom Light', 'pb', [0.052, 0.042, 0.032, 0.022, 0.015, 0.011], 'stringsDaddario'),
  set('dad-ej16', "D'Addario", 'EJ16 Phosphor Bronze', 'Light', 'pb', [0.053, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsDaddarioEJ16'),
  set('dad-ej17', "D'Addario", 'EJ17 Phosphor Bronze', 'Medium', 'pb', [0.056, 0.045, 0.035, 0.026, 0.017, 0.013], 'stringsDaddario'),
  set('dad-ej11', "D'Addario", 'EJ11 80/20 Bronze', 'Light', 'b8020', [0.053, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsDaddarioEJ11'),
  set('dad-ez900', "D'Addario", 'EZ900 85/15 Bronze', 'Extra Light', 'b8515', [0.050, 0.040, 0.030, 0.022, 0.014, 0.010], 'stringsDaddarioEZ'),
  set('dad-ez910', "D'Addario", 'EZ910 85/15 Bronze', 'Light', 'b8515', [0.052, 0.042, 0.032, 0.024, 0.015, 0.011], 'stringsDaddarioEZ'),
  set('dad-ez920', "D'Addario", 'EZ920 85/15 Bronze', 'Medium Light', 'b8515', [0.054, 0.044, 0.034, 0.025, 0.016, 0.012], 'stringsDaddarioEZ'),
  set('elx-16002', 'Elixir', '16002 Nanoweb Phosphor Bronze', 'Extra Light', 'pb', [0.047, 0.039, 0.030, 0.023, 0.014, 0.010], 'stringsElixir'),
  set('elx-16027', 'Elixir', '16027 Nanoweb Phosphor Bronze', 'Custom Light', 'pb', [0.052, 0.042, 0.032, 0.022, 0.015, 0.011], 'stringsElixir'),
  set('elx-16052', 'Elixir', '16052 Nanoweb Phosphor Bronze', 'Light', 'pb', [0.053, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsElixir'),
  set('elx-16077', 'Elixir', '16077 Nanoweb Phosphor Bronze', 'Light-Medium', 'pb', [0.056, 0.045, 0.035, 0.024, 0.016, 0.012], 'stringsElixir'),
  set('elx-16102', 'Elixir', '16102 Nanoweb Phosphor Bronze', 'Medium', 'pb', [0.056, 0.045, 0.035, 0.026, 0.017, 0.013], 'stringsElixir'),
  set('elx-11002', 'Elixir', '11002 Nanoweb 80/20 Bronze', 'Extra Light', 'b8020', [0.047, 0.039, 0.030, 0.023, 0.014, 0.010], 'stringsElixir8020'),
  set('elx-11052', 'Elixir', '11052 Nanoweb 80/20 Bronze', 'Light', 'b8020', [0.053, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsElixir8020'),
  set('elx-11182', 'Elixir', '11182 Nanoweb 80/20 Bronze', 'HD Light', 'b8020', [0.053, 0.042, 0.032, 0.025, 0.017, 0.013], 'stringsElixir8020'),
  set('mar-ma530', 'Martin', 'MA530 Authentic Acoustic SP', 'Extra Light', 'pb', [0.047, 0.039, 0.030, 0.023, 0.014, 0.010], 'stringsMartin'),
  set('mar-ma535', 'Martin', 'MA535 Authentic Acoustic SP', 'Custom Light', 'pb', [0.052, 0.042, 0.032, 0.023, 0.015, 0.011], 'stringsMartin'),
  set('mar-ma540', 'Martin', 'MA540 Authentic Acoustic SP', 'Light', 'pb', [0.054, 0.042, 0.032, 0.025, 0.016, 0.012], 'stringsMartin'),
  set('mar-ma550', 'Martin', 'MA550 Authentic Acoustic SP', 'Medium', 'pb', [0.056, 0.045, 0.035, 0.026, 0.017, 0.013], 'stringsMartin'),
  set('eb-2006', 'Ernie Ball', 'Earthwood 2006 80/20 Bronze', 'Extra Light', 'b8020', [0.050, 0.040, 0.028, 0.020, 0.014, 0.010], 'stringsErnieBall'),
  set('eb-2004', 'Ernie Ball', 'Earthwood 2004 80/20 Bronze', 'Light', 'b8020', [0.052, 0.042, 0.030, 0.022, 0.015, 0.011], 'stringsErnieBall'),
  set('eb-2003', 'Ernie Ball', 'Earthwood 2003 80/20 Bronze', 'Medium Light', 'b8020', [0.054, 0.044, 0.032, 0.024, 0.016, 0.012], 'stringsErnieBall'),
  set('eb-2002', 'Ernie Ball', 'Earthwood 2002 80/20 Bronze', 'Medium', 'b8020', [0.056, 0.046, 0.034, 0.026, 0.017, 0.013], 'stringsErnieBall'),
  set('gib-pb11', 'Gibson', 'Phosphor Bronze', 'Ultra-Light', 'pb', [0.052, 0.042, 0.032, 0.022, 0.015, 0.011], 'stringsGibson'),
  set('gib-pb12', 'Gibson', 'Phosphor Bronze', 'Light', 'pb', [0.053, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsGibson'),
  set('gib-pb13', 'Gibson', 'Phosphor Bronze', 'Medium', 'pb', [0.056, 0.045, 0.035, 0.026, 0.017, 0.013], 'stringsGibson'),
  set('dr-rpl10', 'DR', 'Rare RPL-10 Phosphor Bronze', 'Extra Light', 'pb', [0.048, 0.038, 0.030, 0.022, 0.014, 0.010], 'stringsDR'),
  set('dr-rpml11', 'DR', 'Rare RPML-11 Phosphor Bronze', 'Custom Light', 'pb', [0.050, 0.040, 0.030, 0.022, 0.015, 0.011], 'stringsDR'),
  set('dr-rpm12', 'DR', 'Rare RPM-12 Phosphor Bronze', 'Light', 'pb', [0.054, 0.042, 0.032, 0.024, 0.016, 0.012], 'stringsDR'),
];

export const BRANDS = [...new Set(STRING_SETS.map((s) => s.brand))];
export const findSet = (id) => STRING_SETS.find((s) => s.id === id) || null;

/** Thousandths for labels: 0.012 → "12". */
export const thou = (d) => String(Math.round(d * 1000 * 10) / 10);
export const rangeLabel = (gauges) => `${thou(gauges[gauges.length - 1])}-${thou(gauges[0])}`;

/**
 * A selection stored in settings → concrete strings, or null for "don't know".
 * @param {{kind:'catalog',id:string}|{kind:'custom',gauges:number[],wound:boolean[],material:string}|{kind:'unknown'}|null} sel
 */
export function resolveSet(sel) {
  if (!sel || sel.kind === 'unknown') return null;
  if (sel.kind === 'catalog') {
    const s = findSet(sel.id);
    return s ? { ...s, label: `${s.brand} ${s.line} ${s.name} (${rangeLabel(s.gauges)})` } : null;
  }
  if (sel.kind === 'custom') {
    const g = (sel.gauges || []).map(Number);
    if (g.length !== 6 || !g.every((d) => d >= 0.006 && d <= 0.08)) return null;
    const wound = Array.isArray(sel.wound) && sel.wound.length === 6 ? sel.wound.map(Boolean) : W4.slice();
    const material = MATERIALS[sel.material] ? sel.material : 'pb';
    return { id: 'custom', brand: '', line: '', name: '', material, gauges: g, wound, label: `${rangeLabel(g)} (${g.map(thou).join(' ')})`, custom: true };
  }
  return null;
}

/** Parse a gauge typed by the user: ".012", "12" (thousandths) or millimetres. Returns inches or NaN. */
export function parseGauge(text, unit = 'in') {
  const v = Number(String(text).trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return NaN;
  if (unit === 'mm') return v / IN;
  return v >= 1 ? v / 1000 : v;
}

// ── Physics ──────────────────────────────────────────────────────────────

const coreDiameter = (d, wound) => (wound ? 0.0055 + 0.225 * d : d);

/** Unit weight in lb/in. */
export function unitWeight(d, wound, material = 'pb') {
  const area = (PI * d * d) / 4;
  if (!wound) return 0.996 * 0.2836 * area;
  const rho = 0.2565 - 0.85 * Math.max(0, d - 0.042);
  return rho * area * (MATERIALS[material] || MATERIALS.pb).factor;
}

const tensionLb = (d, wound, material, freq, scaleMm) => {
  const L = scaleMm / IN;
  return (unitWeight(d, wound, material) * (2 * L * freq) ** 2) / 386.4;
};
export const LB_TO_KG = 0.45359237;
export const tensionKg = (d, wound, material, freq, scaleMm) => tensionLb(d, wound, material, freq, scaleMm) * LB_TO_KG;

/** Gauge (inches) that gives a target tension (kg) for this pitch and scale. */
export function gaugeForTension(targetKg, wound, material, freq, scaleMm) {
  let lo = 0.006, hi = 0.08;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (tensionKg(mid, wound, material, freq, scaleMm) < targetKg) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inharmonicity coefficient B of the open string. */
export function stiffnessB(d, wound, material, freq, scaleMm) {
  const L = scaleMm / IN;
  const dc = coreDiameter(d, wound);
  return (PI ** 3 * E_STEEL * dc ** 4) / (64 * tensionLb(d, wound, material, freq, scaleMm) * L * L);
}

/** Saddle setback the string needs (mm) for a given action at the 12th fret (mm). */
export function setbackMm(d, wound, material, freq, scaleMm, actionMm) {
  const L = scaleMm / IN;
  const T = tensionLb(d, wound, material, freq, scaleMm);
  const dc = coreDiameter(d, wound);
  const I = (PI * dc ** 4) / 64;
  const A = (PI * dc * dc) / 4;
  const stiff = Math.sqrt((E_STEEL * I) / T);
  const R = (E_STEEL * A) / (2 * T);
  const h = actionMm / IN;
  return (stiff + (2 * R * h * h) / L) * IN;
}

/** Cents at the 12th fret per extra millimetre of saddle compensation needed. */
export const centsPerMm = (scaleMm) => CENTS_PER_RATIO / scaleMm;

/** Action at the 12th fret for each string, interpolated from the bass and treble sides. */
export const actionFor = (i, bassMm = 2.4, trebleMm = 1.8) => bassMm + ((trebleMm - bassMm) * i) / 5;

/** Typical sensitivity: cents at the 12th fret for +0.1 mm action on this string. */
export function actionSensitivity(d, wound, material, freq, scaleMm, actionMm) {
  const a = setbackMm(d, wound, material, freq, scaleMm, actionMm);
  const b = setbackMm(d, wound, material, freq, scaleMm, actionMm + 0.1);
  return (b - a) * centsPerMm(scaleMm);
}

/**
 * Compare a set with a reference set on one guitar.
 * @param {object} cur   resolved set in use
 * @param {object|null} ref  resolved reference (the gauge the guitar was set up for)
 * @param {{freqs:number[], refFreqs?:number[], scaleMm:number, action:number[]}} o
 *   freqs: open strings in the tuning played; refFreqs: tuning the reference was meant for.
 */
export function compareSets(cur, ref, o) {
  const refFreqs = o.refFreqs || o.freqs;
  const rows = cur.gauges.map((d, i) => {
    const t = tensionKg(d, cur.wound[i], cur.material, o.freqs[i], o.scaleMm);
    const row = {
      gauge: d, wound: cur.wound[i], tension: t,
      sens: actionSensitivity(d, cur.wound[i], cur.material, o.freqs[i], o.scaleMm, o.action[i]),
    };
    if (ref) {
      const tr = tensionKg(ref.gauges[i], ref.wound[i], ref.material, refFreqs[i], o.scaleMm);
      // Saddle need of each, both at the same pitch, so only the strings differ.
      const sCur = setbackMm(d, cur.wound[i], cur.material, o.freqs[i], o.scaleMm, o.action[i]);
      const sRef = setbackMm(ref.gauges[i], ref.wound[i], ref.material, o.freqs[i], o.scaleMm, o.action[i]);
      Object.assign(row, { refGauge: ref.gauges[i], refTension: tr, dT: t / tr - 1, shift: (sCur - sRef) * centsPerMm(o.scaleMm) });
    }
    return row;
  });
  const total = rows.reduce((a, r) => a + r.tension, 0);
  const refTotal = ref ? rows.reduce((a, r) => a + r.refTension, 0) : null;
  return { rows, total, refTotal, dTotal: ref ? total / refTotal - 1 : null };
}

/**
 * Sets whose tension in the tuning played comes closest to the target tensions
 * (normally the design set in the tuning it was designed for), best first.
 * Sets with the same gauges and alloy are merged: `sets` lists them all, `set` is the first.
 * @returns {{set:object, sets:object[], rms:number, dTotal:number, tensions:number[]}[]}
 */
export function recommendSets(targetKg, o, { limit = 3, exclude } = {}) {
  const totalTarget = targetKg.reduce((a, b) => a + b, 0);
  const ranked = STRING_SETS
    .filter((s) => !exclude || s.id !== exclude)
    .map((s) => {
      const tensions = s.gauges.map((d, i) => tensionKg(d, s.wound[i], s.material, o.freqs[i], o.scaleMm));
      const rms = Math.sqrt(tensions.reduce((a, tk, i) => a + Math.log(tk / targetKg[i]) ** 2, 0) / 6);
      const dTotal = tensions.reduce((a, b) => a + b, 0) / totalTarget - 1;
      return { set: s, rms, dTotal, tensions };
    })
    .sort((a, b) => a.rms - b.rms || a.set.brand.localeCompare(b.set.brand));
  // Several brands sell the same gauges in the same alloy: list them as one choice.
  const groups = [];
  for (const r of ranked) {
    const key = `${r.set.material}:${r.set.gauges.join(',')}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.sets.push(r.set);
    else groups.push({ key, ...r, sets: [r.set] });
  }
  return groups.slice(0, limit).map(({ key, ...r }) => r);
}

/** Per-string gauges (rounded to 0.001") that give the target tensions. */
export function idealGauges(targetKg, wound, material, o) {
  return targetKg.map((tk, i) => Math.round(gaugeForTension(tk, wound[i], material, o.freqs[i], o.scaleMm) * 1000) / 1000);
}

/**
 * Plain strings' gauge from measured stiffness. For a plain steel string at a given
 * pitch and scale B ∝ d², so d = d_ref·√(B_meas / B_ref). Wound strings are left out:
 * their core size is not known well enough.
 */
export function estimatePlainGauge(Bmeas, freq, scaleMm) {
  if (!(Bmeas > 0)) return null;
  const dRef = 0.012;
  const Bref = stiffnessB(dRef, false, 'pb', freq, scaleMm);
  return dRef * Math.sqrt(Bmeas / Bref);
}

/** Catalog sets whose plain strings match estimated gauges, closest first. */
export function matchPlain(estimates) {
  const idx = estimates.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return [];
  return STRING_SETS
    .map((s) => ({ set: s, err: Math.sqrt(idx.reduce((a, i) => a + (s.gauges[i] - estimates[i]) ** 2, 0) / idx.length) }))
    .sort((a, b) => a.err - b.err);
}
