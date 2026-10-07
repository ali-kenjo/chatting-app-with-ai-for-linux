// Settings → Characters → Voice conversation: the interrupt key. The conversation style and the
// sensitivity are plain selects (data-setting); a key needs the next key you press.
import { t } from "./i18n.js";
import { getSettings, onSettings, updateSettings } from "./store.js";
import { keyLabel, RESERVED_KEYS } from "./barge.mjs";

const button = document.getElementById("interrupt-key-btn");
const clear = document.getElementById("interrupt-key-clear");
const note = document.getElementById("interrupt-key-note");
let listening = false;

function show() {
  const key = getSettings()?.voice?.interruptKey || "";
  button.textContent = listening ? t("Press a key…") : key ? keyLabel(key, t("Space bar")) : t("No interrupt key");
  button.classList.toggle("active", listening);
  clear.hidden = !key || listening;
}

function stop(message = "") {
  listening = false;
  note.textContent = message;
  show();
}

function onKey(e) {
  if (!listening) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape") return stop();
  if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) return; // wait for a real key
  if (RESERVED_KEYS.includes(e.code)) return stop(t("{key} already does something in voice mode. Pick another key.", { key: keyLabel(e.code, t("Space bar")) }));
  updateSettings((s) => (s.voice.interruptKey = e.code));
  stop();
}

button?.addEventListener("click", () => {
  listening = !listening;
  note.textContent = listening ? t("Press the key you want, or Esc to cancel.") : "";
  show();
});
button?.addEventListener("blur", () => listening && stop());
clear?.addEventListener("click", () => {
  updateSettings((s) => (s.voice.interruptKey = ""));
  show();
});
document.addEventListener("keydown", onKey, true); // before the settings panel's own keys (Esc closes it)
onSettings(show);
