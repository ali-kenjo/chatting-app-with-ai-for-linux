// The daily briefing as a chat: the active character writes it from what's on
// today (tools.briefing: tasks, reminders, habits, follow-ups, and when
// connected calendar, weather and headlines). Made when you ask (the Today
// panel) and, when it's on, every morning at the time you set
// (Settings → Characters → Daily life), waiting for you as a new chat.
const brains = require("./brains");
const chats = require("./chats");
const settings = require("./settings");
const characters = require("./characters");
const prompt = require("./prompt");
const tools = require("./tools");
const life = require("./life");
const logger = require("./logger");

async function make({ googleAccessToken = null } = {}) {
  const current = settings.get();
  const brain = brains.forTask();
  if (!brain) throw new Error("NO_BRAIN");
  if (!googleAccessToken && !current.privacy.localOnly) googleAccessToken = await require("./google").token().catch(() => null);
  const data = await tools.briefing({ settings: current, googleAccessToken });
  const character = characters.active(current);
  const user = prompt.userName(current);
  const text = await brain.api.generateText({
    key: brain.key,
    model: brain.model,
    system: prompt.build(current, {}),
    prompt: [
      `Write ${user}'s daily briefing for ${data.date}, as ${character.name}, in your own voice and style.`,
      "Start with a short greeting that fits the time of day. Then, in short Markdown sections: what's on today (calendar and reminders, in time order), tasks (overdue first, then due today), habits to keep going, and anything else worth knowing (weather, a headline or two, something to follow up on). Skip sections that are empty. End with one encouraging, specific line. Keep it under 250 words.",
      "Use only the data below. Never make up weather, events, free time or news that aren't in it; if something isn't there, leave it out.",
      "",
      "Data (JSON):",
      JSON.stringify(data),
    ].join("\n"),
    temperature: 0.6,
  });
  if (!text) throw new Error("The briefing came back empty.");
  const title = `Briefing · ${new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  const chat = chats.create(title);
  chat.title = title;
  chat.messages.push({ id: require("crypto").randomUUID(), role: "model", text, at: Date.now(), by: current.characters.active, briefing: true });
  chats.save(chat);
  return { chatId: chat.id, title };
}

// Every morning at the set time (once a day, also when the computer wakes up a bit later)
let lastDay = null;
let timer = null;

async function tick(now = Date.now(), notify = () => {}) {
  const s = settings.get().life;
  if (!s?.enabled || !s.briefing?.auto) return null;
  const day = life.dayOf(now);
  const d = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (lastDay === day || hhmm < s.briefing.time) return null;
  // Not again today if one was already made (e.g. before a restart)
  if (chats.list().some((c) => c.title.startsWith("Briefing · ") && life.dayOf(c.updatedAt) === day)) {
    lastDay = day;
    return null;
  }
  lastDay = day;
  try {
    const made = await make();
    notify(made);
    return made;
  } catch (err) {
    logger.warn("The morning briefing failed:", err.message);
    return null;
  }
}

function schedule(notify, every = 60 * 1000) {
  clearInterval(timer);
  timer = setInterval(() => tick(Date.now(), notify).catch(() => {}), every);
  timer.unref?.();
}

module.exports = { make, tick, schedule };
