// ---------- The room around the robot ----------
// What makes a place a space instead of a backdrop: the robot's mirror image
// in the floor, the air (dust, fireflies, snow, stars… drifting at different
// depths, so they slide past each other when the camera moves), soft bokeh, a
// shaft of light from above, and rings on the floor that spread out when it
// speaks and close in on it while you talk. Everything listens to the voice a
// little, so the room breathes with the conversation. Smooth colors only;
// nothing here is a photo or an outside asset. (The floor and the set itself
// are made by room3d.js.)
import * as THREE from "three";
import { radialTexture } from "./scene.js";

// What each quality level draws: how many of the air's particles, bokeh discs, the mirror image, the light shaft
export const WORLD_DETAIL = {
  low: { air: 0.4, bokeh: 6, reflection: false, shaft: false },
  medium: { air: 0.7, bokeh: 14, reflection: true, shaft: true },
  high: { air: 1, bokeh: 22, reflection: true, shaft: true },
};

const MAX_AIR = 420;
const RIPPLES = 4;
const RIPPLE_SECONDS = 2;
const WARM = new THREE.Color("#ffd9b0");

// What drifts through the air. Positions fill a box (size, middle); `flow` is how it moves (m/s) and
// `sway` how far it wanders; shape: 0 soft spot, 1 sparkle, 2 streak, 3 bubble, 4 petal.
// color: a fixed one, or the room's (null: follow the robot's light a little); additive blends light, not paint.
export const AIR_KINDS = {
  dust: { count: 150, box: [5, 2.6, 3.8], center: [0, 1.3, -0.3], flow: [0, 0.03, 0], sway: 0.18, size: [0.01, 0.034], twinkle: 0.45, shape: 0, alpha: 0.3, color: "#ffe3c4", follow: 0.45, additive: true, pull: 1, react: 1 },
  fireflies: { count: 46, box: [5, 2.2, 3.4], center: [0, 1.1, -0.4], flow: [0, 0.015, 0], sway: 0.55, size: [0.05, 0.085], twinkle: 1, shape: 0, alpha: 0.95, color: "#d8ff7a", follow: 0.0, additive: true, pull: 0, react: 0.6 },
  snow: { count: 340, box: [6, 3.2, 4.4], center: [0, 1.5, -0.6], flow: [-0.03, -0.2, 0], sway: 0.22, size: [0.022, 0.05], twinkle: 0.1, shape: 0, alpha: 0.85, color: "#ffffff", follow: 0, additive: false, pull: 0, react: 0.3 },
  stars: { count: 260, box: [16, 7.5, 7], center: [0, 3.4, -6], flow: [0, 0, 0], sway: 0, size: [0.07, 0.17], twinkle: 1, shape: 1, alpha: 0.9, color: "#ffffff", follow: 0.0, additive: true, pull: 0, react: 0.2 },
  bubbles: { count: 70, box: [5, 3, 3.6], center: [0, 1.5, -0.3], flow: [0, 0.26, 0], sway: 0.3, size: [0.05, 0.13], twinkle: 0.2, shape: 3, alpha: 0.7, color: "#d7f2ff", follow: 0.2, additive: true, pull: 0, react: 0.6 },
  petals: { count: 90, box: [5.5, 3, 3.8], center: [0, 1.5, -0.4], flow: [-0.1, -0.11, 0], sway: 0.7, size: [0.04, 0.075], twinkle: 0, shape: 4, alpha: 0.92, color: "#f7a8c4", follow: 0, additive: false, pull: 0, react: 0.3 },
  sparkles: { count: 110, box: [5, 3, 3.6], center: [0, 1.5, -0.3], flow: [0, 0.06, 0], sway: 0.3, size: [0.05, 0.11], twinkle: 0.9, shape: 1, alpha: 0.95, color: "#ffffff", follow: 0, additive: true, pull: 0, react: 0.8, rainbow: true },
  embers: { count: 90, box: [4.5, 2.8, 3.2], center: [0, 1.2, -0.3], flow: [0, 0.2, 0], sway: 0.35, size: [0.016, 0.04], twinkle: 0.8, shape: 0, alpha: 0.95, color: "#ff9a3d", follow: 0, additive: true, pull: 0, react: 0.8 },
  rain: { count: 330, box: [6, 3.4, 4.4], center: [0, 1.6, -0.7], flow: [-0.22, -3.1, 0], sway: 0, size: [0.07, 0.11], twinkle: 0, shape: 2, alpha: 0.5, color: "#bcd7ff", follow: 0, additive: false, pull: 0, react: 0 },
};

