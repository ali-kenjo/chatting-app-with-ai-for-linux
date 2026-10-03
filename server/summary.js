// Long chats: the older part is summarized, so the AI still knows how the
// conversation started without getting every message every time. The summary
// is kept on the chat as { text, upTo }, covering messages[0 .. upTo).
const chats = require("./chats");
const gemini = require("./gemini");

const STEP = 10; // re-summarize once this many messages have dropped out of the window

// Index of the first message sent word for word; everything before it is in the summary.
// Starts at the summary's end when that's earlier, so no message falls in a gap.
// Before the first summary exists (it's written once STEP messages are past the
// window), the oldest messages are still sent, so the start isn't forgotten.
function windowStart(chat, window) {
  const start = Math.max(0, chat.messages.length - window);
  return chat.summary ? Math.min(chat.summary.upTo, start) : Math.max(0, start - STEP);
}

const lineFor = (m) => {
  const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  const drafts = (m.drafts || []).map((d) => `[draft "${d.title}": ${d.content.replace(/\s+/g, " ").slice(0, 600)}]`).join(" ");
  return `${m.role === "user" ? "User" : "AI"}: ${[text, drafts].filter(Boolean).join(" ")}`;
};

// Brings the summary up to date when enough messages have dropped out of the
// window. Resolves with the summary (or null); failures leave the old one.
async function update(chatId, { api = gemini, key, model, window = 20 }) {
  const chat = chats.get(chatId);
  const cut = chat.messages.length - window;
  const from = chat.summary?.upTo || 0;
  if (cut - from < STEP) return chat.summary || null;

  const prompt = [
    "Update the running summary of a conversation between a user and their AI companion.",
    "Keep what matters later: who the user is, their goals and projects, decisions made, facts and preferences they shared, drafts written (titles and key lines), and open questions. Drop small talk.",
    "Write it in the language(s) the conversation uses, as compact notes, at most 350 words. Reply with the summary only.",
    "",
    "Current summary:",
    chat.summary?.text || "(none yet)",
    "",
    "Messages to add:",
    ...chat.messages.slice(from, cut).map(lineFor),
  ].join("\n");
  const text = await api.generateText({ key, model, prompt });
  if (!text) return chat.summary || null;

  // Read and write in one go, so messages saved meanwhile aren't lost
  const latest = chats.get(chatId);
  latest.summary = { text: text.slice(0, 4000), upTo: cut, at: Date.now() };
  chats.save(latest, { touch: false });
  return latest.summary;
}

module.exports = { update, windowStart };
