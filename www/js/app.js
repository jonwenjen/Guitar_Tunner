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
import { captureStrum, analyzeLater, openWizard, fitTableHtml, renderTuneBoard, updateTuneRow, needsWork, boardAdvice } from './fit-ui.js';
import { DEFAULT_B, combineStrums } from './poly.js';
import { encodeWav, joinClips } from './wav.js';
import { shareFile, pickTextFile, stamp } from './share-file.js';
import { TunedCue } from './feedback.js';
import { estimateBridge, planBridge, responseMatrix } from './bridge.js';
import { loadSettings, saveSettings, DEFAULTS } from './store.js';
import { renderStrings, bindStrings, getSetup, setSetup, setOptionsHtml, selValue, selFromValue, sanitizeSel, sanitizeSetup } from './strings-ui.js';
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
  const before = targets.map((x) => x.freq);
  const tuning = currentTuning();
  sweet = sweetenerOffsets(findSweetener(S.sweetenerId), tuning, { sweetness: S.sweetness, anchor: S.anchor, custom: S.custom, profile: currentProfile() });
  targets = computeTargets({
    notes: tuning.notes, a4: S.a4, globalCents: S.globalCents, capo: S.capo,
    temperament: currentTemperament(), temperamentRoot: S.temperamentRoot, sweet, flats: useFlats(tuning),
  });
  tracker.reset();
  // Board readings are relative to the old targets: close it if any target moved.
  if (board && targets.some((x, i) => !before[i] || Math.abs(centsOf(x.freq, before[i])) > 0.01)) cancelStrumCheck(true);
}

function targetFreq(i) {
  const x = targets[i];
  if (!x) return 0;
  return S.intonation ? x.freq12 : x.freq;
}

// Temporary per-string reference offsets (cents): the floating-bridge guide parks each
// string a little off pitch so the strings tuned after it pull it into place.
const refOffset = [0, 0, 0, 0, 0, 0];
const refFreq = (i) => targetFreq(i) * Math.pow(2, (refOffset[i] || 0) / 1200);

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
        if (a4cal) a4calLock(r);
        else chooseReference(r.freq);
      }
    }
    const er = engine.read();
    if (a4cal) a4calRead(er, now);
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
    if (tunedTracker.update(activeString, reading.cents, dt, S.tolerance)) {
      announce(t('sr.tuned', { string: stringName(activeString) }));
      cue.play({ vibrate: S.cueVibrate, sound: S.cueSound });
      boardTuned(activeString);
    }
  }

  const strobeOn = !!(reading && reading.sounding);
  view.draw({
    phases: reading?.strobe.phases, mags: reading?.strobe.mags, level,
    active: strobeOn, cents: reading ? reading.cents : null, tolerance: S.tolerance,
  });
  renderReadout(reading, level);
  boardLive(reading, now);
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
  if (activeString >= 0) engine.setReference(refFreq(activeString));
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
  syncBoardMode();
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

// ── Strum check and tune board ─────────────────────────────────────────
// One strum (or the median of three) fills the board; then each string can be tuned
// on its own. A single plucked string reads with McLeod clarity ≥ 0.98 while a
// ringing chord stays below 0.6, so rows only take live readings that are clearly
// one string.
const LIVE_CLARITY = 0.93;
const LIVE_SETTLE_MS = 250;
let board = null;      // { rows, focus, live, guided, finished, queue, prev, tau, clips, results, message }
let boardBusy = false; // true while the board itself changes the tuner mode
let boardTick = 0;
let guideTimer = 0;
let strumMode = 'normal'; // 'normal' | 'fit' | 'capo' | 'bridge'
let strumToken = 0;        // bumped on cancel so late analyses are dropped
let bridgeCal = null;      // { before } while measuring the bridge coupling
const cue = new TunedCue(() => mic.ctx || ownCtx);

function strumLabels() {
  return targets.map((x, i) => `${stringShort(i)} · ${noteLabel(x.midi, useFlats())}`);
}
const boardTol = () => Math.max(S.tolerance, 1);
function boardOpts() {
  return {
    labels: strumLabels(), tolerance: boardTol(), liveTolerance: S.tolerance, t, fmtSigned, stringName,
    focus: board ? board.focus : -1, live: board ? board.live : -1,
    // While measuring the bridge only the detuned string needs advice, and its goal is +20…+45 ¢.
    advice: bridgeCal ? (i, row) => (i === 0 ? detuneAdvice(row) : '') : null,
  };
}

const DETUNE_LO = 20, DETUNE_HI = 45;
function detuneAdvice(row) {
  if (!hasValue(row)) return t('board.pluckFocus');
  if (row.cents < DETUNE_LO) return t('board.advice', { dir: t('board.tighten'), size: t(row.cents < DETUNE_LO - 15 ? 'board.size.big' : 'board.size.small') });
  if (row.cents > DETUNE_HI) return t('board.advice', { dir: t('board.loosen'), size: t('board.size.small') });
  return t('bridge.detuneOk');
}
const showSharedHint = () => board.rows.some((r) => r && !r.predicted && (r.state === 'shared' || r.state === 'unsure'));
const bridgeActive = () => !!(S.bridgeComp && S.bridge && Array.isArray(S.bridge.q) && S.bridge.q.length === 6);
const hasValue = (r) => !!r && (r.state === 'ok' || r.state === 'unsure' || r.state === 'live') && Number.isFinite(r.cents);

