// ---------- Settings → Memory → Conversations it remembers ----------
// What the AI remembers of earlier conversations (server/episodes.js), and
// the follow-ups it means to ask about. You can remove any of them.
import { api } from "./api.js";
import { t, formatDateTime } from "./i18n.js";
import { confirmDialog } from "./dialogs.js";

const episodeList = document.getElementById("episode-list");
const followList = document.getElementById("followup-list");
const clearButton = document.getElementById("episodes-clear");
const REMOVE = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

const when = (ms) => formatDateTime(new Date(ms));

function item(title, text, meta, onRemove) {
  const li = document.createElement("li");
  li.className = "note episode";
  li.innerHTML = `<div class="note-head"><span class="note-text"><span class="note-title"></span><span class="note-desc"></span></span>
    <button type="button" class="icon-btn small">${REMOVE}</button></div><p class="episode-text"></p>`;
  li.querySelector("button").title = t("Forget this");
  li.querySelector("button").setAttribute("aria-label", t("Forget this"));
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
    ...(data.followUps.length ? data.followUps.map((f) => item(f.text, "", t("Noted {when}", { when: when(f.at) }), () => api.episodes.resolve(f.id))) : [empty(t("Nothing to follow up on. When you mention something that's coming up, it will be noted here."))])
  );
  episodeList.replaceChildren(
    ...(data.episodes.length
      ? data.episodes.slice(0, 50).map((e) => item(e.title, e.summary, `${when(e.at)}${e.voice ? ` · ${t("voice")}` : ""}${e.mood ? ` · ${e.mood}` : ""}`, () => api.episodes.remove(e.chatId)))
      : [empty(t("Nothing yet. Conversations are remembered once they've been quiet for a while."))])
  );
}

// Forgetting everything asks first
clearButton.addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: t("Forget all remembered conversations?"),
    message: t("The short memories of your past chats and the follow-ups will be deleted. The chats themselves stay. This can't be undone."),
    confirm: t("Forget them"),
    danger: true,
  });
  if (!ok) return;
  await api.episodes.clear().catch(() => {});
  refresh();
});

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "memory") refresh();
});
