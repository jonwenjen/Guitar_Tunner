// "That string is in tune" cues for when your eyes are on the pegs: a short
// vibration (native haptics in the app, the Vibration API on Android browsers)
// and a soft two-note chime. The chime sits above 2 kHz, outside the band the
// pitch detector and strobe use, so it does not disturb the next reading.

function haptics() {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform?.()) return null;
  if (cap.isPluginAvailable && !cap.isPluginAvailable('Haptics')) return null;
  return cap.Plugins?.Haptics || cap.registerPlugin?.('Haptics') || null;
}

export class TunedCue {
  /** @param {() => AudioContext|null} getCtx */
  constructor(getCtx) {
    this.getCtx = getCtx;
  }

  /**
   * @param {object} o
   * @param {boolean} o.vibrate
   * @param {boolean} o.sound
   * @param {boolean} [o.done]  the whole guide finished: a longer pattern
   */
  play({ vibrate, sound, done = false }) {
    if (vibrate) this.buzz(done);
    if (sound) this.chime(done);
  }

  buzz(done) {
    const h = haptics();
    try {
      if (h) {
        if (done) h.notification({ type: 'SUCCESS' });
        else h.impact({ style: 'MEDIUM' });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(done ? [40, 70, 40, 70, 60] : 45);
    } catch { /* no vibration on this device */ }
  }

  chime(done) {
    let ctx;
    try { ctx = this.getCtx(); } catch { ctx = null; }
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes = done ? [2093, 2637, 3136] : [2349, 3136]; // D7 G7 · C7 E7 G7
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((f, k) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = t0 + k * 0.09;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
  }
}
