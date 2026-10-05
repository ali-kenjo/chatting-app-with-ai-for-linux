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
const connectors = require("./connectors");
const mcp = require("./mcp");
const builder = require("./builder");
const templates = require("./templates");

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
    "Check the user's Google Calendar: upcoming events, or the events between two dates.",
    { maxResults: num("Maximum number of events to return (1-50, default 10)"), from: str("Optional start date YYYY-MM-DD (default now)"), to: str("Optional end date YYYY-MM-DD") },
    []
  ),
  update_calendar_event: fn(
    "update_calendar_event",
    "Change an event on Google Calendar (the user confirms first). Get the event id from get_calendar_events.",
    { eventId: str("The event's id"), summary: str("New title"), start: str("New start (ISO 8601)"), end: str("New end (ISO 8601)"), location: str("New location"), description: str("New description") },
    ["eventId"]
  ),
  delete_calendar_event: fn("delete_calendar_event", "Delete an event from Google Calendar (the user confirms first).", { eventId: str("The event's id") }),
  read_gmail: fn("read_gmail", "Read one whole email (its full text) by the id search_gmail gave.", { id: str("The message id") }),
  draft_gmail: fn(
    "draft_gmail",
    "Save an email as a draft in Gmail, for the user to review and send themselves.",
    { to: str("Recipient email address"), subject: str("Subject line"), body: str("Message body text") }
  ),
  youtube_my_channel: fn("youtube_my_channel", "The user's own YouTube channel: subscribers, views, and their recent videos with views, likes and comments.", {}, []),
  youtube_video: fn("youtube_video", "Details and numbers of a YouTube video (title, views, likes, comments, description, tags).", { video: str("Video id or link") }),
  youtube_comments: fn("youtube_comments", "The top comments on a YouTube video (to see what viewers think or find ideas).", { video: str("Video id or link"), max: num("How many (default 20)") }, ["video"]),
  youtube_search: fn("youtube_search", "Search YouTube for videos, channels or playlists (research, trends, competitors).", { query: str("What to search for"), type: { type: "STRING", enum: ["video", "channel", "playlist"], description: "Default video" } }, ["query"]),
  google_tasks: fn("google_tasks", "The user's Google Tasks lists (synced with their phone).", { show_completed: { type: "BOOLEAN", description: "Also completed ones" } }, []),
  google_add_task: fn("google_add_task", "Add a task to Google Tasks (shows up on their phone).", { title: str("The task"), notes: str("Optional details"), due: str("Optional due date YYYY-MM-DD") }, ["title"]),
  google_complete_task: fn("google_complete_task", "Mark a Google Tasks task as done.", { id: str("The task's id"), listId: str("Its list id (default list if left out)") }, ["id"]),
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

