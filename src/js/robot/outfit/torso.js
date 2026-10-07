// Clothes for the body: shells that follow its outline (and sleeves that follow its arms).
// Patterns are drawn on a canvas in the two colors and mapped around the body.
import * as THREE from "three";
import { sliceProfile, patternTexture, turned } from "./kit.js";

const SKIN = 0.012; // how far a garment stands off the body

// How often a pattern repeats around and up the body (the body is wider around than it is tall)
const REPEAT = { stripes: [2, 1], bands: [1, 1.5], dots: [3, 1], checks: [3, 1], gradient: [1, 1], stars: [3, 1] };

// The garment's material: the first color, or a pattern of both
function fabric(c, { roughness = 0.92, side } = {}) {
  const o = c.item;
  const options = { roughness };
  if (side !== undefined) options.side = side;
  if (o.pattern === "solid") return { material: c.paint(1, options), redraw: null };
  const material = c.keep(new THREE.MeshStandardMaterial({ ...options, color: "#ffffff" }));
  const { texture, redraw } = patternTexture(o.pattern, o.c1 || "#888888", o.c2 || "#ffffff");
  texture.repeat.set(...REPEAT[o.pattern]);
  material.map = texture;
  c.keep(texture);
  return { material, redraw: (o2) => redraw(o2.c1 || "#888888", o2.c2 || "#ffffff") };
}

// A shell around the body from one height to another, optionally with a gap in the front (phi in radians)
function shell(c, y0, y1, { gap = 0, front = null, off = SKIN } = {}) {
  const { body } = c.dims;
  const points = sliceProfile(body.profile, y0 * body.h, y1 * body.h, off);
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 72, front ? -front : gap / 2, front ? front * 2 : Math.PI * 2 - gap);
  geo.scale(1, 1, body.depth);
  return geo;
}

// A ring of cloth, for cuffs, hems and necklines
function ring(c, material, radius, tube, y, squash = 0.9) {
  const t = c.make(new THREE.TorusGeometry(radius, tube, 12, 56), material);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  t.scale.set(1, 1, squash);
  return t;
}

// Where a garment lives: the Body's origin is its middle, the shells are built from its bottom
const placed = (c, object) => {
  object.position.y = -c.dims.body.h / 2;
  return object;
};

// A sleeve over an arm: from the shoulder down `length`, with an optional cuff
function sleeve(c, material, cuffMaterial, length, radius = 0.056) {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius, radius * 0.93, length, 32, 1, true);
  const tube = c.make(geo, material);
  tube.position.y = 0.025 - length / 2;
  g.add(tube);
  const cap = c.make(new THREE.SphereGeometry(radius, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), material);
  cap.position.y = 0.025;
  g.add(cap);
  if (cuffMaterial) {
    const cuff = c.make(new THREE.TorusGeometry(radius * 0.94, 0.0095, 10, 32), cuffMaterial);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.025 - length;
    g.add(cuff);
  }
  return g;
}

const sleeves = (c, make, flip = false) => [["Arm_L", make(1)], ["Arm_R", make(-1)]];

const tee = (c) => {
  const f = fabric(c);
  const trim = c.paint(2, { roughness: 0.9 });
  const g = new THREE.Group();
  g.add(c.make(shell(c, 0.3, 0.965), f.material));
  g.add(placed(c, g.children.pop()));
  const neckline = ring(c, trim, c.dims.bodyRadius(c.dims.body.h * 0.965) + SKIN - 0.002, 0.009, c.dims.body.h * 0.965 - c.dims.body.h / 2, c.dims.body.depth);
  g.add(neckline);
  g.add(ring(c, trim, c.dims.bodyRadius(c.dims.body.h * 0.3) + SKIN, 0.007, c.dims.body.h * 0.3 - c.dims.body.h / 2, c.dims.body.depth));
  return { object: g, extra: sleeves(c, () => sleeve(c, f.material, trim, 0.075)), recolor: f.redraw };
};

const sweater = (c) => {
  const f = fabric(c);
  const trim = c.paint(2, { roughness: 0.95 });
  const g = new THREE.Group();
  g.add(placed(c, c.make(shell(c, 0.1, 0.97), f.material)));
  const h = c.dims.body.h;
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.97) + SKIN, 0.017, h * 0.97 - h / 2, c.dims.body.depth));
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.1) + SKIN, 0.014, h * 0.1 - h / 2, c.dims.body.depth));
  return { object: g, extra: sleeves(c, () => sleeve(c, f.material, trim, c.dims.arm.length + 0.095)), recolor: f.redraw };
};

const hoodie = (c) => {
  const f = fabric(c);
  const trim = c.paint(2, { roughness: 0.95 });
  const g = new THREE.Group();
  const h = c.dims.body.h;
  g.add(placed(c, c.make(shell(c, 0.1, 0.97), f.material)));
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.1) + SKIN, 0.014, h * 0.1 - h / 2, c.dims.body.depth));
  // The hood: a soft collar behind the neck
  const hood = new THREE.SphereGeometry(1, 36, 24);
  hood.scale(0.15, 0.1, 0.1);
  const hm = c.make(hood, f.material);
  hm.position.set(0, h / 2 - 0.02, -0.075);
  hm.rotation.x = 0.35;
  g.add(hm);
  const rim = c.make(new THREE.TorusGeometry(0.11, 0.022, 14, 40), f.material);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, h / 2 - 0.008, -0.01);
  rim.scale.set(1, 1, 0.9);
  g.add(rim);
  // The pocket and the strings
  const pocket = c.make(new THREE.BoxGeometry(0.17, 0.07, 0.02), f.material);
  const pz = c.dims.body.depth * Math.sqrt(Math.max(0, c.dims.bodyRadius(h * 0.3) ** 2)) + 0.018;
  pocket.position.set(0, 0.3 * h - h / 2, pz);
  pocket.rotation.x = -0.08;
  g.add(pocket);
  for (const s of [1, -1]) {
    const string = c.make(new THREE.CapsuleGeometry(0.005, 0.08, 4, 8), trim);
    const y = 0.8 * h - h / 2;
    string.position.set(s * 0.032, y, c.dims.body.depth * Math.sqrt(Math.max(0, c.dims.bodyRadius(h * 0.8) ** 2 - 0.032 ** 2)) + 0.02);
    g.add(string);
  }
  return { object: g, extra: sleeves(c, () => sleeve(c, f.material, trim, c.dims.arm.length + 0.095)), recolor: f.redraw };
};

