// Listening for Studio and Instant voice: the mic is watched for speech, and
// what you say is cut out as one recording per turn (the engine has it transcribed).
//
// Gemini transcribes in whatever language you speak, and English and German
// can be mixed. How long a pause may be before your turn ends depends on the
// conversation style (Settings → Voice), so you can think mid-sentence, and one
// turn can be up to a minute long.
//
// The mic also hears the AI's own voice. While it speaks, the ear is closed;
// only a clearly louder voice (you) interrupts it. Right after it stops, the
// ear stays closed a moment so the last echo isn't taken as you.
import { audio } from "../audio.js";
import { bargeProfile, endSilence } from "../../barge.mjs";
import { getSettings } from "../../store.js";
import { isMuted } from "../dom.js";
import { status } from "../status.js";

const MAX_TURN_MS = 60000;
export const ECHO_TAIL_MS = 450;

export class Listener {
  // onUtterance(chunks): you finished a turn. onInterrupt(): you talked over the AI.
  constructor({ onUtterance, onInterrupt }) {
    this.onUtterance = onUtterance;
    this.onInterrupt = onInterrupt;
    this.node = null;
    this.timer = null;
    this.recording = null;
    this.preRoll = [];
    this.loudSince = 0;
    this.ambientFloor = 0.012;
    this.speakingSince = 0;
    this.echoLevel = 0;
    this.bargeSince = 0;
    this.earClosedUntil = 0;
  }

  start() {
    const { ctx, micSource } = audio;
    if (micSource && !this.node) {
      this.node = ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => this.capture(e.inputBuffer.getChannelData(0));
      micSource.connect(this.node);
      this.node.connect(ctx.destination);
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.detect(), 40);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.node) {
      try {
        audio.micSource?.disconnect(this.node);
      } catch {}
      this.node.disconnect();
      this.node.onaudioprocess = null;
      this.node = null;
    }
    this.recording = null;
  }

  // Back to waiting for you to start
  reset() {
    this.recording = null;
    this.loudSince = 0;
  }

  // Throw away what has been heard of this turn
  drop() {
    this.recording = null;
  }

  // The AI starts a stretch of speech: learn how loud its echo is
  beginSpeaking() {
    this.speakingSince = performance.now();
    this.echoLevel = 0;
    this.bargeSince = 0;
  }

  closeEar(ms) {
    this.earClosedUntil = performance.now() + ms;
  }

  earClosed() {
    return performance.now() < this.earClosedUntil;
  }

  capture(samples) {
    const copy = new Float32Array(samples);
    if (this.recording) this.recording.chunks.push(copy);
    this.preRoll.push(copy);
    const keep = Math.ceil((0.35 * (audio.ctx?.sampleRate || 48000)) / 4096);
    if (this.preRoll.length > keep) this.preRoll.shift();
  }

  detect() {
    if (!audio.micAnalyser || isMuted()) return;

    const level = audio.micLevel();
    const now = performance.now();

    // Interrupting by voice: learn how loud the AI's own echo is, then only
    // react to something clearly louder that lasts (you talking over it)
    if (status.state === "speaking") {
      const { learn, hold, floor, factor } = bargeProfile(getSettings()?.voice?.interruptSensitivity, "classic");
      const since = now - this.speakingSince;
      if (since < learn) {
        this.echoLevel = Math.max(this.echoLevel, level);
        return;
      }
      // echoLevel holds the loudest recent echo and slowly lets go of it
      const bargeLevel = Math.max(floor, this.echoLevel * factor, this.ambientFloor * 5);
      if (level > bargeLevel) {
        this.bargeSince = this.bargeSince || now;
        if (now - this.bargeSince > hold) {
          this.bargeSince = 0;
          this.onInterrupt();
        }
      } else {
        this.bargeSince = 0;
        this.echoLevel = Math.max(level, this.echoLevel * 0.995);
      }
      return;
    }

    if (status.state !== "listening" && status.state !== "hearing") return;
    if (now < this.earClosedUntil) return;

    // Rolling background-noise level, only measured while nobody is talking
    if (!this.recording) this.ambientFloor = this.ambientFloor * 0.96 + level * 0.04;
    const dynamicStart = Math.max(0.018, this.ambientFloor * 2.2);
    const dynamicQuiet = Math.max(0.011, this.ambientFloor * 1.35);

    if (!this.recording) {
      this.loudSince = level > dynamicStart ? this.loudSince || now : 0;
      if (this.loudSince && now - this.loudSince > 100) {
        this.recording = { chunks: [...this.preRoll], started: now, lastLoud: now };
        status.set("hearing", "Hearing you…");
      }
      return;
    }

    if (level > dynamicQuiet) this.recording.lastLoud = now;
    if (now - this.recording.lastLoud > endSilence(getSettings()?.voice?.style) || now - this.recording.started > MAX_TURN_MS) {
      const done = this.recording;
      this.recording = null;
      this.loudSince = 0;
      if (done.lastLoud - done.started > 220) this.onUtterance(done.chunks);
      else status.set("listening");
    }
  }
}
