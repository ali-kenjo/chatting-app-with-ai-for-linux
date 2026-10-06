// ---------- The robot's parts ----------
// The shapes the built-in robot is made of, sized by its design (design.mjs):
// the head (a superellipsoid) and its face screen, the body (a lathed profile),
// arms and hands, the "top" (fins, antennae, ears…) and the hover. model.js puts
// them together; outfit/*.js dresses them. Sizes are in meters; the robot faces +z.
import * as THREE from "three";

const lerp = (a, b, t) => a + (b - a) * t;

// ---------- Sizes ----------
// All the numbers that depend on the design, in one place, so that the clothes can fit
export function dimsOf(build) {
  const h = build.head;
  const W = build.width;
  const H = build.height;
  // roundness 0 = a rounded box, 1 = an ellipsoid
  const p = 2 + 2.5 * Math.pow(1 - build.roundness, 1.2);
  const head = { a: 0.36 * h, b: 0.25 * h, c: 0.3 * h, p, y: 0.24 * h };
  head.screen = { w: 0.58 * h, h: 0.36 * h, n: 4.2, y: 0.005 * h };
  const bodyH = 0.53 * H;
  const profile = bodyProfile(build.bodyShape, W, H);
  // The shoulders sit three quarters of the way up
  const shoulderY = 0.755 * bodyH - bodyH / 2; // relative to the Body's middle
  const arm = {
    radius: 0.043,
    length: 0.13 * build.arms,
    hand: 0.066 * build.hands,
    style: build.handStyle,
  };
  const dims = {
    size: build.size,
    hover: 0.15,
    head,
    body: { h: bodyH, W, H, profile, depth: 0.9 },
    neck: { y: bodyH / 2 - 0.03, r: 0.085, h: 0.09 },
    shoulder: { y: shoulderY, x: radiusAt(profile, shoulderY + bodyH / 2) + 0.035 },
    arm,
  };
  dims.headTop = (x = 0) => head.y + head.b * Math.pow(Math.max(0, 1 - Math.abs(x / head.a) ** p), 1 / p);
  // The head's front surface (z) at x and y (y measured from the Head's origin); 0 if off the head
  dims.headFront = (x, y) => {
    const inner = 1 - Math.abs(x / head.a) ** p - Math.abs((y - head.y) / head.b) ** p;
    return head.c * Math.pow(Math.max(inner, 0), 1 / p);
  };
  dims.headSide = (y, z = 0) => {
    const inner = 1 - Math.abs((y - head.y) / head.b) ** p - Math.abs(z / head.c) ** p;
    return head.a * Math.pow(Math.max(inner, 0), 1 / p);
  };
  // The body's radius at a height above its bottom, and its front depth there
  dims.bodyRadius = (yAbove) => radiusAt(profile, yAbove);
  return dims;
}

// ---------- Shapes ----------
// |x/a|^p + |y/b|^p + |z/c|^p = 1: a sphere pushed out into a rounded box
export function superellipsoid(a, b, c, p, widthSegments = 96, heightSegments = 64) {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = Math.pow(Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p, -1 / p);
    pos.setXYZ(i, v.x * k * a, v.y * k * b, v.z * k * c);
  }
  geo.computeVertexNormals();
  return geo;
}

