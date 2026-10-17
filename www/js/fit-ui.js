// Strum check (Tune tab) and the "Measure this guitar" wizard.
// Kept apart from app.js; everything app-specific arrives through `ctx`.

import { StrumCapture } from './strum-capture.js';
import { analyzeStrum, DEFAULT_B } from './poly.js';
import { MEASURE_FRETS, SCALE_PRESETS, makeProfile, openReference, optimizeOffsets, fretError } from './guitar-fit.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Wait for one strum on the live input.
 * @param {object} ctx  needs ctx.sampleRate() and ctx.addBlockListener(fn) → remove()
 * @returns {{promise: Promise<{samples, onset}|null>, cancel: Function, capture: StrumCapture}}
 */
export function captureStrum(ctx, onState) {
  const capture = new StrumCapture(ctx.sampleRate());
  let remove = null;
  let settled = false;
  let resolveFn;
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (remove) remove();
    resolveFn(value);
  };
  let last = 'waiting';
  remove = ctx.addBlockListener((block) => {
    const st = capture.push(block);
    if (st !== last) { last = st; onState?.(st); }
    if (st === 'done') finish(capture.result());
    else if (st === 'timeout') finish(null);
  });
  return { promise, cancel: () => finish(null), capture };
}

/** Run the analysis off the current frame so the "Analyzing…" text paints first. */
export function analyzeLater(clip, sampleRate, expected) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(analyzeStrum(clip.samples, sampleRate, expected, { onset: clip.onset })), 30);
  });
}

/**
 * Six result rows.
 * @param {HTMLElement} el
 * @param {Array} strings   analyzeStrum().strings, or null for placeholders
 * @param {object} o        { labels[], mode: 'tune'|'fret', tolerance, t, fmtSigned, stringName }
 */
export function renderStrumRows(el, strings, o) {
  const range = o.mode === 'fret' ? 12 : 10;
  el.innerHTML = o.labels.map((label, i) => {
    const s = strings ? strings[i] : null;
    let cls = 'srow';
    let val = '—';
    let pos = null;
    if (s) {
      if (s.state === 'ok' || s.state === 'unsure') {
        const c = s.cents;
        const inTol = o.mode === 'tune' && Math.abs(c) <= o.tolerance;
        cls += inTol ? ' is-ok' : (o.mode === 'tune' ? ' is-off' : ' is-fret');
        if (s.state === 'unsure') cls += ' is-unsure';
        val = `${s.state === 'unsure' ? '≈ ' : ''}${o.fmtSigned(c, 1)} ¢`;
        pos = 50 + (Math.max(-range, Math.min(range, c)) / range) * 50;
      } else if (s.state === 'shared') {
        cls += ' is-na';
        val = o.t('strum.state.shared');
      } else if (s.state === 'silent') {
        cls += ' is-na';
        val = o.t('strum.state.silent');
      }
    }
    const aria = o.t('strum.rowAria', { string: o.stringName(i), value: val });
    const tol = o.mode === 'tune' ? (o.tolerance / range) * 50 : 0;
    return `<li class="${cls}" aria-label="${esc(aria)}">
      <span class="srow-name">${esc(label)}</span>
      <span class="srow-gauge" aria-hidden="true">${tol ? `<b style="left:${50 - tol}%;width:${2 * tol}%"></b>` : ''}<s></s>${pos === null ? '' : `<i style="left:${pos}%"></i>`}</span>
      <span class="srow-val">${esc(val)}</span>
    </li>`;
  }).join('');
}

// ── Tune board (strum check you can tune from) ──────────────────────────

/** True when a board row still needs work: off by more than the tolerance, or not read reliably. */
export function needsWork(row, tol) {
  if (!row) return true;
  if (row.state === 'shared' || row.state === 'silent' || row.state === 'unsure') return true;
  return !(Math.abs(row.cents) <= tol);
}

/**
 * Plain-language advice for one string: which way to turn and roughly how far.
 * Sizes are bands, not peg angles — the turn per cent depends on the gear ratio,
 * post diameter and string, which the app cannot know.
 */
export function boardAdvice(row, tol, t) {
  if (!row) return '';
  if (row.state === 'shared' || row.state === 'silent') return t('board.pluck');
  const c = row.cents;
  if (Math.abs(c) <= tol) return row.state === 'unsure' ? t('board.check') : t('board.ok');
  const a = Math.abs(c);
  const advice = t('board.advice', {
    dir: c > 0 ? t('board.loosen') : t('board.tighten'),
    size: a <= 5 ? t('board.size.tiny') : a <= 20 ? t('board.size.small') : t('board.size.big'),
  });
  return row.state === 'unsure' ? `${advice} · ${t('board.check')}` : advice;
}

