// ---------- The robot's design: what it looks like ----------
// Pure data and small functions (no DOM, no three.js), used by the page (the
// Robot Studio, the 3D robot) and by the helper (which cleans what is saved).
// A design is one plain object:
//
//   colors   head, body, arms, joint (neck and shoulders), light (fins, ring, eyes;
//            "" = the app's accent color), face (eyes and mouth; "" = the light), user (the
//            light while you talk; "" = picked to differ from the light)
//   finish   how the shell feels: matte … pearl
//   glow     how bright its lights are
//   build    size, head, roundness, width, height, arms, hands, top (sizes, 0.5 … 1.6) and the
//            shapes: bodyShape, handStyle, topStyle, hover
//   face     eyes (a style), eyeSize, eyeGap, mouth (a style), blush
//   outfit   seven slots (hat, glasses, headgear, neck, torso, back, chest), each
//            { item, c1, c2, pattern }
//
// The catalogs below hold the English names the Studio shows (the helper's
// translation check reads them from here: see labels()). The 3D shapes are made in
// model.js and outfit/*.js; every id here has one.

export const HEX = /^#[0-9a-f]{6}$/i;

const entries = (list) => Object.fromEntries(list.map((e) => [e.id, e]));

// ---------- Choices ----------
export const FINISHES = [
  { id: "matte", label: "Matte", icon: "◌" },
  { id: "satin", label: "Satin", icon: "◍" },
  { id: "glossy", label: "Glossy", icon: "●" },
  { id: "metal", label: "Metallic", icon: "◆" },
  { id: "pearl", label: "Pearl", icon: "✦" },
];

export const TOPS = [
  { id: "fins", label: "Glowing fins", icon: "📡" },
  { id: "antenna", label: "Antenna", icon: "📶" },
  { id: "twin", label: "Two antennae", icon: "🐛" },
  { id: "cat", label: "Cat ears", icon: "🐱" },
  { id: "bear", label: "Bear ears", icon: "🐻" },
  { id: "bunny", label: "Bunny ears", icon: "🐰" },
  { id: "sprout", label: "Sprout", icon: "🌱" },
  { id: "horns", label: "Little horns", icon: "😈" },
  { id: "none", label: "Nothing", icon: "∅" },
];

export const BODIES = [
  { id: "bean", label: "Bean", icon: "🫘" },
  { id: "egg", label: "Egg", icon: "🥚" },
  { id: "capsule", label: "Capsule", icon: "💊" },
  { id: "ball", label: "Ball", icon: "⚽" },
  { id: "pear", label: "Pear", icon: "🍐" },
];

export const HANDS = [
  { id: "paddle", label: "Paddles", icon: "🏓" },
  { id: "ball", label: "Balls", icon: "🔵" },
  { id: "mitten", label: "Mittens", icon: "🧤" },
  { id: "pincer", label: "Pincers", icon: "🦀" },
];

export const HOVERS = [
  { id: "ring", label: "Ring", icon: "⭕" },
  { id: "double", label: "Two rings", icon: "🎯" },
  { id: "jets", label: "Jets", icon: "🔥" },
  { id: "none", label: "Nothing", icon: "∅" },
];

// Eye styles: the numbers are in presets.mjs (EYE_STYLES); these are the names
export const EYES = [
  { id: "classic", label: "Classic", icon: "▮▮" },
  { id: "round", label: "Round", icon: "●●" },
  { id: "wide", label: "Wide", icon: "▬▬" },
  { id: "big", label: "Big", icon: "◉◉" },
  { id: "dots", label: "Dots", icon: "••" },
  { id: "tall", label: "Tall", icon: "❙❙" },
  { id: "square", label: "Pixel", icon: "■■" },
  { id: "visor", label: "Visor", icon: "▬" },
];

export const MOUTHS = [
  { id: "line", label: "Smile", icon: "‿" },
  { id: "small", label: "Small", icon: "·" },
  { id: "wide", label: "Wide", icon: "⌣" },
  { id: "bold", label: "Bold", icon: "◡" },
  { id: "none", label: "None", icon: "∅" },
];

export const PATTERNS = [
  { id: "solid", label: "Plain", icon: "■" },
  { id: "stripes", label: "Stripes", icon: "☰" },
  { id: "bands", label: "Bands", icon: "≡" },
  { id: "dots", label: "Dots", icon: "⁘" },
  { id: "checks", label: "Checks", icon: "▦" },
  { id: "gradient", label: "Fade", icon: "◐" },
  { id: "stars", label: "Stars", icon: "★" },
];

