// ---------- Voice conversation ----------
// A spoken conversation, full screen, with an audio-reactive visualizer that
// follows the AI's voice (only its voice, never yours).
//
// Three ways to talk ("engines"), picked with the pill at the top:
// - Live: Gemini Live hears you directly and answers in real time (live.js)
// - Studio: your words are transcribed, Gemini writes a reply, and a Gemini
//   voice reads it, a piece at a time
// - Instant: the same, but read by the browser's own (robotic) voice
// Live falls back to Studio by itself when it can't be used.
//
// Also: a side panel with drafts and the transcript, a video recorder, and
// captions that go into the video.
//
// The "Robot" style shows the AI's 3D robot body (src/js/robot/) instead of a
// visualizer: this module tells it the state, the captions and both voices.
import { api } from "./api.js";
import { askFromVoice, stopReply, getCurrentChatId, adoptChat, reloadChat } from "./chat.js";
import { getSettings } from "./store.js";
import { playbackRate, voiceErrorText } from "./personality.js";
import { promptConfirmation } from "./workspace.js";
import { getSelectedBrainId, liveWanted, getLocalBrainId } from "./composer.js";
import { getAccessToken } from "./auth.js";
import { LiveVoice } from "./live.js";
import { VoiceRecorder, videoType, download } from "./recorder.js";
import { toggleDrawer, resetDrawer, addDraft, addTranscript, endTurn } from "./voice-drawer.js";
import { robot } from "./robot/index.js";
import { updateVoiceLevels } from "./robot/bands.mjs";
import { createFilming } from "./filming.js";

const voiceMode = document.getElementById("voice-mode");
const voiceStatus = document.getElementById("voice-status");
const voiceCaption = document.getElementById("voice-caption");
const voiceMute = document.getElementById("voice-mute");
const voiceFullscreen = document.getElementById("voice-fullscreen");
const voiceThemeBar = document.getElementById("voice-theme-bar");
const canvas = document.getElementById("voice-waves");
const ctx = canvas.getContext("2d");

const BACKGROUND = "#131314"; // painted on the canvas, so recordings match the screen

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

let audioCtx = null;
let micStream = null;
let micSource = null; // your mic in the audio graph
let micAnalyser = null; // how loud you are (Studio/Instant voice detection)
let aiBus = null; // everything the AI says passes through here: speakers, visualizer, recorder
let outAnalyser = null;
let recorderNode = null;
let player = null; // <audio> that plays Studio voice
let freqData = null;
let rafId = null;
let vadTimer = null;
let heartbeatTimer = null;
let ambientFloor = 0.012;
let opened = 0; // bumped each time voice mode opens

// ---------- Engines ----------
const ENGINES = {
  live: { icon: "⚡", label: "Live", title: "Live: it hears you directly and answers in real time, like a call (Gemini Live). You can cut in any time. Click for Studio voice." },
  studio: { icon: "🎙️", label: "Studio", title: "Studio: Gemini writes each reply, then says it in a natural Gemini voice. A bit slower to start. Click for Instant voice." },
  instant: { icon: "💬", label: "Instant", title: "Instant: your browser's own voice. Quickest to start, but robotic, and it can't be recorded. Click for Live." },
};
const ORDER = ["live", "studio", "instant"];
let engineChoice = ORDER.includes(store.get("friends.voiceEngine")) ? store.get("friends.voiceEngine") : "live";
let live = null; // the running LiveVoice
let classicTts = null; // "studio" | "instant" while that engine runs

// The mic also hears the AI's own voice (Studio/Instant). While it speaks, the
// ear is closed; only a clearly louder voice (you) interrupts it. Right after
// it stops, the ear stays closed a moment so the last echo isn't taken as you.
let speakingSince = 0;
let echoLevel = 0;
let bargeSince = 0;
let earClosedUntil = 0;
const ECHO_TAIL_MS = 450;

// "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "standby" | "error"
let state = "listening";
let turn = 0; // bumped on every new turn; stale async results are ignored

// Smoothed loudness per frequency band (low → high), 0..1
const levels = [0, 0, 0, 0];
const bands = [[1, 4], [4, 8], [8, 16], [16, 32]];

// Active visualizer style: "sunset" | "aurora" | "cosmic" | "zen" | "hearth" | "robot"
let currentTheme = store.get("friends.voiceTheme") || "sunset";

// Visualizer 1: Aurora ribbons, in warm colors. Each ribbon follows one part
// of the AI's voice: its pitch (gold), the two main vowel ranges (coral,
// rose) and the "s" sounds (orchid).
const auroraLayers = [
  { rgb: "255, 190, 110", band: 0, freq: 3.2, speed: 1.0, phase: 0.0 },
  { rgb: "255, 122, 110", band: 1, freq: 4.1, speed: -1.3, phase: 1.3 },
  { rgb: "255, 102, 168", band: 2, freq: 5.0, speed: 1.6, phase: 2.6 },
  { rgb: "190, 134, 255", band: 3, freq: 3.7, speed: -0.9, phase: 4.0 },
];
let auroraLast = 0;
let auroraFlow = 0; // how far the ribbons have moved; faster while it talks
let auroraEnergy = 0; // the voice's loudness last frame
let auroraPulse = 0; // a short bloom when a sound starts

// The aurora listens closer than the other styles. Their analyser measures
// in 750 Hz steps, which puts three of its four bands above most of a voice;
// this one measures in ~47 Hz steps, enough to split a voice into bands.
let outVoice = null;
let voiceBins = null;
const voiceLevels = [0, 0, 0, 0]; // bands: 90-300, 300-900, 900-2400, 2400-6000 Hz
const voiceFloor = [0, 0, 0, 0]; // the quietest level lately per band; only what's above it counts

// Visualizer 2: Sunset rolling hills
const sunsetHills = [
  { rgb: "255, 224, 130", band: 3, freq: 5.2, speed: 0.6, phase: 0.0 },
  { rgb: "255, 183, 77", band: 2, freq: 4.4, speed: -0.8, phase: 1.7 },
  { rgb: "255, 138, 101", band: 1, freq: 3.8, speed: 1.0, phase: 3.1 },
  { rgb: "216, 67, 21", band: 0, freq: 3.2, speed: -0.7, phase: 4.4 },
];

// Visualizer embers
const embers = Array.from({ length: 30 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 1 + Math.random() * 2.5,
  speed: 0.4 + Math.random() * 0.8,
  sway: Math.random() * Math.PI * 2,
}));

// Visualizer 3: Cosmic particles
const cosmicStars = Array.from({ length: 60 }, () => ({
  angle: Math.random() * Math.PI * 2,
  dist: 40 + Math.random() * 240,
  speed: (0.2 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1),
  size: 1 + Math.random() * 2.5,
  color: Math.random() > 0.5 ? "rgba(111, 156, 245, " : "rgba(235, 118, 255, ",
}));

// Visualizer 4: Zen ripples
const zenRipples = [];
let lastRippleTime = 0;

// Visualizer 5: Fireflies
const fireflies = Array.from({ length: 45 }, () => ({
  x: Math.random(),
  y: Math.random(),
  vx: (Math.random() - 0.5) * 0.002,
  vy: (Math.random() - 0.5) * 0.002,
  size: 1.5 + Math.random() * 2.5,
  alpha: Math.random(),
  glowSpeed: 1 + Math.random() * 2,
}));

const companionName = () => getSettings()?.personality.name || "Companion";
const isMuted = () => voiceMode.classList.contains("muted");

// Setup theme switcher buttons
function updateThemeButtons() {
  voiceMode.dataset.style = currentTheme;
  document.querySelectorAll(".voice-theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === currentTheme);
    btn.setAttribute("aria-pressed", String(btn.dataset.theme === currentTheme));
  });
}

let calmTimer = 0; // the quiet-seconds timer of the calm screen (below)

