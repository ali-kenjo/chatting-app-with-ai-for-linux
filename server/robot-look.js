// The robot's look: what it looks like (design) and what's around it (room). The
// shapes of both, their choices and how a saved one is cleaned live in
// src/js/robot/design.mjs and room.mjs, which the page uses too (plain ES modules
// with no browser parts), so the two sides can't drift apart.
const design = require("../src/js/robot/design.mjs");
const room = require("../src/js/robot/room.mjs");

const MAX_LOOKS = 24;
const clone = (v) => JSON.parse(JSON.stringify(v));

// One saved look: a name, a design and a room
function cleanLook(input, id) {
  const l = input && typeof input === "object" ? input : {};
  return {
    id: /^[\w-]{1,40}$/.test(l.id) ? l.id : id,
    name: typeof l.name === "string" ? l.name.replace(/\s+/g, " ").trim().slice(0, 40) || "My look" : "My look",
    design: design.sanitizeDesign(l.design),
    room: room.sanitizeRoom(l.room),
  };
}

// settings.robot.looks, cleaned: at most 24, each id used once
function cleanLooks(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_LOOKS) break;
    const look = cleanLook(item, `look-${Date.now().toString(36)}-${out.length}`);
    if (seen.has(look.id)) continue;
    seen.add(look.id);
    out.push(look);
  }
  return out;
}

// Older settings kept a shell color name, eye style and mouth switch (robot.shell, .eyes,
// .mouth) and a background (robot.background): they become the design and the room
function upgradeRobot(robot) {
  if (!robot || typeof robot !== "object") return robot;
  const next = { ...robot };
  if (!next.design) next.design = design.designFromLegacy(robot);
  if (!next.room) next.room = room.roomFromLegacy(robot.background);
  return next;
}

module.exports = { design, room, MAX_LOOKS, clone, cleanLook, cleanLooks, upgradeRobot };
