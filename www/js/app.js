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
import { ARTICLES, LEARN_REFS } from './learn.js';
import { loadSettings, saveSettings, DEFAULTS } from './store.js';
import { parseNote, noteLabel, noteName, octaveOf, cents as centsOf, adjacentIntervals, freqToMidi, SHARP_NAMES, FLAT_NAMES } from './music.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ORDINAL = ['6th', '5th', '4th', '3rd', '2nd', '1st'];

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

const view = new StrobeView($('#strobe'));
const headstock = new Headstock($('#headstock'), { onSelect: onStringTap });

// ── Settings → derived data ────────────────────────────────────────────
function allTunings() {
  return [...TUNINGS, ...S.customTunings.map((t) => ({ ...t, category: 'yours', shape: null }))];
}
function currentTuning() {
  return allTunings().find((t) => t.id === S.tuningId) || TUNINGS[0];
}
/** Spell notes with flats when the user asks, or when the tuning itself is written with flats (E♭ standard). */
function useFlats(t = currentTuning()) {
  return S.flats || t.notes.some((n) => /^[A-G](b|♭)/.test(n));
}
function currentTemperament() {
  return TEMPERAMENTS.find((t) => t.id === S.temperamentId) || TEMPERAMENTS[0];
}

function recompute() {
  const tuning = currentTuning();
  sweet = sweetenerOffsets(findSweetener(S.sweetenerId), tuning, { sweetness: S.sweetness, anchor: S.anchor, custom: S.custom });
  targets = computeTargets({
    notes: tuning.notes, a4: S.a4, globalCents: S.globalCents, capo: S.capo,
    temperament: currentTemperament(), temperamentRoot: S.temperamentRoot, sweet, flats: useFlats(tuning),
  });
  tracker.reset();
}

function targetFreq(i) {
  const t = targets[i];
  if (!t) return 0;
  return S.intonation ? t.freq12 : t.freq;
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
  try {
    instr.textContent = 'Starting the microphone…';
    instr.className = 'instruction';
    await mic.start();
    detector = new PitchDetector(mic.sampleRate, 4096);
    engine = new StrobeEngine(mic.sampleRate);
    ringFilled = 0;
    $('#hub').classList.remove('is-idle');
    requestWakeLock();
    instr.textContent = idleInstruction();
  } catch (err) {
    instr.textContent = err.message || String(err);
    instr.className = 'instruction is-error';
  }
}

async function stopMic() {
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
      const minTarget = Math.min(...targets.map((t, i) => targetFreq(i)));
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
    if (tunedTracker.update(activeString, reading.cents, dt, S.tolerance)) announce(`${ORDINAL[activeString]} string tuned`);
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
    const t = chromaticTarget(freq, { a4: S.a4, globalCents: S.globalCents, temperament: currentTemperament(), temperamentRoot: S.temperamentRoot, flats: S.flats });
    if (!chromRef || (t.midi !== chromRef.midi && Math.abs(centsOf(freq, chromRef.freq)) > 58)) chromRef = t;
    engine.setReference(chromRef.freq);
    activeString = -1;
    return;
  }
  if (S.mode === 'manual' && lockedString >= 0) {
    activeString = lockedString;
  } else {
    const list = targets.map((t, i) => ({ freq: targetFreq(i) }));
    activeString = tracker.update(freq, list);
  }
  if (activeString >= 0) engine.setReference(targetFreq(activeString));
}

function stringLabel(i) {
  const t = targets[i];
  if (!t) return '';
  return S.intonation ? noteLabel(t.midi + 12, useFlats()) : t.label;
}

