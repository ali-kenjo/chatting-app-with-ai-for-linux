// ---------- The Robot Studio ----------
// A big live preview and six tabs: Colors, Shape, Face, Outfit, Room, Looks. Everything you change
// goes straight into the settings (robot.design and robot.room), so voice mode, the chat dock and
// the preview all show it at once, and each character keeps its own look (characters.js).
import { robot } from "../index.js";
import { getSettings, onSettings, updateSettings } from "../../store.js";
import { t } from "../../i18n.js";
import { announce } from "../../a11y.js";
import { confirmDialog } from "../../dialogs.js";
import * as D from "../design.mjs";
import * as R from "../room.mjs";
import { lookFile, readLookFile } from "../looks.mjs";
import { colorsPanel, shapePanel, facePanel, outfitPanel, roomPanel, looksPanel } from "./panels.js";
import { h, button, slider, arrowKeys } from "./ui.js";

const modal = document.getElementById("robot-studio");
const stage = document.getElementById("rs-stage");
const note = document.getElementById("rs-stage-note");
const tabsEl = document.getElementById("rs-tabs");
const panelsEl = document.getElementById("rs-panels");
const undoBtn = document.getElementById("rs-undo");
const redoBtn = document.getElementById("rs-redo");

const clone = (v) => JSON.parse(JSON.stringify(v));
const robotSettings = () => getSettings()?.robot;

// ---------- Undo ----------
// A change within a second of the last one (a dragged slider) counts as one step
const history = { undo: [], redo: [], at: 0 };
const snapshot = () => ({ design: clone(robotSettings().design), room: clone(robotSettings().room) });

function remember() {
  const now = performance.now();
  if (now - history.at > 800) {
    history.undo.push(snapshot());
    if (history.undo.length > 80) history.undo.shift();
    history.redo.length = 0;
  }
  history.at = now;
  syncHistory();
}

function restore(from, to) {
  const step = from.pop();
  if (!step) return;
  to.push(snapshot());
  history.at = 0;
  updateSettings((s) => {
    s.robot.design = clone(step.design);
    s.robot.room = clone(step.room);
  });
  syncHistory();
}

function syncHistory() {
  undoBtn.disabled = history.undo.length === 0;
  redoBtn.disabled = history.redo.length === 0;
}

undoBtn.addEventListener("click", () => restore(history.undo, history.redo));
redoBtn.addEventListener("click", () => restore(history.redo, history.undo));

