// Tools the AI may use: files on this computer, Google Workspace, GitHub,
// Live News, and memory notes. File tools follow the permission grid and
// allowed folders; permissions are checked again when a tool runs, not only
// when it's offered.
const crypto = require("crypto");
const files = require("./files");
const notes = require("./notes");
const workspace = require("./workspace");
const news = require("./news");
const robot = require("./robot");
const episodes = require("./episodes");
const life = require("./life");

const str = (description) => ({ type: "STRING", description });
const num = (description) => ({ type: "NUMBER", description });
const fn = (name, description, properties, required = Object.keys(properties)) => ({
  name,
  description,
  parameters: { type: "OBJECT", properties, required },
});

const FILE_TOOLS = {
  list_folder: fn("list_folder", "List the files and folders inside a folder.", { path: str("Folder path, e.g. ~/Documents") }),
  read_file: fn("read_file", "Read a text file (up to 1 MB).", { path: str("File path") }),
  create_file: fn("create_file", "Create a new text file. Fails if it already exists.", { path: str("New file path"), content: str("Text to write") }),
  edit_file: fn("edit_file", "Replace the whole content of an existing text file. Read it first so nothing is lost.", { path: str("File path"), content: str("The complete new content") }),
  create_folder: fn("create_folder", "Create a folder (and any missing parent folders).", { path: str("New folder path") }),
  move_item: fn("move_item", "Rename or move a file or folder.", { path: str("Current path"), new_path: str("New path") }),
  delete_item: fn("delete_item", "Delete a file or folder.", { path: str("Path to delete") }),
};


const WORKSPACE_TOOLS = {
  search_drive: fn(
    "search_drive",
    "Search your Google Drive for files, Google Docs, Google Sheets, and Google Slides presentations.",
    { query: str("Search term, title, or keyword to find") },
    ["query"]
  ),
  read_drive_file: fn(
    "read_drive_file",
    "Read or export the text content of a file from Google Drive (Google Docs, Sheets, Slides, or text).",
    { fileId: str("The ID of the file to read") },
    ["fileId"]
  ),
  get_calendar_events: fn(
    "get_calendar_events",
    "Check your upcoming schedule and events on Google Calendar.",
    { maxResults: num("Maximum number of upcoming events to return (1-20)") },
    []
  ),
  create_calendar_event: fn(
    "create_calendar_event",
    "Schedule a new event on Google Calendar. Requires user confirmation before adding.",
    {
      summary: str("Title or summary of the event"),
      start: str("Start date/time in ISO 8601 format (e.g. 2026-09-27T10:00:00Z or 2026-09-27)"),
      end: str("End date/time in ISO 8601 format"),
      description: str("Optional description or agenda"),
      location: str("Optional location or video call link"),
    },
    ["summary", "start", "end"]
  ),
  search_gmail: fn(
    "search_gmail",
    "Search your Gmail inbox and messages for specific senders, topics, or keywords.",
    { query: str("Search query (e.g. 'is:unread', 'from:alice', 'flight booking', 'project update')") },
    ["query"]
  ),
  send_gmail: fn(
    "send_gmail",
    "Send an email via Gmail on behalf of the user. Requires explicit user confirmation before sending.",
    {
      to: str("Recipient email address"),
      subject: str("Subject line"),
      body: str("Message body text"),
    },
    ["to", "subject", "body"]
  ),
  search_github: fn(
    "search_github",
    "Search GitHub for public repositories, popular libraries, projects, or developers.",
    { query: str("Search query for GitHub repositories") },
    ["query"]
  ),
  get_news: fn(
    "get_news",
    "Fetch current news headlines and breaking stories across technology, science, world news, or any topic.",
    { query: str("Topic or keyword to search (leave blank for top headlines)") },
    []
  ),
};

// Voice conversations: writing goes into the drafts panel instead of being read out
const DRAFT_KINDS = ["script", "post", "caption", "outline", "ideas", "email", "other"];
const DRAFT_TOOL = fn(
  "write_draft",
  "Put a piece of writing (a script, post, caption, outline, list of ideas, email...) into the user's drafts panel, where they can read and copy it. Use this for anything longer than a few sentences instead of reading it out. Writing a draft with the same title again adds a new version.",
  {
    title: str("A short title, e.g. 'YouTube intro: morning routine'"),
    kind: { type: "STRING", enum: DRAFT_KINDS, description: "What kind of writing it is" },
    content: str("The complete draft, formatted in Markdown"),
  },
  ["title", "kind", "content"]
);

