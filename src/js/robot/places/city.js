// A neon city at night: three layers of skyline with lit windows, a moon, neon signs (your words on
// one), a wet street that mirrors it all. Rain comes from the air.
import * as THREE from "three";
import { canvasTexture, neonTexture, css, rng, mix, shade, glowSprite, picture } from "./kit.js";

// A skyline as a silhouette of buildings with lit windows; `lit` is how many windows are on
function skyline(hex, seed, { lit = 0.3, windows = ["#ffd98a", "#9fd6ff", "#ff8fd0"], tall = 1 } = {}) {
  const rand = rng(seed);
  return canvasTexture(2048, 640, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    let x = -20;
    const base = new THREE.Color(hex);
    while (x < w) {
      const bw = 90 + rand() * 150;
      const bh = (140 + rand() * 330) * tall;
      const tone = 0.85 + rand() * 0.3;
      ctx.fillStyle = css(base.clone().multiplyScalar(tone));
      ctx.fillRect(x, h - bh, bw, bh);
      // a little top: an antenna or a roof box
      if (rand() < 0.35) {
        ctx.fillRect(x + bw * 0.45, h - bh - 50 - rand() * 50, 4, 70);
        ctx.fillStyle = "#ff3d5a";
        ctx.fillRect(x + bw * 0.45 - 1, h - bh - 56, 6, 6);
        ctx.fillStyle = css(base.clone().multiplyScalar(tone));
      } else if (rand() < 0.4) ctx.fillRect(x + bw * 0.2, h - bh - 22, bw * 0.4, 22);
      // windows
      const cols = Math.floor((bw - 16) / 18);
      const rows = Math.floor((bh - 24) / 26);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < lit) {
            ctx.fillStyle = windows[Math.floor(rand() * windows.length)];
            ctx.globalAlpha = 0.55 + rand() * 0.45;
            ctx.fillRect(x + 10 + c * 18, h - bh + 14 + r * 26, 9, 13);
          }
        }
      }
      ctx.globalAlpha = 1;
      x += bw + 6 + rand() * 18;
    }
  });
}

export function city({ colors, glow, props, sign, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Neon city";
  room.add(group);
  const glowing = [];
  const rand = rng(41);
  const wall = colors.wall;
  const haze = mix(wall, glow, 0.28);

  if (props.moon) {
    const halo = glowSprite(keep, "#c9d4ff", 5, 0.3);
    halo.position.set(2.9, 2.9, -11);
    group.add(halo);
    const disc = glowSprite(keep, "#f4f1e8", 1.5, 0.95);
    disc.position.set(2.9, 2.9, -10.9);
    group.add(disc);
  }

  const windowColors = [`#${mix("#ffd98a", glow, 0.1).getHexString()}`, "#9fd6ff", `#${mix("#ff8fd0", glow, 0.5).getHexString()}`];
  let signMaterial = null;
  if (props.skyline) {
    const layers = [
      { z: -10, color: mix(colors.detail, haze, 0.55), lit: 0.08, tall: 1.15, seed: 2 },
      { z: -7, color: mix(colors.detail, haze, 0.28), lit: 0.18, tall: 1.0, seed: 5 },
      { z: -4.2, color: colors.detail, lit: 0.3, tall: 0.78, seed: 8 },
    ];
    for (const l of layers) {
      const plane = picture(keep(skyline(l.color, l.seed, { lit: l.lit, windows: windowColors, tall: l.tall })), 26, 8.1);
      plane.position.set(l.seed - 5, -0.6 + 4.05, l.z);
      group.add(plane);
    }
  }

  if (props.neon) {
    // Your words on a sign hanging off a building, and a couple of glowing bars
    const texture = keep(neonTexture(sign || "OPEN", `#${glow.getHexString()}`, { width: 768, height: 256 }));
    signMaterial = keep(new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 1.8, map: texture, transparent: true, roughness: 1, depthWrite: false }));
    const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.9, 0.633)), signMaterial);
    mesh.position.set(-1.9, 1.7, -3.9);
    mesh.rotation.z = -0.04;
    group.add(mesh);
    glowing.push(signMaterial);
    const halo = glowSprite(keep, `#${glow.getHexString()}`, 3.4, 0.28);
    halo.position.set(-1.9, 1.7, -4);
    halo.scale.set(3.6, 2.0, 1);
    group.add(halo);
    // Two bars of neon light on the other side
    const hues = [glow, shade(glow, { h: 0.5 })];
    hues.forEach((c, i) => {
      const mat = keep(new THREE.MeshStandardMaterial({ color: "#000000", emissive: c, emissiveIntensity: 2.2, roughness: 0.5 }));
      glowing.push(mat);
      const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(0.05, 1.5 - i * 0.5, 0.05)), mat);
      bar.position.set(2.3 + i * 0.25, 1.1 + i * 0.3, -3.9);
      group.add(bar);
      const h = glowSprite(keep, `#${c.getHexString()}`, 1.6, 0.25);
      h.position.copy(bar.position);
      group.add(h);
    });
  }

  return {
    glow: glowing,
    backdrop: {
      mode: "gradient",
      bg: wall,
      mid: haze,
      horizon: 0.36,
      edge: colors.floor,
      glow: 0,
      glowColor: glow,
      blobs: [{ x: 0.5, y: 0.36, r: 0.42, strength: 0.14, color: glow }, ...(props.moon ? [{ x: 0.74, y: 0.78, r: 0.26, strength: 0.14, color: new THREE.Color("#9fb4ff") }] : [])],
    },
    update(dt, time, pose, fx) {
      if (signMaterial) signMaterial.emissiveIntensity = fx.friendly || fx.reduced ? 1.8 : 1.8 + Math.sin(time * 37) * 0.03 + (Math.sin(time * 0.5 + 2) > 0.99 ? -0.6 : 0);
      void rand;
    },
  };
}