// The style you picked is remembered even when it can't be shown right now
// (the Robot without WebGL): Sunset stands in, and voice mode says why.
export function setVoiceTheme(theme, { save = true } = {}) {
  if (save) store.set("friends.voiceTheme", theme);
  if (theme === "robot" && robot.unavailable) {
    theme = "sunset";
    if (!voiceMode.hidden) noteRobotMissing();
  }
  currentTheme = theme;
  updateThemeButtons();
  syncRobot();
}

function noteRobotMissing() {
  note(`The 3D robot can't be shown: ${robot.unavailable} Showing Sunset instead.`, 5000);
}

// ---------- The Robot style ----------
const robotHost = document.getElementById("voice-robot");
const robotStyle = () => currentTheme === "robot";
// The robot is (or is about to be) on screen, so the AI may be offered its tools
const robotOnScreen = () => robotStyle() && !robot.unavailable && !voiceMode.hidden;
robot.host("voice", robotHost, { priority: 3, onFrame: compositeRobot, roomBelow: true, interactive: true, roam: true, world: true });

// Shown while voice mode is open in the Robot style
function syncRobot() {
  const on = robotStyle() && !voiceMode.hidden;
  voiceMode.classList.toggle("robot-style", robotStyle());
  robot.show("voice", on);
  if (!robotStyle()) closeScenePop();
  wake();
  if (on) setTimeout(showHint, 2500);
  resizeCanvas();
  live?.setRobot(robotOnScreen());
}

document.addEventListener("friends:robot-unavailable", () => {
  if (robotStyle()) setVoiceTheme("robot", { save: false });
});

// ---------- Filming mode (filming.js) ----------
const filmingLook = () => {
  const f = getSettings()?.robot?.filming || {};
  return { cameraFriendly: f.cameraFriendly !== false, largerFace: Boolean(f.largerFace) };
};

const filming = createFilming({
  root: voiceMode,
  controls: {
    running: () => Boolean(live || classicTts),
    // Waiting for the countdown (or paused): no engine, a calm robot
    pause() {
      stopEngine();
      stopSpeaking();
      caption("", "");
      setState("listening", "Filming mode");
    },
    resume() {
      if (voiceMode.hidden) return;
      robot.director.openVoice(); // it greets (and waves) again
      startEngine();
    },
    mute() {
      toggleMute();
      return isMuted();
    },
    interrupt() {
      if (state !== "speaking") return;
      if (live) {
        live.silence();
        setState("listening");
      } else {
        interrupt();
      }
    },
    onEnter() {
      closeRecordPop();
      closeScenePop();
      toggleDrawer(false);
      if (voiceTypeForm) voiceTypeForm.hidden = true;
      robot.setFilming(true, filmingLook());
    },
    onExit() {
      robot.setFilming(false);
    },
  },
});

document.getElementById("voice-filming").addEventListener("click", () => filming.enter());

// F opens filming mode (not while typing)
document.addEventListener("keydown", (e) => {
  if (voiceMode.hidden || filming.on || e.target.closest?.("input, textarea, select")) return;
  if (filming.isFilmingKey(e)) {
    e.preventDefault();
    filming.enter();
  }
});

// The robot's scene settings, without leaving voice mode
const sceneButton = document.getElementById("voice-scene");
const scenePop = document.getElementById("voice-scene-pop");

function closeScenePop() {
  scenePop.hidden = true;
  sceneButton.classList.remove("active");
  sceneButton.setAttribute("aria-expanded", "false");
}

sceneButton.addEventListener("click", () => {
  const open = scenePop.hidden;
  closeRecordPop();
  scenePop.hidden = !open;
  sceneButton.classList.toggle("active", open);
  sceneButton.setAttribute("aria-expanded", String(open));
});

// ---------- Calm screen ----------
// In the Robot style the buttons fade away after a few quiet seconds, leaving
// the robot and its room; any movement or key brings them back. They stay
// while something needs you (an error, a menu, the side panel, a hovered button).
const voiceTop = voiceMode.querySelector(".voice-top");
const voiceControls = voiceMode.querySelector(".voice-controls");

function calmAllowed() {
  if (!robotStyle() || voiceMode.hidden || filming.on) return false;
  if (state === "error" || state === "standby") return false;
  if (!document.getElementById("voice-perm-banner").hidden || !scenePop.hidden || !recordPop.hidden) return false;
  if (!document.getElementById("voice-drawer").hidden || (voiceTypeForm && !voiceTypeForm.hidden)) return false;
  return !voiceTop.matches(":hover, :focus-within") && !voiceControls.matches(":hover, :focus-within");
}

function wake() {
  voiceMode.classList.remove("calm");
  clearTimeout(calmTimer);
  if (robotStyle() && !voiceMode.hidden) {
    calmTimer = setTimeout(() => calmAllowed() && voiceMode.classList.add("calm"), 5000);
  }
}
for (const type of ["pointermove", "pointerdown", "touchstart"]) voiceMode.addEventListener(type, wake, { passive: true });
document.addEventListener("keydown", wake);

// Shown once: how to play with the robot
function showHint() {
  const hint = document.getElementById("voice-hint");
  if (store.get("friends.voiceHintSeen") || !robotStyle() || voiceMode.hidden) return;
  store.set("friends.voiceHintSeen", "1");
  hint.hidden = false;
  requestAnimationFrame(() => hint.classList.add("show"));
  setTimeout(() => {
    hint.classList.remove("show");
    setTimeout(() => (hint.hidden = true), 700);
  }, 7000);
}

// M mutes (not while typing)
document.addEventListener("keydown", (e) => {
  if (voiceMode.hidden || filming.on || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.toLowerCase() !== "m" || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  toggleMute();
});

// Event Listeners
document.getElementById("voice-open")?.addEventListener("click", (e) => {
  e.preventDefault();
  openVoice();
});
document.getElementById("hero-voice-btn")?.addEventListener("click", (e) => {
  e.preventDefault();
  openVoice();
});
document.getElementById("voice-end")?.addEventListener("click", endVoice);

// End: the robot waves goodbye first. The conversation stops at once; the
// screen closes within a second (at once on a second press, or without the robot).
let endTimer = null;
function endVoice() {
  if (voiceMode.hidden) return;
  if (endTimer || !robotStyle() || !robot.engine?.running) return closeVoice();
  stopEngine();
  stopSpeaking();
  caption("", "");
  robot.director.voiceState("listening");
  const ms = Math.min(900, robot.director.goodbye());
  endTimer = setTimeout(closeVoice, ms);
}
voiceMute?.addEventListener("click", toggleMute);
voiceFullscreen?.addEventListener("click", toggleFullscreen);
window.addEventListener("resize", resizeCanvas);

// ---------- The engine pill ----------
const enginePill = document.getElementById("voice-engine");
const engineIcon = document.getElementById("voice-engine-icon");
const engineLabel = document.getElementById("voice-engine-label");

// What's actually running (Live may have fallen back to Studio)
const runningEngine = () => (live ? "live" : classicTts || engineChoice);

function updateEnginePill() {
  const running = runningEngine();
  const info = ENGINES[running];
  engineIcon.textContent = info.icon;
  engineLabel.textContent = info.label;
  enginePill.classList.toggle("active", running === "live");
  enginePill.title = running === engineChoice ? info.title : `${info.title} (Live isn't available right now.)`;
}

enginePill.addEventListener("click", () => {
  engineChoice = ORDER[(ORDER.indexOf(runningEngine()) + 1) % ORDER.length];
  store.set("friends.voiceEngine", engineChoice);
  updateEnginePill();
  if (!voiceMode.hidden) startEngine();
});
updateEnginePill();

// Clicking on status allows retrying microphone connection
voiceStatus?.addEventListener("click", () => {
  if (state === "error" || state === "standby" || !micStream) retryMic();
});

// Permission banner actions
document.getElementById("voice-perm-retry-btn")?.addEventListener("click", retryMic);

document.getElementById("voice-perm-type-btn")?.addEventListener("click", () => {
  hidePermBanner();
  if (voiceTypeForm) {
    voiceTypeForm.hidden = false;
    voiceTypeInput?.focus();
  }
});

function showPermBanner(canRetry, text) {
  const banner = document.getElementById("voice-perm-banner");
  if (!banner) return;
  banner.hidden = false;
  document.getElementById("voice-perm-title").textContent = "Microphone Permission Required";
  document.getElementById("voice-perm-text").textContent =
    text || "Click the lock 🔒 or site settings icon in your browser address bar, set Microphone to 'Allow', then click 'Try Allow'.";
  document.getElementById("voice-perm-retry-btn").hidden = !canRetry;
}

function hidePermBanner() {
  const banner = document.getElementById("voice-perm-banner");
  if (banner) banner.hidden = true;
}

// Keyboard type toggle inside voice mode
const voiceKeyboardBtn = document.getElementById("voice-keyboard-btn");
const voiceTypeForm = document.getElementById("voice-type-form");
const voiceTypeInput = document.getElementById("voice-type-input");

voiceKeyboardBtn?.addEventListener("click", () => {
  if (!voiceTypeForm) return;
  const isHidden = voiceTypeForm.hidden;
  voiceTypeForm.hidden = !isHidden;
  if (!voiceTypeForm.hidden) {
    voiceTypeInput?.focus();
  }
});

voiceTypeForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const val = voiceTypeInput?.value?.trim();
  if (val) {
    voiceTypeInput.value = "";
    voiceTypeForm.hidden = true;
    askInVoice(val);
  }
});

