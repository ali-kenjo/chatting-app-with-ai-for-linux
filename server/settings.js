// Everything from the Settings panel, stored as settings.json.
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");

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
  // "Your memories": written by you, always given to the AI when enabled
  memory: { enabled: true, items: [] },
  // The AI's own notes (stored separately, see notes.js)
  aiNotes: { enabled: true },
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

// Allowed values of the robot's choices
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
  if (!/^#[0-9a-f]{6}$/i.test(s.theme.accent)) s.theme.accent = DEFAULTS.theme.accent;

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
  try {
    cache = sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    cache = clone(DEFAULTS);
  }
  return cache;
}

function set(input) {
  cache = sanitize(input);
  writeJson(file, cache);
  return cache;
}

module.exports = { get, set, sanitize, DEFAULTS, ROBOT };
