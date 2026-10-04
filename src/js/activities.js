// ---------- Things to do together ----------
// Games, debates, stories and practice (server/activities.js), as chips on
// the start screen (a few at a time) and in voice mode's 🎲 menu. Picking one says its prompt,
// as if you'd said it.
import { api } from "./api.js";
import { getSettings, onSettings } from "./store.js";
import { t } from "./i18n.js";

const chips = document.getElementById("hero-prompts");
const voiceChips = document.getElementById("voice-activity-chips");

let list = [];

function chip(a, { prompt = false } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "prompt-chip activity-chip";
  b.dataset.id = a.id;
  if (prompt) b.dataset.prompt = a.prompt; // sent like a typed message (workspace.js)
  b.textContent = `${a.emoji} ${t(a.title)}`;
  b.title = a.prompt;
  return b;
}

// The start screen shows a different few each time, and Surprise me
let picked = null;
function render() {
  const on = getSettings()?.companion?.activities !== false;
  if (!picked && list.length) {
    const rest = list.filter((a) => a.id !== "surprise").sort(() => Math.random() - 0.5);
    picked = [...rest.slice(0, 6), ...list.filter((a) => a.id === "surprise")];
  }
  chips.hidden = !on || !list.length;
  chips.replaceChildren(...(picked || []).map((a) => chip(a, { prompt: true })));
  voiceChips.replaceChildren(...list.map((a) => chip(a)));
}

export const activityPrompt = (id) => list.find((a) => a.id === id)?.prompt || "";

onSettings(render);
api.activities().then(
  (data) => {
    list = data.activities || [];
    render();
  },
  () => {}
);
