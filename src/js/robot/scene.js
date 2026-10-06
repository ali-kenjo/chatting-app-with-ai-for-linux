// ---------- Where the robot stands ----------
// Soft three-point light (a key, a fill, a rim from behind; their colors and
// strength follow the room's lighting mood), room reflections for the glossy
// screen, a soft contact shadow so the floating robot still feels grounded,
// and a glow under its hover ring. The set of each place is made by room3d.js;
// the flat backdrops (including chroma green and blue) are painted by the
// engine's last pass, so their colors come out exact.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LIGHT_MOODS } from "./room.mjs";

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

    this.mood = LIGHT_MOODS.studio;
    this.brightness = 1;
    this.friendly = false;
  }

  makeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget?.dispose();
    this.envTarget = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = (this.mood?.env ?? 0.38) * (0.6 + 0.4 * (this.brightness ?? 1));
    room.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    pmrem.dispose();
  }

  // The lighting mood (room.mjs LIGHT_MOODS) and how bright: colors and strengths of the three lights
  setMood(id, brightness = 1) {
    this.mood = LIGHT_MOODS[id] || LIGHT_MOODS.studio;
    this.brightness = brightness;
    this.applyLights();
  }

  applyLights() {
    const m = this.mood;
    const b = this.brightness;
    // Softer and a little less contrast on camera (no hot spots on the shell)
    const [key, fill, rim] = this.friendly ? [0.857, 1.27, 0.767] : [1, 1, 1];
    this.key.color.set(m.key[0]);
    this.key.intensity = m.key[1] * key * b;
    this.fill.color.set(m.fill[0]);
    this.fill.intensity = m.fill[1] * fill * b;
    this.rim.color.set(m.rim[0]);
    this.rim.intensity = m.rim[1] * rim * b;
    this.scene.environmentIntensity = m.env * (0.6 + 0.4 * b);
  }

  // Chroma keys must stay one flat color: no shadow, no glow spilling onto them
  setChroma(on) {
    this.contact.visible = !on;
    this.floorGlow.visible = !on;
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

  setCameraFriendly(on) {
    this.friendly = on;
    this.applyLights();
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.envTarget?.dispose();
    this.key.shadow.map?.dispose();
  }
}
