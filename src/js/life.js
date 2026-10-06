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
import { t, tp, nf, formatDate, formatTime } from "./i18n.js";
import { announce } from "./a11y.js";

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
const time = (ms) => formatTime(new Date(ms));
const when = (ms) => formatDate(new Date(ms), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dueLabel = (due) => {
  if (!due) return "";
  const today = localDay();
  const day = due.slice(0, 10);
  const date = new Date(`${day}T00:00`);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  const label = day === today ? t("Today") : formatDate(date, { weekday: "short", day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }) });
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
  modal.querySelectorAll(".life-tab").forEach((b) => {
    const on = b.dataset.lifeTab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
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
  const b = e.target.closest(".life-tab");
  if (b) showTab(b.dataset.lifeTab);
});
// Arrow keys move between the tabs
modal.querySelector(".life-tabs").addEventListener("keydown", (e) => {
  const tabs = [...modal.querySelectorAll(".life-tab")];
  const at = tabs.indexOf(document.activeElement);
  const sign = document.documentElement.dir === "rtl" ? -1 : 1;
  const step = { ArrowRight: sign, ArrowLeft: -sign, ArrowDown: 1, ArrowUp: -1 }[e.key] ?? 0;
  if (at < 0 || (!step && e.key !== "Home" && e.key !== "End")) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + step + tabs.length) % tabs.length;
  showTab(tabs[next].dataset.lifeTab);
  tabs[next].focus();
});

// ----- Drawing -----
function taskItem(task) {
  const li = el("li", `life-item task${task.done ? " done" : ""}${task.priority === "high" ? " high" : ""}`);
  const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: task.done, className: "life-check" });
  check.setAttribute("aria-label", t("Done: {title}", { title: task.title }));
  check.addEventListener("change", () => act(() => api.life.updateTask(task.id, { done: check.checked })));
  const text = el("span", "life-text");
  text.append(el("span", "life-title", task.title));
  const meta = [dueLabel(task.due), task.list !== "inbox" ? task.list : "", task.priority === "high" ? t("high priority") : ""].filter(Boolean).join(" · ");
  if (meta) text.append(el("span", `life-meta${task.due && task.due.slice(0, 10) < localDay() && !task.done ? " overdue" : ""}`, meta));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = t("Delete task: {title}", { title: task.title });
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => act(() => api.life.removeTask(task.id)));
  li.append(check, text, remove);
  return li;
}

const REPEAT = { daily: t("every day"), weekdays: t("weekdays"), weekly: t("every week"), monthly: t("every month"), yearly: t("every year") };

function reminderItem(r) {
  const li = el("li", "life-item");
  const text = el("span", "life-text");
  text.append(el("span", "life-title", r.text), el("span", "life-meta", `${when(r.at)}${r.repeat !== "none" ? ` · ${REPEAT[r.repeat] || r.repeat}` : ""}`));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = t("Cancel reminder: {text}", { text: r.text });
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => act(() => api.life.removeReminder(r.id)));
  li.append(el("span", "life-icon", "⏰"), text, remove);
  return li;
}

function calendarItem(event) {
  const li = el("li", "life-item calendar-item");
  const text = el("span", "life-text");
  const d = new Date(event.start);
  const timeStr = event.allDay
    ? `${formatDate(d, { weekday: "short", day: "numeric", month: "short" })} · ${t("All day")}`
    : `${formatDate(d, { weekday: "short", day: "numeric", month: "short" })} · ${event.start.includes("T") ? event.start.slice(11, 16) : ""}${event.end && event.end.includes("T") ? ` - ${event.end.slice(11, 16)}` : ""}`;
  text.append(el("span", "life-title", event.title));
  const meta = [timeStr, event.location].filter(Boolean).join(" · ");
  if (meta) text.append(el("span", "life-meta", meta));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = t("Delete event: {title}", { title: event.title });
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => act(() => api.life.calendar.delete(event.id)));
  li.append(el("span", "life-icon", "📅"), text, remove);
  return li;
}

let focusTickerInterval = null;

function updateFocusDisplay(focus) {
  const controls = document.getElementById("focus-controls");
  const activeBox = document.getElementById("focus-active");
  const tag = document.getElementById("focus-tag");
  const timer = document.getElementById("focus-timer");
  if (!controls || !activeBox) return;

  if (focus && focus.active && focus.remainingSeconds > 0) {
    controls.hidden = true;
    activeBox.hidden = false;
    if (tag) tag.textContent = `🎯 ${focus.task || t("Focusing")}`;
    const updateTime = () => {
      const remaining = Math.max(0, Math.round((focus.targetEnd - Date.now()) / 1000));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      if (timer) timer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      if (remaining <= 0) {
        clearInterval(focusTickerInterval);
        refresh();
      }
    };
    updateTime();
    clearInterval(focusTickerInterval);
    focusTickerInterval = setInterval(updateTime, 1000);
  } else {
    clearInterval(focusTickerInterval);
    controls.hidden = false;
    activeBox.hidden = true;
  }
}


