// How loud the AI is, and how loud you are: what the visualizers and the robot move with.
// Only the AI's voice moves the visualizer, never yours.
import { updateVoiceLevels } from "../robot/bands.mjs";
import { audio } from "./audio.js";

// Smoothed loudness per frequency band (low → high), 0..1
export const levels = [0, 0, 0, 0];
const bands = [[1, 4], [4, 8], [8, 16], [16, 32]];

// Finer bands, for the aurora and the robot. The coarse analyser measures in
// 750 Hz steps, which puts three of its four bands above most of a voice; this
// one measures in ~47 Hz steps, enough to split a voice into bands.
export const voiceLevels = [0, 0, 0, 0]; // bands: 90-300, 300-900, 900-2400, 2400-6000 Hz
const voiceFloor = [0, 0, 0, 0]; // the quietest level lately per band; only what's above it counts
let voiceBins = null;

// The system voice (Instant) plays outside the page, so there's nothing to
// measure: the visualizer moves like speech, about four syllables a second
const systemVoiceSpeaking = (state) => state === "speaking" && window.speechSynthesis?.speaking;

// Aurora: how strongly each part of the AI's voice sounds right now, 0..1
export function readVoiceLevels(state) {
  if (systemVoiceSpeaking(state)) {
    const t = performance.now() / 1000;
    voiceLevels.forEach((v, i) => {
      const syllables = Math.abs(Math.sin(t * (13 + i * 2.1) + i * 1.9));
      const phrase = 0.6 + 0.4 * Math.sin(t * 1.7 + i * 0.8);
      voiceLevels[i] += ((0.25 + 0.6 * syllables * syllables) * phrase - v) * 0.25;
    });
    return;
  }
  if (state !== "speaking" || !audio.outVoice) {
    voiceLevels.forEach((v, i) => (voiceLevels[i] = v * 0.9));
    return;
  }
  const { outVoice } = audio;
  if (!voiceBins || voiceBins.length !== outVoice.frequencyBinCount) voiceBins = new Uint8Array(outVoice.frequencyBinCount);
  outVoice.getByteFrequencyData(voiceBins);
  // Quick to rise, so it feels alive; slower to fall, so it's smooth (robot/bands.mjs)
  updateVoiceLevels(voiceBins, audio.ctx.sampleRate / outVoice.fftSize, voiceFloor, voiceLevels);
}

export function readLevels(state) {
  if (systemVoiceSpeaking(state)) {
    const t = performance.now() / 1000;
    bands.forEach((_, i) => {
      const sim = 0.2 + 0.35 * Math.abs(Math.sin(t * (3.5 + i * 1.8)));
      levels[i] += (sim - levels[i]) * 0.3;
    });
    return;
  }
  const analyser = state === "speaking" ? audio.outAnalyser : null;
  if (analyser && audio.freqData) analyser.getByteFrequencyData(audio.freqData);
  bands.forEach(([from, to], i) => {
    let sum = 0;
    if (analyser && audio.freqData) for (let b = from; b < to; b++) sum += audio.freqData[b];
    const target = Math.min(1, (sum / (to - from) / 255) * 1.8);
    levels[i] += (target - levels[i]) * (target > levels[i] ? 0.35 : 0.08);
  });
}

// Yours: only while the AI is silent (or after you cut in, which makes it silent).
// earClosed: its voice, or the room's echo of it, may still be in the mic.
let micFloor = 0.01; // the room's noise lately
export function userVoiceLevel({ state, muted, earClosed }) {
  if (!audio.micAnalyser || muted || state === "speaking" || earClosed) return 0;
  const level = audio.micLevel();
  micFloor += (level - micFloor) * (level < micFloor ? 0.2 : 0.002);
  return Math.min(1, Math.max(0, (level - micFloor * 1.6 - 0.006) / 0.07));
}