const AIR_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute vec3 aPos;
uniform float uTime;
uniform float uScale;
uniform float uLevel;
uniform float uPull;
uniform float uSway;
uniform float uTwinkle;
uniform float uSizeMul;
uniform vec3 uRobot;
uniform vec3 uBox;
uniform vec3 uCenter;
uniform vec3 uFlow;
varying float vAlpha;
varying float vSeed;
varying float vAngle;
void main() {
  float r1 = fract(aSeed * 7.13);
  float r2 = fract(aSeed * 13.7);
  // Moving along its flow and wrapping around the box; a little faster or slower for each one
  vec3 q = fract(aPos + (uFlow / uBox) * uTime * (0.7 + 0.6 * r1));
  vec3 p = uCenter + (q - 0.5) * uBox;
  p.x += sin(uTime * 0.25 + aSeed * 40.0) * uSway;
  p.z += cos(uTime * 0.21 + aSeed * 23.0) * uSway * 0.75;
  p.y += sin(uTime * 0.31 + aSeed * 17.0) * uSway * 0.25;
  p.xz += (uRobot.xz - p.xz) * uPull * (0.12 + 0.2 * r2);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (0.7 + r2 * 1.9) + aSeed * 50.0));
  vec3 edge3 = smoothstep(0.0, 0.1, q) * smoothstep(1.0, 0.9, q);
  float edge = edge3.x * edge3.y * edge3.z;
  vAlpha = twinkle * edge * (1.0 + uLevel * 0.8);
  vSeed = aSeed;
  vAngle = aSeed * 6.2831 + uTime * (0.4 + r1);
  gl_PointSize = clamp(aSize * uSizeMul * uScale * (1.0 + uLevel * 0.5) / -mv.z, 1.0, 64.0);
}`;

const AIR_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uShape;
uniform float uAlpha;
uniform float uRainbow;
varying float vAlpha;
varying float vSeed;
varying float vAngle;
vec3 hsv(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return mix(vec3(1.0), k, 0.75);
}
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  float d = length(p);
  float a = 0.0;
  if (uShape < 0.5) {
    a = pow(max(0.0, 1.0 - d), 2.0);
  } else if (uShape < 1.5) {
    // A four-pointed sparkle with a bright core
    a = max(exp(-abs(p.x) * 16.0) * exp(-abs(p.y) * 2.4), exp(-abs(p.y) * 16.0) * exp(-abs(p.x) * 2.4)) + pow(max(0.0, 1.0 - d), 3.0) * 0.8;
  } else if (uShape < 2.5) {
    // A falling streak
    a = smoothstep(0.1, 0.0, abs(p.x)) * smoothstep(1.0, 0.55, abs(p.y));
  } else if (uShape < 3.5) {
    // A bubble: a thin ring, a faint fill and a highlight
    a = smoothstep(0.14, 0.0, abs(d - 0.82)) + 0.12 * smoothstep(0.85, 0.0, d) + 0.7 * smoothstep(0.2, 0.0, length(p - vec2(-0.35, 0.38)));
  } else {
    // A petal, turning as it falls
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    a = smoothstep(1.0, 0.8, length(vec2(q.x * 1.0, q.y * 2.1)));
  }
  vec3 color = mix(uColor, uColor2, vSeed);
  if (uRainbow > 0.5) color = hsv(vSeed);
  gl_FragColor = vec4(color, a * vAlpha * uAlpha);
  #include <colorspace_fragment>
}`;

const SHAFT_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying float vUp;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  vUp = uv.y;
  gl_Position = projectionMatrix * mv;
}`;

// Soft edges (the cylinder's silhouette fades out), brightest at the top, gone at the floor
const SHAFT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vView;
varying float vUp;
void main() {
  float side = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.8);
  float along = smoothstep(0.0, 0.25, vUp) * (0.3 + 0.7 * vUp);
  gl_FragColor = vec4(uColor, side * along * uOpacity);
  #include <colorspace_fragment>
}`;