const NOTE_TOOLS = {
  save_note: fn(
    "save_note",
    "Save something to your long-term memory so you remember it in future chats. Pass the id of an existing note to update it.",
    {
      id: str("Id of the note to update. Leave out to create a new note."),
      type: { type: "STRING", enum: notes.TYPES, description: "user = about the person; feedback = how they want you to act; project = ongoing work or plans; reference = where to find something" },
      title: str("Short title"),
      description: str("One-line summary"),
      content: str("The full note"),
    },
    ["type", "title", "description", "content"]
  ),
  delete_note: fn("delete_note", "Delete one of your memory notes that is wrong or no longer useful.", { id: str("Note id") }),
};

// Your life (life.js): tasks, reminders, habits, journal; all on this computer
const bool = (description) => ({ type: "BOOLEAN", description });
const LIFE_TOOLS = {
  add_task: fn(
    "add_task",
    "Add a task to the user's to-do list.",
    {
      title: str("What to do, short, e.g. 'Call the bank'"),
      due: str("Optional: when it's due: YYYY-MM-DD, YYYY-MM-DDTHH:MM, today, tomorrow or a weekday"),
      list: str("Optional list name, e.g. work, shopping, home (default: inbox)"),
      priority: { type: "STRING", enum: life.PRIORITIES, description: "Optional priority" },
      notes: str("Optional details"),
    },
    ["title"]
  ),
  list_tasks: fn(
    "list_tasks",
    "List the user's open tasks (and done ones if asked), soonest due first.",
    { list: str("Optional: only this list"), include_done: bool("Also show done tasks") },
    []
  ),
  update_task: fn(
    "update_task",
    "Change a task, or mark it done or not done.",
    {
      task: str("The task's id, or words from its title"),
      done: bool("true when it's done"),
      title: str("New title"),
      due: str("New due date (YYYY-MM-DD or YYYY-MM-DDTHH:MM), or empty to remove it"),
      list: str("Move to this list"),
      priority: { type: "STRING", enum: life.PRIORITIES, description: "New priority" },
      notes: str("New details"),
    },
    ["task"]
  ),
  delete_task: fn("delete_task", "Delete a task (when it's no longer needed, not when it's done).", { task: str("The task's id, or words from its title") }),
  set_reminder: fn(
    "set_reminder",
    "Remind the user of something at a time: a notification pops up on this computer (and you say it out loud in voice mode). Give either at or in_minutes.",
    {
      text: str("What to remind them of, e.g. 'Take the pizza out'"),
      at: str("When, as local time YYYY-MM-DDTHH:MM"),
      in_minutes: num("Or: in how many minutes from now"),
      repeat: { type: "STRING", enum: life.REPEATS, description: "Optional: repeat it (default none)" },
    },
    ["text"]
  ),
  list_reminders: fn("list_reminders", "List the reminders that are still to come.", {}, []),
  cancel_reminder: fn("cancel_reminder", "Cancel a reminder.", { reminder: str("The reminder's id, or words from its text") }),
  add_habit: fn("add_habit", "Start tracking a habit the user wants to build (e.g. Gym, Read 20 minutes, No sugar).", { name: str("The habit"), emoji: str("Optional: one emoji for it") }, ["name"]),
  log_habit: fn(
    "log_habit",
    "Mark a habit as done today (or on another day), or undo that. Use it when the user says they did it.",
    { habit: str("The habit's id or name"), done: bool("false to undo (default true)"), date: str("Optional: YYYY-MM-DD, default today") },
    ["habit"]
  ),
  list_habits: fn("list_habits", "The user's habits, whether each is done today, and their streaks.", {}, []),
  write_journal: fn(
    "write_journal",
    "Save a journal entry for the user: their day, thoughts or feelings, in their words or summarized with them. Only when they want it journaled.",
    { text: str("The entry"), mood: { type: "STRING", enum: life.MOODS, description: "Optional: how they feel" } },
    ["text"]
  ),
  read_journal: fn("read_journal", "Read the user's recent journal entries (only when they ask about them).", { days: num("How many days back (default 7)") }, []),
  daily_briefing: fn(
    "daily_briefing",
    "Everything for a daily briefing in one go: today's tasks and reminders, habits, follow-ups, and (when connected) calendar, weather and headlines. Use it when they ask what's on today or for a briefing.",
    {},
    []
  ),
};

