// The page's audio: your microphone in, and one bus out that everything the AI
// says passes through (speakers, visualizer, recorder).
//
//   mic ──▶ micSource ──▶ micAnalyser            (how loud you are)
//   AI voice ──▶ bus ──▶ speakers, outAnalyser (coarse bands), outVoice (fine bands)
import { t } from "../i18n.js";

const timeData = new Float32Array(1024);

function makeAnalyser(ctx, fftSize, smoothing) {
  const a = ctx.createAnalyser();
  a.fftSize = fftSize;
  a.smoothingTimeConstant = smoothing;
  return a;
}

export const audio = {
  ctx: null,
  micStream: null,
  micSource: null, // your mic in the audio graph
  micAnalyser: null,
  bus: null,
  outAnalyser: null,
  outVoice: null,
  freqData: null,
  player: null, // <audio> that plays Studio voice

  async ensureOutput() {
    try {
      if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.ctx.state === "suspended") await audio.ctx.resume();
      if (!audio.bus) {
        audio.bus = audio.ctx.createGain();
        audio.bus.connect(audio.ctx.destination);
        audio.outAnalyser = makeAnalyser(audio.ctx, 64, 0.6);
        audio.bus.connect(audio.outAnalyser);
        audio.outVoice = makeAnalyser(audio.ctx, 1024, 0.5);
        audio.bus.connect(audio.outVoice);
        audio.freqData = new Uint8Array(audio.outAnalyser.frequencyBinCount);
        audio.player = new Audio();
        audio.ctx.createMediaElementSource(audio.player).connect(audio.bus);
      }
    } catch (err) {
      console.warn("Audio output setup warning:", err);
    }
  },

  // Your microphone. Resolves { ok: true }, or { ok: false, reason, retry, text } for the screen to explain.
  // cancelled(): voice mode was closed while the browser asked for permission.
  async acquireMic(cancelled = () => false) {
    await audio.ensureOutput();

    if (!navigator?.mediaDevices?.getUserMedia) {
      return {
        ok: false,
        standby: "Microphone not supported by browser",
        retry: false,
        text: t("Microphone is not supported in this browser. You can still type to talk with your companion."),
      };
    }
    if (audio.micStream?.active) return { ok: true };

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.info("Microphone access state:", err.name, err.message);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          return {
            ok: false,
            standby: "Microphone permission needed · Click to allow",
            retry: true,
            text: t("Microphone access is blocked by your browser. Click the site settings 🔒 icon in your browser address bar to allow."),
          };
        }
        if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          return {
            ok: false,
            standby: "No microphone detected · Click to retry",
            retry: false,
            text: t("No microphone detected on this device. You can still type to talk with your companion."),
          };
        }
        return {
          ok: false,
          standby: "Microphone standby · Click to retry",
          retry: true,
          text: t("Unable to access the microphone. Press Try again below, or type instead."),
        };
      }
    }

    if (cancelled()) {
      stream.getTracks().forEach((track) => track.stop());
      return { ok: false, cancelled: true };
    }

    audio.micStream = stream;
    try {
      if (audio.ctx.state === "suspended") await audio.ctx.resume();
      audio.micSource = audio.ctx.createMediaStreamSource(stream);
      audio.micAnalyser = makeAnalyser(audio.ctx, 64, 0.6);
      audio.micSource.connect(audio.micAnalyser);
      return { ok: true };
    } catch (err) {
      console.warn("Microphone processing pipeline setup:", err);
      return { ok: false, standby: "Microphone standby", silent: true };
    }
  },

  // Mute: the browser stops delivering sound while the track is off
  setMicEnabled(on) {
    audio.micStream?.getAudioTracks().forEach((track) => (track.enabled = on));
  },

  // How loud you are right now (0..1)
  micLevel() {
    if (!audio.micAnalyser) return 0;
    audio.micAnalyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (const v of timeData) sum += v * v;
    return Math.sqrt(sum / timeData.length);
  },

  resume() {
    if (audio.ctx?.state === "suspended") audio.ctx.resume().catch(() => {});
  },

  close() {
    audio.micStream?.getTracks().forEach((track) => track.stop());
    audio.ctx?.close().catch(() => {});
    Object.assign(audio, { ctx: null, micStream: null, micSource: null, micAnalyser: null, bus: null, outAnalyser: null, outVoice: null, freqData: null, player: null });
  },
};
