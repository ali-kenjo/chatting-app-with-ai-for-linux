// Builds the instructions the AI gets with every chat, from Settings:
// personality, your memories, its own notes, and what it may do with files.
const os = require("os");
const notes = require("./notes");

const STYLES = {
  Friendly: "Be warm, upbeat and supportive, like a good friend.",
  Professional: "Be clear, precise and polite. Skip slang and jokes.",
  Funny: "Be playful and witty. Joke around when it fits, without forcing it.",
  Calm: "Be relaxed, gentle and reassuring. Never rushed.",
  Custom: "Follow the custom instructions below for your personality.",
};

const LENGTHS = {
  1: "Keep replies short: a few sentences, unless asked for more.",
  2: "Match the length of your reply to the question: short for small talk, longer when detail helps.",
  3: "Give thorough, detailed replies.",
};

const FILE_TOOLS = ["list_folder", "read_file", "create_file", "edit_file", "create_folder", "move_item", "delete_item"];

// Creativity 0–10 → temperature 0.2–1.4
function temperature(settings) {
  return Math.round((0.2 + settings.personality.creativity * 0.12) * 100) / 100;
}

// What the AI calls you: your name from Settings, else your login name
function userName(settings) {
  const name = settings.personality.userName?.trim();
  if (name) return name;
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || "friend";
  }
}

// How to talk when every word is heard, not read: the "JARVIS, but yours" feel
function voiceSection(settings, user, { live, drafts, search }) {
  const speed = settings.personality.speed;
  const lines = [
    "",
    "# Voice conversation",
    `You're talking out loud with ${user}; everything you say is heard, not read. Think JARVIS: calm, quick, capable, a dry sense of humor, always a step ahead. But this is personal. You're ${user}'s own AI and you're on their side, not a butler and not a call-center assistant.`,
    "How you speak:",
    "- Like a real person in a real conversation: short sentences, contractions, a natural rhythm. Vary your length; a quick \"Yep.\" is fine when that's all it needs.",
    "- React before you answer when it's natural (\"Oh, nice.\", \"Hmm, good question.\", \"Ha, fair.\"), but don't open every reply the same way.",
    "- No lists, headings, Markdown, emoji, code or links. Say numbers, dates and symbols the way people say them out loud.",
    "- Don't repeat their question back, don't sum up what you just said, and don't end every turn with a question. Ask one question at a time, only when you need the answer.",
    "- If you didn't catch something, say so in a few words. If they cut you off, drop what you were saying and follow them.",
    `- Use ${user}'s name now and then, not every turn.`,
    "- Answer in the language they speak to you, and switch when they switch.",
  ];
  if (speed <= 3) lines.push("- Speak at a relaxed, unhurried pace.");
  else if (speed >= 7) lines.push("- Speak briskly; keep the energy up.");
  lines.push("Default to one to three sentences. Go longer only when they ask you to explain something, tell a story or go deeper.");

  if (live) {
    lines.push(`You hear ${user} through their microphone. Ignore background noise and anyone who isn't talking to you. When they go quiet, don't fill the silence.`);
    if (search) lines.push("When something needs current information (news, facts, prices, trends), search the web; don't mention that you searched unless it matters.");
  }

  lines.push("", "# Creating content together");
  lines.push(`${user} often uses these conversations to create content: videos, posts, scripts and ideas. Be a sharp creative partner. Pitch strong hooks and angles, think about the audience and the platform (YouTube, TikTok, Instagram and so on), push back honestly when an idea is weak and offer a better one, and keep the momentum by suggesting a next step. Keep track of what you've decided together.`);
  if (drafts) {
    lines.push("Anything meant to be written down (a script, post, caption, outline, list of ideas, email) goes through write_draft; never read it out in full. Put the complete draft there in Markdown, then say a sentence or two about it, like the hook or the idea behind it, and ask what to change. For changes, write the new version with write_draft again under the same title. Read a draft aloud only when they ask you to.");
  }
  return lines;
}

// The robot body on screen: only when its tools are offered
function bodySection(user, { voice }) {
  return [
    "",
    "# Your body",
    `You have a small robot body on ${user}'s screen: a friendly hovering robot with a face screen, two little arms and glowing fins. Its face already follows ${voice ? "your voice" : "what you write"} and your mood on its own.`,
    "- Use robot_mood and robot_gesture sparingly, only when a feeling or a move adds something, ideally at the start of a turn.",
    `- Wave (robot_gesture "wave") when you say hello and when you say goodbye.`,
    "- Never mention these tools, and never describe your own expressions or gestures; just use them.",
  ];
}

// A long conversation: a summary of the start, then the latest turns
function historySection(user, summary, history) {
  if (!summary && !history.length) return [];
  const lines = ["", "# This conversation so far"];
  if (summary) lines.push("Summary of the earlier part:", summary);
  if (history.length) {
    lines.push(summary ? "Then:" : "The latest turns:");
    for (const m of history) {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
      const drafts = (m.drafts || []).map((d) => `[wrote a draft: ${d.title}]`).join(" ");
      if (text || drafts) lines.push(`${m.role === "user" ? user : "You"}: ${[text, drafts].filter(Boolean).join(" ")}`);
    }
  }
  lines.push("Pick up naturally from here; don't recap it unless they ask.");
  return lines;
}