// ---------- Outfit ----------
// items[id].colors: the colors it starts with; names: what each color is called
export const SLOTS = [
  { id: "hat", label: "Hat", pattern: false },
  { id: "glasses", label: "Face", pattern: false },
  { id: "headgear", label: "Ears", pattern: false },
  { id: "neck", label: "Neck", pattern: false },
  { id: "torso", label: "Clothes", pattern: true },
  { id: "back", label: "Back", pattern: false },
  { id: "chest", label: "Chest", pattern: false },
];

const none = { id: "none", label: "Nothing", icon: "∅", colors: [], names: [] };
const item = (id, label, icon, colors, names) => ({ id, label, icon, colors, names });

export const OUTFIT = {
  hat: [
    none,
    item("beanie", "Beanie", "🧶", ["#e05a47", "#f4efe6"], ["Hat", "Bobble"]),
    item("cap", "Cap", "🧢", ["#3b6fd6", "#f4efe6"], ["Cap", "Button"]),
    item("tophat", "Top hat", "🎩", ["#26282e", "#c0392b"], ["Hat", "Band"]),
    item("beret", "Beret", "🎨", ["#c0392b", "#26282e"], ["Beret", "Stalk"]),
    item("party", "Party hat", "🥳", ["#f06bb0", "#ffd34d"], ["Hat", "Pompom"]),
    item("crown", "Crown", "👑", ["#f2c14e", "#d9435b"], ["Crown", "Jewels"]),
    item("wizard", "Wizard hat", "🧙", ["#5b4bb7", "#ffd34d"], ["Hat", "Stars"]),
    item("chef", "Chef's hat", "👨‍🍳", ["#f6f4ef", "#d8d3c8"], ["Hat", "Folds"]),
    item("propeller", "Propeller cap", "🚁", ["#4aa3df", "#e8453c"], ["Cap", "Blades"]),
    item("cowboy", "Cowboy hat", "🤠", ["#a3743f", "#5b3a1e"], ["Hat", "Band"]),
    item("santa", "Santa hat", "🎅", ["#d32f2f", "#f8f5ee"], ["Hat", "Fur"]),
    item("bow", "Big bow", "🎀", ["#f06bb0", "#c2417f"], ["Bow", "Knot"]),
    item("flower", "Flower", "🌸", ["#f48fb1", "#ffd54f"], ["Petals", "Middle"]),
    item("halo", "Halo", "😇", ["#ffe27a", "#ffffff"], ["Halo", "Glow"]),
  ],
  glasses: [
    none,
    item("round", "Round glasses", "🤓", ["#2b2e35", "#bfe3ff"], ["Frame", "Lens"]),
    item("square", "Square glasses", "👓", ["#d9534f", "#bfe3ff"], ["Frame", "Lens"]),
    item("sunglasses", "Sunglasses", "🕶️", ["#16181d", "#2b3345"], ["Frame", "Lens"]),
    item("heart", "Heart glasses", "😍", ["#e84a7f", "#ffb3cd"], ["Frame", "Lens"]),
    item("star", "Star glasses", "🤩", ["#f2c14e", "#fff3b0"], ["Frame", "Lens"]),
    item("visor", "Visor", "🥽", ["#2b2e35", "#6ee7f9"], ["Frame", "Lens"]),
    item("monocle", "Monocle", "🧐", ["#c9a227", "#e8f6ff"], ["Frame", "Lens"]),
    item("eyepatch", "Eye patch", "🏴‍☠️", ["#1d1f24", "#1d1f24"], ["Patch", "Strap"]),
    item("mustache", "Mustache", "🥸", ["#7b4a2a", "#936036"], ["Mustache", "Tips"]),
  ],
  headgear: [
    none,
    item("headphones", "Headphones", "🎧", ["#2b2e35", "#6f9cf5"], ["Band", "Cushions"]),
    item("headset", "Headset with mic", "🎙️", ["#2b2e35", "#f06bb0"], ["Band", "Cushions"]),
    item("earmuffs", "Earmuffs", "🧣", ["#e05a47", "#f4efe6"], ["Band", "Fluff"]),
  ],
  neck: [
    none,
    item("scarf", "Scarf", "🧣", ["#d9534f", "#f4efe6"], ["Scarf", "Stripes"]),
    item("bowtie", "Bow tie", "🎀", ["#c0392b", "#8e2a20"], ["Bow", "Knot"]),
    item("tie", "Necktie", "👔", ["#2a6fdb", "#f4efe6"], ["Tie", "Stripes"]),
    item("bandana", "Bandana", "🏴", ["#c0392b", "#f4efe6"], ["Cloth", "Dots"]),
    item("ruff", "Frilly collar", "🤴", ["#f6f4ef", "#d8d3c8"], ["Frill", "Shade"]),
    item("medal", "Medal", "🏅", ["#f2c14e", "#d9435b"], ["Medal", "Ribbon"]),
    item("bell", "Collar with bell", "🔔", ["#d9534f", "#f2c14e"], ["Collar", "Bell"]),
    item("collar", "Shirt collar", "👕", ["#f6f4ef", "#2a6fdb"], ["Collar", "Tie"]),
  ],
  torso: [
    none,
    item("tee", "T-shirt", "👕", ["#3b9be0", "#f4efe6"], ["Shirt", "Pattern"]),
    item("sweater", "Sweater", "🧶", ["#d9534f", "#f4efe6"], ["Sweater", "Pattern"]),
    item("hoodie", "Hoodie", "🥶", ["#6f5bd6", "#f4efe6"], ["Hoodie", "Strings"]),
    item("vest", "Vest", "🦺", ["#3a4a63", "#c9a227"], ["Vest", "Buttons"]),
    item("overalls", "Overalls", "👖", ["#3b6fd6", "#f2c14e"], ["Overalls", "Buttons"]),
    item("apron", "Apron", "🍳", ["#f4efe6", "#d9534f"], ["Apron", "Trim"]),
    item("jacket", "Jacket", "🧥", ["#2b2e35", "#f2c14e"], ["Jacket", "Trim"]),
  ],
  back: [
    none,
    item("cape", "Cape", "🦸", ["#c0392b", "#f2c14e"], ["Cape", "Lining"]),
    item("backpack", "Backpack", "🎒", ["#e08a2b", "#2b2e35"], ["Pack", "Straps"]),
    item("wings", "Angel wings", "🪽", ["#ffffff", "#e6eefc"], ["Wings", "Shade"]),
    item("butterfly", "Butterfly wings", "🦋", ["#7a5cf0", "#f06bb0"], ["Top", "Bottom"]),
    item("jetpack", "Jetpack", "🚀", ["#9aa3b2", "#e8453c"], ["Tanks", "Flames"]),
    item("tail", "Fluffy tail", "🦊", ["#e08a2b", "#f8f5ee"], ["Tail", "Tip"]),
  ],
  chest: [
    none,
    item("core", "Glowing core", "🔆", ["", "#2b2e35"], ["Light", "Rim"]),
    item("heart", "Heart", "❤️", ["#e84a7f", "#ffb3cd"], ["Heart", "Shine"]),
    item("star", "Star", "⭐", ["#f2c14e", "#fff3b0"], ["Star", "Shine"]),
    item("bolt", "Lightning bolt", "⚡", ["#ffd34d", "#e08a2b"], ["Bolt", "Edge"]),
    item("badge", "Name badge", "🏷️", ["#f4efe6", "#3b6fd6"], ["Badge", "Stripe"]),
    item("buttons", "Buttons", "🔘", ["#26282e", "#f2c14e"], ["Buttons", "Rims"]),
  ],
};

