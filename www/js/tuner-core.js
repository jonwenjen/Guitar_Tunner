// Tuner logic shared by the UI and the tests: target pitches for each string,
// automatic string identification, and "this string is tuned" tracking.

import { parseNote, midiToFreq, pitchClass, noteLabel, cents, freqToMidi } from './music.js';
import { temperamentOffset } from './temperaments.js';

/**
 * Target for every string, 6th string first.
 * @param {object} p
 * @param {string[]} p.notes      tuning notes, low → high
 * @param {number}   p.a4         calibration (Hz)
 * @param {number}   p.globalCents overall offset (±50)
 * @param {number}   p.capo        semitones
 * @param {object}   p.temperament temperament object (or null)
 * @param {number}   p.temperamentRoot pitch class 0–11
 * @param {{open:number[], fret12:number[]}} p.sweet sweetener offsets
 * @param {boolean}  p.flats       prefer flat names
 */
export function computeTargets({ notes, a4 = 440, globalCents = 0, capo = 0, temperament = null, temperamentRoot = 0, sweet, flats = false }) {
  return notes.map((n, i) => {
    const midi = parseNote(n) + capo;
    const temper = temperamentOffset(temperament, pitchClass(midi), temperamentRoot);
    const open = sweet?.open?.[i] ?? 0;
    const f12 = sweet?.fret12?.[i] ?? open;
    const offset = globalCents + temper + open;
    const offset12 = globalCents + temper + f12;
    return {
      index: i,
      stringNo: notes.length - i,
      midi,
      label: noteLabel(midi, flats),
      offset,
      freq: midiToFreq(midi, a4) * Math.pow(2, offset / 1200),
      offset12,
      freq12: midiToFreq(midi + 12, a4) * Math.pow(2, offset12 / 1200),
    };
  });
}

/** Chromatic target: the nearest note to `freq` under the current temperament. */
export function chromaticTarget(freq, { a4 = 440, globalCents = 0, temperament = null, temperamentRoot = 0, flats = false }) {
  const shifted = freq / Math.pow(2, globalCents / 1200);
  let midi = Math.round(freqToMidi(shifted, a4));
  // A temperament can move a note by up to ~±25 ¢; check neighbours too.
  let best = null;
  for (const m of [midi - 1, midi, midi + 1]) {
    const off = globalCents + temperamentOffset(temperament, pitchClass(m), temperamentRoot);
    const f = midiToFreq(m, a4) * Math.pow(2, off / 1200);
    const c = cents(freq, f);
    if (!best || Math.abs(c) < Math.abs(best.cents)) best = { midi: m, freq: f, cents: c, offset: off, label: noteLabel(m, flats) };
  }
  return best;
}

/**
 * Picks the string being played from a detected frequency, with hysteresis so
 * the display does not flicker between neighbouring strings.
 */
export class StringTracker {
  constructor({ maxCents = 320, confirmFrames = 2 } = {}) {
    this.maxCents = maxCents;
    this.confirmFrames = confirmFrames;
    this.reset();
  }

  reset() {
    this.current = -1;
    this.pending = -1;
    this.pendingCount = 0;
  }

  /**
   * @param {number} freq detected frequency (0 = nothing)
   * @param {{freq:number}[]} targets
   * @returns {number} index of the active string, or -1
   */
  update(freq, targets) {
    if (!(freq > 0) || !targets.length) return this.current;
    let best = -1, bestAbs = Infinity;
    targets.forEach((t, i) => {
      const a = Math.abs(cents(freq, t.freq));
      if (a < bestAbs) { bestAbs = a; best = i; }
    });
    if (bestAbs > this.maxCents) return this.current;
    if (best === this.current) { this.pending = -1; this.pendingCount = 0; return best; }
    if (this.current >= 0) {
      // Stay on the current string while it is still the plausible one.
      const curAbs = Math.abs(cents(freq, targets[this.current].freq));
      if (curAbs < 60 && curAbs - bestAbs < 30) return this.current;
    }
    if (best === this.pending) this.pendingCount++;
    else { this.pending = best; this.pendingCount = 1; }
    if (this.current < 0 || this.pendingCount >= this.confirmFrames) {
      this.current = best;
      this.pending = -1;
      this.pendingCount = 0;
    }
    return this.current;
  }
}

/** Marks a string as tuned once it has stayed inside the tolerance for `holdSec`. */
export class TunedTracker {
  constructor(count = 6) {
    this.count = count;
    this.reset();
  }

  reset() {
    this.tuned = new Array(this.count).fill(false);
    this.timeIn = new Array(this.count).fill(0);
  }

  /** @returns {boolean} true when this call flipped the string to tuned */
  update(index, centsOff, dt, tolerance = 1, holdSec = 0.6) {
    if (index < 0 || index >= this.count) return false;
    if (Math.abs(centsOff) <= tolerance) {
      this.timeIn[index] += dt;
      if (!this.tuned[index] && this.timeIn[index] >= holdSec) {
        this.tuned[index] = true;
        return true;
      }
    } else {
      this.timeIn[index] = 0;
      if (Math.abs(centsOff) > tolerance * 4 + 3) this.tuned[index] = false;
    }
    return false;
  }
}