const vest = (c) => {
  const f = fabric(c, { roughness: 0.75 });
  const button = c.paint(2, { roughness: 0.3, metalness: 0.7 });
  const g = new THREE.Group();
  g.add(placed(c, c.make(shell(c, 0.18, 0.95, { gap: 0.55 }), f.material)));
  const h = c.dims.body.h;
  for (let i = 0; i < 3; i++) {
    const y = (0.74 - i * 0.13) * h;
    const b = c.make(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 18), button);
    b.rotation.x = Math.PI / 2;
    const r = c.dims.bodyRadius(y) + SKIN;
    b.position.set(-Math.sin(0.275) * r, y - h / 2, c.dims.body.depth * Math.cos(0.275) * r + 0.003);
    b.rotation.y = -0.275;
    g.add(b);
  }
  return { object: g, recolor: f.redraw };
};

const overalls = (c) => {
  const f = fabric(c, { roughness: 0.85 });
  const button = c.paint(2, { roughness: 0.3, metalness: 0.7 });
  const g = new THREE.Group();
  const h = c.dims.body.h;
  g.add(placed(c, c.make(shell(c, 0.0, 0.58), f.material)));
  // The bib in front
  g.add(placed(c, c.make(shell(c, 0.5, 0.84, { front: 0.62, off: SKIN + 0.002 }), f.material)));
  // Straps over the shoulders
  for (const s of [1, -1]) {
    const x = s * 0.075;
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const y = (0.84 + 0.1 * Math.sin(t * Math.PI)) * h;
      const z = (1 - 2 * t) * c.dims.body.depth * Math.sqrt(Math.max(0, c.dims.bodyRadius(Math.min(y, h * 0.93)) ** 2 - x * x)) + (t < 0.5 ? 0.012 : -0.012);
      pts.push(new THREE.Vector3(x, y - h / 2, z));
    }
    const strap = c.make(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.009, 8), f.material, { shadow: false });
    strap.scale.set(1.8, 1, 1);
    strap.position.x = x * -0.8;
    g.add(strap);
    const b = c.make(new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 16), button);
    b.rotation.x = Math.PI / 2;
    const yb = 0.81 * h;
    b.position.set(x * 1.0, yb - h / 2, c.dims.body.depth * Math.sqrt(Math.max(0, c.dims.bodyRadius(yb) ** 2 - x * x)) + SKIN + 0.006);
    g.add(b);
  }
  return { object: g, recolor: f.redraw };
};

const apron = (c) => {
  const f = fabric(c, { roughness: 0.85 });
  const trim = c.paint(2, { roughness: 0.85 });
  const g = new THREE.Group();
  const h = c.dims.body.h;
  g.add(placed(c, c.make(shell(c, 0.1, 0.9, { front: 1.0 }), f.material)));
  const pocket = c.make(new THREE.BoxGeometry(0.15, 0.075, 0.012), trim);
  const yp = 0.3 * h;
  pocket.position.set(0, yp - h / 2, c.dims.body.depth * c.dims.bodyRadius(yp) + SKIN + 0.01);
  pocket.rotation.x = -0.1;
  g.add(pocket);
  // The loop around the neck and the ties at the waist
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.93) + SKIN + 0.002, 0.008, h * 0.93 - h / 2, c.dims.body.depth));
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.38) + SKIN + 0.004, 0.0075, h * 0.38 - h / 2, c.dims.body.depth));
  return { object: g, recolor: f.redraw };
};

const jacket = (c) => {
  const f = fabric(c, { roughness: 0.6 });
  const trim = c.paint(2, { roughness: 0.5, metalness: 0.25 });
  const g = new THREE.Group();
  const h = c.dims.body.h;
  g.add(placed(c, c.make(shell(c, 0.12, 0.96), f.material)));
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.12) + SKIN, 0.014, h * 0.12 - h / 2, c.dims.body.depth));
  g.add(ring(c, trim, c.dims.bodyRadius(h * 0.965) + SKIN + 0.004, 0.02, h * 0.965 - h / 2, c.dims.body.depth));
  // The zip down the middle
  const zip = c.make(new THREE.BoxGeometry(0.009, h * 0.78, 0.004), trim);
  zip.position.set(0, (0.53 * h) - h / 2, c.dims.body.depth * c.dims.bodyRadius(0.53 * h) + SKIN + 0.001);
  g.add(zip);
  return { object: g, extra: sleeves(c, () => sleeve(c, f.material, trim, c.dims.arm.length + 0.095)), recolor: f.redraw };
};

export default { tee, sweater, hoodie, vest, overalls, apron, jacket };
