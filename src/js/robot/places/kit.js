// Small helpers the places share: colors, canvas textures, soft sprites, cheap matte materials.
import * as THREE from "three";

export const color = (hex) => new THREE.Color(hex);
export const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
export const darker = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
export const css = (c) => `#${new THREE.Color(c).getHexString()}`;

// A color shifted in lightness and saturation (HSL), as a THREE.Color
export function shade(hex, { l = 0, s = 0, h = 0 } = {}) {
  const c = new THREE.Color(hex);
  const hsl = c.getHSL({});
  return c.setHSL((hsl.h + h + 1) % 1, Math.min(1, Math.max(0, hsl.s + s)), Math.min(1, Math.max(0, hsl.l + l)));
}

// A texture drawn on a canvas: draw(ctx, w, h)
export function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// A soft round spot of light, as a sprite texture
export function spotTexture(stops, size = 128) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [at, c] of stops) g.addColorStop(at, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// Matte decor: Lambert shading is much cheaper than PBR over a whole screen and looks the same on matte surfaces
export function matte(c, extra = {}) {
  return new THREE.MeshLambertMaterial({ color: c, ...extra });
}

export function glossy(c, roughness = 0.4, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: c, roughness, ...extra });
}

// A flat piece with its own picture, lit by nothing (a painted backdrop: a skyline, hills, a picture)
export function picture(texture, width, height, { transparent = true, opacity = 1, fog = false } = {}) {
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent, opacity, depthWrite: false, toneMapped: false, fog });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

// Seeded random numbers, so a room always gets the same scatter of windows, books and stars
export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// A group that remembers what it made, so a place can be cleared without leaking
export class Kept {
  constructor() {
    this.list = [];
  }
  add(x) {
    this.list.push(x);
    return x;
  }
  dispose() {
    for (const d of this.list) d.dispose?.();
    this.list.length = 0;
  }
}

// ---------- Pieces several places use ----------

// A neon sign's picture: the words in glowing tube letters on a transparent background
export function neonTexture(text, hex, { width = 1024, height = 384, font = "800 150px Impact, 'Arial Black', 'Segoe UI', sans-serif", frame = true } = {}) {
  const c = new THREE.Color(hex);
  const core = c.clone().lerp(new THREE.Color("#ffffff"), 0.72);
  const rgb = (col, a) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Shrink the type until the words fit
    let size = 150;
    const label = String(text || " ").toUpperCase();
    do {
      ctx.font = font.replace("150px", `${size}px`);
      size -= 6;
    } while (ctx.measureText(label).width > w * 0.82 && size > 30);
    const draw = (width2, style, blur = 0, blurColor = "transparent") => {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineWidth = width2;
      ctx.strokeStyle = style;
      ctx.shadowBlur = blur;
      ctx.shadowColor = blurColor;
      ctx.strokeText(label, w / 2, h / 2);
      if (frame) {
        ctx.beginPath();
        ctx.roundRect(w * 0.04, h * 0.1, w * 0.92, h * 0.8, h * 0.16);
        ctx.stroke();
      }
      ctx.restore();
    };
    draw(26, rgb(c, 0.18), 50, rgb(c, 0.9));
    draw(14, rgb(c, 0.55), 22, rgb(c, 1));
    draw(7, rgb(c, 1), 8, rgb(c, 1));
    draw(3, rgb(core, 1));
  });
}

// A soft cloud's picture: a few overlapping puffs, white on top, a little blue-gray underneath
export function cloudTexture(seed = 1, { width = 512, height = 256, tint = "#ffffff", shadow = "#c4d4ee" } = {}) {
  const rand = rng(seed);
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const puffs = 7 + Math.floor(rand() * 4);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < puffs; i++) {
        const t = i / (puffs - 1);
        const x = w * (0.16 + 0.68 * t) + (rand() - 0.5) * w * 0.05;
        const r = h * (0.2 + 0.2 * Math.sin(t * Math.PI) + rand() * 0.07);
        const y = h * (0.6 - 0.22 * Math.sin(t * Math.PI)) + (rand() - 0.5) * h * 0.08 + (pass === 0 ? h * 0.04 : 0);
        const g = ctx.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
        g.addColorStop(0, pass === 0 ? shadow : tint);
        g.addColorStop(0.65, pass === 0 ? shadow : tint);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = pass === 0 ? 0.85 : 0.95;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });
}

// A potted plant (a pot and a handful of leaves), added to `group` at x, z
export function addPlant(group, keep, x, z, potColor, { scale = 1, leaves = "#4d7a4c" } = {}) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  const pot = new THREE.Mesh(keep(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0.11, 0.17), new THREE.Vector2(0.12, 0.19), new THREE.Vector2(0.0, 0.19)], 40)), keep(matte(potColor)));
  pot.castShadow = true;
  g.add(pot);
  const leafMat = keep(matte(leaves));
  const leafGeo = keep(new THREE.SphereGeometry(1, 20, 14));
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const a = (i / 7) * Math.PI * 2;
    leaf.scale.set(0.05, 0.2 + (i % 3) * 0.04, 0.022);
    leaf.position.set(Math.cos(a) * 0.05, 0.36, Math.sin(a) * 0.05);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    leaf.castShadow = true;
    g.add(leaf);
  }
  group.add(g);
  return g;
}

// A glow that isn't a light: a soft additive sprite
export function glowSprite(keep, hex, size, opacity = 0.5) {
  const texture = keep(spotTexture([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.35)"], [1, "rgba(255,255,255,0)"]], 128));
  const material = keep(new THREE.SpriteMaterial({ map: texture, color: hex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}
