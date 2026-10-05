// The picture: the canvas, the chosen visualizer style, and the robot.
//
// Each frame it reads how loud the AI is (levels.js) and hands that to the
// visualizer (visualizers/). In the Robot style the robot draws itself and
// this module only feeds it both voices; in a video frame the robot's picture
// is copied onto the canvas, with the captions.
import { robot } from "../robot/index.js";
import { t } from "../i18n.js";
import { captions } from "./captions.js";
import { BACKGROUND, canvas, isMuted, store, voiceMode, voiceMute } from "./dom.js";
import { levels, voiceLevels, readLevels, readVoiceLevels, userVoiceLevel } from "./levels.js";
import { status } from "./status.js";
import { visualizer } from "./visualizers/index.js";

const ctx = canvas.getContext("2d");
export const FRAMES = { "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 } };

// Wired by the session: what the stage needs to know about the rest of voice mode
//   earClosed(): its voice (or the echo of it) may still be in the mic
//   recording(): a video is being recorded
//   captionsOnCanvas(): captions go into the picture
//   onSync(on): the robot appeared or went away (the screen's buttons follow)
//   onRobotChange(on): tell the AI whether it has its robot body
export const hooks = {
  earClosed: () => false,
  recording: () => false,
  captionsOnCanvas: () => false,
  onSync() {},
  onRobotChange() {},
};

// Active style: "sunset" | "aurora" | "cosmic" | "zen" | "hearth" | "robot"
let theme = store.get("friends.voiceTheme") || "sunset";
let activeFrame = null; // the video format shown while choosing or recording
let view = { w: 0, h: 0 }; // drawing size: the screen (CSS pixels) or the video format
let rafId = null;

export const currentTheme = () => theme;
const robotStyle = () => theme === "robot";
export const isRobotStyle = robotStyle;
// The robot is (or is about to be) on screen, so the AI may be offered its tools
export const robotOnScreen = () => robotStyle() && !robot.unavailable && !voiceMode.hidden;

robot.host("voice", document.getElementById("voice-robot"), { priority: 3, onFrame: compositeRobot, roomBelow: true, interactive: true, roam: true, world: true });

// ---------- The style ----------
function updateThemeButtons() {
  voiceMode.dataset.style = theme;
  document.querySelectorAll(".voice-theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
    btn.setAttribute("aria-pressed", String(btn.dataset.theme === theme));
  });
}

function noteRobotMissing() {
  status.note(t("The 3D robot can't be shown: {reason} Showing Sunset instead.", { reason: t(robot.unavailable) }), 5000);
}

// The style you picked is remembered even when it can't be shown right now
// (the Robot without WebGL): Sunset stands in, and voice mode says why.
export function setVoiceTheme(next, { save = true } = {}) {
  if (save) store.set("friends.voiceTheme", next);
  if (next === "robot" && robot.unavailable) {
    next = "sunset";
    if (!voiceMode.hidden) noteRobotMissing();
  }
  theme = next;
  updateThemeButtons();
  syncRobot();
}

// Shown while voice mode is open in the Robot style
export function syncRobot() {
  const on = robotStyle() && !voiceMode.hidden;
  voiceMode.classList.toggle("robot-style", robotStyle());
  robot.show("voice", on);
  hooks.onSync(on);
  resizeCanvas();
  hooks.onRobotChange(robotOnScreen());
}

document.addEventListener("friends:robot-unavailable", () => {
  if (robotStyle()) setVoiceTheme("robot", { save: false });
});

// ---------- Size ----------
export function setFrame(frame) {
  activeFrame = frame;
  resizeCanvas();
}

export const frameShown = () => activeFrame;

export function resizeCanvas() {
  const frame = FRAMES[activeFrame];
  voiceMode.classList.toggle("framed", Boolean(frame) || hooks.recording());
  if (frame) {
    canvas.width = frame.w;
    canvas.height = frame.h;
    view = { w: frame.w, h: frame.h };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    syncRobotSize();
    return;
  }
  if (hooks.recording()) return syncRobotSize(); // a recording keeps its size; the screen just letterboxes it
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
window.addEventListener("resize", resizeCanvas);

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
  if (hooks.captionsOnCanvas()) captions.draw(ctx, w, h);
}

// ---------- Drawing ----------
// The mic button shows how loud you are: a ring that swells with your voice
let micRing = 0;
function setMicRing(level) {
  const next = micRing + (level - micRing) * 0.35;
  if (Math.abs(next - micRing) < 0.015 && !(next === 0 && micRing !== 0)) return;
  micRing = next < 0.01 ? 0 : next;
  voiceMute.style.setProperty("--mic", micRing.toFixed(2));
}

const yourVoice = () => userVoiceLevel({ state: status.state, muted: isMuted(), earClosed: hooks.earClosed() });

// The robot hears the same bands the Aurora does, and yours
function feedRobot() {
  readVoiceLevels(status.state);
  robot.director.aiAudio(voiceLevels);
  const mine = yourVoice();
  robot.director.userAudio(mine);
  setMicRing(mine);
}

function draw(now) {
  rafId = requestAnimationFrame(draw);
  // The robot draws itself; compositeRobot() fills this canvas when it's framed
  if (robotStyle()) return feedRobot();
  const { w, h } = view;
  if (!w || !h) return;

  setMicRing(yourVoice());
  readLevels(status.state);
  const loudness = levels.reduce((a, b) => a + b, 0) / levels.length;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  const style = visualizer(theme);
  if (style.voiceBands) readVoiceLevels(status.state);
  style.draw(ctx, now / 1000, w, h, { levels, loudness, voiceLevels, state: status.state, muted: isMuted() });

  if (hooks.captionsOnCanvas()) captions.draw(ctx, w, h);
}

export const stage = {
  start() {
    updateThemeButtons();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(draw);
  },
  stop() {
    cancelAnimationFrame(rafId);
  },
  noteRobotMissing,
  updateThemeButtons,
  get theme() {
    return theme;
  },
};