// Hide everything but the visualizer; the same button brings it all back
const voiceHide = document.getElementById("voice-hide");
voiceHide?.addEventListener("click", () => {
  const hidden = voiceMode.classList.toggle("ui-hidden");
  voiceHide.title = hidden ? "Show everything" : "Hide everything";
  voiceHide.setAttribute("aria-pressed", String(hidden));
});

voiceThemeBar?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-theme]");
  if (btn) setVoiceTheme(btn.dataset.theme);
});

// Tap anywhere on canvas to interrupt
canvas?.addEventListener("click", () => {
  if (state !== "speaking") return;
  if (live) {
    live.silence();
    setState("listening");
  } else {
    interrupt();
  }
});

const STATUS = {
  connecting: "Connecting…",
  listening: "Listening…",
  hearing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking · tap to interrupt",
  standby: "Microphone standby · Click to enable",
  error: "Microphone unavailable",
};

// A short message in the status pill that wins over the normal status for a while
let noteUntil = 0;
let noteTimer = null;

function note(text, ms = 3000) {
  clearTimeout(noteTimer);
  noteUntil = text ? performance.now() + ms : 0;
  if (text) voiceStatus.textContent = text;
  noteTimer = setTimeout(() => {
    noteUntil = 0;
    setState(state);
  }, text ? ms : 0);
}

function setState(next, text) {
  state = next;
  voiceMode.dataset.state = next;
  robot.director.voiceState(next, { muted: isMuted() });
  if (performance.now() < noteUntil) return;
  if (isMuted() && (next === "listening" || next === "hearing")) {
    voiceStatus.textContent = "Microphone muted";
  } else {
    voiceStatus.textContent = text || STATUS[next] || "";
  }
}

// ---------- Captions ----------
// On screen (under the status), and drawn into recorded videos when wanted
let captionLine = { user: false, text: "", at: 0 };
let userLine = ""; // what you said this turn (Live)
let aiLine = ""; // what it said this turn (Live)

let captionShown = { who: "", text: "" };

// Words fade in as they arrive; a line that only grows (streaming) adds just the new words
function appendWords(el, text, stagger) {
  const parts = text.match(/\S+\s*|\s+/g) || [];
  parts.forEach((part, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = part;
    if (stagger) span.style.animationDelay = `${Math.min(i * 22, 380)}ms`;
    el.append(span);
  });
}

function caption(who, text) {
  if (!text) {
    voiceCaption.innerHTML = "";
    captionShown = { who: "", text: "" };
    return;
  }
  const isUser = who === "You";
  const body = voiceCaption.querySelector(".caption-text");
  if (body && captionShown.who === who && text.startsWith(captionShown.text)) {
    appendWords(body, text.slice(captionShown.text.length), false);
  } else {
    voiceCaption.innerHTML = `
    <span class="caption-tag ${isUser ? "user" : "companion"}"></span>
    <span class="caption-text"></span>
  `;
    voiceCaption.querySelector(".caption-tag").textContent = who;
    appendWords(voiceCaption.querySelector(".caption-text"), text, true);
  }
  captionShown = { who, text };
}

function showCaption(who, text, isUser) {
  caption(who, text);
  captionLine = { user: isUser, text, at: performance.now() };
}

export function isVoiceOpen() {
  return !voiceMode.hidden;
}

// The side panel starts with the open chat's drafts and messages
async function loadDrawer() {
  const id = getCurrentChatId();
  resetDrawer();
  if (!id) return;
  try {
    const chat = await api.chats.get(id);
    if (getCurrentChatId() === id) resetDrawer(chat.messages);
  } catch {}
}

export async function openVoice() {
  if (!voiceMode.hidden) return;
  const session = ++opened;
  voiceMode.hidden = false;
  updateThemeButtons();
  voiceMode.classList.remove("muted");
  robot.director.openVoice();
  syncRobot();
  resizeCanvas();
  if (store.get("friends.voiceTheme") === "robot" && robot.unavailable) noteRobotMissing();
  setState("connecting");
  caption("", "");
  captionLine = { user: false, text: "", at: 0 };
  loadDrawer();
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(draw);

  await ensureAudioOutput();
  await startAudio();
  if (voiceMode.hidden || session !== opened) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!voiceMode.hidden && audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  }, 400);
  startEngine();
}

export function closeVoice() {
  if (voiceMode.hidden) return;
  const session = opened;
  clearTimeout(endTimer);
  endTimer = null;
  filming.exit({ resume: false });
  voiceMode.hidden = true;
  robot.director.closeVoice();
  syncRobot();
  closeScenePop();
  turn++;
  // A recording in progress is saved first, while its audio still runs
  const saving = recorder ? stopRecording() : null;
  stopEngine();
  closeRecordPop();
  toggleDrawer(false);
  stopReply();
  hidePermBanner();
  caption("", "");
  Promise.resolve(saving).finally(() => {
    if (voiceMode.hidden && session === opened) stopAudio();
  });
  // Live saved each turn on the helper; show them in the chat
  reloadChat();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    voiceMode.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function makeAnalyser() {
  const a = audioCtx.createAnalyser();
  a.fftSize = 64;
  a.smoothingTimeConstant = 0.6;
  return a;
}

function makeVoiceAnalyser() {
  const a = audioCtx.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0.5;
  return a;
}

// The AI's side of the audio: one bus to the speakers, the visualizer and the recorder
async function ensureAudioOutput() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    if (!aiBus) {
      aiBus = audioCtx.createGain();
      aiBus.connect(audioCtx.destination);
      outAnalyser = makeAnalyser();
      aiBus.connect(outAnalyser);
      outVoice = makeVoiceAnalyser();
      aiBus.connect(outVoice);
      freqData = new Uint8Array(outAnalyser.frequencyBinCount);
      player = new Audio();
      audioCtx.createMediaElementSource(player).connect(aiBus);
    }
  } catch (err) {
    console.warn("Audio output setup warning:", err);
  }
}