function ensurePanelVisible() {
  const panel = $('#strumPanel');
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

/** Panel while a strum is being captured or analysed (no board yet). */
function renderStrumPanel(status) {
  const panel = $('#strumPanel');
  const opening = panel.hidden;
  panel.hidden = false;
  if (board) { renderBoard(); if (opening) ensurePanelVisible(); return; }
  if (status !== undefined) $('#strumStatus').textContent = status;
  renderTuneBoard($('#strumRows'), targets.map(() => null), boardOpts());
  $('#strumPlan').hidden = true;
  $('#strumHint').hidden = true;
  $('#strumGuide').hidden = true;
  $('#strumStop').hidden = true;
  $('#strumExport').hidden = true;
  $('#boardFocusCard').hidden = true;
  renderStrumOptions();
  if (opening) ensurePanelVisible();
}

function boardStatus() {
  const tol = boardTol();
  if (bridgeCal) return t('bridge.detune', { string: stringName(0) });
  if (board.guided) {
    if (board.finished) return t('board.allDone');
    const i = board.focus;
    return t('board.now', { string: stringName(i), i: board.queue.indexOf(i) + 1, n: board.queue.length });
  }
  if (board.focus >= 0) return t('board.focused', { string: stringName(board.focus) });
  const read = board.rows.filter((r) => r && (r.state === 'ok' || r.state === 'live'));
  const ok = read.filter((r) => !needsWork(r, tol, S.tolerance)).length;
  return t('strum.summary', { ok, read: read.length, tol: fmt(tol, tol % 1 ? 1 : 0) });
}

function capoAdvice() {
  const vals = board.strumCents.filter((v) => v !== null);
  if (!vals.length) return '';
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (m > 2) return t('board.capoSharp', { c: fmt(m, 1) });
  if (m < -2) return t('board.capoFlat', { c: fmt(-m, 1) });
  return t('board.capoOk');
}

function boardPlan() {
  const tol = boardTol();
  const lines = [];
  if (board.message) lines.push(board.message);
  if (bridgeCal) { lines.push(t('bridge.detuneHow', { string: stringName(0) })); return lines.join('\n'); }
  if (strumMode === 'capo' && !board.guided) lines.push(capoAdvice());
  if (board.guided) {
    if (board.finished) lines.push(t('board.retune'));
    else if (board.tau) lines.push(t('bridge.guideNote'));
    return lines.filter(Boolean).join('\n');
  }
  const todo = board.rows.map((_, i) => i).filter((i) => needsWork(board.rows[i], tol, S.tolerance));
  if (!todo.length) lines.push(t('board.allGood'));
  else if (board.focus >= 0) lines.push(t('board.retune'));
  else {
    lines.push(t('board.order', { list: todo.map((i) => stringShort(i)).join(' → ') }));
    lines.push(bridgeActive() ? t('bridge.planNote') : t('board.retune'));
  }
  return lines.filter(Boolean).join('\n');
}

/** Full redraw of the board: rows, focus card, status, advice and buttons. */
function renderBoard() {
  if (!board) return;
  const tol = boardTol();
  renderTuneBoard($('#strumRows'), board.rows, boardOpts());
  refreshBoardText();
  renderFocusCard();
  const todo = board.rows.some((r) => needsWork(r, tol, S.tolerance));
  $('#strumGuide').hidden = board.guided || !!bridgeCal || !(todo || bridgeActive());
  $('#strumStop').hidden = !board.guided || board.finished;
  $('#strumAgain').hidden = !!bridgeCal;
  $('#strumAgain').classList.toggle('is-on', (!todo || board.finished) && !bridgeCal);
  $('#strumExport').hidden = !(board.clips && board.clips.length);
  $('#strumHint').hidden = !showSharedHint();
  renderStrumOptions();
}

function refreshBoardText() {
  const status = boardStatus();
  const statusEl = $('#strumStatus');
  if (statusEl.textContent !== status) statusEl.textContent = status;
  const plan = boardPlan();
  const planEl = $('#strumPlan');
  planEl.hidden = !plan;
  if (planEl.textContent !== plan) planEl.textContent = plan;
}

/** Large live display of the string being tuned, readable at arm's length. */
function renderFocusCard() {
  const card = $('#boardFocusCard');
  const i = board ? board.focus : -1;
  card.hidden = i < 0;
  if (i < 0) return;
  const row = board.rows[i];
  const tau = refOffset[i] || 0;
  const live = board.live === i;
  const value = hasValue(row) ? row.cents - tau : null;
  const tol = row && row.state === 'live' ? S.tolerance : boardTol();
  const set = (sel, text) => { const el = $(sel, card); if (el.textContent !== text) el.textContent = text; };
  set('.bf-name', `${stringName(i)} · ${noteLabel(targets[i].midi, useFlats())}`);
  set('.bf-cents', value === null ? '—' : `${fmtSigned(value, 1)} ¢`);
  let advice = t('board.pluckFocus');
  if (bridgeCal) advice = detuneAdvice(row);
  else if (value !== null) advice = boardAdvice({ ...row, cents: value }, boardTol(), t, S.tolerance);
  set('.bf-advice', advice);
  let note = '';
  if (bridgeCal) note = t('bridge.detuneTarget');
  else if (tau) note = t('bridge.tempTarget', { c: fmtSigned(tau, 1) });
  else if (!live && value !== null && row.state !== 'live') note = t('board.fromStrum');
  set('.bf-note', note);
  const dot = $('.bf-gauge i', card);
  dot.hidden = value === null;
  if (value !== null) dot.style.left = `${50 + (Math.max(-10, Math.min(10, value)) / 10) * 50}%`;
  const w = (tol / 10) * 50;
  $('.bf-gauge b', card).style.cssText = `left:${50 - w}%;width:${2 * w}%`;
  const inTol = value !== null && (bridgeCal ? value >= DETUNE_LO && value <= DETUNE_HI : Math.abs(value) <= tol);
  card.classList.toggle('is-ok', inTol);
  card.classList.toggle('is-off', value !== null && !inTol);
  card.classList.toggle('is-live', live);
}

/** Called every animation frame: feed a clean single-string reading into its row. */
function boardLive(reading, now) {
  if (!board || strumBusy) return;
  let live = -1;
  let moved = false;
  const clean = reading && reading.sounding && reading.cents !== null && activeString >= 0
    && S.mode !== 'chromatic' && !S.intonation && engine?.ref
    && lastMpm && lastMpm.freq && lastMpm.clarity >= LIVE_CLARITY
    && Math.abs(centsOf(lastMpm.freq, engine.ref)) < 60 && Math.abs(reading.cents) < 60;
  // Skip the pluck's attack: take readings only once the string has read cleanly for a moment.
  const cand = clean ? activeString : -1;
  if (cand !== board.cand) { board.cand = cand; board.candAt = now; }
  if (cand >= 0 && now - board.candAt >= LIVE_SETTLE_MS) {
    live = cand;
    const prev = board.rows[live];
    // Rows always show the deviation from the final target, even while the reference
    // sits on a temporary floating-bridge target.
    board.rows[live] = { cents: reading.cents + (refOffset[live] || 0), state: 'live', done: prev ? !!prev.done : false };
    if (board.guided && board.tau && live === board.focus) moved = propagateBridge(live);
  }
  const changedRow = live !== board.live;
  const was = board.live;
  board.live = live;
  if (!changedRow && !moved && now - boardTick < 66) return; // ~15 updates a second is plenty
  boardTick = now;
  const o = boardOpts();
  const el = $('#strumRows');
  if (moved) board.rows.forEach((r, i) => updateTuneRow(el, i, r, o));
  else {
    if (was >= 0 && was !== live) updateTuneRow(el, was, board.rows[was], o);
    if (live >= 0) updateTuneRow(el, live, board.rows[live], o);
  }
  if (board.focus >= 0 && (live === board.focus || was === board.focus)) renderFocusCard();
  if (changedRow || live >= 0) {
    refreshBoardText();
    const todo = board.rows.some((r) => needsWork(r, boardTol(), S.tolerance));
    $('#strumGuide').hidden = board.guided || !!bridgeCal || !(todo || bridgeActive());
    $('#strumAgain').classList.toggle('is-on', (!todo || board.finished) && !bridgeCal);
    $('#strumHint').hidden = !showSharedHint();
  }
}

/**
 * Floating bridge: as the focused string is turned, the bridge tilts and moves the
 * others. Carry each change over to the other rows with the measured coupling, so
 * they show where every string now sits (≈, until the confirming strum).
 */
function propagateBridge(j) {
  const cur = board.rows[j].cents;
  const prev = board.lastLive[j];
  board.lastLive[j] = cur;
  if (prev === undefined) return false; // first reading of this string in the pass: baseline only
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return false;
  board.rows.forEach((r, i) => {
    if (i === j || !hasValue(r)) return;
    r.cents += board.R[i][j] * d;
    r.state = 'unsure';
    r.predicted = true;
  });
  return true;
}

/** The tuned tracker confirmed a string (held in tolerance): advance the guide. */
function boardTuned(i) {
  if (!board || board.live !== i || bridgeCal) return;
  board.rows[i].done = true;
  if (board.guided && board.focus === i) {
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => { if (board && board.guided && board.focus === i) guideNext(); }, 900);
  }
}

