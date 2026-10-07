// ---------- The robot's surroundings ----------
// Pure data and small functions (no DOM, no three.js), used by the page (the
// Robot Studio, the 3D room) and by the helper (which cleans what is saved).
// A room is one plain object:
//
//   place       which place it is in (PLACES)
//   colors      wall (the backdrop), floor, glow (the soft light behind the robot; "" =
//               its own light color), detail (the set's accent color)
//   light       the lighting mood (LIGHTS)
//   brightness  0.5 … 1.5
//   floor       glossy mirror, matte, glowing grid or no floor
//   air         what drifts through the air (AIRS), and airAmount
//   props       which pieces of the set are there (each place lists its own)
//   sign        the words on a neon sign
//   photo       how your own picture is shown: blur and dim (0 … 1)
//
// The 3D pieces are made in room3d.js and places/*.js; every id here has one.

import { HEX } from "./design.mjs";

// ---------- Choices ----------
export const LIGHTS = [
  { id: "auto", label: "Like the place", icon: "✨" },
  { id: "studio", label: "Studio", icon: "💡" },
  { id: "day", label: "Daylight", icon: "☀️" },
  { id: "golden", label: "Golden hour", icon: "🌇" },
  { id: "evening", label: "Evening", icon: "🌆" },
  { id: "night", label: "Night", icon: "🌙" },
  { id: "neon", label: "Neon", icon: "🌃" },
];

// The three lights and the room's reflections for each mood: [color, strength]
export const LIGHT_MOODS = {
  studio: { key: ["#fff1e0", 1.75], fill: ["#dfe8ff", 0.55], rim: ["#ffffff", 1.5], env: 0.38 },
  day: { key: ["#fff6e8", 1.55], fill: ["#cfe3ff", 0.7], rim: ["#ffffff", 1.0], env: 0.45 },
  golden: { key: ["#ffc27a", 2.0], fill: ["#ffd9b8", 0.45], rim: ["#ffb067", 1.7], env: 0.4 },
  evening: { key: ["#ffb27a", 1.25], fill: ["#8c9eff", 0.65], rim: ["#b48cff", 1.4], env: 0.3 },
  night: { key: ["#9db4ff", 0.95], fill: ["#5a6bd1", 0.55], rim: ["#6ed3ff", 1.6], env: 0.22 },
  neon: { key: ["#ffd0ee", 1.3], fill: ["#5fd8ff", 0.8], rim: ["#a07cff", 1.9], env: 0.28 },
};

export const FLOORS = [
  { id: "auto", label: "Like the place", icon: "✨" },
  { id: "glossy", label: "Glossy mirror", icon: "🪞" },
  { id: "matte", label: "Matte", icon: "▭" },
  { id: "grid", label: "Glowing grid", icon: "▦" },
  { id: "none", label: "No floor", icon: "∅" },
];

export const AIRS = [
  { id: "none", label: "Nothing", icon: "∅" },
  { id: "dust", label: "Dust in the light", icon: "✨" },
  { id: "fireflies", label: "Fireflies", icon: "🪲" },
  { id: "snow", label: "Snow", icon: "❄️" },
  { id: "stars", label: "Twinkling stars", icon: "⭐" },
  { id: "bubbles", label: "Bubbles", icon: "🫧" },
  { id: "petals", label: "Petals", icon: "🌸" },
  { id: "sparkles", label: "Sparkles", icon: "🎉" },
  { id: "embers", label: "Embers", icon: "🔥" },
  { id: "rain", label: "Rain", icon: "🌧️" },
];

const prop = (id, label, on = true) => ({ id, label, on });