// Your microphone. Resolves true when it's on.
async function startAudio() {
  await ensureAudioOutput();

  if (!navigator?.mediaDevices?.getUserMedia) {
    setState("standby", "Microphone not supported by browser");
    showPermBanner(false, "Microphone is not supported in this browser. You can still type to talk with your companion.");
    return false;
  }
  if (micStream?.active) {
    hidePermBanner();
    return true;
  }

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
        setState("standby", "Microphone permission needed · Click to allow");
        showPermBanner(true, "Microphone access is blocked by your browser. Click the site settings 🔒 icon in your browser address bar to allow.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setState("standby", "No microphone detected · Click to retry");
        showPermBanner(false, "No microphone detected on this device. You can still type to talk with your companion.");
      } else {
        setState("standby", "Microphone standby · Click to retry");
        showPermBanner(true, "Unable to access microphone. Click 'Try Allow' below or type to converse.");
      }
      return false;
    }
  }

  if (voiceMode.hidden) {
    stream.getTracks().forEach((t) => t.stop());
    return false;
  }

  hidePermBanner();
  micStream = stream;
  try {
    if (audioCtx.state === "suspended") await audioCtx.resume();
    micSource = audioCtx.createMediaStreamSource(stream);
    micAnalyser = makeAnalyser();
    micSource.connect(micAnalyser);
    return true;
  } catch (err) {
    console.warn("Microphone processing pipeline setup:", err);
    setState("standby", "Microphone standby");
    return false;
  }
}

async function retryMic() {
  if (await startAudio()) startEngine();
}

function stopAudio() {
  clearInterval(vadTimer);
  clearInterval(heartbeatTimer);
  cancelAnimationFrame(rafId);
  stopEngine();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  stopSpeaking();
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  micStream = null;
  micSource = null;
  micAnalyser = null;
  aiBus = null;
  outAnalyser = null;
  outVoice = null;
  freqData = null;
  player = null;
  recording = null;
}

function toggleMute() {
  if (!micStream) {
    retryMic();
    return;
  }
  const muted = voiceMode.classList.toggle("muted");
  micStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  voiceMute.title = muted ? "Unmute microphone" : "Mute microphone";
  voiceMute.setAttribute("aria-pressed", String(muted));
  live?.setMuted(muted);
  if (muted) {
    recording = null;
    setState(state === "speaking" ? "speaking" : "listening");
  } else if (!live) {
    listen();
  } else {
    setState(state);
  }
}

// ---------- Starting and switching engines ----------
async function startEngine() {
  stopEngine();
  if (engineChoice !== "live") return startClassic(engineChoice);
  // Gemini Live is Google's; a local AI speaks through Studio voice
  if (!liveWanted()) {
    const local = getLocalBrainId();
    if (local) api.local.warm(local, true); // the speech models too
    return startClassic("studio");
  }

  setState("connecting");
  const voice = new LiveVoice({ audioCtx, micSource, output: aiBus, handlers: liveHandlers() });
  live = voice;
  updateEnginePill();
  try {
    await voice.start({ chatId: getCurrentChatId(), brainId: getSelectedBrainId(), googleAccessToken: getAccessToken(), robot: robotOnScreen() });
    if (live !== voice) return;
    voice.setMuted(isMuted());
    setState("listening");
  } catch (err) {
    if (live !== voice) return; // closed or switched meanwhile
    voice.stop();
    live = null;
    if (err.message === "NO_BRAIN") {
      updateEnginePill();
      return setState("error", voiceErrorText("NO_BRAIN"));
    }
    liveUnavailable(err.message);
  }
}

function stopEngine() {
  if (live) {
    live.stop();
    live = null;
  }
  stopClassic();
}

// Live didn't work out: carry on with Studio voice, and say why
function liveUnavailable(message) {
  live?.stop();
  live = null;
  if (voiceMode.hidden) return;
  note(`${message} Using Studio voice instead.`, 6000);
  startClassic("studio");
}

function liveHandlers() {
  let thinkingTimer = null;
  return {
    onSpeaking(speaking) {
      if (speaking) {
        clearTimeout(thinkingTimer);
        setState("speaking");
      } else if (state === "speaking") {
        setState("listening");
      }
    },
    onTranscript(role, text) {
      addTranscript(role, text);
      robot.director.caption(role, text);
      if (role === "user") {
        userLine += text;
        showCaption("You", userLine.trim(), true);
        if (state !== "speaking") {
          setState("hearing");
          clearTimeout(thinkingTimer);
          thinkingTimer = setTimeout(() => state === "hearing" && setState("thinking"), 900);
        }
      } else {
        aiLine += text;
        showCaption(companionName(), aiLine.trim(), false);
      }
    },
    onInterrupted() {
      aiLine = "";
    },
    onTurnComplete() {
      endTurn();
      robot.director.turnDone();
      userLine = "";
      aiLine = "";
      clearTimeout(thinkingTimer);
      if (state === "hearing" || state === "thinking") setState("listening");
    },
    onChat: ({ id }) => adoptChat(id),
    onActivity: (text) => note(text, 2500),
    onRobot: (event) => robot.director.toolEvent(event),
    onDraft(draft) {
      addDraft(draft);
      note(`Draft ready: ${draft.title}`, 3000);
    },
    onConfirm: ({ summary, details }) => promptConfirmation(summary, details),
    onReconnecting: () => note("Reconnecting…", 10000),
    onResumed: () => note("", 0),
    onError: (message) => liveUnavailable(message),
    onClosed: () => liveUnavailable("The live connection closed."),
  };
}

// ---------- Studio and Instant voice ----------
function startClassic(tts) {
  classicTts = tts === "instant" ? "instant" : "studio";
  updateEnginePill();
  if (micSource && !recorderNode) {
    recorderNode = audioCtx.createScriptProcessor(4096, 1, 1);
    recorderNode.onaudioprocess = (e) => capture(e.inputBuffer.getChannelData(0));
    micSource.connect(recorderNode);
    recorderNode.connect(audioCtx.destination);
  }
  clearInterval(vadTimer);
  vadTimer = setInterval(detectSpeech, 40);
  listen();
}

function stopClassic() {
  clearInterval(vadTimer);
  vadTimer = null;
  if (recorderNode) {
    try {
      micSource?.disconnect(recorderNode);
    } catch {}
    recorderNode.disconnect();
    recorderNode.onaudioprocess = null;
    recorderNode = null;
  }
  if (classicTts) {
    turn++;
    stopSpeaking();
    stopReply();
    recording = null;
    classicTts = null;
  }
}

// Queue of reply pieces, played one after another
let sentenceQueue = [];
let isDrainingQueue = false;
let currentSentenceAbort = null;

function clearSentenceQueue() {
  sentenceQueue = [];
  isDrainingQueue = false;
  if (currentSentenceAbort) {
    currentSentenceAbort();
    currentSentenceAbort = null;
  }
}

// The next piece of a reply to speak: the first sentence on its own (so it
// starts talking soon), then about two sentences at a time, which sounds
// more natural and needs fewer voice requests. Right away when nothing is
// playing, so there's no silence while it waits.
function takeSpeakable(text, { first, idle, all }) {
  if (all) return text.trim() ? text : null;
  const ends = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g;
  let cut = -1;
  for (let m; (m = ends.exec(text)); ) {
    const end = m.index + m[0].length;
    if (end < 12) continue;
    cut = end;
    if (first || idle || end >= 180) break;
  }
  if (cut < 0 || (!first && !idle && cut < 180)) return null;
  return text.slice(0, cut);
}