// The face screen: a squircle-shaped patch lying on the head's front surface,
// with texture coordinates running evenly across it
export function faceScreen(head) {
  const { a, b, c, p } = head;
  const { w, h, n, y: dy } = head.screen;
  const segX = 72;
  const segY = 48;
  const positions = [];
  const uvs = [];
  for (let j = 0; j <= segY; j++) {
    for (let i = 0; i <= segX; i++) {
      const s = (i / segX) * 2 - 1;
      const t = (j / segY) * 2 - 1;
      const r = Math.max(Math.abs(s), Math.abs(t));
      let x = 0;
      let y = 0;
      if (r > 0) {
        const dx = s / r;
        const dyy = t / r;
        const k = Math.pow(Math.abs(dx) ** n + Math.abs(dyy) ** n, -1 / n);
        x = r * dx * k * (w / 2);
        y = r * dyy * k * (h / 2);
      }
      const inner = 1 - Math.abs(x / a) ** p - Math.abs((y + dy) / b) ** p;
      const z = c * Math.pow(Math.max(inner, 0), 1 / p) + 0.004;
      positions.push(x, y + dy, z);
      uvs.push(x / w + 0.5, y / h + 0.5);
    }
  }
  const index = [];
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a0 = j * (segX + 1) + i;
      const b0 = a0 + 1;
      const c0 = a0 + segX + 1;
      const d0 = c0 + 1;
      index.push(a0, b0, d0, a0, d0, c0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// A smooth profile turned around the y axis. points: [radius, height] from bottom to top
export function lathe(points, segments = 64) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// A profile through a few control points, smoothed into many
export function smoothProfile(controls, count = 48) {
  const curve = new THREE.SplineCurve(controls.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(count).map((v) => [Math.max(0, v.x), v.y]);
}

// ---------- The body ----------
const BODY_CONTROLS = {
  bean: [[0, 0], [0.13, 0.012], [0.225, 0.07], [0.262, 0.19], [0.245, 0.33], [0.195, 0.45], [0.1, 0.515], [0, 0.53]],
  egg: [[0, 0], [0.1, 0.01], [0.19, 0.06], [0.245, 0.16], [0.265, 0.27], [0.24, 0.38], [0.17, 0.47], [0.085, 0.52], [0, 0.535]],
  capsule: [[0, 0], [0.11, 0.008], [0.19, 0.035], [0.222, 0.09], [0.228, 0.2], [0.228, 0.34], [0.21, 0.43], [0.16, 0.495], [0.08, 0.525], [0, 0.532]],
  pear: [[0, 0], [0.13, 0.01], [0.235, 0.06], [0.29, 0.16], [0.285, 0.26], [0.22, 0.37], [0.145, 0.46], [0.085, 0.515], [0, 0.53]],
};

function ballControls() {
  const R = 0.268;
  const points = [[0, 0]];
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    points.push([R * Math.cos(a), R + R * Math.sin(a)]);
  }
  points.push([0, 2 * R]);
  return points;
}

// The body's outline, widened by `W` and stretched by `H` (a list of [radius, height])
export function bodyProfile(shape, W = 1, H = 1) {
  const controls = shape === "ball" ? ballControls() : BODY_CONTROLS[shape] || BODY_CONTROLS.bean;
  return smoothProfile(controls).map(([r, y]) => [r * W, y * H]);
}

function radiusAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1];
    const [r1, y1] = profile[i];
    if (y >= y0 && y <= y1) return lerp(r0, r1, y1 === y0 ? 0 : (y - y0) / (y1 - y0));
  }
  return profile.at(-1)?.[0] || 0;
}

export function bodyGeometry(dims) {
  const geo = lathe(dims.body.profile, 72);
  geo.scale(1, 1, dims.body.depth);
  return geo;
}