// Memory of earlier conversations (episodes.js); all on this computer
const RECALL_TOOLS = {
  recall_conversations: fn(
    "recall_conversations",
    "Look back through your earlier conversations with the user: what you talked about, when, and how they were. Use it when they refer to something from before that isn't in this chat.",
    { query: str("What to look for, e.g. 'job interview', 'trip to Berlin', 'video ideas'") }
  ),
  resolve_follow_up: fn(
    "resolve_follow_up",
    "Mark one of your follow-ups as talked about, so you don't bring it up again.",
    { id: str("The follow-up's id") }
  ),
};

// The robot body on screen (Settings → Robot). These only move the robot, so
// they answer at once, never ask, never show up as steps in the chat, and
// don't count toward the tool rounds of a reply (see gemini.streamChat).
const ROBOT_TOOLS = {
  robot_mood: fn(
    "robot_mood",
    "Show a feeling on your robot body's face and posture, e.g. at the start of a turn. It stays until your mood changes.",
    { mood: { type: "STRING", enum: robot.MOODS, description: "The mood to show" } }
  ),
  robot_gesture: fn(
    "robot_gesture",
    "Make your robot body do one short move: nod, head_shake, tilt, wave (hello and goodbye), shrug, bounce, celebrate (a happy spin), look_around, lean_in, point_left or point_right (at the left or right side of the video picture), double_take, shy (hides its eyes).",
    { gesture: { type: "STRING", enum: robot.GESTURES, description: "The move to make" } }
  ),
};

const ONLINE_TOOLS = new Set(Object.keys(WORKSPACE_TOOLS));
const LIFE_NAMES = new Set(Object.keys(LIFE_TOOLS));

const isRobotTool = (name) => Object.hasOwn(ROBOT_TOOLS, name);

// The robot tools are offered when the robot is on screen (the page says so)
// and Settings → Robot lets the AI move it, separately for voice and text.
function robotToolsOn(settings, { voice, robot: onScreen }) {
  const allowed = settings.robot?.aiGestures || {};
  return onScreen === true && (voice ? allowed.voice : allowed.chat) === true;
}

// What a robot tool call shows: { mood } or { gesture }; throws when it's not one it knows
function robotEvent(name, args = {}) {
  if (name === "robot_mood" && robot.MOODS.includes(args.mood)) return { mood: args.mood };
  if (name === "robot_gesture" && robot.GESTURES.includes(args.gesture)) return { gesture: args.gesture };
  throw new Error(name === "robot_mood" ? `Use one of these moods: ${robot.MOODS.join(", ")}.` : `Use one of these gestures: ${robot.GESTURES.join(", ")}.`);
}

