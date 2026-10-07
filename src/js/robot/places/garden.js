// Sunset hills: a warm sky with a low sun and clouds, three layers of hills fading into the haze,
// rounded trees, a scatter of flowers and grass underfoot. Petals drift through the air.
import * as THREE from "three";
import { canvasTexture, matte, css, rng, mix, shade, glowSprite, cloudTexture, picture } from "./kit.js";

// A ridge of hills as a silhouette: the hill color below a wavy line, transparent above
function hillTexture(hex, seed, { base = 0.5, amp = 0.12 } = {}) {
  const rand = rng(seed);
  const waves = Array.from({ length: 4 }, (_, i) => ({ f: 1 + i * 1.7 + rand(), a: amp / (i + 1.2), p: rand() * 6.28 }));
  return canvasTexture(2048, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, h * (1 - base - amp), 0, h);
    g.addColorStop(0, css(shade(hex, { l: 0.05 })));
    g.addColorStop(1, css(hex));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const t = x / w;
      let y = base;
      for (const wv of waves) y += Math.sin(t * Math.PI * 2 * wv.f + wv.p) * wv.a;
      ctx.lineTo(x, h * (1 - y));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
}

export function garden({ colors, glow, props, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Sunset hills";
  room.add(group);
  const rand = rng(33);
  const skyBottom = colors.wall;
  const skyTop = mix(colors.wall, "#3a3f9f", 0.78);
  const haze = mix(skyBottom, "#ffffff", 0.2);
  const grass = colors.floor;

  if (props.sun) {
    const halo = glowSprite(keep, `#${glow.getHexString()}`, 8, 0.3);
    halo.position.set(3.4, 1.3, -10);
    group.add(halo);
    const disc = glowSprite(keep, `#${mix(glow, "#ffffff", 0.55).getHexString()}`, 2.2, 0.95);
    disc.position.set(3.4, 1.3, -9.8);
    group.add(disc);
  }

  if (props.clouds) {
    for (let i = 0; i < 7; i++) {
      const tint = mix("#ffffff", glow, 0.35);
      const texture = keep(cloudTexture(i + 3, { tint: css(tint), shadow: css(mix(tint, skyTop, 0.45)) }));
      const sprite = picture(texture, 4.5 + rand() * 3, 2.2 + rand() * 1.2, { opacity: 0.8 });
      sprite.position.set(-9 + i * 3 + rand() * 1.5, 2.3 + rand() * 1.5, -10.5 - rand() * 2);
      sprite.userData.drift = 0.05 + rand() * 0.07;
      group.add(sprite);
    }
  }

  if (props.hills) {
    const layers = [
      { z: -9.6, color: mix(grass, skyTop, 0.5), base: 0.62, amp: 0.1, seed: 4, w: 44 },
      { z: -7.2, color: mix(grass, skyTop, 0.28), base: 0.5, amp: 0.12, seed: 9, w: 38 },
      { z: -4.6, color: mix(grass, skyTop, 0.06), base: 0.4, amp: 0.1, seed: 15, w: 32 },
    ];
    for (const layer of layers) {
      const plane = picture(keep(hillTexture(layer.color, layer.seed, layer)), layer.w, 6, { transparent: true });
      plane.position.set(0, -1.2 + 3, layer.z);
      group.add(plane);
    }
  }

  // Trees: a trunk and rounded foliage
  if (props.trees) {
    const trunk = keep(matte("#6b4a33"));
    const tree = (x, z, s) => {
      const t = new THREE.Group();
      t.position.set(x, 0, z);
      t.scale.setScalar(s);
      const trunkMesh = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.075, 0.62, 10)), trunk);
      trunkMesh.position.y = 0.31;
      trunkMesh.castShadow = true;
      t.add(trunkMesh);
      const far = THREE.MathUtils.clamp((-z - 2) / 9, 0, 1);
      const leaf = mix(shade("#3f9a52", { h: (rand() - 0.5) * 0.05 }), skyTop, far * 0.55);
      const leafMat = keep(matte(leaf));
      for (const [lx, ly, lz, r] of [[0, 0.82, 0, 0.36], [-0.22, 0.66, 0.05, 0.27], [0.22, 0.7, -0.04, 0.29], [0.02, 1.08, 0, 0.24]]) {
        const m = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(r, 2)), leafMat);
        m.position.set(lx, ly, lz);
        m.castShadow = true;
        t.add(m);
      }
      group.add(t);
    };
    for (const [x, z, s] of [[-2.3, -3.2, 1.7], [2.7, -3.8, 2.0], [-4.4, -5.6, 2.3], [4.9, -5.2, 2.2], [-1.0, -7.4, 2.4], [1.9, -8.6, 2.6]]) tree(x, z, s);
  }

  // Flowers in the grass: all the stems are one instanced mesh, all the heads another
  if (props.flowers) {
    const spots = [];
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.95 + rand() * 2.6;
      const x = Math.cos(a) * r * 1.5;
      const z = Math.sin(a) * r * 0.9 - 0.3;
      if (z > 0.9 && Math.abs(x) < 1.3) continue;
      spots.push({ x, z, h: 0.14 + rand() * 0.14, color: rand() < 0.65 ? colors.detail : shade(colors.detail, { h: 0.5 * (rand() - 0.2), l: 0.1 }) });
    }
    const stems = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.004, 0.005, 0.2, 5)), keep(matte("#3f7a3a")), spots.length);
    const heads = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(0.035, 10, 8)), keep(matte("#ffffff")), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach((f, i) => {
      m4.compose(new THREE.Vector3(f.x, f.h / 2, f.z), new THREE.Quaternion(), new THREE.Vector3(1, f.h / 0.2, 1));
      stems.setMatrixAt(i, m4);
      m4.makeTranslation(f.x, f.h + 0.02, f.z);
      heads.setMatrixAt(i, m4);
      heads.setColorAt(i, f.color);
    });
    group.add(stems, heads);
  }

  return {
    drift: true,
    backdrop: {
      mode: "gradient",
      bg: skyTop,
      mid: skyBottom,
      horizon: 0.44,
      edge: mix(grass, skyBottom, 0.3),
      glow: 0,
      glowColor: glow,
      blobs: props.sun ? [{ x: 0.74, y: 0.4, r: 0.3, strength: 0.26, color: glow }] : [],
    },
    update(dt, time, pose, fx) {
      if (fx.reduced) return;
      for (const child of group.children) {
        if (child.userData.drift) {
          child.position.x += child.userData.drift * dt;
          if (child.position.x > 14) child.position.x = -14;
        }
      }
    },
  };
}
