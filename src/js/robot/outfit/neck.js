// Worn around the neck: a scarf, a bow tie, a necktie, a bandana, a frilly collar, a medal, a bell collar,
// a shirt collar. The Neck part's origin is at the top of the body, a little below the neck itself.
import * as THREE from "three";
import { around } from "./kit.js";

// Where the body's front surface is at a height above the Neck's origin (for things that hang down the chest)
function chestZ(c, below, x = 0) {
  const { body } = c.dims;
  const yAbove = body.h - 0.03 + below; // the neck origin is 3 cm below the top
  const r = c.dims.bodyRadius(Math.max(0.001, yAbove));
  const z = body.depth * Math.sqrt(Math.max(0, r * r - x * x));
  return z + 0.012;
}

const ringAround = (c, mat, radius, tube, y, squash = 1) => {
  const t = c.make(new THREE.TorusGeometry(radius, tube, 16, 56), mat);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  t.scale.set(1, 1, squash);
  return t;
};

const scarf = (c) => {
  const g = new THREE.Group();
  const a = c.paint(1, { roughness: 0.95 });
  const b = c.paint(2, { roughness: 0.95 });
  const wrap = ringAround(c, a, 0.122, 0.052, 0.0, 1);
  wrap.scale.set(1, 1.0, 1.1);
  g.add(wrap);
  const stripe = ringAround(c, b, 0.124, 0.015, 0.012, 1);
  g.add(stripe);
  const stripe2 = ringAround(c, b, 0.12, 0.015, -0.022, 1);
  g.add(stripe2);
  // The tail hanging down the chest, with stripes
  const tail = new THREE.Group();
  const len = 0.24;
  const body = c.make(new THREE.BoxGeometry(0.08, len, 0.026), a);
  body.position.y = -len / 2;
  tail.add(body);
  for (const y of [-0.07, -0.13]) {
    const st = c.make(new THREE.BoxGeometry(0.082, 0.014, 0.028), b);
    st.position.y = y;
    tail.add(st);
  }
  const fringe = around(5, 0, (i) => {
    const f = c.make(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), b);
    f.position.set(-0.032 + i * 0.016, -len - 0.014, 0);
    return f;
  });
  fringe.children.forEach((o) => (o.rotation.y = 0));
  tail.add(fringe);
  tail.position.set(0.06, -0.02, chestZ(c, -0.07, 0.06) - 0.01);
  tail.rotation.x = -0.24;
  g.add(tail);
  return { object: g, update: undefined };
};

const bowtie = (c) => {
  const g = new THREE.Group();
  const a = c.paint(1, { roughness: 0.5, physical: true });
  const b = c.paint(2, { roughness: 0.55 });
  const z = chestZ(c, 0.0) - 0.005;
  for (const s of [1, -1]) {
    const wing = new THREE.ConeGeometry(0.08, 0.12, 4);
    wing.rotateZ(Math.PI / 2 * -s);
    wing.scale(1, 1, 0.5);
    const w = c.make(wing, a);
    w.position.set(s * 0.075, -0.01, z);
    w.rotation.y = 0;
    g.add(w);
  }
  g.add(c.make(new THREE.SphereGeometry(0.034, 20, 14), b).translateX(0).translateY(-0.01).translateZ(z));
  return { object: g };
};

const tie = (c) => {
  const g = new THREE.Group();
  const a = c.paint(1, { roughness: 0.45, physical: true });
  const b = c.paint(2, { roughness: 0.6 });
  const z = chestZ(c, 0.0);
  const knot = c.make(new THREE.CylinderGeometry(0.03, 0.02, 0.045, 4), a);
  knot.rotation.y = Math.PI / 4;
  knot.position.set(0, -0.005, z - 0.002);
  g.add(knot);
  const blade = new THREE.ConeGeometry(0.055, 0.26, 4);
  blade.rotateX(Math.PI);
  blade.rotateY(Math.PI / 4);
  blade.scale(1, 1, 0.22);
  const bl = c.make(blade, a);
  bl.position.set(0, -0.17, chestZ(c, -0.13) - 0.002);
  bl.rotation.x = -0.23;
  g.add(bl);
  const stripe = c.make(new THREE.BoxGeometry(0.078, 0.014, 0.008), b);
  stripe.position.set(0, -0.14, chestZ(c, -0.14) + 0.008);
  stripe.rotation.x = -0.23;
  g.add(stripe);
  return { object: g };
};