// ---------- The top: fins, antennae, ears… ----------
// Each side is a group named Fin_L / Fin_R (the animator perks and glows them), with a
// glowing part named like "Fin_L_Light". `shell` is the head's material, `glow` the
// side's light, `joint` the dark one. Returns [left, right].
export function buildTop(style, k, dims, m, make) {
  const { head } = dims;
  const side = (name, s, glow) => {
    const g = new THREE.Group();
    g.name = name;
    const light = (geometry, x = 0, y = 0, z = 0) => {
      const tip = make(geometry, glow, { shadow: false });
      tip.name = `${name}_Light`;
      tip.position.set(x, y, z);
      return tip;
    };
    // Where the top sits: on the head's upper corner, a little behind the middle
    const at = (xFrac, down = 0.02) => {
      const x = s * xFrac * head.a;
      g.position.set(x, dims.headTop(x) - down * k, -0.03 * (head.c / 0.3));
    };
    switch (style) {
      case "fins": {
        at(0.69, 0.025);
        g.rotation.z = -s * 0.35;
        const profile = smoothProfile([[0, 0], [0.04, 0.004], [0.042, 0.05], [0.052, 0.1], [0.045, 0.14], [0.022, 0.168], [0, 0.172]], 40);
        const base = lathe(profile.filter(([, y]) => y <= 0.092).concat([[0.05, 0.092]]), 40);
        const tip = lathe([[0.0495, 0.088], ...profile.filter(([, y]) => y > 0.092)], 40);
        for (const geo of [base, tip]) geo.scale(k, k, 0.55 * k);
        g.add(make(base, m.head));
        const l = make(tip, glow, { shadow: false });
        l.name = `${name}_Light`;
        g.add(l);
        break;
      }
      case "antenna": {
        if (s < 0) break; // one antenna in the middle (Fin_L); Fin_R stays empty
        g.position.set(0, dims.headTop(0) - 0.01, -0.02);
        g.add(make(new THREE.CylinderGeometry(0.009 * k, 0.012 * k, 0.15 * k, 16), m.joint, { shadow: false }).translateY(0.075 * k));
        g.add(light(new THREE.SphereGeometry(0.034 * k, 28, 20), 0, 0.165 * k, 0));
        break;
      }
      case "twin": {
        at(0.55, 0.01);
        g.rotation.z = -s * 0.42;
        g.add(make(new THREE.CylinderGeometry(0.008 * k, 0.011 * k, 0.17 * k, 14), m.joint, { shadow: false }).translateY(0.085 * k));
        g.add(light(new THREE.SphereGeometry(0.03 * k, 24, 18), 0, 0.185 * k, 0));
        break;
      }
      case "cat": {
        at(0.62, 0.03);
        g.rotation.z = -s * 0.32;
        const ear = new THREE.ConeGeometry(0.075 * k, 0.13 * k, 4, 1);
        ear.rotateY(Math.PI / 4);
        ear.scale(1, 1, 0.45);
        g.add(make(ear, m.head).translateY(0.05 * k));
        const inner = new THREE.ConeGeometry(0.048 * k, 0.085 * k, 4, 1);
        inner.rotateY(Math.PI / 4);
        inner.scale(1, 1, 0.4);
        g.add(light(inner, 0, 0.04 * k, 0.017 * k));
        break;
      }
      case "bear": {
        at(0.74, 0.04);
        g.rotation.z = -s * 0.5;
        const ear = new THREE.SphereGeometry(0.07 * k, 32, 22);
        ear.scale(1, 1, 0.55);
        g.add(make(ear, m.head).translateY(0.04 * k));
        const inner = new THREE.CircleGeometry(0.04 * k, 28);
        g.add(light(inner, 0, 0.04 * k, 0.04 * k));
        break;
      }
      case "bunny": {
        at(0.46, 0.03);
        g.rotation.z = -s * 0.2;
        const ear = new THREE.CapsuleGeometry(0.045 * k, 0.17 * k, 8, 24);
        ear.scale(1, 1, 0.38);
        g.add(make(ear, m.head).translateY(0.12 * k));
        const inner = new THREE.CapsuleGeometry(0.026 * k, 0.14 * k, 6, 18);
        inner.scale(1, 1, 0.3);
        g.add(light(inner, 0, 0.12 * k, 0.019 * k));
        break;
      }
      case "sprout": {
        if (s < 0) break; // one sprout in the middle; both leaves hang on Fin_L
        g.position.set(0, dims.headTop(0) - 0.01, -0.02);
        g.add(make(new THREE.CylinderGeometry(0.007 * k, 0.01 * k, 0.08 * k, 12), m.joint, { shadow: false }).translateY(0.04 * k));
        for (const dir of [1, -1]) {
          const leaf = new THREE.SphereGeometry(0.05 * k, 24, 16);
          leaf.scale(1, 0.34, 0.7);
          const mesh = light(leaf, dir * 0.052 * k, 0.1 * k, 0);
          mesh.rotation.z = dir * 0.55;
          g.add(mesh);
        }
        break;
      }
      case "horns": {
        at(0.55, 0.035);
        g.rotation.z = -s * 0.4;
        const horn = new THREE.ConeGeometry(0.042 * k, 0.12 * k, 24, 1);
        g.add(make(horn, m.joint).translateY(0.055 * k));
        g.add(light(new THREE.SphereGeometry(0.012 * k, 14, 10), 0, 0.12 * k, 0));
        break;
      }
      default:
        return null;
    }
    return g;
  };
  const L = side("Fin_L", 1, m.finGlowL);
  const R = side("Fin_R", -1, m.finGlowR);
  return [L, R].filter(Boolean);
}

