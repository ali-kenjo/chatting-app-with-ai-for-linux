// ---------- Composer extras: model picker and attachments ----------
import { api } from "./api.js";
import { openSettings } from "./settings.js";
import { getSettings, onSettings, updateSettings } from "./store.js";

// ----- Model picker -----
// Besides one brain of your choice, a mode can pick the AI per message (see server/router.js)
const picker = document.getElementById("model-picker");
const menu = document.getElementById("model-menu");
const CHECK = '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>';

const MODES = [
  { id: "auto", icon: "✨", label: "Auto", desc: "Local by default; the cloud for what a message needs" },
  { id: "dynamic", icon: "🔄", label: "Dynamic", desc: "Auto, and it reacts to how the AIs are doing" },
  { id: "fastest", icon: "⚡", label: "Fastest", desc: "Asks both; the first answer wins" },
  { id: "local", icon: "🔒", label: "Local only", desc: "Only an AI on this computer", needs: "local" },
  { id: "cloud", icon: "☁️", label: "Cloud only", desc: "Only Gemini", needs: "cloud" },
];

let brains = [];
let defaultBrainId = null;
let chosenId = null;
try {
  chosenId = Number(localStorage.getItem("friends.brain")) || null;
} catch {}

const isLocal = (b) => b.provider === "local";
const enabledOf = (kind) => brains.filter((b) => b.enabled && (kind === "local" ? isLocal(b) : !isLocal(b)));
const isPrivate = () => getSettings()?.privacy?.localOnly === true;
// "fixed" (the brain you pick below), "auto", "dynamic", "fastest", "local" or "cloud"
export const getMode = () => (isPrivate() ? "local" : getSettings()?.routing?.mode || "fixed");

// The brain that answers: your pick from the menu, else the default one
export function getSelectedBrainId() {
  const chosen = brains.find((b) => b.id === chosenId && b.enabled);
  return chosen ? chosen.id : defaultBrainId;
}

// The brain that answers in "fixed" mode (its provider tells voice mode whether Gemini Live is possible)
export function getSelectedBrain() {
  return brains.find((b) => b.id === getSelectedBrainId()) || null;
}

// Gemini Live (Google's real-time voice) only where the cloud answers; otherwise Studio voice
export function liveWanted() {
  const mode = getMode();
  if (isPrivate()) return false;
  const hasCloud = enabledOf("cloud").length > 0;
  if (mode === "fixed") return getSelectedBrain() ? !isLocal(getSelectedBrain()) : true;
  if (mode === "cloud") return hasCloud;
  if (mode === "local") return false;
  // auto, dynamic, fastest: spoken answers stay local for speed when there's a local AI (a setting)
  const voiceLocal = getSettings()?.routing?.auto?.voiceLocal !== false;
  return hasCloud && !(voiceLocal && enabledOf("local").length > 0);
}

// The local brain that would answer now (for warming it up)
export function getLocalBrainId() {
  const selected = getSelectedBrain();
  if (getMode() === "fixed") return selected && isLocal(selected) ? selected.id : null;
  const local = enabledOf("local");
  return (local.find((b) => b.id === defaultBrainId) || local[0])?.id || null;
}

// A local model takes a while to load into memory; load it as soon as it's the one
// that answers, so the first reply isn't slow (once per brain and page visit)
const warmed = new Set();
function warmUp() {
  const id = getLocalBrainId();
  if (!id || getMode() === "cloud" || warmed.has(id)) return;
  warmed.add(id);
  api.local.warm(id);
}

function renderPicker() {
  const mode = getMode();
  const info = MODES.find((m) => m.id === mode);
  if (info) {
    picker.querySelector("strong").textContent = `${info.icon} ${info.label}`;
    picker.querySelector("span").textContent = isPrivate() ? "Private mode" : "";
  } else {
    const brain = brains.find((b) => b.id === getSelectedBrainId());
    picker.querySelector("strong").textContent = brain ? brain.name : "Model";
    picker.querySelector("span").textContent = brain ? brain.model : "";
  }
  // "Answer again with the other AI" only makes sense with both kinds, outside Private mode
  document.documentElement.dataset.bothKinds = String(enabledOf("local").length > 0 && enabledOf("cloud").length > 0 && !isPrivate());
}

function menuHeading(text) {
  const heading = document.createElement("div");
  heading.className = "model-menu-heading";
  heading.textContent = text;
  menu.append(heading);
}

