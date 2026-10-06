// Something on the chest: a glowing core, a heart, a star, a bolt, a name badge, buttons.
import * as THREE from "three";
import { bodySurface, starGeometry, heartGeometry, boltGeometry, plate, roundedRect } from "./kit.js";

// A spot on the front of the body, lying flat on it
function spot(c, y, lift = 0.006) {
  const s = bodySurface(c, y);
  const g = new THREE.Group();
  g.position.set(0, y - c.dims.body.h / 2, s.z + lift);
  g.rotation.x = s.tilt;
  g.scale.setScalar(1.45 * c.dims.body.W ** 0.5);
  return g;
}

const heightOf = (c, f) => c.dims.body.h * f;

const core = (c) => {
  const g = spot(c, heightOf(c, 0.55), 0.004);
  const rim = c.paint(2, { roughness: 0.3, metalness: 0.6 });
  const light = c.glow(1, 1.9);
  const ring = c.make(new THREE.TorusGeometry(0.05, 0.011, 14, 40), rim, { shadow: false });
  g.add(ring);
  const disc = c.make(new THREE.CircleGeometry(0.05, 36), light, { shadow: false });
  disc.position.z = 0.001;
  g.add(disc);
  return {
    object: g,
    update(pose, time) {
      light.emissiveIntensity = 1.5 + 0.35 * Math.sin(time * 2.4) + (pose.speaking || 0) * 0.9;
    },
  };
};

const flat = (build, depth) => (c) => {
  const g = spot(c, heightOf(c, 0.55), 0.004);
  const main = c.paint(1, { roughness: 0.4, physical: true });
  const shine = c.paint(2, { roughness: 0.3 });
  const geo = build(depth);
  const m = c.make(geo, main, { shadow: false });
  g.add(m);
  const hi = c.make(new THREE.SphereGeometry(0.008, 10, 8), shine, { shadow: false });
  hi.position.set(-0.026, 0.026, depth * 0.6);
  hi.scale.z = 0.4;
  g.add(hi);
  return { object: g };
};

const heart = flat(() => heartGeometry(0.044, 0.014), 0.014);
const star = flat(() => starGeometry(0.058, 0.026, 5, 0.012), 0.012);
const bolt = flat(() => boltGeometry(0.055, 0.012), 0.012);

const badge = (c) => {
  const g = spot(c, heightOf(c, 0.58), 0.006);
  const paper = c.paint(1, { roughness: 0.5 });
  const stripe = c.paint(2, { roughness: 0.5 });
  g.add(c.make(plate(roundedRect(0.15, 0.1, 0.014), 0.008, 0.002), paper, { shadow: false }));
  const top = c.make(plate(roundedRect(0.15, 0.03, 0.01), 0.01, 0.002), stripe, { shadow: false });
  top.position.y = 0.035;
  g.add(top);
  // A line of text, drawn on a canvas
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "#1d1f24";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("HELLO", 128, 34);
  const texture = c.keep(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = c.make(new THREE.PlaneGeometry(0.12, 0.03), c.keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false })), { shadow: false });
  label.position.set(0, -0.015, 0.0065);
  g.add(label);
  return { object: g };
};

const buttons = (c) => {
  const g = new THREE.Group();
  const button = c.paint(1, { roughness: 0.35, physical: true });
  const rim = c.paint(2, { roughness: 0.3, metalness: 0.6 });
  for (const f of [0.64, 0.52, 0.4]) {
    const s = spot(c, heightOf(c, f), 0.003);
    const b = c.make(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24), button, { shadow: false });
    b.rotation.x = Math.PI / 2;
    s.add(b);
    const r = c.make(new THREE.TorusGeometry(0.026, 0.0045, 8, 24), rim, { shadow: false });
    r.position.z = 0.004;
    s.add(r);
    g.add(s);
  }
  return { object: g };
};

export default { core, heart, star, bolt, badge, buttons };
