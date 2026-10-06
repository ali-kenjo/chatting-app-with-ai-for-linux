// ---------- Dressing the robot ----------
// Seven slots (design.mjs SLOTS), each with a builder per item. A builder gets a
// context (sizes, the robot's materials, two paint colors that follow the colors you pick)
// and returns what it made: { object, parent, update?, recolor? }. The core attaches it to
// the named part (Head, Neck, Body…), keeps the colors up to date and sweeps up afterwards.
import * as THREE from "three";
import hats from "./hats.js";
import glasses from "./glasses.js";
import headgear from "./headgear.js";
import neck from "./neck.js";
import torso from "./torso.js";
import back from "./back.js";
import chest from "./chest.js";

const BUILDERS = { hat: hats, glasses, headgear, neck, torso, back, chest };

// Which part each slot hangs on
const PARENTS = { hat: "Head", glasses: "Head", headgear: "Head", neck: "Neck", torso: "Body", back: "Body", chest: "Body" };

export function dress(robot, design, { make, group }) {
  const worn = [];
  const paints = []; // { material, n, light }: colors that follow c1 / c2
  const glowing = new Set();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  for (const slot of Object.keys(BUILDERS)) {
    const o = design.outfit[slot];
    const build = o && BUILDERS[slot][o.item];
    if (!build) continue;
    const mine = { paints: [], glow: [] };
    const paint = (n, options = {}) => {
      const { roughness = 0.6, metalness = 0, physical = false, ...rest } = options;
      const material = physical
        ? new THREE.MeshPhysicalMaterial({ roughness, metalness, clearcoat: 0.25, ...rest })
        : new THREE.MeshStandardMaterial({ roughness, metalness, ...rest });
      mine.paints.push({ material, n });
      paints.push({ material, n });
      return keep(material);
    };
    // A material that glows in color n (or in the robot's light when that color is empty)
    const glow = (n, strength = 1, options = {}) => {
      const material = new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.3, emissive: "#ffffff", emissiveIntensity: strength, ...options });
      mine.glow.push({ material, n, strength });
      glowing.add(material);
      return keep(material);
    };
    const ctx = {
      THREE, make, group, dims: robot.dims, design, nodes: robot.nodes, m: robot.materials, item: o, slot,
      paint, glow, keep, light: robot.light,
    };
    const made = build(ctx);
    if (!made) continue;
    const object = made.object || made;
    object.name = `Outfit_${slot}`;
    const parent = robot.nodes[made.parent || PARENTS[slot]];
    if (!parent) continue;
    parent.add(object);
    // Pieces on other parts too (sleeves on the arms)
    for (const [name, extra] of made.extra || []) robot.nodes[name]?.add(extra);
    worn.push({ slot, object, made, mine });
  }

  const colorOf = (o, n, light) => {
    const hex = n === 1 ? o.c1 : o.c2;
    return hex ? new THREE.Color(hex) : light;
  };
  const tint = (item, design2, light) => {
    const o = design2.outfit[item.slot];
    for (const p of item.mine.paints) p.material.color.copy(colorOf(o, p.n, light));
    for (const g of item.mine.glow) g.material.emissive.copy(colorOf(o, g.n, light));
    item.made.recolor?.(o, light);
  };
  for (const item of worn) tint(item, design, robot.light);

  robot.outfit = {
    worn,
    glowing,
    recolor(design2, light) {
      for (const item of worn) tint(item, design2, light);
    },
    update(pose, time, fx) {
      for (const item of worn) item.made.update?.(pose, time, fx);
    },
    setDetail(rich) {
      for (const item of worn) item.made.setDetail?.(rich);
    },
    dispose() {
      for (const d of disposables) d.dispose?.();
      for (const item of worn) item.made.dispose?.();
    },
  };
}
