// A cozy desk corner: a wall with soft window light, a wooden desk (the robot hovers just above it),
// a plant, a mug, a few books and a lamp. All original, with smooth colors only.
import * as THREE from "three";
import { canvasTexture, spotTexture, matte, glossy, shade, css } from "./kit.js";

export function desk({ colors, glow, props, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Desk set";
  room.add(group);
  const add = (geometry, material, x, y, z, { cast = true } = {}) => {
    const m = new THREE.Mesh(keep(geometry), material);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const std = (color, roughness = 0.6, extra = {}) => keep(roughness < 0.5 || extra.emissive || extra.metalness ? glossy(color, roughness, extra) : matte(color, extra));

  // The wall, with a soft patch of window light
  const top = colors.wall;
  const bottom = shade(top, { l: -0.025 });
  const patch = glow;
  const wallTexture = keep(
    canvasTexture(512, 256, (ctx, w, h) => {
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, css(top));
      base.addColorStop(1, css(bottom));
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const p = ctx.createRadialGradient(360, 90, 10, 360, 90, 170);
      p.addColorStop(0, `rgba(${(patch.r * 255) | 0}, ${(patch.g * 255) | 0}, ${(patch.b * 255) | 0}, 0.34)`);
      p.addColorStop(1, `rgba(${(patch.r * 255) | 0}, ${(patch.g * 255) | 0}, ${(patch.b * 255) | 0}, 0)`);
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, w, h);
    })
  );
  add(new THREE.PlaneGeometry(9, 4.5), std("#ffffff", 1, { map: wallTexture }), 0, 1.4, -2.4, { cast: false });

  // The desk top
  add(new THREE.BoxGeometry(4.2, 0.08, 2.6), std(colors.floor, 0.7), 0, -0.04, -0.4, { cast: false });

  // A plant in a pot
  if (props.plant) {
    const pot = add(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0.11, 0.17), new THREE.Vector2(0.12, 0.19), new THREE.Vector2(0.0, 0.19)], 40), std(colors.detail, 0.7), -0.98, 0, -0.62);
    pot.castShadow = true;
    const leafMat = std("#4d7a4c", 0.55);
    const leafGeo = keep(new THREE.SphereGeometry(1, 20, 14));
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const a = (i / 7) * Math.PI * 2;
      leaf.scale.set(0.05, 0.2 + (i % 3) * 0.04, 0.022);
      leaf.position.set(-0.98 + Math.cos(a) * 0.05, 0.36, -0.62 + Math.sin(a) * 0.05);
      leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      leaf.castShadow = true;
      group.add(leaf);
    }
  }

  // A mug
  if (props.mug) {
    add(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.052, 0.11), new THREE.Vector2(0.045, 0.11), new THREE.Vector2(0.043, 0.02), new THREE.Vector2(0, 0.02)], 36), std("#e6dccd", 0.4), 0.82, 0, 0.12);
    const handle = add(new THREE.TorusGeometry(0.033, 0.012, 12, 24, Math.PI), std("#e6dccd", 0.4), 0.872, 0.055, 0.12);
    handle.rotation.z = -Math.PI / 2;
  }

  // A few books
  if (props.books) {
    const book = (w2, h, d, color, y, rot) => {
      const b = add(new THREE.BoxGeometry(w2, h, d), std(color, 0.75), 1.0, y, -0.5);
      b.rotation.y = rot;
    };
    book(0.34, 0.05, 0.24, "#3f5b7a", 0.025, 0.12);
    book(0.3, 0.045, 0.22, "#8a5050", 0.0725, -0.08);
    book(0.28, 0.04, 0.2, "#c8a45e", 0.115, 0.2);
  }

  // A lamp, and its warm light
  const glowing = [];
  if (props.lamp) {
    const lampMat = std("#2c2f35", 0.4, { metalness: 0.3 });
    add(new THREE.CylinderGeometry(0.1, 0.11, 0.025, 32), lampMat, -1.35, 0.0125, -0.95);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 16), lampMat, -1.35, 0.27, -0.95);
    const shadeMesh = add(new THREE.ConeGeometry(0.16, 0.18, 32, 1, true), std("#d9c9a8", 0.6, { side: THREE.DoubleSide, emissive: new THREE.Color("#ffcf8a"), emissiveIntensity: 0.6 }), -1.35, 0.56, -0.95);
    shadeMesh.castShadow = false;
    glowing.push(shadeMesh.material);
    const poolTexture = keep(spotTexture([[0, "rgba(255, 196, 120, 0.5)"], [0.5, "rgba(255, 196, 120, 0.18)"], [1, "rgba(255, 196, 120, 0)"]]));
    const pool = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.5)), keep(new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false })));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(-1.3, 0.004, -0.8);
    group.add(pool);
  }

  const wall = colors.wall;
  return {
    ownFloor: true,
    roam: 0.5, // there are things in the way
    glow: glowing,
    backdrop: { mode: "vignette", bg: wall, edge: wall.clone().multiplyScalar(0.3), glow: 0, glowColor: glow, blobs: [] },
  };
}
