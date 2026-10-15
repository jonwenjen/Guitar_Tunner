// Microphone capture. Delivers gap-free Float32Array blocks to a callback.

export class MicInput {
  constructor(onBlock) {
    this.onBlock = onBlock;
    this.ctx = null;
    this.stream = null;
    this.nodes = [];
    this.running = false;
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  /** Must be called from a user gesture (tap/click) for iOS and Chrome autoplay rules. */
  async start() {
    if (this.running) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new MicError('insecure', 'The microphone only works on secure pages. Open the tuner over https, from localhost, or as the installed app.');
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = this.ctx || new Ctx({ latencyHint: 'interactive' });
    const resumed = this.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Voice processing smears pitch and gates quiet sustain; switch it off.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        throw new MicError('denied', 'Microphone access is blocked. Allow the microphone for this page or app in your settings, then tap Start again.');
      }
      if (err && (err.name === 'NotReadableError' || err.name === 'AbortError')) {
        throw new MicError('busy', 'Another app is using the microphone. Close it (calls, recorders, other tuners), then tap Start again.');
      }
      if (err && err.name === 'NotFoundError') {
        throw new MicError('missing', 'No microphone was found. Connect one, or plug your guitar into an audio interface, then tap Start.');
      }
      throw new MicError('unknown', `The microphone could not start (${err?.name || err}).`, err?.name || String(err));
    }
    await resumed;
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 35; // remove rumble and DC, keep a drop-A (55 Hz) fundamental
    hp.Q.value = 0.6;
    src.connect(hp);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    let tap = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
        tap = new AudioWorkletNode(ctx, 'capture-processor', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { blockSize: 1024 },
        });
        tap.port.onmessage = (e) => this.onBlock(e.data);
      } catch (e) {
        tap = null;
      }
    }
    if (!tap) {
      // Fallback for older WebViews: ScriptProcessorNode is deprecated but universal.
      tap = ctx.createScriptProcessor(1024, 1, 1);
      tap.onaudioprocess = (e) => this.onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    hp.connect(tap);
    tap.connect(sink);
    this.nodes = [src, hp, tap, sink];
    this.running = true;
  }

  async stop() {
    this.running = false;
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already gone */ } }
    this.nodes = [];
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }
}

export class MicError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.code = code;   // the app shows a translated message for each code
    this.detail = detail;
  }
}
