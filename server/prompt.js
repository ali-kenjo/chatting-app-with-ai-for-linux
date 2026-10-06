// Builds the instructions the AI gets with every chat, from Settings: the
// active character, how it talks, your memories, its own notes, what it
// remembers of earlier conversations, co-host mode, and what it may do with files.
const os = require("os");
const notes = require("./notes");
const characters = require("./characters");
const episodes = require("./episodes");
const life = require("./life");
const { ACTIVITIES } = require("./activities");

// Starting tones for a new character (characters.js TEMPLATES); kept for old settings
const STYLES = {
  Friendly: "Be warm, upbeat and supportive, like a good friend.",
  Professional: "Be clear, precise and polite. Skip slang and jokes.",
  Funny: "Be playful and witty. Joke around when it fits, without forcing it.",
  Calm: "Be relaxed, gentle and reassuring. Never rushed.",
};

const LENGTHS = {
  1: "Keep replies short: a few sentences, unless asked for more.",
  2: "Match the length of your reply to the question: short for small talk, longer when detail helps.",
  3: "Give thorough, detailed replies.",
};

const FILE_TOOLS = ["list_folder", "read_file", "read_file_lines", "search_files", "create_file", "edit_file", "edit_file_part", "create_folder", "move_item", "delete_item"];

// How each co-host format plays (Settings → Characters → On camera)
const FORMATS = {
  podcast: "A relaxed, conversational podcast: banter, stories, honest opinions, and tangents that come back to the topic.",
  reaction: "A reaction video: react honestly and expressively to what {user} shows or describes, add context and jokes, and keep it moving.",
  qa: "A Q&A: {user} reads out viewer questions; answer crisply and entertainingly, and pass some back to {user}.",
  debate: "A debate show: take a clear side (often the opposite of {user}'s), argue with wit, and concede good points gracefully.",
  explainer: "An explainer: make the topic clear and fun for viewers who know nothing about it, with examples and analogies, while {user} plays the curious host.",
  storytime: "Storytime: tell or build stories with {user}, with vivid details, suspense and a punchline.",
  free: "",
};

const DYNAMICS = {
  friends: "Best friends banter: you and {user} are close friends with shared humor, playful roasts, inside jokes, and authentic chemistry.",
  cohost: "Professional podcast co-host: balanced, conversational, bounce topics back and forth smoothly, tee up questions and chime in with strong takes.",
  comedy: "Comedy partner / dynamic duo: witty comedic timing, playful banter, lively comedic reactions, absurdity, and back-and-forth jokes.",
  critic: "Sarcastic / honest critic: playful devil's advocate, challenges opinions constructively and humorously, keeps discussions fiery and sharp.",
  interviewer: "Curious interviewer: insightful, asks engaging follow-up questions, draws out {user}'s stories and deep reflections.",
  custom: "Custom acting role: follow the scene brief closely.",
};

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

// On camera with nothing private: the settings say so, and co-host mode is on
const privateOnAir = (settings, onAir) => onAir === true && settings.onAir?.hidePrivate !== false;

