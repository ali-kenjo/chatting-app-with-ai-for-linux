// Small shapes the outfit items share.
import * as THREE from "three";
import { EYE_STYLES } from "../presets.mjs";

// A flat star (points × 2 corners), pushed out a little: for stickers, jewels, badges
export function starGeometry(outer, inner, points = 5, depth = 0.01) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: outer * 0.06, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// A heart, the same way
export function heartGeometry(size, depth = 0.012) {
  const s = size;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.9 * s);
  shape.bezierCurveTo(-1.5 * s, -0.1 * s, -1.0 * s, 0.9 * s, 0, 0.35 * s);
  shape.bezierCurveTo(1.0 * s, 0.9 * s, 1.5 * s, -0.1 * s, 0, -0.9 * s);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: s * 0.05, bevelSegments: 3, curveSegments: 18 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// A lightning bolt
export function boltGeometry(size, depth = 0.012) {
  const s = size;
  const shape = new THREE.Shape();
  shape.moveTo(0.15 * s, 1.0 * s);
  shape.lineTo(-0.6 * s, -0.1 * s);
  shape.lineTo(-0.05 * s, -0.1 * s);
  shape.lineTo(-0.2 * s, -1.0 * s);
  shape.lineTo(0.6 * s, 0.15 * s);
  shape.lineTo(0.05 * s, 0.15 * s);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: s * 0.04, bevelSegments: 2 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// A ring of `count` copies of a mesh made by make(i), spaced evenly around the y axis
export function around(count, radius, make, { start = 0 } = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * Math.PI * 2;
    const o = make(i, a);
    o.position.x += Math.sin(a) * radius;
    o.position.z += Math.cos(a) * radius;
    o.rotation.y = a;
    g.add(o);
  }
  return g;
}

// A lathe shape (a profile turned around y): [[radius, height], …]
export function turned(points, segments = 48) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// A smooth curve through control points, as a profile of [radius, height]
export function smooth(controls, count = 40) {
  const curve = new THREE.SplineCurve(controls.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(count).map((v) => [Math.max(0, v.x), v.y]);
}

// Bends a shape sideways by k * y² (a floppy hat tip, a tail)
export function bend(geo, k, axis = "x") {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (axis === "x") pos.setX(i, pos.getX(i) + k * y * y);
    else pos.setZ(i, pos.getZ(i) + k * y * y);
  }
  geo.computeVertexNormals();
  return geo;
}

// Where the eyes are on the head (from the Head's origin), so glasses can sit right on them:
// x (each eye's distance from the middle), y, the eye's half sizes rx and ry, and z in front of the screen
export function eyeSpec({ dims, design }) {
  const { head } = dims;
  const style = EYE_STYLES[design.face.eyes] || EYE_STYLES.classic;
  const half = head.screen.w / 2;
  const x = style.gap * design.face.eyeGap * half;
  const y = head.y + head.screen.y + style.y * half;
  return { x, y, rx: style.w * design.face.eyeSize * half, ry: style.h * design.face.eyeSize * half, z: dims.headFront(x, y) + 0.016, half };
}

// A rounded rectangle outline as a Shape, optionally with a hole of the same shape inset by `wall`
export function roundedRect(w, h, r, wall = 0) {
  const outline = (width, height, radius, shape = new THREE.Shape()) => {
    const x = -width / 2;
    const y = -height / 2;
    const rr = Math.min(radius, width / 2, height / 2);
    shape.moveTo(x + rr, y);
    shape.lineTo(x + width - rr, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + rr);
    shape.lineTo(x + width, y + height - rr);
    shape.quadraticCurveTo(x + width, y + height, x + width - rr, y + height);
    shape.lineTo(x + rr, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - rr);
    shape.lineTo(x, y + rr);
    shape.quadraticCurveTo(x, y, x + rr, y);
    return shape;
  };
  const shape = outline(w, h, r);
  if (wall > 0) shape.holes.push(outline(w - wall * 2, h - wall * 2, Math.max(0.001, r - wall * 0.6), new THREE.Path()));
  return shape;
}

