// ---------- Saved chats: sidebar list and search ----------
import { api } from "./api.js";
import { openChat, newChat, getCurrentChatId } from "./chat.js";

const historyEl = document.getElementById("chat-history");
const searchModal = document.getElementById("search-modal");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

const DAY = 24 * 60 * 60 * 1000;
const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
};

let chatList = [];
let renamingId = null;
let confirmId = null;

function groupOf(time) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= today) return "Today";
  if (time >= today - DAY) return "Yesterday";
  if (time >= today - 7 * DAY) return "Previous 7 days";
  if (time >= today - 30 * DAY) return "Previous 30 days";
  return "Older";
}

function renderList() {
  historyEl.innerHTML = "";
  if (!chatList.length) {
    historyEl.innerHTML = '<p class="chat-empty">Your chats will show up here.</p>';
    return;
  }

  let group = null;
  let ul = null;
  for (const chat of chatList) {
    if (groupOf(chat.updatedAt) !== group) {
      group = groupOf(chat.updatedAt);
      const title = document.createElement("div");
      title.className = "section-title";
      title.textContent = group;
      ul = document.createElement("ul");
      ul.className = "chat-list";
      historyEl.append(title, ul);
    }

    const li = document.createElement("li");
    li.className = "chat-item";
    li.dataset.id = chat.id;
    li.classList.toggle("active", chat.id === getCurrentChatId());

    if (renamingId === chat.id) {
      li.classList.add("renaming");
      li.innerHTML = '<input class="chat-rename" maxlength="120" aria-label="Chat name">';
      li.querySelector("input").value = chat.title;
    } else if (confirmId === chat.id) {
      li.classList.add("confirm");
      li.innerHTML = `
        <span class="chat-title">Delete this chat?</span>
        <div class="chat-actions">
          <button class="icon-btn small danger" data-action="confirm-delete" title="Delete">${ICONS.check}</button>
          <button class="icon-btn small" data-action="cancel" title="Cancel">${ICONS.close}</button>
        </div>`;
    } else {
      li.innerHTML = `
        <a class="chat-link" href="#chat/${chat.id}"><span class="chat-title"></span></a>
        <div class="chat-actions">
          <button class="icon-btn small" data-action="rename" title="Rename">${ICONS.edit}</button>
          <button class="icon-btn small danger" data-action="delete" title="Delete">${ICONS.trash}</button>
        </div>`;
      li.querySelector(".chat-title").textContent = chat.title;
      li.querySelector(".chat-link").title = chat.title;
    }
    ul.append(li);
  }

  const renameInput = historyEl.querySelector(".chat-rename");
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }
}

async function refresh() {
  try {
    chatList = await api.chats.list();
  } catch {} // helper unreachable: keep showing what we had
  renderList();
}

async function commitRename(id, title) {
  renamingId = null;
  const chat = chatList.find((c) => c.id === id);
  if (chat && title.trim() && title.trim() !== chat.title) {
    try {
      await api.chats.rename(id, title);
    } catch {}
  }
  refresh();
}

historyEl.addEventListener("click", async (e) => {
  const item = e.target.closest(".chat-item");
  if (!item) return;
  const id = item.dataset.id;

  if (e.target.closest(".chat-link")) {
    e.preventDefault();
    return openChat(id);
  }

  switch (e.target.closest("[data-action]")?.dataset.action) {
    case "rename":
      renamingId = id;
      confirmId = null;
      break;
    case "delete":
      confirmId = id;
      renamingId = null;
      break;
    case "cancel":
      confirmId = null;
      break;
    case "confirm-delete":
      confirmId = null;
      try {
        await api.chats.remove(id);
      } catch {}
      if (id === getCurrentChatId()) newChat();
      return refresh();
    default:
      return;
  }
  renderList();
});

historyEl.addEventListener("keydown", (e) => {
  if (!e.target.classList.contains("chat-rename")) return;
  const id = e.target.closest(".chat-item").dataset.id;
  if (e.key === "Enter") commitRename(id, e.target.value);
  if (e.key === "Escape") {
    e.stopPropagation();
    renamingId = null;
    renderList();
  }
});

// Clicking elsewhere while renaming keeps the new name
historyEl.addEventListener("focusout", (e) => {
  if (e.target.classList.contains("chat-rename") && renamingId) {
    commitRename(e.target.closest(".chat-item").dataset.id, e.target.value);
  }
});

document.addEventListener("friends:chats-changed", refresh);
document.addEventListener("friends:chat-opened", () => {
  if (!renamingId) renderList();
});

// ---------- Search ----------
let results = [];
let selected = 0;
let searchSeq = 0;
let searchTimer = null;

// Put the matching part of `text` in <mark>, without trusting the text as HTML
function highlight(el, text, query) {
  el.textContent = "";
  const q = query.trim().toLowerCase();
  if (!q) return (el.textContent = text);
  let from = 0;
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    el.append(text.slice(from, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + q.length);
    el.append(mark);
    from = at + q.length;
  }
  el.append(text.slice(from));
}

function renderResults(query) {
  searchResults.innerHTML = "";
  if (!results.length) {
    const empty = document.createElement("li");
    empty.className = "search-empty";
    empty.textContent = query.trim() ? "No chats found." : "No chats yet.";
    searchResults.append(empty);
    return;
  }
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "search-result" + (i === selected ? " selected" : "");
    li.dataset.id = r.id;
    li.innerHTML = '<div class="search-title"></div><div class="search-snippet"></div>';
    highlight(li.querySelector(".search-title"), r.title, query);
    if (r.snippet) highlight(li.querySelector(".search-snippet"), r.snippet, query);
    else li.querySelector(".search-snippet").textContent = groupOf(r.updatedAt);
    searchResults.append(li);
  });
}

async function runSearch(query) {
  const seq = ++searchSeq;
  let found = [];
  try {
    found = await api.chats.search(query);
  } catch {}
  if (seq !== searchSeq) return; // a newer search already started
  results = found;
  selected = 0;
  renderResults(query);
}

function openSearch() {
  searchModal.hidden = false;
  searchInput.value = "";
  runSearch("");
  searchInput.focus();
}

export function closeSearch() {
  searchModal.hidden = true;
}

// The words searched for stay marked in the chat
function pick(id) {
  closeSearch();
  openChat(id, { find: searchInput.value.trim() });
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 150);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!results.length) return;
    selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    renderResults(searchInput.value);
    searchResults.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter" && results[selected]) pick(results[selected].id);
});

searchResults.addEventListener("click", (e) => {
  const item = e.target.closest(".search-result");
  if (item) pick(item.dataset.id);
});

searchModal.addEventListener("click", (e) => {
  if (e.target === searchModal) closeSearch();
});

document.getElementById("search-open").addEventListener("click", (e) => {
  e.preventDefault();
  openSearch();
});

// Ctrl+K (or Cmd+K) opens search from anywhere
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  }
});

refresh();
