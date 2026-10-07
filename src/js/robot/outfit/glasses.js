// Things on the face, in front of the screen: glasses, a monocle, an eye patch, a mustache.
// They find the eyes through eyeSpec(), so they fit whatever eyes the robot has.
import * as THREE from "three";
import { eyeSpec, roundedRect, plate, starGeometry, heartGeometry } from "./kit.js";

// A pair of lenses: draws one shape per eye plus a bridge and short arms toward the ears
function pair(c, { frame, lens, shapeFor, radius, bridge = true }) {
  const g = new THREE.Group();
  const eye = eyeSpec(c);
  const frameMat = c.paint(1, { roughness: 0.4, metalness: 0.1 });
  const lensMat = c.paint(2, { roughness: 0.1, metalness: 0, transparent: true, opacity: lens, depthWrite: false });
  for (const s of [1, -1]) {
    const lensGroup = new THREE.Group();
    lensGroup.position.set(s * eye.x, eye.y, eye.z);
    const { outer, inner } = shapeFor(radius, s);
    lensGroup.add(c.make(plate(frame(outer, inner), 0.008, 0.002), frameMat, { shadow: false }));
    const disc = c.make(plate(inner, 0.002, 0), lensMat, { shadow: false });
    disc.position.z = -0.001;
    lensGroup.add(disc);
    g.add(lensGroup);
    // The arm: from the outer edge back along the side of the head
    const edge = eye.x + radius * 0.95;
    const side = c.dims.headSide(eye.y, eye.z - 0.012) - 0.002;
    const length = Math.max(0.012, side - edge);
    const arm = c.make(new THREE.CylinderGeometry(0.0042, 0.0042, length, 8), frameMat, { shadow: false });
    arm.rotation.z = Math.PI / 2;
    arm.position.set(s * (edge + length / 2), eye.y, eye.z - 0.012);
    g.add(arm);
  }
  if (bridge) {
    const b = c.make(new THREE.TorusGeometry(0.02, 0.0042, 8, 16, Math.PI), frameMat, { shadow: false });
    b.position.set(0, eye.y + radius * 0.2, eye.z);
    g.add(b);
  }
  return g;
}

const ring = (outer, inner) => {
  // Rings from two circles
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
};

const lensShape = (shape) => shape;

const round = (c) => {
  const e = eyeSpec(c);
  const r = Math.max(0.072, Math.max(e.rx, e.ry) * 1.5);
  const circle = (rad) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, rad, 0, Math.PI * 2, false);
    return s;
  };
  return {
    object: pair(c, {
      frame: (outer, inner) => ring(outer.r, inner.r),
      lens: 0.16,
      radius: r,
      shapeFor: (rad) => ({ outer: { r: rad }, inner: Object.assign(circle(rad - 0.0085), { r: rad - 0.0085 }) }),
    }),
  };
};

const rectFrame = (w, h, rad, wall) => (c, opts) => {
  const e = eyeSpec(c);
  const W = Math.max(w, e.rx * 2 * 1.5);
  const H = Math.max(h, e.ry * 2 * 1.35);
  return {
    object: pair(c, {
      frame: (outer) => outer,
      lens: opts.lens,
      radius: W / 2,
      shapeFor: () => ({ outer: roundedRect(W, H, rad, wall), inner: roundedRect(W - wall * 2, H - wall * 2, Math.max(0.002, rad - wall * 0.6)) }),
    }),
  };
};

const square = (c) => rectFrame(0.15, 0.115, 0.02, 0.0085)(c, { lens: 0.16 });
const sunglasses = (c) => rectFrame(0.165, 0.1, 0.03, 0.01)(c, { lens: 0.72 });

const shaped = (build, scale, lens) => (c) => {
  const e = eyeSpec(c);
  const r = Math.max(0.075, Math.max(e.rx, e.ry) * 1.55) * scale;
  return {
    object: pair(c, {
      frame: (outer) => outer,
      lens,
      radius: r,
      bridge: true,
      shapeFor: (rad) => build(rad),
    }),
  };
};

// A shape's outline as a Shape with a hole (for a frame), plus the inner shape (for the lens)
const outlineOf = (geo2d, scaleInner) => {
  // geo2d: the points of a closed shape
  const pts = geo2d;
  const outer = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, p.y)));
  const hole = new THREE.Path(pts.map((p) => new THREE.Vector2(p.x * scaleInner, p.y * scaleInner)).reverse());
  outer.holes.push(hole);
  const inner = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * scaleInner, p.y * scaleInner)));
  return { outer, inner };
};

const heartPoints = (r, n = 48) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // The classic heart curve, scaled to fit about 2r wide
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new THREE.Vector2((x / 17) * r, (y / 17) * r + r * 0.05));
  }
  return pts;
};

const starPoints = (r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.5;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * rad, Math.sin(a) * rad));
  }
  return pts;
};

const heart = shaped((r) => outlineOf(heartPoints(r), 0.76), 1.0, 0.3);
const star = shaped((r) => outlineOf(starPoints(r * 1.08), 0.62), 1.0, 0.3);

