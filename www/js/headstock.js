// Headstock diagram (audience view: neck on the left, headstock pointing right,
// 6th string on top). Shows which string is ringing, which are already tuned, and
// which tuner to turn. Tuner buttons are tap targets for locking a string.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}, parent) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

const NUT_X = 112;
const STRING_Y = (i) => 52 + i * 9.2; // i = 0 → 6th string

// Post positions per layout, indexed by string index (0 = 6th string).
const LAYOUTS = {
  '3+3': {
    outline: 'M112 40 C 150 30, 175 14, 215 12 L 318 10 C 340 10, 352 26, 352 75 C 352 124, 340 140, 318 140 L 215 138 C 175 136, 150 120, 112 110 Z',
    posts: [
      { x: 200, y: 36, side: 'top' }, { x: 252, y: 32, side: 'top' }, { x: 304, y: 30, side: 'top' },
      { x: 304, y: 120, side: 'bottom' }, { x: 252, y: 118, side: 'bottom' }, { x: 200, y: 114, side: 'bottom' },
    ],
  },
  '6': {
    outline: 'M112 40 C 140 34, 150 18, 178 16 L 300 12 C 330 10, 352 18, 352 40 C 352 60, 330 66, 300 70 L 240 90 C 200 104, 160 112, 112 110 Z',
    posts: [
      { x: 160, y: 30, side: 'top' }, { x: 196, y: 28, side: 'top' }, { x: 232, y: 26, side: 'top' },
      { x: 268, y: 24, side: 'top' }, { x: 304, y: 22, side: 'top' }, { x: 336, y: 26, side: 'top' },
    ],
    keyW: 32,
  },
};

export class Headstock {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.layout = '3+3';
    this.wiggle = 0;
    this.build();
  }

  setLayout(layout) {
    if (layout === this.layout) return;
    this.layout = LAYOUTS[layout] ? layout : '3+3';
    this.build();
  }

  build() {
    this.container.innerHTML = '';
    const L = LAYOUTS[this.layout];
    const svg = el('svg', { viewBox: '0 -18 360 186', class: `headstock-svg layout-${this.layout === '6' ? 'inline' : 'split'}`, role: 'group', 'aria-label': 'Headstock: tap a tuner to lock that string' });
    // Neck and frets.
    el('rect', { x: 0, y: 44, width: NUT_X, height: 62, rx: 2, class: 'hs-neck' }, svg);
    for (const fx of [26, 66, 98]) el('line', { x1: fx, y1: 44, x2: fx, y2: 106, class: 'hs-fret' }, svg);
    el('circle', { cx: 46, cy: 75, r: 3.2, class: 'hs-inlay' }, svg);
    el('path', { d: L.outline, class: 'hs-wood' }, svg);
    el('rect', { x: NUT_X - 4, y: 44, width: 6, height: 62, rx: 1.5, class: 'hs-nut' }, svg);

    this.strings = [];
    this.buttons = [];
    this.labels = [];
    L.posts.forEach((p, i) => {
      const y = STRING_Y(i);
      const line = el('path', { d: `M0 ${y} L${NUT_X} ${y} L${p.x} ${p.y}`, class: 'hs-string', 'data-i': i }, svg);
      line.style.strokeWidth = String(2.2 - i * 0.28);
      this.strings.push(line);
    });
    L.posts.forEach((p, i) => {
      el('circle', { cx: p.x, cy: p.y, r: 5.2, class: 'hs-post' }, svg);
      const dir = p.side === 'top' ? -1 : 1;
      const by = p.y + dir * 26;
      el('line', { x1: p.x, y1: p.y + dir * 5, x2: p.x, y2: by - dir * 9, class: 'hs-shaft' }, svg);
      const g = el('g', { class: 'hs-button', tabindex: '0', role: 'button', 'data-i': i }, svg);
      const kw = L.keyW || 38;
      el('rect', { x: p.x - kw / 2 - 2, y: by - 22, width: kw + 4, height: 44, class: 'hs-hit' }, g);
      el('rect', { x: p.x - kw / 2, y: by - 10, width: kw, height: 20, rx: 9, class: 'hs-key' }, g);
      const t = el('text', { x: p.x, y: by + 4.5, class: 'hs-label', 'text-anchor': 'middle' }, g);
      const tick = el('text', { x: p.x + kw / 2 + 3, y: by - 9, class: 'hs-tick', 'text-anchor': 'middle' }, g);
      tick.textContent = '✓';
      g.addEventListener('click', () => this.onSelect?.(i));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSelect?.(i); } });
      this.buttons.push(g);
      this.labels.push(t);
    });
    this.svg = svg;
    this.container.appendChild(svg);
  }

  /**
   * @param {object} st
   * @param {string[]} st.labels note label per string
   * @param {number}   st.active index of ringing string (-1 none)
   * @param {number}   st.locked index locked by the user (-1 none)
   * @param {boolean[]} st.tuned
   * @param {number}   st.level 0..1 for the vibration
   * @param {number|null} st.cents
   */
  update(st) {
    const L = LAYOUTS[this.layout];
    this.wiggle += 0.9;
    this.labels.forEach((t, i) => {
      const txt = st.labels[i] || '';
      if (t.textContent !== txt) t.textContent = txt;
      const b = this.buttons[i];
      b.classList.toggle('is-active', i === st.active);
      b.classList.toggle('is-locked', i === st.locked);
      b.classList.toggle('is-tuned', !!st.tuned[i]);
      b.setAttribute('aria-pressed', i === st.locked ? 'true' : 'false');
      b.setAttribute('aria-label', `String ${6 - i}, ${txt}${st.tuned[i] ? ', tuned' : ''}${i === st.locked ? ', locked' : ''}`);
    });
    this.strings.forEach((line, i) => {
      const y = STRING_Y(i);
      const p = L.posts[i];
      const on = i === st.active;
      line.classList.toggle('is-active', on);
      line.classList.toggle('is-tuned', !!st.tuned[i]);
      if (on && st.level > 0.02) {
        // A standing-wave wiggle between the "bridge" (x=0) and the nut, scaled by level.
        const amp = Math.min(3.2, st.level * 9);
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const x = (k / 16) * NUT_X;
          const yy = y + Math.sin((k / 16) * Math.PI) * amp * Math.sin(this.wiggle + i);
          pts.push(`${x.toFixed(1)} ${yy.toFixed(2)}`);
        }
        line.setAttribute('d', `M${pts.join(' L')} L${p.x} ${p.y}`);
      } else {
        line.setAttribute('d', `M0 ${y} L${NUT_X} ${y} L${p.x} ${p.y}`);
      }
    });
  }
}
