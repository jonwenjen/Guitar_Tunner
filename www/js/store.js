// Settings persisted in localStorage. Every access is guarded: storage can be
// unavailable (private windows, some WebViews) and the app must still work.

const KEY = 'strobe-tuner.v1';

export const DEFAULTS = {
  tuningId: 'standard',
  customTunings: [],          // [{id, name, notes:[6]}]
  sweetenerId: 'equal',
  sweetness: 0.5,
  anchor: 'average',          // 'average' | 'root'
  custom: { open: [0, 0, 0, 0, 0, 0], fret12: [0, 0, 0, 0, 0, 0] },
  temperamentId: 'equal',
  temperamentRoot: 0,
  a4: 440,
  globalCents: 0,
  capo: 0,
  mode: 'auto',               // 'auto' | 'manual' | 'chromatic'
  intonation: false,          // 12th-fret targets
  tolerance: 1,               // cents for "tuned"
  gateDb: -58,                // input threshold
  light: 'neon',              // strobe colour
  theme: 'walnut',            // 'walnut' | 'daylight'
  headstock: '3+3',           // '3+3' | '6'
  leftHanded: false,
  flats: false,
  keepAwake: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    return { ...structuredClone(DEFAULTS), ...saved, custom: { ...DEFAULTS.custom, ...(saved.custom || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable: settings last for this session only */ }
}
