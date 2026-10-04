// ---------- Keyboard shortcuts ----------
// The list (press ?), and the few shortcuts that don't belong to one panel: Alt+N starts a new
// chat and Ctrl+, opens Settings. (Ctrl+K and Ctrl+F live with the search and find-in-chat code,
// M and F with voice mode.)
import { openSettings, closeSettings } from "./settings.js";
import { newChat } from "./chat.js";

const modal = document.getElementById("shortcuts-modal");
const typing = (el) => el?.closest?.("input, textarea, select, [contenteditable='true']");
const anotherOpen = () => document.querySelector(".modal-backdrop:not([hidden]):not(#shortcuts-modal), .search-backdrop:not([hidden]), #voice-mode:not([hidden])");

export function openShortcuts() {
  modal.hidden = false;
}
export function closeShortcuts() {
  modal.hidden = true;
}

document.getElementById("shortcuts-btn").addEventListener("click", openShortcuts);
document.getElementById("shortcuts-close").addEventListener("click", closeShortcuts);
modal.addEventListener("click", (e) => e.target === modal && closeShortcuts());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.hidden) {
    e.stopPropagation();
    return closeShortcuts();
  }
  if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target) && !anotherOpen()) {
    e.preventDefault();
    return openShortcuts();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ",") {
    e.preventDefault();
    if (!modal.hidden) closeShortcuts();
    return modal.hidden && document.getElementById("settings-modal").hidden ? openSettings() : closeSettings();
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "n" && !anotherOpen()) {
    e.preventDefault();
    newChat();
  }
}, true);