const BOARD_RANGE = 10;

/** Draw the six board rows as buttons; update them later with updateTuneRow. */
export function renderTuneBoard(el, rows, o) {
  const tol = (o.tolerance / BOARD_RANGE) * 50;
  el.innerHTML = o.labels.map((label, i) => `<li class="srow srow-tap" data-i="${i}">
      <button type="button" class="srow-btn">
        <span class="srow-name">${esc(label)}</span>
        <span class="srow-gauge" aria-hidden="true"><b style="left:${50 - tol}%;width:${2 * tol}%"></b><s></s><i hidden></i></span>
        <span class="srow-val">—</span>
        <span class="srow-advice"></span>
      </button>
    </li>`).join('');
  rows.forEach((row, i) => updateTuneRow(el, i, row, o));
}

/** Update one row in place (cheap enough to call many times a second for the live row). */
export function updateTuneRow(el, i, row, o) {
  const li = el.children[i];
  if (!li) return;
  const btn = li.firstElementChild;
  const dot = li.querySelector('.srow-gauge i');
  const valEl = li.querySelector('.srow-val');
  const advEl = li.querySelector('.srow-advice');
  const cls = ['srow', 'srow-tap'];
  let val = '—';
  if (row) {
    const hasValue = row.state === 'ok' || row.state === 'unsure' || row.state === 'live';
    if (hasValue) {
      const c = row.cents;
      cls.push(Math.abs(c) <= o.tolerance ? 'is-ok' : 'is-off');
      if (row.state === 'unsure') cls.push('is-unsure');
      val = `${row.state === 'unsure' ? '≈ ' : ''}${o.fmtSigned(c, 1)} ¢`;
      const pos = 50 + (Math.max(-BOARD_RANGE, Math.min(BOARD_RANGE, c)) / BOARD_RANGE) * 50;
      dot.hidden = false;
      dot.style.left = `${pos}%`;
      dot.classList.toggle('is-edge', Math.abs(c) > BOARD_RANGE);
    } else {
      cls.push('is-na');
      dot.hidden = true;
    }
  } else {
    dot.hidden = true;
  }
  if (o.focus === i) cls.push('is-focus');
  if (o.live === i) cls.push('is-live');
  const className = cls.join(' ');
  if (li.className !== className) li.className = className;
  if (valEl.textContent !== val) valEl.textContent = val;
  const advice = row ? boardAdvice(row, o.tolerance, o.t) : '';
  if (advEl.textContent !== advice) advEl.textContent = advice;
  btn.setAttribute('aria-pressed', String(o.focus === i));
  btn.setAttribute('aria-label', o.t('board.rowAria', { string: o.stringName(i), value: val, advice }));
}

// ── Wizard ──────────────────────────────────────────────────────────────

/**
 * @param {object} ctx
 *   t, fmt, fmtSigned, stringName, stringShort, stringNote(i, fret), tuning(), tuningLabel(),
 *   openTargets() → first-partial freq per string (no capo, no sweetener),
 *   ensureMic() → Promise<boolean>, sampleRate(), addBlockListener(fn),
 *   goal(), existingNames(), onSave(profile), onClose()
 */