// A frame (or a solid lens when wall is 0) from a Shape
export function plate(shape, depth = 0.01, bevel = 0.0025) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// ---------- Patterns for clothes ----------
// A square canvas drawn with a pattern of two colors, as a repeating texture (redrawn when the colors change)
export function patternTexture(pattern, c1, c2) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  const draw = (a, b) => {
    const g = canvas.getContext("2d");
    g.fillStyle = a;
    g.fillRect(0, 0, size, size);
    g.fillStyle = b;
    switch (pattern) {
      case "stripes": // vertical stripes
        for (let i = 0; i < 8; i += 2) g.fillRect((i * size) / 8, 0, size / 8, size);
        break;
      case "bands": // horizontal bands
        for (let i = 0; i < 8; i += 2) g.fillRect(0, (i * size) / 8, size, size / 8);
        break;
      case "dots":
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            g.beginPath();
            g.arc((x + 0.5 + (y % 2) * 0.5) * (size / 4), (y + 0.5) * (size / 4), size / 16, 0, Math.PI * 2);
            g.fill();
          }
        }
        break;
      case "checks":
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect((x * size) / 8, (y * size) / 8, size / 8, size / 8);
        break;
      case "gradient": {
        const grad = g.createLinearGradient(0, 0, 0, size);
        grad.addColorStop(0, a);
        grad.addColorStop(1, b);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        break;
      }
      case "stars":
        for (const [x, y, r] of [[0.15, 0.2, 0.07], [0.6, 0.12, 0.05], [0.85, 0.5, 0.07], [0.35, 0.58, 0.06], [0.1, 0.88, 0.05], [0.65, 0.85, 0.07]]) {
          g.beginPath();
          for (let i = 0; i < 10; i++) {
            const rad = (i % 2 ? 0.45 : 1) * r * size;
            const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
            g[i ? "lineTo" : "moveTo"](x * size + Math.cos(ang) * rad, y * size + Math.sin(ang) * rad);
          }
          g.closePath();
          g.fill();
        }
        break;
      default:
    }
    texture.needsUpdate = true;
  };
  draw(c1, c2);
  return { texture, redraw: draw };
}

// The part of a body outline between two heights (interpolated at the ends), pushed out by `off`
export function sliceProfile(profile, y0, y1, off = 0.01) {
  const out = [];
  const at = (y) => {
    for (let i = 1; i < profile.length; i++) {
      const [r0, ya] = profile[i - 1];
      const [r1, yb] = profile[i];
      if (y >= ya && y <= yb) return (yb === ya ? r0 : r0 + ((r1 - r0) * (y - ya)) / (yb - ya)) + off;
    }
    return profile.at(-1)[0] + off;
  };
  out.push([at(y0), y0]);
  for (const [r, y] of profile) if (y > y0 && y < y1) out.push([r + off, y]);
  out.push([at(y1), y1]);
  return out;
}

// The body's back (z < 0) or front (z > 0) surface at a height above the body's bottom, and the
// angle the surface leans there (so a flat badge or pack can lie flat on it)
export function bodySurface(c, y) {
  const { body } = c.dims;
  const r = (yy) => c.dims.bodyRadius(Math.min(body.h, Math.max(0, yy)));
  const dr = (r(y + 0.01) - r(y - 0.01)) / 0.02;
  return { z: body.depth * r(y), r: r(y), tilt: Math.atan(dr * body.depth) };
}

// A band of cloth over the shoulder at sideways position x: up the back, over the top and down the front
export function shoulderStrap(c, x, { from = 0.55, over = 0.95, to = 0.5, width = 0.03, thickness = 0.012, material, off = 0.012 }) {
  const { body } = c.dims;
  const pts = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // 0 → 0.5: up the back; 0.5 → 1: down the front
    const side = t < 0.5 ? -1 : 1;
    const k = t < 0.5 ? t * 2 : (1 - t) * 2; // 0 at the ends, 1 at the top
    const lowY = (t < 0.5 ? from : to) * body.h;
    const y = lowY + (over * body.h - lowY) * Math.sin((k * Math.PI) / 2);
    const r = c.dims.bodyRadius(Math.min(y, body.h * 0.985)) + off;
    const z = body.depth * Math.sqrt(Math.max(0, r * r - x * x)) * (k > 0.97 ? 0 : side);
    pts.push(new THREE.Vector3(x, y - body.h / 2, z));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, thickness, 6);
  const mesh = c.make(geo, material, { shadow: false });
  mesh.scale.set(width / thickness, 1, 1);
  mesh.position.x = x * (1 - width / thickness);
  return mesh;
}
