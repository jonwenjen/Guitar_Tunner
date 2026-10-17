// App controller: wires audio → detection → strobe → UI.

import { MicInput } from './audio.js';
import { PitchDetector } from './pitch.js';
import { StrobeEngine } from './strobe-engine.js';
import { StrobeView } from './strobe-view.js';
import { Headstock } from './headstock.js';
import { ReferenceTone } from './tone.js';
import { computeTargets, chromaticTarget, StringTracker, TunedTracker } from './tuner-core.js';
import { TUNINGS, CATEGORIES } from './tunings.js';
import { SWEETENERS, findSweetener, sweetenerOffsets } from './sweeteners.js';
import { TEMPERAMENTS } from './temperaments.js';
import { REFERENCES } from './references.js';
import { LEARN_REFS } from './learn.js';
import { captureStrum, analyzeLater, renderStrumRows, openWizard, fitTableHtml } from './fit-ui.js';
import { DEFAULT_B } from './poly.js';
import { loadSettings, saveSettings, DEFAULTS } from './store.js';
import { parseNote, octaveOf, cents as centsOf, freqToMidi, noteLabel as noteLabelIntl } from './music.js';
import {
  LANGUAGES, setLanguage, detectLanguage, htmlLang, currentLanguage, listSep, t, tp, term, fmt, fmtSigned,
  noteName, noteLabel, intervalNames, stringName, stringShort, tuningName, tuningAbout, categoryName,
  sweetenerName, sweetenerAbout, temperamentName, temperamentAbout, learnArticles,
} from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let S = loadSettings();
const persist = () => saveSettings(S);

// ── Runtime state ──────────────────────────────────────────────────────
const RING = 8192;
const ring = new Float32Array(RING);
let ringPos = 0;
let ringFilled = 0;
const frame = new Float32Array(4096);

let detector = null;
let engine = null;
const tracker = new StringTracker();
const tunedTracker = new TunedTracker(6);
const mic = new MicInput(onBlock);
let ownCtx = null;
const tone = new ReferenceTone(() => mic.ctx || (ownCtx ||= new (window.AudioContext || window.webkitAudioContext)()));

let targets = [];
let sweet = { open: [0, 0, 0, 0, 0, 0], fret12: [0, 0, 0, 0, 0, 0], applies: true };
let activeString = -1;
let lockedString = -1;
let chromRef = null; // {midi, freq, label, offset}
let lastDetect = 0;
let lastSound = 0;
let lastMpm = null;
let shownCents = null;
let mpmSmooth = null;
let lastFrameTime = performance.now();
let wakeLock = null;
let srLast = '';
let micError = null; // key of the last microphone error, re-rendered on language change
const blockListeners = new Set(); // strum captures listening to the raw input
let strumSession = null;          // active strum check on the Tune tab
let strumResult = null;
let strumBusy = false;            // pauses the live instruction text while a strum check runs

const view = new StrobeView($('#strobe'));
const headstock = new Headstock($('#headstock'), { onSelect: onStringTap });

// ── Settings → derived data ────────────────────────────────────────────
function allTunings() {
  return [...TUNINGS, ...S.customTunings.map((x) => ({ ...x, category: 'yours', shape: null }))];
}
function currentTuning() {
  return allTunings().find((x) => x.id === S.tuningId) || TUNINGS[0];
}
const isCustom = (tuning) => tuning.category === 'yours';
/** Spell notes with flats when the user asks, or when the tuning itself is written with flats (E♭ standard). */
function useFlats(tuning = currentTuning()) {
  return S.flats || tuning.notes.some((n) => /^[A-G](b|♭)/.test(n));
}
function currentProfile() {
  return S.guitars.find((g) => g.id === S.guitarId) || null;
}
function currentTemperament() {
  return TEMPERAMENTS.find((x) => x.id === S.temperamentId) || TEMPERAMENTS[0];
}
function nameOf(tuning) {
  return isCustom(tuning) ? { text: tuning.name, primary: tuning.name, secondary: '' } : tuningName(tuning);
}

function recompute() {
  const tuning = currentTuning();
  sweet = sweetenerOffsets(findSweetener(S.sweetenerId), tuning, { sweetness: S.sweetness, anchor: S.anchor, custom: S.custom, profile: currentProfile() });
  targets = computeTargets({
    notes: tuning.notes, a4: S.a4, globalCents: S.globalCents, capo: S.capo,
    temperament: currentTemperament(), temperamentRoot: S.temperamentRoot, sweet, flats: useFlats(tuning),
  });
  tracker.reset();
}

function targetFreq(i) {
  const x = targets[i];
  if (!x) return 0;
  return S.intonation ? x.freq12 : x.freq;
}

// ── Audio path ─────────────────────────────────────────────────────────
function onBlock(block) {
  if (!engine) return;
  const n = block.length;
  if (n >= RING) { ring.set(block.subarray(n - RING)); ringPos = 0; }
  else {
    const first = Math.min(n, RING - ringPos);
    ring.set(block.subarray(0, first), ringPos);
    if (first < n) ring.set(block.subarray(first), 0);
    ringPos = (ringPos + n) % RING;
  }
  ringFilled = Math.min(RING, ringFilled + n);
  engine.process(block);
  for (const fn of blockListeners) fn(block);
}

function addBlockListener(fn) {
  blockListeners.add(fn);
  return () => blockListeners.delete(fn);
}

