// Note and frequency helpers. Pure functions, no DOM — shared by the app and the Node tests.

export const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse "E2", "F#3", "Bb1", "C♯4", "E♭2" into a MIDI number (A4 = 69). */
export function parseNote(name) {
  const m = /^([A-Ga-g])([#♯b♭]*)(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  let pc = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) pc += (ch === '#' || ch === '♯') ? 1 : -1;
  const octave = parseInt(m[3], 10);
  return (octave + 1) * 12 + pc;
}

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;

/** Name of a MIDI note without octave, e.g. "F♯". */
export function noteName(midi, preferFlats = false) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
}

/** Full name with octave, e.g. "F♯3". */
export function noteLabel(midi, preferFlats = false) {
  return noteName(midi, preferFlats) + octaveOf(midi);
}

/** Equal-tempered frequency of a MIDI note for a given A4 (Hz). */
export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Fractional MIDI number of a frequency. */
export function freqToMidi(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

/** Interval in cents from ref to f. */
export function cents(f, ref) {
  return 1200 * Math.log2(f / ref);
}

/** Apply a cent offset to a frequency. */
export function shiftCents(freq, c) {
  return freq * Math.pow(2, c / 1200);
}

/** Interval names used when describing tunings (semitones → short name). */
export const INTERVAL_NAMES = {
  0: 'unison', 1: 'm2', 2: 'M2', 3: 'm3', 4: 'M3', 5: 'P4', 6: 'tritone',
  7: 'P5', 8: 'm6', 9: 'M6', 10: 'm7', 11: 'M7', 12: 'octave',
};

/** Describe the intervals between adjacent strings, low to high. */
export function adjacentIntervals(midis) {
  const out = [];
  for (let i = 1; i < midis.length; i++) {
    const d = midis[i] - midis[i - 1];
    if (d < 0) out.push(`↓${INTERVAL_NAMES[-d] ?? -d}`);
    else out.push(INTERVAL_NAMES[d] ?? `+${d}`);
  }
  return out;
}

/**
 * Deviation (in cents) of 5-limit just intervals from equal temperament,
 * indexed by semitones above a root. Used by the just-intonation sweeteners.
 * Ratios: 1/1 16/15 9/8 6/5 5/4 4/3 45/32 3/2 8/5 5/3 16/9 15/8.
 */
export const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8];
export const JUST_DEVIATION = JUST_RATIOS.map((r, i) => 1200 * Math.log2(r) - 100 * i);
