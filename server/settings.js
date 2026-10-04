// Everything from the Settings panel, stored as settings.json.
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const characters = require("./characters");

const file = path.join(dataDir, "settings.json");

const DEFAULTS = {
  font: { family: "default", size: 15 },
  // How conversations look: "minimal" (only your messages in bubbles) or "bubbles",
  // "comfortable" or "compact" spacing, and follow-up chips under the last reply
  chat: { style: "minimal", density: "comfortable", suggestions: true },
  theme: { appearance: "dark", accent: "#6f9cf5" },
  // What the AI may do with files on this computer (see files.js)
  permissions: {
    folders: [],
    files: { create: false, read: true, edit: false, delete: false },
    dirs: { create: false, read: true, edit: false, delete: false },
    askBeforeActing: true,
    useTrash: true,
  },
  // Copies of your data folder in <data folder>/backups (see backup.js)
  backup: { auto: true, keep: 10 },
  // Private mode: only a local AI answers, and nothing is sent to Google, GitHub
  // or news sites (no Gemini, Live, Google sign-in, GitHub search or news)
  privacy: { localOnly: false },
  // Which AI answers (see router.js): "fixed" is the one brain you pick in the model menu
  routing: {
    mode: "fixed", // fixed | auto | dynamic | fastest | local | cloud
    askBeforeCloud: "chat", // in auto, dynamic and fastest: "always" | "chat" (once per chat) | "never"
    // Auto and Dynamic: what sends a message to the cloud AI (everything else stays local)
    auto: { longChats: true, hardQuestions: true, attachments: true, voiceLocal: true },
    // Dynamic: also reacts to how the local AI is doing
    dynamic: { escalate: true, slowSeconds: 45 },
  },
  // "Your memories": written by you, always given to the AI when enabled
  memory: { enabled: true, items: [] },
  // The AI's own notes (stored separately, see notes.js)
  aiNotes: { enabled: true },
  // Who the AI is (see characters.js): Atlas, Mira, or your own; one is active.
  // switchLook: switching also changes the robot's look and the accent color.
  characters: { active: "atlas", switchLook: true, list: [] },
  // Being a companion you can talk to for hours
  companion: {
    recall: true, // remembers past conversations (episodes.js) and can look them up
    followUps: true, // asks about things you mentioned before
    activities: true, // suggests games, debates and stories when a conversation runs dry
    greeting: true, // starts voice conversations with something from last time
    interests: "", // what you love talking about, for fresh topics
  },
  // Tasks, reminders, habits and the journal (life.js), and the daily briefing
  life: {
    enabled: true, // the AI gets the tools and the Today panel shows
    notify: true, // reminders as notifications on this computer
    speak: true, // in voice mode, the character says a reminder out loud
    briefing: { auto: false, time: "08:00" }, // a briefing waiting as a chat every morning
    briefingNews: true, // headlines in the briefing (not in Private mode)
  },
  // Builder mode (builder.js): code tools, project starters, commands, preview
  builder: {
    enabled: true, // the code tools, starters and preview (inside the allowed folders)
    commands: "ask", // BUILDER_MODES: off | suggest | ask | smart | auto
    allow: [], // more commands Smart may run by itself (their beginnings)
    block: [], // commands that always ask, also in Auto (parts of them)
    timeout: 120, // seconds a command may take
  },
  // The desktop app (Electron)
  desktop: {
    tray: true, // keeps running in the tray when the window is closed, so reminders still come
    autostart: false, // starts (in the tray) when you log in
  },
  // On camera: co-host mode for videos, streams and podcasts
  onAir: {
    auto: true, // on by itself in filming mode and while recording
    format: "podcast", // ON_AIR.formats
    show: "", // the show's name
    audience: "", // who's watching
    hidePrivate: true, // nothing private (memories, emails, calendar, files) on camera
    familyFriendly: true,
  },
  personality: {
    name: "",
    userName: "", // what the AI calls you; empty = your login name
    voice: 1,
    speed: 5,
    style: "Friendly",
    length: 2,
    creativity: 5,
    everydayLanguage: true,
    naturalPauses: true,
    emotions: true,
    curious: true,
    typingPace: false,
    customInstructions: "",
  },
  aiControl: {
    reasoningEffort: "balanced", // "fast" | "balanced" | "deep"
    searchGrounding: true,
    confirmTools: true,
    contextWindow: 20,
    localTools: "essential", // "essential" | "all": how many tools a local AI gets (see tools.forLocal)
  },
  // The AI's 3D robot body (Settings → Robot): the "Robot" style in voice mode
  // and the little one next to text chats. See src/js/robot/.
  robot: {
    chatDock: true, // the robot next to text chats
    shell: "warm", // ROBOT.shells
    mouth: true,
    eyes: "classic", // ROBOT.eyes
    background: "studio", // ROBOT.backgrounds
    shot: "medium", // ROBOT.shots
    position: "center", // ROBOT.positions: where the robot stands in the picture
    seat: "front", // ROBOT.seats: where you sit, so it can turn to you
    followFace: false, // eyes follow you through the webcam (all on this computer)
    cinematic: false, // gentle camera drift and a push-in on emphasis
    roam: true, // in voice mode it moves about the room, and you can poke it and drag the view
    world: true, // the room around it: glossy floor and reflection, drifting light, rings on the floor
    aiGestures: { voice: true, chat: false }, // the AI moves the robot itself (robot_mood / robot_gesture)
    smartMoods: false, // one small extra Gemini request per turn to read the mood
    quality: "auto", // ROBOT.qualities
    filming: {
      delay: 3, // seconds before the conversation starts (ROBOT.delays)
      cameraFriendly: true, // no flicker, fine lines or pure white; steadier frames
      largeCaptions: false,
      largerFace: false,
    },
  },
};