// ---------- Arms and hands ----------
export function buildArm(name, side, dims, m, make) {
  const { arm } = dims;
  const a = new THREE.Group();
  a.name = name;
  a.position.set(side * dims.shoulder.x, dims.shoulder.y, 0);
  a.add(make(new THREE.SphereGeometry(0.052, 32, 20), m.joint));
  const total = arm.length + arm.radius * 2;
  const upper = make(new THREE.CapsuleGeometry(arm.radius, arm.length, 8, 24), m.arms);
  upper.position.y = 0.008 - total / 2;
  a.add(upper);
  const bottom = 0.008 - total;
  const hand = buildHand(arm.style, arm.hand, m, make);
  hand.name = `${name}_Hand`;
  hand.position.y = bottom - 0.017 * (arm.hand / 0.066);
  a.add(hand);
  return a;
}

function buildHand(style, r, m, make) {
  const g = new THREE.Group();
  const s = r / 0.066;
  switch (style) {
    case "ball": {
      g.add(make(new THREE.SphereGeometry(r * 0.9, 36, 26), m.arms));
      break;
    }
    case "mitten": {
      const palm = new THREE.SphereGeometry(r, 36, 26);
      palm.scale(0.95, 1.2, 0.8);
      g.add(make(palm, m.arms));
      const thumb = make(new THREE.SphereGeometry(r * 0.42, 24, 18), m.arms);
      thumb.position.set(0.8 * r, 0.25 * r, 0.1 * r);
      g.add(thumb);
      break;
    }
    case "pincer": {
      const wrist = make(new THREE.SphereGeometry(r * 0.55, 24, 18), m.arms);
      g.add(wrist);
      for (const dir of [1, -1]) {
        const claw = new THREE.CapsuleGeometry(r * 0.3, r * 1.2, 6, 16);
        const mesh = make(claw, m.arms);
        mesh.position.set(dir * r * 0.5, -r * 0.8, 0);
        mesh.rotation.z = dir * 0.28;
        g.add(mesh);
      }
      break;
    }
    default: {
      const hand = new THREE.SphereGeometry(0.066 * s, 40, 28);
      hand.scale(0.82, 1.12, 0.56);
      g.add(make(hand, m.arms));
    }
  }
  return g;
}

// ---------- The hover ----------
export function buildHover(style, dims, m, make) {
  const g = new THREE.Group();
  g.name = "HoverRing";
  const k = dims.body.W;
  const ring = (radius, y, tube = 0.019) => {
    const mesh = make(new THREE.TorusGeometry(radius, tube, 20, 80), m.ring, { shadow: false });
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  };
  switch (style) {
    case "ring":
      g.add(ring(0.16 * k, -0.03));
      break;
    case "double":
      g.add(ring(0.17 * k, -0.03, 0.016), ring(0.12 * k, -0.085, 0.014));
      break;
    case "jets":
      for (const x of [-0.1, 0.1]) {
        const nozzle = make(new THREE.CylinderGeometry(0.05, 0.036, 0.05, 28), m.joint);
        nozzle.position.set(x * k, -0.015, 0);
        g.add(nozzle);
        const flame = make(new THREE.ConeGeometry(0.036, 0.1, 28, 1, true), m.ring, { shadow: false });
        flame.rotation.x = Math.PI;
        flame.position.set(x * k, -0.09, 0);
        g.add(flame);
      }
      break;
    default:
      return null;
  }
  return g;
}