// ---------- Changing things ----------
// Each takes a function that edits the design or the room in place; both are cleaned by the same
// rules the helper uses before they're drawn, so a half-made change can never break the robot
const ctx = {
  design(fn) {
    remember();
    updateSettings((s) => {
      fn(s.robot.design);
      s.robot.design = D.sanitizeDesign(s.robot.design, s.robot.design);
    });
  },
  room(fn) {
    remember();
    updateSettings((s) => {
      fn(s.robot.room);
      s.robot.room = R.sanitizeRoom(s.robot.room);
    });
  },
  place(id) {
    remember();
    updateSettings((s) => (s.robot.room = R.changePlace(s.robot.room, id)));
  },
  randomRoom() {
    const place = pickOther(R.PLACES.filter((p) => !p.chroma && p.id !== "photo"), robotSettings().room.place);
    remember();
    updateSettings((s) => {
      s.robot.room = R.changePlace(s.robot.room, place.id);
      const lights = R.LIGHTS.filter((l) => l.id !== "auto");
      s.robot.room.air = pickOther(R.AIRS, s.robot.room.air).id;
      s.robot.room.light = lights[Math.floor(Math.random() * lights.length)].id;
    });
    announce(t("{name} is the new place", { name: t(place.label) }));
  },
  randomLook() {
    remember();
    updateSettings((s) => (s.robot.design = D.randomDesign(Math.floor(Math.random() * 2 ** 31))));
    announce(t("A new look"));
  },
  applyLook(look) {
    remember();
    updateSettings((s) => {
      s.robot.design = clone(look.design);
      s.robot.room = clone(look.room);
    });
    announce(t("{name} is on", { name: look.builtin ? t(look.label) : look.name }));
  },
  saveLook(name) {
    const cleaned = String(name || "").replace(/\s+/g, " ").trim().slice(0, 40) || t("My look");
    const s = robotSettings();
    if (s.looks.length >= 24) return announce(t("You can keep 24 looks. Delete one first."), { urgent: true });
    updateSettings((all) => all.robot.looks.push({ id: `look-${Date.now().toString(36)}`, name: cleaned, design: clone(all.robot.design), room: clone(all.robot.room) }));
    announce(t("Saved as {name}", { name: cleaned }));
  },
  async deleteLook(look) {
    const ok = await confirmDialog({ title: t("Delete this look?"), message: t("“{name}” will be removed. The robot keeps looking as it does now.", { name: look.name }), confirm: t("Delete"), danger: true });
    if (ok) updateSettings((all) => (all.robot.looks = all.robot.looks.filter((l) => l.id !== look.id)));
  },
  exportLook(name) {
    const s = robotSettings();
    const label = String(name || "").trim().slice(0, 40) || t("My look");
    const blob = new Blob([lookFile({ name: label, design: s.design, room: s.room })], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `${label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "robot-look"}.robot-look.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  importLook() {
    const input = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      if (file.size > 200_000) return announce(t("That file is too big to be a look."), { urgent: true });
      const look = readLookFile(await file.text());
      if (!look) return announce(t("That isn't a look from Friends."), { urgent: true });
      ctx.applyLook({ ...look, name: look.name || t("Imported look") });
      if (look.name) {
        const nameField = document.querySelector("#rs-panels .rs-save input");
        if (nameField) nameField.value = look.name;
      }
    });
    document.body.append(input);
    input.click();
  },
  refresh: () => refreshAll(),
  photoControls: () => photoControls(),
};

function pickOther(list, currentId) {
  const others = list.filter((x) => x.id !== currentId);
  return others[Math.floor(Math.random() * others.length)];
}

// ---------- Your own picture as the backdrop ----------
function photoControls() {
  const status = h("div", { class: "rs-note", "aria-live": "polite", text: t("No picture yet") });
  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const upload = button(t("Choose a picture…"), () => file.click(), { icon: "🖼️" });
  const remove = button(t("Remove it"), async () => {
    try {
      await fetch("/api/robot/background", { method: "DELETE" });
      await robot.useBackground(null);
      refresh(robotSettings().room);
    } catch (err) {
      status.textContent = err.message;
    }
  });
  remove.hidden = true;
  const blur = slider({ label: t("Blur"), min: R.RANGES.blur[0], max: R.RANGES.blur[1], step: 0.01, def: R.RANGES.blur[2], value: R.RANGES.blur[2], onChange: (v) => ctx.room((r) => (r.photo.blur = v)), format: (v) => `${Math.round(v * 100)}%` });
  const dim = slider({ label: t("Dim it"), min: R.RANGES.dim[0], max: R.RANGES.dim[1], step: 0.01, def: R.RANGES.dim[2], value: R.RANGES.dim[2], onChange: (v) => ctx.room((r) => (r.photo.dim = v)), format: (v) => `${Math.round(v * 100)}%` });
  file.addEventListener("change", async () => {
    const picked = file.files[0];
    file.value = "";
    if (!picked) return;
    if (picked.size > 12 * 1024 * 1024) return (status.textContent = t("That picture is over 12 MB."));
    status.textContent = t("Uploading {name}…", { name: picked.name });
    try {
      const res = await fetch("/api/robot/background", { method: "PUT", headers: { "Content-Type": picked.type || "image/png", "X-File-Name": encodeURIComponent(picked.name) }, body: picked });
      const info = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(info.error || t("Upload failed."));
      await robot.useBackground(info);
      refresh(robotSettings().room);
    } catch (err) {
      status.textContent = err.message;
    }
  });
  const el = h("div", { class: "rs-photo" }, status, h("div", { class: "rs-actions" }, upload, remove, file), blur.el, dim.el);
  function refresh(room) {
    const info = robot.backgroundInfo;
    remove.hidden = !info?.custom;
    status.textContent = info?.custom ? t("{name} is the backdrop.", { name: info.name }) : t("No picture yet");
    blur.set(room.photo.blur);
    dim.set(room.photo.dim);
  }
  document.addEventListener("friends:robot-background", () => refresh(robotSettings().room));
  return { el, refresh };
}

// ---------- The tabs ----------
const TABS = [
  { id: "colors", label: "Colors", icon: "🎨", build: colorsPanel },
  { id: "shape", label: "Shape", icon: "🧩", build: shapePanel },
  { id: "face", label: "Face", icon: "😊", build: facePanel },
  { id: "outfit", label: "Outfit", icon: "🎩", build: outfitPanel },
  { id: "room", label: "Room", icon: "🏠", build: roomPanel },
  { id: "looks", label: "Looks", icon: "✨", build: looksPanel },
];
const panels = new Map();
const tabButtons = new Map();
let current = "looks";

for (const tab of TABS) {
  const panel = tab.build(ctx);
  const wrap = h("div", { class: "rs-panel", role: "tabpanel", id: `rs-panel-${tab.id}`, "aria-labelledby": `rs-tab-${tab.id}`, hidden: true }, panel.el);
  panelsEl.append(wrap);
  panels.set(tab.id, { ...panel, wrap });
  const b = h("button", { type: "button", class: "rs-tab", role: "tab", id: `rs-tab-${tab.id}`, "aria-controls": `rs-panel-${tab.id}`, "aria-selected": "false", tabindex: "-1" }, h("span", { class: "rs-tab-icon", "aria-hidden": "true", text: tab.icon }), h("span", { text: t(tab.label) }));
  b.addEventListener("click", () => showTab(tab.id));
  tabButtons.set(tab.id, b);
  tabsEl.append(b);
}
arrowKeys(tabsEl, 'button[role="tab"]');

export function showTab(id) {
  if (!panels.has(id)) return;
  current = id;
  for (const [key, panel] of panels) {
    panel.wrap.hidden = key !== id;
    const b = tabButtons.get(key);
    b.setAttribute("aria-selected", String(key === id));
    b.tabIndex = key === id ? 0 : -1;
  }
  refreshAll();
  panelsEl.scrollTop = 0;
}

// Only the tab that's showing is kept up to date
function refreshAll() {
  const s = robotSettings();
  if (!s || modal.hidden) return;
  panels.get(current).refresh(s);
  updateNote();
}

onSettings(() => refreshAll());

// Your own model replaces the built-in robot: clothes and shapes only apply to the built-in one
function updateNote() {
  const custom = robot.modelInfo?.custom;
  note.hidden = !custom;
  if (custom) note.textContent = t("You use your own robot model, so shapes, colors and clothes show on the built-in robot only. You can switch back in Settings → Robot → Your own model.");
}
document.addEventListener("friends:robot-model", updateNote);

// ---------- The preview ----------
robot.host("studio", stage, { priority: 5, interactive: true, shot: "medium" });

const SHOT_BUTTONS = document.querySelectorAll("#rs-shot button");
const VIEW_BUTTONS = document.querySelectorAll("#rs-view button");
const VIEWS = { front: 0, three: 0.7, side: 1.5708, back: 3.1416 };

function setShot(shot) {
  robot.options("studio", { shot });
  for (const b of SHOT_BUTTONS) {
    const on = b.dataset.value === shot;
    b.setAttribute("aria-checked", String(on));
    b.classList.toggle("selected", on);
    b.tabIndex = on ? 0 : -1;
  }
}
function setView(view) {
  robot.options("studio", { view: view === "turn" ? { yaw: 0, spin: true } : { yaw: VIEWS[view] ?? 0, spin: false } });
  for (const b of VIEW_BUTTONS) {
    const on = b.dataset.value === view;
    b.setAttribute("aria-checked", String(on));
    b.classList.toggle("selected", on);
    b.tabIndex = on ? 0 : -1;
  }
}
for (const b of SHOT_BUTTONS) b.addEventListener("click", () => setShot(b.dataset.value));
for (const b of VIEW_BUTTONS) b.addEventListener("click", () => setView(b.dataset.value));
arrowKeys(document.getElementById("rs-shot"), 'button[role="radio"]');
arrowKeys(document.getElementById("rs-view"), 'button[role="radio"]');

const mood = document.getElementById("rs-mood");
const gesture = document.getElementById("rs-gesture");
mood.innerHTML = document.getElementById("robot-try-mood").innerHTML;
gesture.innerHTML = document.getElementById("robot-try-gesture").innerHTML;
mood.addEventListener("change", () => mood.value && robot.director.toolEvent({ mood: mood.value }));
gesture.addEventListener("change", () => {
  if (gesture.value) robot.director.toolEvent({ gesture: gesture.value });
  gesture.value = "";
});

document.addEventListener("friends:robot-unavailable", (e) => {
  stage.classList.add("unavailable");
  note.hidden = false;
  note.textContent = t("The 3D robot can't be shown here: {reason}", { reason: t(e.detail.reason) });
});

// ---------- Opening and closing ----------
export function openStudio(tab = current) {
  history.undo.length = history.redo.length = 0;
  history.at = 0;
  syncHistory();
  modal.hidden = false;
  if (!robot.unavailable) robot.show("studio", true);
  setShot("medium");
  setView("front");
  showTab(tab);
}

export function closeStudio() {
  if (modal.hidden) return;
  modal.hidden = true;
  robot.show("studio", false);
}

export const isStudioOpen = () => !modal.hidden;

document.getElementById("rs-done").addEventListener("click", closeStudio);
document.getElementById("rs-close").addEventListener("click", closeStudio);
modal.addEventListener("click", (e) => e.target === modal && closeStudio());

document.getElementById("rs-reset").addEventListener("click", async () => {
  const ok = await confirmDialog({ title: t("Start over?"), message: t("The robot and its room go back to the plain original. Looks you saved stay."), confirm: t("Start over") });
  if (!ok) return;
  remember();
  updateSettings((s) => {
    s.robot.design = D.defaultDesign();
    s.robot.room = R.defaultRoom();
  });
});

// Escape closes the studio first (before Settings or voice mode); Ctrl+Z and Ctrl+Shift+Z undo and redo
document.addEventListener(
  "keydown",
  (e) => {
    if (modal.hidden) return;
    if (e.key === "Escape" && !document.querySelector(".confirm-backdrop")) {
      e.stopPropagation();
      e.preventDefault();
      closeStudio();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.closest?.("input[type=text], textarea")) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) restore(history.redo, history.undo);
      else restore(history.undo, history.redo);
    }
  },
  true
);

document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open-studio]");
  if (opener) openStudio(opener.dataset.openStudio || undefined);
});