export function openWizard(ctx) {
  const dlg = document.getElementById('wizard');
  const body = document.getElementById('wizBody');
  const foot = document.getElementById('wizFoot');
  const stepEl = document.getElementById('wizStep');
  const { t } = ctx;
  const steps = ['intro', 'open', ...MEASURE_FRETS.map((k) => `fret${k}`), 'results'];
  const state = {
    i: 0,
    name: '',
    scale: 648,
    targets: ctx.openTargets(),
    notes: ctx.tuning().notes.slice(),
    open: null,
    frets: {},
    session: null,
  };
  let n = 1;
  const base = t('wiz.defaultName');
  const names = new Set(ctx.existingNames());
  state.name = names.has(base) ? `${base} ${++n}` : base;
  while (names.has(state.name)) state.name = `${base} ${++n}`;

  const stopSession = () => {
    if (state.session) state.session.cancel();
    state.session = null;
  };

  const labels = () => state.notes.map((_, i) => `${ctx.stringShort(i)} · ${ctx.stringNote(i, 0)}`);
  const fretLabels = (k) => state.notes.map((_, i) => `${ctx.stringShort(i)} · ${ctx.stringNote(i, k)}`);

  function button(id, label, cls = 'btn') {
    return `<button type="button" class="${cls}" id="${id}">${esc(label)}</button>`;
  }

  function render() {
    const step = steps[state.i];
    const measureCount = steps.length - 2;
    stepEl.textContent = step === 'intro' || step === 'results' ? '' : t('wiz.step', { i: state.i, n: measureCount });
    stopSession();
    if (step === 'intro') renderIntro();
    else if (step === 'results') renderResults();
    else renderMeasure(step === 'open' ? 0 : Number(step.slice(4)));
  }

  function renderIntro() {
    const inches = { 610: [24, 0], 628: [24.75, 2], 635: [25, 0], 648: [25.5, 1], 650: [25.6, 1] };
    const presets = SCALE_PRESETS.map((mm) => {
      const [inch, d] = inches[mm] || [mm / 25.4, 1];
      return `<option value="${mm}" ${mm === state.scale ? 'selected' : ''}>${mm} mm (${ctx.fmt(inch, d)}″)</option>`;
    }).join('');
    body.innerHTML = `
      <p>${esc(t('wiz.intro'))}</p>
      <div class="field">
        <label for="wizName">${esc(t('wiz.name'))}</label>
        <input type="text" id="wizName" maxlength="40" value="${esc(state.name)}" placeholder="${esc(t('wiz.namePlaceholder'))}">
      </div>
      <div class="field">
        <label for="wizScale">${esc(t('wiz.scale'))}</label>
        <div class="row">
          <select id="wizScale">${presets}<option value="other">${esc(t('wiz.scaleOther'))}</option></select>
          <input type="number" id="wizScaleMm" min="400" max="1000" step="1" value="${state.scale}" hidden aria-label="${esc(t('wiz.scale'))} (mm)">
        </div>
        <p class="note">${esc(t('wiz.scaleHint'))}</p>
      </div>`;
    foot.innerHTML = button('wizCancel', t('wiz.cancel'), 'btn btn-quiet') + button('wizStart', t('wiz.start'), 'btn is-on');
    const sel = body.querySelector('#wizScale');
    const mm = body.querySelector('#wizScaleMm');
    sel.addEventListener('change', () => {
      mm.hidden = sel.value !== 'other';
      if (sel.value !== 'other') state.scale = Number(sel.value);
      else mm.focus();
    });
    mm.addEventListener('input', () => { state.scale = Math.max(400, Math.min(1000, Number(mm.value) || 648)); });
    body.querySelector('#wizName').addEventListener('input', (e) => { state.name = e.target.value.trim() || base; });
    foot.querySelector('#wizCancel').addEventListener('click', close);
    foot.querySelector('#wizStart').addEventListener('click', async () => {
      if (!(await ctx.ensureMic())) return;
      state.i = 1;
      render();
    });
  }

  function expectedFor(k) {
    const refs = openReference(state.open, state.targets);
    return refs.map((r) => ({ freq: r.freq * Math.pow(2, k / 12), B: (r.B || DEFAULT_B[0]) * Math.pow(2, (2 * k) / 12) }));
  }

  function renderMeasure(k) {
    const title = k === 0 ? t('wiz.openTitle') : t('wiz.fretTitle', { k });
    const how = k === 0 ? t('strum.listen') : t('strum.listenFret', { k });
    const existing = k === 0 ? state.open : state.frets[k];
    body.innerHTML = `
      <div class="wiz-measure">
        <div class="fret-badge" aria-hidden="true">${k === 0 ? '0' : k}</div>
        <div>
          <h3>${esc(title)}</h3>
          <p>${esc(how)}</p>
        </div>
      </div>
      <p class="strum-status" id="wizStatus" aria-live="polite"></p>
      <ol class="strum-rows" id="wizRows"></ol>
      <p class="note" id="wizNote"></p>`;
    foot.innerHTML = button('wizCancel', t('wiz.cancel'), 'btn btn-quiet')
      + (k === 0 ? '' : button('wizSkip', t('wiz.skip'), 'btn btn-quiet'))
      + button('wizRetry', t('wiz.retry'))
      + button('wizNext', t('wiz.next'), 'btn is-on');
    const rows = body.querySelector('#wizRows');
    const status = body.querySelector('#wizStatus');
    const note = body.querySelector('#wizNote');
    const next = foot.querySelector('#wizNext');
    const rowOpts = {
      labels: k === 0 ? labels() : fretLabels(k), mode: k === 0 ? 'tune' : 'fret', tolerance: 3,
      t, fmtSigned: ctx.fmtSigned, stringName: ctx.stringName,
    };
    const show = (res) => {
      renderStrumRows(rows, res ? res.strings : null, rowOpts);
      next.disabled = !res;
      if (res) {
        const read = res.strings.filter((s) => s.heard).length;
        status.textContent = t('wiz.heard', { n: read });
        note.textContent = read < 6 ? t('wiz.missing') : '';
      }
    };
    show(existing);
    const listen = () => {
      stopSession();
      status.textContent = how;
      const expected = k === 0 ? state.targets.map((f, i) => ({ freq: f, B: DEFAULT_B[i] })) : expectedFor(k);
      const session = captureStrum(ctx, (st) => { if (st === 'recording') status.textContent = t('strum.recording'); });
      state.session = session;
      session.promise.then(async (clip) => {
        if (state.session !== session) return;
        state.session = null;
        if (!clip) { status.textContent = t('strum.timeout'); return; }
        status.textContent = t('strum.analyzing');
        const res = await analyzeLater(clip, ctx.sampleRate(), expected);
        if (!res.ok) { status.textContent = t('strum.timeout'); return; }
        if (k === 0) state.open = res; else state.frets[k] = res;
        show(res);
      });
    };
    if (!existing) listen();
    foot.querySelector('#wizCancel').addEventListener('click', close);
    foot.querySelector('#wizRetry').addEventListener('click', listen);
    foot.querySelector('#wizSkip')?.addEventListener('click', () => { delete state.frets[k]; state.i++; render(); });
    next.addEventListener('click', () => { state.i++; render(); });
  }

  function renderResults() {
    const profile = makeProfile({
      name: state.name, scaleMm: state.scale, notes: state.notes, open: state.open, frets: state.frets, targets: state.targets,
    });
    const offsets = optimizeOffsets({ notes: state.notes, tuning: ctx.tuning(), profile, goal: ctx.goal() });
    body.innerHTML = `
      <h3>${esc(t('wiz.resultsTitle'))}</h3>
      <p class="note">${esc(t('wiz.resultsLede'))}</p>
      ${fitTableHtml(profile, ctx)}
      <p class="note">${esc(t('fit.saddleNote', { mm: profile.scaleMm }))}</p>
      <h3>${esc(t('wiz.offsets', { tuning: ctx.tuningLabel() }))}</h3>
      <ol class="offset-list">${offsets.open.map((v, i) => `<li><span>${esc(ctx.stringShort(i))} · ${esc(ctx.stringNote(i, 0))}</span><b>${profile.strings[i] ? `${ctx.fmtSigned(v, 1)} ¢` : '—'}</b></li>`).join('')}</ol>`;
    foot.innerHTML = button('wizCancel', t('wiz.cancel'), 'btn btn-quiet') + button('wizSave', t('wiz.save'), 'btn is-on');
    foot.querySelector('#wizCancel').addEventListener('click', close);
    foot.querySelector('#wizSave').addEventListener('click', () => {
      ctx.onSave(profile);
      close();
    });
  }

  function close() {
    stopSession();
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => { stopSession(); ctx.onClose?.(); }, { once: true });
  render();
  if (!dlg.open) dlg.showModal();
}