// options.voice: a spoken conversation, which also gets write_draft.
// options.robot: the robot body is on screen; options.nonBlocking: Gemini Live
// may keep talking while robot calls are answered ("behavior": "NON_BLOCKING").
// options.workspace: false leaves out the Google Drive, Calendar and Gmail tools
// (they only work once a Google account is connected; fewer tools also keep
// small local models focused and requests short).
// options.onAir: co-host mode; with "nothing private on camera" the tools that
// read your files, mail, calendar and memories are left out.
function declarations(settings, { voice = false, robot: onScreen = false, nonBlocking = false, workspace = true, onAir = false } = {}) {
  const p = settings.permissions;
  const list = [];
  const online = settings.privacy?.localOnly !== true; // Private mode keeps everything on this computer
  const hidden = onAir === true && settings.onAir?.hidePrivate !== false;
  if (hidden) workspace = false;
  if (p.folders.length && !hidden) {
    if (p.dirs.read) list.push(FILE_TOOLS.list_folder);
    if (p.files.read) list.push(FILE_TOOLS.read_file);
    if (p.files.create) list.push(FILE_TOOLS.create_file);
    if (p.files.edit) list.push(FILE_TOOLS.edit_file);
    if (p.dirs.create) list.push(FILE_TOOLS.create_folder);
    if (p.files.edit || p.dirs.edit) list.push(FILE_TOOLS.move_item);
    if (p.files.delete || p.dirs.delete) list.push(FILE_TOOLS.delete_item);
  }

  if (workspace && online) {
    list.push(
      WORKSPACE_TOOLS.search_drive,
      WORKSPACE_TOOLS.read_drive_file,
      WORKSPACE_TOOLS.get_calendar_events,
      WORKSPACE_TOOLS.create_calendar_event,
      WORKSPACE_TOOLS.search_gmail,
      WORKSPACE_TOOLS.send_gmail,
    );
  }
  if (online) list.push(WORKSPACE_TOOLS.search_github, WORKSPACE_TOOLS.get_news);

  if (settings.aiNotes?.enabled) {
    list.push(NOTE_TOOLS.save_note, NOTE_TOOLS.delete_note);
  }
  if (settings.life?.enabled !== false && !hidden) list.push(...Object.values(LIFE_TOOLS));
  if (settings.companion?.recall !== false && !hidden) {
    list.push(RECALL_TOOLS.recall_conversations);
    if (settings.companion?.followUps !== false) list.push(RECALL_TOOLS.resolve_follow_up);
  }
  if (voice) list.push(DRAFT_TOOL);
  if (robotToolsOn(settings, { voice, robot: onScreen })) {
    for (const tool of Object.values(ROBOT_TOOLS)) list.push(nonBlocking ? { ...tool, behavior: "NON_BLOCKING" } : tool);
  }
  return list;
}

// "folder" → the dirs permissions, "file" → the files permissions
const allowedFor = (p, type, action) => (type === "folder" ? p.dirs : p.files)[action];

// Checks and describes a file action before it runs. Returns { summary, run }.
async function planFileAction(name, args, settings) {
  const p = settings.permissions;
  const at = (x) => files.resolve(x, p.folders);
  const deny = (what) => {
    throw new Error(`You don't have permission to ${what}. The user can allow it in Settings → AI control.`);
  };

  switch (name) {
    case "list_folder": {
      if (!p.dirs.read) deny("see inside folders");
      const { real } = await at(args.path);
      return { summary: `look inside ${files.shown(real)}`, done: `Looked inside ${files.shown(real)}`, run: () => files.listFolder(real) };
    }
    case "read_file": {
      if (!p.files.read) deny("read files");
      const { real } = await at(args.path);
      return { summary: `read ${files.shown(real)}`, done: `Read ${files.shown(real)}`, run: () => files.readFile(real) };
    }
    case "create_file": {
      if (!p.files.create) deny("create files");
      const { real } = await at(args.path);
      return { summary: `create the file ${files.shown(real)}`, done: `Created ${files.shown(real)}`, run: () => files.createFile(real, args.content) };
    }
    case "edit_file": {
      if (!p.files.edit) deny("edit files");
      const { real } = await at(args.path);
      return { summary: `change the file ${files.shown(real)}`, done: `Edited ${files.shown(real)}`, run: () => files.editFile(real, args.content) };
    }
    case "create_folder": {
      if (!p.dirs.create) deny("create folders");
      const { real } = await at(args.path);
      return { summary: `create the folder ${files.shown(real)}`, done: `Created the folder ${files.shown(real)}`, run: () => files.createFolder(real) };
    }
    case "move_item": {
      const from = await at(args.path);
      const to = await at(args.new_path);
      const type = await files.kind(from.real);
      if (!type) throw new Error("That file or folder doesn't exist.");
      if (!allowedFor(p, type, "edit")) deny(`rename or move ${type}s`);
      if (from.isRoot) throw new Error("An allowed folder itself can't be moved.");
      return {
        summary: `move ${files.shown(from.real)} to ${files.shown(to.real)}`,
        done: `Moved ${files.shown(from.real)} → ${files.shown(to.real)}`,
        run: () => files.move(from.real, to.real),
      };
    }
    case "delete_item": {
      const { real, isRoot } = await at(args.path);
      const type = await files.kind(real);
      if (!type) throw new Error("That file or folder doesn't exist.");
      if (!allowedFor(p, type, "delete")) deny(`delete ${type}s`);
      if (isRoot) throw new Error("An allowed folder itself can't be deleted.");
      const where = p.useTrash ? " (to the trash)" : " permanently";
      return {
        summary: `delete the ${type} ${files.shown(real)}${where}`,
        done: `Deleted ${files.shown(real)}${where}`,
        run: () => files.remove(real, p.useTrash),
      };
    }
  }
  return null;
}

