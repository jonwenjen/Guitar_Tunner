// Interface language and "special terms" handling.
//
// Six languages. English lives in locales/en.js plus the data modules; the other
// five are loaded on demand. The term mode controls specialised vocabulary:
//   'translate' – tuning/temperament names, technical terms, note and interval
//                 names follow the language's own conventions (Do Re Mi in Spanish,
//                 H for B in German, 純四度 in Chinese…)
//   'original'  – keep the English/international form (Drop D, capo, E A D G B E, P4)
//   'both'      – translated form followed by the original, e.g. 移調夾（Capo）

import en from '../locales/en.js';
import { TUNINGS, CATEGORIES } from './tunings.js';
import { SWEETENERS } from './sweeteners.js';
import { TEMPERAMENTS } from './temperaments.js';
import { ARTICLES } from './learn.js';
import { pitchClass, octaveOf, SHARP_NAMES, FLAT_NAMES } from './music.js';

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
];
export const TERM_MODES = ['translate', 'original', 'both'];

const LOADERS = {
  'zh-TW': () => import('../locales/zh-TW.js'),
  ja: () => import('../locales/ja.js'),
  ko: () => import('../locales/ko.js'),
  es: () => import('../locales/es.js'),
  de: () => import('../locales/de.js'),
};

let L = en;
let mode = 'translate';
let plural = new Intl.PluralRules('en');
const numberFormats = new Map();

/** Load a language. Unknown codes fall back to English. */
export async function setLanguage(code, termMode = 'translate') {
  mode = TERM_MODES.includes(termMode) ? termMode : 'translate';
  if (code === 'en' || !LOADERS[code]) L = en;
  else {
    try { L = (await LOADERS[code]()).default; } catch { L = en; }
  }
  plural = new Intl.PluralRules(L.meta.numberLocale);
  numberFormats.clear();
  return L.meta.code;
}

/** For tests and tools: use an already-imported locale object synchronously. */
export function useLocale(locale, termMode = 'translate') {
  L = locale || en;
  mode = termMode;
  plural = new Intl.PluralRules(L.meta.numberLocale);
  numberFormats.clear();
}

export const currentLanguage = () => L.meta.code;
export const listSep = () => L.meta.listSep || ', ';
export const termMode = () => mode;
export const htmlLang = () => L.meta.htmlLang;
const isEnglish = () => L === en;

/** Best match for the browser's preferred languages. */
export function detectLanguage(list = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []) {
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase();
    if (tag.startsWith('zh')) {
      // Traditional Chinese is the only Chinese variant offered; use it for zh-TW/HK/MO/Hant.
      if (/hant|tw|hk|mo/.test(tag)) return 'zh-TW';
      continue;
    }
    const base = tag.split('-')[0];
    if (['en', 'ja', 'ko', 'es', 'de'].includes(base)) return base;
  }
  return 'en';
}

// ── Strings ────────────────────────────────────────────────────────────

const capitalize = (s) => s.charAt(0).toLocaleUpperCase(L.meta.numberLocale) + s.slice(1);
const CJK = '\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const SPACE_BEFORE = new RegExp(`([${CJK}])([A-Za-z0-9])`, 'g');
const SPACE_AFTER = new RegExp(`([A-Za-z0-9%])([${CJK}])`, 'g');

