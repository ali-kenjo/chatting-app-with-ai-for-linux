// ---------- Today: tasks, reminders, habits, journal ----------
// The panel behind "Today" in the sidebar (server/life.js keeps the data; the
// AI changes the same lists with its tools). Also: reminders and the morning
// briefing arriving (/api/events) as a pop-up in the page, a notification when
// the window isn't in view, and spoken by the character in voice mode; and the
// address #today, #voice or #chat/<id> (the desktop app's tray and notifications).
import { api } from "./api.js";
import { getSettings, onSettings } from "./store.js";
import { openChat } from "./chat.js";
import { getAccessToken } from "./auth.js";

const modal = document.getElementById("life-modal");
const badge = document.getElementById("today-badge");
const statusEl = document.getElementById("life-status");
const toasts = document.getElementById("life-toasts");
const REMOVE = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const MOOD_EMOJI = { awful: "😣", bad: "🙁", okay: "😐", good: "🙂", great: "😄" };

let tab = "today";
let nativeNotifications = false; // the desktop app shows them itself
const handlers = { speak: null, voiceOpen: () => false }; // set by voice.js

// voice.js: say(text) speaks an app note in the character's voice
export function setVoiceHooks({ speak, isOpen }) {
  handlers.speak = speak;
  handlers.voiceOpen = isOpen;
}

const say = (text, kind = "") => {
  statusEl.textContent = text;
  statusEl.className = `test-feedback ${kind}`;
};
// "YYYY-MM-DD" in this computer's time zone
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const when = (ms) => new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dueLabel = (due) => {
  if (!due) return "";
  const today = localDay();
  const day = due.slice(0, 10);
  const date = new Date(`${day}T00:00`);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  const label = day === today ? "Today" : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }) });
  return due.includes("T") ? `${label} ${due.slice(11)}` : label;
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function empty(text) {
  return el("li", "memory-empty", text);
}

// ----- Opening -----
export function openToday(which = "today") {
  if (getSettings()?.life?.enabled === false) return;
  modal.hidden = false;
  showTab(which);
}

function closeToday() {
  modal.hidden = true;
  if (location.hash === "#today") history.replaceState(null, "", location.pathname);
}

function showTab(name) {
  tab = name;
  modal.querySelectorAll(".life-tab").forEach((t) => t.classList.toggle("active", t.dataset.lifeTab === name));
  modal.querySelectorAll(".life-pane").forEach((p) => p.classList.toggle("active", p.dataset.lifePane === name));
  refresh();
}

document.getElementById("today-open").addEventListener("click", (e) => {
  e.preventDefault();
  openToday();
});
document.getElementById("life-close").addEventListener("click", closeToday);
modal.addEventListener("click", (e) => e.target === modal && closeToday());
document.addEventListener("keydown", (e) => e.key === "Escape" && !modal.hidden && closeToday());
modal.querySelector(".life-tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".life-tab");
  if (t) showTab(t.dataset.lifeTab);
});

// ----- Drawing -----
function taskItem(t) {
  const li = el("li", `life-item task${t.done ? " done" : ""}${t.priority === "high" ? " high" : ""}`);
  const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: t.done, className: "life-check" });
  check.setAttribute("aria-label", `Done: ${t.title}`);
  check.addEventListener("change", () => act(() => api.life.updateTask(t.id, { done: check.checked })));
  const text = el("span", "life-text");
  text.append(el("span", "life-title", t.title));
  const meta = [dueLabel(t.due), t.list !== "inbox" ? t.list : "", t.priority === "high" ? "high priority" : ""].filter(Boolean).join(" · ");
  if (meta) text.append(el("span", `life-meta${t.due && t.due.slice(0, 10) < localDay() && !t.done ? " overdue" : ""}`, meta));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = "Delete";
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => act(() => api.life.removeTask(t.id)));
  li.append(check, text, remove);
  return li;
}

function reminderItem(r) {
  const li = el("li", "life-item");
  const text = el("span", "life-text");
  text.append(el("span", "life-title", r.text), el("span", "life-meta", `${when(r.at)}${r.repeat !== "none" ? ` · ${r.repeat}` : ""}`));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = "Cancel";
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => act(() => api.life.removeReminder(r.id)));
  li.append(el("span", "life-icon", "⏰"), text, remove);
  return li;
}

function habitCheck(h) {
  const b = el("button", `habit-check${h.today ? " done" : ""}`);
  b.type = "button";
  b.setAttribute("aria-pressed", String(h.today));
  b.title = h.today ? "Done today (click to undo)" : "Mark as done today";
  b.append(el("span", "habit-emoji", h.emoji), el("span", "habit-name", h.name), el("span", "habit-streak", h.streak ? `🔥 ${h.streak}` : ""));
  b.addEventListener("click", () => act(() => api.life.logHabit(h.id, { done: !h.today })));
  return b;
}

