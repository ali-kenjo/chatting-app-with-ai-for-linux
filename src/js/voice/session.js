// A voice conversation: opening and closing the screen, choosing and switching
// the engine, the microphone, mute, and filming mode. It owns the one running
// engine and wires the other modules together:
//
//   audio.js      the microphone and the AI's audio bus
//   engines/      who talks: live-engine.js (Gemini Live) or classic-engine.js (Studio / Instant)
//   status.js     what it's doing now ("listening", "speaking", …)
//   captions.js   what's being said, on screen and in videos
//   stage.js      the picture: a visualizer (visualizers/) or the 3D robot
//   recording.js  recording a video; controls.js the buttons and pop-ups
//
// Three ways to talk ("engines"), picked with the pill at the top:
// - Live: Gemini Live hears you directly and answers in real time
// - Studio: your words are transcribed, Gemini writes a reply, and a Gemini
//   voice reads it, a piece at a time
// - Instant: the same, but read by the browser's own (robotic) voice
// Live falls back to Studio by itself when it can't be used.
import { api } from "../api.js";
import { getCurrentChatId, reloadChat, stopReply } from "../chat.js";
import { getSettings } from "../store.js";
import { voiceErrorText } from "../personality.js";
import { liveWanted, getLocalBrainId } from "../composer.js";
import { toggleDrawer, resetDrawer } from "../voice-drawer.js";
import { robot } from "../robot/index.js";
import { createFilming } from "../filming.js";
import { characterName } from "../characters.js";
import { t } from "../i18n.js";
import { onOnAir, resetOnAir, autoOnAir } from "../onair.js";
import { setVoiceHooks } from "../life.js";
import { audio } from "./audio.js";
import { captions } from "./captions.js";
import { initControls } from "./controls.js";
import { isMuted, store, voiceMode, voiceMute } from "./dom.js";
import { ClassicEngine } from "./engines/classic-engine.js";
import { LiveEngine } from "./engines/live-engine.js";
import { speech } from "./engines/speech.js";
import { recording } from "./recording.js";
import { spoken } from "./spoken.js";
import { hooks as stageHooks, stage, syncRobot, resizeCanvas, setVoiceTheme, isRobotStyle } from "./stage.js";
import { status } from "./status.js";

export { setVoiceTheme };

let opened = 0; // bumped each time voice mode opens
let heartbeatTimer = null;
let endTimer = null;
let engine = null; // the running engine (see engines/classic-engine.js for its interface)

// ---------- The engine pill ----------
const ENGINES = {
  live: { icon: "⚡", label: t("Live"), title: t("Live: it hears you directly and answers in real time, like a call (Gemini Live). You can cut in any time. Click for Studio voice.") },
  studio: { icon: "🎙️", label: t("Studio"), title: t("Studio: Gemini writes each reply, then says it in a natural Gemini voice. A bit slower to start. Click for Instant voice.") },
  instant: { icon: "💬", label: t("Instant"), title: t("Instant: your browser's own voice. Quickest to start, but robotic, and it can't be recorded. Click for Live.") },
};
const ORDER = ["live", "studio", "instant"];
let engineChoice = ORDER.includes(store.get("friends.voiceEngine")) ? store.get("friends.voiceEngine") : "live";

const enginePill = document.getElementById("voice-engine");
const engineIcon = document.getElementById("voice-engine-icon");
const engineLabel = document.getElementById("voice-engine-label");

// What's actually running (Live may have fallen back to Studio)
const runningEngine = () => engine?.name || engineChoice;

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

// ---------- Starting and switching engines ----------
function startClassic(tts) {
  engine = new ClassicEngine(tts);
  updateEnginePill();
  engine.start();
}