function boardFocus(i) {
  if (!board) return;
  if (!board.prev) board.prev = { mode: S.mode, locked: lockedString };
  board.focus = i;
  boardBusy = true;
  lockedString = i;
  activeString = i;
  setMode('manual');
  boardBusy = false;
  refOffset.fill(0);
  if (board.guided && board.tau) refOffset[i] = board.tau[i] || 0;
  if (engine) engine.setReference(refFreq(i));
  tunedTracker.tuned[i] = false;
  tunedTracker.timeIn[i] = 0;
  if (board.rows[i]) board.rows[i].done = false;
  renderBoard();
  if (tone.playing) tone.play(targetFreq(i));
}

/** Give the tuner back the mode it had before the board took over. */
function boardRelease() {
  refOffset.fill(0);
  if (!board) return;
  clearTimeout(guideTimer);
  board.focus = -1;
  if (board.prev) {
    const { mode, locked } = board.prev;
    board.prev = null;
    boardBusy = true;
    lockedString = mode === 'manual' ? locked : -1;
    setMode(mode);
    boardBusy = false;
  }
}

function startGuide() {
  if (!board || bridgeCal) return;
  const tol = boardTol();
  board.message = '';
  if (bridgeActive()) {
    // On a floating bridge every string moves when any string is tuned, so go through
    // all six, low to high, each to the temporary target that lets the strings tuned
    // after it pull it onto pitch.
    board.queue = [0, 1, 2, 3, 4, 5];
    const x = board.rows.map((r) => (hasValue(r) ? r.cents : 0));
    board.tau = planBridge(x, S.bridge.q, board.queue).tau.map((v) => Math.max(-40, Math.min(40, v)));
    board.R = responseMatrix(S.bridge.q);
    board.lastLive = {};
    board.rows.forEach((r) => { if (r) r.done = false; });
  } else {
    board.tau = null;
    board.queue = board.rows.map((_, i) => i).filter((i) => needsWork(board.rows[i], tol, S.tolerance));
  }
  if (!board.queue.length) return;
  board.guided = true;
  board.finished = false;
  boardFocus(board.queue[0]);
}