function habitItem(h) {
  const li = el("li", "life-item habit");
  const text = el("span", "life-text");
  text.append(el("span", "life-title", `${h.emoji} ${h.name}`), el("span", "life-meta", h.streak ? `${h.streak}-day streak` : "No streak yet"));
  const week = el("span", "habit-week");
  week.title = "The last 7 days";
  h.last7.forEach((d) => week.append(el("i", d ? "on" : "")));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = "Stop tracking";
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "1";
      remove.title = "Click again to stop tracking it";
      remove.classList.add("armed");
      return setTimeout(() => {
        delete remove.dataset.armed;
        remove.classList.remove("armed");
      }, 4000);
    }
    act(() => api.life.removeHabit(h.id));
  });
  li.append(habitCheck(h), week, text, remove);
  return li;
}

function journalItem(e) {
  const li = el("li", "life-item journal");
  const text = el("span", "life-text");
  text.append(el("span", "life-meta", `${when(e.at)}${e.mood ? ` · ${MOOD_EMOJI[e.mood]} ${e.mood}` : ""}`), el("span", "life-entry", e.text));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = "Delete";
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "1";
      remove.classList.add("armed");
      return setTimeout(() => (delete remove.dataset.armed, remove.classList.remove("armed")), 4000);
    }
    act(() => api.life.removeEntry(e.id));
  });
  li.append(text, remove);
  return li;
}

async function refresh() {
  try {
    if (tab === "today" || modal.hidden) {
      const t = await api.life.today();
      updateBadge(t);
      if (modal.hidden) return;
      document.getElementById("life-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      const tasks = [...t.overdue, ...t.dueToday];
      document.getElementById("life-today-tasks").replaceChildren(...(tasks.length ? tasks.map(taskItem) : [empty(t.open.length ? `Nothing due today. ${t.open.length} open task${t.open.length === 1 ? "" : "s"} without a date.` : "Nothing due today.")]));
      document.getElementById("life-today-reminders").replaceChildren(...(t.reminders.length ? t.reminders.map(reminderItem) : [empty("No more reminders today.")]));
      const habits = document.getElementById("life-today-habits");
      habits.replaceChildren(...(t.habits.length ? t.habits.map(habitCheck) : [el("span", "row-desc", "No habits yet. Add one under Habits, or tell your AI.")]));
    } else if (tab === "tasks") {
      const all = await api.life.tasks(document.getElementById("tasks-show-done").checked);
      const groups = new Map();
      for (const t of all) groups.set(t.list, [...(groups.get(t.list) || []), t]);
      const box = document.getElementById("task-groups");
      box.replaceChildren();
      if (!all.length) box.append(el("p", "row-desc", "No tasks. Add one above, or just tell your AI what you need to do."));
      for (const [name, tasks] of groups) {
        box.append(el("div", "life-section-title", name === "inbox" ? "Inbox" : name));
        const ul = el("ul", "life-list");
        ul.append(...tasks.map(taskItem));
        box.append(ul);
      }
      document.getElementById("task-lists").replaceChildren(...[...groups.keys()].map((n) => Object.assign(document.createElement("option"), { value: n })));
    } else if (tab === "reminders") {
      const list = await api.life.reminders();
      document.getElementById("reminder-list").replaceChildren(...(list.length ? list.map(reminderItem) : [empty("No reminders. Add one above, or say \"remind me in 20 minutes to…\".")]));
    } else if (tab === "habits") {
      const list = await api.life.habits();
      document.getElementById("habit-list").replaceChildren(...(list.length ? list.map(habitItem) : [empty("No habits yet.")]));
    } else if (tab === "journal") {
      const list = await api.life.journal(90);
      document.getElementById("journal-list").replaceChildren(...(list.length ? list.map(journalItem) : [empty("No entries in the last 90 days.")]));
    }
  } catch (err) {
    say(err.message, "error");
  }
}

function updateBadge(t) {
  const count = t.overdue.length + t.dueToday.length;
  badge.hidden = !count;
  badge.textContent = count;
  badge.classList.toggle("overdue", t.overdue.length > 0);
}

async function act(fn) {
  try {
    await fn();
    say("");
  } catch (err) {
    say(err.message, "error");
  }
  refresh();
}

// ----- Adding -----
document.getElementById("task-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  act(() => api.life.addTask({ title: f.title.value, due: f.due.value, list: f.list.value })).then(() => {
    f.title.value = "";
    f.title.focus();
  });
});
document.getElementById("tasks-show-done").addEventListener("change", refresh);

document.getElementById("reminder-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  act(() => api.life.addReminder({ text: f.text.value, at: f.at.value, repeat: f.repeat.value })).then(() => {
    f.text.value = "";
    askForNotifications();
  });
});

document.getElementById("habit-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  act(() => api.life.addHabit({ name: f.name.value, emoji: f.emoji.value })).then(() => {
    f.name.value = "";
    f.emoji.value = "";
  });
});

document.getElementById("journal-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.text.value.trim()) return;
  act(() => api.life.addEntry({ text: f.text.value, mood: f.mood.value })).then(() => {
    f.text.value = "";
    f.mood.value = "";
  });
});

