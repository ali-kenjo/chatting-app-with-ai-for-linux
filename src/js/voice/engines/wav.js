// Your recording as a 16 kHz mono WAV file, for transcription
// chunks: Float32Array pieces from the mic; inputRate: the AudioContext's rate
export function toWav(chunks, inputRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  const rate = 16000;
  const ratio = inputRate / rate;
  const out = new Int16Array(Math.floor(length / ratio));
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const view = new DataView(new ArrayBuffer(44 + out.length * 2));
  const text = (at, str) => [...str].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + out.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, out.length * 2, true);
  out.forEach((v, i) => view.setInt16(44 + i * 2, v, true));
  return new Blob([view], { type: "audio/wav" });
}