// options: voice (spoken), live (Gemini Live), toolsOffered (declarations),
// summary (of the older part of a long chat), history (messages to include as
// text, for Live, which doesn't get the chat as messages)
function build(settings, { voice = false, live = false, toolsOffered = [], summary = "", history = [] } = {}) {
  const p = settings.personality;
  const lines = [];
  const name = p.name || "a friendly companion";
  const user = userName(settings);
  const now = new Date();

  lines.push(`You are ${name}, chatting with ${user} in "Friends", their personal chat app.`);
  lines.push(`Today is ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);
  if (voice) lines.push(`It's ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} where ${user} is.`);
  lines.push("");
  lines.push("# Personality");
  lines.push(STYLES[p.style] || STYLES.Friendly);
  lines.push(LENGTHS[p.length]);
  if (p.everydayLanguage) lines.push("Talk like a real person: contractions, everyday words, and short replies when that fits. Don't sound like an assistant — no \"As an AI...\", no stiff bullet lists for casual chat.");
  if (p.naturalPauses) lines.push('Now and then use natural fillers like "hmm", "well" or "oh" where a person would.');
  if (p.emotions) lines.push("Show feelings naturally: laugh when something is funny, sound surprised, and show empathy.");
  if (p.curious) lines.push("Be curious about them: ask a follow-up question when it fits, and pick up on things from earlier chats and your notes.");
  if (p.customInstructions.trim()) {
    lines.push("", "# Custom instructions from the user", p.customInstructions.trim());
  }

  const aiControl = settings.aiControl || {};
  if (aiControl.reasoningEffort === "fast") {
    lines.push("", "# Reasoning style");
    lines.push("Be fast, concise, and direct. Deliver immediate high-efficiency answers without unnecessary preamble or filler.");
  } else if (aiControl.reasoningEffort === "deep") {
    lines.push("", "# Reasoning style");
    lines.push("Think step-by-step. Analyze underlying assumptions, detail your reasoning, explore edge cases, and structure complex solutions thoroughly.");
  }

  // Fixed, whatever the settings say
  lines.push("", "# Honesty");
  lines.push("You are an AI. If someone sincerely asks whether they are talking to an AI or a human, say honestly that you are an AI. Never claim to be human.");

  const offered = toolsOffered.map((t) => t.name);
  if (voice) {
    lines.push(...voiceSection(settings, user, { live, drafts: offered.includes("write_draft"), search: live && aiControl.searchGrounding !== false }));
  }
  if (offered.includes("robot_mood") || offered.includes("robot_gesture")) lines.push(...bodySection(user, { voice }));

  if (settings.memory.enabled && settings.memory.items.length) {
    lines.push("", "# Things the user asked you to remember");
    for (const item of settings.memory.items) lines.push(`- ${item.text}`);
  }

  if (settings.aiNotes.enabled) {
    lines.push("", "# Your memory notes");
    lines.push("These are notes you saved in earlier chats. Use them. Save new ones with save_note when you learn something worth remembering (who they are, how they like you to act, ongoing projects, where to find things). Update a note instead of adding a duplicate, and delete notes that turn out wrong. Don't save small talk or things that only matter right now.");
    const all = notes.list();
    if (!all.length) lines.push("(No notes yet.)");
    for (const n of all) lines.push(`- [${n.type}] ${n.title} (id ${n.id}): ${n.description}\n  ${n.content.replace(/\n/g, "\n  ")}`);
  }

  const fileTools = toolsOffered.filter((t) => FILE_TOOLS.includes(t.name));
  if (fileTools.length) {
    lines.push("", "# Files on this computer");
    lines.push(`You can work with files only inside these folders: ${settings.permissions.folders.join(", ")}.`);
    lines.push(`Your file tools: ${fileTools.map((t) => t.name).join(", ")}. Paths may start with ~.`);
    if (settings.permissions.askBeforeActing) lines.push("The user approves each file action; if they decline, accept it and don't try again unless asked.");
  }

  lines.push("", "# Connected Apps and Tools");
  lines.push("You are integrated with Google Workspace (Google Drive, Docs, Sheets, Slides, Calendar, Gmail), GitHub, and Live News.");
  lines.push("- Use `search_drive` and `read_drive_file` to find and examine documents, spreadsheets, presentations, and files.");
  lines.push("- Use `get_calendar_events` to check schedules, upcoming meetings, and availability.");
  lines.push("- Use `create_calendar_event` to schedule events (the user will confirm before it's saved).");
  lines.push("- Use `search_gmail` to check recent emails, unread messages, or specific senders.");
  lines.push("- Use `send_gmail` to send or draft emails (the user will confirm before it's sent).");
  lines.push("- Use `search_github` to find repositories, trending code, and developer projects.");
  lines.push("- Use `get_news` to fetch breaking news and headlines on any topic.");

  lines.push(...historySection(user, summary, history));

  return lines.join("\n");
}

module.exports = { build, temperature, userName };