// ---------- Your life (life.js) ----------
const timeOf = (ms) => new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dueText = (due) => (due ? ` (due ${due.replace("T", " ")})` : "");

// Everything for a briefing; the parts that need the internet only when allowed and connected
async function briefing(ctx) {
  const s = ctx.settings;
  const online = s.privacy?.localOnly !== true;
  const t = life.today();
  const out = {
    date: new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    overdue: t.overdue.map((x) => ({ id: x.id, title: x.title, due: x.due })),
    dueToday: t.dueToday.map((x) => ({ id: x.id, title: x.title, due: x.due, priority: x.priority })),
    otherOpenTasks: t.open.length,
    remindersToday: t.reminders.map((r) => ({ text: r.text, at: timeOf(r.at) })),
    habits: t.habits.map((h) => ({ name: h.name, doneToday: h.today, streak: h.streak })),
    followUps: s.companion?.followUps === false ? [] : episodes.followUps().map((f) => f.text),
  };
  const extras = [];
  if (online && ctx.googleAccessToken) {
    extras.push(
      workspace
        .getCalendarEvents(ctx.googleAccessToken, 10)
        .then((events) => (out.calendar = events.filter((e) => String(e.start).slice(0, 10) <= life.dayOf()).map((e) => ({ summary: e.summary, start: e.start, end: e.end, location: e.location }))))
        .catch(() => (out.calendar = "couldn't be read"))
    );
  }
  if (online && s.life?.briefingNews !== false) {
    extras.push(news.getNews("").then((r) => (out.headlines = r.articles.slice(0, 5).map((a) => a.title))).catch(() => {}));
  }
  for (const extra of briefingSources) extras.push(Promise.resolve(extra(ctx, out)).catch(() => {}));
  await Promise.all(extras);
  return out;
}

// Other parts of a briefing (weather…), added by their modules
const briefingSources = [];
const addBriefingSource = (fn) => briefingSources.push(fn);

async function runLife(name, args, ctx) {
  const say = (line) => ctx.onActivity?.(line);
  switch (name) {
    case "add_task": {
      const task = life.addTask(args);
      say(`Added a task: ${task.title}${dueText(task.due)}`);
      return { ok: true, task };
    }
    case "list_tasks":
      return { ok: true, tasks: life.listTasks({ list: args.list, includeDone: args.include_done === true }).slice(0, 50) };
    case "update_task": {
      const { task: ref, ...changes } = args;
      const task = life.updateTask(ref, changes);
      say(changes.done === true ? `Done: ${task.title}` : `Updated the task: ${task.title}`);
      return { ok: true, task };
    }
    case "delete_task": {
      const task = life.removeTask(args.task);
      say(`Deleted the task: ${task.title}`);
      return { ok: true };
    }
    case "set_reminder": {
      const r = life.addReminder({ text: args.text, at: args.at, inMinutes: args.in_minutes, repeat: args.repeat });
      say(`Reminder set for ${timeOf(r.at)}${r.repeat !== "none" ? ` (${r.repeat})` : ""}: ${r.text}`);
      return { ok: true, reminder: { ...r, when: timeOf(r.at) } };
    }
    case "list_reminders":
      return { ok: true, reminders: life.listReminders().slice(0, 30).map((r) => ({ ...r, when: timeOf(r.at) })) };
    case "cancel_reminder": {
      const r = life.removeReminder(args.reminder);
      say(`Cancelled the reminder: ${r.text}`);
      return { ok: true };
    }
    case "add_habit": {
      const h = life.addHabit(args);
      say(`Tracking a new habit: ${h.emoji} ${h.name}`);
      return { ok: true, habit: h };
    }
    case "log_habit": {
      const h = life.logHabit(args.habit, { date: args.date, done: args.done !== false });
      say(`${args.done === false ? "Undid" : "Logged"} ${h.emoji} ${h.name}${h.streak > 1 ? ` · ${h.streak}-day streak` : ""}`);
      return { ok: true, habit: { name: h.name, streak: h.streak } };
    }
    case "list_habits":
      return { ok: true, habits: life.listHabits().map((h) => ({ id: h.id, name: h.name, emoji: h.emoji, doneToday: h.today, streak: h.streak })) };
    case "write_journal": {
      const e = life.addEntry(args);
      say("Saved a journal entry");
      return { ok: true, id: e.id };
    }
    case "read_journal":
      return { ok: true, entries: life.listEntries({ days: args.days }).map((e) => ({ when: timeOf(e.at), mood: e.mood || undefined, text: e.text })) };
    case "daily_briefing":
      say("Put together your briefing");
      return { ok: true, briefing: await briefing(ctx) };
  }
  throw new Error(`Unknown tool ${name}.`);
}