function latestFrame() {
  const N = frame.length;
  let start = ringPos - N;
  if (start >= 0) frame.set(ring.subarray(start, ringPos));
  else {
    start += RING;
    frame.set(ring.subarray(start), 0);
    frame.set(ring.subarray(0, ringPos), RING - start);
  }
  return frame;
}

async function startMic() {
  const instr = $('#instruction');
  micError = null;
  try {
    instr.textContent = t('instr.starting');
    instr.className = 'instruction';
    await mic.start();
    detector = new PitchDetector(mic.sampleRate, 4096);
    engine = new StrobeEngine(mic.sampleRate);
    ringFilled = 0;
    $('#hub').classList.remove('is-idle');
    requestWakeLock();
    instr.textContent = idleInstruction();
  } catch (err) {
    micError = { code: err.code || 'unknown', name: err.detail || err.name || String(err) };
    showMicError();
  }
}

function showMicError() {
  if (!micError) return;
  const instr = $('#instruction');
  const key = `mic.${micError.code}`;
  instr.textContent = micError.code === 'unknown' ? t('mic.unknown', { name: micError.name }) : t(key);
  instr.className = 'instruction is-error';
}

async function stopMic() {
  cancelStrumCheck(false);
  await mic.stop();
  engine = null;
  $('#hub').classList.add('is-idle');
  releaseWakeLock();
}

async function requestWakeLock() {
  if (!S.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* not allowed here; the screen may dim */ }
}
function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

let resumeOnShow = false;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    if (mic.running) { await stopMic(); resumeOnShow = true; }
  } else if (resumeOnShow) {
    resumeOnShow = false;
    startMic();
  }
});

// ── Main loop ──────────────────────────────────────────────────────────
function loop(now) {
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  view.resize();

  let reading = null;
  let level = 0;
  if (engine && ringFilled >= frame.length) {
    if (now - lastDetect > 33) {
      lastDetect = now;
      const minTarget = Math.min(...targets.map((_, i) => targetFreq(i)));
      const r = detector.detect(latestFrame(), {
        gateDb: S.gateDb,
        minFreq: Math.max(40, Math.min(70, minTarget * 0.7)),
        maxFreq: 1500,
      });
      lastMpm = r;
      if (r.freq) {
        lastSound = now;
        chooseReference(r.freq);
      }
    }
    const er = engine.read();
    level = Math.max(0, Math.min(1, (20 * Math.log10(er.level + 1e-9) - S.gateDb) / 34));
    const sounding = now - lastSound < 250;
    if (engine.ref && (sounding || now - lastSound < 1200)) {
      let c = null;
      const mpmC = lastMpm && lastMpm.freq ? centsOf(lastMpm.freq, engine.ref) : null;
      if (mpmC !== null) mpmSmooth = mpmSmooth === null ? mpmC : mpmSmooth + (mpmC - mpmSmooth) * 0.35;
      if (er.valid && (mpmC === null || Math.abs(mpmC) < 45) && Math.abs(er.cents) < 60) c = er.cents;
      else if (sounding && mpmSmooth !== null) c = mpmSmooth;
      else c = shownCents;
      if (sounding && c !== null) shownCents = c;
      reading = { cents: shownCents, sounding, strobe: er };
    } else {
      shownCents = null;
      mpmSmooth = null;
    }
  }

  // Tuned ticks.
  if (reading && reading.sounding && S.mode !== 'chromatic' && activeString >= 0 && reading.cents !== null) {
    if (tunedTracker.update(activeString, reading.cents, dt, S.tolerance)) announce(t('sr.tuned', { string: stringName(activeString) }));
  }

  const strobeOn = !!(reading && reading.sounding);
  view.draw({
    phases: reading?.strobe.phases, mags: reading?.strobe.mags, level,
    active: strobeOn, cents: reading ? reading.cents : null, tolerance: S.tolerance,
  });
  renderReadout(reading, level);
  requestAnimationFrame(loop);
}

function chooseReference(freq) {
  if (S.mode === 'chromatic') {
    const x = chromaticTarget(freq, { a4: S.a4, globalCents: S.globalCents, temperament: currentTemperament(), temperamentRoot: S.temperamentRoot, flats: S.flats });
    if (!chromRef || (x.midi !== chromRef.midi && Math.abs(centsOf(freq, chromRef.freq)) > 58)) chromRef = x;
    engine.setReference(chromRef.freq);
    activeString = -1;
    return;
  }
  if (S.mode === 'manual' && lockedString >= 0) {
    activeString = lockedString;
  } else {
    const list = targets.map((_, i) => ({ freq: targetFreq(i) }));
    activeString = tracker.update(freq, list);
  }
  if (activeString >= 0) engine.setReference(targetFreq(activeString));
}

function stringMidi(i) {
  const x = targets[i];
  return x ? x.midi + (S.intonation ? 12 : 0) : null;
}
function stringLabel(i) {
  const m = stringMidi(i);
  return m === null ? '' : noteLabel(m, useFlats());
}

function setNote(name, octave) {
  const noteEl = $('#noteName');
  noteEl.textContent = name;
  $('#noteOct').textContent = octave;
  noteEl.parentElement.classList.toggle('is-long', name.length > 2);
}