function renderReadout(reading, level) {
  const hubEl = $('#hub');
  const instr = $('#instruction');
  const noteEl = $('#noteName'), octEl = $('#noteOct'), centsEl = $('#cents'), hzEl = $('#hz');

  let midi = null;
  if (S.mode === 'chromatic') midi = chromRef ? chromRef.midi : null;
  else if (activeString >= 0) midi = targets[activeString].midi + (S.intonation ? 12 : 0);

  if (!mic.running) {
    hubEl.classList.add('is-idle');
  } else if (midi !== null && reading) {
    noteEl.textContent = noteName(midi, S.mode === 'chromatic' ? S.flats : useFlats());
    octEl.textContent = String(octaveOf(midi));
    const c = reading.cents;
    const tol = S.tolerance;
    if (c !== null && Math.abs(c) >= 100 && lastMpm?.freq) {
      // More than a semitone away (wrong string locked, capo moved): say what we hear.
      const heard = noteLabel(Math.round(freqToMidi(lastMpm.freq, S.a4)), useFlats());
      centsEl.textContent = `Hearing ${heard}`;
      centsEl.classList.remove('is-in');
      hzEl.textContent = `${lastMpm.freq.toFixed(1)} Hz`;
      setInstruction(c, false, Math.round(Math.abs(c) / 100));
    } else if (c !== null) {
      const inTune = Math.abs(c) <= tol;
      centsEl.textContent = `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c).toFixed(1)} ¢`;
      centsEl.classList.toggle('is-in', inTune);
      const ref = engine?.ref || 0;
      hzEl.textContent = ref ? `${(ref * Math.pow(2, c / 1200)).toFixed(2)} Hz` : '';
      setInstruction(c, inTune);
    }
  } else if (mic.running) {
    noteEl.textContent = S.mode === 'chromatic' || activeString < 0 ? '–' : noteName(targets[activeString].midi + (S.intonation ? 12 : 0), useFlats());
    octEl.textContent = '';
    centsEl.textContent = ' ';
    centsEl.classList.remove('is-in');
    hzEl.textContent = ' ';
    if (!instr.classList.contains('is-error')) {
      instr.className = 'instruction';
      instr.textContent = idleInstruction();
    }
  }

  headstock.update({
    labels: targets.map((_, i) => stringLabel(i)),
    active: S.mode === 'chromatic' ? -1 : activeString,
    locked: S.mode === 'manual' ? lockedString : -1,
    tuned: tunedTracker.tuned,
    level: reading && reading.sounding ? level : 0,
  });
}

function idleInstruction() {
  if (!mic.running) return 'Tap Start tuning and allow the microphone.';
  if (S.mode === 'chromatic') return 'Play any note.';
  if (S.mode === 'manual' && lockedString >= 0) {
    return S.intonation
      ? `Play the ${ORDINAL[lockedString]} string at the 12th fret.`
      : `Play the ${ORDINAL[lockedString]} string (${stringLabel(lockedString)}).`;
  }
  return S.intonation ? 'Play any string at the 12th fret.' : 'Play an open string.';
}

function setInstruction(c, inTune, semitones = 0) {
  const instr = $('#instruction');
  instr.className = 'instruction' + (inTune ? ' is-in' : '');
  const who = S.mode === 'chromatic' || activeString < 0 ? '' : ` the ${ORDINAL[activeString]} string`;
  let html;
  if (inTune) {
    html = S.intonation ? 'Intonation is set for this string.' : `In tune${who ? ` — ${ORDINAL[activeString]} string` : ''}.`;
  } else if (S.intonation) {
    html = c > 0
      ? '<span class="dir">Sharp at the 12th</span>: move the saddle away from the neck.'
      : '<span class="dir">Flat at the 12th</span>: move the saddle toward the neck.';
  } else if (S.mode === 'chromatic') {
    html = c > 0 ? '<span class="dir">↓ Sharp</span> — lower the pitch.' : '<span class="dir">↑ Flat</span> — raise the pitch.';
  } else {
    html = c > 0 ? `<span class="dir">↓ Loosen</span>${who}` : `<span class="dir">↑ Tighten</span>${who}`;
    html += semitones ? ` — about ${semitones} semitone${semitones > 1 ? 's' : ''} to go.` : '.';
  }
  if (instr.innerHTML !== html) instr.innerHTML = html;
  announce(inTune ? `${who ? ORDINAL[activeString] + ' string ' : ''}in tune` : '');
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
  b.textContent = tone.playing ? 'Stop reference' : 'Play reference';
  b.classList.toggle('is-on', tone.playing);
}