// greet: it speaks first (voice mode just opened, filming started, or another character took over)
async function startEngine({ greet = false } = {}) {
  stopEngine();
  const greetClassic = () => greet && getSettings()?.companion?.greeting !== false && engine?.ask("", { greet: true });
  if (engineChoice !== "live") {
    startClassic(engineChoice);
    return greetClassic();
  }
  // Gemini Live is Google's; a local AI speaks through Studio voice
  if (!liveWanted()) {
    const local = getLocalBrainId();
    if (local) api.local.warm(local, true); // the speech models too
    startClassic("studio");
    return greetClassic();
  }

  status.set("connecting");
  const live = new LiveEngine({ unavailable: (message) => engine === live && liveUnavailable(message) });
  engine = live;
  updateEnginePill();
  try {
    await live.start();
    if (engine !== live) return; // closed or switched meanwhile
    status.set("listening");
  } catch (err) {
    if (engine !== live) return;
    live.stop();
    engine = null;
    if (err.message === "NO_BRAIN") {
      updateEnginePill();
      return status.set("error", voiceErrorText("NO_BRAIN"));
    }
    liveUnavailable(err.message);
  }
}

function stopEngine() {
  engine?.stop();
  engine = null;
}

// Live didn't work out: carry on with Studio voice, and say why
function liveUnavailable(message) {
  stopEngine();
  if (voiceMode.hidden) return;
  status.note(t("{message} Using Studio voice instead.", { message }), 6000);
  startClassic("studio");
}

// Something you typed or the app wants said. (Studio/Instant start themselves
// when there's no engine, e.g. after an error, so typing always gets an answer.)
export function askInVoice(text, opts) {
  if (!engine && !voiceMode.hidden) startClassic(engineChoice === "instant" ? "instant" : "studio");
  return engine?.ask(text, opts);
}

const interrupt = () => engine?.interrupt();

// ---------- The microphone ----------
async function startMic() {
  const result = await audio.acquireMic(() => voiceMode.hidden);
  if (result.ok) {
    controls.hidePermBanner();
    return true;
  }
  if (result.cancelled) return false;
  status.set("standby", result.standby);
  if (!result.silent) controls.showPermBanner(result.retry, result.text);
  return false;
}

async function retryMic() {
  if (await startMic()) startEngine();
}

function toggleMute() {
  if (!audio.micStream) {
    retryMic();
    return;
  }
  const muted = voiceMode.classList.toggle("muted");
  audio.setMicEnabled(!muted);
  voiceMute.title = muted ? t("Unmute microphone") : t("Mute microphone");
  voiceMute.setAttribute("aria-pressed", String(muted));
  if (engine) engine.setMuted(muted);
  else status.set(status.state);
}

// ---------- Screen controls ----------
const controls = initControls({
  ask: (text) => askInVoice(text),
  retryMic,
  statusClicked() {
    if (status.state === "error" || status.state === "standby" || !audio.micStream) retryMic();
  },
  toggleMute,
  interrupt,
  isFilming: () => filming.on,
});

stageHooks.earClosed = () => Boolean(engine?.earClosed());
stageHooks.recording = () => recording.active;
stageHooks.captionsOnCanvas = () => recording.captionsOnCanvas;
stageHooks.onSync = (on) => controls.onRobotSync(on);
stageHooks.onRobotChange = (on) => engine?.setRobot(on);

// Instant voice plays outside the page, where it can't be recorded: Studio instead
recording.beforeStart(() => {
  if (!engine || engine.recordable) return;
  engine.useStudio();
  updateEnginePill();
  status.note(t("Instant voice can't be recorded, so Studio voice is on."), 4000);
});

onOnAir((on) => engine?.setOnAir(on));

// Another character takes over: a new voice and personality, so the
// conversation restarts (same chat) and they say hello
document.addEventListener("friends:character", () => {
  speech.resetVoice();
  if (voiceMode.hidden || filming.on) return;
  captions.clear();
  status.note(t("{name} is here.", { name: characterName() }), 2000);
  startEngine({ greet: true });
});