const BUILDER_MODES = ["off", "suggest", "ask", "smart", "auto"];
const ON_AIR = { formats: ["podcast", "reaction", "qa", "debate", "explainer", "storytime", "free"] };

// Allowed values of the robot's choices
const ROUTING = { modes: ["fixed", "auto", "dynamic", "fastest", "local", "cloud"], ask: ["always", "chat", "never"] };

const ROBOT = {
  shells: ["warm", "cloud", "graphite", "peach", "mint"],
  eyes: ["classic", "round", "wide"],
  backgrounds: ["studio", "accent", "desk", "green", "blue"],
  shots: ["close", "medium", "wide"],
  positions: ["center", "left", "right"],
  seats: ["front", "left", "right"],
  qualities: ["auto", "low", "medium", "high"],
  delays: [0, 3, 5, 10],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// Keep only known keys with the right type; anything else falls back to the default
function clean(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : clone(fallback);
  if (fallback && typeof fallback === "object") {
    const out = {};
    for (const key of Object.keys(fallback)) {
      out[key] = clean(value && typeof value === "object" ? value[key] : undefined, fallback[key]);
    }
    return out;
  }
  return typeof value === typeof fallback ? value : fallback;
}

function sanitize(input) {
  const s = clean(input, DEFAULTS);
  s.permissions.folders = [...new Set(s.permissions.folders.filter((f) => typeof f === "string" && f.trim()).map((f) => f.trim()))];
  s.memory.items = s.memory.items
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ id: String(m.id || Date.now() + Math.random()), text: m.text.trim().slice(0, 2000) }));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n) || lo));
  s.font.size = clamp(s.font.size, 12, 22);
  if (!["minimal", "bubbles"].includes(s.chat.style)) s.chat.style = "minimal";
  if (!["comfortable", "compact"].includes(s.chat.density)) s.chat.density = "comfortable";
  s.personality.voice = s.personality.voice === 2 ? 2 : 1;
  s.personality.speed = clamp(s.personality.speed, 0, 10);
  s.personality.length = clamp(s.personality.length, 1, 3);
  s.personality.creativity = clamp(s.personality.creativity, 0, 10);
  s.personality.customInstructions = s.personality.customInstructions.slice(0, 5000);
  s.personality.name = s.personality.name.trim().slice(0, 40);
  s.personality.userName = s.personality.userName.trim().slice(0, 40);
  if (!s.aiControl || typeof s.aiControl !== "object") s.aiControl = clone(DEFAULTS.aiControl);
  if (!["fast", "balanced", "deep"].includes(s.aiControl.reasoningEffort)) s.aiControl.reasoningEffort = "balanced";
  s.aiControl.searchGrounding = Boolean(s.aiControl.searchGrounding);
  s.aiControl.confirmTools = Boolean(s.aiControl.confirmTools);
  s.aiControl.contextWindow = clamp(s.aiControl.contextWindow || 20, 5, 50);
  if (!["essential", "all"].includes(s.aiControl.localTools)) s.aiControl.localTools = "essential";
  s.backup.keep = clamp(s.backup.keep, 3, 60);
  s.characters = characters.sanitize(s.characters);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.life.briefing.time)) s.life.briefing.time = "08:00";
  if (!BUILDER_MODES.includes(s.builder.commands)) s.builder.commands = "ask";
  const list = (v) => [...new Set(v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, 100).map((x) => x.slice(0, 200));
  s.builder.allow = list(s.builder.allow);
  s.builder.block = list(s.builder.block);
  s.builder.timeout = clamp(s.builder.timeout, 10, 600);
  s.companion.interests = s.companion.interests.trim().slice(0, 1000);
  if (!ON_AIR.formats.includes(s.onAir.format)) s.onAir.format = "podcast";
  s.onAir.show = s.onAir.show.trim().slice(0, 80);
  s.onAir.audience = s.onAir.audience.trim().slice(0, 300);
  if (!/^#[0-9a-f]{6}$/i.test(s.theme.accent)) s.theme.accent = DEFAULTS.theme.accent;

  s.routing.mode = ROUTING.modes.includes(s.routing.mode) ? s.routing.mode : "fixed";
  s.routing.askBeforeCloud = ROUTING.ask.includes(s.routing.askBeforeCloud) ? s.routing.askBeforeCloud : "chat";
  s.routing.dynamic.slowSeconds = clamp(s.routing.dynamic.slowSeconds, 5, 300);

  const r = s.robot;
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  r.shell = oneOf(r.shell, ROBOT.shells, DEFAULTS.robot.shell);
  r.eyes = oneOf(r.eyes, ROBOT.eyes, DEFAULTS.robot.eyes);
  r.background = oneOf(r.background, ROBOT.backgrounds, DEFAULTS.robot.background);
  r.shot = oneOf(r.shot, ROBOT.shots, DEFAULTS.robot.shot);
  r.position = oneOf(r.position, ROBOT.positions, DEFAULTS.robot.position);
  r.seat = oneOf(r.seat, ROBOT.seats, DEFAULTS.robot.seat);
  r.quality = oneOf(r.quality, ROBOT.qualities, DEFAULTS.robot.quality);
  // Any number of seconds becomes the nearest allowed delay
  const delay = Number.isFinite(r.filming.delay) ? Math.min(10, Math.max(0, r.filming.delay)) : DEFAULTS.robot.filming.delay;
  r.filming.delay = ROBOT.delays.reduce((best, d) => (Math.abs(d - delay) < Math.abs(best - delay) ? d : best));
  return s;
}

let cache = null;

function get() {
  if (cache) return cache;
  let stored = null;
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  // Settings from before there were characters: a name you'd given the AI becomes your own character
  const upgraded = stored && characters.migrate(stored, stored.personality);
  cache = sanitize(upgraded ? { ...stored, characters: upgraded } : stored || {});
  return cache;
}

// fn(settings) after every change (the desktop app follows Settings → Desktop)
const listeners = new Set();
const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

function set(input) {
  cache = sanitize(input);
  writeJson(file, cache);
  for (const fn of listeners) {
    try {
      fn(cache);
    } catch {}
  }
  return cache;
}

// Read settings.json again (after a backup was restored)
function reload() {
  cache = null;
  return get();
}

module.exports = { get, set, reload, onChange, sanitize, DEFAULTS, ROBOT, ROUTING, ON_AIR };
