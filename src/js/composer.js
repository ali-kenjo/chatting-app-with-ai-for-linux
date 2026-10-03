// ---------- Composer extras: model picker and attachments ----------
import { api } from "./api.js";
import { openSettings } from "./settings.js";

// ----- Model picker -----
const picker = document.getElementById("model-picker");
const menu = document.getElementById("model-menu");
const CHECK = '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>';

let brains = [];
let defaultBrainId = null;
let chosenId = null;
try {
  chosenId = Number(localStorage.getItem("friends.brain")) || null;
} catch {}

// The brain that answers: your pick from the menu, else the default one
export function getSelectedBrainId() {
  const chosen = brains.find((b) => b.id === chosenId && b.enabled);
  return chosen ? chosen.id : defaultBrainId;
}

function renderPicker() {
  const brain = brains.find((b) => b.id === getSelectedBrainId());
  picker.querySelector("strong").textContent = brain ? brain.name : "Model";
  picker.querySelector("span").textContent = brain ? brain.model : "";
}

function renderMenu() {
  menu.innerHTML = "";
  const enabled = brains.filter((b) => b.enabled);
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
    item.setAttribute("aria-checked", b.id === getSelectedBrainId());
    item.dataset.id = b.id;
    item.innerHTML = `<span class="model-item-text"><strong></strong><span></span></span>${b.id === getSelectedBrainId() ? CHECK : ""}`;
    item.querySelector("strong").textContent = b.name;
    item.querySelector(".model-item-text span").textContent = b.model;
    menu.append(item);
  }
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "model-item manage";
  manage.dataset.manage = "";
  manage.textContent = enabled.length ? "Manage AI brains…" : "Add an AI brain…";
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
  chosenId = Number(item.dataset.id);
  try {
    localStorage.setItem("friends.brain", chosenId);
  } catch {}
  renderPicker();
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
