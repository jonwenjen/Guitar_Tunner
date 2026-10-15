// Shared test helpers.
import { PitchDetector } from '../www/js/pitch.js';
import { StrobeEngine } from '../www/js/strobe-engine.js';

const SR = 48000;

/** Run detector + strobe over a signal; return per-frame readings after `skipSec`. */
export function analyse(sig, ref, { skipSec = 0.45, block = 1024, sr = SR } = {}) {
  const pd = new PitchDetector(sr, 4096);
  const se = new StrobeEngine(sr);
  se.setReference(ref);
  const mpm = [], strobe = [];
  for (let i = 0; i + block <= sig.length; i += block) {
    se.process(sig.subarray(i, i + block));
    const end = i + block;
    if (end < 4096 || end < skipSec * sr) continue;
    const r = pd.detect(sig.subarray(end - 4096, end));
    if (r.freq) mpm.push(r.freq);
    const s = se.read();
    if (s.valid) strobe.push(ref + s.deltaHz);
  }
  return { mpm, strobe, engine: se };
}