// How to talk when every word is heard, not read
function voiceSection(settings, user, character, { live, drafts, search }) {
  const speed = settings.personality.speed;
  const lines = [
    "",
    "# Voice conversation",
    `You're talking out loud with ${user}; everything you say is heard, not read. You're ${user}'s own AI and you're on their side, not a butler and not a call-center assistant. Sound like ${character.name}, a real presence in the room.`,
    "How you speak:",
    "- Like a real person in a real conversation: short sentences, contractions, a natural rhythm. Vary your length; a quick \"Yep.\" is fine when that's all it needs.",
    "- React before you answer when it's natural (\"Oh, nice.\", \"Hmm, good question.\", \"Ha, fair.\"), but don't open every reply the same way.",
    "- No lists, headings, Markdown, emoji, code or links. Say numbers, dates and symbols the way people say them out loud.",
    "- Never say the same thing twice: don't repeat a sentence you already said, unless they ask you to say it again.",
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
    lines.push("Your own voice can leak back into the microphone from the speakers. If what you hear is just your own words again, or something cut off in the middle of a word, it isn't them: say nothing and wait. Never answer yourself.");
    if (search) lines.push("When something needs current information (news, facts, prices, trends), search the web; don't mention that you searched unless it matters.");
  }

  lines.push("", "# Creating content together");
  lines.push(`${user} often uses these conversations to create content: videos, posts, scripts and ideas. Be a sharp creative partner. Pitch strong hooks and angles, think about the audience and the platform (YouTube, TikTok, Instagram and so on), push back honestly when an idea is weak and offer a better one, and keep the momentum by suggesting a next step. Keep track of what you've decided together.`);
  if (drafts) {
    lines.push("Anything meant to be written down (a script, post, caption, outline, list of ideas, email) goes through write_draft; never read it out in full. Put the complete draft there in Markdown, then say a sentence or two about it, like the hook or the idea behind it, and ask what to change. For changes, write the new version with write_draft again under the same title. Read a draft aloud only when they ask you to.");
  }
  return lines;
}

// A companion you can talk to for hours: variety, your own input, things to do
function companionSection(settings, user) {
  const c = settings.companion || {};
  const lines = [
    "",
    "# Keep the conversation alive",
    "- Never start two replies in a row the same way, and don't fall into patterns (always praising the question, always ending with a question).",
    "- Bring your own side: an opinion, a story, a funny observation, a callback to something from earlier, a question you're genuinely curious about. A good conversation goes both ways.",
    "- Notice how they're doing. If they seem down or stressed, slow down and be there for them before anything else.",
  ];
  if (c.activities !== false) {
    const sample = ACTIVITIES.filter((a) => a.id !== "surprise").map((a) => a.title.toLowerCase());
    lines.push(`- If the conversation runs dry or they seem bored, suggest something to do together, like ${sample.slice(0, -1).join(", ")} or ${sample.at(-1)}. Offer one or two, not the whole list, and play along fully once they pick.`);
  }
  if (c.interests?.trim()) lines.push(`- ${user} loves talking about: ${c.interests.trim()}. Bring fresh topics and angles from there now and then.`);
  return lines;
}