function renderReadout(reading, level) {
  const hubEl = $('#hub');
  const instr = $('#instruction');
  const centsEl = $('#cents'), hzEl = $('#hz');

  let midi = null;
  if (S.mode === 'chromatic') midi = chromRef ? chromRef.midi : null;
  else if (activeString >= 0) midi = stringMidi(activeString);
  const flats = S.mode === 'chromatic' ? S.flats : useFlats();

  if (strumBusy && mic.running) {
    // A strum check owns the instruction line until it finishes.
    renderHeadstockOnly(reading, level);
    return;
  }
  if (!mic.running) {
    hubEl.classList.add('is-idle');
  } else if (midi !== null && reading) {
    setNote(noteName(midi, flats), String(octaveOf(midi)));
    const c = reading.cents;
    const tol = S.tolerance;
    if (c !== null && Math.abs(c) >= 100 && lastMpm?.freq) {
      // More than a semitone away (wrong string locked, capo moved): say what we hear.
      const heard = noteLabel(Math.round(freqToMidi(lastMpm.freq, S.a4)), flats);
      centsEl.textContent = t('hearing', { note: heard });
      centsEl.classList.remove('is-in');
      hzEl.textContent = `${fmt(lastMpm.freq, 1)} Hz`;
      setInstruction(c, false, Math.round(Math.abs(c) / 100));
    } else if (c !== null) {
      const inTune = Math.abs(c) <= tol;
      centsEl.textContent = `${fmtSigned(c, 1)} ¢`;
      centsEl.classList.toggle('is-in', inTune);
      const ref = engine?.ref || 0;
      hzEl.textContent = ref ? `${fmt(ref * Math.pow(2, c / 1200), 2)} Hz` : '';
      setInstruction(c, inTune);
    }
  } else if (mic.running) {
    if (S.mode === 'chromatic' || activeString < 0) setNote('–', '');
    else setNote(noteName(stringMidi(activeString), flats), '');
    centsEl.textContent = ' ';
    centsEl.classList.remove('is-in');
    hzEl.textContent = ' ';
    if (!instr.classList.contains('is-error')) {
      instr.className = 'instruction';
      const txt = idleInstruction();
      if (instr.textContent !== txt) instr.textContent = txt;
    }
  }

  renderHeadstockOnly(reading, level);
}

function renderHeadstockOnly(reading, level) {
  const tuned = tunedTracker.tuned;
  headstock.update({
    labels: targets.map((_, i) => stringLabel(i)),
    active: S.mode === 'chromatic' ? -1 : activeString,
    locked: S.mode === 'manual' ? lockedString : -1,
    tuned,
    level: reading && reading.sounding ? level : 0,
    aria: targets.map((_, i) => {
      const extra = [tuned[i] ? t('headstock.tuned') : '', i === lockedString && S.mode === 'manual' ? t('headstock.locked') : ''].filter(Boolean);
      return [t('headstock.key', { string: stringName(i), note: stringLabel(i) }), ...extra].join(', ');
    }),
  });
}

function idleInstruction() {
  if (!mic.running) return t('instr.start');
  if (S.mode === 'chromatic') return t('instr.anyNote');
  if (S.mode === 'manual' && lockedString >= 0) {
    return S.intonation
      ? t('instr.lockedFret12', { string: stringName(lockedString) })
      : t('instr.locked', { string: stringName(lockedString), note: stringLabel(lockedString) });
  }
  return S.intonation ? t('instr.anyFret12') : t('instr.open');
}

function setInstruction(c, inTune, semitones = 0) {
  const instr = $('#instruction');
  instr.className = 'instruction' + (inTune ? ' is-in' : '');
  const hasString = !(S.mode === 'chromatic' || activeString < 0);
  const string = hasString ? stringName(activeString) : '';
  let html;
  if (inTune) {
    if (S.intonation) html = esc(t('instr.intonationSet'));
    else html = esc(hasString ? t('instr.inTune', { string }) : t('instr.inTuneChromatic'));
  } else if (S.intonation) {
    html = c > 0 ? t('instr.sharp12') : t('instr.flat12');
  } else if (S.mode === 'chromatic') {
    html = c > 0 ? t('instr.chromaticSharp') : t('instr.chromaticFlat');
  } else {
    html = c > 0 ? t('instr.loosen', { string }) : t('instr.tighten', { string });
    html += semitones ? tp('instr.togo', semitones) : t('instr.end');
  }
  if (instr.innerHTML !== html) instr.innerHTML = html;
  if (inTune) announce(hasString ? t('sr.inTune', { string }) : t('sr.inTuneChromatic'));
}

function announce(text) {
  if (!text || text === srLast) return;
  srLast = text;
  $('#srStatus').textContent = text;
}

// ── Interactions ───────────────────────────────────────────────────────
function onStringTap(i) {
  if (S.mode === 'manual' && lockedString === i) {
    lockedString = -1;
    setMode('auto');
  } else {
    lockedString = i;
    activeString = i;
    setMode('manual');
    if (engine) engine.setReference(targetFreq(i));
  }
  if (tone.playing) tone.play(targetFreq(i));
}

function setMode(mode) {
  S.mode = mode;
  if (mode === 'manual' && lockedString < 0) lockedString = Math.max(0, activeString);
  if (mode !== 'manual') lockedString = mode === 'auto' ? -1 : lockedString;
  if (mode === 'chromatic') chromRef = null;
  tracker.reset();
  persist();
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
}