// slots: which colors the place uses, and what they're called there
export const PLACES = [
  {
    id: "studio", label: "Studio", icon: "🎬", about: "Dark and calm, with a glossy floor",
    colors: { wall: "#26272c", floor: "#14151a", glow: "", detail: "#ffd9b0" },
    names: { wall: "Backdrop", floor: "Floor", glow: "Glow behind it", detail: "Soft lights" },
    light: "studio", floor: "glossy", air: "dust",
    props: [prop("bokeh", "Soft lights"), prop("shaft", "Beam of light"), prop("rings", "Rings when it talks")],
  },
  {
    id: "glow", label: "Glow", icon: "🔮", about: "Its light color fills the room",
    colors: { wall: "#1b1c22", floor: "#14151a", glow: "", detail: "#ffd9b0" },
    names: { wall: "Backdrop", floor: "Floor", glow: "Glow", detail: "Soft lights" },
    light: "studio", floor: "glossy", air: "dust",
    props: [prop("bokeh", "Soft lights"), prop("shaft", "Beam of light"), prop("rings", "Rings when it talks")],
  },
  {
    id: "desk", label: "Cozy desk", icon: "🪴", about: "A desk corner with a lamp and a plant",
    colors: { wall: "#2f3136", floor: "#553d2d", glow: "#ffd6aa", detail: "#8b9d86" },
    names: { wall: "Wall", floor: "Desk", glow: "Window light", detail: "Plant pot" },
    light: "studio", floor: "matte", air: "dust", ownFloor: true,
    props: [prop("plant", "Plant"), prop("mug", "Mug"), prop("books", "Books"), prop("lamp", "Lamp")],
  },
  {
    id: "podcast", label: "Podcast studio", icon: "🎙️", about: "Sound panels, a mic and a neon sign",
    colors: { wall: "#1d1a26", floor: "#15131b", glow: "", detail: "#3b2f5c" },
    names: { wall: "Wall", floor: "Floor", glow: "Neon", detail: "Sound panels" },
    light: "neon", floor: "glossy", air: "dust",
    props: [prop("sign", "Neon sign"), prop("panels", "Sound panels"), prop("mic", "Microphone"), prop("pendants", "Hanging lamps"), prop("plant", "Plant", false)],
    sign: true,
  },
  {
    id: "lounge", label: "Living room", icon: "🛋️", about: "Evening at home: window, shelf, rug and lights",
    colors: { wall: "#3c3039", floor: "#6b4a3a", glow: "#ffbf80", detail: "#c9744f" },
    names: { wall: "Wall", floor: "Floor", glow: "Lamp light", detail: "Rug" },
    light: "evening", floor: "matte", air: "dust", ownFloor: true,
    props: [prop("window", "Window"), prop("shelf", "Bookshelf"), prop("plant", "Plant"), prop("lamp", "Floor lamp"), prop("rug", "Rug"), prop("lights", "String lights"), prop("frames", "Pictures")],
  },
  {
    id: "space", label: "Space", icon: "🪐", about: "A view of a planet and the stars",
    colors: { wall: "#070816", floor: "#0d1030", glow: "#6a5cff", detail: "#d98a5f" },
    names: { wall: "Space", floor: "Floor", glow: "Nebula", detail: "Planet" },
    light: "night", floor: "grid", air: "stars",
    props: [prop("planet", "Planet"), prop("moon", "Moon"), prop("frame", "Window frame")],
  },
  {
    id: "garden", label: "Sunset hills", icon: "🌄", about: "Rolling hills under a warm sky",
    colors: { wall: "#f3a469", floor: "#4a7a4a", glow: "#ffd9a0", detail: "#f06b8f" },
    names: { wall: "Sky", floor: "Grass", glow: "Sun glow", detail: "Flowers" },
    light: "golden", floor: "matte", air: "petals",
    props: [prop("sun", "Sun"), prop("hills", "Hills"), prop("trees", "Trees"), prop("flowers", "Flowers"), prop("clouds", "Clouds")],
  },
  {
    id: "city", label: "Neon city", icon: "🌃", about: "A night skyline with glowing windows",
    colors: { wall: "#160d33", floor: "#0e0b1c", glow: "#ff3ea5", detail: "#2a1a52" },
    names: { wall: "Night sky", floor: "Street", glow: "Neon", detail: "Buildings" },
    light: "neon", floor: "glossy", air: "none",
    props: [prop("skyline", "Skyline"), prop("moon", "Moon"), prop("neon", "Neon signs")],
    sign: true,
  },
  {
    id: "sky", label: "Clouds", icon: "☁️", about: "Floating among the clouds",
    colors: { wall: "#5aa6f2", floor: "#eaf4ff", glow: "#fff3d6", detail: "#ffffff" },
    names: { wall: "Sky", floor: "Cloud floor", glow: "Sun glow", detail: "Clouds" },
    light: "day", floor: "matte", air: "none",
    props: [prop("sun", "Sun"), prop("clouds", "Clouds"), prop("rainbow", "Rainbow", false)],
  },
  {
    id: "gradient", label: "Gradient", icon: "🎨", about: "Two colors of your choice",
    colors: { wall: "#3a4ea8", floor: "#c0507f", glow: "", detail: "#ffffff" },
    names: { wall: "Top", floor: "Bottom", glow: "Glow", detail: "Lines" },
    light: "studio", floor: "none", air: "none",
    props: [prop("spot", "Spotlight")],
  },
  {
    id: "photo", label: "Your picture", icon: "🖼️", about: "Your own image as the backdrop",
    colors: { wall: "#26272c", floor: "#14151a", glow: "", detail: "#ffffff" },
    names: { wall: "Behind the picture", floor: "Floor", glow: "Glow", detail: "Lines" },
    light: "studio", floor: "none", air: "none",
    props: [],
    photo: true,
  },
  {
    id: "green", label: "Green screen", icon: "🟩", about: "Flat #00B140 for keying out",
    colors: { wall: "#00b140", floor: "#00b140", glow: "", detail: "#ffffff" }, names: {},
    light: "studio", floor: "none", air: "none", props: [], chroma: true,
  },
  {
    id: "blue", label: "Blue screen", icon: "🟦", about: "Flat #0047BB for keying out",
    colors: { wall: "#0047bb", floor: "#0047bb", glow: "", detail: "#ffffff" }, names: {},
    light: "studio", floor: "none", air: "none", props: [], chroma: true,
  },
];