// Today's quick line: a mood and a sentence
let quickMood = "";
const quick = document.getElementById("life-journal-quick");
quick.querySelector(".mood-pick").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mood]");
  if (!b) return;
  quickMood = quickMood === b.dataset.mood ? "" : b.dataset.mood;
  quick.querySelectorAll(".mood-pick button").forEach((x) => x.classList.toggle("selected", x.dataset.mood === quickMood));
});
quick.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = quick.text.value.trim() || (quickMood ? `Feeling ${quickMood}.` : "");
  if (!text) return;
  act(() => api.life.addEntry({ text, mood: quickMood })).then(() => {
    quick.text.value = "";
    quickMood = "";
    quick.querySelectorAll(".mood-pick button").forEach((x) => x.classList.remove("selected"));
    say("Saved in your journal.", "ok");
  });
});

document.getElementById("life-briefing").addEventListener("click", async () => {
  say("Putting your briefing together…");
  try {
    const made = await api.life.briefing(getAccessToken());
    closeToday();
    openChat(made.chatId, { force: true });
    document.dispatchEvent(new CustomEvent("friends:chats-changed"));
  } catch (err) {
    say(err.message === "NO_BRAIN" ? "Add an AI brain first (Settings → AI control)." : err.message, "error");
  }
});

// ----- Notifications -----
const allowButton = document.getElementById("life-notify-allow");

function askForNotifications() {
  if (nativeNotifications || !("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission().then(syncAllowButton, () => {});
}

function syncAllowButton() {
  allowButton.hidden = nativeNotifications || !("Notification" in window) || Notification.permission !== "default";
}
allowButton.addEventListener("click", askForNotifications);

function toast({ icon, title, body, actions = [] }) {
  const box = el("div", "life-toast");
  box.append(el("span", "life-toast-icon", icon));
  const text = el("div", "life-toast-text");
  text.append(el("strong", "", title));
  if (body) text.append(el("span", "", body));
  box.append(text);
  const close = () => box.remove();
  for (const [label, fn] of actions) {
    const b = el("button", "btn small", label);
    b.type = "button";
    b.addEventListener("click", () => {
      close();
      fn();
    });
    box.append(b);
  }
  const x = el("button", "icon-btn small");
  x.type = "button";
  x.title = "Dismiss";
  x.innerHTML = REMOVE;
  x.addEventListener("click", close);
  box.append(x);
  toasts.append(box);
  setTimeout(close, 5 * 60 * 1000);
}

function systemNotification(title, body, onClick) {
  if (nativeNotifications || !("Notification" in window) || Notification.permission !== "granted" || document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {}
}

function onReminder(r) {
  const s = getSettings();
  toast({
    icon: "⏰",
    title: r.text,
    body: `Reminder · ${time(r.at)}`,
    actions: [
      ["Snooze 10 min", () => api.life.snooze(r.id, 10).catch(() => {})],
      ["Open Today", () => openToday()],
    ],
  });
  systemNotification(`⏰ ${r.text}`, "Friends reminder", () => openToday());
  // In voice mode the character says it
  if (s?.life?.speak !== false && handlers.voiceOpen() && handlers.speak) handlers.speak(`A reminder ${r.repeat !== "none" ? `(${r.repeat}) ` : ""}just went off: "${r.text}".`);
  refresh();
}

function onBriefing(made) {
  toast({ icon: "☀️", title: "Your briefing is ready", body: made.title, actions: [["Read it", () => openChat(made.chatId, { force: true })]] });
  systemNotification("☀️ Your briefing is ready", made.title, () => openChat(made.chatId, { force: true }));
  document.dispatchEvent(new CustomEvent("friends:chats-changed"));
}

// The helper tells the page as things happen; the browser reconnects by itself
function listen() {
  const source = new EventSource("/api/events");
  source.addEventListener("hello", (e) => {
    nativeNotifications = JSON.parse(e.data).native === true;
    syncAllowButton();
  });
  source.addEventListener("reminder", (e) => onReminder(JSON.parse(e.data)));
  source.addEventListener("briefing", (e) => onBriefing(JSON.parse(e.data)));
}
listen();

// ----- The address: #today, #voice, #chat/<id> -----
function follow() {
  const hash = location.hash;
  if (hash === "#today") openToday();
  else if (hash === "#voice") {
    history.replaceState(null, "", location.pathname);
    document.dispatchEvent(new CustomEvent("friends:open-voice"));
  } else {
    const m = hash.match(/^#chat\/([\w-]+)$/);
    if (m) openChat(m[1]);
  }
}
window.addEventListener("hashchange", follow);
if (location.hash === "#today") follow();

// The badge stays current; the panel hides when it's switched off
onSettings((s) => {
  document.getElementById("today-open").hidden = s.life?.enabled === false;
});
refresh();
setInterval(() => modal.hidden && refresh(), 5 * 60 * 1000);
// A reply may have changed the lists (the AI's tools)
document.addEventListener("friends:chats-changed", () => refresh());