function guideNext() {
  const at = board.queue.indexOf(board.focus);
  const order = at < 0 ? board.queue : [...board.queue.slice(at + 1), ...board.queue.slice(0, at)];
  const next = order.find((i) => !(board.rows[i] && board.rows[i].done));
  if (next === undefined) {
    board.finished = true;
    board.tau = null;
    boardRelease();
    renderBoard();
    announce(t('board.allDone'));
    cue.play({ vibrate: S.cueVibrate, sound: S.cueSound, done: true });
    return;
  }
  boardFocus(next);
}

function stopGuide() {
  if (!board) return;
  board.guided = false;
  board.finished = false;
  board.tau = null;
  boardRelease();
  renderBoard();
}

function onBoardTap(e) {
  const li = e.target.closest('[data-i]');
  if (!li || !board || bridgeCal) return;
  const i = Number(li.dataset.i);
  if (board.guided) {
    if (board.finished) { board.guided = false; board.finished = false; }
    else if (!board.queue.includes(i)) board.queue.splice(board.queue.indexOf(board.focus) + 1, 0, i);
    boardFocus(i);
    return;
  }
  if (board.focus === i) { boardRelease(); renderBoard(); } else boardFocus(i);
}

/** Keep the board in step when the user changes the tuner mode or taps the headstock. */
function syncBoardMode() {
  if (!board || boardBusy) return;
  // Leaving locked mode means the user took control; re-locking on another string
  // (headstock tap during the guide) keeps the mode to restore afterwards.
  if (S.mode !== 'manual') board.prev = null;
  board.focus = S.mode === 'manual' ? lockedString : -1;
  if (board.guided && S.mode !== 'manual') { board.guided = false; board.finished = false; board.tau = null; refOffset.fill(0); }
  if (board.guided && board.tau && board.focus >= 0) {
    refOffset.fill(0);
    refOffset[board.focus] = board.tau[board.focus] || 0;
  }
  renderBoard();
}

/** Step 6 of fitting a guitar: strum against the new targets, then get guided string by string. */
function tuneToGuitar() {
  showView('tune');
  startStrumCheck({ mode: 'fit' });
}

function setStrumTitle() {
  const key = { fit: 'board.titleFit', capo: 'board.titleCapo', bridge: 'board.titleBridge' }[strumMode] || 'strum.title';
  $('#strumTitle').textContent = t(key);
}

