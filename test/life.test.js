// Tasks, reminders, habits, the journal, the briefing, reminders arriving at
// the page, and the desktop app's tray and autostart helpers.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-life-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.KEYRING_BACKEND = "file";
process.env.LOG_LEVEL = "error";
delete process.env.GEMINI_API_KEY;

const life = require("../server/life");
const tools = require("../server/tools");
const settings = require("../server/settings");
const prompt = require("../server/prompt");
const desktop = require("../electron/desktop");

const DAY = 24 * 60 * 60 * 1000;
const at = (s) => new Date(s).getTime();

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("Tasks", () => {
  test("added, listed soonest first, updated, done and deleted by id or title", () => {
    const a = life.addTask({ title: "  Call the bank ", due: "2030-01-10", priority: "high" });
    const b = life.addTask({ title: "Buy milk", list: "Shopping" });
    const c = life.addTask({ title: "Pay rent", due: "2030-01-02" });
    assert.strictEqual(a.title, "Call the bank");
    assert.strictEqual(b.list, "shopping");
    assert.deepStrictEqual(life.listTasks().map((t) => t.title), ["Pay rent", "Call the bank", "Buy milk"]);
    assert.strictEqual(life.updateTask("bank", { due: "2030-01-11T09:30" }).due, "2030-01-11T09:30");
    assert.strictEqual(life.completeTask(c.id).done, true);
    assert.ok(!life.listTasks().some((t) => t.id === c.id));
    assert.ok(life.listTasks({ includeDone: true }).some((t) => t.id === c.id));
    assert.deepStrictEqual(life.listTasks({ list: "shopping" }).map((t) => t.id), [b.id]);
    life.removeTask("milk");
    assert.ok(!life.listTasks().some((t) => t.id === b.id));
    assert.throws(() => life.addTask({ title: "  " }), /needs a title/);
    assert.throws(() => life.removeTask("nothing like this"), /no task/);
  });

  test("an ambiguous title asks for the id", () => {
    life.addTask({ title: "Email Anna" });
    life.addTask({ title: "Email Ben" });
    assert.throws(() => life.updateTask("email", { done: true }), /More than one task matches "email"/);
  });

  test("due dates: words, weekdays, times; a wrong year months back is fixed", () => {
    const now = at("2026-10-04T18:00");
    assert.strictEqual(life.parseDue("today", now), "2026-10-04");
    assert.strictEqual(life.parseDue("tomorrow", now), "2026-10-05");
    assert.strictEqual(life.parseDue("Friday", now), "2026-10-09");
    assert.strictEqual(life.parseDue("sunday", now), "2026-10-11", "a week ahead when it's today");
    assert.strictEqual(life.parseDue("2026-10-06 9:05", now), "2026-10-06T09:05");
    assert.strictEqual(life.parseDue("2024-10-05", now, { fixYear: true }), "2026-10-05");
    assert.strictEqual(life.parseDue("2026-01-02", now, { fixYear: true }), "2027-01-02");
    assert.strictEqual(life.parseDue("2026-09-30", now, { fixYear: true }), "2026-09-30", "recent past stays");
    assert.throws(() => life.parseDue("next blue moon", now), /isn't a date/);
  });
});

describe("Reminders", () => {
  test("in minutes or at a time; a time that has passed is refused", () => {
    const now = Date.now();
    const r = life.addReminder({ text: "Stretch", inMinutes: 20 }, now);
    assert.ok(Math.abs(r.at - (now + 20 * 60 * 1000)) < 5);
    const day = life.addReminder({ text: "Dentist", at: "2031-05-02" }, now);
    assert.strictEqual(new Date(day.at).getHours(), 9, "a day without a time: 9 in the morning");
    assert.throws(() => life.addReminder({ text: "Too late", at: "2020-01-01T10:00" }, now), /already passed/);
    assert.throws(() => life.addReminder({ text: "When?" }, now), /When should it go off/);
  });

  test("due reminders go off once; repeating ones move on", () => {
    for (const r of life.listReminders({ includeDone: true })) life.removeReminder(r.id);
    const now = at("2030-03-04T08:00"); // a Monday
    const once = life.addReminder({ text: "Once", at: "2030-03-04T08:30" }, now);
    const daily = life.addReminder({ text: "Pills", at: "2030-03-04T08:30", repeat: "daily" }, now);
    const weekdays = life.addReminder({ text: "Standup", at: "2030-03-08T09:00", repeat: "weekdays" }, now); // a Friday
    assert.deepStrictEqual(life.takeDue(at("2030-03-04T08:29")), []);
    const fired = life.takeDue(at("2030-03-04T08:31"));
    assert.deepStrictEqual(fired.map((r) => r.text).sort(), ["Once", "Pills"]);
    assert.deepStrictEqual(life.takeDue(at("2030-03-04T08:32")), [], "not twice");
    const left = life.listReminders();
    assert.ok(!left.some((r) => r.id === once.id));
    assert.strictEqual(new Date(left.find((r) => r.id === daily.id).at).getDate(), 5);
    life.takeDue(at("2030-03-08T09:01"));
    assert.strictEqual(new Date(life.listReminders().find((r) => r.id === weekdays.id).at).getDay(), 1, "Friday → Monday");
  });

  test("snooze brings it back in a few minutes", () => {
    const now = Date.now();
    const r = life.addReminder({ text: "Tea", inMinutes: 1 }, now);
    life.takeDue(now + 2 * 60 * 1000);
    const back = life.snooze(r.id, 10, now + 2 * 60 * 1000);
    assert.strictEqual(back.done, false);
    assert.strictEqual(back.at, now + 12 * 60 * 1000);
  });

  test("tick tells the listeners", () => {
    const heard = [];
    const stop = life.onReminder((r) => heard.push(r.text));
    life.addReminder({ text: "Now", inMinutes: 0.01 });
    life.tick(Date.now() + 60 * 1000);
    stop();
    assert.ok(heard.includes("Now"));
  });
});

describe("Habits and journal", () => {
  test("streaks count days in a row, and today counts once done", () => {
    const now = at("2030-06-10T12:00");
    const h = life.addHabit({ name: "Gym", emoji: "🏋️" });
    assert.throws(() => life.addHabit({ name: "gym" }), /already a habit/);
    life.logHabit(h.id, { date: "2030-06-08" }, now);
    life.logHabit("gym", { date: "2030-06-09" }, now);
    assert.strictEqual(life.listHabits(now)[0].streak, 2, "yesterday's streak still counts this morning");
    assert.strictEqual(life.logHabit("Gym", {}, now).streak, 3);
    assert.strictEqual(life.logHabit("Gym", { done: false }, now).streak, 2);
    assert.deepStrictEqual(life.listHabits(now)[0].last7, [false, false, false, false, true, true, false]);
  });

  test("journal entries, newest first, with a mood", () => {
    life.addEntry({ text: "A good day.", mood: "good" });
    life.addEntry({ text: "Tired.", mood: "nope" });
    const list = life.listEntries();
    assert.strictEqual(list[0].text, "Tired.");
    assert.strictEqual(list[0].mood, "");
    assert.strictEqual(list[1].mood, "good");
    assert.throws(() => life.addEntry({ text: " " }), /empty/);
  });
});

describe("The AI's life tools", () => {
  test("offered when on, hidden on camera and when switched off", () => {
    const s = settings.get();
    const names = (o) => tools.declarations(s, o).map((t) => t.name);
    assert.ok(names().includes("add_task") && names().includes("set_reminder") && names().includes("daily_briefing"));
    assert.ok(!names({ onAir: true }).includes("add_task"));
    assert.ok(!tools.declarations({ ...s, life: { ...s.life, enabled: false } }).some((t) => t.name === "add_task"));
  });

  test("they work and say what they did; the prompt knows today", async () => {
    const said = [];
    const ctx = { settings: { ...settings.get(), privacy: { localOnly: true } }, onActivity: (t) => said.push(t) };
    const added = await tools.run("add_task", { title: "Edit the video", due: "today" }, ctx);
    assert.strictEqual(added.ok, true);
    assert.match(said.at(-1), /Added a task: Edit the video \(due \d{4}-\d{2}-\d{2}\)/);
    assert.strictEqual((await tools.run("update_task", { task: added.task.id, done: true }, ctx)).task.done, true);
    const r = await tools.run("set_reminder", { text: "Call Mom", in_minutes: 30 }, ctx);
    assert.match(said.at(-1), /Reminder set for .*: Call Mom/);
    assert.ok((await tools.run("list_reminders", {}, ctx)).reminders.some((x) => x.id === r.reminder.id));
    assert.match((await tools.run("set_reminder", { text: "x" }, ctx)).error, /When should it go off/);
    const brief = await tools.run("daily_briefing", {}, ctx);
    assert.ok(Array.isArray(brief.briefing.habits) && brief.briefing.date);
    assert.strictEqual(brief.briefing.headlines, undefined, "no news in Private mode");
    const text = prompt.build(settings.get(), { toolsOffered: tools.declarations(settings.get()) });
    assert.match(text, /# Helping run their life/);
    assert.match(text, /Today's date is \d{4}-\d{2}-\d{2}/);
    assert.match(text, /Habits: /);
  });
});

describe("Reminders reach the page, and the briefing", () => {
  let server;
  let base;
  const fakeLocal = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:latest" }] }));
    if (req.url === "/api/chat") return res.end(JSON.stringify({ message: { content: "Good morning! Here's your day." }, done: true }));
    res.writeHead(404).end("{}");
  });

  before(async () => {
    await new Promise((resolve) => fakeLocal.listen(0, "127.0.0.1", resolve));
    await require("../server/brains").saveBrain({ provider: "local", protocol: "ollama", name: "Local", baseUrl: `http://127.0.0.1:${fakeLocal.address().port}`, model: "tiny" });
    server = require("../server/server").start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    fakeLocal.close();
  });

  test("a reminder going off is sent to the page", async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    text += (await reader.read()).value;
    assert.match(text, /event: hello\ndata: \{"native":false\}/);
    life.addReminder({ text: "Water the plants", inMinutes: 0.001 });
    life.tick(Date.now() + 1000);
    while (!/event: reminder/.test(text)) text += (await reader.read()).value;
    assert.match(text, /event: reminder\ndata: .*Water the plants/);
    controller.abort();
  });

  test("the routes for the Today panel", async () => {
    const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const t = await post("/api/life/tasks", { title: "From the panel", due: "today" });
    const today = await (await fetch(`${base}/api/life/today`)).json();
    assert.ok(today.dueToday.some((x) => x.id === t.id));
    const bad = await fetch(`${base}/api/life/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(bad.status, 400);
  });

  test("the briefing becomes a chat", async () => {
    const made = await fetch(`${base}/api/life/briefing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
    assert.match(made.title, /^Briefing · /);
    const chat = await (await fetch(`${base}/api/chats/${made.chatId}`)).json();
    assert.strictEqual(chat.messages[0].text, "Good morning! Here's your day.");
    assert.strictEqual(chat.messages[0].briefing, true);
  });

  test("the morning briefing is made once a day after its time", async () => {
    const briefing = require("../server/briefing");
    const s = settings.get();
    settings.set({ ...s, life: { ...s.life, briefing: { auto: true, time: "07:30" } } });
    assert.strictEqual(await briefing.tick(at("2031-02-03T07:00")), null, "not before its time");
    const made = await briefing.tick(at("2031-02-03T07:31"));
    assert.ok(made?.chatId);
    assert.strictEqual(await briefing.tick(at("2031-02-03T09:00")), null, "once a day");
    settings.set({ ...settings.get(), life: { ...s.life } });
  });
});

describe("The desktop app outside its window", () => {
  test("autostart entry and command", () => {
    assert.strictEqual(desktop.launchCommand({ execPath: "/opt/friends/friends", packaged: true }), "/opt/friends/friends --hidden");
    assert.strictEqual(desktop.launchCommand({ execPath: "/x/electron", appPath: "/my app", packaged: false }), '/x/electron "/my app" --no-sandbox --hidden');
    assert.match(desktop.autostartEntry("/opt/friends/friends --hidden"), /^\[Desktop Entry\][\s\S]*Exec=\/opt\/friends\/friends --hidden/);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "friends-autostart-"));
    process.env.XDG_CONFIG_HOME = home;
    assert.strictEqual(desktop.setAutostart(true, "friends --hidden"), true);
    assert.ok(fs.existsSync(path.join(home, "autostart", "friends.desktop")));
    assert.strictEqual(desktop.setAutostart(false, "friends --hidden"), false);
    delete process.env.XDG_CONFIG_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("where a notification click goes", () => {
    assert.strictEqual(desktop.hashFor({ type: "open-chat", id: "abc-1" }), "#chat/abc-1");
    assert.strictEqual(desktop.hashFor({ type: "open-chat", id: "x\"); alert(1)" }), "");
    assert.strictEqual(desktop.hashFor({ type: "reminder" }), "#today");
    assert.strictEqual(desktop.hashFor({ type: "voice" }), "#voice");
    assert.strictEqual(desktop.hashFor(null), "");
  });
});