function setCapo(n) {
  S.capo = Math.max(0, Math.min(9, n));
  persist();
  recompute();
  renderHeader();
}

// ── Rendering of static parts ──────────────────────────────────────────
function renderHeader() {
  const t = currentTuning();
  $('#tuningName').textContent = t.name;
  const names = t.notes.map((n) => noteName(parseNote(n), useFlats(t))).join(' ');
  $('#tuningNotes').textContent = S.capo ? `${names}, capo ${S.capo}` : names;
  const sw = findSweetener(S.sweetenerId);
  const chip = $('#chipSweet');
  chip.textContent = sw.id === 'equal' ? 'Equal' : sw.name.replace(/ \(.*\)$/, '');
  chip.classList.toggle('is-on', sw.id !== 'equal');
  const a4 = $('#chipA4');
  a4.textContent = `A4 ${Number(S.a4).toFixed(S.a4 % 1 ? 1 : 0)}`;
  a4.classList.toggle('is-on', S.a4 !== 440 || S.globalCents !== 0);
  $('#capoLabel').textContent = S.capo ? `Capo ${S.capo}` : 'No capo';
  $('#intonation').checked = S.intonation;
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));

  const parts = [];
  if (sw.id !== 'equal') {
    parts.push(sweet.applies
      ? `${sw.name}: ${sweet.open.map((v) => fmtOffset(v)).join(', ')} ¢`
      : `${sw.name} does not apply to this tuning`);
  }
  if (S.temperamentId !== 'equal') parts.push(`${currentTemperament().name} on ${SHARP_NAMES[S.temperamentRoot]}`);
  $('#sweetLine').textContent = parts.join('. ');
}