export const ITEMS = Object.fromEntries(Object.entries(OUTFIT).map(([slot, list]) => [slot, entries(list)]));

// ---------- Colors to pick from ----------
export const SHELL_COLORS = [
  { id: "warm", label: "Warm white", color: "#ede4d6" },
  { id: "cloud", label: "Cloud", color: "#e2e7ee" },
  { id: "graphite", label: "Graphite", color: "#50555f" },
  { id: "peach", label: "Peach", color: "#f0ccb6" },
  { id: "mint", label: "Mint", color: "#c9e5d6" },
  { id: "rose", label: "Rose", color: "#f4b6c8" },
  { id: "butter", label: "Butter", color: "#f6e08a" },
  { id: "sky", label: "Sky", color: "#a9d0f5" },
  { id: "lavender", label: "Lavender", color: "#c9b8f0" },
  { id: "coral", label: "Coral", color: "#f08a73" },
  { id: "forest", label: "Forest", color: "#4d8a62" },
  { id: "navy", label: "Midnight", color: "#2b3a67" },
  { id: "ink", label: "Ink", color: "#25272d" },
  { id: "silver", label: "Silver", color: "#c4c9d2" },
  { id: "gold", label: "Gold", color: "#d9b25a" },
  { id: "copper", label: "Copper", color: "#c47a5a" },
];

export const JOINT_COLORS = ["#2b2e35", "#f4efe6", "#8f96a3", "#d9534f", "#3b6fd6", "#f2c14e", "#4d8a62", "#f06bb0"];

export const LIGHT_COLORS = ["#6f9cf5", "#5eead4", "#a3e635", "#ffd34d", "#ffb074", "#f472b6", "#c084fc", "#ff6b6b", "#ffffff"];