/** Options under the board: strums per check, floating bridge. */
function renderStrumOptions() {
  $$('[data-takes]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.takes) === (S.strumTakes === 3 ? 3 : 1))));
  $('#bridgeToggle').checked = !!S.bridgeComp;
  const busy = strumBusy || !!bridgeCal;
  $('#bridgeMeasure').hidden = !S.bridgeComp || busy;
  $('#bridgeMeasure').textContent = S.bridge ? t('bridge.remeasure') : t('bridge.measure');
  $('#bridgeNext').hidden = !bridgeCal;
  let info = t('bridge.off');
  if (S.bridgeComp) {
    info = S.bridge
      ? t('bridge.info', { date: S.bridge.date, c: fmt(S.bridge.drop10 ?? 0, 1), string: stringName(0) })
      : t('bridge.none');
  }
  $('#bridgeInfo').textContent = info;
}

// Stiffness prior for the strum analysis: the measured guitar if there is one, else
// the last strum that fitted it, else a typical set. Stiffness falls with tension
// (∝ 1/f²) and rises as a capo shortens the string (∝ 1/L²).
function stiffnessPrior(i) {
  const nowMidi = parseNote(currentTuning().notes[i]);
  const capo = Math.pow(2, (2 * S.capo) / 12);
  const prof = currentProfile();
  const p = prof?.strings?.[i];
  if (p && p.B > 0) return p.B * Math.pow(2, (2 * ((p.midi ?? nowMidi) - nowMidi)) / 12) * capo;
  const last = S.stringB?.[i];
  if (last && last.B > 0) return last.B * Math.pow(2, (2 * (last.midi - nowMidi)) / 12) * capo;
  return DEFAULT_B[i] * capo;
}
function rememberStiffness(res) {
  const notes = currentTuning().notes;
  const capo = Math.pow(2, (2 * S.capo) / 12);
  const store = Array.isArray(S.stringB) ? S.stringB.slice(0, 6) : [];
  let changed = false;
  res.strings.forEach((x, i) => {
    if (x.state !== 'ok' || !x.Bfitted || !(x.B > 1e-6 && x.B < 1e-3)) return;
    store[i] = { midi: parseNote(notes[i]), B: Number((x.B / capo).toPrecision(4)) };
    changed = true;
  });
  if (changed) { S.stringB = store; persist(); }
}
const strumExpected = () => targets.map((x, i) => ({ freq: x.freq, B: stiffnessPrior(i) }));

/**
 * Capture and analyse `takes` strums in a row (median later).
 * @returns {Promise<{results:object[], clips:object[], timeout?:boolean}|null>} null if cancelled
 */
async function runStrumTakes({ takes, prompt, expected, next = false }) {
  const token = strumToken;
  const results = [], clips = [];
  let misses = 0;
  while (results.length < takes) {
    const k = results.length;
    const head = takes > 1 ? `${t('wiz.takeOf', { i: k + 1, n: takes })} · ` : '';
    $('#strumStatus').textContent = head + (k === 0 && !next ? prompt : t('wiz.strumNext'));
    const session = captureStrum({ sampleRate: () => mic.sampleRate, addBlockListener }, (st) => {
      if (st === 'recording') $('#strumStatus').textContent = head + t('strum.recording');
    });
    strumSession = session;
    const clip = await session.promise;
    if (token !== strumToken) return null;
    strumSession = null;
    if (!clip) return { results, clips, timeout: true };
    $('#strumStatus').textContent = head + t('strum.analyzing');
    const res = await analyzeLater(clip, mic.sampleRate, expected);
    if (token !== strumToken) return null;
    if (!res.ok) {
      if (++misses >= 3) return { results, clips, timeout: true };
      continue;
    }
    results.push(res);
    clips.push({ samples: Float32Array.from(clip.samples), onset: clip.onset });
  }
  return { results, clips };
}

function prepareStrum(mode) {
  cancelStrumCheck(false);
  if (board) { stopGuide(); board = null; }
  bridgeCal = null;
  // The board compares open strings with their string targets, so it cannot run in
  // 12th-fret mode (targets an octave up) or chromatic mode (no string targets).
  if (S.intonation) {
    S.intonation = false;
    $('#intonation').checked = false;
    tracker.reset();
    tunedTracker.reset();
    persist();
  }
  if (S.mode === 'chromatic') setMode('auto');
  strumMode = mode;
  setStrumTitle();
  strumBusy = true;
  $('#strumAgain').hidden = true;
  $('#strumAgain').classList.remove('is-on');
}

function makeBoard(res, out) {
  const rows = res.strings.map((x) => ({ cents: hasValue(x) ? x.cents : null, state: x.state, done: false }));
  return {
    rows,
    strumCents: rows.map((r) => (r.state === 'ok' ? r.cents : null)),
    focus: -1, live: -1, cand: -1, candAt: 0, guided: false, finished: false, queue: [], prev: null, tau: null,
    clips: out.clips, results: out.results, combined: out.results.length > 1 ? res : null, message: '',
  };
}

async function startStrumCheck(opts = {}) {
  const mode = (opts && opts.mode) || 'normal';
  if (!mic.running) {
    await startMic();
    if (!mic.running) return;
  }
  prepareStrum(mode);
  const prompt = { fit: t('board.fitListen'), capo: t('board.capoListen') }[mode] || t('strum.listen');
  renderStrumPanel(prompt);
  $('#instruction').className = 'instruction';
  $('#instruction').textContent = prompt;
  const out = await runStrumTakes({ takes: S.strumTakes === 3 ? 3 : 1, prompt, expected: strumExpected() });
  if (!out) return;
  strumBusy = false;
  $('#strumAgain').hidden = false;
  if (!out.results.length) { renderStrumPanel(t('strum.timeout')); return; }
  const res = out.results.length > 1 ? combineStrums(out.results) : out.results[0];
  rememberStiffness(res);
  // Tick the strings the strum confirmed, clear the ones it found out of tune.
  const tol = boardTol();
  res.strings.forEach((x, i) => {
    if (x.state !== 'ok') return;
    tunedTracker.tuned[i] = Math.abs(x.cents) <= tol;
    tunedTracker.timeIn[i] = 0;
  });
  board = makeBoard(res, out);
  renderBoard();
  ensurePanelVisible();
  // Fitting a guitar: go straight into the string-by-string guide.
  if (mode === 'fit' && board.rows.some((r) => needsWork(r, boardTol(), S.tolerance))) startGuide();
}

/** Floating bridge, step 1: a reference strum, then detune the 6th string on purpose. */
async function measureBridge() {
  if (!mic.running) {
    await startMic();
    if (!mic.running) return;
  }
  prepareStrum('bridge');
  renderStrumPanel(t('bridge.step1'));
  const out = await runStrumTakes({ takes: 1, prompt: t('bridge.step1'), expected: strumExpected() });
  if (!out) return;
  strumBusy = false;
  $('#strumAgain').hidden = false;
  if (!out.results.length) { renderStrumPanel(t('strum.timeout')); return; }
  board = makeBoard(out.results[0], out);
  bridgeCal = { before: out.results[0].strings.map((x) => (hasValue(x) ? x.cents : null)) };
  renderBoard();
  boardFocus(0); // watch the 6th string live while detuning it
  ensurePanelVisible();
}

/** Floating bridge, step 2: strum again and see how far the other strings moved. */
async function finishBridge() {
  if (!bridgeCal) return;
  const before = bridgeCal.before;
  const expected = strumExpected();
  boardRelease();
  bridgeCal = null;
  prepareStrum('bridge');
  renderStrumPanel(t('bridge.step2'));
  const out = await runStrumTakes({ takes: 1, prompt: t('bridge.step2'), expected });
  if (!out) return;
  strumBusy = false;
  $('#strumAgain').hidden = false;
  if (!out.results.length) { renderStrumPanel(t('strum.timeout')); return; }
  const after = out.results[0].strings.map((x) => (hasValue(x) ? x.cents : null));
  const est = estimateBridge(before, after, 0);
  board = makeBoard(out.results[0], out);
  if (est.ok) {
    const others = est.rho.filter((r) => r !== null);
    const drop10 = -10 * others.reduce((a, b) => a + b, 0) / others.length;
    S.bridge = { q: est.q.map((v) => Number(v.toFixed(3))), date: new Date().toISOString().slice(0, 10), dj: Number(est.dj.toFixed(1)), drop10: Number(drop10.toFixed(2)) };
    S.bridgeComp = true;
    persist();
    board.message = t('bridge.measured', { string: stringName(0), d: fmtSigned(est.dj, 0), c: fmt(drop10, 1) });
  } else if (est.reason === 'small') {
    board.message = t('bridge.tooSmall', { string: stringName(0), d: fmtSigned(est.dj, 1) });
  } else {
    board.message = t('bridge.unread');
  }
  renderBoard();
  ensurePanelVisible();
}

/** Save the board's strums as a WAV with the readings inside, for diagnosis. */
async function exportBoardClips() {
  if (!board || !board.clips || !board.clips.length) return;
  const sr = mic.sampleRate;
  const { samples, starts } = joinClips(board.clips.map((c) => c.samples), sr);
  const slim = (s) => ({
    state: s.state, cents: Number.isFinite(s.cents) ? Number(s.cents.toFixed(2)) : null,
    freq: s.freq ? Number(s.freq.toFixed(4)) : null, B: s.B ? Number(s.B.toPrecision(3)) : null,
    partials: s.partials ? s.partials.length : 0, rms: Number.isFinite(s.rms) ? Number(s.rms.toFixed(3)) : null,
  });
  const meta = {
    app: 'strobe-tuner', kind: `strum-${strumMode}`, date: new Date().toISOString(), sampleRate: sr,
    tuning: currentTuning().notes, capo: S.capo, a4: S.a4, globalCents: S.globalCents, sweetener: S.sweetenerId,
    targets: targets.map((x) => Number(x.freq.toFixed(4))),
    takes: board.results.map((r, k) => ({ start: starts[k], onset: board.clips[k].onset, strings: r.strings.map(slim) })),
    median: board.combined ? board.combined.strings.map(slim) : null,
    ua: navigator.userAgent,
  };
  const bytes = encodeWav(samples, sr, { comment: JSON.stringify(meta) });
  const how = await shareFile(bytes, `strum-${stamp()}.wav`, 'audio/wav', { title: t('export.title') });
  if (how === 'downloaded') announce(t('export.saved'));
}

function cancelStrumCheck(hide = true) {
  strumToken++;
  if (strumSession) strumSession.cancel();
  strumSession = null;
  strumBusy = false;
  if (hide) {
    bridgeCal = null;
    if (board) { board.guided = false; board.tau = null; boardRelease(); }
    refOffset.fill(0);
    board = null;
    strumMode = 'normal';
    setStrumTitle();
    $('#strumPanel').hidden = true;
  }
}

// ── A4 from a reference note ───────────────────────────────────────────
// Play one long note on the instrument you are joining (piano, keyboard, tuning
// fork). The strobe locks on the nearest equal-tempered note at A4 = 440 Hz and
// reads its deviation; A4 is then set so that note becomes the reference.
let a4cal = null;   // { start, readings, midi, prev }
let a4Undo = null;
const median = (v) => { const a = v.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

async function startA4Cal() {
  if (!mic.running) {
    await startMic();
    if (!mic.running) return;
  }
  cancelStrumCheck(true);
  a4cal = { start: performance.now(), readings: [], midi: null, prev: S.a4 };
  activeString = -1; // the strobe follows the reference note, not a string
  $('#a4Cal').disabled = true;
  $('#a4Undo').hidden = true;
  $('#a4CalStatus').textContent = t('a4cal.listen');
}

function a4calLock(r) {
  if (r.clarity < 0.93) return;
  const midi = Math.round(freqToMidi(r.freq, 440));
  if (midi !== a4cal.midi) {
    a4cal.midi = midi;
    a4cal.readings = [];
    engine.setReference(440 * Math.pow(2, (midi - 69) / 12));
  }
}

function a4calRead(er, now) {
  if (now - a4cal.start > 15000) { finishA4Cal(null); return; }
  if (a4cal.midi === null || !er.valid || Math.abs(er.cents) > 50) return;
  if (!(lastMpm && lastMpm.freq && lastMpm.clarity >= 0.93)) return;
  const rs = a4cal.readings;
  rs.push(er.cents);
  if (rs.length > 150) rs.shift();
  if (rs.length >= 60) {
    const m = median(rs);
    if (median(rs.map((c) => Math.abs(c - m))) < 0.6) finishA4Cal(m);
  }
}

function finishA4Cal(c) {
  const st = a4cal;
  a4cal = null;
  $('#a4Cal').disabled = false;
  if (c === null) { $('#a4CalStatus').textContent = t('a4cal.timeout'); return; }
  // The heard note becomes the target: midiToFreq(midi, a4) · 2^(global/1200) = heard.
  const hz = Math.round(440 * Math.pow(2, (c - S.globalCents) / 1200) * 10) / 10;
  a4Undo = st.prev;
  S.a4 = Math.max(350, Math.min(550, hz));
  afterSetting();
  $('#a4Undo').hidden = false;
  $('#a4CalStatus').textContent = t('a4cal.done', { note: noteLabel(st.midi), c: fmtSigned(c, 1), hz: fmt(S.a4, 1) });
}

// ── Guitar profile files ───────────────────────────────────────────────
async function exportGuitars() {
  if (!S.guitars.length) return;
  const stringSetups = Object.fromEntries(S.guitars.filter((g) => (S.stringSetups || {})[g.id]).map((g) => [g.id, S.stringSetups[g.id]]));
  const data = { app: 'strobe-tuner', type: 'guitar-profiles', version: 1, exported: new Date().toISOString(), guitars: S.guitars, bridge: S.bridge || null, stringSetups };
  const how = await shareFile(JSON.stringify(data, null, 1), `guitars-${stamp()}.json`, 'application/json', { title: t('fit.exportTitle') });
  $('#fitIO').textContent = how === 'cancelled' ? '' : t('fit.exported', { n: S.guitars.length });
}

const finiteOr0 = (v) => (Number.isFinite(v) ? v : 0);
function cleanProfile(g) {
  if (!g || typeof g !== 'object' || typeof g.name !== 'string') return null;
  if (!Array.isArray(g.notes) || g.notes.length !== 6 || !Array.isArray(g.strings) || g.strings.length !== 6) return null;
  if (!Number.isFinite(g.scaleMm) || g.scaleMm < 300 || g.scaleMm > 1200) return null;
  try { g.notes.forEach((n) => { if (!Number.isFinite(parseNote(n))) throw new Error('note'); }); } catch { return null; }
  const strings = g.strings.map((x) => {
    if (!x || typeof x !== 'object' || !x.model) return null;
    return {
      midi: finiteOr0(x.midi), B: Number.isFinite(x.B) && x.B > 0 && x.B < 0.01 ? x.B : 5e-5,
      amps: Array.isArray(x.amps) ? x.amps.slice(0, 8).map(finiteOr0) : [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12],
      openMeasured: !!x.openMeasured,
      points: Array.isArray(x.points) ? x.points.filter((p) => p && Number.isFinite(p.k) && Number.isFinite(p.d)).map((p) => ({ k: p.k, d: p.d })) : [],
      model: { alpha: finiteOr0(x.model.alpha), beta: finiteOr0(x.model.beta), gamma: finiteOr0(x.model.gamma) },
      saddleMm: finiteOr0(x.saddleMm),
    };
  });
  if (!strings.some(Boolean)) return null;
  return {
    id: typeof g.id === 'string' ? g.id.slice(0, 40) : `g${Date.now().toString(36)}`,
    name: g.name.slice(0, 40), scaleMm: g.scaleMm, notes: g.notes.slice(), strings,
    created: typeof g.created === 'string' ? g.created.slice(0, 10) : new Date().toISOString().slice(0, 10),
    stringSet: sanitizeSel(g.stringSet),
  };
}

async function importGuitars() {
  const text = await pickTextFile();
  if (text === null) return;
  let data;
  try { data = JSON.parse(text); } catch { $('#fitIO').textContent = t('fit.importBad'); return; }
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.guitars) ? data.guitars : [data]);
  let added = 0, last = null;
  for (const raw of list) {
    const g = cleanProfile(raw);
    if (!g) continue;
    const fileId = g.id;
    const same = S.guitars.find((x) => x.id === g.id);
    if (same && same.name === g.name && same.created === g.created) { last = same.id; continue; } // already here
    if (same) g.id = `g${Date.now().toString(36)}${added}`;
    S.guitars.push(g);
    const setup = data && data.stringSetups && typeof data.stringSetups === 'object' ? data.stringSetups[fileId] : null;
    setSetup(S, g.id, setup ? sanitizeSetup(setup) : { current: g.stringSet, scaleMm: g.scaleMm });
    last = g.id;
    added++;
  }
  const bq = data && data.bridge && Array.isArray(data.bridge.q) && data.bridge.q.length === 6 && data.bridge.q.every(Number.isFinite) ? data.bridge : null;
  if (bq && !S.bridge) S.bridge = { q: bq.q.slice(), date: String(bq.date || ''), dj: finiteOr0(bq.dj), drop10: finiteOr0(bq.drop10) };
  if (!last) { $('#fitIO').textContent = t('fit.importBad'); return; }
  S.guitarId = last;
  S.stringsKey = last;
  S.sweetenerId = 'guitar-fit';
  persist(); recompute(); renderHeader(); renderSweeten();
  $('#fitIO').textContent = added ? t('fit.imported', { n: added }) : t('fit.importSame');
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
    t, fmt, fmtSigned, stringName, stringShort, listSep,
    appInfo: () => ({ a4: S.a4, globalCents: S.globalCents, capo: S.capo }),
    stringNote: (i, k) => noteLabel(parseNote(tuning.notes[i]) + k, useFlats(tuning)),
    tuning: () => tuning,
    tuningLabel: () => nameOf(tuning).text,
    openTargets: openTargetsForMeasuring,
    ensureMic: async () => { if (!mic.running) await startMic(); return mic.running; },
    sampleRate: () => mic.sampleRate,
    addBlockListener,
    goal: () => S.sweetness,
    existingNames: () => S.guitars.map((g) => g.name),
    strings: wizardStrings(),
    onSave: (profile, goal) => {
      S.guitars.push(profile);
      S.guitarId = profile.id;
      // The guitar starts with the string setup the user had open, and the strings it was measured with.
      setSetup(S, profile.id, { ...getSetup(S, stringsKey()), current: profile.stringSet || { kind: 'unknown' }, scaleMm: profile.scaleMm });
      S.stringsKey = profile.id;
      S.sweetenerId = 'guitar-fit';
      if (typeof goal === 'number') S.sweetness = goal;
      persist(); recompute(); renderHeader(); renderSweeten();
      $('#sweetNote').textContent = t('wiz.saved');
    },
    onTune: tuneToGuitar,
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
  $('#fitTune').hidden = !S.guitars.length;
  $('#fitExport').hidden = !S.guitars.length;
  $('#fitEmpty').hidden = !!S.guitars.length;
  const prof = currentProfile();
  if (prof) sel.value = prof.id;
  $('#fitMeta').textContent = prof ? t('fit.measured', { date: prof.created, tuning: prof.notes.map((n) => noteName(parseNote(n), useFlats())).join(' ') }) : '';
  $('#fitTable').innerHTML = prof ? fitTableHtml(prof, { t, fmt, fmtSigned, stringShort, listSep }) : '';
  $('#fitSaddleNote').textContent = prof ? t('fit.saddleNote', { mm: prof.scaleMm }) : '';
}

