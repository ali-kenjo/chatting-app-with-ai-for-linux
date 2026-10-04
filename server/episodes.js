// The AI's memory of your conversations: after a chat or a voice conversation
// goes quiet, a short "episode" is written about it (what you talked about,
// how you seemed, what's still open). New conversations start with the latest
// few, so it can say "how did the interview go?" or "last week you said…", and
// the recall_conversations tool looks further back. Things worth asking about
// later are kept as follow-ups until they've been talked about.
//
// Stored in <data folder>/episodes/: <chat id>.json per conversation, and
// follow-ups.json. Settings → Characters → Companion turns it on or off.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const chats = require("./chats");
const logger = require("./logger");

const dir = path.join(dataDir, "episodes");
const followFile = path.join(dir, "follow-ups.json");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDLE_MS = 15 * 60 * 1000; // a chat is written up once it's been quiet this long
const MIN_NEW = 4; // …and has at least this many new messages
const FOLLOW_DAYS = 14; // follow-ups nobody got back to are dropped after this
const MAX_FOLLOW = 30;

const fileFor = (chatId) => {
  if (typeof chatId !== "string" || !ID.test(chatId)) throw new Error("Episode not found.");
  return path.join(dir, `${chatId}.json`);
};

function read(chatId) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(chatId), "utf8"));
  } catch {
    return null;
  }
}

function all() {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => ID.test(n.replace(/\.json$/, "")));
  } catch {}
  const out = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
    } catch {}
  }
  return out.sort((a, b) => b.at - a.at);
}

// ---------- Follow-ups ----------
function followUps({ all: everything = false } = {}) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(followFile, "utf8"));
  } catch {}
  if (!Array.isArray(list)) list = [];
  const fresh = Date.now() - FOLLOW_DAYS * 24 * 60 * 60 * 1000;
  return everything ? list : list.filter((f) => !f.done && f.at > fresh);
}

function saveFollowUps(list) {
  const fresh = Date.now() - FOLLOW_DAYS * 24 * 60 * 60 * 1000;
  writeJson(followFile, list.filter((f) => !f.done && f.at > fresh).slice(-MAX_FOLLOW));
}

function addFollowUps(texts, { chatId, character }) {
  const list = followUps();
  for (const text of texts) {
    const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (clean && !list.some((f) => f.text.toLowerCase() === clean.toLowerCase())) {
      list.push({ id: crypto.randomUUID().slice(0, 8), text: clean, at: Date.now(), chatId, character });
    }
  }
  saveFollowUps(list);
}

// Talked about: it's not brought up again
function resolve(id) {
  const list = followUps();
  const found = list.find((f) => f.id === String(id || "").trim());
  if (!found) throw new Error("There's no open follow-up with that id.");
  saveFollowUps(list.filter((f) => f !== found));
  return { ok: true, text: found.text };
}

// ---------- Writing an episode ----------
const lineFor = (m) => `${m.role === "user" ? "User" : "AI"}: ${String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 1200)}`;

function parseJson(text) {
  const raw = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw);
}