// Runs one tool call. ctx: { settings, googleAccessToken, confirm(summary, details) → Promise<boolean>,
// onActivity(text), onDraft(draft), onRobot({ mood } | { gesture }) }.
// Always returns an object for the model; errors are reported, not thrown.
async function run(name, args, ctx) {
  // The robot moves at once and quietly: no confirmation, no activity line
  if (isRobotTool(name)) {
    try {
      ctx.onRobot?.(robotEvent(name, args));
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  }
  // Private mode: nothing leaves this computer, even if the AI asks
  if (ctx.settings.privacy?.localOnly === true && ONLINE_TOOLS.has(name)) {
    return { error: "Private mode is on: this tool needs the internet, so it's off." };
  }
  // Gmail and Calendar changes follow "Confirm workspace actions"
  const confirmWorkspace = ctx.settings.aiControl?.confirmTools !== false;
  try {
    // 1. Memory notes
    if (name === "save_note" || name === "delete_note") {
      if (!ctx.settings.aiNotes?.enabled) throw new Error("Memory notes are turned off.");
      if (name === "delete_note") {
        notes.remove(args.id);
        ctx.onActivity?.("Removed a memory note");
        return { ok: true };
      }
      // An id the AI made up (small models do) saves a new note instead of failing
      const known = Boolean(args.id) && notes.list().some((n) => n.id === args.id);
      const note = notes.save(known ? args : { ...args, id: undefined });
      ctx.onActivity?.(`${known ? "Updated" : "Saved"} a memory note: ${note.title}`);
      return { ok: true, id: note.id };
    }

    // Tasks, reminders, habits, journal
    if (LIFE_NAMES.has(name)) return await runLife(name, args, ctx);

    // Earlier conversations
    if (name === "recall_conversations") {
      if (ctx.settings.companion?.recall === false) throw new Error("Remembering conversations is turned off.");
      const found = episodes.search(args.query);
      ctx.onActivity?.(`Remembered ${found.length ? `${found.length} earlier conversation${found.length === 1 ? "" : "s"}` : "nothing about that"}`);
      return { ok: true, conversations: found };
    }
    if (name === "resolve_follow_up") {
      return episodes.resolve(args.id);
    }

    // Drafts (voice conversations)
    if (name === "write_draft") {
      const content = String(args.content || "").trim();
      if (!content) throw new Error("The draft is empty.");
      const draft = {
        id: crypto.randomUUID(),
        title: String(args.title || "Draft").replace(/\s+/g, " ").trim().slice(0, 120) || "Draft",
        kind: DRAFT_KINDS.includes(args.kind) ? args.kind : "other",
        content: content.slice(0, 50000),
        at: Date.now(),
      };
      ctx.onDraft?.(draft);
      return { ok: true, note: "It's in the drafts panel now, where they can read and copy it." };
    }

    // 2. Files on this computer, inside the allowed folders
    if (FILE_TOOLS[name]) {
      const plan = await planFileAction(name, args, ctx.settings);
      if (ctx.settings.permissions.askBeforeActing && !(await ctx.confirm(plan.summary, { type: "file" }))) {
        ctx.onActivity?.(`You declined: ${plan.summary}`);
        return { error: "The user declined this action." };
      }
      const result = await plan.run();
      ctx.onActivity?.(plan.done);
      return { ok: true, ...result };
    }

    // 3. GitHub search
    if (name === "search_github") {
      ctx.onActivity?.(`Searching GitHub for "${args.query}"`);
      const repos = await workspace.searchGitHub(args.query);
      ctx.onActivity?.(`Found ${repos.length} GitHub repositories`);
      return { ok: true, repositories: repos };
    }

    // 4. Live News
    if (name === "get_news") {
      const q = args.query || "";
      ctx.onActivity?.(`Fetching news headlines${q ? ` for "${q}"` : ""}`);
      const result = await news.getNews(q);
      ctx.onActivity?.(`Found ${result.articles.length} news stories`);
      return { ok: true, ...result };
    }

    // 5. Google Workspace tools (require user's Google token)
    const token = ctx.googleAccessToken;

    if (name === "search_drive") {
      ctx.onActivity?.(`Searching Google Drive for "${args.query}"`);
      const files = await workspace.searchDrive(token, args.query);
      ctx.onActivity?.(`Found ${files.length} Drive files`);
      return { ok: true, files };
    }

    if (name === "read_drive_file") {
      ctx.onActivity?.(`Reading Google Drive file`);
      const fileData = await workspace.readDriveFile(token, args.fileId);
      ctx.onActivity?.(`Read file: ${fileData.name}`);
      return { ok: true, file: fileData };
    }

    if (name === "get_calendar_events") {
      ctx.onActivity?.("Checking upcoming Google Calendar schedule");
      const events = await workspace.getCalendarEvents(token, args.maxResults || 10);
      ctx.onActivity?.(`Found ${events.length} calendar events`);
      return { ok: true, events };
    }

    if (name === "search_gmail") {
      ctx.onActivity?.(`Searching Gmail for "${args.query}"`);
      const messages = await workspace.searchGmail(token, args.query);
      ctx.onActivity?.(`Found ${messages.length} email threads`);
      return { ok: true, messages };
    }

    // 6. Gmail and Calendar changes (confirmed unless turned off)
    if (name === "create_calendar_event") {
      const summaryText = `Schedule "${args.summary}" on Google Calendar on ${args.start}`;
      if (confirmWorkspace) {
        const allowed = await ctx.confirm(summaryText, {
          type: "calendar",
          summary: args.summary,
          start: args.start,
          end: args.end,
          location: args.location,
        });
        if (!allowed) {
          ctx.onActivity?.("Declined scheduling calendar event");
          return { error: "The user declined adding this event to their calendar." };
        }
      }
      ctx.onActivity?.(`Scheduling "${args.summary}" on Google Calendar`);
      const event = await workspace.createCalendarEvent(token, args);
      ctx.onActivity?.(`Scheduled event on Google Calendar: ${event.summary}`);
      return { ok: true, event };
    }

    if (name === "send_gmail") {
      const summaryText = `Send email to ${args.to} with subject "${args.subject}"`;
      if (confirmWorkspace) {
        const allowed = await ctx.confirm(summaryText, {
          type: "gmail",
          to: args.to,
          subject: args.subject,
          body: args.body,
        });
        if (!allowed) {
          ctx.onActivity?.("Declined sending email");
          return { error: "The user declined sending this email." };
        }
      }
      ctx.onActivity?.(`Sending email to ${args.to}`);
      const res = await workspace.sendGmail(token, args);
      ctx.onActivity?.(`Sent email to ${args.to}`);
      return { ok: true, result: res };
    }

    throw new Error(`Unknown tool ${name}.`);
  } catch (err) {
    ctx.onActivity?.(`Couldn't complete ${name.replace(/_/g, " ")}: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { declarations, run, isRobotTool, robotEvent, briefing, addBriefingSource };