function habitCheck(h) {
  const b = el("button", `habit-check${h.today ? " done" : ""}`);
  b.type = "button";
  b.setAttribute("aria-pressed", String(h.today));
  b.title = h.today ? t("Done today (click to undo)") : t("Mark as done today");
  b.append(el("span", "habit-emoji", h.emoji), el("span", "habit-name", h.name), el("span", "habit-streak", h.streak ? `🔥 ${nf(h.streak)}` : ""));
  b.addEventListener("click", () => act(() => api.life.logHabit(h.id, { done: !h.today })));
  return b;
}

function habitItem(h) {
  const li = el("li", "life-item habit");
  const text = el("span", "life-text");
  text.append(el("span", "life-title", `${h.emoji} ${h.name}`), el("span", "life-meta", h.streak ? tp("{n}-day streak", "{n}-day streak", h.streak) : t("No streak yet")));
  const week = el("span", "habit-week");
  week.title = t("The last 7 days");
  h.last7.forEach((d) => week.append(el("i", d ? "on" : "")));
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = t("Stop tracking {name}", { name: h.name });
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "1";
      remove.title = t("Click again to stop tracking it");
      remove.setAttribute("aria-label", remove.title);
      announce(remove.title);
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

const MOOD = { awful: t("Awful"), bad: t("Bad"), okay: t("Okay"), good: t("Good"), great: t("Great") };

function journalItem(e) {
  const li = el("li", "life-item journal");
  const text = el("span", "life-text");
  text.append(el("span", "life-meta", `${when(e.at)}${e.mood ? ` · ${MOOD_EMOJI[e.mood]} ${MOOD[e.mood] || e.mood}` : ""}`), el("span", "life-entry", e.text));
  text.lastChild.dir = "auto";
  const remove = el("button", "icon-btn small");
  remove.type = "button";
  remove.title = t("Delete this entry");
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = REMOVE;
  remove.addEventListener("click", () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "1";
      remove.title = t("Click again to delete it");
      remove.setAttribute("aria-label", remove.title);
      announce(remove.title);
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
      const day = await api.life.today();
      updateBadge(day);
      if (modal.hidden) return;
      document.getElementById("life-date").textContent = formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" });
      const tasks = [...day.overdue, ...day.dueToday];
      document.getElementById("life-today-tasks").replaceChildren(...(tasks.length ? tasks.map(taskItem) : [empty(day.open.length ? t("Nothing due today.") + " " + tp("{n} open task without a date.", "{n} open tasks without a date.", day.open.length) : t("Nothing due today. Enjoy it, or add a task under Tasks."))]));
      document.getElementById("life-today-reminders").replaceChildren(...(day.reminders.length ? day.reminders.map(reminderItem) : [empty(t("No more reminders today."))]));
      const habits = document.getElementById("life-today-habits");
      habits.replaceChildren(...(day.habits.length ? day.habits.map(habitCheck) : [el("span", "row-desc", t("No habits yet. Add one under Habits, or tell your AI."))]));
      const todayCal = document.getElementById("life-today-calendar");
      if (todayCal) todayCal.replaceChildren(...(day.calendar?.length ? day.calendar.map(calendarItem) : [empty(t("No calendar events today."))]));
      updateFocusDisplay(day.focus);
    } else if (tab === "calendar") {
      const events = await api.life.calendar.list();
      const calList = document.getElementById("calendar-event-list");
      if (calList) calList.replaceChildren(...(events.length ? events.map(calendarItem) : [empty(t("No events on your calendar. Add one above or import an .ics file."))]));
    } else if (tab === "tasks") {
      const all = await api.life.tasks(document.getElementById("tasks-show-done").checked);
      const groups = new Map();
      for (const task of all) groups.set(task.list, [...(groups.get(task.list) || []), task]);
      const box = document.getElementById("task-groups");
      box.replaceChildren();
      if (!all.length) box.append(el("p", "row-desc", t("No tasks yet. Add one above, or just tell your AI what you need to do.")));
      for (const [name, tasks] of groups) {
        box.append(el("div", "life-section-title", name === "inbox" ? t("Inbox") : name));
        const ul = el("ul", "life-list");
        ul.append(...tasks.map(taskItem));
        box.append(ul);
      }
      document.getElementById("task-lists").replaceChildren(...[...groups.keys()].map((n) => Object.assign(document.createElement("option"), { value: n })));
    } else if (tab === "reminders") {
      const list = await api.life.reminders();
      document.getElementById("reminder-list").replaceChildren(...(list.length ? list.map(reminderItem) : [empty(t("No reminders. Add one above, or say “remind me in 20 minutes to…”."))]));
    } else if (tab === "habits") {
      const list = await api.life.habits();
      document.getElementById("habit-list").replaceChildren(...(list.length ? list.map(habitItem) : [empty(t("No habits yet. Add one above, for example “Gym” or “Read 20 minutes”."))]));
    } else if (tab === "journal") {
      const list = await api.life.journal(90);
      document.getElementById("journal-list").replaceChildren(...(list.length ? list.map(journalItem) : [empty(t("No journal entries in the last 90 days. Write what's on your mind above."))]));
    }
  } catch (err) {
    say(err.message, "error");
  }
}