// Something you said (or typed): the AI answers, and its reply is spoken
export async function askInVoice(text) {
  if (!text || !text.trim()) return;
  const said = text.trim();
  if (live) {
    addTranscript("user", said);
    endTurn();
    showCaption("You", said, true);
    robot.director.userSaid(said);
    live.sendText(said);
    setState("thinking");
    return;
  }
  const mine = ++turn;
  stopSpeaking();
  clearSentenceQueue();
  recording = null;
  showCaption("You", said, true);
  addTranscript("user", said);
  robot.director.resetTurn();
  robot.director.userSaid(said);
  setState("thinking", "Thinking…");

  await ensureAudioOutput();

  let fullReply = "";
  let buffer = "";
  let pieces = 0;
  let streamFinished = false;

  // The whole reply has been said: the turn is over (Smarter moods reads it now)
  const finishTurn = () => {
    robot.director.turnDone();
    listen();
  };

  const playNextSentence = async () => {
    if (isDrainingQueue) return;
    isDrainingQueue = true;

    while (sentenceQueue.length > 0 && mine === turn) {
      const item = sentenceQueue.shift();
      try {
        if (state !== "speaking") {
          speakingSince = performance.now();
          echoLevel = 0;
          bargeSince = 0;
        }
        setState("speaking");
        showCaption(companionName(), item.cumulativeText, false);
        // This piece's mood shows as it starts to be heard
        robot.director.pieceStarts(item.reading, item.text);
        await item.playPromise();
      } catch (err) {
        console.warn("Sentence playback error:", err);
      }
    }

    isDrainingQueue = false;
    if (mine !== turn) return;
    if (streamFinished && sentenceQueue.length === 0) finishTurn();
    else speakMore(); // it finished before the next piece was ready
  };

  const queueSentence = (sentenceText) => {
    const clean = sentenceText.replace(/[*_#`~]/g, "").trim();
    if (!clean || clean.length < 2) return;

    // Studio voice: start making the audio now, so it's ready when its turn comes
    const studio = classicTts !== "instant";
    const audio = studio ? api.voice.speak(clean, getSettings()?.personality.voice || 1).catch(() => null) : null;
    const cumulativeText = fullReply;
    // Read now; its mood shows when the piece starts playing (see playNextSentence)
    const reading = robot.director.readPiece(clean, { turnStart: pieces === 1 });

    const playPromise = async () => {
      if (mine !== turn) return;
      if (studio) await speakWithAudioBlob(clean, mine, audio);
      else await speakWithSpeechSynthesis(clean, mine);
    };

    sentenceQueue.push({ cumulativeText, playPromise, reading, text: `${clean} ` });
    playNextSentence();
  };

  const speakMore = (all = false) => {
    for (;;) {
      const piece = takeSpeakable(buffer, { first: pieces === 0, idle: !isDrainingQueue && !sentenceQueue.length, all });
      if (!piece) return;
      buffer = buffer.slice(piece.length);
      pieces++;
      queueSentence(piece);
      if (all) return;
    }
  };

  try {
    const { error } = await askFromVoice(said, {
      robot: robotOnScreen(),
      onChunk(chunk) {
        if (mine !== turn) return;
        fullReply += chunk;
        buffer += chunk;
        addTranscript("model", chunk);
        speakMore();
      },
      onDraft(draft) {
        if (mine !== turn) return;
        addDraft(draft);
        note(`Draft ready: ${draft.title}`, 3000);
      },
    });

    if (mine !== turn) return;
    if (error) throw new Error(error);

    endTurn();
    streamFinished = true;
    speakMore(true);
    if (sentenceQueue.length === 0 && !isDrainingQueue) finishTurn();
  } catch (err) {
    if (mine !== turn) return;
    endTurn();
    setState("error", voiceErrorText(err.message));
    setTimeout(() => {
      if (mine === turn) listen();
    }, 2500);
  }
}

// A system voice in the browser's language, preferring the natural-sounding ones
let systemVoice;
function pickSystemVoice() {
  if (systemVoice !== undefined) return systemVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet; try again next sentence
  const good = (v) => /Natural|Google|Siri|Samantha/.test(v.name);
  const lang = (navigator.language || "en").slice(0, 2);
  const inLang = voices.filter((v) => v.lang.startsWith(lang));
  const english = voices.filter((v) => v.lang.startsWith("en"));
  systemVoice = inLang.find(good) || inLang[0] || english.find(good) || english[0] || null;
  return systemVoice;
}

// Native SpeechSynthesis (Instant voice: no network, starts speaking in < 150ms)
function speakWithSpeechSynthesis(sentence, mine) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || mine !== turn) return resolve();

    const utterance = new SpeechSynthesisUtterance(sentence);
    const s = getSettings();
    utterance.rate = s ? playbackRate(s) : 1;
    utterance.pitch = 1.0;

    const naturalVoice = pickSystemVoice();
    if (naturalVoice) utterance.voice = naturalVoice;

    let finished = false;
    const done = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };

    utterance.onend = done;
    utterance.onerror = done;
    currentSentenceAbort = () => {
      window.speechSynthesis.cancel();
      done();
    };

    const words = sentence.split(/\s+/).length;
    const maxTimeout = Math.max(1500, words * 700);
    setTimeout(done, maxTimeout);

    window.speechSynthesis.speak(utterance);
  });
}

// Studio voice: a Gemini voice, made for this piece while the one before played
async function speakWithAudioBlob(sentence, mine, audio) {
  if (mine !== turn) return;
  const s = getSettings();

  try {
    const blob = await audio;
    if (!blob) throw new Error("No audio");
    if (mine !== turn) return;

    await new Promise((resolve) => {
      if (!player) return resolve();
      if (player.src) URL.revokeObjectURL(player.src);
      player.src = URL.createObjectURL(blob);
      player.playbackRate = s ? playbackRate(s) : 1;
      player.onended = resolve;
      player.onerror = resolve;
      currentSentenceAbort = () => {
        player.pause();
        resolve();
      };
      player.play().catch(resolve);
    });
  } catch (err) {
    // No Gemini voice for this piece (e.g. its quota ran out): the browser's voice says it
    await speakWithSpeechSynthesis(sentence, mine);
  }
}

// ----- Listening (Studio / Instant): voice detection, then Gemini transcribes -----
// Gemini transcribes in whatever language you speak, and English and German
// can be mixed. Pauses of over half a second are allowed, so you can think
// mid-sentence, and one turn can be up to a minute long.
const END_SILENCE_MS = 650;
const MAX_TURN_MS = 60000;
let recording = null;
let preRoll = [];
let loudSince = 0;
const timeData = new Float32Array(1024);

function capture(samples) {
  const copy = new Float32Array(samples);
  if (recording) recording.chunks.push(copy);
  preRoll.push(copy);
  const keep = Math.ceil((0.35 * (audioCtx?.sampleRate || 48000)) / 4096);
  if (preRoll.length > keep) preRoll.shift();
}

function micLevel() {
  if (!micAnalyser) return 0;
  micAnalyser.getFloatTimeDomainData(timeData);
  let sum = 0;
  for (const v of timeData) sum += v * v;
  return Math.sqrt(sum / timeData.length);
}

function detectSpeech() {
  if (!micAnalyser || isMuted()) return;

  const level = micLevel();
  const now = performance.now();

  // Interrupting by voice: learn how loud the AI's own echo is, then only
  // react to something clearly louder that lasts (you talking over it)
  if (state === "speaking") {
    const since = now - speakingSince;
    if (since < 700) {
      echoLevel = Math.max(echoLevel, level);
      return;
    }
    // echoLevel holds the loudest recent echo and slowly lets go of it
    const bargeLevel = Math.max(0.06, echoLevel * 2.5, ambientFloor * 5);
    if (level > bargeLevel) {
      bargeSince = bargeSince || now;
      if (now - bargeSince > 350) {
        bargeSince = 0;
        interrupt();
      }
    } else {
      bargeSince = 0;
      echoLevel = Math.max(level, echoLevel * 0.995);
    }
    return;
  }

  if (state !== "listening" && state !== "hearing") return;
  if (now < earClosedUntil) return;

  // Rolling background-noise level, only measured while nobody is talking
  if (!recording) ambientFloor = ambientFloor * 0.96 + level * 0.04;
  const dynamicStart = Math.max(0.018, ambientFloor * 2.2);
  const dynamicQuiet = Math.max(0.011, ambientFloor * 1.35);

  if (!recording) {
    loudSince = level > dynamicStart ? loudSince || now : 0;
    if (loudSince && now - loudSince > 100) {
      recording = { chunks: [...preRoll], started: now, lastLoud: now };
      setState("hearing", "Hearing you…");
    }
    return;
  }

  if (level > dynamicQuiet) recording.lastLoud = now;
  if (now - recording.lastLoud > END_SILENCE_MS || now - recording.started > MAX_TURN_MS) {
    const done = recording;
    recording = null;
    loudSince = 0;
    if (done.lastLoud - done.started > 220) handleUtterance(done.chunks);
    else setState("listening");
  }
}

