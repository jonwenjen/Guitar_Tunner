// "Strings" section of the Sweeten tab: which strings are on the guitar, which gauge
// it was set up for, their tension in the tuning played, what the gauge does to
// intonation, and which sets keep the tension the guitar was set up for.

import {
  STRING_SETS, BRANDS, MATERIALS, findSet, resolveSet, parseGauge, rangeLabel,
  compareSets, recommendSets, idealGauges, tensionKg, actionFor, estimatePlainGauge, matchPlain,
} from './strings.js';
import { parseNote, midiToFreq } from './music.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STANDARD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const W4 = [true, true, true, true, false, false];
/** Gauge as makers print it: 0.053 → ".053", 0.0095 → ".0095". */
export const inch = (d) => (Math.abs(d * 1000 - Math.round(d * 1000)) < 1e-6 ? d.toFixed(3) : d.toFixed(4)).replace(/^0/, '');

export const SETUP_DEFAULTS = {
  current: { kind: 'unknown' }, design: { kind: 'unknown' },
  actionBass: 2.4, actionTreble: 1.8, scaleMm: 648, unit: 'in',
};
export const getSetup = (S, key) => ({ ...SETUP_DEFAULTS, ...((S.stringSetups || {})[key] || {}) });
export function setSetup(S, key, patch) {
  S.stringSetups = { ...(S.stringSetups || {}), [key]: { ...getSetup(S, key), ...patch } };
}
export const selValue = (sel) => (!sel ? 'unknown' : sel.kind === 'catalog' ? sel.id : sel.kind);
export const selFromValue = (v, previous) => {
  if (v === 'unknown') return { kind: 'unknown' };
  if (v === 'custom') return previous && previous.kind === 'custom' ? previous : null;
  return findSet(v) ? { kind: 'catalog', id: v } : { kind: 'unknown' };
};
const sameStrings = (a, b) => !!a && !!b && a.material === b.material && a.gauges.every((g, i) => Math.abs(g - b.gauges[i]) < 1e-6);

/** Scale lengths of common acoustic guitars, mm → inches as written by the makers. */
export const STRING_SCALES = [[610, '24'], [628, '24.75'], [632, '24.9'], [635, '25'], [645, '25.4'], [648, '25.5'], [650, '25.6']];

/** A string choice read from storage or a file, made safe. */
export function sanitizeSel(sel) {
  if (!sel || typeof sel !== 'object') return { kind: 'unknown' };
  if (sel.kind === 'catalog' && typeof sel.id === 'string' && findSet(sel.id)) return { kind: 'catalog', id: sel.id };
  if (sel.kind === 'custom') {
    const r = resolveSet(sel);
    if (r) return { kind: 'custom', gauges: r.gauges.slice(), wound: r.wound.slice(), material: r.material };
  }
  return { kind: 'unknown' };
}
export function sanitizeSetup(x) {
  if (!x || typeof x !== 'object') return { ...SETUP_DEFAULTS };
  const num = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  return {
    current: sanitizeSel(x.current), design: sanitizeSel(x.design),
    actionBass: num(x.actionBass, 0.8, 5, 2.4), actionTreble: num(x.actionTreble, 0.8, 5, 1.8),
    scaleMm: num(x.scaleMm, 400, 1000, 648), unit: x.unit === 'mm' ? 'mm' : 'in',
  };
}

/** <option>s for a string picker: not sure, custom, then every set grouped by brand. */
export function setOptionsHtml(t, value, { custom = true, customLabel } = {}) {
  const groups = BRANDS.map((b) => `<optgroup label="${esc(b)}">${STRING_SETS.filter((s) => s.brand === b)
    .map((s) => `<option value="${s.id}"${s.id === value ? ' selected' : ''}>${esc(`${s.brand} ${s.line} ${s.name} (${rangeLabel(s.gauges)})`)}</option>`).join('')}</optgroup>`).join('');
  return `<option value="unknown"${value === 'unknown' ? ' selected' : ''}>${esc(t('str.unknown'))}</option>`
    + (custom ? `<option value="custom"${value === 'custom' ? ' selected' : ''}>${esc(customLabel || t('str.custom'))}</option>` : '')
    + groups;
}

