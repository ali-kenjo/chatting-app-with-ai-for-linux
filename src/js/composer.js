// ---------- Composer extras: model picker and attachments ----------
import { api } from "./api.js";
import { openSettings } from "./settings.js";
import { getSettings, onSettings, updateSettings } from "./store.js";
import { t, nf } from "./i18n.js";
import { announce } from "./a11y.js";

// ----- Model picker -----
// Besides one brain of your choice, a mode can pick the AI per message (see server/router.js)
const picker = document.getElementById("model-picker");
const menu = document.getElementById("model-menu");
const CHECK = '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>';

const MODES = [
  { id: "auto", icon: "✨", label: t("Auto"), desc: t("Local by default; the cloud for what a message needs") },
  { id: "dynamic", icon: "🔄", label: t("Dynamic"), desc: t("Auto, and it reacts to how the AIs are doing") },
  { id: "fastest", icon: "⚡", label: t("Fastest"), desc: t("Asks both; the first answer wins") },
  { id: "local", icon: "🔒", label: t("Local only"), desc: t("Only an AI on this computer"), needs: "local" },
  { id: "cloud", icon: "☁️", label: t("Cloud only"), desc: t("Only Gemini"), needs: "cloud" },
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

// A line for the start screen: who will answer a message, in plain words
function renderStatus() {
  const chip = document.getElementById("ws-status-indicator");
  const text = document.getElementById("status-text");
  const mode = getMode();
  const enabled = brains.filter((b) => b.enabled);
  let state = "ready";
  let line;
  if (!enabled.length) [state, line] = ["none", t("No AI set up yet")];
  else if (isPrivate()) line = t("Private mode: answers stay on this computer");
  else if (mode === "local") line = t("Answers come from this computer");
  else if (mode === "cloud") line = t("Answers come from Gemini (cloud)");
  else if (mode === "fixed") {
    const brain = getSelectedBrain();
    line = brain && isLocal(brain) ? t("Answers come from this computer") : t("Answers come from Gemini (cloud)");
  } else line = t("Local first, cloud when needed");
  chip.dataset.state = state;
  text.textContent = line;
}

function renderPicker() {
  renderStatus();
  const mode = getMode();
  const info = MODES.find((m) => m.id === mode);
  if (info) {
    picker.querySelector("strong").textContent = `${info.icon} ${info.label}`;
    picker.querySelector("span").textContent = isPrivate() ? t("Private mode") : "";
  } else {
    const brain = brains.find((b) => b.id === getSelectedBrainId());
    picker.querySelector("strong").textContent = brain ? brain.name : t("Choose an AI");
    picker.querySelector("span").textContent = brain ? brain.model : "";
  }
  picker.setAttribute("aria-label", `${t("Which AI answers")}: ${picker.textContent.replace(/\s+/g, " ").trim()}`);
  // "Answer again with the other AI" only makes sense with both kinds, outside Private mode
  document.documentElement.dataset.bothKinds = String(enabledOf("local").length > 0 && enabledOf("cloud").length > 0 && !isPrivate());
}

let group = null;
function menuHeading(text) {
  group = document.createElement("div");
  group.setAttribute("role", "group");
  const heading = document.createElement("div");
  heading.className = "model-menu-heading";
  heading.id = `model-menu-heading-${menu.children.length}`;
  heading.textContent = text;
  group.setAttribute("aria-labelledby", heading.id);
  group.append(heading);
  menu.append(group);
}

function renderMenu() {
  menu.innerHTML = "";
  group = menu;
  const enabled = brains.filter((b) => b.enabled);
  const mode = getMode();
  const hasLocal = enabledOf("local").length > 0;
  const hasCloud = enabledOf("cloud").length > 0 && !isPrivate();

  if (enabled.length) {
    menuHeading(t("Mode"));
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
      item.querySelector(".model-item-text span").textContent = blocked ? t("Off in Private mode") : missing ? (m.needs === "cloud" ? t("Add a Gemini AI first") : m.needs === "local" ? t("Add a local AI first") : t("Add an AI first")) : m.desc;
      group.append(item);
    }
    menuHeading(t("One AI"));
  }
  if (!enabled.length) {
    const empty = document.createElement("div");
    empty.className = "model-menu-empty";
    empty.textContent = t("No AI is set up yet.");
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
    group.append(item);
  }
  group = null;
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "model-item manage";
  manage.setAttribute("role", "menuitem");
  manage.dataset.manage = "";
  manage.textContent = enabled.length ? t("Manage your AIs and routing…") : t("Set up an AI…");
  menu.append(manage);
}

const menuItems = () => [...menu.querySelectorAll(".model-item:not(:disabled)")];

function setMenu(open, { focusPicker = false } = {}) {
  menu.hidden = !open;
  picker.setAttribute("aria-expanded", open);
  if (open) {
    renderMenu();
    // The keyboard lands on the chosen entry
    (menu.querySelector('[aria-checked="true"]:not(:disabled)') || menuItems()[0])?.focus();
  } else if (focusPicker) picker.focus();
}

// Arrows move through the entries, Esc closes and gives the focus back, Tab leaves
menu.addEventListener("keydown", (e) => {
  const items = menuItems();
  const at = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    items[e.key === "Home" ? 0 : items.length - 1]?.focus();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    setMenu(false, { focusPicker: true });
  } else if (e.key === "Tab") setMenu(false);
});
picker.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" && menu.hidden) {
    e.preventDefault();
    setMenu(true);
  }
});

picker.addEventListener("click", () => setMenu(menu.hidden));

menu.addEventListener("click", (e) => {
  const item = e.target.closest(".model-item");
  if (!item) return;
  setMenu(false, { focusPicker: true });
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
  if (e.key === "Escape" && !menu.hidden) setMenu(false, { focusPicker: true });
});

document.addEventListener("friends:brains-changed", (e) => {
  ({ brains, defaultBrainId } = e.detail);
  renderPicker();
  warmUp();
});

// The mode changed (here, or in Settings → AI & privacy)
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
  return bytes < 1024 * 1024 ? `${nf(Math.max(1, Math.round(bytes / 1024)))} KB` : `${nf(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
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
      <button type="button" class="icon-btn small">${REMOVE}</button>`;
    const remove = chip.querySelector("button");
    remove.title = t("Remove {name}", { name: item.file.name });
    remove.setAttribute("aria-label", remove.title);
    if (item.preview) chip.querySelector("img").src = item.preview;
    chip.querySelector(".attachment-name").textContent = item.file.name;
    chip.querySelector(".attachment-meta").textContent =
      item.status === "uploading" ? t("Uploading…") : item.status === "error" ? item.error : size(item.file.size);
    chip.setAttribute("role", item.status === "error" ? "alert" : "group");
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
  announce(t("Attachment removed"));
  document.getElementById("composer-input").focus();
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
const composerBox = document.getElementById("composer");
const dropNote = document.createElement("div");
dropNote.className = "drop-note";
dropNote.setAttribute("aria-hidden", "true");
dropNote.textContent = t("Drop files to attach them");
main.append(dropNote);

// Dragging files over the page: the message box lights up and says what happens on drop
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
const showDrop = (on) => {
  main.classList.toggle("dropping", on);
  composerBox.classList.toggle("drop-active", on);
};
main.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  showDrop(true);
});
main.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) showDrop(false);
});
main.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
main.addEventListener("drop", (e) => {
  dragDepth = 0;
  showDrop(false);
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});
