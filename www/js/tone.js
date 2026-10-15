// Reference tone: a soft, plucked-string-like tone at the exact target pitch,
// for tuning by ear or checking an amp/PA.

export class ReferenceTone {
  constructor(getContext) {
    this.getContext = getContext;
    this.voice = null;
  }

  get playing() {
    return !!this.voice;
  }

  play(freq, seconds = 2.5) {
    this.stop();
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume();
    const real = new Float32Array([0, 1, 0.45, 0.25, 0.12, 0.06, 0.03]);
    const wave = ctx.createPeriodicWave(real, new Float32Array(real.length));
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0005, t + seconds);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.05);
    const voice = { osc, g, freq };
    osc.onended = () => { if (this.voice === voice) this.voice = null; this.onEnd?.(); };
    this.voice = voice;
  }

  stop() {
    if (!this.voice) return;
    const { osc, g } = this.voice;
    const ctx = this.getContext();
    try {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      osc.stop(ctx.currentTime + 0.1);
    } catch { /* already stopped */ }
    this.voice = null;
  }
}
