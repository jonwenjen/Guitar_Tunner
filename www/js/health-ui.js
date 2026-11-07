// "Check-up" tab: pick the guitar (built-in model or your own), work through a
// luthier's checklist, and read the findings in the order a setup is done in.

import {
  MODELS, findModel, specFor, evaluate, SPEC_FIELDS, SPEC_OPTIONS, INPUT_OPTIONS, BUZZ, STYLES, cleanInputs, isNum,
} from './health.js';
import { REFERENCES } from './references.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEVELS = ['luthier', 'tech', 'diy', 'watch', 'ok'];

/** The checklist: what a luthier asks for, grouped the way it is measured. */
const GROUPS = [
  { id: 'env', fields: [{ k: 'rh', type: 'num', unit: '%', step: 1, min: 5, max: 100 }, { k: 'stringsAge', type: 'sel' }] },
  { id: 'neck', fields: [{ k: 'relief', type: 'num', unit: 'mm', step: 0.01, min: 0, max: 2 }, { k: 'rod', type: 'sel' }] },
  { id: 'action', fields: [
    { k: 'actionBass', type: 'num', unit: 'mm', step: 0.1, min: 0.5, max: 8 }, { k: 'actionTreble', type: 'num', unit: 'mm', step: 0.1, min: 0.5, max: 8 },
    { k: 'nutBass', type: 'num', unit: 'mm', step: 0.05, min: 0, max: 3 }, { k: 'nutTreble', type: 'num', unit: 'mm', step: 0.05, min: 0, max: 3 },
  ] },
  { id: 'bridge', fields: [
    { k: 'saddleBass', type: 'num', unit: 'mm', step: 0.1, min: 0, max: 10 }, { k: 'saddleTreble', type: 'num', unit: 'mm', step: 0.1, min: 0, max: 10 },
    { k: 'straight', type: 'sel' }, { k: 'bridge', type: 'sel' },
  ] },
  { id: 'body', fields: [{ k: 'belly', type: 'sel' }, { k: 'sunken', type: 'sel' }, { k: 'fretWear', type: 'sel' }, { k: 'fretEnds', type: 'sel' }, { k: 'cracks', type: 'sel' }] },
  { id: 'symptoms', fields: [{ k: 'buzz', type: 'buzz' }, { k: 'nutBind', type: 'sel' }] },
];

export const modelLabel = (m) => `${m.brand} ${m.name}`;
const today = () => new Date().toISOString().slice(0, 10);

/** A check read from storage or a file, made safe. */
export function cleanCheck(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
  const spec = {};
  if (c.spec && typeof c.spec === 'object') {
    for (const f of SPEC_FIELDS) {
      const v = c.spec[f];
      if (SPEC_OPTIONS[f] ? SPEC_OPTIONS[f].includes(v) : (isNum(v) && v > 0 && v < 2000)) spec[f] = v;
    }
  }
  return {
    id: c.id.slice(0, 40), name: typeof c.name === 'string' ? c.name.slice(0, 40) : '',
    model: findModel(c.model) ? c.model : 'custom', spec, style: STYLES[c.style] ? c.style : 'standard',
    inputs: cleanInputs(c.inputs), profileId: typeof c.profileId === 'string' ? c.profileId : null,
    updated: typeof c.updated === 'string' ? c.updated.slice(0, 10) : today(),
  };
}

export function newCheck(model, ctx) {
  const m = findModel(model);
  const n = ctx.S.checks.length + 1;
  return {
    id: `c${Date.now().toString(36)}`, name: m ? modelLabel(m) : ctx.t('hc.customName', { n }),
    model: m ? model : 'custom', spec: {}, style: 'standard', inputs: {}, profileId: ctx.S.guitarId || null, updated: today(),
  };
}

/**
 * @param {object} ctx  S, t, fmt, fmtSigned, stringShort, listSep, persist(), guitars() → measured profiles,
 *   stringsFor(profileId) → { current, design, dTotal, label } | null, a4(), goStrings(), goMeasure()
 */