const fmtOffset = (v) => (Math.abs(v) < 0.05 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

function renderTunings() {
  const host = $('#tuningList');
  host.innerHTML = '';
  const cats = [...CATEGORIES];
  if (S.customTunings.length) cats.unshift({ id: 'yours', name: 'Your tunings' });
  const std = TUNINGS[0].notes.map(parseNote);
  for (const cat of cats) {
    const list = allTunings().filter((t) => t.category === cat.id);
    if (!list.length) continue;
    const sec = document.createElement('section');
    sec.className = 'cat';
    sec.innerHTML = `<h2>${cat.name}</h2>`;
    for (const t of list) {
      const midis = t.notes.map(parseNote);
      const row = document.createElement('div');
      row.className = 'tuning-row' + (t.id === S.tuningId ? ' is-current' : '');
      const fl = useFlats(t);
      const ribbon = midis.map((m, i) => `<span class="${m !== std[i] ? 'changed' : ''}">${noteLabel(m, fl)}</span>`).join('');
      const src = (t.sources || []).map((id) => REFERENCES[id]).filter(Boolean)
        .map((r) => r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${shortCite(r.cite)}</a>` : shortCite(r.cite)).join('; ');
      row.innerHTML = `
        <div>
          <h3>${t.name}</h3>
          <div class="ribbon" aria-label="Strings 6 to 1">${ribbon}</div>
          <div class="intervals">${adjacentIntervals(midis).join('  ')}</div>
        </div>
        <div class="actions">
          ${t.id === S.tuningId ? '<button class="btn is-on" type="button" disabled>In use</button>' : `<button class="btn" type="button" data-use="${t.id}">Use</button>`}
          ${t.category === 'yours' ? `<button class="btn btn-quiet" type="button" data-del="${t.id}" aria-label="Delete ${t.name}">Delete</button>` : ''}
        </div>
        ${t.about ? `<details><summary>About this tuning</summary><p>${t.about}</p>${src ? `<p class="src">Sources: ${src}</p>` : ''}</details>` : ''}`;
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  $$('[data-use]', host).forEach((b) => b.addEventListener('click', () => useTuning(b.dataset.use)));
  $$('[data-del]', host).forEach((b) => b.addEventListener('click', () => {
    S.customTunings = S.customTunings.filter((t) => t.id !== b.dataset.del);
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
    <label>${ORDINAL[i]}
      <select data-cs="${i}">${options.map((m) => `<option value="${m}" ${m === midi ? 'selected' : ''}>${noteLabel(m, S.flats)}</option>`).join('')}</select>
    </label>`).join('');
}

function bindCustomBuilder() {
  $('#customSave').addEventListener('click', () => {
    const notes = $$('[data-cs]').map((s) => noteLabel(Number(s.value)).replace('♯', '#'));
    const name = $('#customName').value.trim() || notes.map((n) => n.replace(/\d/g, '')).join('');
    const id = `custom-${Date.now().toString(36)}`;
    S.customTunings.push({ id, name, notes, about: 'Your own tuning.' });
    persist();
    useTuning(id);
  });
}

function renderSweeten() {
  const tuning = currentTuning();
  $('#sweetFor').textContent = `${tuning.name}, ${tuning.notes.map((n) => noteName(parseNote(n), useFlats(tuning))).join(' ')}`;
  // Offset chart.
  const chart = $('#offsetChart');
  const max = 15;
  chart.innerHTML = sweet.open.map((v, i) => {
    const h = Math.min(1, Math.abs(v) / max) * 60;
    const style = v >= 0 ? `bottom:60px;height:${h}px` : `top:60px;height:${h}px`;
    const name = noteName(parseNote(tuning.notes[i]) + S.capo, useFlats(tuning));
    return `<div class="bar"><span class="bar-val">${fmtOffset(v)}</span><div class="bar-track"><div class="bar-fill ${v < 0 ? 'neg' : ''}" style="${style}"></div></div><span class="bar-name">${name}</span></div>`;
  }).join('');
  chart.setAttribute('aria-label', `Offsets in cents, 6th to 1st string: ${sweet.open.map(fmtOffset).join(', ')}`);
  $('#sweetNote').textContent = sweet.note || (S.sweetenerId === 'equal' ? 'Bars show each string’s offset in cents (±15 ¢ scale).' : '');

  const list = $('#sweetList');
  list.innerHTML = SWEETENERS.map((s) => `
    <button type="button" role="radio" class="sweet-item" data-sw="${s.id}" aria-checked="${s.id === S.sweetenerId}">
      <span class="dot" aria-hidden="true"></span>
      <span><strong>${s.name}</strong><span class="d">${s.about}</span></span>
    </button>`).join('');
  $$('[data-sw]', list).forEach((b) => b.addEventListener('click', () => {
    S.sweetenerId = b.dataset.sw;
    persist(); recompute(); renderHeader(); renderSweeten();
  }));

  const sw = findSweetener(S.sweetenerId);
  $('#sweetnessField').hidden = !sw.usesSweetness;
  $('#anchorField').hidden = sw.kind !== 'just';
  $('#sweetness').value = Math.round(S.sweetness * 100);
  $('#sweetnessOut').textContent = `${Math.round(S.sweetness * 100)} %`;
  $$('[data-anchor]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.anchor === S.anchor)));

  const co = $('#customOffsets');
  co.hidden = sw.kind !== 'custom';
  if (sw.kind === 'custom' && !co.querySelector('table')) {
    const head = ORDINAL.map((o) => `<th scope="col">${o}</th>`).join('');
    const rowFor = (key, label) => `<tr><th scope="row">${label}</th>${S.custom[key].map((v, i) =>
      `<td><input type="number" step="0.1" min="-50" max="50" value="${v}" data-co="${key}" data-i="${i}" aria-label="${label}, ${ORDINAL[i]} string, cents"></td>`).join('')}</tr>`;
    co.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rowFor('open', 'Open')}${rowFor('fret12', '12th fret')}</tbody></table>
      <p class="note">Cents from equal temperament. 12th-fret values are used in 12th-fret intonation mode.</p>`;
    $$('[data-co]', co).forEach((inp) => inp.addEventListener('input', () => {
      const v = Math.max(-50, Math.min(50, Number(inp.value) || 0));
      S.custom[inp.dataset.co][Number(inp.dataset.i)] = v;
      persist(); recompute(); renderHeader(); renderSweeten();
    }));
  }

  // Temperaments.
  const tsel = $('#temperament');
  if (!tsel.options.length) {
    tsel.innerHTML = TEMPERAMENTS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    $('#temperRoot').innerHTML = SHARP_NAMES.map((n, i) => `<option value="${i}">${S.flats ? FLAT_NAMES[i] : n}</option>`).join('');
  }
  tsel.value = S.temperamentId;
  $('#temperRoot').value = String(S.temperamentRoot);
  $('#temperRoot').disabled = S.temperamentId === 'equal';
  $('#temperAbout').textContent = currentTemperament().about;
}

const renderSweetChartOnly = () => renderSweeten();

function bindSweeten() {
  $('#sweetness').addEventListener('input', (e) => {
    S.sweetness = Number(e.target.value) / 100;
    persist(); recompute(); renderHeader(); renderSweetChartOnly();
  });
  $$('[data-anchor]').forEach((b) => b.addEventListener('click', () => {
    S.anchor = b.dataset.anchor;
    persist(); recompute(); renderHeader(); renderSweetChartOnly();
  }));
  $('#temperament').addEventListener('change', (e) => {
    S.temperamentId = e.target.value;
    persist(); recompute(); renderHeader(); renderSweetChartOnly();
  });
  $('#temperRoot').addEventListener('change', (e) => {
    S.temperamentRoot = Number(e.target.value);
    persist(); recompute(); renderHeader();
  });
}

function renderLearn() {
  const host = $('#learn');
  const refs = LEARN_REFS.map((id) => REFERENCES[id]).filter(Boolean);
  host.innerHTML = `<h1>Learn</h1>
    <p class="lede">How the strobe reads a string, when sweetening helps, and where the tunings in the library come from.</p>
    ${ARTICLES.map((a) => `<article id="learn-${a.id}"><h2>${a.title}</h2>${a.body.map((p) => `<p>${p}</p>`).join('')}</article>`).join('')}
    <h2>References</h2>
    <ol class="refs">${refs.map((r) => `<li>${r.cite}${r.url ? ` <a href="${r.url}" target="_blank" rel="noopener">Link</a>` : ''}</li>`).join('')}</ol>`;
}

function renderSettings() {
  $('#a4').value = S.a4;
  $('#a4Out').textContent = `${Number(S.a4).toFixed(1)} Hz`;
  $('#globalCents').value = S.globalCents;
  $('#globalOut').textContent = `${S.globalCents > 0 ? '+' : S.globalCents < 0 ? '−' : ''}${Math.abs(S.globalCents).toFixed(1)} ¢`;
  $('#gate').value = S.gateDb;
  $('#gateOut').textContent = `−${Math.abs(S.gateDb)} dB`;
  $$('[data-tol]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.tol) === S.tolerance)));
  $$('[data-lamp]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lamp === S.light)));
  $$('[data-panel]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.panel === S.theme)));
  $$('[data-hs]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hs === S.headstock)));
  $('#leftHanded').checked = S.leftHanded;
  $('#flats').checked = S.flats;
  $('#keepAwake').checked = S.keepAwake;
  $('#aboutApp').innerHTML = 'Strobe Tuner is an independent open-source project and is not affiliated with Peterson Electro-Musical Products. Note detection uses the McLeod Pitch Method; fine tuning uses a heterodyne strobe. Saira typeface © Omnibus-Type, SIL Open Font License.';
}

function bindSettings() {
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
  $('#resetAll').addEventListener('click', () => {
    const keep = S.customTunings;
    S = structuredClone(DEFAULTS);
    S.customTunings = keep;
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
function boot() {
  const sr = document.createElement('p');
  sr.id = 'srStatus';
  sr.className = 'sr-only';
  sr.setAttribute('aria-live', 'polite');
  document.body.appendChild(sr);

  if (S.mode === 'manual') S.mode = 'auto';
  recompute();
  applyTheme();
  renderAll();
  renderLearn();
  bindTune();
  bindCustomBuilder();
  bindSweeten();
  bindSettings();
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.tab)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));
  $('#hub').classList.add('is-idle');
  window.addEventListener('resize', () => view.resize());
  requestAnimationFrame(loop);

  // Offline support for the web version; the native apps bundle their files already.
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