function bindFit() {
  $('#strumBtn').addEventListener('click', () => startStrumCheck());
  $('#strumAgain').addEventListener('click', () => startStrumCheck({ mode: strumMode === 'bridge' ? 'normal' : strumMode }));
  $('#strumExport').addEventListener('click', exportBoardClips);
  $('#capoCheck').addEventListener('click', () => startStrumCheck({ mode: 'capo' }));
  $$('[data-takes]').forEach((b) => b.addEventListener('click', () => {
    S.strumTakes = Number(b.dataset.takes) === 3 ? 3 : 1;
    persist();
    renderStrumOptions();
  }));
  $('#bridgeToggle').addEventListener('change', (e) => {
    S.bridgeComp = e.target.checked;
    persist();
    if (board) renderBoard(); else renderStrumOptions();
  });
  $('#bridgeMeasure').addEventListener('click', measureBridge);
  $('#bridgeNext').addEventListener('click', finishBridge);
  $('#fitTune').addEventListener('click', tuneToGuitar);
  $('#sweetNoteAction').addEventListener('click', startWizard);
  $('#sweetLine').addEventListener('click', (e) => { if (e.target.closest('#sweetLineAction')) startWizard(); });
  $('#strumClose').addEventListener('click', () => cancelStrumCheck(true));
  $('#strumRows').addEventListener('click', onBoardTap);
  $('#strumGuide').addEventListener('click', startGuide);
  $('#strumStop').addEventListener('click', stopGuide);
  $('#fitMeasure').addEventListener('click', startWizard);
  $('#fitExport').addEventListener('click', exportGuitars);
  $('#fitImport').addEventListener('click', importGuitars);
  $('#fitSelect').addEventListener('change', (e) => {
    S.guitarId = e.target.value;
    S.stringsKey = S.guitarId;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
  $('#fitDelete').addEventListener('click', () => {
    S.guitars = S.guitars.filter((g) => g.id !== S.guitarId);
    if (S.stringSetups) delete S.stringSetups[S.guitarId];
    S.guitarId = S.guitars.length ? S.guitars[S.guitars.length - 1].id : null;
    persist(); recompute(); renderHeader(); renderSweeten();
  });
}

// ── Strings ────────────────────────────────────────────────────────────
/** Which guitar the Strings section is about: a measured guitar's id, or 'default'. */
function stringsKey() {
  return S.guitars.some((g) => g.id === S.stringsKey) ? S.stringsKey : 'default';
}
const stringsCtx = {
  get S() { return S; },
  t, fmt, fmtSigned, stringShort, stringName, listSep,
  noteLabel: (n) => noteLabel(parseNote(n), useFlats()),
  tuningNotes: () => currentTuning().notes,
  tuningLabel: () => nameOf(currentTuning()).text,
  a4: () => S.a4,
  guitars: () => S.guitars.map((g) => ({ id: g.id, name: g.name })),
  setupKey: stringsKey,
  setKey: (key) => { S.stringsKey = key; persist(); },
  profile: () => S.guitars.find((g) => g.id === stringsKey()) || null,
  persist: () => persist(),
};
/** The wizard's "strings on the guitar" picker: the catalog, or the custom set from the Strings section. */
function wizardStrings() {
  const cur = getSetup(S, stringsKey()).current;
  const custom = cur && cur.kind === 'custom' ? cur : null;
  return {
    initial: selValue(cur),
    options: (v) => setOptionsHtml(t, v, { custom: !!custom, customLabel: t('wiz.stringsCustom') }),
    toSel: (v) => (v === 'custom' ? custom || { kind: 'unknown' } : selFromValue(v)),
  };
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
  $('#capoCheck').hidden = !S.capo;
  $('#intonation').checked = S.intonation;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));

  const parts = [];
  const swName = sweetenerName(sw).text;
  const needProfile = sweet.noteKey === 'needProfile';
  if (sw.id !== 'equal' && !needProfile) {
    parts.push(sweet.applies
      ? t('sweetLine.applies', { name: swName, offsets: sweet.open.map(fmtOffset).join(', ') })
      : t('sweetLine.na', { name: swName }));
  }
  if (S.temperamentId !== 'equal') {
    parts.push(t('sweetLine.temperament', { name: temperamentName(currentTemperament()).text, key: noteName(S.temperamentRoot + 60, S.flats) }));
  }
  // "This guitar" with nothing measured yet: say so, and make the line start the measurement.
  const action = needProfile
    ? `<button type="button" class="link-btn" id="sweetLineAction">${esc(t('sweetLine.needProfile', { name: swName }))}</button>`
    : '';
  $('#sweetLine').innerHTML = [action, ...parts.map(esc)].filter(Boolean).join(' / ');
  setStrumTitle();
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
  $('#sweetNoteAction').hidden = sweet.noteKey !== 'needProfile';

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
  renderStrings(stringsCtx);
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
  $('#cueVibrate').checked = S.cueVibrate !== false;
  $('#cueSound').checked = S.cueSound !== false;
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
  $('#a4Cal').addEventListener('click', startA4Cal);
  $('#a4Undo').addEventListener('click', () => {
    if (a4Undo === null) return;
    S.a4 = a4Undo;
    a4Undo = null;
    $('#a4Undo').hidden = true;
    $('#a4CalStatus').textContent = '';
    afterSetting();
  });
  $('#cueVibrate').addEventListener('change', (e) => {
    S.cueVibrate = e.target.checked;
    persist();
    if (S.cueVibrate) cue.buzz(false); // let the user feel it once
  });
  $('#cueSound').addEventListener('change', (e) => {
    S.cueSound = e.target.checked;
    persist();
    if (S.cueSound) cue.chime(false);
  });
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
    const keep = { customTunings: S.customTunings, lang: S.lang, terms: S.terms, guitars: S.guitars, guitarId: S.guitarId, stringSetups: S.stringSetups, stringsKey: S.stringsKey };
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
  bindStrings(stringsCtx, (o) => renderStrings(stringsCtx, o));
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
