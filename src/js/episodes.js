// ---------- Settings → Memory → Conversations it remembers ----------
// What the AI remembers of earlier conversations (server/episodes.js), and
// the follow-ups it means to ask about. You can remove any of them.
import { api } from "./api.js";

const episodeList = document.getElementById("episode-list");
const followList = document.getElementById("followup-list");
const clearButton = document.getElementById("episodes-clear");
const REMOVE = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

const when = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function item(title, text, meta, onRemove) {
  const li = document.createElement("li");
  li.className = "note episode";
  li.innerHTML = `<div class="note-head"><span class="note-text"><span class="note-title"></span><span class="note-desc"></span></span>
    <button type="button" class="icon-btn small" title="Forget this">${REMOVE}</button></div><p class="episode-text"></p>`;
  li.querySelector(".note-title").textContent = title;
  li.querySelector(".note-desc").textContent = meta;
  li.querySelector(".episode-text").textContent = text;
  li.querySelector("button").addEventListener("click", async () => {
    await onRemove().catch(() => {});
    refresh();
  });
  return li;
}

function empty(text) {
  const li = document.createElement("li");
  li.className = "memory-empty";
  li.textContent = text;
  return li;
}

async function refresh() {
  let data;
  try {
    data = await api.episodes.list();
  } catch {
    return;
  }
  followList.replaceChildren(
    ...(data.followUps.length ? data.followUps.map((f) => item(f.text, "", `Noted ${when(f.at)}`, () => api.episodes.resolve(f.id))) : [empty("Nothing to follow up on.")])
  );
  episodeList.replaceChildren(
    ...(data.episodes.length
      ? data.episodes.slice(0, 50).map((e) => item(e.title, e.summary, `${when(e.at)}${e.voice ? " · voice" : ""}${e.mood ? ` · ${e.mood}` : ""}`, () => api.episodes.remove(e.chatId)))
      : [empty("Nothing yet. Conversations are remembered once they've been quiet for a while.")])
  );
}

// Clearing needs a second click within a few seconds
clearButton.addEventListener("click", async () => {
  if (!clearButton.dataset.armed) {
    clearButton.dataset.armed = "1";
    clearButton.textContent = "Sure?";
    setTimeout(() => {
      delete clearButton.dataset.armed;
      clearButton.textContent = "Forget";
    }, 4000);
    return;
  }
  delete clearButton.dataset.armed;
  clearButton.textContent = "Forget";
  await api.episodes.clear().catch(() => {});
  refresh();
});

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "memory") refresh();
});