function customEditorHtml(sel, which, unit, ctx) {
  const { t } = ctx;
  const g = sel.gauges;
  const fmtG = (d) => (unit === 'mm' ? String(Math.round(d * 25.4 * 1000) / 1000) : inch(d));
  const inputs = g.map((d, i) => `
    <label class="str-g">
      <span>${esc(ctx.stringShort(i))}</span>
      <input type="text" inputmode="decimal" data-g="${which}" data-i="${i}" value="${fmtG(d)}" aria-label="${esc(`${ctx.stringName(i)} (${unit === 'mm' ? 'mm' : 'in'})`)}">
      <span class="str-w"><input type="checkbox" data-w="${which}" data-i="${i}"${sel.wound[i] ? ' checked' : ''}> ${esc(t('str.wound'))}</span>
    </label>`).join('');
  const mats = Object.keys(MATERIALS).map((m) => `<option value="${m}"${m === sel.material ? ' selected' : ''}>${esc(t(`str.mat.${m}`))}</option>`).join('');
  return `
    <div class="row str-units">
      <span class="field-label">${esc(t('str.unit'))}</span>
      <div class="seg" role="radiogroup" aria-label="${esc(t('str.unit'))}">
        <button type="button" role="radio" data-unit="in" aria-checked="${unit !== 'mm'}">${esc(t('str.unitIn'))}</button>
        <button type="button" role="radio" data-unit="mm" aria-checked="${unit === 'mm'}">mm</button>
      </div>
      <label class="str-mat">${esc(t('str.material'))} <select data-mat="${which}">${mats}</select></label>
    </div>
    <div class="str-grid">${inputs}</div>
    <p class="note">${esc(t('str.customHint'))}</p>`;
}

/**
 * @param {object} ctx  S, t, fmt, fmtSigned, stringShort, stringName, noteLabel(note), tuningNotes(),
 *   tuningLabel(), a4(), guitars() → [{id, name}], setupKey() → 'default' or a guitar id,
 *   setKey(key), profile() (the measured guitar of setupKey, or null), persist(), listSep()
 */