function showView(name) {
  $$('.view').forEach((v) => { v.hidden = v.dataset.viewName !== name; });
  $$('[data-tab]').forEach((b) => {
    if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('.app').dataset.view = name;
  if (name !== 'tune') window.scrollTo({ top: 0 });
}

function bindTune() {
  $('#startBtn').addEventListener('click', startMic);
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'manual' && lockedString < 0) lockedString = activeString >= 0 ? activeString : 0;
    setMode(b.dataset.mode);
  }));
  $('#intonation').addEventListener('change', (e) => {
    S.intonation = e.target.checked;
    persist();
    tracker.reset();
    tunedTracker.reset();
  });
  $('#capoDown').addEventListener('click', () => setCapo(S.capo - 1));
  $('#capoUp').addEventListener('click', () => setCapo(S.capo + 1));
  $('#refTone').addEventListener('click', () => {
    if (tone.playing) { tone.stop(); updateToneButton(); return; }
    const i = activeString >= 0 ? activeString : (lockedString >= 0 ? lockedString : 0);
    const f = S.mode === 'chromatic' && chromRef ? chromRef.freq : targetFreq(i);
    tone.onEnd = updateToneButton;
    tone.play(f, 3);
    updateToneButton();
  });
  $('#resetTuned').addEventListener('click', () => tunedTracker.reset());
}

function updateToneButton() {
  const b = $('#refTone');
  b.textContent = tone.playing ? t('ref.stop') : t('ref.play');
  b.classList.toggle('is-on', tone.playing);
}

function setCapo(n) {
  S.capo = Math.max(0, Math.min(9, n));
  persist();
  recompute();
  renderHeader();
}

// ── Strum check ────────────────────────────────────────────────────────
function strumLabels() {
  return targets.map((x, i) => `${stringShort(i)} · ${noteLabel(x.midi, useFlats())}`);
}

function renderStrumPanel(status) {
  const panel = $('#strumPanel');
  const opening = panel.hidden;
  panel.hidden = false;
  if (status !== undefined) $('#strumStatus').textContent = status;
  renderStrumRows($('#strumRows'), strumResult ? strumResult.strings : null, {
    labels: strumLabels(), mode: 'tune', tolerance: Math.max(S.tolerance, 1), t, fmtSigned, stringName,
  });
  const needsSingle = !!strumResult && strumResult.strings.some((x) => x.state === 'shared' || x.state === 'unsure');
  $('#strumHint').hidden = !needsSingle;
  if (opening || (strumResult && status !== undefined)) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Wait two frames so the readout above has re-laid out before measuring.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (panel.hidden) return;
      // 'nearest' ignores scroll-margin in Chromium, so decide here whether the panel
      // is hidden under the tab bar and align its end (or start, if it is taller).
      const r = panel.getBoundingClientRect();
      const limit = window.innerHeight - (parseFloat(getComputedStyle(panel).scrollMarginBottom) || 0);
      if (r.bottom > limit || r.top < 0) {
        panel.scrollIntoView({ block: r.height > limit - 12 ? 'start' : 'end', behavior: reduce ? 'auto' : 'smooth' });
      }
    }));
  }
}

async function startStrumCheck() {
  if (!mic.running) {
    await startMic();
    if (!mic.running) return;
  }
  cancelStrumCheck(false);
  strumResult = null;
  strumBusy = true;
  $('#strumAgain').hidden = true;
  const prompt = t('strum.listen');
  renderStrumPanel(prompt);
  $('#instruction').className = 'instruction';
  $('#instruction').textContent = prompt;
  const expected = targets.map((x, i) => ({ freq: x.freq, B: DEFAULT_B[i] }));
  const session = captureStrum({ sampleRate: () => mic.sampleRate, addBlockListener }, (st) => {
    if (st === 'recording') $('#strumStatus').textContent = t('strum.recording');
  });
  strumSession = session;
  const clip = await session.promise;
  if (strumSession !== session) return;
  strumSession = null;
  if (!clip) {
    strumBusy = false;
    renderStrumPanel(t('strum.timeout'));
    $('#strumAgain').hidden = false;
    return;
  }
  $('#strumStatus').textContent = t('strum.analyzing');
  const res = await analyzeLater(clip, mic.sampleRate, expected);
  strumBusy = false;
  $('#strumAgain').hidden = false;
  if (!res.ok) { renderStrumPanel(t('strum.timeout')); return; }
  strumResult = res;
  // Tick the strings the strum confirmed, clear the ones it found out of tune.
  const tol = Math.max(S.tolerance, 1);
  res.strings.forEach((x, i) => {
    if (x.state !== 'ok') return;
    tunedTracker.tuned[i] = Math.abs(x.cents) <= tol;
    tunedTracker.timeIn[i] = 0;
  });
  const read = res.strings.filter((x) => x.state === 'ok');
  const ok = read.filter((x) => Math.abs(x.cents) <= tol).length;
  renderStrumPanel(t('strum.summary', { ok, read: read.length, tol: fmt(tol, tol % 1 ? 1 : 0) }));
}

function cancelStrumCheck(hide = true) {
  if (strumSession) strumSession.cancel();
  strumSession = null;
  strumBusy = false;
  if (hide) {
    $('#strumPanel').hidden = true;
    strumResult = null;
  }
}

// ── Guitar profiles ────────────────────────────────────────────────────
function openTargetsForMeasuring() {
  // Base equal-tempered targets for the current tuning: no capo, no sweetener.
  const tuning = currentTuning();
  return computeTargets({
    notes: tuning.notes, a4: S.a4, globalCents: S.globalCents, capo: 0,
    temperament: null, temperamentRoot: 0, sweet: null, flats: useFlats(tuning),
  }).map((x) => x.freq);
}

