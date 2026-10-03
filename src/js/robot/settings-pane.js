// ---------- Settings → Robot ----------
// The live preview (drawn by the shared engine only while this tab shows),
// the choice buttons, and uploading your own model.
import { robot } from "./index.js";
import { getSettings, onSettings, updateSettings } from "../store.js";

const preview = document.getElementById("robot-preview");
const note = document.getElementById("robot-preview-note");
const tryMood = document.getElementById("robot-try-mood");
const tryGesture = document.getElementById("robot-try-gesture");
const qualityStatus = document.getElementById("robot-quality-status");
const bgHint = document.getElementById("robot-bg-hint");
const modelStatus = document.getElementById("robot-model-status");
const uploadButton = document.getElementById("robot-model-upload");
const resetButton = document.getElementById("robot-model-reset");
const fileInput = document.getElementById("robot-model-file");

const MAX_MODEL = 30 * 1024 * 1024;
const LEVELS = { low: "Low", medium: "Medium", high: "High" };

// ---------- The preview ----------
robot.host("preview", preview, { priority: 2 });

document.addEventListener("friends:settings", (e) => {
  const showing = e.detail.open && e.detail.tab === "robot";
  robot.show("preview", showing && !robot.unavailable);
  if (showing && robot.unavailable) showUnavailable(robot.unavailable);
});

function showUnavailable(reason) {
  note.textContent = `The 3D robot can't be shown here: ${reason} Voice mode uses the Sunset style instead.`;
  note.hidden = false;
  preview.classList.add("unavailable");
}

document.addEventListener("friends:robot-unavailable", (e) => showUnavailable(e.detail.reason));

tryMood.addEventListener("change", () => {
  if (tryMood.value) robot.director.toolEvent({ mood: tryMood.value });
});
tryGesture.addEventListener("change", () => {
  if (tryGesture.value) robot.director.toolEvent({ gesture: tryGesture.value });
  tryGesture.value = "";
});

// ---------- Choice buttons: data-choice="robot.shot" with data-value on each ----------
const read = (path) => path.split(".").reduce((o, k) => o?.[k], getSettings());

function syncChoices() {
  document.querySelectorAll("[data-choice]").forEach((group) => {
    const value = read(group.dataset.choice);
    group.querySelectorAll("[data-value]").forEach((b) => {
      const on = b.dataset.value === String(value);
      b.classList.toggle("selected", on);
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  });
}

function choose(group, button) {
  const keys = group.dataset.choice.split(".");
  const last = keys.pop();
  updateSettings((s) => (keys.reduce((o, k) => o[k], s)[last] = button.dataset.value));
}

document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-choice] [data-value]");
  if (button) choose(button.closest("[data-choice]"), button);
});

// Arrow keys move between the choices, like any radio group
document.addEventListener("keydown", (e) => {
  const button = e.target.closest?.("[data-choice] [data-value]");
  if (!button || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  const group = button.closest("[data-choice]");
  const all = [...group.querySelectorAll("[data-value]")];
  const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
  const next = all[(all.indexOf(button) + step + all.length) % all.length];
  choose(group, next);
  next.focus();
});

onSettings((s) => {
  syncChoices();
  // Keying out green takes a green accent with it
  const accent = s.theme.accent.toLowerCase();
  const hue = accentHue(accent);
  const clash = (s.robot.background === "green" && hue > 70 && hue < 170) || (s.robot.background === "blue" && hue > 190 && hue < 260);
  bgHint.textContent = clash
    ? "Your accent color is close to this key color, so keying it out would remove the robot's glow too. Pick another accent or the other chroma color."
    : "Chroma green and blue are flat, for keying out in a video editor";
  bgHint.classList.toggle("warn", clash);
});

function accentHue(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return -1;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

document.addEventListener("friends:robot-quality", (e) => {
  const { setting, level } = e.detail;
  qualityStatus.textContent = setting === "auto" ? `Auto is using ${LEVELS[level]} now (it steps down if it gets slow)` : `${LEVELS[level]}`;
});

// ---------- "Follow my face" ----------
const faceStatus = document.getElementById("robot-face-status");
const FACE_HINT = "Its eyes follow you through the webcam. Everything stays on this computer.";
const indicator = document.getElementById("face-indicator");
const indicatorText = document.getElementById("face-indicator-text");

document.addEventListener("friends:robot-face", (e) => {
  const { state, message } = e.detail;
  faceStatus.textContent = state === "off" ? FACE_HINT : message;
  faceStatus.classList.toggle("warn", ["blocked", "busy", "none", "error"].includes(state));
  // In voice mode: a clear sign while the camera is in use (or why it isn't)
  indicator.hidden = state === "off";
  indicator.classList.toggle("problem", ["blocked", "busy", "none", "error"].includes(state));
  indicator.classList.toggle("live", state === "on" || state === "looking");
  indicatorText.textContent = state === "on" ? "Following your face" : state === "looking" || state === "starting" ? "Camera on" : message;
  indicator.title = `${message || "Follow my face"} Click to switch it off.`;
  indicator.setAttribute("aria-label", `Follow my face: ${message || state}. Switch it off.`);
});

indicator.addEventListener("click", () => updateSettings((s) => (s.robot.followFace = false)));

// ---------- Your own model ----------
function showModel(info, extra = {}) {
  resetButton.hidden = !info?.custom;
  if (!info?.custom) {
    modelStatus.textContent = extra.error ? `Couldn't use that model: ${extra.error}` : "Built-in robot";
    return;
  }
  const size = `${(info.size / 1024 / 1024).toFixed(1)} MB`;
  const found = info.nodes?.length ? `Found: ${info.nodes.join(", ")}.` : "It has none of the named parts, so it won't move.";
  const missing = extra.missing?.length ? ` Missing (those parts stay still): ${extra.missing.join(", ")}.` : "";
  const uv = extra.faceWithoutUv ? " FaceScreen has no UV map, so the eyes can't be shown on it." : "";
  modelStatus.textContent = `${info.name} · ${size}. ${found}${missing}${uv}`;
}

document.addEventListener("friends:robot-model", (e) => showModel(e.detail.info, e.detail));

fetch("/api/robot/model/info")
  .then((res) => res.json())
  .then((info) => showModel(info))
  .catch(() => {});

uploadButton.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  if (file.size > MAX_MODEL) return (modelStatus.textContent = "That file is over 30 MB.");
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (String.fromCharCode(...head) !== "glTF") return (modelStatus.textContent = "That isn't a .glb file. In Blender, export as glTF Binary (.glb).");
  modelStatus.textContent = `Uploading ${file.name}…`;
  uploadButton.disabled = true;
  try {
    const res = await fetch("/api/robot/model", {
      method: "PUT",
      headers: { "Content-Type": "model/gltf-binary", "X-File-Name": encodeURIComponent(file.name) },
      body: file,
    });
    const info = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(info.error || "Upload failed.");
    showModel(info);
    await robot.useModel(info);
  } catch (err) {
    modelStatus.textContent = err.message;
  } finally {
    uploadButton.disabled = false;
  }
});

resetButton.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/robot/model", { method: "DELETE" });
    const info = await res.json();
    showModel(info);
    await robot.useModel(info);
  } catch (err) {
    modelStatus.textContent = err.message;
  }
});
