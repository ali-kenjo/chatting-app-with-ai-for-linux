// Settings shared by every part of the page. Loaded from the helper once;
// changes are applied right away and saved a moment later.
import { api } from "./api.js";
import { followSetting } from "./i18n.js";

let settings = null;
const listeners = new Set();
let saveTimer = null;

export function getSettings() {
  return settings;
}

// fn(settings) runs now (if loaded) and after every change
export function onSettings(fn) {
  listeners.add(fn);
  if (settings) fn(settings);
}

// change(settings) edits the settings in place
export function updateSettings(change) {
  if (!settings) return;
  change(settings);
  listeners.forEach((fn) => fn(settings));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
  say("saving");
}

const say = (what) => document.dispatchEvent(new CustomEvent(`friends:${what}`));

async function save() {
  saveTimer = null;
  try {
    await api.settings.save(settings);
    say("saved");
    return true;
  } catch (err) {
    console.error("Couldn't save settings:", err.message);
    say("save-failed");
    return false;
  }
}

// Saves now instead of in a moment (before the page reloads, for instance)
export function flushSettings() {
  clearTimeout(saveTimer);
  return settings ? save() : Promise.resolve(false);
}

export const retrySave = () => save();

// Read or write a value by path, e.g. "personality.name"
const read = (path) => path.split(".").reduce((o, k) => o?.[k], settings);
function write(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], settings)[last] = value;
}

// Simple controls bind themselves: <input data-setting="personality.name">
function syncControls() {
  document.querySelectorAll("[data-setting]").forEach((el) => {
    if (el === document.activeElement && el.type !== "checkbox" && el.type !== "range") return; // don't disturb typing
    const value = read(el.dataset.setting);
    if (el.type === "checkbox") el.checked = !!value;
    else if (value !== undefined) el.value = String(value);
  });
}

document.addEventListener("input", (e) => {
  const el = e.target.closest?.("[data-setting]");
  if (!el || !settings) return;
  // data-type="number" on a <select> saves a number (the helper drops a string where a number belongs)
  const value = el.type === "checkbox" ? el.checked : el.type === "range" || el.dataset.type === "number" ? Number(el.value) : el.value;
  updateSettings(() => write(el.dataset.setting, value));
});

onSettings(syncControls);

api.settings.get().then(
  (loaded) => {
    settings = loaded;
    followSetting(settings.ui?.language);
    listeners.forEach((fn) => fn(settings));
  },
  (err) => console.error("Couldn't load settings:", err.message)
);