const visor = (c) => {
  const g = new THREE.Group();
  const e = eyeSpec(c);
  const frameMat = c.paint(1, { roughness: 0.35, metalness: 0.2 });
  const lensMat = c.paint(2, { roughness: 0.08, transparent: true, opacity: 0.38, depthWrite: false });
  const w = (e.x + e.rx) * 2 + 0.07;
  const h = Math.max(0.1, e.ry * 2 * 1.5);
  const outer = roundedRect(w, h, h * 0.45, 0.009);
  const inner = roundedRect(w - 0.018, h - 0.018, h * 0.45 - 0.006);
  const f = c.make(plate(outer, 0.012, 0.003), frameMat, { shadow: false });
  const l = c.make(plate(inner, 0.002, 0), lensMat, { shadow: false });
  const group = new THREE.Group();
  group.position.set(0, e.y, e.z + 0.002);
  group.add(f, l);
  g.add(group);
  // The strap around the head
  const side = c.dims.headSide(e.y, e.z - 0.02) - 0.002;
  for (const s of [1, -1]) {
    const length = Math.max(0.012, side - w / 2);
    const strap = c.make(new THREE.CylinderGeometry(0.008, 0.008, length, 10), frameMat, { shadow: false });
    strap.rotation.z = Math.PI / 2;
    strap.position.set(s * (w / 2 + length / 2), e.y, e.z - 0.02);
    g.add(strap);
  }
  return { object: g };
};

const monocle = (c) => {
  const g = new THREE.Group();
  const e = eyeSpec(c);
  const r = Math.max(0.07, Math.max(e.rx, e.ry) * 1.5);
  const gold = c.paint(1, { roughness: 0.3, metalness: 0.8 });
  const glass = c.paint(2, { roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false });
  const wrap = new THREE.Group();
  wrap.position.set(e.x, e.y, e.z);
  const rim = c.make(new THREE.TorusGeometry(r, 0.0065, 12, 48), gold, { shadow: false });
  wrap.add(rim);
  const disc = c.make(new THREE.CircleGeometry(r, 36), glass, { shadow: false });
  wrap.add(disc);
  // A little chain hanging down
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(r * 0.7, -r * 0.7, 0), new THREE.Vector3(r * 1.3, -r * 1.5, 0.01), new THREE.Vector3(r * 1.6, -r * 2.4, 0.0), new THREE.Vector3(r * 1.5, -r * 3.0, -0.01)]);
  wrap.add(c.make(new THREE.TubeGeometry(curve, 24, 0.0028, 6), gold, { shadow: false }));
  g.add(wrap);
  return { object: g };
};

const eyepatch = (c) => {
  const g = new THREE.Group();
  const e = eyeSpec(c);
  const patch = c.paint(1, { roughness: 0.6 });
  const strap = c.paint(2, { roughness: 0.6 });
  const r = Math.max(0.065, Math.max(e.rx, e.ry) * 1.35);
  const disc = new THREE.SphereGeometry(r, 32, 16);
  disc.scale(1, 1.05, 0.18);
  const p = c.make(disc, patch, { shadow: false });
  p.position.set(-e.x, e.y, e.z + 0.002);
  g.add(p);
  // The strap: from the patch across the screen up to the side of the head
  const from = new THREE.Vector3(-e.x - r * 0.8, e.y + r * 0.45, e.z);
  const toSide = c.dims.headSide(e.y + 0.1, e.z - 0.06);
  const to = new THREE.Vector3(-toSide + 0.002, e.y + 0.12, e.z - 0.06);
  const curve = new THREE.CatmullRomCurve3([from, new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.01, e.z - 0.02), to]);
  g.add(c.make(new THREE.TubeGeometry(curve, 16, 0.006, 6), strap, { shadow: false }));
  return { object: g };
};

const mustache = (c) => {
  const g = new THREE.Group();
  const e = eyeSpec(c);
  const hair = c.paint(1, { roughness: 0.85 });
  const tips = c.paint(2, { roughness: 0.85 });
  const y = c.dims.head.y + c.dims.head.screen.y - 0.2 * e.half;
  const z = c.dims.headFront(0.05, y) + 0.016;
  for (const s of [1, -1]) {
    const geo = new THREE.SphereGeometry(1, 28, 16);
    geo.scale(0.074, 0.027, 0.024);
    const half = c.make(geo, hair, { shadow: false });
    half.position.set(s * 0.07, y, z);
    half.rotation.z = s * -0.18;
    g.add(half);
    const curl = c.make(new THREE.TorusGeometry(0.022, 0.0105, 8, 18, Math.PI * 1.35), tips, { shadow: false });
    curl.position.set(s * 0.138, y + 0.01, z);
    curl.rotation.z = s > 0 ? Math.PI * 0.55 : Math.PI * 0.05;
    g.add(curl);
  }
  return { object: g };
};

export default { round, square, sunglasses, heart, star, visor, monocle, eyepatch, mustache };