// Builder mode (builder.js): code tools, starters, commands, preview; inside the allowed folders
const BUILDER_TOOLS = {
  edit_file_part: fn(
    "edit_file_part",
    "Change part of a text file: replace an exact piece of text with new text. Better than edit_file for code: read the file first and copy the exact lines (with their spaces) to replace.",
    { path: str("File path"), find: str("The exact text to replace (must be in the file once)"), replace: str("The new text"), all: { type: "BOOLEAN", description: "Replace every place it appears" } },
    ["path", "find", "replace"]
  ),
  read_file_lines: fn("read_file_lines", "Read part of a (big) text file, with line numbers.", { path: str("File path"), start_line: num("First line (default 1)"), end_line: num("Last line (default start + 299)") }, ["path"]),
  search_code: fn(
    "search_code",
    "Search the files in a folder (skipping node_modules, .git, build output) for text, with file names and line numbers.",
    { path: str("Folder (or file) to search"), query: str("Text to find"), regex: { type: "BOOLEAN", description: "query is a regular expression" }, file_ending: str("Optional: only files ending like this, e.g. .js") },
    ["path", "query"]
  ),
  project_tree: fn("project_tree", "Show a project's files and folders a few levels deep.", { path: str("The project folder"), depth: num("Levels (default 3)") }, ["path"]),
  create_project: fn(
    "create_project",
    `Start a new project from a starter in a new folder: ${templates.describe()}.`,
    { template: { type: "STRING", enum: templates.names(), description: "Which starter" }, name: str("Project name (becomes the folder name)"), folder: str("Optional: the folder to put it in (default: the first allowed folder)") },
    ["template", "name"]
  ),
  run_command: fn(
    "run_command",
    "Run a shell command in a project folder: install packages, run tests and builds, git, scaffolders. Use background for things that keep running (dev servers); their address comes back.",
    { command: str("The command, e.g. 'npm install' or 'npm test'"), folder: str("The folder to run it in"), reason: str("One short line: why (shown to the user when it asks)"), background: { type: "BOOLEAN", description: "Keep it running (a dev server, a watcher)" }, timeout_seconds: num("For normal commands: how long it may take (default from Settings)") },
    ["command", "folder"]
  ),
  command_output: fn("command_output", "The latest output of a command running in the background.", { id: str("Its id") }),
  stop_command: fn("stop_command", "Stop a command running in the background, or a preview.", { id: str("Its id") }),
  preview_site: fn("preview_site", "Serve a website folder (with index.html) on this computer and get its address, to look at it in the browser.", { folder: str("The folder with index.html (for a built app: its dist or build folder)") }),
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
// options.live: Gemini Live (it searches the web by itself, so no web_search).
function declarations(settings, { voice = false, robot: onScreen = false, nonBlocking = false, workspace = true, onAir = false, live = false } = {}) {
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
      WORKSPACE_TOOLS.update_calendar_event,
      WORKSPACE_TOOLS.delete_calendar_event,
      WORKSPACE_TOOLS.search_gmail,
      WORKSPACE_TOOLS.read_gmail,
      WORKSPACE_TOOLS.draft_gmail,
      WORKSPACE_TOOLS.send_gmail,
      WORKSPACE_TOOLS.youtube_my_channel,
      WORKSPACE_TOOLS.youtube_video,
      WORKSPACE_TOOLS.youtube_comments,
      WORKSPACE_TOOLS.youtube_search,
      WORKSPACE_TOOLS.google_tasks,
      WORKSPACE_TOOLS.google_add_task,
      WORKSPACE_TOOLS.google_complete_task,
    );
  }
  if (online) list.push(WORKSPACE_TOOLS.search_github, WORKSPACE_TOOLS.get_news);
  // Connected apps (connectors/): weather, web, Wikipedia, GitHub, Notion, Home Assistant…
  list.push(...connectors.declarations(settings, { hidden, live }));
  // Any other app, through MCP (mcp.js)
  list.push(...mcp.declarations(settings, { hidden }));

  if (settings.aiNotes?.enabled) {
    list.push(NOTE_TOOLS.save_note, NOTE_TOOLS.delete_note);
  }
  if (settings.life?.enabled !== false && !hidden) list.push(...Object.values(LIFE_TOOLS));
  // Builder mode: needs an allowed folder; commands only in their mode
  const b = settings.builder || {};
  if (b.enabled !== false && p.folders.length && !hidden) {
    if (p.files.edit) list.push(BUILDER_TOOLS.edit_file_part);
    if (p.files.read) list.push(BUILDER_TOOLS.read_file_lines, BUILDER_TOOLS.search_code);
    if (p.dirs.read) list.push(BUILDER_TOOLS.project_tree);
    if (p.files.create && p.dirs.create) list.push(BUILDER_TOOLS.create_project);
    if (b.commands && b.commands !== "off") list.push(BUILDER_TOOLS.run_command, BUILDER_TOOLS.command_output, BUILDER_TOOLS.stop_command);
    if (p.files.read) list.push(BUILDER_TOOLS.preview_site);
  }
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

// Small local models do better with fewer tools, and every tool takes room in
// their context. With "Local AI tools: essential" (Settings → AI & privacy) they
// get these, plus file tools and the robot; "all" gives them everything.
const ESSENTIAL = new Set([
  "edit_file_part", "read_file_lines", "search_code", "project_tree", "create_project", "run_command", "command_output", "stop_command", "preview_site",
  "save_note", "recall_conversations", "resolve_follow_up", "write_draft",
  "add_task", "update_task", "list_tasks", "set_reminder", "list_reminders", "log_habit", "daily_briefing",
  "get_weather", "web_search", "read_webpage",
  "search_gmail", "get_calendar_events",
  "home_devices", "home_control",
]);

function forLocal(list, settings) {
  if (settings.aiControl?.localTools === "all") return list;
  // Apps you added yourself (MCP) are kept too
  return list.filter((t) => ESSENTIAL.has(t.name) || Object.hasOwn(FILE_TOOLS, t.name) || isRobotTool(t.name) || t.name.startsWith("mcp_"));
}

// "folder" → the dirs permissions, "file" → the files permissions
const allowedFor = (p, type, action) => (type === "folder" ? p.dirs : p.files)[action];

