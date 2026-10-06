// A living room in the evening: a wall with a window onto the night (or the day), curtains, a bookshelf
// full of books, a floor lamp, a rug on wooden boards, string lights and pictures. The lamp and the
// string lights glow (and bloom).
import * as THREE from "three";
import { canvasTexture, matte, glossy, shade, css, rng, glowSprite, addPlant, mix } from "./kit.js";

// What the window shows, by the light of the room: [top of the sky, horizon, ground glow, stars?]
const SKIES = {
  day: ["#6fb4f2", "#dff0ff", "#9ab88e", false],
  golden: ["#f3a469", "#ffe0b0", "#7c6a4a", false],
  evening: ["#2a2f6b", "#f08a5f", "#2a2230", false],
  night: ["#070d24", "#27356b", "#0d1020", true],
  neon: ["#160d33", "#ff3ea5", "#140a28", true],
  studio: ["#1a2145", "#4a5a9a", "#151a2c", true],
};

function windowView(mood, seed) {
  const [top, horizon, ground, stars] = SKIES[mood] || SKIES.evening;
  const rand = rng(seed);
  return canvasTexture(256, 384, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.78);
    g.addColorStop(0, top);
    g.addColorStop(1, horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (stars) {
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.7})`;
        ctx.fillRect(rand() * w, rand() * h * 0.5, 1.6, 1.6);
      }
      // A moon
      ctx.fillStyle = "#f4f1e0";
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = top;
      ctx.beginPath();
      ctx.arc(w * 0.72 + 7, h * 0.2 - 4, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    // Rooftops, and a few lit windows in them
    ctx.fillStyle = ground;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    let x = 0;
    while (x < w) {
      const bw = 24 + rand() * 40;
      const bh = 24 + rand() * 90;
      ctx.fillStyle = shade(ground, { l: 0.0 }).getStyle();
      ctx.fillRect(x, h * 0.78 - bh, bw, bh + 4);
      if (stars || mood === "evening") {
        for (let wy = h * 0.78 - bh + 8; wy < h * 0.78 - 6; wy += 14) {
          for (let wx = x + 5; wx < x + bw - 6; wx += 11) {
            if (rand() < 0.28) {
              ctx.fillStyle = rand() < 0.8 ? "#ffd98a" : "#9fd6ff";
              ctx.fillRect(wx, wy, 5, 7);
            }
          }
        }
      }
      x += bw + 2;
    }
  });
}

const planks = (floorColor) =>
  canvasTexture(1024, 1024, (ctx, w, h) => {
    const rand = rng(11);
    const rows = 14;
    for (let r = 0; r < rows; r++) {
      const y = (r * h) / rows;
      let x = -rand() * 300;
      while (x < w) {
        const len = 260 + rand() * 280;
        const tone = 0.86 + rand() * 0.26;
        ctx.fillStyle = css(new THREE.Color(floorColor).multiplyScalar(tone));
        ctx.fillRect(x, y, len, h / rows);
        // grain
        ctx.strokeStyle = "rgba(0,0,0,0.07)";
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          const gy = y + (rand() * h) / rows;
          ctx.moveTo(x, gy);
          ctx.lineTo(x + len, gy + (rand() - 0.5) * 4);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(x, y, 2, h / rows);
        x += len;
      }
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, y, w, 2);
    }
  }, { repeat: true });

const rugTexture = (color) =>
  canvasTexture(512, 512, (ctx, w, h) => {
    const c = new THREE.Color(color);
    const cream = c.clone().lerp(new THREE.Color("#fff3e0"), 0.82);
    const dark = c.clone().multiplyScalar(0.62);
    ctx.clearRect(0, 0, w, h);
    const rings = [[1, c], [0.86, cream], [0.78, c], [0.62, dark], [0.52, cream], [0.4, c], [0.22, cream]];
    for (const [k, col] of rings) {
      ctx.fillStyle = css(col);
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, (w / 2) * k, (h / 2) * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // a woven look
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#000";
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1.5);
    ctx.globalAlpha = 1;
  });

const wallpaper = (wall, seed = 3) =>
  canvasTexture(1024, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(wall));
    g.addColorStop(1, css(shade(wall, { l: -0.04 })));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 28, h);
    // a wainscot rail
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, h * 0.74, w, 3);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, h * 0.74 + 3, w, 2);
    void seed;
  });

const art = (seed, tone) =>
  canvasTexture(128, 160, (ctx, w, h) => {
    const rand = rng(seed);
    ctx.fillStyle = css(tone);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = css(new THREE.Color().setHSL(rand(), 0.55, 0.55));
      ctx.beginPath();
      if (i % 2) ctx.arc(rand() * w, rand() * h, 14 + rand() * 24, 0, Math.PI * 2);
      else ctx.rect(rand() * w * 0.7, rand() * h * 0.7, 30 + rand() * 40, 30 + rand() * 40);
      ctx.fill();
    }
  });

export function lounge({ colors, glow, props, mood, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Living room";
  room.add(group);
  const glowing = [];
  const rand = rng(21);
  const add = (geometry, material, x, y, z, parent = group) => {
    const m = new THREE.Mesh(keep(geometry), material);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const lamb = (c, extra) => keep(matte(c, extra));

  // ----- Wall and floor -----
  const wallTexture = keep(wallpaper(colors.wall));
  add(new THREE.PlaneGeometry(10, 5), lamb("#ffffff", { map: wallTexture }), 0, 1.6, -2.6);
  const floorTexture = keep(planks(css(colors.floor)));
  floorTexture.repeat.set(3.4, 2.4);
  const floorMat = lamb("#ffffff", { map: floorTexture });
  const floor = add(new THREE.PlaneGeometry(14, 9.6), floorMat, 0, 0, 2.2);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // A baseboard along the foot of the wall
  add(new THREE.BoxGeometry(10, 0.14, 0.04), lamb(shade(colors.wall, { l: -0.12 })), 0, 0.07, -2.58);

  // ----- The rug -----
  if (props.rug) {
    const rug = add(new THREE.CircleGeometry(1.7, 56), lamb("#ffffff", { map: keep(rugTexture(colors.detail)), transparent: true }), 0, 0.004, -0.15);
    rug.rotation.x = -Math.PI / 2;
    rug.scale.set(1.15, 0.8, 1);
  }

  // ----- The window, and its curtains -----
  if (props.window) {
    const win = new THREE.Group();
    win.position.set(1.35, 1.55, -2.55);
    group.add(win);
    const view = lamb("#ffffff", { map: keep(windowView(mood, 5)) });
    // Its view is lit by itself, not by the lamps
    view.color.set("#ffffff");
    const glass = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.2, 1.7)), keep(new THREE.MeshBasicMaterial({ map: view.map, toneMapped: false })));
    win.add(glass);
    const frameMat = lamb("#e8e2d6");
    for (const [w2, h2, x, y] of [[1.36, 0.08, 0, 0.89], [1.36, 0.08, 0, -0.89], [0.08, 1.7, -0.64, 0], [0.08, 1.7, 0.64, 0], [0.04, 1.7, 0, 0], [1.2, 0.04, 0, 0.1]]) {
      const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(w2, h2, 0.07)), frameMat);
      bar.position.set(x, y, 0.04);
      win.add(bar);
    }
    const sill = new THREE.Mesh(keep(new THREE.BoxGeometry(1.5, 0.05, 0.16)), frameMat);
    sill.position.set(0, -0.95, 0.08);
    win.add(sill);
    // Curtains: tall folds on both sides
    const curtainTexture = keep(
      canvasTexture(128, 256, (ctx, w, h) => {
        const base = new THREE.Color(colors.detail).lerp(new THREE.Color("#ffffff"), 0.1);
        for (let x = 0; x < w; x++) {
          const k = 0.78 + 0.22 * Math.sin((x / w) * Math.PI * 6);
          ctx.fillStyle = css(base.clone().multiplyScalar(k));
          ctx.fillRect(x, 0, 1, h);
        }
      }, { repeat: false })
    );
    for (const s of [-1, 1]) {
      const curtain = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.42, 2.15)), keep(new THREE.MeshLambertMaterial({ map: curtainTexture })));
      curtain.position.set(s * 0.82, -0.05, 0.1);
      win.add(curtain);
    }
    const rod = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 10)), keep(glossy("#2b2e35", 0.4, { metalness: 0.6 })));
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 1.05, 0.12);
    win.add(rod);
    // The light from outside, spilling in a little
    const spill = glowSprite(keep, mood === "day" || mood === "golden" ? "#fff0c8" : "#7f93ff", 3.0, mood === "day" ? 0.2 : 0.12);
    spill.position.set(0, -0.1, 0.5);
    spill.scale.set(2.4, 3.2, 1);
    win.add(spill);
  }

  // ----- The bookshelf -----
  if (props.shelf) {
    const shelf = new THREE.Group();
    shelf.position.set(-1.75, 0, -2.4);
    group.add(shelf);
    const wood = lamb(shade(colors.floor, { l: -0.08 }));
    const W = 1.1;
    const H = 2.05;
    const D = 0.3;
    for (const x of [-W / 2, W / 2]) add(new THREE.BoxGeometry(0.04, H, D), wood, x, H / 2, 0, shelf);
    add(new THREE.BoxGeometry(W, H, 0.02), lamb(shade(colors.floor, { l: -0.14 })), 0, H / 2, -D / 2 + 0.01, shelf);
    const levels = [0.03, 0.55, 1.05, 1.55, H - 0.02];
    for (const y of levels) add(new THREE.BoxGeometry(W + 0.04, 0.04, D), wood, 0, y, 0, shelf);
    for (let i = 0; i < levels.length - 1; i++) {
      let x = -W / 2 + 0.06;
      const base = levels[i] + 0.02;
      const room2 = levels[i + 1] - base - 0.03;
      while (x < W / 2 - 0.1) {
        const t = rand();
        if (t < 0.12 && i > 0) {
          // an object instead: a vase
          x += 0.14;
          add(new THREE.CylinderGeometry(0.05, 0.065, 0.2, 16), lamb(new THREE.Color().setHSL(rand(), 0.35, 0.6)), x, base + 0.1, 0, shelf);
          x += 0.14;
          continue;
        }
        const bw = 0.035 + rand() * 0.04;
        const bh = Math.min(room2, 0.26 + rand() * 0.2);
        const tilt = rand() < 0.06 ? 0.2 : 0;
        const book = add(new THREE.BoxGeometry(bw, bh, D * 0.78), lamb(new THREE.Color().setHSL(rand(), 0.4 + rand() * 0.25, 0.32 + rand() * 0.25)), x + bw / 2, base + bh / 2, 0.01, shelf);
        book.rotation.z = tilt;
        x += bw + 0.004;
      }
    }
  }

  // ----- A floor lamp -----
  if (props.lamp) {
    const lamp = new THREE.Group();
    lamp.position.set(2.15, 0, -1.4);
    group.add(lamp);
    const metal = keep(glossy("#25272c", 0.4, { metalness: 0.5 }));
    add(new THREE.CylinderGeometry(0.13, 0.15, 0.035, 32), metal, 0, 0.018, 0, lamp);
    add(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 10), metal, 0, 0.75, 0, lamp);
    const shadeMaterial = keep(new THREE.MeshStandardMaterial({ color: "#2b2118", emissive: glow, emissiveIntensity: 1.5, roughness: 0.8, side: THREE.DoubleSide }));
    const shadeMesh = add(new THREE.CylinderGeometry(0.15, 0.22, 0.3, 36, 1, true), shadeMaterial, 0, 1.58, 0, lamp);
    glowing.push(shadeMaterial);
    const halo = glowSprite(keep, `#${glow.getHexString()}`, 2.4, 0.4);
    halo.position.set(0, 1.55, 0.05);
    lamp.add(halo);
    const pool = glowSprite(keep, `#${glow.getHexString()}`, 3.0, 0.18);
    pool.position.set(-0.4, 0.02, 0.2);
    pool.scale.set(2.6, 1.0, 1);
    lamp.add(pool);
    void shadeMesh;
  }

  // ----- Pictures -----
  if (props.frames) {
    for (const [x, y, w2, h2, seed] of [[-0.25, 2.2, 0.42, 0.55, 3], [0.38, 2.35, 0.3, 0.3, 8], [0.38, 2.0, 0.3, 0.26, 12]]) {
      const frame = new THREE.Group();
      frame.position.set(x, y, -2.57);
      group.add(frame);
      add(new THREE.BoxGeometry(w2 + 0.05, h2 + 0.05, 0.03), lamb("#d8c9a6"), 0, 0, 0, frame);
      add(new THREE.PlaneGeometry(w2, h2), keep(new THREE.MeshBasicMaterial({ map: keep(art(seed, mix("#f4efe6", colors.detail, 0.15))), toneMapped: false })), 0, 0, 0.02, frame);
    }
  }

  // ----- String lights -----
  const bulbs = [];
  if (props.lights) {
    const wire = keep(matte("#15171b"));
    const bulbMaterial = keep(new THREE.MeshStandardMaterial({ color: "#2a1d10", emissive: glow, emissiveIntensity: 2.2, roughness: 0.4 }));
    glowing.push(bulbMaterial);
    const points = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      points.push(new THREE.Vector3(-3.4 + t * 6.8, 3.15 - 0.55 * Math.sin(t * Math.PI), -2.5));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 60, 0.005, 5)), wire);
    group.add(tube);
    const bulbGeo = keep(new THREE.SphereGeometry(0.035, 14, 10));
    for (let i = 1; i < 26; i += 1) {
      const p = curve.getPoint(i / 26);
      const bulb = new THREE.Mesh(bulbGeo, bulbMaterial);
      bulb.position.set(p.x, p.y - 0.05, p.z + 0.02);
      group.add(bulb);
      const spot = glowSprite(keep, `#${glow.getHexString()}`, 0.32, 0.5);
      spot.position.copy(bulb.position);
      group.add(spot);
      bulbs.push(spot);
    }
  }

  if (props.plant) addPlant(group, keep, 0.75 + 1.4, -1.9, shade(colors.detail, { l: 0.05 }), { scale: 2.0 });

  return {
    ownFloor: true,
    roam: 0.7,
    glow: glowing,
    backdrop: { mode: "vignette", bg: colors.wall, edge: colors.wall.clone().multiplyScalar(0.3), glow: 0, glowColor: glow, blobs: [] },
    update(dt, time) {
      bulbs.forEach((b, i) => (b.material.opacity = 0.42 + 0.1 * Math.sin(time * 1.6 + i * 0.9)));
    },
  };
}