// ---------- Numbers ----------
// [min, max, default, step]
export const RANGES = {
  glow: [0.4, 1.6, 1, 0.05],
  build: {
    size: [0.85, 1.2, 1, 0.01],
    head: [0.8, 1.3, 1, 0.01],
    roundness: [0, 1, 0.5, 0.01],
    width: [0.8, 1.3, 1, 0.01],
    height: [0.8, 1.35, 1, 0.01],
    arms: [0.6, 1.5, 1, 0.01],
    hands: [0.7, 1.4, 1, 0.01],
    top: [0.5, 1.6, 1, 0.01],
  },
  face: { eyeSize: [0.7, 1.4, 1, 0.01], eyeGap: [0.7, 1.3, 1, 0.01] },
};

// ---------- The default robot ----------
export const DEFAULT_DESIGN = Object.freeze({
  colors: { head: "#ede4d6", body: "#ede4d6", arms: "#ede4d6", joint: "#2b2e35", light: "", face: "", user: "" },
  finish: "glossy",
  glow: 1,
  build: { size: 1, head: 1, roundness: 0.5, width: 1, height: 1, arms: 1, hands: 1, top: 1, bodyShape: "bean", handStyle: "paddle", topStyle: "fins", hover: "ring" },
  face: { eyes: "classic", eyeSize: 1, eyeGap: 1, mouth: "line", blush: "#ff6f91" },
  outfit: Object.fromEntries(SLOTS.map((s) => [s.id, { item: "none", c1: "", c2: "", pattern: "solid" }])),
});

export const defaultDesign = () => JSON.parse(JSON.stringify(DEFAULT_DESIGN));

// ---------- Cleaning ----------
const oneOf = (list, value, fallback) => (list.some((e) => e.id === value) ? value : fallback);
const color = (value, fallback, allowEmpty = false) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : allowEmpty && value === "" ? "" : fallback);
const num = (value, [min, max, def]) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 1000) / 1000)) : def;
};
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// Any input becomes a complete, valid design; anything unknown falls back to `base`
export function sanitizeDesign(input, base = DEFAULT_DESIGN) {
  const d = obj(input);
  const out = defaultDesign();
  const b = { ...DEFAULT_DESIGN, ...obj(base) };
  const c = obj(d.colors);
  const bc = { ...DEFAULT_DESIGN.colors, ...obj(b.colors) };
  for (const key of ["head", "body", "arms", "joint"]) out.colors[key] = color(c[key], color(bc[key], DEFAULT_DESIGN.colors[key]));
  for (const key of ["light", "face", "user"]) out.colors[key] = color(c[key], color(bc[key], "", true), true);
  out.finish = oneOf(FINISHES, d.finish, oneOf(FINISHES, b.finish, "glossy"));
  out.glow = num(d.glow ?? b.glow, RANGES.glow);

  const bd = obj(d.build);
  const bb = { ...DEFAULT_DESIGN.build, ...obj(b.build) };
  for (const [key, range] of Object.entries(RANGES.build)) out.build[key] = num(bd[key] ?? bb[key], range);
  out.build.bodyShape = oneOf(BODIES, bd.bodyShape, oneOf(BODIES, bb.bodyShape, "bean"));
  out.build.handStyle = oneOf(HANDS, bd.handStyle, oneOf(HANDS, bb.handStyle, "paddle"));
  out.build.topStyle = oneOf(TOPS, bd.topStyle, oneOf(TOPS, bb.topStyle, "fins"));
  out.build.hover = oneOf(HOVERS, bd.hover, oneOf(HOVERS, bb.hover, "ring"));

  const fd = obj(d.face);
  const fb = { ...DEFAULT_DESIGN.face, ...obj(b.face) };
  out.face.eyes = oneOf(EYES, fd.eyes, oneOf(EYES, fb.eyes, "classic"));
  out.face.mouth = oneOf(MOUTHS, fd.mouth, oneOf(MOUTHS, fb.mouth, "line"));
  out.face.eyeSize = num(fd.eyeSize ?? fb.eyeSize, RANGES.face.eyeSize);
  out.face.eyeGap = num(fd.eyeGap ?? fb.eyeGap, RANGES.face.eyeGap);
  out.face.blush = color(fd.blush, color(fb.blush, "#ff6f91"));

  const od = obj(d.outfit);
  const ob = obj(b.outfit);
  for (const slot of SLOTS) {
    const s = obj(od[slot.id]);
    const base_ = obj(ob[slot.id]);
    const list = OUTFIT[slot.id];
    const id = oneOf(list, s.item, oneOf(list, base_.item, "none"));
    const def = ITEMS[slot.id][id];
    // Colors the same item had in `base` are kept; a different item starts with its own
    const sameBase = base_.item === id;
    const pick = (key, i) => color(s[key], sameBase ? color(base_[key], def.colors[i] ?? "", true) : def.colors[i] ?? "", true);
    out.outfit[slot.id] = {
      item: id,
      c1: id === "none" ? "" : pick("c1", 0),
      c2: id === "none" ? "" : pick("c2", 1),
      pattern: slot.pattern ? oneOf(PATTERNS, s.pattern, oneOf(PATTERNS, base_.pattern, "solid")) : "solid",
    };
  }
  return out;
}

