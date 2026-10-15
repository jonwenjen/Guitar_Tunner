// Draws the strobe disc. Four concentric rings, one per harmonic (inner = fundamental).
// Each ring carries 12 dark segments lit from behind by the "neon" light; a ring's
// angle is the heterodyne phase of its harmonic divided by 12, so the pattern stands
// still when in tune and turns clockwise when sharp, anticlockwise when flat — the
// same convention as Peterson's SC-5000 discs. Higher harmonics turn proportionally
// faster, which makes the outer rings the most sensitive.

const SEGMENTS = 12;
const TAU = Math.PI * 2;

export class StrobeView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.glow = 0;
    this.contrast = [0, 0, 0, 0];
    this.angle = [0, 0, 0, 0];
    this.colors = {};
    this.readColors();
    this.resize();
  }

  readColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    this.colors = {
      light: v('--light', '#ff6a1f'),
      lightCore: v('--light-core', '#ffd29a'),
      disc: v('--disc', '#15100c'),
      discEdge: v('--disc-edge', '#3a2a1f'),
      brass: v('--brass', '#b8925a'),
      bone: v('--ink', '#eadfca'),
      patina: v('--patina', '#6fa59a'),
      faint: v('--ink-faint', 'rgba(234,223,202,.35)'),
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  /**
   * @param {object} s
   * @param {number[]} s.phases  heterodyne phase per harmonic (rad)
   * @param {number[]} s.mags    magnitude per harmonic
   * @param {number}   s.level   0..1 input brightness
   * @param {boolean}  s.active  a target is set and sound is present
   * @param {number|null} s.cents reading for the gauge (null = none)
   * @param {number}   s.tolerance in-tune window (cents)
   */
  draw(s) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2;
    const size = Math.min(W, H);
    const R = size * 0.5 * 0.86;           // disc radius (leaves room for the gauge)
    const cy = H / 2 + size * 0.035;
    const hub = R * 0.42;
    const c = this.colors;

    const targetGlow = s.active ? Math.min(1, 0.25 + s.level) : 0.06;
    this.glow += (targetGlow - this.glow) * 0.18;

    const mags = s.mags || [];
    const maxMag = Math.max(1e-9, ...mags);
    for (let k = 0; k < 4; k++) {
      const want = s.active ? Math.sqrt(Math.min(1, (mags[k] || 0) / maxMag)) : 0;
      this.contrast[k] += (want - this.contrast[k]) * 0.25;
      if (s.active && s.phases) this.angle[k] = (s.phases[k] || 0) / SEGMENTS;
    }

    ctx.clearRect(0, 0, W, H);

    // Disc body.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = c.disc;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.strokeStyle = c.discEdge;
    ctx.stroke();
    ctx.restore();

    // Neon light behind the rings.
    const ringIn = hub * 1.08, ringOut = R * 0.96;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, ringOut, 0, TAU);
    ctx.arc(cx, cy, ringIn, 0, TAU, true);
    const g = ctx.createRadialGradient(cx, cy, ringIn, cx, cy, ringOut);
    g.addColorStop(0, c.lightCore);
    g.addColorStop(0.35, c.light);
    g.addColorStop(1, c.light);
    ctx.globalAlpha = this.glow;
    ctx.shadowColor = c.light;
    ctx.shadowBlur = R * 0.12 * this.glow;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // Strobe rings.
    const band = (ringOut - ringIn) / 4;
    for (let k = 0; k < 4; k++) {
      const r0 = ringIn + band * k + band * 0.08;
      const r1 = ringIn + band * (k + 1) - band * 0.08;
      // A strong harmonic shows a crisp pattern; a weak one looks blurred, as on a
      // mechanical disc: a uniform veil plus faint segments.
      const crisp = this.contrast[k];
      ctx.save();
      ctx.fillStyle = c.disc;
      ctx.globalAlpha = 0.5 * (1 - crisp);
      ctx.beginPath();
      ctx.arc(cx, cy, r1, 0, TAU);
      ctx.arc(cx, cy, r0, 0, TAU, true);
      ctx.fill();
      ctx.globalAlpha = 0.08 + 0.92 * crisp;
      const rot = this.angle[k] - Math.PI / 2;
      for (let j = 0; j < SEGMENTS; j++) {
        const a0 = rot + (j * TAU) / SEGMENTS;
        const a1 = a0 + TAU / SEGMENTS / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r1, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // Gaps between rings stay dark, like the separators on a printed disc.
      ctx.save();
      ctx.strokeStyle = c.disc;
      ctx.lineWidth = band * 0.16;
      ctx.beginPath();
      ctx.arc(cx, cy, ringIn + band * k, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // Hub.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, hub, 0, TAU);
    ctx.fillStyle = c.disc;
    ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.strokeStyle = c.brass;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();

    this.drawGauge(cx, cy, R, s);
  }

  /** Cents gauge: a 120° arc above the disc, −50 … +50 ¢. */
  drawGauge(cx, cy, R, s) {
    const { ctx } = this;
    const c = this.colors;
    const rG = R * 1.075;
    const span = (120 * Math.PI) / 180;
    const start = -Math.PI / 2 - span / 2;
    const toAngle = (x) => start + ((Math.max(-50, Math.min(50, x)) + 50) / 100) * span;
    const lw = Math.max(1, R * 0.006);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.faint;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(cx, cy, rG, start, start + span);
    ctx.stroke();

    // In-tune window.
    const tol = s.tolerance || 1;
    ctx.strokeStyle = c.patina;
    ctx.lineWidth = lw * 4;
    ctx.beginPath();
    ctx.arc(cx, cy, rG, toAngle(-Math.max(tol, 0.6)), toAngle(Math.max(tol, 0.6)));
    ctx.stroke();

    // Ticks.
    for (const t of [-50, -25, -10, -5, 0, 5, 10, 25, 50]) {
      const a = toAngle(t);
      const len = t === 0 ? R * 0.06 : (Math.abs(t) % 25 === 0 ? R * 0.04 : R * 0.025);
      ctx.strokeStyle = t === 0 ? c.bone : c.faint;
      ctx.lineWidth = t === 0 ? lw * 1.6 : lw;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (rG + R * 0.012), cy + Math.sin(a) * (rG + R * 0.012));
      ctx.lineTo(cx + Math.cos(a) * (rG + R * 0.012 + len), cy + Math.sin(a) * (rG + R * 0.012 + len));
      ctx.stroke();
    }

    // Marker.
    if (s.cents !== null && s.cents !== undefined && Number.isFinite(s.cents)) {
      const a = toAngle(s.cents);
      const inTune = Math.abs(s.cents) <= tol;
      ctx.fillStyle = inTune ? c.patina : c.bone;
      const r = rG - R * 0.012;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      const sz = R * 0.035;
      ctx.translate(px, py);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, sz * 0.2);
      ctx.lineTo(-sz * 0.6, -sz);
      ctx.lineTo(sz * 0.6, -sz);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