const bandana = (c) => {
  const g = new THREE.Group();
  const cloth = c.paint(1, { roughness: 0.9, side: THREE.DoubleSide });
  const dots = c.paint(2, { roughness: 0.9 });
  g.add(ringAround(c, cloth, 0.118, 0.034, 0.0, 1));
  const tri = new THREE.Shape();
  tri.moveTo(-0.155, 0);
  tri.lineTo(0.155, 0);
  tri.lineTo(0, -0.2);
  tri.closePath();
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2 });
  const t = c.make(geo, cloth);
  t.position.set(0, 0.016, chestZ(c, -0.0) - 0.035);
  t.rotation.x = -0.22;
  g.add(t);
  for (const [x, y] of [[-0.05, -0.03], [0.05, -0.03], [0, -0.065], [-0.025, -0.095], [0.025, -0.095]]) {
    const d = c.make(new THREE.SphereGeometry(0.0085, 10, 8), dots);
    d.scale.z = 0.4;
    d.position.set(x, y + 0.016, chestZ(c, y * 0.9, x) + 0.002);
    g.add(d);
  }
  return { object: g };
};

const ruff = (c) => {
  const g = new THREE.Group();
  const a = c.paint(1, { roughness: 0.9 });
  const b = c.paint(2, { roughness: 0.9 });
  const geo = new THREE.SphereGeometry(1, 20, 14);
  geo.scale(0.05, 0.03, 0.05);
  g.add(around(16, 0.112, (i) => {
    const f = c.make(geo, i % 2 ? a : b);
    f.position.y = 0.014 + (i % 2) * 0.012;
    return f;
  }));
  g.add(ringAround(c, a, 0.108, 0.02, 0.0));
  return { object: g };
};

const medal = (c) => {
  const g = new THREE.Group();
  const gold = c.paint(1, { roughness: 0.25, metalness: 0.85 });
  const ribbon = c.paint(2, { roughness: 0.7 });
  g.add(ringAround(c, ribbon, 0.1, 0.0085, 0.01));
  for (const s of [1, -1]) {
    const strip = c.make(new THREE.BoxGeometry(0.028, 0.16, 0.006), ribbon);
    strip.position.set(s * 0.045, -0.07, chestZ(c, -0.07, s * 0.045) - 0.008);
    strip.rotation.z = s * -0.35;
    strip.rotation.x = -0.18;
    g.add(strip);
  }
  const disc = c.make(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 40), gold);
  disc.rotation.x = Math.PI / 2 - 0.15;
  disc.position.set(0, -0.15, chestZ(c, -0.15) + 0.004);
  g.add(disc);
  const star = c.make(new THREE.TorusGeometry(0.024, 0.004, 8, 24), gold);
  star.position.copy(disc.position);
  star.position.z += 0.005;
  star.rotation.x = -0.15;
  g.add(star);
  return { object: g };
};

const bell = (c) => {
  const g = new THREE.Group();
  const collar = c.paint(1, { roughness: 0.6 });
  const gold = c.paint(2, { roughness: 0.25, metalness: 0.85 });
  g.add(ringAround(c, collar, 0.1, 0.014, 0.01));
  const bellMesh = c.make(new THREE.SphereGeometry(0.028, 24, 18), gold);
  bellMesh.position.set(0, -0.025, chestZ(c, -0.02) - 0.002);
  g.add(bellMesh);
  const slit = c.make(new THREE.BoxGeometry(0.036, 0.004, 0.004), collar);
  slit.position.set(0, -0.033, chestZ(c, -0.03) + 0.026);
  g.add(slit);
  const ringTop = c.make(new THREE.TorusGeometry(0.008, 0.0025, 8, 14), gold);
  ringTop.position.set(0, 0.006, chestZ(c, 0.0) - 0.004);
  g.add(ringTop);
  return { object: g };
};

const collar = (c) => {
  const g = new THREE.Group();
  const shirt = c.paint(1, { roughness: 0.8, side: THREE.DoubleSide });
  const tieM = c.paint(2, { roughness: 0.55 });
  g.add(ringAround(c, shirt, 0.112, 0.024, 0.01));
  for (const s of [1, -1]) {
    const flap = new THREE.Shape();
    flap.moveTo(0, 0.025);
    flap.lineTo(s * 0.11, 0.04);
    flap.lineTo(s * 0.065, -0.125);
    flap.closePath();
    const f = c.make(new THREE.ExtrudeGeometry(flap, { depth: 0.01, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.002, bevelSegments: 2 }), shirt);
    f.position.set(0, 0.0, chestZ(c, -0.03, s * 0.04) - 0.004);
    f.rotation.x = -0.22;
    g.add(f);
  }
  const knot = c.make(new THREE.ConeGeometry(0.03, 0.045, 4), tieM);
  knot.rotation.set(Math.PI, Math.PI / 4, 0);
  knot.position.set(0, -0.012, chestZ(c, -0.0) + 0.002);
  knot.scale.z = 0.4;
  g.add(knot);
  return { object: g };
};

export default { scarf, bowtie, tie, bandana, ruff, medal, bell, collar };
