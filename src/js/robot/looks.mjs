// ---------- Ready-made looks ----------
// A look is a design plus a room (design.mjs, room.mjs): a starting point to change, not a rule.
// Each is written as the few things that differ from the default robot; sanitizing fills in the rest.
import { sanitizeDesign, HEX } from "./design.mjs";
import { roomFor, sanitizeRoom } from "./room.mjs";

const all = (color) => ({ head: color, body: color, arms: color });
const wear = (item, c1, c2, pattern) => ({ item, ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}), ...(pattern ? { pattern } : {}) });

const LOOKS = [
  {
    id: "classic", label: "Classic", icon: "🤖", about: "The friendly original",
    design: {},
    room: roomFor("studio"),
  },
  {
    id: "host", label: "Podcast host", icon: "🎙️", about: "Headset, hoodie and a neon sign",
    design: {
      colors: { ...all("#25272d"), joint: "#8f96a3", light: "#c084fc" }, finish: "satin",
      build: { topStyle: "antenna" },
      outfit: { glasses: wear("sunglasses"), headgear: wear("headset", "#3a3d46", "#c084fc"), torso: wear("hoodie", "#6f5bd6", "#f4efe6"), chest: wear("core", "", "#2b2e35") },
    },
    room: { place: "podcast", sign: "ON AIR" },
  },
  {
    id: "pilot", label: "Pilot", icon: "🧑‍✈️", about: "Goggles, a scarf and a jetpack",
    design: {
      colors: { ...all("#c4c9d2"), joint: "#8a5a33", light: "#ffd34d" }, finish: "metal",
      build: { topStyle: "twin", handStyle: "mitten" },
      outfit: { hat: wear("cap", "#8a5a33", "#c9a227"), glasses: wear("visor", "#2b2e35", "#6ee7f9"), neck: wear("scarf", "#f4efe6", "#d9534f"), torso: wear("jacket", "#8a5a33", "#c9a227"), back: wear("jetpack", "#9aa3b2", "#ff8a3d") },
    },
    room: { place: "sky" },
  },
  {
    id: "chef", label: "Chef", icon: "👨‍🍳", about: "A tall hat, a mustache and an apron",
    design: {
      colors: all("#f6e08a"), finish: "satin", face: { eyes: "round" },
      build: { bodyShape: "egg", topStyle: "bear" },
      outfit: { hat: wear("chef"), glasses: wear("mustache", "#4a3326", "#4a3326"), torso: wear("apron", "#f4efe6", "#d9534f"), neck: wear("bandana", "#d9534f", "#f4efe6") },
    },
    room: { place: "desk" },
  },
  {
    id: "wizard", label: "Wizard", icon: "🧙", about: "A starry hat and a purple cape",
    design: {
      colors: { ...all("#c9b8f0"), joint: "#5b4bb7", light: "#c084fc" }, finish: "pearl", face: { eyes: "big" },
      build: { topStyle: "sprout", bodyShape: "pear" },
      outfit: { hat: wear("wizard", "#5b4bb7", "#ffd34d"), glasses: wear("monocle", "#c9a227"), back: wear("cape", "#5b4bb7", "#2b2e35"), chest: wear("star", "#ffd34d", "#fff3b0") },
    },
    room: { place: "space" },
  },
  {
    id: "astronaut", label: "Astronaut", icon: "🧑‍🚀", about: "Shiny white, with a visor and a pack",
    design: {
      colors: { ...all("#e2e7ee"), joint: "#8f96a3", light: "#5eead4" }, finish: "glossy", face: { eyes: "dots" },
      build: { topStyle: "antenna", handStyle: "ball", bodyShape: "capsule", head: 1.1 },
      outfit: { glasses: wear("visor", "#8f96a3", "#ffd34d"), back: wear("jetpack", "#e2e7ee", "#ff8a3d"), chest: wear("buttons", "#e05a47", "#8f96a3"), headgear: wear("headphones", "#e2e7ee", "#8f96a3") },
    },
    room: { place: "space", air: "stars" },
  },
  {
    id: "detective", label: "Detective", icon: "🕵️", about: "A top hat, a monocle and a long night",
    design: {
      colors: { ...all("#50555f"), joint: "#2b2e35", light: "#ffb074" }, finish: "satin", face: { eyes: "wide", mouth: "small" },
      build: { topStyle: "none", bodyShape: "capsule" },
      outfit: { hat: wear("tophat", "#26282e", "#8e2a20"), glasses: wear("monocle", "#c9a227"), neck: wear("tie", "#8e2a20", "#f4efe6"), torso: wear("vest", "#3a4a63", "#c9a227"), chest: wear("badge") },
    },
    room: { place: "city", air: "rain" },
  },
  {
    id: "cozy", label: "Cozy", icon: "🧣", about: "A beanie, a scarf and a warm sweater",
    design: {
      colors: { ...all("#f0ccb6"), light: "#ffb074" }, finish: "matte", face: { eyes: "round" },
      build: { topStyle: "bear", bodyShape: "egg", hover: "none" },
      outfit: { hat: wear("beanie", "#e05a47", "#f4efe6"), neck: wear("scarf", "#3b6fd6", "#f4efe6"), torso: wear("sweater", "#d9534f", "#f4efe6", "bands") },
    },
    room: { place: "lounge", air: "dust" },
  },
  {
    id: "party", label: "Party", icon: "🥳", about: "Confetti, heart glasses and a bow tie",
    design: {
      colors: { ...all("#f4b6c8"), light: "#f472b6" }, finish: "glossy", face: { eyes: "big", mouth: "wide" },
      build: { topStyle: "twin", handStyle: "ball" },
      outfit: { hat: wear("party", "#7a5cf0", "#ffd34d"), glasses: wear("heart"), neck: wear("bowtie", "#7a5cf0", "#5b4bb7"), torso: wear("tee", "#3b9be0", "#ffd34d", "dots") },
    },
    room: { place: "gradient", air: "sparkles", colors: { wall: "#5b4bb7", floor: "#f06bb0" } },
  },
  {
    id: "royal", label: "Royal", icon: "👑", about: "A crown, a cape and a medal",
    design: {
      colors: { ...all("#d9b25a"), joint: "#8e2a20", light: "#ffd34d" }, finish: "metal", face: { eyes: "classic", mouth: "wide" },
      build: { topStyle: "none", head: 1.08 },
      outfit: { hat: wear("crown", "#f2c14e", "#d9435b"), neck: wear("ruff", "#f6f4ef", "#d8d3c8"), back: wear("cape", "#8e2a20", "#f4efe6"), chest: wear("heart", "#d9435b", "#ffb3cd") },
    },
    room: { place: "lounge", light: "golden" },
  },
  {
    id: "angel", label: "Angel", icon: "😇", about: "A halo and soft white wings",
    design: {
      colors: { ...all("#f6f4ef"), joint: "#c4c9d2", light: "#ffe27a" }, finish: "pearl", face: { eyes: "round" },
      build: { topStyle: "none", bodyShape: "egg" },
      outfit: { hat: wear("halo", "#ffe27a"), back: wear("wings", "#ffffff", "#dfe8ff") },
    },
    room: { place: "sky", air: "sparkles" },
  },
  {
    id: "sprout", label: "Gardener", icon: "🌱", about: "A little sprout, overalls and a flower",
    design: {
      colors: { ...all("#c9e5d6"), joint: "#4d8a62", light: "#a3e635" }, finish: "satin", face: { eyes: "round" },
      build: { topStyle: "sprout", bodyShape: "pear", handStyle: "mitten" },
      outfit: { hat: wear("flower", "#f48fb1", "#ffd54f"), torso: wear("overalls", "#3b6fd6", "#f2c14e") },
    },
    room: { place: "garden", air: "petals" },
  },
  {
    id: "neon", label: "Neon", icon: "🌃", about: "Dark, sharp and glowing cyan",
    design: {
      colors: { ...all("#1d1f24"), joint: "#5eead4", light: "#5eead4" }, finish: "glossy", face: { eyes: "visor" },
      build: { topStyle: "horns", hover: "double", roundness: 0.2 },
      outfit: { glasses: wear("sunglasses", "#16181d", "#2b3345"), torso: wear("jacket", "#2b2e35", "#5eead4"), chest: wear("bolt", "#5eead4", "#c4fff4") },
    },
    room: { place: "city", light: "neon" },
  },
  {
    id: "kitty", label: "Kitty", icon: "🐱", about: "Cat ears, a bell and a fluffy tail",
    design: {
      colors: { ...all("#f0ccb6"), joint: "#f06bb0", light: "#f472b6" }, finish: "matte", face: { eyes: "big", mouth: "small" },
      build: { topStyle: "cat", bodyShape: "pear", handStyle: "ball" },
      outfit: { neck: wear("bell", "#d9534f", "#f2c14e"), back: wear("tail", "#f0ccb6", "#f8f5ee") },
    },
    room: { place: "lounge" },
  },
];

export const BUILTIN_LOOKS = LOOKS.map((l) => ({
  id: `builtin:${l.id}`,
  label: l.label,
  icon: l.icon,
  about: l.about,
  builtin: true,
  design: sanitizeDesign(l.design),
  room: sanitizeRoom({ ...l.room, colors: { ...roomFor(l.room.place).colors, ...(l.room.colors || {}) } }),
}));

export function labels() {
  return BUILTIN_LOOKS.flatMap((l) => [l.label, l.about]);
}

// A look from a file you were given (or from a robot someone shared): one cleaned look, or null
export function readLookFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || (data.app && data.app !== "friends-robot-look")) return null;
  if (!data.design && !data.room) return null;
  return {
    name: typeof data.name === "string" ? data.name.replace(/\s+/g, " ").trim().slice(0, 40) : "",
    design: sanitizeDesign(data.design),
    room: sanitizeRoom(data.room),
  };
}

export function lookFile({ name, design, room }) {
  return JSON.stringify({ app: "friends-robot-look", version: 1, name, design, room }, null, 2);
}

export { HEX };
