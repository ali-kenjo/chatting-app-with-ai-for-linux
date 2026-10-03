// Saved conversations: one JSON file per chat in <data folder>/chats/.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");

const dir = path.join(dataDir, "chats");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Only real chat ids become file names, so a request can't reach other files
function fileFor(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Chat not found.");
  return path.join(dir, `${id}.json`);
}

// "What's a good recipe for dinner tonight with..." → a short sidebar title
function titleFrom(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 48) return clean;
  const cut = clean.slice(0, 48);
  return (cut.lastIndexOf(" ") > 24 ? cut.slice(0, cut.lastIndexOf(" ")) : cut) + "…";
}

function create(firstText) {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: titleFrom(firstText), createdAt: now, updatedAt: now, messages: [] };
}

// Every message gets a stable id, so the page can point at one (edit, regenerate, pin).
// Returns true when some were missing.
function ensureIds(chat) {
  let added = false;
  for (const m of chat.messages) {
    if (typeof m.id !== "string") {
      m.id = crypto.randomUUID();
      added = true;
    }
  }
  return added;
}

function get(id) {
  let chat;
  try {
    chat = JSON.parse(fs.readFileSync(fileFor(id), "utf8"));
  } catch {
    throw new Error("Chat not found.");
  }
  // Chats saved before messages had ids get them now, once
  if (ensureIds(chat)) writeJson(fileFor(id), chat);
  return chat;
}

// A summary written while this copy of the chat was open is kept (see summary.js).
// touch: false keeps the chat where it is in the sidebar.
function save(chat, { touch = true } = {}) {
  try {
    const onDisk = JSON.parse(fs.readFileSync(fileFor(chat.id), "utf8"));
    if (onDisk.summary && (!chat.summary || onDisk.summary.upTo > chat.summary.upTo)) chat.summary = onDisk.summary;
  } catch {}
  if (touch) chat.updatedAt = Date.now();
  ensureIds(chat);
  writeJson(fileFor(chat.id), chat);
}

// Drops the message with this id and everything after it (editing a message,
// or asking for a new answer). A summary that covered them is dropped too.
function truncate(chat, messageId) {
  const at = chat.messages.findIndex((m) => m.id === messageId);
  if (at < 0) throw new Error("That message isn't in this chat anymore.");
  const removed = chat.messages.splice(at);
  if (chat.summary && chat.summary.upTo > at) delete chat.summary;
  writeJson(fileFor(chat.id), chat); // not save(): it would bring the old summary back
  return removed;
}

// Liked / pinned marks on one message. Returns the updated message.
function mark(id, messageId, changes) {
  const chat = get(id);
  const message = chat.messages.find((m) => m.id === messageId);
  if (!message) throw new Error("That message isn't in this chat anymore.");
  for (const key of ["liked", "pinned", "pinnedNote"]) {
    if (!(key in changes)) continue;
    if (changes[key]) message[key] = changes[key];
    else delete message[key];
  }
  writeJson(fileFor(id), chat); // marking doesn't move the chat to the top
  return message;
}

function all() {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {}
  const chats = [];
  for (const name of names) {
    try {
      chats.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    } catch {} // skip a damaged file rather than hiding every chat
  }
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

const summary = ({ id, title, updatedAt }) => ({ id, title, updatedAt });

function list() {
  return all().map(summary);
}

function rename(id, title) {
  const chat = get(id);
  const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) throw new Error("A chat needs a name.");
  chat.title = clean;
  writeJson(fileFor(id), chat); // renaming doesn't move the chat to the top
  return summary(chat);
}

function remove(id) {
  try {
    fs.unlinkSync(fileFor(id));
  } catch {}
  return { ok: true };
}

// A draft (voice conversations) whose title or text matches, as a message-like hit
function draftHit(chat, q) {
  for (const m of chat.messages) {
    for (const d of m.drafts || []) {
      const text = `${d.title}: ${d.content}`;
      if (text.toLowerCase().includes(q)) return { text };
    }
  }
  return null;
}

// Case-insensitive search in titles, messages and drafts, with a snippet around the match
function search(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return list().slice(0, 20).map((c) => ({ ...c, snippet: "" }));

  const results = [];
  for (const chat of all()) {
    const inTitle = typeof chat.title === "string" && chat.title.toLowerCase().includes(q);
    const hit = chat.messages.find((m) => typeof m.text === "string" && m.text.toLowerCase().includes(q))
      || draftHit(chat, q);
    if (!inTitle && !hit) continue;

    let snippet = "";
    if (hit && typeof hit.text === "string") {
      const text = hit.text.replace(/\s+/g, " ");
      const at = text.toLowerCase().indexOf(q);
      const start = Math.max(0, at - 40);
      snippet = (start > 0 ? "…" : "") + text.slice(start, at + q.length + 60) + (at + q.length + 60 < text.length ? "…" : "");
    }
    results.push({ ...summary(chat), snippet });
    if (results.length === 50) break;
  }
  return results;
}

module.exports = { create, get, save, truncate, mark, list, rename, remove, search, titleFrom };
