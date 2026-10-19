// Strum check (Tune tab) and the "Measure this guitar" wizard.
// Kept apart from app.js; everything app-specific arrives through `ctx`.

import { StrumCapture } from './strum-capture.js';
import { analyzeStrum, combineStrums, DEFAULT_B } from './poly.js';
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
    let spread = '';
    if (s) {
      if (s.state === 'ok' || s.state === 'unsure') {
        const c = s.cents;
        const inTol = o.mode === 'tune' && Math.abs(c) <= o.tolerance;
        cls += inTol ? ' is-ok' : (o.mode === 'tune' ? ' is-off' : ' is-fret');
        if (s.state === 'unsure') cls += ' is-unsure';
        val = `${s.state === 'unsure' ? '≈ ' : ''}${o.fmtSigned(c, 1)} ¢`;
        pos = 50 + (Math.max(-range, Math.min(range, c)) / range) * 50;
        if (s.count > 1 && s.spread !== null && s.spread !== undefined) {
          spread = `±${o.fmt(s.spread, 1)}`;
          if (s.spread > SPREAD_WARN) cls += ' is-spread';
        }
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
      <span class="srow-val">${esc(val)}${spread ? `<small class="srow-spread">${esc(spread)}</small>` : ''}</span>
    </li>`;
  }).join('');
}

/** Spread (median absolute deviation, cents) above which a string's strums disagree. */
export const SPREAD_WARN = 1.5;

// ── Tune board (strum check you can tune from) ──────────────────────────

/**
 * Tolerance for one row: live strobe readings are precise enough for the user's own
 * tolerance; strum readings (±0.4 ¢) use at least 1 ¢ so they do not flicker in and out.
 */
export const rowTolerance = (row, tol, liveTol = tol) => (row && row.state === 'live' ? liveTol : tol);

/** True when a board row still needs work: off by more than the tolerance, or not read reliably. */
export function needsWork(row, tol, liveTol = tol) {
  if (!row) return true;
  if (row.state === 'shared' || row.state === 'silent' || row.state === 'unsure') return true;
  return !(Math.abs(row.cents) <= rowTolerance(row, tol, liveTol));
}

/**
 * Plain-language advice for one string: which way to turn and roughly how far.
 * Sizes are bands, not peg angles — the turn per cent depends on the gear ratio,
 * post diameter and string, which the app cannot know.
 */
export function boardAdvice(row, tol, t, liveTol = tol) {
  if (!row) return '';
  if (row.state === 'shared' || row.state === 'silent') return t('board.pluck');
  const c = row.cents;
  if (Math.abs(c) <= rowTolerance(row, tol, liveTol)) return row.state === 'unsure' ? t('board.check') : t('board.ok');
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
  const band = li.querySelector('.srow-gauge b');
  const tol = rowTolerance(row, o.tolerance, o.liveTolerance ?? o.tolerance);
  const w = (tol / BOARD_RANGE) * 50;
  const bandStyle = `left:${50 - w}%;width:${2 * w}%`;
  if (band.getAttribute('style') !== bandStyle) band.setAttribute('style', bandStyle);
  const valEl = li.querySelector('.srow-val');
  const advEl = li.querySelector('.srow-advice');
  const cls = ['srow', 'srow-tap'];
  let val = '—';
  if (row) {
    const hasValue = row.state === 'ok' || row.state === 'unsure' || row.state === 'live';
    if (hasValue) {
      const c = row.cents;
      cls.push(Math.abs(c) <= tol ? 'is-ok' : 'is-off');
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
  const advice = row ? boardAdvice(row, o.tolerance, o.t, o.liveTolerance ?? o.tolerance) : '';
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
 *   goal(), existingNames(), onSave(profile, goal), onTune(), onClose()
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
    runs: {},      // per step: every analysed strum, combined by median
    takes: 5,      // strums per step
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

  // Six steps in all: four strum steps, results and settings, then tuning (on the Tune tab).
  const stepLabels = () => [
    t('wiz.openTitle'), ...MEASURE_FRETS.map((k) => t('fit.col.fret', { k })), t('wiz.steps.results'), t('wiz.steps.tune'),
  ];
  function renderStepper() {
    if (state.i === 0) { stepEl.innerHTML = ''; return; }
    const names = stepLabels();
    const dots = names.map((_, k) => `<span class="${k + 1 < state.i ? 'is-done' : k + 1 === state.i ? 'is-cur' : ''}"></span>`).join('');
    stepEl.innerHTML = `<span class="wiz-dots" aria-hidden="true">${dots}</span><span>${esc(t('wiz.step', { i: state.i, n: names.length, label: names[state.i - 1] }))}</span>`;
  }

  function render() {
    const step = steps[state.i];
    renderStepper();
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
    const plan = ['wiz.plan.open', 'wiz.plan.frets', 'wiz.plan.results', 'wiz.plan.tune'];
    body.innerHTML = `
      <p>${esc(t('wiz.intro'))}</p>
      <ol class="wiz-plan">${plan.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ol>
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
      </div>
      <div class="field">
        <label for="wizTakes">${esc(t('wiz.takesLabel'))}</label>
        <select id="wizTakes">${[3, 5, 7].map((v) => `<option value="${v}" ${v === state.takes ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <p class="note">${esc(t('wiz.takesHint'))}</p>
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
    body.querySelector('#wizTakes').addEventListener('change', (e) => { state.takes = Number(e.target.value) || 5; });
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
    const total = state.takes;
    const minTakes = Math.min(3, total);
    if (!state.runs[k]) state.runs[k] = [];
    const runs = state.runs[k];
    body.innerHTML = `
      <div class="wiz-measure">
        <div class="fret-badge" aria-hidden="true">${k === 0 ? '0' : k}</div>
        <div>
          <h3>${esc(title)}</h3>
          <p>${esc(how)}</p>
        </div>
      </div>
      <div class="wiz-takes" id="wizTakeDots" aria-hidden="true"></div>
      <p class="strum-status" id="wizStatus" aria-live="polite"></p>
      <ol class="strum-rows" id="wizRows"></ol>
      <p class="note" id="wizNote"></p>`;
    foot.innerHTML = button('wizCancel', t('wiz.cancel'), 'btn btn-quiet')
      + (k === 0 ? '' : button('wizSkip', t('wiz.skip'), 'btn btn-quiet'))
      + button('wizRedo', t('wiz.redo'))
      + button('wizNext', t('wiz.next'), 'btn');
    const rows = body.querySelector('#wizRows');
    const status = body.querySelector('#wizStatus');
    const note = body.querySelector('#wizNote');
    const dots = body.querySelector('#wizTakeDots');
    const next = foot.querySelector('#wizNext');
    const rowOpts = {
      labels: k === 0 ? labels() : fretLabels(k), mode: k === 0 ? 'tune' : 'fret', tolerance: 3,
      t, fmt: ctx.fmt, fmtSigned: ctx.fmtSigned, stringName: ctx.stringName,
    };
    const combined = () => (runs.length ? combineStrums(runs) : null);
    const show = (extra = '') => {
      const res = combined();
      if (k === 0) state.open = res; else if (res) state.frets[k] = res; else delete state.frets[k];
      renderStrumRows(rows, res ? res.strings : null, rowOpts);
      dots.innerHTML = Array.from({ length: total }, (_, j) => `<span class="${j < runs.length ? 'is-done' : j === runs.length ? 'is-cur' : ''}"></span>`).join('');
      next.disabled = runs.length < minTakes;
      next.classList.toggle('is-on', runs.length >= total);
      const notes = [];
      if (res) {
        const read = res.strings.filter((x) => x.heard).length;
        if (read < 6) notes.push(t('wiz.missing'));
        if (res.strings.some((x) => x.heard && x.count > 1 && x.spread > SPREAD_WARN)) notes.push(t('wiz.spreadWarn', { c: ctx.fmt(SPREAD_WARN, 1) }));
      }
      if (extra) notes.unshift(extra);
      note.textContent = notes.join(' ');
    };
    const listen = () => {
      stopSession();
      if (runs.length >= total) {
        status.textContent = t('wiz.takesDone', { n: runs.length });
        return;
      }
      status.textContent = `${t('wiz.takeOf', { i: runs.length + 1, n: total })} · ${t(runs.length ? 'wiz.strumNext' : 'wiz.strumFirst')}`;
      const expected = k === 0 ? state.targets.map((f, i) => ({ freq: f, B: DEFAULT_B[i] })) : expectedFor(k);
      const session = captureStrum(ctx, (st) => {
        if (st === 'recording') status.textContent = `${t('wiz.takeOf', { i: runs.length + 1, n: total })} · ${t('strum.recording')}`;
      });
      state.session = session;
      session.promise.then(async (clip) => {
        if (state.session !== session) return;
        state.session = null;
        if (state.closed) return;
        if (!clip) { show(t('strum.timeout')); listen(); return; }
        status.textContent = t('strum.analyzing');
        const res = await analyzeLater(clip, ctx.sampleRate(), expected);
        if (state.closed || state.session !== null || steps[state.i] !== (k === 0 ? 'open' : `fret${k}`)) return;
        if (!res.ok) { show(t('strum.timeout')); listen(); return; }
        runs.push(res);
        show();
        listen(); // straight on to the next strum until the step has all of them
      });
    };
    show();
    listen();
    foot.querySelector('#wizCancel').addEventListener('click', close);
    foot.querySelector('#wizRedo').addEventListener('click', () => { runs.length = 0; show(); listen(); });
    foot.querySelector('#wizSkip')?.addEventListener('click', () => { stopSession(); delete state.frets[k]; delete state.runs[k]; state.i++; render(); });
    next.addEventListener('click', () => { stopSession(); state.i++; render(); });
  }

  function renderResults() {
    const profile = makeProfile({
      name: state.name, scaleMm: state.scale, notes: state.notes, open: state.open, frets: state.frets, targets: state.targets,
    });
    let goal = Math.max(0, Math.min(1, ctx.goal()));
    const offsetsHtml = () => {
      const offsets = optimizeOffsets({ notes: state.notes, tuning: ctx.tuning(), profile, goal });
      return offsets.open.map((v, i) => `<li><span>${esc(ctx.stringShort(i))} · ${esc(ctx.stringNote(i, 0))}</span><b>${profile.strings[i] ? `${ctx.fmtSigned(v, 1)} ¢` : '—'}</b></li>`).join('');
    };
    body.innerHTML = `
      <h3>${esc(t('wiz.resultsTitle'))}</h3>
      <p class="note">${esc(t('wiz.resultsLede'))}</p>
      ${fitTableHtml(profile, ctx)}
      <p class="note">${esc(t('fit.saddleNote', { mm: profile.scaleMm }))}</p>
      <h3>${esc(t('wiz.offsets', { tuning: ctx.tuningLabel() }))}</h3>
      <div class="field wiz-goal">
        <label for="wizGoal">${esc(t('fit.goalLabel'))} <output id="wizGoalOut"></output></label>
        <input type="range" id="wizGoal" min="0" max="100" step="5" value="${Math.round(goal * 100)}">
        <div class="range-ends"><span>${esc(t('fit.goal.et'))}</span><span>${esc(t('fit.goal.sweet'))}</span></div>
      </div>
      <ol class="offset-list" id="wizOffsets">${offsetsHtml()}</ol>
      <p class="note">${esc(t('wiz.nextTune'))}</p>`;
    const out = body.querySelector('#wizGoalOut');
    const list = body.querySelector('#wizOffsets');
    const showGoal = () => { out.textContent = `${ctx.fmt(Math.round(goal * 100), 0)} %`; };
    showGoal();
    body.querySelector('#wizGoal').addEventListener('input', (e) => {
      goal = Number(e.target.value) / 100;
      showGoal();
      list.innerHTML = offsetsHtml();
    });
    foot.innerHTML = button('wizCancel', t('wiz.cancel'), 'btn btn-quiet')
      + button('wizSave', t('wiz.save'))
      + button('wizSaveTune', t('wiz.saveTune'), 'btn is-on');
    foot.querySelector('#wizCancel').addEventListener('click', close);
    foot.querySelector('#wizSave').addEventListener('click', () => {
      ctx.onSave(profile, goal);
      close();
    });
    foot.querySelector('#wizSaveTune').addEventListener('click', () => {
      ctx.onSave(profile, goal);
      close();
      ctx.onTune?.();
    });
  }

  function close() {
    state.closed = true;
    stopSession();
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => { state.closed = true; stopSession(); ctx.onClose?.(); }, { once: true });
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