// A reminder went off while you're talking: the character says it
setVoiceHooks({
  isOpen: () => !voiceMode.hidden,
  speak(text) {
    if (engine) engine.say(text);
    else status.note(text, 6000);
  },
});

// The desktop app's window went to the tray: a conversation nobody can see ends,
// so the microphone isn't left open and Gemini isn't left listening
document.addEventListener("friends:window-hidden", () => closeVoice());

// ---------- Filming mode (filming.js) ----------
const filmingLook = () => {
  const f = getSettings()?.robot?.filming || {};
  return { cameraFriendly: f.cameraFriendly !== false, largerFace: Boolean(f.largerFace) };
};

const filming = createFilming({
  root: voiceMode,
  controls: {
    running: () => Boolean(engine),
    // Waiting for the countdown (or paused): no engine, a calm robot
    pause() {
      stopEngine();
      speech.stopPlayback();
      captions.clear();
      status.set("listening", "Filming mode");
    },
    resume() {
      if (voiceMode.hidden) return;
      robot.director.openVoice(); // it greets (and waves) again
      startEngine({ greet: true });
    },
    mute() {
      toggleMute();
      return isMuted();
    },
    interrupt() {
      if (status.state === "speaking") interrupt();
    },
    onEnter() {
      recording.closePop();
      controls.closeScenePop();
      toggleDrawer(false);
      controls.closeTyping();
      robot.setFilming(true, filmingLook());
      autoOnAir("filming", true);
    },
    onExit() {
      robot.setFilming(false);
      autoOnAir("filming", false);
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

// ---------- Opening and closing ----------
export const isVoiceOpen = () => !voiceMode.hidden;

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
  spoken.clear();
  voiceMode.classList.remove("muted");
  robot.director.openVoice();
  syncRobot();
  resizeCanvas();
  if (store.get("friends.voiceTheme") === "robot" && robot.unavailable) stage.noteRobotMissing();
  status.set("connecting");
  captions.reset();
  loadDrawer();
  stage.start();

  await audio.ensureOutput();
  await startMic();
  if (voiceMode.hidden || session !== opened) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!voiceMode.hidden) audio.resume();
  }, 400);
  startEngine({ greet: true });
}

export function closeVoice() {
  if (voiceMode.hidden) return;
  const session = opened;
  clearTimeout(endTimer);
  endTimer = null;
  filming.exit({ resume: false });
  voiceMode.hidden = true;
  resetOnAir();
  controls.closeActivities();
  robot.director.closeVoice();
  syncRobot();
  controls.closeScenePop();
  // A recording in progress is saved first, while its audio still runs
  const saving = recording.active ? recording.stop() : null;
  stopEngine();
  recording.closePop();
  toggleDrawer(false);
  stopReply();
  controls.hidePermBanner();
  captions.clear();
  Promise.resolve(saving).finally(() => {
    if (voiceMode.hidden && session === opened) stopAudio();
  });
  // Live saved each turn on the helper; show them in the chat
  reloadChat();
}

function stopAudio() {
  clearInterval(heartbeatTimer);
  stage.stop();
  stopEngine();
  speech.stopPlayback();
  audio.close();
}

// End: the robot waves goodbye first. The conversation stops at once; the
// screen closes within a second (at once on a second press, or without the robot).
function endVoice() {
  if (voiceMode.hidden) return;
  if (endTimer || !isRobotStyle() || !robot.engine?.running) return closeVoice();
  stopEngine();
  speech.stopPlayback();
  captions.clear();
  robot.director.voiceState("listening");
  const ms = Math.min(900, robot.director.goodbye());
  endTimer = setTimeout(closeVoice, ms);
}

document.getElementById("voice-end")?.addEventListener("click", endVoice);
for (const id of ["voice-open", "hero-voice-btn"]) {
  document.getElementById(id)?.addEventListener("click", (e) => {
    e.preventDefault();
    openVoice();
  });
}