function fill(str, vars) {
  let out = String(str).replace(/\{\{([\w:#-]+)\}\}/g, (_, k, offset, whole) => {
    const value = term(k);
    // A term that opens a sentence gets a capital letter (Latin scripts only).
    const before = whole.slice(0, offset);
    return before === '' || /[.!?:]\s+$/.test(before) || /[¿¡«„“]$/.test(before) ? capitalize(value) : value;
  });
  out = out.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? String(vars[k]) : m));
  // Traditional Chinese typesetting: a space between Han characters and Latin letters or digits.
  if (L.meta.autoSpace) out = out.replace(SPACE_BEFORE, '$1 $2').replace(SPACE_AFTER, '$1 $2');
  return out;
}

/** Translate a UI key. */
export function t(key, vars) {
  const s = L.ui[key] ?? en.ui[key] ?? key;
  return fill(s, vars);
}

/** Pick the plural form of a key: key.one / key.other. */
export function tp(key, n, vars = {}) {
  const form = plural.select(n);
  const k = L.ui[`${key}.${form}`] !== undefined ? `${key}.${form}` : `${key}.other`;
  return t(k, { n, ...vars });
}

/** Combine a translated and an original form according to the term mode. */
function pair(local, original) {
  if (L.meta.capitalizeTerms) original = original.split(' ').map(capitalize).join(' '); // German capitalises nouns
  if (local === undefined || local === null || isEnglish()) return original;
  if (mode === 'original') return original;
  if (mode === 'both' && local !== original && !String(local).includes(original)) {
    return `${local}${L.meta.open}${original}${L.meta.close}`;
  }
  return local;
}

/** A glossary term, `tuning:<id>` for a tuning's name, or `note:<letter>` (e.g. note:Bb, note:F#) for a note name. */
export function term(key) {
  if (key.startsWith('tuning:')) return tuningName(key.slice(7), { short: true }).text;
  if (key.startsWith('note:')) {
    const m = /^([A-G])([#b]?)$/.exec(key.slice(5));
    if (!m) return key.slice(5);
    const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 })[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return noteName(60 + pc, m[2] === 'b');
  }
  return pair(L.terms[key], en.terms[key] ?? key);
}

// ── Notes, intervals, numbers ──────────────────────────────────────────

const SOLFEGE_SHARP = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const SOLFEGE_FLAT = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const GERMAN_SHARP = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'];
const GERMAN_FLAT = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'];

/** Which note-naming system is in effect: letters, solfege or german. */
export function noteNaming() {
  if (mode === 'original') return 'letters';
  return L.meta.noteNaming || 'letters';
}

/** Note name without octave, in the current naming system. */
export function noteName(midi, flats = false) {
  const pc = pitchClass(midi);
  switch (noteNaming()) {
    case 'solfege': return (flats ? SOLFEGE_FLAT : SOLFEGE_SHARP)[pc];
    case 'german': return (flats ? GERMAN_FLAT : GERMAN_SHARP)[pc];
    default: return (flats ? FLAT_NAMES : SHARP_NAMES)[pc];
  }
}

export function noteLabel(midi, flats = false) {
  return noteName(midi, flats) + octaveOf(midi);
}

/** Interval names between adjacent strings, low to high. */
export function intervalNames(midis) {
  const table = mode === 'original' || !L.intervals ? en.intervals : L.intervals;
  const out = [];
  for (let i = 1; i < midis.length; i++) {
    const d = midis[i] - midis[i - 1];
    const name = table[Math.abs(d)] ?? en.intervals[Math.abs(d)] ?? String(Math.abs(d));
    out.push(d < 0 ? `↓${name}` : name);
  }
  return out;
}

/** Locale-aware number with a fixed number of decimals. */
export function fmt(value, digits = 1) {
  const key = digits;
  if (!numberFormats.has(key)) {
    numberFormats.set(key, new Intl.NumberFormat(L.meta.numberLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
  }
  return numberFormats.get(key).format(value);
}

/** Signed value with a real minus sign, e.g. +3.2 / −0.4 / ±0.0. */
export function fmtSigned(value, digits = 1) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±';
  return sign + fmt(Math.abs(value), digits);
}

/** "5th string" / "第 5 弦" for a string index (0 = 6th string). */
export function stringName(index) {
  const n = 6 - index;
  return t('string.name', { n, ord: en.ordinals[n] });
}
export function stringShort(index) {
  const n = 6 - index;
  return t('string.short', { n, ord: en.ordinals[n] });
}

// ── Data content ───────────────────────────────────────────────────────

/** Drop a trailing parenthetical: "Open G (Spanish / Taropatch)" → "Open G". */
const shortName = (name) => name.replace(/\s*[(（][^()（）]*[)）]\s*$/, '');

/**
 * Tuning name: {text} for one-line use, plus {primary, secondary} for two-line layouts.
 * `short` drops parenthetical aliases, for names inside running text.
 */
export function tuningName(idOrTuning, { short = false } = {}) {
  const tuning = typeof idOrTuning === 'string' ? TUNINGS.find((x) => x.id === idOrTuning) : idOrTuning;
  if (!tuning) return { text: String(idOrTuning), primary: String(idOrTuning), secondary: '' };
  const shorten = (n) => (short ? shortName(n) : n);
  const original = shorten(tuning.name);
  const localRaw = L.tunings?.[tuning.id]?.name;
  const local = localRaw ? shorten(localRaw) : null;
  if (!local || isEnglish() || mode === 'original') return { text: original, primary: original, secondary: '' };
  if (mode === 'both' && local !== original) {
    // One-line form keeps the translated name whole and adds the short English name.
    const brief = shortName(original);
    const text = local.includes(brief) ? local : `${local}${L.meta.open}${brief}${L.meta.close}`;
    return { text, primary: local, secondary: original };
  }
  return { text: local, primary: local, secondary: '' };
}

export function tuningAbout(tuning) {
  const local = L.tunings?.[tuning.id]?.about;
  return local ? fill(local) : tuning.about;
}

export function categoryName(id) {
  const original = CATEGORIES.find((c) => c.id === id)?.name ?? (id === 'yours' ? en.ui['tunings.yours'] : id);
  if (id === 'yours') return t('tunings.yours');
  return L.categories?.[id] ? fill(L.categories[id]) : original;
}

function namedItem(table, item) {
  const original = item.name;
  const local = table?.[item.id]?.name;
  if (!local || isEnglish() || mode === 'original') return { text: original, primary: original, secondary: '' };
  if (mode === 'both' && local !== original) return { text: pair(local, original), primary: local, secondary: original };
  return { text: local, primary: local, secondary: '' };
}

export const sweetenerName = (s) => namedItem(L.sweeteners, s);
export const sweetenerAbout = (s) => (L.sweeteners?.[s.id]?.about ? fill(L.sweeteners[s.id].about) : s.about);
export const temperamentName = (x) => namedItem(L.temperaments, x);
export const temperamentAbout = (x) => (L.temperaments?.[x.id]?.about ? fill(L.temperaments[x.id].about) : x.about);

/** Learn tab content in the current language. */
export function learnArticles() {
  return ARTICLES.map((a) => {
    const loc = L.learn?.articles?.[a.id];
    return loc
      ? { id: a.id, title: fill(loc.title), body: loc.body.map((p) => fill(p)) }
      : a;
  });
}

/** Everything a locale must provide, for the completeness test. */
export function requiredContent() {
  return {
    ui: Object.keys(en.ui),
    terms: Object.keys(en.terms),
    tunings: TUNINGS.map((x) => x.id),
    categories: CATEGORIES.map((c) => c.id),
    sweeteners: SWEETENERS.map((s) => s.id),
    temperaments: TEMPERAMENTS.map((x) => x.id),
    articles: ARTICLES.map((a) => ({ id: a.id, paragraphs: a.body.length })),
  };
}

export { en as englishLocale };