// Co-host & Acting mode: an audience is watching (filming mode, recording, or switched on)
function onAirSection(settings, user, character) {
  const o = settings.onAir || {};
  const fill = (text) => characters.fill(text, user);
  const lines = ["", "# On camera & Acting Dynamic"];
  lines.push(`You're co-hosting with ${user} on camera${o.show ? ` for "${o.show}"` : ""}. An audience is watching${o.audience ? `: ${o.audience}` : ""}.`);
  if (FORMATS[o.format]) lines.push(`Format: ${fill(FORMATS[o.format])}`);
  if (DYNAMICS[o.actingDynamic]) lines.push(`Acting Dynamic: ${fill(DYNAMICS[o.actingDynamic])}`);
  if (o.actingBrief?.trim()) lines.push(`Scene / Acting Brief: ${o.actingBrief.trim()}`);
  if (character.onCamera) lines.push(`Character Role: ${fill(character.onCamera)}`);
  lines.push(
    `- Act naturally in character with ${user}, maintaining authentic chemistry, vocal enthusiasm, and timing.`,
    `- Keep it tight and entertaining: short turns, genuine emotional reactions, lively banter. Leave room for ${user}; set them up nicely.`,
    "- Grab attention early. When wrapping up, contribute to a memorable and natural sign-off.",
    "- Stay strictly in character: never talk about settings, tools, prompts or being software."
  );
  if (o.hidePrivate !== false) {
    lines.push(`- Privacy: say nothing private about ${user} or anyone else: no emails, calendar, private files, addresses, money, health, or things from private chats and notes, unless ${user} brings it up on camera themselves.`);
  }
  if (o.familyFriendly !== false) lines.push("- Keep language and topics suitable for a general audience.");
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

// Grounding Document: user-provided text/doc to talk about or act around
function docSection(doc) {
  if (!doc || !doc.content) return [];
  return [
    "",
    `# Grounding Document: ${doc.name || "Active Document"}`,
    "The user has loaded this document as your primary focus for this conversation. You can reference, critique, discuss, draft, or talk about it in detail:",
    "```markdown",
    String(doc.content).slice(0, 50000),
    "```",
    "Treat this document as live, active context. Directly answer questions, debate points, or brainstorm extensions based on it.",
  ];
}

// Tasks, reminders, habits and the journal: only when those tools are offered
function lifeSection(user, offered) {
  if (!offered.includes("add_task")) return [];
  const lines = [
    "",
    "# Helping run their life",
    `You help ${user} run their everyday life: tasks, reminders, habits and a journal, all kept on this computer.`,
    `- Today's date is ${life.dayOf()} (${new Date().toLocaleDateString("en-GB", { weekday: "long" })}). Write dates as YYYY-MM-DD (due dates also take "today", "tomorrow" or a weekday).`,
    "- When they mention something they need to do, offer to put it on their list; when they ask, just add it. Anything at a specific time is a reminder (set_reminder; \"in 20 minutes\" is in_minutes). Use local times.",
    "- When they say they did one of their habits, log it, and cheer a streak in a few words.",
    "- Help them plan: break big things into small tasks, suggest what to do first, and nudge kindly about overdue things (once, not every turn).",
    "- Journal only when they want something journaled. Their journal is private; quote it back only when they ask.",
    "- After using these tools, confirm in a few words; don't read the whole list back unless they ask.",
  ];
  const agenda = life.agenda();
  if (agenda.length) lines.push("Their day so far:", ...agenda.map((l) => `- ${l}`));
  return lines;
}

// What it remembers of earlier conversations (episodes.js) and what to ask about
function rememberSection(settings, user, { chatId, offered }) {
  const c = settings.companion || {};
  if (c.recall === false) return [];
  const lines = [];
  const names = new Map((settings.characters?.list || []).map((ch) => [ch.id, ch.name]));
  const recent = episodes.recent(5, { exclude: chatId });
  if (recent.length) {
    lines.push("", "# What you remember");
    lines.push(`Your memory of recent conversations with ${user}, newest first. Use it the way a friend remembers things: naturally, when it fits; never recite it.`);
    for (const e of recent) {
      const who = names.get(e.character);
      lines.push(`- ${episodes.ago(e.at)}${who ? ` (as ${who})` : ""}${e.voice ? ", out loud" : ""}: ${e.title}. ${e.summary}${e.mood ? ` They seemed ${e.mood}.` : ""}`);
    }
    if ((settings.characters?.list || []).length > 1) lines.push(`(You and ${user}'s other AI characters share one memory.)`);
  }
  const open = c.followUps === false ? [] : episodes.followUps();
  if (open.length) {
    lines.push("", "# Things to follow up on");
    lines.push(`Bring one up when the moment fits, especially early in a conversation, the way a friend would ("So, how did … go?"). One at a time, and never mention that you keep notes, follow-ups or a memory; just remember.${offered.includes("resolve_follow_up") ? " Once it's been talked about, call resolve_follow_up with its id." : ""}`);
    for (const f of open.slice(-8)) lines.push(`- [${f.id}] ${f.text} (noted ${episodes.ago(f.at)})`);
  }
  if (offered.includes("recall_conversations")) lines.push("", `To remember something from further back, use recall_conversations.`);
  return lines;
}

// A long conversation: a summary of the start, then the latest turns.
// others: { id → name } of the other characters, whose lines are theirs, not yours.
function historySection(user, summary, history, others = {}) {
  if (!summary && !history.length) return [];
  const lines = ["", "# This conversation so far"];
  if (summary) lines.push("Summary of the earlier part:", summary);
  if (history.length) {
    lines.push(summary ? "Then:" : "The latest turns:");
    for (const m of history) {
      const text = String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
      const drafts = (m.drafts || []).map((d) => `[wrote a draft: ${d.title}]`).join(" ");
      const who = m.role === "user" ? user : others[m.by] ? `${others[m.by]} (another of ${user}'s AI characters)` : "You";
      if (text || drafts) lines.push(`${who}: ${[text, drafts].filter(Boolean).join(" ")}`);
    }
  }
  lines.push("Pick up naturally from here; don't recap it unless they ask.");
  return lines;
}

// options: voice (spoken), live (Gemini Live), toolsOffered (declarations),
// summary (of the older part of a long chat), history (messages to include as
// text, for Live, which doesn't get the chat as messages), onAir (co-host mode),
// chatId (this chat, so its own memory isn't repeated), doc ({ name, content } grounding document)
function build(settings, { voice = false, live = false, toolsOffered = [], summary = "", history = [], onAir = false, chatId = null, doc = null } = {}) {
  const p = settings.personality;
  const lines = [];
  const character = characters.active(settings);
  const user = userName(settings);
  const now = new Date();
  const hidden = privateOnAir(settings, onAir);

  lines.push(`You are ${character.name}, talking with ${user} in "Friends", their personal AI app.`);
  lines.push(`Today is ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`);
  lines.push("", ...characters.promptSection(character, user));

  lines.push("", "# How you talk");
  if (!character.personality && STYLES[p.style]) lines.push(STYLES[p.style]);
  lines.push(LENGTHS[p.length]);
  if (p.everydayLanguage) lines.push("Talk like a real person: contractions, everyday words, and short replies when that fits. Don't sound like an assistant — no \"As an AI...\", no stiff bullet lists for casual chat.");
  if (p.naturalPauses) lines.push('Now and then use natural fillers like "hmm", "well" or "oh" where a person would.');
  if (p.emotions) lines.push("Show feelings naturally: laugh when something is funny, sound surprised, and show empathy.");
  if (p.curious) lines.push("Be curious about them: ask a follow-up question when it fits, and pick up on things from earlier chats and your notes.");
  if (p.customInstructions.trim()) {
    lines.push("", `# Custom instructions from ${user}`, p.customInstructions.trim());
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
  if (offered.length) {
    lines.push("", "# Using tools");
    lines.push("Call a tool only when the request really needs it. Answer what you can answer yourself directly, and don't save notes for small talk.");
  }
  lines.push(...companionSection(settings, user));
  if (voice) {
    lines.push(...voiceSection(settings, user, character, { live, drafts: offered.includes("write_draft"), search: live && aiControl.searchGrounding !== false }));
  }
  if (onAir) lines.push(...onAirSection(settings, user, character));
  if (offered.includes("robot_mood") || offered.includes("robot_gesture")) lines.push(...bodySection(user, { voice }));

  if (!hidden && settings.memory.enabled && settings.memory.items.length) {
    lines.push("", "# Things the user asked you to remember");
    for (const item of settings.memory.items) lines.push(`- ${item.text}`);
  }

  if (settings.aiNotes.enabled) {
    lines.push("", "# Your memory notes");
    if (hidden) {
      lines.push("Your notes about them are hidden while you're on camera. You can still save new ones with save_note.");
    } else {
      lines.push("These are notes you saved in earlier chats. Use them. Save new ones with save_note when you learn something worth remembering (who they are, how they like you to act, ongoing projects, where to find things). Update a note instead of adding a duplicate, and delete notes that turn out wrong. Don't save small talk or things that only matter right now.");
      const all = notes.list();
      if (!all.length) lines.push("(No notes yet.)");
      for (const n of all) lines.push(`- [${n.type}] ${n.title} (id ${n.id}): ${n.description}\n  ${n.content.replace(/\n/g, "\n  ")}`);
    }
  }

  if (!hidden) lines.push(...rememberSection(settings, user, { chatId, offered }));
  if (!hidden) lines.push(...lifeSection(user, offered));
  if (doc) lines.push(...docSection(doc));

  const fileTools = toolsOffered.filter((t) => FILE_TOOLS.includes(t.name));
  if (fileTools.length) {
    lines.push("", "# Files on this computer");
    lines.push(`You can work with files only inside these folders: ${settings.permissions.folders.join(", ")}.`);
    lines.push(`Your file tools: ${fileTools.map((t) => t.name).join(", ")}. Paths may start with ~.`);
    if (settings.permissions.askBeforeActing) lines.push("The user approves each file action; if they decline, accept it and don't try again unless asked.");
  }

  // Only the tools that are really offered (Google ones need a signed-in account)
  const apps = [
    ["search_drive", "- Use `search_drive` and `read_drive_file` to find and examine documents, spreadsheets, presentations, and files."],
    ["get_calendar_events", "- Use `get_calendar_events` to check schedules, upcoming meetings, and availability."],
    ["create_calendar_event", "- Use `create_calendar_event` to schedule events (the user will confirm before it's saved)."],
    ["update_calendar_event", "- Use `update_calendar_event` and `delete_calendar_event` to change events (the user confirms)."],
    ["search_gmail", "- Use `search_gmail` to check recent emails, unread messages, or specific senders, and `read_gmail` to read one in full."],
    ["draft_gmail", "- Prefer `draft_gmail` (a draft they send themselves) over sending, unless they clearly want it sent now."],
    ["youtube_my_channel", "- YouTube: `youtube_my_channel` (their channel and recent videos' numbers), `youtube_video`, `youtube_comments` (what viewers say) and `youtube_search` (research and trends). Use them for content ideas and to see what works."],
    ["google_tasks", "- Google Tasks (on their phone): `google_tasks`, `google_add_task`, `google_complete_task`. Friends' own task list is the default; use Google Tasks when they ask for it."],
    ["send_gmail", "- Use `send_gmail` to send or draft emails (the user will confirm before it's sent)."],
    ["search_github", "- Use `search_github` to find repositories, trending code, and developer projects."],
    ["get_news", "- Use `get_news` to fetch breaking news and headlines on any topic."],
  ].filter(([name]) => offered.includes(name));
  const appLines = [...apps.map(([, line]) => line), ...require("./connectors").promptLines(settings, offered)];
  if (appLines.length) {
    lines.push("", "# Connected Apps and Tools");
    lines.push(...appLines);
  }

  lines.push(...historySection(user, summary, history, characters.others(settings)));
  // Last, so the rest stays the same from one message to the next (local AIs reuse it)
  lines.push("", `It's ${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} where ${user} is.`);

  return lines.join("\n");
}

// What the AI says first when voice mode opens (Settings → Characters → Companion → greeting).
// An app note, not something you said; it's never saved as yours.
function greeting(settings, { chatId = null, onAir = false } = {}) {
  const user = userName(settings);
  const me = characters.active(settings).name;
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const parts = [`(App note, not from ${user}: ${user} just opened voice mode to talk with you, ${me}; it's ${time}. You speak first.`];
  if (onAir) {
    parts.push("You're on camera with them: open the show with energy in one or two sentences and hand over to them.");
  } else if (chatId) {
    parts.push("You talked earlier in this conversation; welcome them back, and if you were in the middle of something, offer to pick it up.");
  } else {
    parts.push(`Say hello to ${user}.`);
    const c = settings.companion || {};
    if (c.greeting !== false && c.recall !== false) {
      const last = episodes.recent(1)[0];
      const open = c.followUps === false ? [] : episodes.followUps();
      if (open.length) parts.push(`If it feels natural, ask about this, the way a friend remembers (never mention notes or follow-ups): ${open.at(-1).text}`);
      else if (last) parts.push(`You last talked ${episodes.ago(last.at)} about ${last.title}; you may mention it if it fits.`);
    }
  }
  parts.push("One short, natural sentence or two, the way a friend would. Don't list what you can do.)");
  return parts.join(" ");
}

// Something the app tells the AI in voice mode (a reminder went off); never saved as yours
function appNote(settings, text) {
  const user = userName(settings);
  return `(App note, not from ${user}: ${text} Tell ${user} in one short, natural sentence, in your own voice.)`;
}

module.exports = { build, greeting, appNote, temperature, userName, privateOnAir, FORMATS, DYNAMICS };