function renderMenu() {
  menu.innerHTML = "";
  const enabled = brains.filter((b) => b.enabled);
  const mode = getMode();
  const hasLocal = enabledOf("local").length > 0;
  const hasCloud = enabledOf("cloud").length > 0 && !isPrivate();

  if (enabled.length) {
    menuHeading("Mode");
    for (const m of MODES) {
      const missing = m.needs === "local" ? !hasLocal : m.needs === "cloud" ? !hasCloud : !hasLocal && !hasCloud;
      const blocked = isPrivate() && m.id !== "local";
      const item = document.createElement("button");
      item.type = "button";
      item.className = "model-item model-mode";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", m.id === mode);
      item.dataset.mode = m.id;
      item.disabled = missing || blocked;
      item.innerHTML = `<span class="model-item-text"><strong></strong><span></span></span>${m.id === mode ? CHECK : ""}`;
      item.querySelector("strong").textContent = `${m.icon} ${m.label}`;
      item.querySelector(".model-item-text span").textContent = blocked ? "Off in Private mode" : missing ? (m.needs === "cloud" ? "Add a Gemini brain first" : m.needs === "local" ? "Add a local AI first" : "Add an AI first") : m.desc;
      menu.append(item);
    }
    menuHeading("One AI");
  }
  if (!enabled.length) {
    const empty = document.createElement("div");
    empty.className = "model-menu-empty";
    empty.textContent = "No AI brains yet.";
    menu.append(empty);
  }
  for (const b of enabled) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "model-item";
    item.setAttribute("role", "menuitemradio");
    const on = mode === "fixed" && b.id === getSelectedBrainId();
    item.setAttribute("aria-checked", on);
    item.dataset.id = b.id;
    item.innerHTML = `<span class="model-item-text"><strong></strong><span></span></span>${on ? CHECK : ""}`;
    item.querySelector("strong").textContent = `${isLocal(b) ? "🔒" : "☁️"} ${b.name}`;
    item.querySelector(".model-item-text span").textContent = b.model;
    item.disabled = isPrivate() && !isLocal(b);
    menu.append(item);
  }
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "model-item manage";
  manage.dataset.manage = "";
  manage.textContent = enabled.length ? "Manage AI brains and routing…" : "Add an AI brain…";
  menu.append(manage);
}

function setMenu(open) {
  menu.hidden = !open;
  picker.setAttribute("aria-expanded", open);
  if (open) renderMenu();
}

picker.addEventListener("click", () => setMenu(menu.hidden));

menu.addEventListener("click", (e) => {
  const item = e.target.closest(".model-item");
  if (!item) return;
  setMenu(false);
  if (item.hasAttribute("data-manage")) return openSettings("ai-control");
  if (item.dataset.mode) {
    updateSettings((s) => {
      s.routing.mode = item.dataset.mode;
    });
    return;
  }
  chosenId = Number(item.dataset.id);
  try {
    localStorage.setItem("friends.brain", chosenId);
  } catch {}
  // Picking one AI means that AI
  updateSettings((s) => {
    s.routing.mode = "fixed";
  });
});

document.addEventListener("click", (e) => {
  if (!menu.hidden && !e.target.closest(".model-menu-wrap")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMenu(false);
});

document.addEventListener("friends:brains-changed", (e) => {
  ({ brains, defaultBrainId } = e.detail);
  renderPicker();
  warmUp();
});

// The mode changed (here, or in Settings → AI control)
onSettings(() => {
  renderPicker();
  warmUp();
});

// ----- Attachments -----
const tray = document.getElementById("attachments");
const fileInput = document.getElementById("attach-input");
const REMOVE = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

let items = []; // { key, file, status: "uploading" | "ready" | "error", meta, error, preview }
let nextKey = 1;

function size(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function changed() {
  renderTray();
  document.dispatchEvent(new CustomEvent("friends:attachments-changed"));
}

function renderTray() {
  tray.hidden = !items.length;
  tray.innerHTML = "";
  for (const item of items) {
    const chip = document.createElement("div");
    chip.className = `attachment ${item.status}`;
    chip.dataset.key = item.key;
    chip.innerHTML = `
      ${item.preview ? '<img alt="">' : '<span class="attachment-icon"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg></span>'}
      <span class="attachment-text"><span class="attachment-name"></span><span class="attachment-meta"></span></span>
      <button type="button" class="icon-btn small" title="Remove">${REMOVE}</button>`;
    if (item.preview) chip.querySelector("img").src = item.preview;
    chip.querySelector(".attachment-name").textContent = item.file.name;
    chip.querySelector(".attachment-meta").textContent =
      item.status === "uploading" ? "Uploading…" : item.status === "error" ? item.error : size(item.file.size);
    tray.append(chip);
  }
}

async function addFiles(files) {
  for (const file of files) {
    const item = { key: nextKey++, file, status: "uploading", preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
    items.push(item);
    changed();
    try {
      item.meta = await api.attachments.upload(file);
      item.status = "ready";
    } catch (err) {
      item.status = "error";
      item.error = err.message;
    }
    changed();
  }
}

export function attachmentsBusy() {
  return items.some((i) => i.status === "uploading");
}

export function hasAttachments() {
  return items.some((i) => i.status === "ready");
}

// Hand the uploaded files to a message and empty the tray
export function takeAttachments() {
  const ready = items.filter((i) => i.status === "ready").map((i) => i.meta);
  items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
  items = [];
  changed();
  return ready;
}

document.getElementById("attach-btn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addFiles([...fileInput.files]);
  fileInput.value = "";
});

tray.addEventListener("click", (e) => {
  const chip = e.target.closest("button") && e.target.closest(".attachment");
  if (!chip) return;
  items = items.filter((i) => String(i.key) !== chip.dataset.key);
  changed();
});

// Paste or drop files too
document.getElementById("composer-input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});
const main = document.getElementById("main");
main.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
main.addEventListener("drop", (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});
