// Runs on the audio thread: turns the microphone into the 16 kHz, 16-bit mono
// PCM that Gemini Live listens to, in chunks of 40 ms, each with its loudness.
const RATE = 16000;
const CHUNK = 640; // samples: 40 ms at 16 kHz

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE; // input samples per output sample
    this.pos = 0;
    this.sum = 0; // averaging the input samples of one output sample keeps it clean
    this.count = 0;
    this.out = new Int16Array(CHUNK);
    this.n = 0;
    this.energy = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      if (++this.pos < this.step) continue;
      this.pos -= this.step;
      const v = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.energy += v * v;
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === CHUNK) {
        const level = Math.sqrt(this.energy / CHUNK);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK);
        this.n = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-capture", MicCapture);