function listen() {
  turn++;
  const wasSpeaking = state === "speaking";
  stopSpeaking();
  clearSentenceQueue();
  recording = null;
  loudSince = 0;
  if (wasSpeaking) earClosedUntil = performance.now() + ECHO_TAIL_MS;
  setState("listening");

  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

// You cut the AI off: you're already talking, so listen again almost at once
function interrupt() {
  listen();
  earClosedUntil = performance.now() + 120;
}

async function handleUtterance(chunks) {
  const mine = ++turn;
  setState("thinking", "Understanding…");
  try {
    const text = await api.voice.transcribe(toWav(chunks, audioCtx.sampleRate));
    if (mine !== turn) return;
    if (!text || text.trim().length < 2) return listen();
    askInVoice(text);
  } catch (err) {
    if (mine !== turn) return;
    setState("error", voiceErrorText(err.message));
    setTimeout(() => {
      if (mine === turn) listen();
    }, 2000);
  }
}

function stopSpeaking() {
  clearSentenceQueue();
  if (player) {
    player.pause();
    player.onended = null;
    player.onerror = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function toWav(chunks, inputRate) {
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

// ---------- Recording a video ----------
const recordButton = document.getElementById("voice-record");
const recordPop = document.getElementById("voice-record-pop");
const recordFrames = document.getElementById("voice-rec-frame");
const recordMic = document.getElementById("voice-rec-mic");
const recordCaptions = document.getElementById("voice-rec-captions");
const recordTime = document.getElementById("voice-rec-time");

const FRAMES = { "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 } };
const recOptions = { frame: "screen", mic: true, captions: true };
try {
  Object.assign(recOptions, JSON.parse(store.get("friends.recordOptions") || "{}"));
} catch {}
let recorder = null;
let recTimer = null;
let activeFrame = null; // the video format shown while choosing or recording

function saveRecOptions() {
  store.set("friends.recordOptions", JSON.stringify(recOptions));
}

function syncRecordPop() {
  recordFrames.querySelectorAll("[data-frame]").forEach((b) => b.classList.toggle("active", b.dataset.frame === recOptions.frame));
  recordMic.checked = recOptions.mic;
  recordCaptions.checked = recOptions.captions;
}

function openRecordPop() {
  syncRecordPop();
  recordPop.hidden = false;
  recordButton.classList.add("active");
  activeFrame = recOptions.frame; // preview the format
  resizeCanvas();
}

function closeRecordPop() {
  recordPop.hidden = true;
  recordButton.classList.remove("active");
  if (!recorder) {
    activeFrame = null;
    resizeCanvas();
  }
}

recordButton.addEventListener("click", () => {
  if (recorder) stopRecording();
  else if (recordPop.hidden) openRecordPop();
  else closeRecordPop();
});
recordFrames.addEventListener("click", (e) => {
  const button = e.target.closest("[data-frame]");
  if (!button) return;
  recOptions.frame = button.dataset.frame;
  saveRecOptions();
  syncRecordPop();
  activeFrame = recOptions.frame;
  resizeCanvas();
});
recordMic.addEventListener("change", () => {
  recOptions.mic = recordMic.checked;
  saveRecOptions();
});
recordCaptions.addEventListener("change", () => {
  recOptions.captions = recordCaptions.checked;
  saveRecOptions();
});
document.getElementById("voice-rec-start").addEventListener("click", startRecording);

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function startRecording() {
  closeRecordPop();
  if (!audioCtx || !aiBus) return note("Voice mode is still starting. Try again in a moment.");
  if (!videoType()) return note("This browser can't record video.", 4000);
  // The browser's own voice plays outside the page, where it can't be recorded
  if (!live && classicTts === "instant") {
    startClassic("studio");
    note("Instant voice can't be recorded, so Studio voice is on.", 4000);
  }
  const sources = [aiBus];
  if (recOptions.mic && micSource) sources.push(micSource);
  const next = new VoiceRecorder({ canvas, audioCtx, sources });
  try {
    next.start();
  } catch (err) {
    return note(err.message, 4000);
  }
  recorder = next;
  activeFrame = recOptions.frame;
  resizeCanvas();
  voiceMode.classList.add("recording");
  voiceMode.classList.toggle("canvas-captions", recOptions.captions);
  recordButton.title = "Stop recording and save the video";
  recordTime.textContent = "0:00";
  clearInterval(recTimer);
  recTimer = setInterval(() => (recordTime.textContent = clock(recorder?.seconds || 0)), 500);
}

async function stopRecording() {
  const current = recorder;
  if (!current) return;
  recorder = null;
  clearInterval(recTimer);
  voiceMode.classList.remove("recording", "canvas-captions");
  recordButton.title = "Record a video";
  const { blob, extension, seconds } = await current.stop();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  download(blob, `friends-voice-${stamp}.${extension}`);
  note(`Saved the video (${clock(seconds)}).`, 4000);
  activeFrame = null;
  resizeCanvas();
}

// Captions drawn into the picture: the recorded video gets them too (not
// while filming mode has them switched off)
const captionsOnCanvas = () => (recorder || !recordPop.hidden) && recOptions.captions && !voiceMode.classList.contains("captions-off");

function drawCaptions(w, h) {
  const { text, user, at } = captionLine;
  if (!text) return;
  const age = performance.now() - at;
  const fade = age < 4000 ? 1 : Math.max(0, 1 - (age - 4000) / 600);
  if (!fade) return;

  const portrait = h > w;
  const size = Math.round(Math.min(w, h) * (portrait ? 0.05 : 0.042));
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxWidth = w * (portrait ? 0.86 : 0.72);

  // The last two lines of what's being said
  const lines = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(-2);

  const lineHeight = size * 1.35;
  let y = h * (portrait ? 0.8 : 0.84) - ((shown.length - 1) * lineHeight) / 2;
  for (const line of shown) {
    const width = ctx.measureText(line).width + size * 1.1;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * fade})`;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(w / 2 - width / 2, y - lineHeight / 2, width, lineHeight, size * 0.3);
    else ctx.rect(w / 2 - width / 2, y - lineHeight / 2, width, lineHeight);
    ctx.fill();
    ctx.fillStyle = user ? `rgba(255, 236, 214, ${0.8 * fade})` : `rgba(255, 255, 255, ${fade})`;
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }
}

// ---------- The visualizer ----------
let view = { w: 0, h: 0 }; // drawing size: the screen (CSS pixels) or the video format

function resizeCanvas() {
  const frame = FRAMES[activeFrame];
  voiceMode.classList.toggle("framed", Boolean(frame) || Boolean(recorder));
  if (frame) {
    canvas.width = frame.w;
    canvas.height = frame.h;
    view = { w: frame.w, h: frame.h };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    syncRobotSize();
    return;
  }
  if (recorder) return syncRobotSize(); // a recording keeps its size; the screen just letterboxes it
  // Full resolution on HiDPI screens costs a lot per frame for soft waves;
  // even sizes, because video encoders need them
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  view = { w: canvas.clientWidth, h: canvas.clientHeight };
  canvas.width = even(view.w * dpr);
  canvas.height = even(view.h * dpr);
  if (view.w && view.h) ctx.setTransform(canvas.width / view.w, 0, 0, canvas.height / view.h, 0, 0);
  syncRobotSize();
}

// ---------- Voices for the robot ----------
// Its voice: the same bands the Aurora listens to. Yours: only while it's
// silent (or after you cut in, which makes it silent), never its echo.
function feedRobot() {
  readVoiceLevels();
  robot.director.aiAudio(voiceLevels);
  const mine = userVoiceLevel();
  robot.director.userAudio(mine);
  setMicRing(mine);
}

// The mic button shows how loud you are: a ring that swells with your voice
let micRing = 0;
function setMicRing(level) {
  const next = micRing + (level - micRing) * 0.35;
  if (Math.abs(next - micRing) < 0.015 && !(next === 0 && micRing !== 0)) return;
  micRing = next < 0.01 ? 0 : next;
  voiceMute.style.setProperty("--mic", micRing.toFixed(2));
}

let micFloor = 0.01; // the room's noise lately
function userVoiceLevel() {
  if (!micAnalyser || isMuted() || state === "speaking") return 0;
  if (live ? live.aiAudible() : performance.now() < earClosedUntil) return 0;
  const level = micLevel();
  micFloor += (level - micFloor) * (level < micFloor ? 0.2 : 0.002);
  return Math.min(1, Math.max(0, (level - micFloor * 1.6 - 0.006) / 0.07));
}

// In a video frame (choosing a format, or recording) the robot renders at the
// video's size and is copied into this canvas each frame, with the captions
function syncRobotSize() {
  const framed = voiceMode.classList.contains("framed");
  robot.options("voice", { fixed: framed && robotStyle() ? [canvas.width, canvas.height] : null });
}

function compositeRobot(glCanvas) {
  if (!robotStyle() || !voiceMode.classList.contains("framed")) return;
  const { w, h } = view;
  if (!w || !h) return;
  ctx.drawImage(glCanvas, 0, 0, w, h);
  if (captionsOnCanvas()) drawCaptions(w, h);
}

// The system voice (Instant) plays outside the page, so there's nothing to
// measure: the visualizer moves like speech, about four syllables a second
const systemVoiceSpeaking = () => state === "speaking" && window.speechSynthesis?.speaking;

// Aurora: how strongly each part of the AI's voice sounds right now, 0..1
function readVoiceLevels() {
  if (systemVoiceSpeaking()) {
    const t = performance.now() / 1000;
    voiceLevels.forEach((v, i) => {
      const syllables = Math.abs(Math.sin(t * (13 + i * 2.1) + i * 1.9));
      const phrase = 0.6 + 0.4 * Math.sin(t * 1.7 + i * 0.8);
      voiceLevels[i] += ((0.25 + 0.6 * syllables * syllables) * phrase - v) * 0.25;
    });
    return;
  }
  // Only the AI's voice moves the visualizer, never yours
  if (state !== "speaking" || !outVoice) {
    voiceLevels.forEach((v, i) => (voiceLevels[i] = v * 0.9));
    return;
  }
  if (!voiceBins || voiceBins.length !== outVoice.frequencyBinCount) voiceBins = new Uint8Array(outVoice.frequencyBinCount);
  outVoice.getByteFrequencyData(voiceBins);
  // Quick to rise, so it feels alive; slower to fall, so it's smooth (robot/bands.mjs)
  updateVoiceLevels(voiceBins, audioCtx.sampleRate / outVoice.fftSize, voiceFloor, voiceLevels);
}

function readLevels() {
  if (systemVoiceSpeaking()) {
    const t = performance.now() / 1000;
    bands.forEach((_, i) => {
      const sim = 0.2 + 0.35 * Math.abs(Math.sin(t * (3.5 + i * 1.8)));
      levels[i] += (sim - levels[i]) * 0.3;
    });
    return;
  }
  // Only the AI's voice moves the visualizer, never yours
  const analyser = state === "speaking" ? outAnalyser : null;
  if (analyser && freqData) analyser.getByteFrequencyData(freqData);
  bands.forEach(([from, to], i) => {
    let sum = 0;
    if (analyser && freqData) for (let b = from; b < to; b++) sum += freqData[b];
    const target = Math.min(1, (sum / (to - from) / 255) * 1.8);
    levels[i] += (target - levels[i]) * (target > levels[i] ? 0.35 : 0.08);
  });
}

function draw(now) {
  rafId = requestAnimationFrame(draw);
  // The robot draws itself; compositeRobot() fills this canvas when it's framed
  if (robotStyle()) return feedRobot();
  const t = now / 1000;
  const { w, h } = view;
  if (!w || !h) return;

  setMicRing(userVoiceLevel());
  readLevels();
  const loudness = levels.reduce((a, b) => a + b, 0) / levels.length;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  if (currentTheme === "sunset") drawSunset(t, w, h, loudness);
  else if (currentTheme === "aurora") drawAurora(t, w, h, loudness);
  else if (currentTheme === "cosmic") drawCosmic(t, w, h, loudness);
  else if (currentTheme === "zen") drawZen(t, w, h, loudness);
  else if (currentTheme === "hearth") drawHearth(t, w, h, loudness);
  else drawSunset(t, w, h, loudness);

  if (captionsOnCanvas()) drawCaptions(w, h);
}

// ----------------- Visualizer 1: Sunset Waves -----------------
function drawSunset(t, w, h, loudness) {
  const horizon = h * 0.72;
  const cx = w / 2;
  const sunY = horizon - h * 0.08;
  const sunR = Math.min(w, h) * (0.16 + loudness * 0.12);

  // Radiant warm sun
  const sun = ctx.createRadialGradient(cx, sunY, sunR * 0.1, cx, sunY, sunR);
  sun.addColorStop(0, "#ffffff");
  sun.addColorStop(0.3, "#ffe082");
  sun.addColorStop(0.7, "#ff9800");
  sun.addColorStop(1, "rgba(230, 81, 0, 0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Floating buoyant embers
  embers.forEach((e) => {
    e.y += (0.0007 + loudness * 0.005) * e.speed;
    if (e.y > 1) {
      e.y = 0;
      e.x = Math.random();
    }
    const x = e.x * w + Math.sin(t + e.sway) * 16;
    const y = horizon - e.y * h * 0.55;
    ctx.fillStyle = `rgba(255, 213, 79, ${(1 - e.y) * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, e.r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Layered rolling waves
  sunsetHills.forEach((hill, i) => {
    const base = horizon + i * h * 0.055;
    const amp = h * (0.02 + 0.008 * Math.sin(t * 1.3 + i)) + levels[hill.band] * h * 0.18;
    const phase = t * hill.speed + hill.phase;

    const crest = [];
    for (let x = 0; x <= w + 6; x += 6) {
      const u = (x / w) * 2 - 1;
      const env = 0.45 + 0.55 * Math.exp(-u * u * 2.8);
      const wave = 0.65 * Math.sin(u * hill.freq + phase) + 0.35 * Math.sin(u * hill.freq * 2.2 - phase * 0.7);
      crest.push([x, base - amp * env * wave]);
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    crest.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(w, h);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, base - amp, 0, h);
    fill.addColorStop(0, `rgba(${hill.rgb}, 0.95)`);
    fill.addColorStop(0.6, "rgba(35, 18, 12, 0.98)");
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    crest.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = "rgba(255, 248, 225, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

// ----------------- Visualizer 2: Aurora Ribbons -----------------
function drawAurora(t, w, h) {
  const dt = Math.min(0.05, Math.max(0, t - auroraLast));
  auroraLast = t;
  readVoiceLevels();

  const energy = voiceLevels.reduce((a, b) => a + b, 0) / voiceLevels.length;
  if (energy > auroraEnergy + 0.06) auroraPulse = Math.min(1, auroraPulse + (energy - auroraEnergy) * 1.6);
  auroraPulse *= 0.93;
  auroraEnergy = energy;

  const thinking = state === "thinking";
  const muted = voiceMode.classList.contains("muted");
  // Calm drift when quiet, livelier while someone talks
  auroraFlow += dt * (0.55 + energy * 1.3 + (thinking ? 0.6 : 0));

  const cy = h / 2;
  // On screen it looks as before; a 1080p video frame gets proportionally
  // bigger waves and lines, and tall pictures (phones, 9:16) taller waves
  const scale = Math.max(1, Math.min(w, h) / 800);
  const maxAmp = Math.min(h * 0.28, w * (h > w ? 0.34 : 0.22), 220 * scale);

  // Warm glow behind the ribbons: breathing slowly, brighter with the voice
  const glow = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.6);
  glow.addColorStop(0, `rgba(255, 146, 110, ${0.15 + 0.04 * Math.sin(t * 1.1) + energy * 0.22 + auroraPulse * 0.12})`);
  glow.addColorStop(0.55, `rgba(200, 90, 160, ${0.06 + energy * 0.1})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const step = Math.max(4, w / 240);
  const spread = 2.4 - Math.min(1, energy) * 1.1; // the waves widen when it's loud

  auroraLayers.forEach((layer, i) => {
    // Breathe when quiet, ripple while thinking, follow the voice otherwise
    const breath = 0.17 + 0.07 * Math.sin(t * 1.1 + i * 1.4);
    const ripple = thinking ? 0.16 * (0.5 + 0.5 * Math.sin(t * 3.2 - i * 0.9)) : 0;
    const level = Math.min(1.15, Math.max(voiceLevels[layer.band], breath + ripple) + auroraPulse * 0.3);
    const amp = maxAmp * level;
    const phase = auroraFlow * layer.speed + layer.phase;

    ctx.beginPath();
    for (let x = -step; x <= w + step; x += step) {
      const u = (x / w) * 2 - 1;
      const env = Math.exp(-u * u * spread);
      const wave = Math.sin(u * layer.freq + phase) * 0.7 + Math.sin(u * layer.freq * 1.8 - phase * 0.6) * 0.3;
      const y = cy + wave * amp * env + (i - 1.5) * 22 * scale;
      if (x === -step) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Fading out at the screen edges instead of being cut off
    const alpha = (0.65 + level * 0.35) * (muted ? 0.5 : 1);
    const color = ctx.createLinearGradient(0, 0, w, 0);
    color.addColorStop(0, `rgba(${layer.rgb}, 0)`);
    color.addColorStop(0.15, `rgba(${layer.rgb}, ${alpha})`);
    color.addColorStop(0.85, `rgba(${layer.rgb}, ${alpha})`);
    color.addColorStop(1, `rgba(${layer.rgb}, 0)`);
    ctx.strokeStyle = color;
    ctx.lineWidth = (3 + level * 4.5) * scale;
    ctx.shadowColor = `rgba(${layer.rgb}, 0.9)`;
    ctx.shadowBlur = (18 + level * 26 + auroraPulse * 14) * scale;
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
}

// ----------------- Visualizer 3: Cosmic Pulse -----------------
function drawCosmic(t, w, h, loudness) {
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.18;
  const pulseR = baseR * (1 + loudness * 0.45);

  // Background stellar nebula
  const nebula = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, baseR * 3);
  nebula.addColorStop(0, `rgba(124, 77, 255, ${0.2 + loudness * 0.3})`);
  nebula.addColorStop(0.5, `rgba(33, 150, 243, ${0.1 + loudness * 0.2})`);
  nebula.addColorStop(1, "transparent");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);

  // Orbiting star particles
  cosmicStars.forEach((star) => {
    star.angle += (star.speed * 0.015) * (1 + loudness * 1.5);
    const r = star.dist * (1 + levels[1] * 0.25);
    const x = cx + Math.cos(star.angle) * r;
    const y = cy + Math.sin(star.angle) * (r * 0.55);
    ctx.fillStyle = `${star.color}${0.4 + loudness * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, star.size * (1 + loudness * 0.8), 0, Math.PI * 2);
    ctx.fill();
  });

  // Concentric harmonic rings
  for (let ring = 1; ring <= 3; ring++) {
    const ringR = pulseR * (0.8 + ring * 0.35);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(179, 136, 255, ${Math.max(0.1, 0.4 - ring * 0.1 + levels[ring] * 0.4)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Central glowing energy core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.3, "rgba(224, 64, 251, 0.9)");
  core.addColorStop(0.7, "rgba(101, 31, 255, 0.6)");
  core.addColorStop(1, "rgba(33, 150, 243, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fill();
}

// ----------------- Visualizer 4: Zen Ripples -----------------
function drawZen(t, w, h, loudness) {
  const cx = w / 2;
  const cy = h / 2;

  // Generate ripple on vocal inflection
  if (loudness > 0.06 && performance.now() - lastRippleTime > 180) {
    zenRipples.push({
      r: 10,
      maxR: Math.min(w, h) * (0.35 + loudness * 0.45),
      alpha: 0.85,
      speed: 2.2 + loudness * 4,
    });
    lastRippleTime = performance.now();
  }

  // Dark reflective water background
  const water = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  water.addColorStop(0, "#082630");
  water.addColorStop(1, "#030e12");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);

  // Update and draw ripples
  for (let i = zenRipples.length - 1; i >= 0; i--) {
    const rip = zenRipples[i];
    rip.r += rip.speed;
    rip.alpha *= 0.97;

    ctx.beginPath();
    ctx.arc(cx, cy, rip.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(100, 255, 218, ${rip.alpha})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (rip.r >= rip.maxR || rip.alpha < 0.02) {
      zenRipples.splice(i, 1);
    }
  }

  // Calm central water stone / lotus reflection
  const centerPulse = 18 + loudness * 22;
  const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerPulse);
  centerGrad.addColorStop(0, "#ffffff");
  centerGrad.addColorStop(0.5, "rgba(100, 255, 218, 0.7)");
  centerGrad.addColorStop(1, "rgba(2, 119, 189, 0)");
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, centerPulse, 0, Math.PI * 2);
  ctx.fill();
}

// ----------------- Visualizer 5: Firefly Hearth -----------------
function drawHearth(t, w, h, loudness) {
  const cx = w / 2;
  const cy = h * 0.65;
  const hearthR = Math.min(w, h) * (0.2 + loudness * 0.18);

  // Warm campfire hearth glow
  const hearth = ctx.createRadialGradient(cx, cy, hearthR * 0.1, cx, cy, hearthR * 2);
  hearth.addColorStop(0, `rgba(255, 171, 64, ${0.4 + loudness * 0.5})`);
  hearth.addColorStop(0.4, `rgba(255, 87, 34, ${0.2 + loudness * 0.3})`);
  hearth.addColorStop(1, "transparent");
  ctx.fillStyle = hearth;
  ctx.fillRect(0, 0, w, h);

  // Dancing fireflies
  fireflies.forEach((f) => {
    // Gravitate toward center when loud, drift freely when calm
    const dx = cx - f.x * w;
    const dy = cy - f.y * h;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (loudness > 0.08) {
      f.vx += (dx / dist) * 0.00015;
      f.vy += (dy / dist) * 0.00015;
    }
    f.x += f.vx;
    f.y += f.vy;

    // Boundaries
    if (f.x < 0.05 || f.x > 0.95) f.vx *= -1;
    if (f.y < 0.1 || f.y > 0.9) f.vy *= -1;

    f.alpha = 0.3 + 0.7 * Math.sin(t * f.glowSpeed + f.x * 10);
    const fx = f.x * w;
    const fy = f.y * h;
    const fRadius = f.size * (1 + loudness * 0.8);

    // A faint larger circle as the glow: shadowBlur on every firefly is slow
    const a = Math.max(0.1, f.alpha);
    ctx.fillStyle = `rgba(255, 215, 64, ${a * 0.18})`;
    ctx.beginPath();
    ctx.arc(fx, fy, fRadius * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 238, 88, ${a})`;
    ctx.beginPath();
    ctx.arc(fx, fy, fRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}
