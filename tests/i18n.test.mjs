import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../www/locales/en.js';
import zh from '../www/locales/zh-TW.js';
import ja from '../www/locales/ja.js';
import ko from '../www/locales/ko.js';
import es from '../www/locales/es.js';
import de from '../www/locales/de.js';
import {
  useLocale, t, tp, term, requiredContent, detectLanguage, noteName, noteLabel, intervalNames,
  tuningName, tuningAbout, sweetenerAbout, temperamentAbout, learnArticles, stringName, categoryName, fmt, LANGUAGES,
} from '../www/js/i18n.js';
import { TUNINGS } from '../www/js/tunings.js';
import { SWEETENERS } from '../www/js/sweeteners.js';
import { TEMPERAMENTS } from '../www/js/temperaments.js';
import { parseNote } from '../www/js/music.js';

const LOCALES = { 'zh-TW': zh, ja, ko, es, de };
const MODES = ['translate', 'original', 'both'];
const need = requiredContent();
const vars = (s) => [...String(s).matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort();
const tokens = (s) => [...String(s).matchAll(/\{\{([\w:#-]+)\}\}/g)].map((m) => m[1]);

function allStrings(L) {
  const out = [...Object.values(L.ui), ...Object.values(L.categories || {})];
  for (const x of Object.values(L.tunings || {})) out.push(x.name, x.about);
  for (const x of Object.values(L.sweeteners || {})) out.push(x.name, x.about);
  for (const x of Object.values(L.temperaments || {})) out.push(x.name, x.about);
  for (const a of Object.values(L.learn?.articles || {})) out.push(a.title, ...a.body);
  return out;
}

test('language list matches the locale files', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', ...Object.keys(LOCALES)]);
});

for (const [code, L] of Object.entries(LOCALES)) {
  test(`${code}: every string, term and content item is translated`, () => {
    assert.equal(L.meta.code, code);
    for (const k of need.ui) {
      const plural = k.startsWith('instr.togo.');
      if (plural) continue; // plural forms differ per language; checked below
      assert.ok(typeof L.ui[k] === 'string' && L.ui[k].length, `${code} ui.${k}`);
    }
    assert.ok(L.ui['instr.togo.other'], `${code} instr.togo.other`);
    for (const k of need.terms) assert.ok(L.terms[k], `${code} terms.${k}`);
    for (let i = 0; i <= 12; i++) assert.ok(L.intervals[i], `${code} intervals.${i}`);
    for (const k of need.categories) assert.ok(L.categories[k], `${code} categories.${k}`);
    for (const k of need.tunings) assert.ok(L.tunings[k]?.name && L.tunings[k]?.about, `${code} tunings.${k}`);
    for (const k of need.sweeteners) assert.ok(L.sweeteners[k]?.name && L.sweeteners[k]?.about, `${code} sweeteners.${k}`);
    for (const k of need.temperaments) assert.ok(L.temperaments[k]?.name && L.temperaments[k]?.about, `${code} temperaments.${k}`);
    for (const a of need.articles) {
      const loc = L.learn.articles[a.id];
      assert.ok(loc?.title, `${code} learn.${a.id}.title`);
      assert.equal(loc.body.length, a.paragraphs, `${code} learn.${a.id} paragraph count`);
    }
  });

  test(`${code}: placeholders and markup match English`, () => {
    for (const [k, s] of Object.entries(L.ui)) {
      const base = en.ui[k] ?? en.ui[k.replace(/\.one$|\.other$/, '.other')];
      assert.ok(base !== undefined, `${code} has unknown key ${k}`);
      // String names may use the number {n} instead of the English ordinal {ord}.
      const norm = (list) => [...new Set(list.map((v) => (k.startsWith('string.') && v === 'ord' ? 'n' : v)))];
      assert.deepEqual(norm(vars(s)), norm(vars(base)), `${code} ui.${k} placeholders`);
      assert.equal(s.includes('<span class="dir">'), base.includes('<span class="dir">'), `${code} ui.${k} markup`);
    }
  });

  test(`${code}: every {{term}} token resolves in all three modes`, () => {
    for (const s of allStrings(L)) {
      for (const tok of tokens(s)) {
        if (tok.startsWith('tuning:')) assert.ok(TUNINGS.some((x) => x.id === tok.slice(7)), `${code} unknown tuning token ${tok}`);
        else if (tok.startsWith('note:')) assert.match(tok.slice(5), /^[A-G][#b]?$/, `${code} bad note token ${tok}`);
        else assert.ok(en.terms[tok] && L.terms[tok], `${code} unknown term token ${tok}`);
      }
    }
    for (const mode of MODES) {
      useLocale(L, mode);
      const rendered = [
        ...Object.keys(L.ui).map((k) => t(k, { n: 2, string: stringName(1), note: 'A2', name: 'X', list: '0', tuning: 'X', notes: 'E A D G B E', offsets: '0', key: 'C', row: 'X', hz: '440', ord: '5th' })),
        ...TUNINGS.map((x) => tuningName(x).text + tuningAbout(x)),
        ...SWEETENERS.map((x) => sweetenerAbout(x)),
        ...TEMPERAMENTS.map((x) => temperamentAbout(x)),
        ...learnArticles().flatMap((a) => [a.title, ...a.body]),
        ...need.categories.map(categoryName),
      ];
      for (const r of rendered) {
        assert.ok(!/\{\{|\}\}/.test(r), `${code}/${mode}: unresolved token in “${r.slice(0, 80)}”`);
        assert.ok(!/\{\w+\}/.test(r), `${code}/${mode}: unfilled placeholder in “${r.slice(0, 80)}”`);
      }
    }
    useLocale(en);
  });
}

test('term modes: translate, original and both', () => {
  useLocale(zh, 'translate');
  assert.equal(term('capo'), '移調夾');
  assert.equal(tuningName('drop-d').text, 'Drop D 調弦');
  useLocale(zh, 'original');
  assert.equal(term('capo'), 'capo');
  assert.equal(tuningName('drop-d').text, 'Drop D');
  assert.equal(t('capo.n', { n: 2 }), 'Capo 第 2 格'); // capitalised at the start, spaced from Han text
  useLocale(zh, 'both');
  assert.equal(term('capo'), '移調夾（capo）');
  const both = tuningName('open-g');
  assert.equal(both.primary, '開放 G 調（Spanish／Taropatch）');
  assert.equal(both.secondary, 'Open G (Spanish / Taropatch)');
  useLocale(de, 'original');
  assert.equal(term('capo'), 'Capo'); // German capitalises nouns, even English ones
  useLocale(en);
});

test('note naming follows the language unless terms are kept original', () => {
  const std = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'].map(parseNote);
  useLocale(es, 'translate');
  assert.equal(std.map((m) => noteName(m)).join(' '), 'Mi La Re Sol Si Mi');
  assert.equal(noteLabel(parseNote('Bb3'), true), 'Si♭3');
  useLocale(de, 'translate');
  assert.equal(std.map((m) => noteName(m)).join(' '), 'E A D G H E');
  assert.equal(noteName(parseNote('Bb3'), true), 'B');
  assert.equal(noteName(parseNote('F#3')), 'Fis');
  assert.equal(term('note:Bb'), 'B');
  useLocale(de, 'original');
  assert.equal(std.map((m) => noteName(m)).join(' '), 'E A D G B E');
  useLocale(ja, 'translate');
  assert.equal(intervalNames(std).join(' '), '完全4度 完全4度 完全4度 長3度 完全4度');
  useLocale(ja, 'original');
  assert.equal(intervalNames(std).join(' '), 'P4 P4 P4 M3 P4');
  useLocale(en);
});

test('plurals, ordinals and number formats', () => {
  useLocale(en);
  assert.equal(tp('instr.togo', 1), ' — about 1 semitone to go.');
  assert.equal(tp('instr.togo', 3), ' — about 3 semitones to go.');
  assert.equal(stringName(0), '6th string');
  useLocale(de);
  assert.equal(tp('instr.togo', 1), ' – noch etwa 1 Halbton.');
  assert.equal(fmt(440.5, 1), '440,5');
  assert.equal(stringName(5), '1. Saite');
  useLocale(ko);
  assert.equal(stringName(1), '5번 줄');
  useLocale(en);
});

test('browser language detection', () => {
  assert.equal(detectLanguage(['zh-TW']), 'zh-TW');
  assert.equal(detectLanguage(['zh-Hant-HK']), 'zh-TW');
  assert.equal(detectLanguage(['zh-CN', 'ja-JP']), 'ja');
  assert.equal(detectLanguage(['de-AT']), 'de');
  assert.equal(detectLanguage(['es-419']), 'es');
  assert.equal(detectLanguage(['ko']), 'ko');
  assert.equal(detectLanguage(['fr-FR']), 'en');
  assert.equal(detectLanguage([]), 'en');
});
