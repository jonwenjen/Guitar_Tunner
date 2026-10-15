// Regenerates docs/TUNINGS.md from the tuning library: node scripts/gen-tunings-doc.mjs
import { writeFileSync } from 'node:fs';
import { TUNINGS, CATEGORIES } from '../www/js/tunings.js';
import { REFERENCES } from '../www/js/references.js';
import { parseNote, noteLabel, adjacentIntervals, midiToFreq } from '../www/js/music.js';
import { sweetenerOffsets, findSweetener } from '../www/js/sweeteners.js';

const flats = (t) => t.notes.some((n) => /^[A-G]b/.test(n));
const fmt = (v) => (Math.abs(v) < 0.05 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
const used = new Set();
let md = `# Tuning library

Generated from \`www/js/tunings.js\` by \`scripts/gen-tunings-doc.mjs\` — edit the data, then rerun the script.
Notes run from the 6th (lowest) string to the 1st; frequencies are equal-tempered at A4 = 440 Hz.
"Just chord" shows the just-intonation sweetener at 50 % sweetness, centred on the average pitch (cents).

`;
for (const cat of CATEGORIES) {
  const list = TUNINGS.filter((t) => t.category === cat.id);
  if (!list.length) continue;
  md += `## ${cat.name}\n\n| Tuning | Strings 6 → 1 | Intervals | Hz (6 → 1) | Just chord (¢) |\n|---|---|---|---|---|\n`;
  for (const t of list) {
    const m = t.notes.map(parseNote);
    const hz = m.map((x) => midiToFreq(x).toFixed(1)).join(' ');
    const sw = sweetenerOffsets(findSweetener('just-chord'), t, { sweetness: 0.5 });
    md += `| **${t.name}** | ${m.map((x) => noteLabel(x, flats(t))).join(' ')} | ${adjacentIntervals(m).join(' ')} | ${hz} | ${sw.applies ? sw.open.map(fmt).join(', ') : '—'} |\n`;
  }
  md += '\n';
  for (const t of list) {
    const src = (t.sources || []).map((id) => { used.add(id); return `[${id}]`; }).join(' ');
    md += `- **${t.name}.** ${t.about} ${src}\n`;
  }
  md += '\n';
}
md += '## Sources\n\n';
for (const id of [...used].sort()) {
  const r = REFERENCES[id];
  md += `- **[${id}]** ${r.cite}${r.url ? ` <${r.url}>` : ''}\n`;
}
writeFileSync('docs/TUNINGS.md', md);
console.log('wrote docs/TUNINGS.md');