function updateBadge(day) {
  const count = day.overdue.length + day.dueToday.length;
  badge.hidden = !count;
  badge.textContent = nf(count);
  badge.title = tp("{n} task due today or overdue", "{n} tasks due today or overdue", count);
  badge.classList.toggle("overdue", day.overdue.length > 0);
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
  quick.querySelectorAll(".mood-pick button").forEach((x) => {
    x.classList.toggle("selected", x.dataset.mood === quickMood);
    x.setAttribute("aria-pressed", String(x.dataset.mood === quickMood));
  });
});
quick.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = quick.text.value.trim() || (quickMood ? t("Feeling {mood}.", { mood: MOOD[quickMood].toLowerCase() }) : "");
  if (!text) return;
  act(() => api.life.addEntry({ text, mood: quickMood })).then(() => {
    quick.text.value = "";
    quickMood = "";
    quick.querySelectorAll(".mood-pick button").forEach((x) => {
      x.classList.remove("selected");
      x.setAttribute("aria-pressed", "false");
    });
    say(t("Saved in your journal."), "ok");
  });
});

document.getElementById("life-briefing").addEventListener("click", async () => {
  say(t("Putting your briefing together…"));
  try {
    const made = await api.life.briefing(getAccessToken());
    closeToday();
    openChat(made.chatId, { force: true });
    document.dispatchEvent(new CustomEvent("friends:chats-changed"));
  } catch (err) {
    say(err.message === "NO_BRAIN" ? t("Set up an AI first (Settings → AI & privacy).") : err.message, "error");
  }
});

document.getElementById("focus-start-btn")?.addEventListener("click", async () => {
  const taskInput = document.getElementById("focus-task-input");
  const durSelect = document.getElementById("focus-duration-select");
  const task = taskInput?.value?.trim() || "Focus session";
  const minutes = Number(durSelect?.value) || 25;
  try {
    const res = await api.life.focus.start(task, minutes);
    updateFocusDisplay(res);
    say(t("Focus session started!"), "ok");
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("focus-stop-btn")?.addEventListener("click", async () => {
  try {
    await api.life.focus.stop();
    updateFocusDisplay(null);
    say(t("Focus session stopped."), "ok");
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("calendar-add")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  act(() => api.life.calendar.add({
    title: f.title.value,
    start: f.start.value,
    end: f.end.value || undefined,
    location: f.location.value || "",
  })).then(() => {
    f.reset();
  });
});

document.getElementById("calendar-export-ics")?.addEventListener("click", async () => {
  try {
    const icsText = await api.life.calendar.exportIcs();
    const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `friends-calendar-${localDay()}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("calendar-import-ics")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const feedback = document.getElementById("calendar-feedback");
  try {
    const text = await file.text();
    const res = await api.life.calendar.importIcs(text);
    if (feedback) {
      feedback.textContent = t("Imported {n} events.", { n: res.imported });
      feedback.className = "test-feedback ok";
    }
    refresh();
  } catch (err) {
    if (feedback) {
      feedback.textContent = err.message;
      feedback.className = "test-feedback error";
    }
  }
  e.target.value = "";
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
  box.setAttribute("role", "alert");
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
  x.title = t("Dismiss");
  x.setAttribute("aria-label", t("Dismiss"));
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
    body: `${t("Reminder")} · ${time(r.at)}`,
    actions: [
      [t("Snooze 10 min"), () => api.life.snooze(r.id, 10).catch(() => {})],
      [t("Open Today"), () => openToday()],
    ],
  });
  systemNotification(`⏰ ${r.text}`, t("Friends reminder"), () => openToday());
  // In voice mode the character says it
  if (s?.life?.speak !== false && handlers.voiceOpen() && handlers.speak) handlers.speak(`A reminder ${r.repeat !== "none" ? `(${r.repeat}) ` : ""}just went off: "${r.text}".`); // (said to the AI, in English: it answers in your language)
  refresh();
}

function onBriefing(made) {
  toast({ icon: "☀️", title: t("Your briefing is ready"), body: made.title, actions: [[t("Read it"), () => openChat(made.chatId, { force: true })]] });
  systemNotification(`☀️ ${t("Your briefing is ready")}`, made.title, () => openChat(made.chatId, { force: true }));
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
  source.addEventListener("focus_complete", (e) => {
    const f = JSON.parse(e.data);
    updateFocusDisplay(null);
    toast({
      icon: "🎯",
      title: t("Focus session complete!"),
      body: f.task,
      actions: [[t("Open Today"), () => openToday()]],
    });
    systemNotification(`🎯 ${t("Focus session complete!")}`, f.task, () => openToday());
    refresh();
  });
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