function startWizard() {
  cancelStrumCheck();
  const tuning = currentTuning();
  openWizard({
    t, fmt, fmtSigned, stringName, stringShort,
    stringNote: (i, k) => noteLabel(parseNote(tuning.notes[i]) + k, useFlats(tuning)),
    tuning: () => tuning,
    tuningLabel: () => nameOf(tuning).text,
    openTargets: openTargetsForMeasuring,
    ensureMic: async () => { if (!mic.running) await startMic(); return mic.running; },
    sampleRate: () => mic.sampleRate,
    addBlockListener,
    goal: () => S.sweetness,
    existingNames: () => S.guitars.map((g) => g.name),
    onSave: (profile) => {
      S.guitars.push(profile);
      S.guitarId = profile.id;
      S.sweetenerId = 'guitar-fit';
      persist(); recompute(); renderHeader(); renderSweeten();
      $('#sweetNote').textContent = t('wiz.saved');
    },
  });
}

function renderFitBlock() {
  const sw = findSweetener(S.sweetenerId);
  const block = $('#fitBlock');
  block.hidden = sw.kind !== 'profile';
  $('#goalEnds').hidden = sw.kind !== 'profile';
  $('#sweetnessLabel').textContent = sw.kind === 'profile' ? t('fit.goalLabel') : t('sweeten.sweetness');
  if (block.hidden) return;
  const sel = $('#fitSelect');
  sel.innerHTML = S.guitars.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  sel.hidden = !S.guitars.length;
  $('#fitDelete').hidden = !S.guitars.length;
  $('#fitEmpty').hidden = !!S.guitars.length;
  const prof = currentProfile();
  if (prof) sel.value = prof.id;
  $('#fitMeta').textContent = prof ? t('fit.measured', { date: prof.created, tuning: prof.notes.map((n) => noteName(parseNote(n), useFlats())).join(' ') }) : '';
  $('#fitTable').innerHTML = prof ? fitTableHtml(prof, { t, fmt, fmtSigned, stringShort }) : '';
  $('#fitSaddleNote').textContent = prof ? t('fit.saddleNote', { mm: prof.scaleMm }) : '';
}

function bindFit() {
  $('#strumBtn').addEventListener('click', startStrumCheck);
  $('#strumAgain').addEventListener('click', startStrumCheck);
  $('#strumClose').addEventListener('click', () => cancelStrumCheck(true));
  $('#fitMeasure').addEventListener('click', startWizard);
  $('#fitSelect').addEventListener('change', (e) => {
    S.guitarId = e.target.value;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
  $('#fitDelete').addEventListener('click', () => {
    S.guitars = S.guitars.filter((g) => g.id !== S.guitarId);
    S.guitarId = S.guitars.length ? S.guitars[S.guitars.length - 1].id : null;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
}

// ── Static text ────────────────────────────────────────────────────────
/** Fill every element marked with data-i18n* attributes. */
function applyI18n() {
  document.documentElement.lang = htmlLang();
  document.title = term('appName');
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-term]').forEach((el) => { el.textContent = term(el.dataset.i18nTerm); });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  $$('[data-i18n-placeholder]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)));
  headstock.setGroupLabel(t('headstock.aria'));
  const english = currentLanguage() === 'en';
  $$('.label-alt').forEach((el) => { el.hidden = english; });
  $('#termsField').hidden = english;
  updateToneButton();
}

// ── Rendering ──────────────────────────────────────────────────────────
function renderHeader() {
  const tuning = currentTuning();
  const nm = nameOf(tuning);
  $('#tuningName').textContent = nm.text;
  const names = tuning.notes.map((n) => noteName(parseNote(n), useFlats(tuning))).join(' ');
  $('#tuningNotes').textContent = S.capo ? t('header.capo', { notes: names, n: S.capo }) : names;
  const sw = findSweetener(S.sweetenerId);
  const chip = $('#chipSweet');
  chip.textContent = sw.id === 'equal' ? t('chip.equal') : sweetenerName(sw).primary.replace(/ [(（].*[)）]$/, '');
  chip.classList.toggle('is-on', sw.id !== 'equal');
  const a4 = $('#chipA4');
  a4.textContent = t('chip.a4', { note: noteLabel(69), hz: fmt(S.a4, S.a4 % 1 ? 1 : 0) });
  a4.classList.toggle('is-on', S.a4 !== 440 || S.globalCents !== 0);
  $('#capoLabel').textContent = S.capo ? t('capo.n', { n: S.capo }) : t('capo.none');
  $('#intonation').checked = S.intonation;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));

  const parts = [];
  const swName = sweetenerName(sw).text;
  if (sw.id !== 'equal') {
    parts.push(sweet.applies
      ? t('sweetLine.applies', { name: swName, offsets: sweet.open.map(fmtOffset).join(', ') })
      : t('sweetLine.na', { name: swName }));
  }
  if (S.temperamentId !== 'equal') {
    parts.push(t('sweetLine.temperament', { name: temperamentName(currentTemperament()).text, key: noteName(S.temperamentRoot + 60, S.flats) }));
  }
  $('#sweetLine').textContent = parts.join(' / ');
}

const fmtOffset = (v) => (Math.abs(v) < 0.05 ? fmt(0, 0) : fmtSigned(v, 1));

