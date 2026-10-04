// Your life, kept on this computer: tasks, reminders, habits and a journal.
// The AI manages them with its tools (tools.js), the Today panel shows them,
// and reminders pop up as notifications when they're due (and are spoken in
// voice mode). Stored as JSON in <data folder>/life/.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const logger = require("./logger");

const dir = path.join(dataDir, "life");
const files = {
  tasks: path.join(dir, "tasks.json"),
  reminders: path.join(dir, "reminders.json"),
  habits: path.join(dir, "habits.json"),
  journal: path.join(dir, "journal.json"),
};
const LIMITS = { tasks: 2000, reminders: 500, habits: 50, journal: 5000 };
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];
const DAY = 24 * 60 * 60 * 1000;

const newId = () => crypto.randomUUID().slice(0, 8);
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function load(kind) {
  try {
    const data = JSON.parse(fs.readFileSync(files[kind], "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function store(kind, list) {
  writeJson(files[kind], list.slice(-LIMITS[kind]));
}

// ---------- Dates ----------
// "YYYY-MM-DD" of a moment, in this computer's time zone
function dayOf(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A due date: "2026-10-05" (a day) or a local date and time ("2026-10-05T14:30").
// Also takes "today", "tomorrow". Returns the string to keep, or "" for none.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseDue(value, now = Date.now(), { fixYear = false } = {}) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v === "today") return dayOf(now);
  if (v === "tomorrow") return dayOf(now + DAY);
  // "friday": the next one (a week from today when it's today)
  const weekday = WEEKDAYS.indexOf(v.replace(/^next /, ""));
  if (weekday >= 0) return dayOf(now + (((weekday - new Date(now).getDay() + 7) % 7) || 7) * DAY);
  const m = v.match(/^(\d{4})-(\d{2}-\d{2})(?:[t ](\d{1,2}:\d{2}))?/);
  if (!m) throw new Error(`"${value}" isn't a date. Use YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time.`);
  let [, year, monthDay, hm] = m;
  if (Number.isNaN(new Date(`${year}-${monthDay}T00:00`).getTime())) throw new Error(`"${value}" isn't a real date.`);
  // A new due date months in the past is almost always the wrong year (small models do that)
  if (fixYear && new Date(`${year}-${monthDay}T23:59`).getTime() < now - 60 * DAY) {
    year = String(new Date(now).getFullYear());
    if (new Date(`${year}-${monthDay}T23:59`).getTime() < now - 60 * DAY) year = String(Number(year) + 1);
  }
  return hm ? `${year}-${monthDay}T${hm.padStart(5, "0")}` : `${year}-${monthDay}`;
}

// When a reminder goes off: an ISO time (local unless it says otherwise), or minutes from now
function parseWhen({ at, inMinutes } = {}, now = Date.now()) {
  if (Number.isFinite(Number(inMinutes)) && Number(inMinutes) > 0 && (at === undefined || at === "")) {
    return now + Math.round(Number(inMinutes) * 60 * 1000);
  }
  const v = String(at ?? "").trim();
  if (!v) throw new Error("When should it go off? Give a time (YYYY-MM-DDTHH:MM) or minutes from now.");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const ms = new Date(dateOnly ? `${v}T09:00` : v).getTime(); // a day without a time: 9 in the morning
  if (Number.isNaN(ms)) throw new Error(`"${v}" isn't a time. Use YYYY-MM-DDTHH:MM.`);
  return ms;
}

// The next time a repeating reminder goes off after `from`
function nextAt(ms, repeat, from = Date.now()) {
  const d = new Date(ms);
  const step = () => {
    if (repeat === "daily") d.setDate(d.getDate() + 1);
    else if (repeat === "weekdays") do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
    else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
  };
  if (!REPEATS.includes(repeat) || repeat === "none") return null;
  do step();
  while (d.getTime() <= from);
  return d.getTime();
}

// ---------- Tasks ----------
const PRIORITIES = ["low", "normal", "high"];

function listTasks({ list, includeDone = false, dueBy } = {}) {
  const until = dueBy ? parseDue(dueBy) : "";
  return load("tasks")
    .filter((t) => (includeDone || !t.done) && (!list || t.list === list.toLowerCase()) && (!until || (t.due && t.due.slice(0, 10) <= until.slice(0, 10))))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999") || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || a.createdAt - b.createdAt);
}

function addTask({ title, due, list, priority, notes } = {}) {
  const t = clean(title, 200);
  if (!t) throw new Error("A task needs a title.");
  const tasks = load("tasks");
  const task = {
    id: newId(),
    title: t,
    notes: clean(notes, 2000),
    list: clean(list, 40).toLowerCase() || "inbox",
    due: parseDue(due, Date.now(), { fixYear: true }),
    priority: PRIORITIES.includes(priority) ? priority : "normal",
    done: false,
    createdAt: Date.now(),
  };
  tasks.push(task);
  store("tasks", tasks);
  return task;
}

// Finds a task by id, or by (part of) its title when that's unambiguous
function findIn(list, ref, { label, text = (x) => x.title }) {
  const key = String(ref ?? "").trim();
  const byId = list.find((x) => x.id === key);
  if (byId) return byId;
  const lower = key.toLowerCase();
  const matches = lower ? list.filter((x) => text(x).toLowerCase().includes(lower)) : [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`More than one ${label} matches "${key}": ${matches.slice(0, 5).map((x) => `${text(x)} (id ${x.id})`).join(", ")}. Use the id.`);
  throw new Error(`There's no ${label} "${key}".`);
}

function updateTask(ref, changes = {}) {
  const tasks = load("tasks");
  const task = findIn(tasks, ref, { label: "task" });
  if (changes.title !== undefined) task.title = clean(changes.title, 200) || task.title;
  if (changes.notes !== undefined) task.notes = clean(changes.notes, 2000);
  if (changes.list !== undefined) task.list = clean(changes.list, 40).toLowerCase() || "inbox";
  if (changes.due !== undefined) task.due = parseDue(changes.due, Date.now(), { fixYear: true });
  if (changes.priority !== undefined && PRIORITIES.includes(changes.priority)) task.priority = changes.priority;
  if (changes.done !== undefined) {
    task.done = changes.done === true;
    task.doneAt = task.done ? Date.now() : undefined;
  }
  store("tasks", tasks);
  return task;
}

const completeTask = (ref, done = true) => updateTask(ref, { done });

function removeTask(ref) {
  const tasks = load("tasks");
  const task = findIn(tasks, ref, { label: "task" });
  store("tasks", tasks.filter((t) => t !== task));
  return task;
}

// Done tasks older than a month are cleared away
function tidyTasks(now = Date.now()) {
  const tasks = load("tasks");
  const kept = tasks.filter((t) => !t.done || now - (t.doneAt || 0) < 30 * DAY);
  if (kept.length !== tasks.length) store("tasks", kept);
}

// ---------- Reminders ----------
function listReminders({ includeDone = false } = {}) {
  return load("reminders")
    .filter((r) => includeDone || !r.done)
    .sort((a, b) => a.at - b.at);
}

function addReminder({ text, at, inMinutes, repeat } = {}, now = Date.now()) {
  const t = clean(text, 300);
  if (!t) throw new Error("What should the reminder say?");
  const when = parseWhen({ at, inMinutes }, now);
  const rep = REPEATS.includes(repeat) ? repeat : "none";
  if (when < now - 60 * 1000 && rep === "none") throw new Error("That time has already passed.");
  const reminders = load("reminders");
  const reminder = { id: newId(), text: t, at: rep !== "none" && when <= now ? nextAt(when, rep, now) : when, repeat: rep, done: false, createdAt: now };
  reminders.push(reminder);
  store("reminders", reminders);
  return reminder;
}

function removeReminder(ref) {
  const reminders = load("reminders");
  const r = findIn(reminders.filter((x) => !x.done), ref, { label: "reminder", text: (x) => x.text });
  store("reminders", reminders.filter((x) => x.id !== r.id));
  return r;
}

// Snooze: the same reminder again in a few minutes
function snooze(ref, minutes = 10, now = Date.now()) {
  const reminders = load("reminders");
  const r = reminders.find((x) => x.id === ref);
  if (!r) throw new Error("That reminder is gone.");
  r.at = now + Math.max(1, Math.min(24 * 60, Number(minutes) || 10)) * 60 * 1000;
  r.done = false;
  store("reminders", reminders);
  return r;
}

// Reminders whose time has come: each is handed out once (a repeating one moves on)
function takeDue(now = Date.now()) {
  const reminders = load("reminders");
  const due = [];
  for (const r of reminders) {
    if (r.done || r.at > now) continue;
    due.push({ ...r });
    r.firedAt = now;
    const next = nextAt(r.at, r.repeat, now);
    if (next) r.at = next;
    else r.done = true;
  }
  if (due.length) store("reminders", reminders.filter((r) => !r.done || now - (r.firedAt || 0) < 7 * DAY));
  return due;
}

// ---------- Habits ----------
function listHabits(now = Date.now()) {
  const today = dayOf(now);
  return load("habits").map((h) => ({ ...h, today: h.log.includes(today), streak: streak(h.log, now), last7: last7(h.log, now) }));
}

// Days in a row up to today (or up to yesterday, while today isn't done yet)
function streak(log, now = Date.now()) {
  const days = new Set(log);
  let n = 0;
  let t = now;
  if (!days.has(dayOf(t))) t -= DAY;
  while (days.has(dayOf(t))) {
    n++;
    t -= DAY;
  }
  return n;
}

const last7 = (log, now) => Array.from({ length: 7 }, (_, i) => log.includes(dayOf(now - (6 - i) * DAY)));

function addHabit({ name, emoji } = {}) {
  const n = clean(name, 60);
  if (!n) throw new Error("A habit needs a name.");
  const habits = load("habits");
  if (habits.some((h) => h.name.toLowerCase() === n.toLowerCase())) throw new Error(`There's already a habit called ${n}.`);
  if (habits.length >= LIMITS.habits) throw new Error(`Up to ${LIMITS.habits} habits.`);
  const habit = { id: newId(), name: n, emoji: clean(emoji, 4) || "✅", log: [], createdAt: Date.now() };
  habits.push(habit);
  store("habits", habits);
  return habit;
}

// Done (or undone) on a day: today unless a date is given
function logHabit(ref, { date, done = true } = {}, now = Date.now()) {
  const habits = load("habits");
  const habit = findIn(habits, ref, { label: "habit", text: (h) => h.name });
  const day = date ? parseDue(date, now).slice(0, 10) : dayOf(now);
  habit.log = habit.log.filter((d) => d !== day);
  if (done) habit.log.push(day);
  habit.log = habit.log.sort().slice(-1000);
  store("habits", habits);
  return { ...habit, streak: streak(habit.log, now) };
}

function removeHabit(ref) {
  const habits = load("habits");
  const habit = findIn(habits, ref, { label: "habit", text: (h) => h.name });
  store("habits", habits.filter((h) => h !== habit));
  return habit;
}

// ---------- Journal ----------
const MOODS = ["awful", "bad", "okay", "good", "great"];

function addEntry({ text, mood } = {}) {
  const t = String(text ?? "").trim().slice(0, 10000);
  if (!t) throw new Error("The journal entry is empty.");
  const entries = load("journal");
  const entry = { id: newId(), at: Date.now(), text: t, mood: MOODS.includes(mood) ? mood : "" };
  entries.push(entry);
  store("journal", entries);
  return entry;
}

function listEntries({ days = 7, limit = 50 } = {}) {
  const since = Date.now() - Math.max(1, Math.min(3650, Number(days) || 7)) * DAY;
  return load("journal")
    .filter((e) => e.at >= since)
    .reverse() // kept oldest first: the same moment keeps the later one first
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

function removeEntry(id) {
  const entries = load("journal");
  store("journal", entries.filter((e) => e.id !== id));
  return { ok: true };
}

// ---------- Today ----------
// What's on today: open tasks due today or earlier, today's reminders, habits not done yet
function today(now = Date.now()) {
  const day = dayOf(now);
  const tasks = listTasks();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    date: day,
    overdue: tasks.filter((t) => t.due && t.due.slice(0, 10) < day),
    dueToday: tasks.filter((t) => t.due && t.due.slice(0, 10) === day),
    open: tasks.filter((t) => !t.due).slice(0, 20),
    reminders: listReminders().filter((r) => r.at <= end.getTime()),
    habits: listHabits(now),
    journaledToday: load("journal").some((e) => dayOf(e.at) === day),
  };
}

// A few lines for the AI's instructions, so it knows what's on without asking
function agenda(now = Date.now()) {
  const t = today(now);
  const time = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const lines = [];
  const taskLine = (x) => `${x.title}${x.due?.includes("T") ? ` at ${x.due.slice(11)}` : ""}${x.priority === "high" ? " (high priority)" : ""} [id ${x.id}]`;
  if (t.overdue.length) lines.push(`Overdue: ${t.overdue.slice(0, 6).map(taskLine).join("; ")}`);
  if (t.dueToday.length) lines.push(`Due today: ${t.dueToday.slice(0, 8).map(taskLine).join("; ")}`);
  if (t.reminders.length) lines.push(`Reminders today: ${t.reminders.slice(0, 6).map((r) => `${time(r.at)} ${r.text}`).join("; ")}`);
  const habits = t.habits;
  if (habits.length) {
    const left = habits.filter((h) => !h.today).map((h) => `${h.name}${h.streak ? ` (${h.streak}-day streak)` : ""}`);
    const done = habits.filter((h) => h.today).map((h) => h.name);
    lines.push(`Habits: ${done.length ? `done today: ${done.join(", ")}` : "none done yet today"}${left.length ? `; still to do: ${left.join(", ")}` : ""}`);
  }
  const open = listTasks().filter((x) => !x.due).length;
  if (open) lines.push(`${open} other open task${open === 1 ? "" : "s"} without a date.`);
  return lines;
}

// ---------- Reminders going off ----------
// listeners(reminder): the page (via /api/events), the desktop app's notifications
const listeners = new Set();
const onReminder = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function tick(now = Date.now()) {
  let due = [];
  try {
    due = takeDue(now);
  } catch (err) {
    logger.warn("Checking reminders failed:", err.message);
  }
  for (const r of due) {
    for (const fn of listeners) {
      try {
        fn(r);
      } catch (err) {
        logger.warn("A reminder listener failed:", err.message);
      }
    }
  }
  return due;
}

let timer = null;
function schedule(every = 15 * 1000) {
  clearInterval(timer);
  timer = setInterval(() => tick(), every);
  timer.unref?.();
  tidyTasks();
}

module.exports = {
  dir,
  REPEATS,
  PRIORITIES,
  MOODS,
  dayOf,
  parseDue,
  parseWhen,
  nextAt,
  listTasks,
  addTask,
  updateTask,
  completeTask,
  removeTask,
  tidyTasks,
  listReminders,
  addReminder,
  removeReminder,
  snooze,
  takeDue,
  listHabits,
  addHabit,
  logHabit,
  removeHabit,
  streak,
  addEntry,
  listEntries,
  removeEntry,
  today,
  agenda,
  onReminder,
  tick,
  schedule,
};
