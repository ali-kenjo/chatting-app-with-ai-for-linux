// Space: a deep sky with nebulae, a planet (with rings), a little moon, an optional window frame, and a
// glowing grid for a floor. The stars themselves are the air (world.js).
import * as THREE from "three";
import { canvasTexture, matte, glossy, css, rng, mix, shade, glowSprite } from "./kit.js";

// A planet's surface: bands and blotches around the middle color
function planetTexture(hex, seed) {
  const rand = rng(seed);
  const base = new THREE.Color(hex);
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const y = rand() * h;
      const th = 8 + rand() * 40;
      const tone = rand() < 0.5 ? shade(base, { l: 0.08 + rand() * 0.1, s: -0.05 }) : shade(base, { l: -0.12 - rand() * 0.1, h: 0.02 });
      const g = ctx.createLinearGradient(0, y - th, 0, y + th);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, css(tone));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g;
      ctx.fillRect(0, y - th, w, th * 2);
    }
    ctx.globalAlpha = 0.3;
    for (let i = 0; i < 40; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 6 + rand() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, css(shade(base, { l: rand() < 0.5 ? 0.15 : -0.15 })));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 2, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

const moonTexture = () =>
  canvasTexture(512, 256, (ctx, w, h) => {
    const rand = rng(5);
    ctx.fillStyle = "#b9b6b0";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 3 + rand() * rand() * 28;
      const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, "rgba(70,68,66,0.55)");
      g.addColorStop(0.8, "rgba(70,68,66,0.2)");
      g.addColorStop(1, "rgba(255,255,255,0.16)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });

// Saturn-like rings: bands of different strength across the width, with gaps
const ringTexture = (hex) =>
  canvasTexture(512, 8, (ctx, w) => {
    const rand = rng(9);
    const base = new THREE.Color(hex);
    ctx.clearRect(0, 0, w, 8);
    for (let x = 0; x < w; x++) {
      const t = x / w;
      let a = 0.15 + 0.5 * Math.abs(Math.sin(t * 40 + rand() * 0.1)) * (0.4 + 0.6 * Math.sin(t * Math.PI));
      if (t > 0.45 && t < 0.52) a *= 0.08; // a gap
      ctx.fillStyle = `rgba(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)},${a})`;
      ctx.fillRect(x, 0, 1, 8);
    }
  });

export function space({ colors, glow, props, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Space";
  room.add(group);

  if (props.planet) {
    const planet = new THREE.Group();
    planet.position.set(-2.6, 1.9, -8);
    planet.rotation.z = 0.35;
    group.add(planet);
    const map = keep(planetTexture(`#${colors.detail.getHexString()}`, 3));
    const surface = new THREE.Mesh(keep(new THREE.SphereGeometry(1.9, 64, 40)), keep(new THREE.MeshStandardMaterial({ map, roughness: 0.95, emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 0.13 })));
    surface.rotation.y = 0.8;
    planet.add(surface);
    // A thin glow of atmosphere around the rim
    const air = new THREE.Mesh(keep(new THREE.SphereGeometry(1.9 * 1.075, 48, 32)), keep(new THREE.MeshBasicMaterial({ color: mix(colors.detail, "#ffffff", 0.45), transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    planet.add(air);
    // Rings
    const ringGeo = keep(new THREE.RingGeometry(2.45, 3.9, 128, 1));
    const pos = ringGeo.attributes.position;
    const uv = ringGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 2.45) / (3.9 - 2.45), 0.5);
    const rings = new THREE.Mesh(ringGeo, keep(new THREE.MeshBasicMaterial({ map: keep(ringTexture(`#${mix(colors.detail, "#fff3e0", 0.5).getHexString()}`)), transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })));
    rings.rotation.x = Math.PI / 2 - 0.42;
    planet.add(rings);
  }

  if (props.moon) {
    const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(0.5, 40, 28)), keep(new THREE.MeshStandardMaterial({ map: keep(moonTexture()), roughness: 1, emissive: "#ffffff", emissiveMap: null, emissiveIntensity: 0 })));
    moon.position.set(2.7, 2.7, -6.2);
    group.add(moon);
    const halo = glowSprite(keep, "#cfd8ff", 2.2, 0.16);
    halo.position.copy(moon.position);
    group.add(halo);
  }

  if (props.frame) {
    // A window frame of the station, a little way behind the robot: dark metal with a light strip in its edge
    const metal = keep(glossy("#161922", 0.55, { metalness: 0.5 }));
    const strip = keep(new THREE.MeshStandardMaterial({ color: "#05060a", emissive: glow, emissiveIntensity: 1.8, roughness: 0.4 }));
    const frame = new THREE.Group();
    frame.position.set(0, 1.45, -3.1);
    group.add(frame);
    const W = 9.2;
    const H = 4.6;
    const T = 0.5;
    for (const [w, h, x, y] of [[W, T, 0, H / 2 - T / 2], [W, T, 0, -H / 2 + T / 2], [T, H, -W / 2 + T / 2, 0], [T, H, W / 2 - T / 2, 0]]) {
      const b = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.3)), metal);
      b.position.set(x, y, 0);
      frame.add(b);
    }
    for (const [w, h, x, y] of [[W - 0.7, 0.04, 0, H / 2 - T - 0.03], [W - 0.7, 0.04, 0, -H / 2 + T + 0.03]]) {
      const l = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.05)), strip);
      l.position.set(x, y, 0.16);
      frame.add(l);
    }
    // Bolts along the beams
    const bolt = keep(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12));
    for (let i = 0; i < 12; i++) {
      for (const y of [H / 2 - T / 2, -H / 2 + T / 2]) {
        const b = new THREE.Mesh(bolt, metal);
        b.rotation.x = Math.PI / 2;
        b.position.set(-W / 2 + 0.7 + (i * (W - 1.4)) / 11, y, 0.17);
        frame.add(b);
      }
    }
    return build(true);
  }
  return build(false);

  function build(framed) {
    const wall = colors.wall;
    const bottom = mix(wall, colors.glow ?? glow, 0.14);
    return {
      glow: framed ? [] : [],
      backdrop: {
        mode: "gradient",
        bg: wall,
        mid: bottom,
        horizon: 0.4,
        edge: colors.floor.clone().multiplyScalar(0.7),
        glow: 0,
        glowColor: glow,
        blobs: [
          { x: 0.22, y: 0.7, r: 0.5, strength: 0.34, color: glow },
          { x: 0.84, y: 0.4, r: 0.55, strength: 0.22, color: colors.detail },
          { x: 0.58, y: 0.92, r: 0.35, strength: 0.16, color: shade(glow, { h: 0.12 }) },
        ],
      },
    };
  }
}
