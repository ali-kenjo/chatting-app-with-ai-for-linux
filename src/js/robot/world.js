// ---------- The room around the robot ----------
// What makes the studio a space instead of a backdrop: a glossy floor that
// mirrors the robot, dust and soft bokeh drifting at different depths (they
// slide past each other when the camera moves), a shaft of light from above,
// and rings on the floor that spread out when it speaks and close in on it
// while you talk. Everything listens to the voice a little, so the room
// breathes with the conversation. Smooth colors only; nothing here is a
// photo or an outside asset.
import * as THREE from "three";
import { radialTexture } from "./scene.js";

// What each quality level draws: dust specks, bokeh discs, the mirror image, the light shaft
export const WORLD_DETAIL = {
  low: { dust: 70, bokeh: 6, reflection: false, shaft: false },
  medium: { dust: 140, bokeh: 14, reflection: true, shaft: true },
  high: { dust: 220, bokeh: 22, reflection: true, shaft: true },
};

const DUST_HEIGHT = 2.6;
const RIPPLES = 4;
const RIPPLE_SECONDS = 2;
const WARM = new THREE.Color("#ffd9b0");

const DUST_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
uniform float uLevel;
uniform float uPull;
uniform vec3 uRobot;
varying float vAlpha;
void main() {
  vec3 p = position;
  float r1 = fract(aSeed * 7.13);
  float r2 = fract(aSeed * 13.7);
  // Rising slowly, wrapping around; swaying; drawn in toward the robot while you talk
  p.y = mod(p.y + uTime * (0.015 + 0.04 * r1), ${DUST_HEIGHT.toFixed(2)});
  p.x += sin(uTime * 0.25 + aSeed * 40.0) * 0.18;
  p.z += cos(uTime * 0.21 + aSeed * 23.0) * 0.14;
  p.xz += (uRobot.xz - p.xz) * uPull * (0.12 + 0.2 * r2);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.7 + r2 * 1.5) + aSeed * 50.0);
  float edge = smoothstep(0.0, 0.3, p.y) * smoothstep(${DUST_HEIGHT.toFixed(2)}, ${(DUST_HEIGHT - 0.5).toFixed(2)}, p.y);
  vAlpha = twinkle * edge * (0.3 + uLevel * 0.8);
  gl_PointSize = clamp(aSize * uScale * (1.0 + uLevel * 0.5) / -mv.z, 1.0, 40.0);
}`;

const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.0);
  gl_FragColor = vec4(uColor, a * vAlpha);
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

    this.makeFloor();
    this.makeDust();
    this.makeBokeh();
    this.makeShaft();
    this.makeRipples();
    this.setActive(false);
  }

  // ---------- Pieces ----------
  makeFloor() {
    // A dark glossy pool under the robot that fades into the studio; the mirror image shows through it
    const tex = this.keep(radialTexture([[0, "rgba(20,21,25,0.74)"], [0.5, "rgba(20,21,25,0.6)"], [1, "rgba(20,21,25,0)"]], 256));
    this.floor = new THREE.Mesh(
      this.keep(new THREE.PlaneGeometry(5, 5)),
      this.keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }))
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.001;
    this.floor.renderOrder = 0;
    this.group.add(this.floor);
  }

  makeDust() {
    const max = WORLD_DETAIL.high.dust;
    const position = new Float32Array(max * 3);
    const size = new Float32Array(max);
    const seed = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      position.set([(Math.random() - 0.5) * 5, Math.random() * DUST_HEIGHT, -2.2 + Math.random() * 3.8], i * 3);
      size[i] = 0.01 + Math.random() * Math.random() * 0.022;
      seed[i] = Math.random();
    }
    const geometry = this.keep(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dustUniforms = {
      uTime: { value: 0 },
      uScale: { value: 1000 },
      uLevel: { value: 0 },
      uPull: { value: 0 },
      uRobot: { value: this.robot },
      uColor: { value: new THREE.Color("#ffe3c4") },
    };
    const material = this.keep(
      new THREE.ShaderMaterial({ vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT, uniforms: this.dustUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.dust = new THREE.Points(geometry, material);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 4;
    this.group.add(this.dust);
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

  // on: draw the room at all (a studio-type background, in a place that wants it)
  setActive(on, level = "high") {
    this.on = on;
    this.detail = WORLD_DETAIL[level] || WORLD_DETAIL.high;
    this.apply();
  }

  apply() {
    const { on, detail } = this;
    this.group.visible = on;
    this.dust.geometry.setDrawRange(0, detail.dust);
    this.bokeh.forEach((s, i) => (s.visible = on && i < detail.bokeh));
    this.shaft.visible = on && detail.shaft;
    if (this.mirror) this.mirror.visible = on && detail.reflection;
  }

  setPixelScale(heightPx, fovDeg) {
    this.dustUniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
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
    const u = this.dustUniforms;
    u.uTime.value = t;
    u.uLevel.value = this.level;
    const pull = pose.userTalking || 0;
    u.uPull.value += (pull - u.uPull.value) * (1 - Math.exp(-dt * 2.5));
    u.uColor.value.set("#ffe3c4").lerp(accent, 0.45).lerp(user, Math.min(1, pull) * 0.5);

    // The floor and the light follow it
    this.floor.position.x = x;
    this.floor.position.z = z;
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

    this.ripple(dt, pose, accent, user, x, z);
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
