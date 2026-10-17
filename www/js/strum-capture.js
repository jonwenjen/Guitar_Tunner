// Streaming capture of one strum from the microphone: wait for a sudden rise in
// level, then keep recording long enough for the strum analysis window.

export class StrumCapture {
  /**
   * @param {number} sampleRate
   * @param {object} [o]
   * @param {number} [o.preSec=0.25]  audio kept before the onset
   * @param {number} [o.postSec=2.25] audio recorded after the onset (skip 0.55 s + 1.6 s window)
   * @param {number} [o.timeoutSec=12] give up waiting for a strum after this long
   * @param {number} [o.gateDb=-50]   minimum level of a strum
   * @param {number} [o.ratio=8]      jump in short-term energy that counts as a strum
   * @param {number} [o.armSec=0.2]   ignore onsets during the first moments (tap noise)
   */
  constructor(sampleRate, { preSec = 0.25, postSec = 2.25, timeoutSec = 12, gateDb = -50, ratio = 8, armSec = 0.2 } = {}) {
    this.sr = sampleRate;
    this.pre = Math.round(preSec * sampleRate);
    this.post = Math.round(postSec * sampleRate);
    this.timeout = Math.round(timeoutSec * sampleRate);
    this.gate = Math.pow(10, gateDb / 10);
    this.ratio = ratio;
    this.arm = Math.round(armSec * sampleRate);
    this.hop = 256;
    this.buf = new Float32Array(this.pre + this.post + this.hop * 4);
    this.ringSize = this.pre + this.hop;
    this.ring = new Float32Array(this.ringSize); // pre-onset history
    this.ringPos = 0;
    this.seen = 0;
    this.slow = -1;
    this.acc = 0; this.accN = 0;
    this.state = 'waiting';
    this.onsetAt = -1;
    this.recorded = 0;
  }

  /** Progress 0..1 while recording after the onset. */
  get progress() {
    return this.state === 'recording' ? Math.min(1, this.recorded / (this.pre + this.post)) : (this.state === 'done' ? 1 : 0);
  }

  /** Feed a block of samples. Returns the state: 'waiting' | 'recording' | 'done' | 'timeout'. */
  push(block) {
    if (this.state === 'done' || this.state === 'timeout') return this.state;
    for (let i = 0; i < block.length; i++) {
      const v = block[i];
      if (this.state === 'waiting') {
        this.ring[this.ringPos] = v;
        this.ringPos = (this.ringPos + 1) % this.ringSize;
        this.seen++;
        this.acc += v * v;
        if (++this.accN === this.hop) {
          const e = this.acc / this.hop;
          this.acc = 0; this.accN = 0;
          if (this.slow >= 0 && this.seen > this.arm && e > this.gate && e > this.ratio * Math.max(this.slow, 1e-12)) {
            this.startRecording();
            continue;
          }
          this.slow = this.slow < 0 ? e : 0.85 * this.slow + 0.15 * e;
          if (this.seen > this.timeout) { this.state = 'timeout'; return this.state; }
        }
      } else if (this.state === 'recording') {
        this.buf[this.recorded++] = v;
        if (this.recorded >= this.pre + this.post) { this.state = 'done'; return this.state; }
      }
    }
    return this.state;
  }

  startRecording() {
    // Copy the pre-onset history (oldest first); the onset is the start of the triggering hop.
    const keep = this.pre + this.hop;
    for (let k = 0; k < keep; k++) this.buf[k] = this.ring[(this.ringPos + k) % this.ringSize];
    this.recorded = keep;
    this.onsetAt = this.pre; // index in buf where the triggering hop begins
    this.state = 'recording';
  }

  /** Recorded samples and the onset index within them. */
  result() {
    return { samples: this.buf.subarray(0, this.recorded), onset: this.onsetAt };
  }
}
