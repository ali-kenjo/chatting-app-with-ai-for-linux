// Recording a video of voice mode: the canvas (or the robot's picture) and the
// AI's voice, optionally your mic, and captions drawn into the picture.
import { t } from "../i18n.js";
import { VoiceRecorder, videoType, download } from "../recorder.js";
import { autoOnAir } from "../onair.js";
import { audio } from "./audio.js";
import { canvas, store, voiceMode } from "./dom.js";
import { setFrame } from "./stage.js";
import { status } from "./status.js";

const recordButton = document.getElementById("voice-record");
const recordPop = document.getElementById("voice-record-pop");
const recordFrames = document.getElementById("voice-rec-frame");
const recordMic = document.getElementById("voice-rec-mic");
const recordCaptions = document.getElementById("voice-rec-captions");
const recordTime = document.getElementById("voice-rec-time");

const options = { frame: "screen", mic: true, captions: true };
try {
  Object.assign(options, JSON.parse(store.get("friends.recordOptions") || "{}"));
} catch {}

let recorder = null;
let timer = null;
let prepare = () => {}; // set by the session: the engine must be one that can be recorded

const saveOptions = () => store.set("friends.recordOptions", JSON.stringify(options));
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function syncPop() {
  recordFrames.querySelectorAll("[data-frame]").forEach((b) => b.classList.toggle("active", b.dataset.frame === options.frame));
  recordMic.checked = options.mic;
  recordCaptions.checked = options.captions;
}

function openPop() {
  syncPop();
  recordPop.hidden = false;
  recordButton.classList.add("active");
  setFrame(options.frame); // preview the format
}

function closePop() {
  recordPop.hidden = true;
  recordButton.classList.remove("active");
  if (!recorder) setFrame(null);
}

function start() {
  closePop();
  if (!audio.ctx || !audio.bus) return status.note(t("Voice mode is still starting. Try again in a moment."));
  if (!videoType()) return status.note(t("This browser can't record video."), 4000);
  prepare();
  const sources = [audio.bus];
  if (options.mic && audio.micSource) sources.push(audio.micSource);
  const next = new VoiceRecorder({ canvas, audioCtx: audio.ctx, sources });
  try {
    next.start();
  } catch (err) {
    return status.note(err.message, 4000);
  }
  recorder = next;
  autoOnAir("recording", true);
  setFrame(options.frame);
  voiceMode.classList.add("recording");
  voiceMode.classList.toggle("canvas-captions", options.captions);
  recordButton.title = t("Stop recording and save the video");
  recordButton.setAttribute("aria-label", recordButton.title);
  recordTime.textContent = "0:00";
  clearInterval(timer);
  timer = setInterval(() => (recordTime.textContent = clock(recorder?.seconds || 0)), 500);
}

async function stop() {
  const current = recorder;
  if (!current) return;
  recorder = null;
  autoOnAir("recording", false);
  clearInterval(timer);
  voiceMode.classList.remove("recording", "canvas-captions");
  recordButton.title = t("Record a video");
  recordButton.setAttribute("aria-label", recordButton.title);
  const { blob, extension, seconds } = await current.stop();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  download(blob, `friends-voice-${stamp}.${extension}`);
  status.note(t("Saved the video ({time}).", { time: clock(seconds) }), 4000);
  setFrame(null);
}

recordButton.addEventListener("click", () => {
  if (recorder) stop();
  else if (recordPop.hidden) openPop();
  else closePop();
});
recordFrames.addEventListener("click", (e) => {
  const button = e.target.closest("[data-frame]");
  if (!button) return;
  options.frame = button.dataset.frame;
  saveOptions();
  syncPop();
  setFrame(options.frame);
});
recordMic.addEventListener("change", () => {
  options.mic = recordMic.checked;
  saveOptions();
});
recordCaptions.addEventListener("change", () => {
  options.captions = recordCaptions.checked;
  saveOptions();
});
document.getElementById("voice-rec-start").addEventListener("click", start);

export const recording = {
  get active() {
    return Boolean(recorder);
  },
  get popOpen() {
    return !recordPop.hidden;
  },
  // Captions drawn into the picture: the recorded video gets them too (not
  // while filming mode has them switched off)
  get captionsOnCanvas() {
    return (Boolean(recorder) || !recordPop.hidden) && options.captions && !voiceMode.classList.contains("captions-off");
  },
  closePop,
  stop,
  // The session says what to do before a recording starts (an engine that can't be recorded is swapped)
  beforeStart(fn) {
    prepare = fn;
  },
};