// Checks and describes a file action before it runs. Returns { summary, run }.
async function planFileAction(name, args, settings) {
  const p = settings.permissions;
  const at = (x) => files.resolve(x, p.folders);
  const deny = (what) => {
    throw new Error(`You don't have permission to ${what}. The user can allow it in Settings → AI & privacy.`);
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

// ---------- Builder mode (builder.js) ----------
async function runBuilder(name, args, ctx) {
  const s = ctx.settings;
  const p = s.permissions;
  const b = s.builder || {};
  if (b.enabled === false) throw new Error("Builder mode is off (Settings → Builder).");
  const at = (x) => files.resolve(x, p.folders);
  const need = (ok, what) => {
    if (!ok) throw new Error(`You don't have permission to ${what}. The user can allow it in Settings → AI & privacy.`);
  };
  const say = (line) => ctx.onActivity?.(line);
  // Changing a file asks, like the other file tools, when "Ask before acting" is on
  const ask = async (summary, details = { type: "file" }) => {
    if (p.askBeforeActing && !(await ctx.confirm(summary, details))) {
      say(`You declined: ${summary}`);
      throw Object.assign(new Error("The user declined this action."), { declined: true });
    }
  };
  switch (name) {
    case "edit_file_part": {
      need(p.files.edit, "edit files");
      const { real } = await at(args.path);
      await ask(`change part of ${files.shown(real)}`);
      const r = await builder.editPart(real, args.find, args.replace, { all: args.all === true });
      say(`Edited ${r.path}${r.replaced > 1 ? ` (${r.replaced} places)` : ""}`);
      return { ok: true, ...r };
    }
    case "read_file_lines": {
      need(p.files.read, "read files");
      const { real } = await at(args.path);
      const r = await builder.readLines(real, args.start_line, args.end_line);
      say(`Read ${r.path} (lines ${r.from}-${r.to})`);
      return { ok: true, ...r };
    }
    case "search_code": {
      need(p.files.read, "read files");
      const { real } = await at(args.path);
      const r = await builder.search(real, args.query, { regex: args.regex === true, glob: args.file_ending || "" });
      say(`Searched ${files.shown(real)} for "${args.query}": ${r.matches.length} match${r.matches.length === 1 ? "" : "es"}`);
      return { ok: true, ...r };
    }
    case "project_tree": {
      need(p.dirs.read, "see inside folders");
      const { real } = await at(args.path);
      return { ok: true, ...(await builder.tree(real, Math.min(6, Math.max(1, Number(args.depth) || 3)))) };
    }
    case "create_project": {
      need(p.files.create && p.dirs.create, "create files and folders");
      const { real } = await at(args.folder || p.folders[0]);
      await ask(`create the project "${args.name}" (${args.template}) in ${files.shown(real)}`);
      const r = await builder.createProject(real, args.name, args.template);
      if (r.command) return { ok: true, nextStep: "Run this with run_command in the given folder", command: r.command, folder: r.cwd, note: r.note };
      say(`Created the project ${r.path}`);
      return { ok: true, ...r };
    }
    case "run_command": {
      const { real } = await at(args.folder);
      if ((await files.kind(real)) !== "folder") throw new Error("That folder doesn't exist.");
      const command = String(args.command || "").trim();
      if (!command) throw new Error("Which command?");
      if (command.length > 2000) throw new Error("That command is too long.");
      const { action, risky } = await builder.decide(command, s, real);
      if (action === "off") throw new Error("Running commands is off. The user can turn it on in Settings → Builder.");
      if (action === "suggest") {
        say(`Suggested: ${command}`);
        return { ok: true, suggestedOnly: true, command, folder: files.shown(real), note: "Commands are in 'suggest only' mode: show the user the command so they can run it themselves." };
      }
      if (action === "ask" && !(await ctx.confirm(`Run ${command}`, { type: "command", command, cwd: files.shown(real), reason: [args.reason, risky ? "⚠️ This can change or delete things outside the project." : ""].filter(Boolean).join(" ") }))) {
        say(`You declined: ${command}`);
        return { error: "The user declined running this command." };
      }
      if (args.background === true) {
        const r = await builder.runCommand(command, real, { background: true });
        say(`Started ${command}${r.url ? ` → ${r.url}` : ""} (id ${r.id})`);
        return { ok: true, ...r };
      }
      say(`Running ${command}…`);
      const r = await builder.runCommand(command, real, { timeout: args.timeout_seconds || b.timeout });
      say(`${r.exitCode === 0 ? "✓" : "✗"} ${command} (${r.timedOut ? "stopped: took too long" : `exit ${r.exitCode}`}, ${r.seconds} s)`);
      return { ok: r.exitCode === 0, ...r };
    }
    case "command_output":
      return { ok: true, ...builder.commandOutput(args.id) };
    case "stop_command": {
      const r = builder.stop(args.id);
      say(`Stopped ${r.stopped}`);
      return r;
    }
    case "preview_site": {
      need(p.files.read, "read files");
      const { real } = await at(args.folder);
      if ((await files.kind(real)) !== "folder") throw new Error("That folder doesn't exist.");
      const r = await builder.preview(real);
      say(`Preview: ${r.url}`);
      return { ok: true, ...r, note: "Give the user this address as a link; it works on this computer only." };
    }
  }
  throw new Error(`Unknown tool ${name}.`);
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
  extras.push(connectors.briefing(ctx, out).catch(() => {}));
  await Promise.all(extras);
  return out;
}

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

    // Builder mode
    if (Object.hasOwn(BUILDER_TOOLS, name)) return await runBuilder(name, args, ctx);

    // Connected apps
    if (connectors.find(name)) return await connectors.run(name, args, ctx);
    if (name.startsWith("mcp_")) {
      const result = await mcp.run(name, args, ctx);
      if (result) return result;
      throw new Error("That app isn't connected anymore.");
    }

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
      ctx.onActivity?.(args.from || args.to ? `Checking your calendar${args.from ? ` from ${args.from}` : ""}${args.to ? ` to ${args.to}` : ""}` : "Checking upcoming Google Calendar schedule");
      const events = await workspace.getCalendarEvents(token, args.maxResults || 10, { from: args.from, to: args.to });
      ctx.onActivity?.(`Found ${events.length} calendar events`);
      return { ok: true, events };
    }

    if (name === "search_gmail") {
      ctx.onActivity?.(`Searching Gmail for "${args.query}"`);
      const messages = await workspace.searchGmail(token, args.query);
      ctx.onActivity?.(`Found ${messages.length} email threads`);
      return { ok: true, messages };
    }

    if (name === "read_gmail") {
      const m = await workspace.readGmail(token, args.id);
      ctx.onActivity?.(`Read the email "${m.subject}"`);
      return { ok: true, message: m };
    }

    if (name === "draft_gmail") {
      const d = await workspace.draftGmail(token, args);
      ctx.onActivity?.(`Saved a draft in Gmail to ${args.to}`);
      return { ok: true, draft: d };
    }

    if (name === "youtube_my_channel") {
      ctx.onActivity?.("Checking your YouTube channel");
      return { ok: true, ...(await workspace.youtubeMyChannel(token)) };
    }
    if (name === "youtube_video") {
      ctx.onActivity?.("Looking at a YouTube video");
      return { ok: true, video: await workspace.youtubeVideo(token, args.video) };
    }
    if (name === "youtube_comments") {
      ctx.onActivity?.("Reading YouTube comments");
      return { ok: true, comments: await workspace.youtubeComments(token, args.video, args.max) };
    }
    if (name === "youtube_search") {
      ctx.onActivity?.(`Searching YouTube for "${args.query}"`);
      return { ok: true, results: await workspace.youtubeSearch(token, args.query, args.type) };
    }

    if (name === "google_tasks") {
      ctx.onActivity?.("Checking Google Tasks");
      return { ok: true, lists: await workspace.googleTasks(token, { showCompleted: args.show_completed === true }) };
    }
    if (name === "google_add_task") {
      const t = await workspace.googleAddTask(token, args);
      ctx.onActivity?.(`Added to Google Tasks: ${t.title}`);
      return { ok: true, task: t };
    }
    if (name === "google_complete_task") {
      const t = await workspace.googleCompleteTask(token, args);
      ctx.onActivity?.(`Done in Google Tasks: ${t.title}`);
      return { ok: true, task: t };
    }

    if (name === "update_calendar_event" || name === "delete_calendar_event") {
      const del = name === "delete_calendar_event";
      const summaryText = del ? "Delete an event from Google Calendar" : `Change the calendar event${args.summary ? ` to "${args.summary}"` : ""}${args.start ? ` (starts ${args.start})` : ""}`;
      if (confirmWorkspace && !(await ctx.confirm(summaryText, { type: "calendar", ...args }))) {
        ctx.onActivity?.(`You declined: ${summaryText}`);
        return { error: "The user declined this change." };
      }
      const result = del ? await workspace.deleteCalendarEvent(token, args.eventId) : await workspace.updateCalendarEvent(token, args);
      ctx.onActivity?.(del ? "Deleted a calendar event" : `Changed the calendar event ${result.summary || ""}`.trim());
      return { ok: true, event: result };
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
    if (!err.declined) ctx.onActivity?.(`Couldn't complete ${name.replace(/_/g, " ")}: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { declarations, forLocal, run, isRobotTool, robotEvent, briefing };