// Writes or updates the episode of one chat. brain: { api, key, model }.
async function update(chatId, brain, { character = "" } = {}) {
  const chat = chats.get(chatId);
  const before = read(chatId);
  const from = before?.upTo || 0;
  const fresh = chat.messages.slice(from).filter((m) => m.text);
  if (fresh.length < 2) return before;

  const open = followUps();
  const prompt = [
    "You keep the long-term memory of an AI companion. Read the new part of a conversation between the user and the AI and update the memory of it.",
    'Reply with JSON only: {"title": "...", "summary": "...", "topics": ["..."], "mood": "...", "followUps": ["..."], "resolved": ["..."]}',
    "- title: a few words naming what the conversation was about.",
    "- summary: 2-4 sentences in English, written as the AI's memory: what you talked about, what the user shared about their life, decisions, plans with dates, and anything personal worth remembering. Include the earlier summary's key points.",
    "- topics: up to 6 short keywords.",
    '- mood: how the user seemed, in a few words ("excited about the launch", "tired and stressed"), or "".',
    "- followUps: things to ask the user about in a LATER conversation, mostly events in their life or projects whose outcome you'd want to hear, written as a reminder with the date if known (\"Ask how the job interview on Friday went\"). Not tasks for the AI to do now, and none for small talk. Usually 0-2.",
    "- resolved: ids of the open follow-ups below that this part of the conversation already answered.",
    "",
    `Earlier summary of this conversation: ${before?.summary || "(none)"}`,
    `Open follow-ups: ${open.length ? open.map((f) => `[${f.id}] ${f.text}`).join("; ") : "(none)"}`,
    "",
    "New part of the conversation:",
    ...fresh.slice(-60).map(lineFor),
  ].join("\n");

  const text = await brain.api.generateText({ key: brain.key, model: brain.model, prompt, temperature: 0.2 });
  let data;
  try {
    data = parseJson(text);
  } catch {
    throw new Error("The memory of this conversation couldn't be written (the AI didn't answer in JSON).");
  }
  const strings = (v, n, max) => (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => x.trim().slice(0, max));
  const episode = {
    chatId,
    title: String(data.title || chat.title || "").trim().slice(0, 100) || chat.title,
    summary: String(data.summary || "").trim().slice(0, 1200),
    topics: strings(data.topics, 6, 40),
    mood: String(data.mood || "").trim().slice(0, 100),
    character: character || before?.character || "",
    voice: chat.messages.some((m) => m.voice),
    upTo: chat.messages.length,
    at: chat.messages.at(-1)?.at || chat.updatedAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (!episode.summary) return before;
  writeJson(fileFor(chatId), episode);
  for (const id of strings(data.resolved, 10, 20)) {
    try {
      resolve(id);
    } catch {}
  }
  addFollowUps(strings(data.followUps, 3, 200), { chatId, character: episode.character });
  return episode;
}

// Chats that went quiet and have new messages since their episode, oldest first
function due(now = Date.now()) {
  const out = [];
  for (const { id, updatedAt } of chats.list()) {
    if (now - updatedAt < IDLE_MS) continue;
    let chat;
    try {
      chat = chats.get(id);
    } catch {
      continue;
    }
    const upTo = read(id)?.upTo || 0;
    if (chat.messages.length - upTo >= MIN_NEW) out.push(id);
    if (out.length >= 20) break;
  }
  return out.reverse();
}

// Runs in the background now and then; a few chats each time, never two at once
let running = false;
async function sweep({ getBrain, getSettings, limit = 3 } = {}) {
  if (running) return 0;
  const s = getSettings();
  if (s.companion?.recall === false) return 0;
  const brain = getBrain();
  if (!brain) return 0;
  running = true;
  let done = 0;
  try {
    for (const id of due().slice(0, limit)) {
      try {
        await update(id, brain, { character: s.characters?.active });
        done++;
      } catch (err) {
        logger.debug(`Episode for ${id} skipped:`, err.message);
      }
    }
  } finally {
    running = false;
  }
  return done;
}

let timer = null;
function schedule(options, every = 10 * 60 * 1000) {
  clearInterval(timer);
  timer = setInterval(() => sweep(options).catch(() => {}), every);
  timer.unref?.();
}

function removeForChat(chatId) {
  try {
    fs.rmSync(fileFor(chatId), { force: true });
  } catch {}
  saveFollowUps(followUps().filter((f) => f.chatId !== chatId));
}

function clear() {
  for (const e of all()) removeForChat(e.chatId);
  saveFollowUps([]);
  return { ok: true };
}

// "3 days ago", for the AI
function ago(ms, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 60) return "just now";
  const hours = Math.round(minutes / 60);
  if (hours < 20) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days <= 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// The latest episodes (not this chat's), for the start of a new conversation
function recent(n = 5, { exclude = null } = {}) {
  return all()
    .filter((e) => e.chatId !== exclude && e.summary)
    .slice(0, n);
}

// recall_conversations: episodes and chats that mention the words
function search(query, { limit = 6 } = {}) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const scored = all()
    .map((e) => {
      const hay = `${e.title} ${e.summary} ${e.topics.join(" ")} ${e.mood}`.toLowerCase();
      return { e, score: words.length ? words.filter((w) => hay.includes(w)).length : 1 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.at - a.e.at)
    .slice(0, limit)
    .map(({ e }) => ({ when: ago(e.at), title: e.title, summary: e.summary, mood: e.mood || undefined }));
  // Chats that don't have an episode yet (still going, or short), by their words
  const covered = new Set(all().map((e) => e.chatId));
  const extra = String(query || "").trim()
    ? chats
        .search(query)
        .filter((c) => !covered.has(c.id))
        .slice(0, 4)
        .map((c) => ({ when: ago(c.updatedAt), title: c.title, excerpt: c.snippet }))
    : [];
  return [...scored, ...extra];
}

module.exports = { dir, read, all, update, due, sweep, schedule, recent, search, followUps, addFollowUps, resolve, removeForChat, clear, ago, IDLE_MS };