function renderTunings() {
  const host = $('#tuningList');
  host.innerHTML = '';
  const cats = CATEGORIES.map((c) => c.id);
  if (S.customTunings.length) cats.unshift('yours');
  const std = TUNINGS[0].notes.map(parseNote);
  for (const catId of cats) {
    const list = allTunings().filter((x) => x.category === catId);
    if (!list.length) continue;
    const sec = document.createElement('section');
    sec.className = 'cat';
    sec.innerHTML = `<h2>${esc(categoryName(catId))}</h2>`;
    for (const tuning of list) {
      const midis = tuning.notes.map(parseNote);
      const row = document.createElement('div');
      row.className = 'tuning-row' + (tuning.id === S.tuningId ? ' is-current' : '');
      const fl = useFlats(tuning);
      const ribbon = midis.map((m, i) => `<span class="${m !== std[i] ? 'changed' : ''}">${esc(noteLabel(m, fl))}</span>`).join('');
      const src = (tuning.sources || []).map((id) => REFERENCES[id]).filter(Boolean)
        .map((r) => r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${esc(shortCite(r.cite))}</a>` : esc(shortCite(r.cite))).join('; ');
      const nm = nameOf(tuning);
      const about = isCustom(tuning) ? t('custom.about') : tuningAbout(tuning);
      row.innerHTML = `
        <div>
          <h3>${esc(nm.primary)}${nm.secondary ? `<span class="alt-name" lang="en">${esc(nm.secondary)}</span>` : ''}</h3>
          <div class="ribbon" aria-label="${esc(t('tuning.ribbonAria'))}">${ribbon}</div>
          <div class="intervals">${esc(intervalNames(midis).join('  '))}</div>
        </div>
        <div class="actions">
          ${tuning.id === S.tuningId ? `<button class="btn is-on" type="button" disabled>${esc(t('tuning.inUse'))}</button>` : `<button class="btn" type="button" data-use="${tuning.id}">${esc(t('tuning.use'))}</button>`}
          ${isCustom(tuning) ? `<button class="btn btn-quiet" type="button" data-del="${tuning.id}" aria-label="${esc(t('tuning.deleteAria', { name: tuning.name }))}">${esc(t('tuning.delete'))}</button>` : ''}
        </div>
        <details><summary>${esc(t('tuning.about'))}</summary><p>${esc(about)}</p>${src ? `<p class="src">${t('tuning.sources', { list: src })}</p>` : ''}</details>`;
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  $$('[data-use]', host).forEach((b) => b.addEventListener('click', () => useTuning(b.dataset.use)));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => {
    S.customTunings = S.customTunings.filter((x) => x.id !== b.dataset.del);
    if (S.tuningId === b.dataset.del) S.tuningId = 'standard';
    persist(); recompute(); renderAll();
  }));
}

function shortCite(cite) {
  const m = /^(.+?)\((\d{4}[^)]*)\)/.exec(cite);
  if (!m) return cite.split('.')[0];
  const authors = m[1].trim().replace(/,\s*$/, '');
  const first = authors.split(/,|&/)[0].trim();
  const many = (authors.match(/&|,/g) || []).length > 1;
  return `${first}${many ? ' et al.' : authors.includes('&') ? ' & ' + authors.split('&')[1].trim().split(',')[0] : ''} ${m[2].slice(0, 4)}`;
}

function useTuning(id) {
  cancelStrumCheck(true);
  S.tuningId = id;
  persist();
  recompute();
  tunedTracker.reset();
  lockedString = -1;
  if (S.mode === 'manual') setMode('auto');
  renderAll();
  showView('tune');
}

function renderCustomBuilder() {
  const grid = $('#customGrid');
  const options = [];
  for (let m = parseNote('A1'); m <= parseNote('G4'); m++) options.push(m);
  const cur = currentTuning().notes.map(parseNote);
  grid.innerHTML = cur.map((midi, i) => `
    <label>${esc(stringShort(i))}
      <select data-cs="${i}">${options.map((m) => `<option value="${m}" ${m === midi ? 'selected' : ''}>${esc(noteLabel(m, S.flats))}</option>`).join('')}</select>
    </label>`).join('');
}

function bindCustomBuilder() {
  $('#customSave').addEventListener('click', () => {
    // Stored with international letter names so saved tunings survive language changes.
    const notes = $$('[data-cs]').map((s) => noteLabelIntl(Number(s.value)).replace('♯', '#'));
    const name = $('#customName').value.trim() || notes.map((n) => n.replace(/\d/g, '')).join('');
    const id = `custom-${Date.now().toString(36)}`;
    S.customTunings.push({ id, name, notes });
    persist();
    useTuning(id);
  });
}

function renderSweeten() {
  const tuning = currentTuning();
  const notes = tuning.notes.map((n) => noteName(parseNote(n), useFlats(tuning))).join(' ');
  const lede = esc(t('sweeten.lede', { tuning: '\u0000' })).replace('\u0000', `<strong>${esc(nameOf(tuning).text)}, ${esc(notes)}</strong>`);
  $('#sweetLede').innerHTML = lede;

  // Offset chart.
  const chart = $('#offsetChart');
  const max = 15;
  chart.innerHTML = sweet.open.map((v, i) => {
    const h = Math.min(1, Math.abs(v) / max) * 60;
    const style = v >= 0 ? `bottom:60px;height:${h}px` : `top:60px;height:${h}px`;
    const name = noteName(parseNote(tuning.notes[i]) + S.capo, useFlats(tuning));
    return `<div class="bar"><span class="bar-val">${fmtOffset(v)}</span><div class="bar-track"><div class="bar-fill ${v < 0 ? 'neg' : ''}" style="${style}"></div></div><span class="bar-name">${esc(name)}</span></div>`;
  }).join('');
  chart.setAttribute('aria-label', t('sweeten.chartAria', { list: sweet.open.map(fmtOffset).join(', ') }));
  $('#sweetNote').textContent = sweet.noteKey ? t(`sweetNote.${sweet.noteKey}`) : (S.sweetenerId === 'equal' ? t('sweeten.chartNote') : '');

  const list = $('#sweetList');
  list.innerHTML = SWEETENERS.map((s) => {
    const nm = sweetenerName(s);
    return `
    <button type="button" role="radio" class="sweet-item" data-sw="${s.id}" aria-checked="${s.id === S.sweetenerId}">
      <span class="dot" aria-hidden="true"></span>
      <span><strong>${esc(nm.primary)}${nm.secondary ? `<span class="alt-name" lang="en">${esc(nm.secondary)}</span>` : ''}</strong><span class="d">${esc(sweetenerAbout(s))}</span></span>
    </button>`;
  }).join('');
  $$('[data-sw]', list).forEach((b) => b.addEventListener('click', () => {
    S.sweetenerId = b.dataset.sw;
    persist(); recompute(); renderHeader(); renderSweeten();
  }));

  const sw = findSweetener(S.sweetenerId);
  $('#sweetnessField').hidden = !sw.usesSweetness;
  $('#anchorField').hidden = sw.kind !== 'just';
  $('#sweetness').value = Math.round(S.sweetness * 100);
  $('#sweetnessOut').textContent = `${fmt(Math.round(S.sweetness * 100), 0)} %`;
  $$('[data-anchor]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.anchor === S.anchor)));

  const co = $('#customOffsets');
  co.hidden = sw.kind !== 'custom';
  if (sw.kind === 'custom' && co.dataset.lang !== currentLanguage() + S.terms) {
    co.dataset.lang = currentLanguage() + S.terms;
    const head = [0, 1, 2, 3, 4, 5].map((i) => `<th scope="col">${esc(stringShort(i))}</th>`).join('');
    const rowFor = (key, label) => `<tr><th scope="row">${esc(label)}</th>${S.custom[key].map((v, i) =>
      `<td><input type="number" step="0.1" min="-50" max="50" value="${v}" data-co="${key}" data-i="${i}" aria-label="${esc(t('customOffsets.cellAria', { row: label, string: stringName(i) }))}"></td>`).join('')}</tr>`;
    co.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rowFor('open', t('customOffsets.open'))}${rowFor('fret12', t('customOffsets.fret12'))}</tbody></table>
      <p class="note">${esc(t('customOffsets.note'))}</p>`;
    $$('[data-co]', co).forEach((inp) => inp.addEventListener('input', () => {
      const v = Math.max(-50, Math.min(50, Number(inp.value) || 0));
      S.custom[inp.dataset.co][Number(inp.dataset.i)] = v;
      persist(); recompute(); renderHeader(); renderSweeten();
    }));
  }

  // Temperaments.
  const tsel = $('#temperament');
  tsel.innerHTML = TEMPERAMENTS.map((x) => `<option value="${x.id}">${esc(temperamentName(x).text)}</option>`).join('');
  $('#temperRoot').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${esc(noteName(60 + i, S.flats))}</option>`).join('');
  tsel.value = S.temperamentId;
  $('#temperRoot').value = String(S.temperamentRoot);
  $('#temperRoot').disabled = S.temperamentId === 'equal';
  $('#temperAbout').textContent = temperamentAbout(currentTemperament());
  renderFitBlock();
}

function bindSweeten() {
  $('#sweetness').addEventListener('input', (e) => {
    S.sweetness = Number(e.target.value) / 100;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
  $$('[data-anchor]').forEach((b) => b.addEventListener('click', () => {
    S.anchor = b.dataset.anchor;
    persist(); recompute(); renderHeader(); renderSweeten();
  }));
  $('#temperament').addEventListener('change', (e) => {
    S.temperamentId = e.target.value;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
  $('#temperRoot').addEventListener('change', (e) => {
    S.temperamentRoot = Number(e.target.value);
    persist(); recompute(); renderHeader();
  });
}

function renderLearn() {
  const host = $('#learn');
  const refs = LEARN_REFS.map((id) => REFERENCES[id]).filter(Boolean);
  host.innerHTML = `<h1>${esc(t('learn.title'))}</h1>
    <p class="lede">${esc(t('learn.lede'))}</p>
    ${learnArticles().map((a) => `<article id="learn-${a.id}"><h2>${esc(a.title)}</h2>${a.body.map((p) => `<p>${esc(p)}</p>`).join('')}</article>`).join('')}
    <h2>${esc(t('learn.refs'))}</h2>
    <ol class="refs" lang="en">${refs.map((r) => `<li>${esc(r.cite)}${r.url ? ` <a href="${r.url}" target="_blank" rel="noopener">${esc(t('learn.link'))}</a>` : ''}</li>`).join('')}</ol>`;
}

function renderSettings() {
  const sel = $('#lang');
  if (!sel.options.length) sel.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}" lang="${l.code}">${l.name}</option>`).join('');
  sel.value = currentLanguage();
  $$('[data-terms]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.terms === S.terms)));
  $('#termExample').textContent = [
    tuningName('drop-d').text,
    term('capo'),
    term('strobe'),
    TUNINGS[0].notes.map((n) => noteName(parseNote(n))).join(' '),
    intervalNames([parseNote('E2'), parseNote('A2')])[0],
  ].join(listSep());
  $('#a4Label').textContent = t('a4.label', { note: noteLabel(69) });
  $('#a4').value = S.a4;
  $('#a4Out').textContent = `${fmt(S.a4, 1)} Hz`;
  $('#globalCents').value = S.globalCents;
  $('#globalOut').textContent = `${S.globalCents ? fmtSigned(S.globalCents, 1) : fmt(0, 1)} ¢`;
  $('#gate').value = S.gateDb;
  $('#gateOut').textContent = `−${fmt(Math.abs(S.gateDb), 0)} dB`;
  $$('[data-tol]').forEach((b) => {
    b.setAttribute('aria-checked', String(Number(b.dataset.tol) === S.tolerance));
    b.textContent = `±${fmt(Number(b.dataset.tol), Number(b.dataset.tol) % 1 ? 1 : 0)} ¢`;
  });
  $$('[data-lamp]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lamp === S.light)));
  $$('[data-panel]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.panel === S.theme)));
  $$('[data-hs]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hs === S.headstock)));
  $('#leftHanded').checked = S.leftHanded;
  $('#flats').checked = S.flats;
  $('#keepAwake').checked = S.keepAwake;
}

async function changeLanguage(code, terms) {
  S.lang = code;
  S.terms = terms;
  persist();
  await setLanguage(code, terms);
  applyI18n();
  renderAll();
  renderLearn();
  if (!$('#strumPanel').hidden) renderStrumPanel();
  showMicError();
  if (mic.running && !micError) $('#instruction').textContent = idleInstruction();
}

function bindSettings() {
  $('#lang').addEventListener('change', (e) => changeLanguage(e.target.value, S.terms));
  $$('[data-terms]').forEach((b) => b.addEventListener('click', () => changeLanguage(currentLanguage(), b.dataset.terms)));
  $('#a4').addEventListener('input', (e) => { S.a4 = Number(e.target.value); afterSetting(); });
  $$('[data-a4]').forEach((b) => b.addEventListener('click', () => { S.a4 = Number(b.dataset.a4); afterSetting(); }));
  $('#globalCents').addEventListener('input', (e) => { S.globalCents = Number(e.target.value); afterSetting(); });
  $('#gate').addEventListener('input', (e) => { S.gateDb = Number(e.target.value); afterSetting(); });
  $$('[data-tol]').forEach((b) => b.addEventListener('click', () => { S.tolerance = Number(b.dataset.tol); afterSetting(); }));
  $$('[data-lamp]').forEach((b) => b.addEventListener('click', () => { S.light = b.dataset.lamp; afterSetting(); applyTheme(); }));
  $$('[data-panel]').forEach((b) => b.addEventListener('click', () => { S.theme = b.dataset.panel; afterSetting(); applyTheme(); }));
  $$('[data-hs]').forEach((b) => b.addEventListener('click', () => { S.headstock = b.dataset.hs; afterSetting(); applyTheme(); }));
  $('#leftHanded').addEventListener('change', (e) => { S.leftHanded = e.target.checked; afterSetting(); applyTheme(); });
  $('#flats').addEventListener('change', (e) => { S.flats = e.target.checked; afterSetting(); renderAll(); });
  $('#keepAwake').addEventListener('change', (e) => { S.keepAwake = e.target.checked; afterSetting(); if (S.keepAwake && mic.running) requestWakeLock(); else releaseWakeLock(); });
  $('#resetAll').addEventListener('click', async () => {
    const keep = { customTunings: S.customTunings, lang: S.lang, terms: S.terms, guitars: S.guitars, guitarId: S.guitarId };
    S = { ...structuredClone(DEFAULTS), ...keep };
    persist(); recompute(); applyTheme(); renderAll();
  });
}

function afterSetting() {
  persist();
  recompute();
  renderHeader();
  renderSettings();
}

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = S.theme;
  root.dataset.light = S.light;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', S.theme === 'daylight' ? '#efe5d2' : '#3a2517');
  $('#headstock').classList.toggle('is-lefty', S.leftHanded);
  headstock.setLayout(S.headstock);
  requestAnimationFrame(() => view.readColors());
}

function renderAll() {
  renderHeader();
  renderTunings();
  renderCustomBuilder();
  renderSweeten();
  renderSettings();
}

// ── Boot ───────────────────────────────────────────────────────────────
async function boot() {
  const sr = document.createElement('p');
  sr.id = 'srStatus';
  sr.className = 'sr-only';
  sr.setAttribute('aria-live', 'polite');
  document.body.appendChild(sr);

  if (S.mode === 'manual') S.mode = 'auto';
  await setLanguage(S.lang || detectLanguage(), S.terms);
  recompute();
  applyTheme();
  applyI18n();
  renderAll();
  renderLearn();
  bindTune();
  bindCustomBuilder();
  bindSweeten();
  bindSettings();
  bindFit();
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.tab)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $('#hub').classList.add('is-idle');
  $('#instruction').textContent = idleInstruction();
  window.addEventListener('resize', () => view.resize());
  requestAnimationFrame(loop);

  // Offline support for the web version; the native apps bundle their files already.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
