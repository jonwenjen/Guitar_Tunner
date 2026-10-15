// AudioWorklet that forwards the microphone stream to the main thread in
// contiguous blocks. Gap-free delivery matters: the strobe engine integrates
// phase sample by sample, so dropped samples would look like pitch jumps.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.blockSize = (options && options.processorOptions && options.processorOptions.blockSize) || 1024;
    this.buf = new Float32Array(this.blockSize);
    this.fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.blockSize - this.fill);
        this.buf.set(ch.subarray(i, i + n), this.fill);
        this.fill += n;
        i += n;
        if (this.fill === this.blockSize) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.blockSize);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