// What the older settings had (a shell color name, an eye style, the mouth on or off)
export function designFromLegacy({ shell, eyes, mouth } = {}) {
  const shellColor = SHELL_COLORS.find((s) => s.id === shell)?.color;
  const d = defaultDesign();
  if (shellColor) d.colors.head = d.colors.body = d.colors.arms = shellColor;
  if (EYES.some((e) => e.id === eyes)) d.face.eyes = eyes;
  if (mouth === false) d.face.mouth = "none";
  return sanitizeDesign(d);
}

// A key that changes only when the robot's shapes change, not its colors (the 3D robot is rebuilt then)
export function shapeKey(design) {
  const { build, outfit } = design;
  const worn = Object.entries(outfit).map(([slot, o]) => `${slot}:${o.item}${o.pattern !== "solid" ? "/" + o.pattern : ""}`);
  return JSON.stringify([build, worn]);
}

// ---------- Surprise me ----------
const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

// A tiny seeded random generator (so a seed always makes the same robot)
export function seededRandom(seed = Date.now()) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// A harmonious random robot: one shell family, matching clothes, a light that fits
export function randomDesign(seed = Date.now()) {
  const rand = seededRandom(seed);
  const d = defaultDesign();
  const shell = pick(rand, SHELL_COLORS).color;
  const twoTone = rand() < 0.3;
  const second = pick(rand, SHELL_COLORS).color;
  d.colors.head = shell;
  d.colors.body = twoTone ? second : shell;
  d.colors.arms = twoTone ? second : shell;
  d.colors.joint = pick(rand, JOINT_COLORS);
  d.colors.light = pick(rand, LIGHT_COLORS);
  d.finish = pick(rand, FINISHES).id;
  const r = (key) => {
    const [min, max] = RANGES.build[key];
    return Math.round((min + (max - min) * (0.25 + rand() * 0.5)) * 100) / 100;
  };
  for (const key of ["head", "roundness", "width", "height", "arms", "hands", "top"]) d.build[key] = r(key);
  d.build.bodyShape = pick(rand, BODIES).id;
  d.build.handStyle = pick(rand, HANDS).id;
  d.build.topStyle = pick(rand, TOPS.filter((t) => t.id !== "none")).id;
  d.build.hover = pick(rand, HOVERS.filter((h) => h.id !== "none")).id;
  d.face.eyes = pick(rand, EYES).id;
  d.face.mouth = pick(rand, MOUTHS.filter((m) => m.id !== "none")).id;
  // A few pieces of clothing, each in a color from a small family
  const accent = pick(rand, ["#e05a47", "#3b6fd6", "#f2c14e", "#4d8a62", "#f06bb0", "#7a5cf0", "#2b2e35"]);
  const wear = (slot, chance) => {
    if (rand() > chance) return;
    const choices = OUTFIT[slot].filter((i) => i.id !== "none");
    const it = pick(rand, choices);
    d.outfit[slot] = { item: it.id, c1: rand() < 0.5 ? accent : it.colors[0], c2: it.colors[1] ?? "", pattern: "solid" };
    if (slot === "torso") d.outfit.torso.pattern = pick(rand, PATTERNS).id;
  };
  wear("hat", 0.6);
  wear("glasses", 0.45);
  wear("headgear", 0.15);
  wear("neck", 0.5);
  wear("torso", 0.5);
  wear("back", 0.25);
  wear("chest", 0.3);
  return sanitizeDesign(d);
}

// All the English names the Studio shows (the helper's translation check reads these)
export function labels() {
  const out = new Set();
  for (const list of [FINISHES, TOPS, BODIES, HANDS, HOVERS, EYES, MOUTHS, PATTERNS, SLOTS, ...Object.values(OUTFIT)]) {
    for (const e of list) {
      out.add(e.label);
      for (const n of e.names || []) out.add(n);
    }
  }
  for (const s of SHELL_COLORS) out.add(s.label);
  return [...out];
}
