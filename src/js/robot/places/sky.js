// Floating in the sky: a bright gradient, a sun, big soft clouds drifting by (and a bank of them under
// the robot's feet), and, if you like, a rainbow.
import * as THREE from "three";
import { canvasTexture, css, rng, mix, shade, glowSprite, cloudTexture, picture } from "./kit.js";

const RAINBOW = ["#ff5d5d", "#ff9f43", "#ffd93d", "#6bdc7a", "#4aa3ff", "#5b6cff", "#a15cff"];

export function sky({ colors, glow, props, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Sky";
  room.add(group);
  const rand = rng(17);
  const top = colors.wall;
  const horizon = mix(colors.wall, "#ffffff", 0.72);
  const cloudColor = colors.detail;

  if (props.sun) {
    const halo = glowSprite(keep, `#${glow.getHexString()}`, 8, 0.3);
    halo.position.set(3.6, 3.6, -11);
    group.add(halo);
    const disc = glowSprite(keep, "#fffbe8", 2.6, 1);
    disc.position.set(3.6, 3.6, -10.9);
    group.add(disc);
  }

  if (props.rainbow) {
    RAINBOW.forEach((c, i) => {
      const ring = new THREE.Mesh(keep(new THREE.RingGeometry(5.6 + i * 0.26, 5.6 + (i + 1) * 0.26, 96, 1, 0, Math.PI)), keep(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })));
      ring.position.set(-1.6, -0.9, -10);
      group.add(ring);
    });
  }

  if (props.clouds) {
    const tint = css(mix(cloudColor, "#ffffff", 0.35));
    const shadow = css(mix(cloudColor, top, 0.4));
    // Far clouds, up in the sky
    for (let i = 0; i < 6; i++) {
      const sprite = picture(keep(cloudTexture(i + 1, { tint, shadow })), 3.6 + rand() * 2.6, 1.8 + rand() * 1.0, { opacity: 0.9 });
      sprite.position.set(-9 + i * 3.4 + rand() * 1.4, 1.8 + rand() * 2.8, -10.5 + rand() * 2.5);
      sprite.userData.drift = 0.04 + rand() * 0.06;
      group.add(sprite);
    }
    // A bank of clouds around the robot's feet
    for (let i = 0; i < 9; i++) {
      const w = 3.2 + rand() * 2.0;
      const sprite = picture(keep(cloudTexture(i + 20, { tint, shadow })), w, w * 0.3, { opacity: 0.97 });
      sprite.position.set(-7 + i * 1.8 + rand(), -0.05 + rand() * 0.15, -2.6 - rand() * 1.8);
      sprite.userData.drift = 0.02 + rand() * 0.02;
      group.add(sprite);
    }
  }

  return {
    floorScale: 0.4,
    backdrop: {
      mode: "gradient",
      bg: top,
      mid: horizon,
      horizon: 0.42,
      edge: mix(horizon, cloudColor, 0.5),
      glow: 0,
      glowColor: glow,
      blobs: props.sun ? [{ x: 0.78, y: 0.86, r: 0.3, strength: 0.26, color: glow }] : [],
    },
    update(dt) {
      for (const child of group.children) {
        if (child.userData.drift) {
          child.position.x += child.userData.drift * dt;
          if (child.position.x > 12) child.position.x = -12;
        }
      }
    },
  };
}