/** Table of measured fretting errors and saddle advice for a profile. */
export function fitTableHtml(profile, ctx) {
  const { t } = ctx;
  const frets = MEASURE_FRETS;
  const head = `<tr><th scope="col">${esc(t('fit.col.string'))}</th>${frets.map((k) => `<th scope="col">${esc(t('fit.col.fret', { k }))}</th>`).join('')}<th scope="col">${esc(t('fit.col.saddle'))}</th></tr>`;
  const rows = profile.strings.map((s, i) => {
    const name = `${ctx.stringShort(i)}`;
    if (!s) return `<tr><th scope="row">${esc(name)}</th>${frets.map(() => '<td>—</td>').join('')}<td>—</td></tr>`;
    const cells = frets.map((k) => {
      const p = s.points.find((q) => q.k === k);
      const v = p ? p.d : null;
      return `<td class="${v !== null && Math.abs(v) > 3 ? 'is-warn' : ''}">${v === null ? `<span class="dim">${esc(ctx.fmtSigned(fretError(s.model, k), 1))}</span>` : esc(ctx.fmtSigned(v, 1))}</td>`;
    }).join('');
    const mm = s.saddleMm;
    const saddle = Math.abs(mm) < 0.3 ? t('fit.saddle.ok')
      : mm > 0 ? t('fit.saddle.back', { mm: ctx.fmt(Math.abs(mm), 1) }) : t('fit.saddle.forward', { mm: ctx.fmt(Math.abs(mm), 1) });
    return `<tr><th scope="row">${esc(name)}</th>${cells}<td class="${Math.abs(mm) >= 0.3 ? 'is-warn' : ''}">${esc(saddle)}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="fit-table"><caption>${esc(t('fit.tableCaption'))}</caption><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