export function renderStrings(ctx, { pickers = true } = {}) {
  const { S, t, fmt, fmtSigned } = ctx;
  const key = ctx.setupKey();
  const setup = getSetup(S, key);
  const prof = ctx.profile();
  const $ = (sel) => document.querySelector(sel);

  // Pickers are rebuilt only when a choice changes, so typing in the custom gauges
  // (and tabbing between them) keeps focus.
  if (pickers) {
    const guitars = ctx.guitars();
    $('#strForField').hidden = !guitars.length;
    $('#strForSel').innerHTML = [{ id: 'default', name: t('str.forDefault') }, ...guitars]
      .map((g) => `<option value="${esc(g.id)}"${g.id === key ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    for (const which of ['current', 'design']) {
      const el = $(which === 'current' ? '#strCur' : '#strDesign');
      el.innerHTML = setOptionsHtml(t, selValue(setup[which]));
      const box = $(which === 'current' ? '#strCurCustom' : '#strDesignCustom');
      const custom = resolveSet(setup[which]);
      box.hidden = !(setup[which] && setup[which].kind === 'custom' && custom);
      box.innerHTML = box.hidden ? '' : customEditorHtml(custom, which, setup.unit, ctx);
    }
    // Scale: the measured guitar's own, or a preset.
    $('#strScaleField').hidden = !!prof;
    const scales = STRING_SCALES.some(([mm]) => mm === setup.scaleMm) ? STRING_SCALES : [...STRING_SCALES, [setup.scaleMm, null]].sort((a, b) => a[0] - b[0]);
    $('#strScale').innerHTML = scales.map(([mm, written]) => {
      const i = written ? fmt(Number(written), (written.split('.')[1] || '').length) : fmt(mm / 25.4, 2);
      return `<option value="${mm}"${mm === setup.scaleMm ? ' selected' : ''}>${mm} mm (${i}″)</option>`;
    }).join('');
    $('#strActionBass').value = setup.actionBass;
    $('#strActionTreble').value = setup.actionTreble;
  }

  const scaleMm = prof ? prof.scaleMm : setup.scaleMm;
  const notes = ctx.tuningNotes();
  const freqs = notes.map((n) => midiToFreq(parseNote(n), ctx.a4()));
  const stdFreqs = STANDARD.map((n) => midiToFreq(parseNote(n), ctx.a4()));
  const standard = notes.every((n, i) => parseNote(n) === parseNote(STANDARD[i]));
  const action = [0, 1, 2, 3, 4, 5].map((i) => actionFor(i, setup.actionBass, setup.actionTreble));
  const cur = resolveSet(setup.current);
  const dsn = resolveSet(setup.design);
  const o = { freqs, refFreqs: stdFreqs, scaleMm, action };
  const pct = (v) => `${fmtSigned(v * 100, 1)} %`;
  const kg = (v) => `${fmt(v, 1)} kg`;
  const lines = [];

  // Tension table.
  let table = '';
  const cmp = cur ? compareSets(cur, dsn, o) : null;
  if (cmp) {
    const head = `<tr><th scope="col">${esc(t('str.col.string'))}</th><th scope="col">${esc(t('str.col.gauge'))}</th><th scope="col">${esc(t('str.col.tension'))}</th>${dsn ? `<th scope="col">${esc(t('str.col.design'))}</th><th scope="col">${esc(t('str.col.diff'))}</th>` : ''}</tr>`;
    const rows = cmp.rows.map((r, i) => {
      const warn = dsn && Math.abs(r.dT) > 0.1 ? ' class="is-warn"' : '';
      return `<tr><th scope="row">${esc(ctx.stringShort(i))} · ${esc(ctx.noteLabel(notes[i]))}</th><td>${inch(r.gauge)}</td><td>${kg(r.tension)}</td>${dsn ? `<td>${inch(r.refGauge)}</td><td${warn}>${pct(r.dT)}</td>` : ''}</tr>`;
    }).join('');
    const totalWarn = dsn && Math.abs(cmp.dTotal) > 0.08 ? ' class="is-warn"' : '';
    const foot = `<tr class="str-total"><th scope="row">${esc(t('str.total'))}</th><td></td><td>${kg(cmp.total)}</td>${dsn ? `<td>${kg(cmp.refTotal)}</td><td${totalWarn}>${pct(cmp.dTotal)}</td>` : ''}</tr>`;
    table = `<div class="table-wrap"><table class="fit-table str-table"><caption>${esc(t('str.tableCaption', { tuning: ctx.tuningLabel(), scale: scaleMm }))}</caption><thead>${head}</thead><tbody>${rows}${foot}</tbody></table></div>`;
    const bass = fmt(cmp.rows[0].sens, 1), treble = fmt(cmp.rows[5].sens, 1);
    if (dsn) {
      if (!standard) lines.push(t('str.tuningNote', { tuning: ctx.tuningLabel() }));
      const p = fmt(Math.abs(cmp.dTotal) * 100, 0);
      if (cmp.dTotal > 0.08) lines.push(t('str.heavier', { pct: p, bass, treble }));
      else if (cmp.dTotal < -0.08) lines.push(t('str.lighter', { pct: p, bass, treble }));
      else lines.push(t('str.closeTension', { pct: fmt(Math.max(1, Math.abs(cmp.dTotal) * 100), 0) }));
      // What the gauge itself does (only when the strings differ from the setup).
      const big = cmp.rows.map((r, i) => ({ i, s: r.shift })).filter((x) => Math.abs(x.s) >= 1);
      const maxShift = Math.max(...cmp.rows.map((r) => Math.abs(r.shift)));
      if (sameStrings(cur, dsn)) { /* the tuning alone changed the tension */ }
      else if (big.length) lines.push(t('str.directBig', { c: fmt(maxShift, 1), strings: big.map((x) => ctx.stringShort(x.i)).join(ctx.listSep()) }));
      else lines.push(t('str.directSmall', { c: fmt(maxShift, 1) }));
    } else {
      lines.push(t('str.sens', { bass, treble }));
    }
  } else {
    lines.push(t('str.pickCurrent'));
  }

  // Not sure what is on the guitar: the measured stiffness of the plain strings tells.
  if (!cur && prof && prof.strings) {
    const est = [0, 1, 2, 3, 4, 5].map((i) => {
      const st = prof.strings[i];
      const wound = W4[i];
      if (wound || !st || !(st.B > 0)) return null;
      return estimatePlainGauge(st.B, midiToFreq(parseNote(prof.notes[i]), ctx.a4()), prof.scaleMm);
    });
    const found = est.map((e, i) => (e ? { e, i } : null)).filter(Boolean);
    if (found.length && found.every((x) => x.e > 0.007 && x.e < 0.022)) {
      const best = matchPlain(est)[0];
      lines.push(t('str.estimate', {
        gauges: found.map((x) => `${ctx.stringShort(x.i)} ≈ ${inch(Math.round(x.e * 1000) / 1000)}`).join(ctx.listSep()),
        set: `${best.set.brand} ${best.set.line} ${best.set.name} (${rangeLabel(best.set.gauges)})`,
      }));
    }
  }

  // Measured guitar: is the 12th-fret error about the strings, or about the saddle?
  const measuredWith = prof ? resolveSet(prof.stringSet) : null;
  if (prof && prof.strings) {
    // In the tuning the guitar was measured in.
    const pf = prof.notes.map((n) => midiToFreq(parseNote(n), ctx.a4()));
    const po = { freqs: pf, refFreqs: pf, scaleMm, action };
    const maxShift = (a, b) => Math.max(...compareSets(a, b, po).rows.map((r) => Math.abs(r.shift)));
    const maxBeta = Math.max(0, ...prof.strings.filter((s) => s && s.model).map((s) => Math.abs(s.model.beta || 0)));
    const basis = measuredWith || cur;
    if (cur && measuredWith && !sameStrings(cur, measuredWith)) {
      lines.push(t('str.changedSince', {
        from: rangeLabel(measuredWith.gauges), to: rangeLabel(cur.gauges),
        c: fmt(maxShift(cur, measuredWith), 1), pct: pct(compareSets(cur, measuredWith, po).dTotal),
      }));
    }
    if (maxBeta >= 1.5 && basis) {
      if (dsn) {
        const g = maxShift(basis, dsn);
        lines.push(t(g < maxBeta * 0.5 ? 'str.diagSaddle' : 'str.diagGauge', { c: fmt(maxBeta, 1), g: fmt(g, 1) }));
      } else {
        const g = Math.max(...STRING_SETS.map((s) => maxShift(resolveSet({ kind: 'catalog', id: s.id }), basis)));
        lines.push(t('str.diagNoDesign', { c: fmt(maxBeta, 1), g: fmt(g, 1) }));
      }
    }
  }
  $('#strTable').innerHTML = table;
  $('#strSummary').innerHTML = lines.map((l) => `<p class="note">${esc(l)}</p>`).join('');

  // Suggestions: keep the tension the guitar was set up for (or the current strings'
  // tension in standard tuning), in the tuning played.
  const base = dsn || (!standard ? cur : null);
  let rec = '';
  if (base) {
    const target = base.gauges.map((d, i) => tensionKg(d, base.wound[i], base.material, stdFreqs[i], scaleMm));
    const recs = recommendSets(target, { freqs, scaleMm }, { limit: 3 });
    const items = recs.map((r) => {
      const head = `${rangeLabel(r.set.gauges)} · ${t(`str.mat.${r.set.material}`)}`;
      const brands = r.sets.map((x) => `${x.brand} ${x.line} ${x.name}`).join(' / ');
      const gauges = r.set.gauges.slice().reverse().map(inch).join(' ');
      const bits = [t('str.recTension', { pct: pct(r.dTotal) })];
      if (measuredWith) {
        const ch = compareSets(resolveSet({ kind: 'catalog', id: r.set.id }), measuredWith, { ...o, refFreqs: freqs });
        bits.push(t('str.recMeasured', { c: fmt(Math.max(...ch.rows.map((x) => Math.abs(x.shift))), 1) }));
      }
      if (cur && sameStrings(cur, r.set)) bits.push(t('str.inUse'));
      return `<li><b>${esc(head)}</b><span class="str-brands">${esc(brands)}</span><span>${esc(`${gauges} — ${bits.join(' · ')}`)}</span></li>`;
    }).join('');
    // Single strings only when no boxed set already has those gauges (an altered tuning).
    const ideal = idealGauges(target, base.wound, base.material, { freqs, scaleMm });
    const boxed = recs.some((r) => r.set.gauges.every((d, i) => Math.abs(d - ideal[i]) < 0.0005));
    rec = `<h3>${esc(t('str.recTitle'))}</h3>
      <p class="note">${esc(t(dsn ? 'str.recTarget' : 'str.recTargetCur', { set: dsn ? dsn.label : cur.label, tuning: ctx.tuningLabel() }))}</p>
      <ol class="str-recs">${items}</ol>
      ${boxed ? '' : `<p class="note">${esc(t('str.ideal', { gauges: ideal.map((d, i) => `${ctx.stringShort(i)} ${inch(d)}`).join(ctx.listSep()) }))}</p>`}`;
  }
  $('#strRec').innerHTML = rec;
}

/** Wire the section's controls once; `rerender(opts)` redraws it (see renderStrings). */
export function bindStrings(ctx, rerender) {
  const { S } = ctx;
  const $ = (sel) => document.querySelector(sel);
  const key = () => ctx.setupKey();
  const update = (patch, pickers = true) => { setSetup(S, key(), patch); ctx.persist(); rerender({ pickers }); };
  for (const [which, id] of [['current', '#strCur'], ['design', '#strDesign']]) {
    $(id).addEventListener('change', (e) => {
      const setup = getSetup(S, key());
      let sel = selFromValue(e.target.value, setup[which]);
      if (!sel) {
        // Start a custom set from whatever was chosen before (or a light set).
        const from = resolveSet(setup[which]) || resolveSet(setup.current) || findSet('dad-ej16');
        sel = { kind: 'custom', gauges: from.gauges.slice(), wound: (from.wound || W4).slice(), material: from.material || 'pb' };
      }
      update({ [which]: sel });
    });
  }
  $('#strForSel').addEventListener('change', (e) => { ctx.setKey(e.target.value); rerender({ pickers: true }); });
  const section = $('#stringsSection');
  section.addEventListener('change', (e) => {
    const el = e.target;
    const setup = getSetup(S, key());
    if (el.dataset.g) {
      const which = el.dataset.g;
      const v = parseGauge(el.value, setup.unit);
      const ok = v >= 0.006 && v <= 0.08;
      el.setAttribute('aria-invalid', String(!ok));
      if (!ok) return;
      const sel = { ...setup[which], gauges: setup[which].gauges.slice() };
      sel.gauges[Number(el.dataset.i)] = Math.round(v * 100000) / 100000;
      if (setup.unit !== 'mm') el.value = inch(sel.gauges[Number(el.dataset.i)]);
      update({ [which]: sel }, false);
    } else if (el.dataset.w) {
      const which = el.dataset.w;
      const sel = { ...setup[which], wound: setup[which].wound.slice() };
      sel.wound[Number(el.dataset.i)] = el.checked;
      update({ [which]: sel }, false);
    } else if (el.dataset.mat) {
      const which = el.dataset.mat;
      update({ [which]: { ...setup[which], material: el.value } }, false);
    } else if (el.id === 'strScale') {
      update({ scaleMm: Number(el.value) || 648 });
    } else if (el.id === 'strActionBass' || el.id === 'strActionTreble') {
      const v = Number(el.value);
      if (!(v >= 0.8 && v <= 5)) { el.setAttribute('aria-invalid', 'true'); return; }
      el.setAttribute('aria-invalid', 'false');
      update(el.id === 'strActionBass' ? { actionBass: v } : { actionTreble: v }, false);
    }
  });
  section.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]');
    if (b) update({ unit: b.dataset.unit });
  });
}
