// ---------- Where the robot stands ----------
// Soft three-point light (a warm key, a cool fill, a rim from behind), room
// reflections for the glossy screen, a soft contact shadow so the floating
// robot still feels grounded, a glow under its hover ring, and a small desk
// set. The flat backgrounds (studio, accent glow, chroma green and blue) are
// painted by the engine's last pass instead, so their colors come out exact.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// A soft round spot: a canvas gradient, big and blurry on purpose (no fine detail)
export function radialTexture(stops, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const KEY_AT = { x: -1.6, y: 2.8, z: 2.6 };

export class Stage {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.renderer = renderer;
    this.disposables = [];

    // Reflections: a neutral room, blurred for rough surfaces
    this.makeEnvironment();

    // Key: warm, from above left and in front; it casts the soft shadows
    this.key = new THREE.DirectionalLight("#fff1e0", 1.75);
    this.key.position.set(KEY_AT.x, KEY_AT.y, KEY_AT.z);
    this.key.target.position.set(0, 0.6, 0);
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    Object.assign(this.key.shadow.camera, { left: -1.1, right: 1.1, top: 1.6, bottom: -0.4, near: 0.5, far: 8 });
    // Fill: cool and soft from the other side
    this.fill = new THREE.DirectionalLight("#dfe8ff", 0.55);
    this.fill.position.set(2.2, 1.2, 2.0);
    this.fill.target.position.set(0, 0.6, 0);
    // Rim: from behind, so the shell's edges catch a line of light
    this.rim = new THREE.DirectionalLight("#ffffff", 1.5);
    this.rim.position.set(0.8, 2.2, -2.6);
    this.rim.target.position.set(0, 0.7, 0);
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target, this.rim, this.rim.target);

    // The soft shadow right under it, and the ring's glow on the floor
    const shadowTexture = radialTexture([[0, "rgba(0,0,0,0.62)"], [0.45, "rgba(0,0,0,0.3)"], [1, "rgba(0,0,0,0)"]]);
    this.contact = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false })
    );
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.002;
    this.contact.renderOrder = 1;
    const glowTexture = radialTexture([[0, "rgba(255,255,255,0.55)"], [0.35, "rgba(255,255,255,0.22)"], [1, "rgba(255,255,255,0)"]]);
    this.floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.8),
      new THREE.MeshBasicMaterial({ map: glowTexture, color: "#6f9cf5", transparent: true, depthWrite: false, toneMapped: false })
    );
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.y = 0.003;
    this.floorGlow.renderOrder = 2;
    this.scene.add(this.contact, this.floorGlow);
    this.disposables.push(shadowTexture, glowTexture, this.contact.geometry, this.contact.material, this.floorGlow.geometry, this.floorGlow.material);

    this.desk = this.makeDesk();
    this.scene.add(this.desk);
    this.background = "studio";
    this.setBackground("studio");
  }

  makeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget?.dispose();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.38;
    room.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    pmrem.dispose();
  }

  // An original little desk corner: a wooden desk, a wall with soft window
  // light, a plant, a mug, a few books and a lamp. Smooth colors only.
  makeDesk() {
    const desk = new THREE.Group();
    desk.name = "Desk set";
    const keep = (x) => (this.disposables.push(x), x);
    // Matte decor: Lambert shading is much cheaper than PBR over a whole screen
    // (and looks the same on matte surfaces), which keeps built-in GPUs at 60 fps
    const std = (color, roughness = 0.6, extra = {}) => keep(roughness < 0.5 || extra.emissive || extra.metalness ? new THREE.MeshStandardMaterial({ color, roughness, ...extra }) : new THREE.MeshLambertMaterial({ color, ...extra }));
    const add = (geometry, material, x, y, z, { cast = true } = {}) => {
      const m = new THREE.Mesh(keep(geometry), material);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
      desk.add(m);
      return m;
    };

    // The wall, with a soft patch of window light
    const wallCanvas = document.createElement("canvas");
    wallCanvas.width = 512;
    wallCanvas.height = 256;
    const w = wallCanvas.getContext("2d");
    const base = w.createLinearGradient(0, 0, 0, 256);
    base.addColorStop(0, "#2f3136");
    base.addColorStop(1, "#24262b");
    w.fillStyle = base;
    w.fillRect(0, 0, 512, 256);
    const patch = w.createRadialGradient(360, 90, 10, 360, 90, 170);
    patch.addColorStop(0, "rgba(255, 214, 170, 0.34)");
    patch.addColorStop(1, "rgba(255, 214, 170, 0)");
    w.fillStyle = patch;
    w.fillRect(0, 0, 512, 256);
    const wallTexture = keep(new THREE.CanvasTexture(wallCanvas));
    wallTexture.colorSpace = THREE.SRGBColorSpace;
    add(new THREE.PlaneGeometry(9, 4.5), std("#ffffff", 1, { map: wallTexture }), 0, 1.4, -2.4, { cast: false });

    // The desk top (the robot hovers just above it)
    const top = add(new THREE.BoxGeometry(4.2, 0.08, 2.6), std("#553d2d", 0.7), 0, -0.04, -0.4, { cast: false });
    top.receiveShadow = true;

    // A plant in a pot
    const pot = add(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0.11, 0.17), new THREE.Vector2(0.12, 0.19), new THREE.Vector2(0.0, 0.19)], 40), std("#8b9d86", 0.7), -0.98, 0, -0.62);
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
      desk.add(leaf);
    }

    // A mug
    add(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.052, 0.11), new THREE.Vector2(0.045, 0.11), new THREE.Vector2(0.043, 0.02), new THREE.Vector2(0, 0.02)], 36), std("#e6dccd", 0.4), 0.82, 0, 0.12);
    const handle = add(new THREE.TorusGeometry(0.033, 0.012, 12, 24, Math.PI), std("#e6dccd", 0.4), 0.872, 0.055, 0.12);
    handle.rotation.z = -Math.PI / 2;

    // A few books
    const book = (w2, h, d, color, y, rot) => {
      const b = add(new THREE.BoxGeometry(w2, h, d), std(color, 0.75), 1.0, y, -0.5);
      b.rotation.y = rot;
    };
    book(0.34, 0.05, 0.24, "#3f5b7a", 0.025, 0.12);
    book(0.3, 0.045, 0.22, "#8a5050", 0.0725, -0.08);
    book(0.28, 0.04, 0.2, "#c8a45e", 0.115, 0.2);

    // A lamp, and its warm light
    const lampMat = std("#2c2f35", 0.4, { metalness: 0.3 });
    add(new THREE.CylinderGeometry(0.1, 0.11, 0.025, 32), lampMat, -1.35, 0.0125, -0.95);
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 16), lampMat, -1.35, 0.27, -0.95);
    const shade = add(new THREE.ConeGeometry(0.16, 0.18, 32, 1, true), std("#d9c9a8", 0.6, { side: THREE.DoubleSide, emissive: new THREE.Color("#ffcf8a"), emissiveIntensity: 0.6 }), -1.35, 0.56, -0.95);
    shade.castShadow = false;
    this.lampShade = shade.material; // it glows a little
    // Its warm light on the desk: a soft glow, cheaper than a real light for every surface
    const poolTexture = keep(radialTexture([[0, "rgba(255, 196, 120, 0.5)"], [0.5, "rgba(255, 196, 120, 0.18)"], [1, "rgba(255, 196, 120, 0)"]]));
    const pool = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 1.5)), keep(new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false })));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(-1.3, 0.004, -0.8);
    desk.add(pool);
    return desk;
  }

  // "studio" | "accent" | "desk" | "green" | "blue" | "dock"
  setBackground(kind) {
    this.background = kind;
    const chroma = kind === "green" || kind === "blue";
    this.desk.visible = kind === "desk";
    // Chroma keys must stay one flat color: no shadows, no glow spilling onto them
    this.contact.visible = !chroma;
    this.floorGlow.visible = !chroma;
  }

  setAccent(color) {
    this.floorGlow.material.color.copy(color);
  }

  // Contact shadow, floor glow and the key light's shadow follow where it is
  // in the room (x, z) and how high it floats
  follow(hoverY, x = 0, z = 0) {
    const lift = Math.max(0, hoverY);
    const s = 1 + lift * 1.6;
    this.contact.position.set(x, 0.002, z);
    this.floorGlow.position.set(x, 0.003, z);
    this.key.position.set(KEY_AT.x + x, KEY_AT.y, KEY_AT.z + z);
    this.key.target.position.set(x, 0.6, z);
    this.contact.scale.set(s, s, 1);
    this.contact.material.opacity = Math.max(0.35, 1 - lift * 2.2);
    this.floorGlow.material.opacity = Math.max(0.3, 0.9 - lift * 2.5);
  }

  setShadows(on, size = 2048) {
    this.key.castShadow = on;
    if (this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
  }

  // Softer and a little less contrast on camera (no hot spots on the shell)
  setCameraFriendly(on) {
    this.key.intensity = on ? 1.5 : 1.75;
    this.rim.intensity = on ? 1.15 : 1.5;
    this.fill.intensity = on ? 0.7 : 0.55;
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.envTarget?.dispose();
    this.key.shadow.map?.dispose();
  }
}