export const PLACE_BY_ID = Object.fromEntries(PLACES.map((p) => [p.id, p]));

export const COLOR_KEYS = ["wall", "floor", "glow", "detail"];

export const RANGES = { brightness: [0.5, 1.5, 1], airAmount: [0.3, 2, 1], blur: [0, 1, 0.25], dim: [0, 0.8, 0.15] };

// ---------- A room for a place ----------
export function roomFor(place = "studio") {
  const p = PLACE_BY_ID[place] || PLACE_BY_ID.studio;
  return {
    place: p.id,
    colors: { ...p.colors },
    light: p.light,
    brightness: 1,
    floor: p.floor,
    air: p.air,
    airAmount: 1,
    props: Object.fromEntries(p.props.map((q) => [q.id, q.on])),
    sign: "ON AIR",
    photo: { blur: RANGES.blur[2], dim: RANGES.dim[2] },
  };
}

export const defaultRoom = () => roomFor("studio");

// Moving to another place starts from that place's own look (what you set for the
// last place doesn't fit this one); the words on a sign and the amount of air stay
export function changePlace(room, place) {
  const next = roomFor(place);
  return { ...next, sign: room?.sign ?? next.sign, airAmount: room?.airAmount ?? 1, brightness: room?.brightness ?? 1, photo: room?.photo ?? next.photo };
}

// What the room really uses (the place's own light and floor when you left them on "Like the place")
export function resolved(room) {
  const p = PLACE_BY_ID[room.place] || PLACE_BY_ID.studio;
  return { light: room.light === "auto" ? p.light : room.light, floor: room.floor === "auto" ? p.floor : room.floor, place: p };
}

// ---------- Cleaning ----------
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const oneOf = (list, value, fallback) => (list.some((e) => e.id === value) ? value : fallback);
const color = (value, fallback, allowEmpty = false) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : allowEmpty && value === "" ? "" : fallback);
const num = (value, [min, max, def]) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)) : def;
};

export function sanitizeRoom(input) {
  const r = obj(input);
  const place = PLACE_BY_ID[r.place] ? r.place : "studio";
  const base = roomFor(place);
  const c = obj(r.colors);
  const out = { ...base };
  out.colors = {
    wall: color(c.wall, base.colors.wall),
    floor: color(c.floor, base.colors.floor),
    glow: color(c.glow, base.colors.glow, true),
    detail: color(c.detail, base.colors.detail),
  };
  out.light = oneOf(LIGHTS, r.light, base.light);
  out.brightness = num(r.brightness, RANGES.brightness);
  out.floor = oneOf(FLOORS, r.floor, base.floor);
  out.air = oneOf(AIRS, r.air, base.air);
  out.airAmount = num(r.airAmount, RANGES.airAmount);
  const props = obj(r.props);
  out.props = Object.fromEntries(PLACE_BY_ID[place].props.map((q) => [q.id, typeof props[q.id] === "boolean" ? props[q.id] : q.on]));
  out.sign = typeof r.sign === "string" ? r.sign.replace(/\s+/g, " ").trim().slice(0, 16) || base.sign : base.sign;
  const photo = obj(r.photo);
  out.photo = { blur: num(photo.blur, RANGES.blur), dim: num(photo.dim, RANGES.dim) };
  return out;
}

// The older settings had one "background": studio, accent, desk, green or blue
export function roomFromLegacy(background) {
  return roomFor({ accent: "glow", studio: "studio", desk: "desk", green: "green", blue: "blue" }[background] || "studio");
}

export function labels() {
  const out = new Set();
  for (const list of [LIGHTS, FLOORS, AIRS]) for (const e of list) out.add(e.label);
  for (const p of PLACES) {
    out.add(p.label);
    out.add(p.about);
    for (const n of Object.values(p.names)) out.add(n);
    for (const q of p.props) out.add(q.label);
  }
  return [...out];
}