export function renderCheck(ctx) {
  const { S, t } = ctx;
  const host = document.getElementById('checkPage');
  const cur = S.checks.find((c) => c.id === S.checkId) || S.checks[0] || null;
  if (cur) S.checkId = cur.id;
  const pick = MODELS.map((m) => `<button type="button" class="btn" data-new="${m.id}">${esc(modelLabel(m))}</button>`).join('')
    + `<button type="button" class="btn btn-quiet" data-new="custom">${esc(t('hc.custom'))}</button>`;
  let html = `<h1>${esc(t('hc.title'))}</h1><p class="lede">${esc(t('hc.lede'))}</p>`;
  if (!cur) {
    host.innerHTML = `${html}<h2>${esc(t('hc.start'))}</h2><div class="row hc-pick">${pick}</div><p class="note">${esc(t('hc.tools'))}</p>`;
    return;
  }
  const spec = specFor(cur);
  const sel = (name, value, opts, label, attrs = '') => `<select ${attrs} data-${name} aria-label="${esc(label)}">${opts.map((o) => `<option value="${esc(o.v)}"${String(o.v) === String(value) ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;

  // Where the findings stand, with a shortcut to them below the checklist.
  html += `<p class="hc-jump"><span class="hc-verdict" id="hcVerdictTop"></span><button type="button" class="btn btn-quiet btn-small" id="hcJump">${esc(t('hc.jump'))}</button></p>`;

  // Guitar.
  html += `<div class="field"><label for="hcCheck">${esc(t('hc.guitar'))}</label>
    <div class="row"><select id="hcCheck">${S.checks.map((c) => `<option value="${esc(c.id)}"${c.id === cur.id ? ' selected' : ''}>${esc(c.name || modelLabel(specFor(c)))}</option>`).join('')}</select>
    <button type="button" class="btn btn-quiet" id="hcAdd">${esc(t('hc.add'))}</button>
    <button type="button" class="btn btn-quiet" id="hcDelete">${esc(t('hc.delete'))}</button></div>
    <div class="row hc-pick" id="hcNewRow" hidden>${pick}</div></div>
    <div class="field"><label for="hcName">${esc(t('hc.name'))}</label><input type="text" id="hcName" maxlength="40" value="${esc(cur.name)}"></div>`;

  // Model and spec.
  const modelOpts = [...MODELS.map((m) => ({ v: m.id, l: modelLabel(m) })), { v: 'custom', l: t('hc.custom') }];
  const specRows = SPEC_FIELDS.map((f) => {
    const guess = spec.guessed.includes(f) ? ' *' : '';
    const label = `${t(`hc.spec.${f}`)}${guess}`;
    const ctl = SPEC_OPTIONS[f]
      ? sel('spec', spec[f], SPEC_OPTIONS[f].map((o) => ({ v: o, l: t(`hc.${f}.${o}`) })), label, `data-f="${f}"`)
      : `<input type="number" inputmode="decimal" data-spec data-f="${f}" value="${spec[f]}" min="${f === 'scaleMm' ? 400 : 30}" max="${f === 'scaleMm' ? 1000 : 70}" step="${f === 'scaleMm' ? 1 : 0.5}" aria-label="${esc(label)}">`;
    return `<label class="hc-spec"><span>${esc(label)}${f === 'scaleMm' || f === 'nutMm' ? ' (mm)' : ''}</span>${ctl}</label>`;
  }).join('');
  const refs = (spec.refs || []).map((id) => REFERENCES[id]).filter(Boolean);
  html += `<h2>${esc(t('hc.specTitle'))}</h2>
    <div class="field"><label for="hcModel">${esc(t('hc.model'))}</label>${sel('model', cur.model, modelOpts, t('hc.model'), 'id="hcModel"')}</div>
    ${spec.woods ? `<p class="note">${esc(t(`hc.woods.${cur.model}`))}</p>` : ''}
    <div class="hc-specs">${specRows}</div>
    ${spec.guessed.length ? `<p class="note">${esc(t(cur.model === 'truetone-gc8css' ? 'hc.guessedAll' : 'hc.guessed'))}</p>` : ''}
    ${refs.length ? `<p class="note hc-src">${esc(t('hc.sources'))} ${refs.map((r) => `<a href="${r.url}" target="_blank" rel="noopener" lang="en">${esc(r.cite.split(/[.:]/)[0])}</a>`).join(' · ')}</p>` : ''}
    <div class="field"><span class="field-label">${esc(t('hc.style'))}</span>
      <div class="seg" role="radiogroup" aria-label="${esc(t('hc.style'))}">${Object.keys(STYLES).map((k) => `<button type="button" role="radio" data-style="${k}" aria-checked="${k === cur.style}">${esc(t(`hc.style.${k}`))}</button>`).join('')}</div>
      <p class="note">${esc(t('hc.styleNote', { bass: `${ctx.fmt(STYLES[cur.style].bass[0], 1)}–${ctx.fmt(STYLES[cur.style].bass[1], 1)}`, treble: `${ctx.fmt(STYLES[cur.style].treble[0], 1)}–${ctx.fmt(STYLES[cur.style].treble[1], 1)}`, relief: `${ctx.fmt(STYLES[cur.style].relief[0], 2)}–${ctx.fmt(STYLES[cur.style].relief[1], 2)}` }))}</p></div>`;

  // Measurement and strings.
  const profs = ctx.guitars();
  html += `<h2>${esc(t('hc.dataTitle'))}</h2>
    <div class="field"><label for="hcProfile">${esc(t('hc.profile'))}</label>
      ${sel('profile', cur.profileId || '', [{ v: '', l: t('hc.profileNone') }, ...profs.map((g) => ({ v: g.id, l: `${g.name} (${g.created})` }))], t('hc.profile'), 'id="hcProfile"')}
      <p class="note">${esc(t(profs.length ? 'hc.profileHint' : 'hc.profileEmpty'))} <button type="button" class="btn btn-quiet btn-small" id="hcMeasure">${esc(t('fit.measure'))}</button></p></div>
    <p class="note" id="hcStrings"></p>`;

  // Checklist.
  html += `<h2>${esc(t('hc.listTitle'))}</h2><p class="note">${esc(t('hc.tools'))}</p>`;
  for (const g of GROUPS) {
    const fields = g.fields.map((f) => {
      const v = cur.inputs[f.k];
      const label = t(`hc.in.${f.k}`);
      if (f.type === 'num') {
        return `<label class="hc-in"><span>${esc(label)}</span><span class="hc-num"><input type="number" inputmode="decimal" data-in="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${isNum(v) ? v : ''}" placeholder="—"><span class="unit">${f.unit}</span></span></label>`;
      }
      if (f.type === 'sel') {
        return `<label class="hc-in"><span>${esc(label)}</span>${sel('in', v || 'unknown', INPUT_OPTIONS[f.k].map((o) => ({ v: o, l: t(`hc.opt.${f.k}.${o}`) })), label, `data-k="${f.k}"`)}</label>`;
      }
      return `<fieldset class="hc-buzz"><legend>${esc(label)}</legend>${BUZZ.map((b) => `<label><input type="checkbox" data-buzz="${b}"${(v || []).includes(b) ? ' checked' : ''}> ${esc(t(`hc.buzz.${b}`))}</label>`).join('')}</fieldset>`;
    }).join('');
    html += `<fieldset class="hc-group"><legend>${esc(t(`hc.g.${g.id}`))}</legend><p class="note">${esc(t(`hc.h.${g.id}`))}</p><div class="hc-fields">${fields}</div></fieldset>`;
  }

  // Results.
  html += `<h2 id="hcResultsTitle">${esc(t('hc.resultsTitle'))}</h2><div id="hcSummary" class="hc-summary" aria-live="polite"></div><ol id="hcResults" class="hc-results"></ol>
    <p class="note">${esc(t('hc.order'))}</p><p class="note">${esc(t('hc.disclaimer'))}</p>`;
  host.innerHTML = html;
  renderResults(ctx);
}

/** Findings only: called on every input so the form keeps focus. */
export function renderResults(ctx) {
  const { S, t, fmt, fmtSigned, stringShort, listSep } = ctx;
  const cur = S.checks.find((c) => c.id === S.checkId);
  if (!cur) return;
  const prof = ctx.guitars().find((g) => g.id === cur.profileId) || null;
  const strings = ctx.stringsFor(cur.profileId);
  const res = evaluate(cur, { profile: prof, strings, a4: ctx.a4() });
  const sep = listSep();
  const fmtParam = (f, k, v) => {
    if (v === null || v === undefined) return '—';
    if (k === 'side') return t(`hc.side.${v}`);
    if (k === 'rod') return t(`hc.rodAt.${v}`);
    if (k === 'joint') return t(`hc.jointNote.${v}`);
    if (k === 'dir') return t(`hc.dir.${v}`);
    if (k === 'signs') return v.map((s) => t(`hc.sign.${s}`)).join(sep);
    if (k === 'items') return v.map((s) => t(`hc.miss.${s}`)).join(sep);
    if (k === 'strings') return v.map((i) => stringShort(i)).join(sep);
    if (k === 'list' && f.key === 'nutSharp') return v.map((x) => `${stringShort(x.i)} ${fmtSigned(x.c, 1)} ¢`).join(sep);
    if (k === 'list') return v.map((x) => `${stringShort(x.i)} ${fmtSigned(x.c, 1)} ¢ → ${fmtSigned(x.mm, 1)} mm`).join(sep);
    if (typeof v === 'number') return fmt(v, f.digits[k] ?? 1);
    return String(v);
  };
  const items = res.findings.map((f) => {
    const p = Object.fromEntries(Object.entries(f.params).map(([k, v]) => [k, fmtParam(f, k, v)]));
    return `<li class="hc-f is-${f.level}"><span class="hc-chip">${esc(t(`hc.level.${f.level}`))}</span><b>${esc(t(`hc.area.${f.area}`))}</b><span class="hc-text">${esc(t(`hc.f.${f.key}`, p))}</span></li>`;
  }).join('');
  document.getElementById('hcResults').innerHTML = items;
  const counts = LEVELS.filter((l) => res.counts[l]).map((l) => `<span class="hc-count is-${l}">${esc(t(`hc.level.${l}`))} ${res.counts[l]}</span>`).join('');
  const worst = LEVELS.find((l) => res.counts[l] && l !== 'ok') || (res.counts.ok ? 'ok' : 'need');
  document.getElementById('hcSummary').innerHTML = `<p class="hc-verdict is-${worst}">${esc(t(`hc.verdict.${worst}`))}</p><div class="row">${counts}</div>`;
  const top = document.getElementById('hcVerdictTop');
  top.className = `hc-verdict is-${worst}`;
  top.textContent = t(`hc.verdict.${worst}`);
  const sl = document.getElementById('hcStrings');
  if (sl) {
    sl.textContent = strings && strings.label
      ? t(isNum(strings.dTotal) ? 'hc.stringsDiff' : 'hc.stringsOnly', { set: strings.label, pct: isNum(strings.dTotal) ? fmtSigned(strings.dTotal * 100, 0) : '' })
      : t('hc.stringsNone');
  }
}

export function bindCheck(ctx) {
  const { S } = ctx;
  const host = document.getElementById('checkPage');
  const cur = () => S.checks.find((c) => c.id === S.checkId);
  const touch = (c) => { c.updated = today(); ctx.persist(); };
  host.addEventListener('click', (e) => {
    const nb = e.target.closest('[data-new]');
    if (nb) {
      const c = newCheck(nb.dataset.new, ctx);
      S.checks.push(c);
      S.checkId = c.id;
      ctx.persist();
      renderCheck(ctx);
      return;
    }
    if (e.target.closest('#hcAdd')) { document.getElementById('hcNewRow').hidden = false; return; }
    if (e.target.closest('#hcDelete')) {
      S.checks = S.checks.filter((c) => c.id !== S.checkId);
      S.checkId = S.checks.length ? S.checks[S.checks.length - 1].id : null;
      ctx.persist();
      renderCheck(ctx);
      return;
    }
    if (e.target.closest('#hcMeasure')) { ctx.goMeasure(); return; }
    if (e.target.closest('#hcJump')) { document.getElementById('hcResultsTitle').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const st = e.target.closest('[data-style]');
    if (st && cur()) { cur().style = st.dataset.style; touch(cur()); renderCheck(ctx); }
  });
  host.addEventListener('change', (e) => {
    const el = e.target;
    const c = cur();
    if (el.id === 'hcCheck') { S.checkId = el.value; ctx.persist(); renderCheck(ctx); return; }
    if (!c) return;
    if (el.id === 'hcModel') {
      const before = findModel(c.model);
      const autoName = !c.name || (before && c.name === modelLabel(before)) || c.name === ctx.t('hc.custom');
      c.model = el.value;
      c.spec = {};
      const m = findModel(c.model);
      if (autoName) c.name = m ? modelLabel(m) : ctx.t('hc.customName', { n: S.checks.indexOf(c) + 1 });
      touch(c);
      renderCheck(ctx);
      return;
    }
    if (el.id === 'hcProfile') { c.profileId = el.value || null; touch(c); renderResults(ctx); return; }
    if (el.id === 'hcName') { c.name = el.value.trim().slice(0, 40); touch(c); document.querySelector(`#hcCheck option[value="${CSS.escape(c.id)}"]`).textContent = c.name || modelLabel(specFor(c)); return; }
    if (el.dataset.f !== undefined && (el.matches('[data-spec]'))) {
      const f = el.dataset.f;
      const v = SPEC_OPTIONS[f] ? el.value : Number(el.value);
      const ok = SPEC_OPTIONS[f] ? SPEC_OPTIONS[f].includes(v) : (v > (f === 'scaleMm' ? 400 : 30) && v < (f === 'scaleMm' ? 1000 : 70));
      el.setAttribute('aria-invalid', String(!ok));
      if (!ok) return;
      c.spec = { ...c.spec, [f]: v };
      touch(c);
      renderCheck(ctx);
      return;
    }
    if (el.dataset.k) {
      c.inputs = { ...c.inputs };
      if (el.value === 'unknown') delete c.inputs[el.dataset.k]; else c.inputs[el.dataset.k] = el.value;
      touch(c); renderResults(ctx); return;
    }
    if (el.dataset.buzz) {
      const set = new Set(c.inputs.buzz || []);
      if (el.checked) set.add(el.dataset.buzz); else set.delete(el.dataset.buzz);
      c.inputs = { ...c.inputs, buzz: BUZZ.filter((b) => set.has(b)) };
      touch(c); renderResults(ctx);
    }
  });
  // Numbers update as they are typed.
  host.addEventListener('input', (e) => {
    const el = e.target;
    const c = cur();
    if (!c || !el.dataset.in) return;
    const k = el.dataset.in;
    c.inputs = { ...c.inputs };
    const v = el.value === '' ? null : Number(el.value.replace(',', '.'));
    if (v === null) delete c.inputs[k];
    else if (Number.isFinite(v) && v >= Number(el.min) && v <= Number(el.max)) c.inputs[k] = v;
    else { el.setAttribute('aria-invalid', 'true'); return; }
    el.setAttribute('aria-invalid', 'false');
    touch(c);
    renderResults(ctx);
  });
}