const ringTexture = () =>
  radialTexture([[0, "rgba(255,255,255,0)"], [0.8, "rgba(255,255,255,0)"], [0.9, "rgba(255,255,255,0.85)"], [0.95, "rgba(255,255,255,0.22)"], [1, "rgba(255,255,255,0)"]], 256);

export class World {
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.group = new THREE.Group();
    this.group.name = "World";
    this.scene.add(this.group);
    this.disposables = [];
    this.keep = (x) => (this.disposables.push(x), x);
    this.detail = WORLD_DETAIL.high;
    this.on = false;
    this.time = 0;
    this.level = 0;
    this.last = { ripple: -10, user: -10, loud: false };
    this.robot = new THREE.Vector3();
    this.pairs = [];
    this.mirror = null;
    // What this room asks of it (see configure)
    this.config = { air: { kind: "dust", amount: 1, color: null }, bokeh: true, shaft: true, rings: true, reflection: true };
    this.airKind = AIR_KINDS.dust;

    this.makeAir();
    this.makeBokeh();
    this.makeShaft();
    this.makeRipples();
    this.setActive(false);
  }

  // ---------- Pieces ----------
  makeAir() {
    const position = new Float32Array(MAX_AIR * 3);
    const aPos = new Float32Array(MAX_AIR * 3);
    const size = new Float32Array(MAX_AIR);
    const seed = new Float32Array(MAX_AIR);
    for (let i = 0; i < MAX_AIR; i++) {
      aPos.set([Math.random(), Math.random(), Math.random()], i * 3);
      size[i] = Math.random() * Math.random();
      seed[i] = Math.random();
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aPos", new THREE.BufferAttribute(aPos, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.airUniforms = {
      uTime: { value: 0 },
      uScale: { value: 1000 },
      uLevel: { value: 0 },
      uPull: { value: 0 },
      uSway: { value: 0.2 },
      uTwinkle: { value: 0.4 },
      uSizeMul: { value: 1 },
      uRobot: { value: this.robot },
      uBox: { value: new THREE.Vector3(5, 2.6, 3.8) },
      uCenter: { value: new THREE.Vector3(0, 1.3, -0.3) },
      uFlow: { value: new THREE.Vector3(0, 0.03, 0) },
      uColor: { value: new THREE.Color("#ffe3c4") },
      uColor2: { value: new THREE.Color("#ffe3c4") },
      uShape: { value: 0 },
      uAlpha: { value: 0.3 },
      uRainbow: { value: 0 },
    };
    this.airMaterial = this.keep(new THREE.ShaderMaterial({ vertexShader: AIR_VERTEX, fragmentShader: AIR_FRAGMENT, uniforms: this.airUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.air = new THREE.Points(geometry, this.airMaterial);
    this.air.frustumCulled = false;
    this.air.renderOrder = 4;
    this.group.add(this.air);
  }

  // Big, faint discs far behind: they hardly move, which is what sells the depth
  makeBokeh() {
    const tex = this.keep(radialTexture([[0, "rgba(255,255,255,0.9)"], [0.7, "rgba(255,255,255,0.55)"], [0.92, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]], 128));
    this.bokeh = [];
    for (let i = 0; i < WORLD_DETAIL.high.bokeh; i++) {
      const mat = this.keep(new THREE.SpriteMaterial({ map: tex, color: "#ffd9b0", transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      const sprite = new THREE.Sprite(mat);
      const scale = 0.18 + Math.random() * 0.4;
      sprite.scale.set(scale, scale, 1);
      sprite.userData = { base: new THREE.Vector3((Math.random() - 0.5) * 7, 0.2 + Math.random() * 2.4, -2.6 - Math.random() * 1.8), phase: Math.random() * 6.28, speed: 0.05 + Math.random() * 0.08 };
      sprite.renderOrder = -1;
      this.bokeh.push(sprite);
      this.group.add(sprite);
    }
  }

  makeShaft() {
    this.shaftUniforms = { uColor: { value: new THREE.Color("#ffe6c8") }, uOpacity: { value: 0.06 } };
    const material = this.keep(
      new THREE.ShaderMaterial({ vertexShader: SHAFT_VERTEX, fragmentShader: SHAFT_FRAGMENT, uniforms: this.shaftUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    this.shaft = new THREE.Mesh(this.keep(new THREE.CylinderGeometry(0.22, 0.95, 3.4, 40, 1, true)), material);
    this.shaft.position.set(-0.2, 1.7, -0.1);
    this.shaft.rotation.z = 0.1;
    this.shaft.renderOrder = 5;
    this.group.add(this.shaft);
  }

  makeRipples() {
    const tex = this.keep(ringTexture());
    const geometry = this.keep(new THREE.PlaneGeometry(2, 2));
    this.ripples = [];
    for (let i = 0; i < RIPPLES; i++) {
      const mat = this.keep(new THREE.MeshBasicMaterial({ map: tex, color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.005;
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.ripples.push({ mesh, age: 1, inward: false, power: 1 });
      this.group.add(mesh);
    }
  }

  // ---------- Setup ----------
  // The mirror image: a flipped copy of the robot sharing its geometry and
  // materials, copying its pose every frame (so a custom model works too)
  setRobot(robot) {
    this.mirror?.removeFromParent();
    this.mirror = null;
    this.pairs = [];
    try {
      const copy = robot.root.clone(true);
      copy.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      const mirror = new THREE.Group();
      mirror.name = "Reflection";
      mirror.scale.y = -1;
      mirror.add(copy);
      const from = [];
      const to = [];
      robot.root.traverse((o) => from.push(o));
      copy.traverse((o) => to.push(o));
      if (from.length === to.length) {
        this.pairs = from.map((o, i) => [o, to[i]]);
        this.mirror = mirror;
        this.scene.add(mirror);
      }
    } catch {
      this.mirror = null;
    }
    this.apply();
  }

  // on: draw the room's effects at all (in a place that wants them, in a host that shows them)
  setActive(on, level = "high") {
    this.on = on;
    this.detail = WORLD_DETAIL[level] || WORLD_DETAIL.high;
    this.apply();
  }

  // What the room asks for: { air: { kind, amount, color }, bokeh, shaft, rings, reflection }
  configure(config) {
    this.config = { ...this.config, ...config };
    const air = this.config.air;
    const kind = AIR_KINDS[air.kind];
    this.airKind = kind || null;
    if (kind) {
      const u = this.airUniforms;
      u.uBox.value.set(...kind.box);
      u.uCenter.value.set(...kind.center);
      u.uFlow.value.set(...kind.flow);
      u.uSway.value = kind.sway;
      u.uTwinkle.value = kind.twinkle;
      u.uShape.value = kind.shape;
      u.uAlpha.value = kind.alpha;
      u.uRainbow.value = kind.rainbow ? 1 : 0;
      this.airMaterial.blending = kind.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.airMaterial.needsUpdate = true;
      // Sizes: the particles' random factors spread between the kind's smallest and biggest
      const [lo, hi] = kind.size;
      const attr = this.air.geometry.attributes.aSize;
      if (!this.sizeBase) this.sizeBase = Float32Array.from(attr.array);
      for (let i = 0; i < attr.count; i++) attr.array[i] = lo + (hi - lo) * Math.sqrt(this.sizeBase[i]);
      attr.needsUpdate = true;
      this.airColor = new THREE.Color(kind.color);
    }
    this.apply();
  }

  apply() {
    const { on, detail, config } = this;
    this.group.visible = on;
    const kind = this.airKind;
    const count = kind ? Math.min(MAX_AIR, Math.round(kind.count * detail.air * config.air.amount)) : 0;
    this.air.geometry.setDrawRange(0, count);
    this.air.visible = Boolean(kind) && count > 0;
    this.bokeh.forEach((s, i) => (s.visible = on && config.bokeh && i < detail.bokeh));
    this.shaft.visible = on && config.shaft && detail.shaft;
    if (this.mirror) this.mirror.visible = on && config.reflection && detail.reflection;
  }

  setPixelScale(heightPx, fovDeg) {
    this.airUniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
  }

  // ---------- Each frame ----------
  // pose: the animator's pose (voice, position); accent, user: THREE.Color
  update(dt, pose, { accent, user }) {
    if (!this.on) return;
    this.time += dt;
    const t = this.time;
    const x = pose.posX || 0;
    const z = pose.posZ || 0;
    this.robot.set(x, 0, z);

    // How alive the room is: its voice, and your voice a little less
    const target = Math.max(pose.speaking || 0, (pose.userTalking || 0) * 0.55);
    this.level += (target - this.level) * (1 - Math.exp(-dt * (target > this.level ? 9 : 3)));
    const kind = this.airKind;
    if (kind) {
      const u = this.airUniforms;
      u.uTime.value = t;
      u.uLevel.value = this.level * kind.react;
      const pull = (pose.userTalking || 0) * kind.pull;
      u.uPull.value += (pull - u.uPull.value) * (1 - Math.exp(-dt * 2.5));
      // The color: its own, or (for light in the air) the robot's light, and yours while you talk
      const own = this.config.air.color || this.airColor;
      u.uColor.value.copy(own);
      if (kind.follow) u.uColor.value.lerp(accent, kind.follow).lerp(user, Math.min(1, pull) * 0.5);
      u.uColor2.value.copy(u.uColor.value);
      if (kind === AIR_KINDS.petals) u.uColor2.value.offsetHSL(0.04, 0, 0.12);
    }

    // The light follows it
    this.shaft.position.x = x - 0.2;
    this.shaft.position.z = z - 0.1;
    this.shaftUniforms.uOpacity.value = 0.05 + 0.07 * this.level + 0.03 * (pose.userTalking || 0);
    this.shaftUniforms.uColor.value.set("#ffe6c8").lerp(accent, 0.18 + 0.2 * this.level);

    // Bokeh: slow drift, tinted by the accent
    for (const s of this.bokeh) {
      if (!s.visible) continue;
      const d = s.userData;
      s.position.set(d.base.x + Math.sin(t * d.speed + d.phase) * 0.35, d.base.y + Math.cos(t * d.speed * 0.8 + d.phase) * 0.18, d.base.z);
      s.material.color.copy(accent).lerp(WARM, 0.55);
      s.material.opacity = 0.012 + 0.016 * (0.5 + 0.5 * Math.sin(t * d.speed * 3 + d.phase)) + 0.025 * this.level;
    }

    // The mirror image follows the robot, bone by bone
    if (this.mirror?.visible) {
      for (const [a, b] of this.pairs) {
        b.position.copy(a.position);
        b.quaternion.copy(a.quaternion);
        b.scale.copy(a.scale);
        b.visible = a.visible;
      }
    }

    if (this.config.rings) this.ripple(dt, pose, accent, user, x, z);
    else for (const r of this.ripples) r.mesh.visible = false;
  }

  // A ring leaves the robot with each phrase it speaks; while you talk, rings
  // in your color close in on it
  ripple(dt, pose, accent, user, x, z) {
    const last = this.last;
    const e = pose.speaking || 0;
    if (e > 0.28 && !last.loud && this.time - last.ripple > 0.45) {
      last.loud = true;
      this.spawn(false, accent, e);
    } else if (e < 0.14) {
      last.loud = false;
    }
    if ((pose.userTalking || 0) > 0.6 && this.time - last.user > 0.75) this.spawn(true, user, 0.7);
    for (const r of this.ripples) {
      if (r.age >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.age += dt / RIPPLE_SECONDS;
      const k = Math.min(1, r.age);
      const eased = 1 - (1 - k) ** 2;
      const radius = r.inward ? 1.7 - 1.45 * eased : 0.3 + 1.7 * eased;
      r.mesh.scale.set(radius, radius, 1);
      r.mesh.position.x = x;
      r.mesh.position.z = z;
      r.mesh.material.opacity = (r.inward ? Math.sin(k * Math.PI) * 0.3 : (1 - k) ** 1.6 * 0.34) * r.power;
      r.mesh.visible = true;
    }
  }

  spawn(inward, color, power) {
    const r = this.ripples.find((q) => q.age >= 1) || this.ripples.reduce((a, b) => (b.age > a.age ? b : a));
    r.age = 0;
    r.inward = inward;
    r.power = Math.min(1.2, 0.55 + power);
    r.mesh.material.color.copy(color);
    if (inward) this.last.user = this.time;
    else this.last.ripple = this.time;
  }

  dispose() {
    this.mirror?.removeFromParent();
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose?.();
  }
}
