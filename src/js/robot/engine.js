// ---------- The 3D engine ----------
// One WebGL renderer for the whole page. Its canvas moves to wherever the
// robot is shown ("hosts": voice mode, the settings preview, the chat dock),
// and it draws only there, only while that's visible. With no host, or the
// tab hidden, it stops completely.
//
// Each frame: the face is drawn into its texture; the scene is rendered with
// multisampling into a float target (transparent where nothing is); bright
// parts are blurred into bloom; then one last pass tone-maps the robot and
// lays it over the background. That pass paints the flat backgrounds itself,
// so studio grays and chroma green or blue come out exactly, untouched by
// tone mapping, and chroma keys get no shadow and no glow.
import * as THREE from "three";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { Face } from "./face.js";
import { Stage } from "./scene.js";
import { World } from "./world.js";
import { buildRobot, loadRobot, applyPose, setShellColor, setMaterialDetail, disposeRobot, SCREEN_ASPECT } from "./model.js";
import { SHELLS, userGlowFor } from "./presets.mjs";
import { springStep, clamp } from "./spring.mjs";

// What each quality level spends: pixel ratio (capped by the screen's),
// multisampling, bloom, shadows, face texture size
// Low keeps 2x multisampling (jagged, shimmering edges turn into moiré on
// camera) but renders into an 8-bit buffer with simpler shell shaders: on a
// built-in Intel GPU that's the difference between about 35 and 55-60 fps.
export const QUALITY = {
  low: { ratio: 1, samples: 2, float: false, rich: false, bloom: false, shadows: false, shadowSize: 1024, face: "low" },
  medium: { ratio: 1.25, samples: 4, float: true, rich: true, bloom: true, shadows: true, shadowSize: 1024, face: "medium" },
  high: { ratio: 2, samples: 4, float: true, rich: true, bloom: true, shadows: true, shadowSize: 2048, face: "high" },
};
const DOWN = { high: "medium", medium: "low" };

// Camera shots: how much of the robot (meters, measured upward) is in the
// picture and where its middle is; `width` must also fit (portrait videos)
const SHOTS = {
  close: { height: 0.84, center: 1.0, width: 0.95 },
  medium: { height: 1.52, center: 0.74, width: 1.12 },
  wide: { height: 2.6, center: 0.84, width: 1.9 },
  dock: { height: 1.46, center: 0.7, width: 1.22 },
};

// Chroma keys (the standard green and blue) and the studio's grays
const CHROMA = { green: new THREE.Color("#00b140"), blue: new THREE.Color("#0047bb") };
const STUDIO = { middle: new THREE.Color("#26272c"), edge: new THREE.Color("#0b0b0d") };

const FINAL = {
  uniforms: {
    tScene: { value: null },
    tBloom: { value: null },
    uBloom: { value: 0 },
    uMode: { value: 1 },
    uBg: { value: new THREE.Color() },
    uBgEdge: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGlowAmount: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uExposure: { value: 1 },
    uFriendly: { value: 0 },
    uSeed: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform int uMode;       // 0 flat color, 1 studio vignette, 2 studio with an accent glow
uniform vec3 uBg;        // linear, as displayed (no tone mapping)
uniform vec3 uBgEdge;
uniform vec3 uGlow;
uniform float uGlowAmount;
uniform vec2 uCenter;    // the robot on screen
uniform float uAspect;
uniform float uExposure;
uniform float uFriendly; // camera-friendly look
uniform float uSeed;

// Khronos PBR Neutral: keeps the shell's and the accent's colors true
vec3 neutral(vec3 color) {
  const float start = 0.76;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < start) return color;
  float d = 1.0 - start;
  float newPeak = 1.0 - d * d / (peak + d - start);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 s = texture2D(tScene, vUv);
  float a = clamp(s.a, 0.0, 1.0);
  vec3 body = a > 0.0005 ? s.rgb / a : vec3(0.0);
  vec3 lit = neutral(max(body * uExposure, 0.0));
  if (uFriendly > 0.5) {
    // A little brighter in the middle tones, and never a glaring white
    lit = pow(lit, vec3(0.92));
    lit *= 1.0 - 0.12 * smoothstep(0.72, 1.0, max(lit.r, max(lit.g, lit.b)));
  }
  vec3 bg = uBg;
  if (uMode > 0) {
    float r = length((vUv - uCenter) * vec2(uAspect, 1.0));
    bg = mix(uBg, uBgEdge, smoothstep(0.12, 1.2, r));
    if (uMode == 2) bg += uGlow * uGlowAmount * exp(-r * r * 3.5);
  }
  vec3 color = mix(bg, lit, a);
  if (uBloom > 0.5) color += texture2D(tBloom, vUv).rgb * uExposure;
  vec3 outColor = toSRGB(clamp(color, 0.0, 1.0));
  // Soft gradients band in 8 bits; a little random noise hides that (never on chroma)
  if (uMode > 0) outColor += (hash(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  gl_FragColor = vec4(outColor, 1.0);
}`,
};

const linear = (hex) => new THREE.Color(hex); // three.js keeps Color in linear sRGB

export class RobotEngine {
  // animator: the shared Animator; hooks.beforeUpdate(dt) runs each frame first
  constructor({ animator, hooks = {} }) {
    this.animator = animator;
    this.hooks = hooks;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "robot-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // softened by the light's shadow.radius
    this.renderer = renderer;

    this.look = {
      shell: SHELLS.warm,
      eyes: "classic",
      accent: linear("#6f9cf5"),
      user: linear(userGlowFor("#6f9cf5")),
      background: "studio",
      shot: "medium",
      position: "center",
      cinematic: false,
      roam: true,
      world: true,
      largerFace: false,
      cameraFriendly: false,
      quality: "auto",
      theme: { bg: "#131314", glow: 0.12 },
      themeColor: new THREE.Color("#131314"),
    };
    this.level = "high"; // the quality in use (Auto may have stepped it down)
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

    this.face = new Face(renderer, { aspect: SCREEN_ASPECT });
    this.face.texture.userData.shared = true;
    this.stage = new Stage(renderer);
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 40);
    this.cam = { dist: { x: 4, v: 0 }, center: { x: 0.74, v: 0 }, shift: { x: 0, v: 0 }, ready: false };
    this.robot = buildRobot({ shell: this.look.shell, accent: this.look.accent, faceTexture: this.face.texture });
    this.stage.scene.add(this.robot.root);
    this.world = new World(this.stage);
    this.world.setRobot(this.robot);
    this.worldKey = "";
    this.tmp = new THREE.Vector3();
    this.hitSphere = new THREE.Sphere(new THREE.Vector3(), 0.5);
    this.raycaster = new THREE.Raycaster();
    // Mouse and touch: where the pointer is, the camera's extra angles (it
    // peeks around with the pointer, and you can drag it), and a press on the robot
    this.pointer = { x: 0, y: 0, inside: false, down: false, onRobot: false, moved: 0, held: false, hover: false, timer: 0, sx: 0, sy: 0 };
    this.cam.yaw = { x: 0, v: 0 };
    this.cam.pitch = { x: 0, v: 0 };
    this.cam.follow = { x: 0, v: 0 };
    this.drag = { yaw: 0, pitch: 0, until: 0 };
    this.listening = null;

    this.sceneTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    // Only what glows blooms: a second, smaller render where everything else is black
    this.glowTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.twins = new Map(); // glowing material → a flat copy showing only its light
    this.swapped = [];
    // For each mesh in the glow pass (made once, not every frame)
    this.glowVisit = (o) => {
      if (!o.isMesh) return;
      const mat = o.material;
      if (this.glowing.has(mat)) {
        let twin = this.twins.get(mat);
        if (!twin) this.twins.set(mat, (twin = new THREE.MeshBasicMaterial()));
        twin.color.copy(mat.emissive).multiplyScalar(mat.emissiveIntensity);
        twin.map = mat.emissiveMap || null;
        twin.side = mat.side;
        this.swapped.push(o, mat, true);
        o.material = twin;
      } else if (mat.transparent || mat.isShadowMaterial) {
        this.swapped.push(o, mat, false);
        o.visible = false;
      } else {
        this.swapped.push(o, mat, true);
        o.material = this.black;
      }
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0);
    // The bloom is added in the last pass; its own blend onto the scene is switched off
    this.bloom.blendMaterial.colorWrite = false;
    this.final = new FullScreenQuad(new THREE.ShaderMaterial({ ...FINAL, uniforms: THREE.UniformsUtils.clone(FINAL.uniforms), depthTest: false, depthWrite: false }));
    this.final.material.uniforms.tScene.value = this.sceneTarget.texture;

    this.hosts = new Map(); // name → { el, priority, visible, options }
    this.active = null;
    this.size = { w: 0, h: 0, ratio: 0 };
    this.last = 0;
    this.raf = 0;
    this.lost = false;
    this.fps = { frames: 0, time: 0, warm: 0 };
    this.frame = this.frame.bind(this);
    this.projected = new THREE.Vector3();

    this.observer = new ResizeObserver(() => this.resize());
    this.onVisibility = () => this.update();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault(); // lets it come back
      this.lost = true;
      this.stop();
      this.emit("context", { lost: true });
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.stage.makeEnvironment(); // the reflections were a render, so render them again
      this.size = { w: 0, h: 0, ratio: 0 };
      this.resize();
      this.update();
      this.emit("context", { lost: false });
    });
    this.applyQuality();
  }

  emit(name, detail) {
    document.dispatchEvent(new CustomEvent(`friends:robot-${name}`, { detail }));
  }

  // ---------- Hosts ----------
  // options: priority (higher wins), shot, background, position, cinematic,
  // fixed: [w, h] (render exactly this size, e.g. a video frame), onFrame(canvas),
  // roomBelow: leave space under the robot in portrait pictures (captions)
  attach(name, el, options = {}) {
    this.hosts.set(name, { name, el, visible: false, priority: options.priority ?? 1, options });
    this.update();
  }

  detach(name) {
    this.hosts.delete(name);
    this.update();
  }

  setVisible(name, visible) {
    const host = this.hosts.get(name);
    if (!host || host.visible === visible) return;
    host.visible = visible;
    this.update();
  }

  setHostOptions(name, options) {
    const host = this.hosts.get(name);
    if (!host) return;
    Object.assign(host.options, options);
    if (this.active === host) {
      this.size = { w: 0, h: 0, ratio: 0 };
      this.resize();
    }
  }

  // Picks where to draw, moves the canvas there, and starts or stops the loop
  update() {
    let best = null;
    for (const host of this.hosts.values()) {
      if (host.visible && (!best || host.priority > best.priority)) best = host;
    }
    if (best !== this.active) {
      if (this.active) this.observer.unobserve(this.active.el);
      this.unbindPointer();
      this.active = best;
      if (best?.options.interactive) this.bindPointer(best.el);
      if (best) {
        best.el.append(this.canvas);
        this.observer.observe(best.el);
        this.size = { w: 0, h: 0, ratio: 0 };
        this.resize();
        this.fps = { frames: 0, time: 0, warm: 0 };
      } else {
        this.canvas.remove();
      }
    }
    const run = Boolean(this.active) && !document.hidden && !this.lost;
    if (run && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run) {
      this.stop();
    }
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get running() {
    return Boolean(this.raf);
  }

  hostOption(key) {
    return this.active?.options[key] ?? this.look[key];
  }

  // ---------- Size and quality ----------
  resize() {
    const host = this.active;
    if (!host) return;
    const q = QUALITY[this.level];
    let w;
    let h;
    let ratio;
    if (host.options.fixed) {
      [w, h] = host.options.fixed;
      ratio = 1;
    } else {
      const rect = host.el.getBoundingClientRect();
      w = Math.max(2, Math.round(rect.width));
      h = Math.max(2, Math.round(rect.height));
      ratio = Math.min(window.devicePixelRatio || 1, q.ratio);
    }
    if (w === this.size.w && h === this.size.h && ratio === this.size.ratio) return;
    this.size = { w, h, ratio };
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    const pw = Math.round(w * ratio);
    const ph = Math.round(h * ratio);
    this.sceneTarget.setSize(pw, ph);
    this.glowTarget.setSize(Math.max(2, Math.round(pw / 2)), Math.max(2, Math.round(ph / 2)));
    this.bloom.setSize(pw, ph);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.world.setPixelScale(ph, this.camera.fov);
    this.cam.ready = false;
  }

  setQuality(setting) {
    this.look.quality = setting;
    this.level = setting === "auto" ? this.autoStart() : setting;
    this.applyQuality();
  }

  // Auto starts high on a big screen, medium on a very dense one
  autoStart() {
    return (window.devicePixelRatio || 1) > 2.2 ? "medium" : "high";
  }

  applyQuality() {
    const q = QUALITY[this.level];
    const samples = Math.min(q.samples, this.renderer.capabilities.maxSamples || 4);
    // Float (for bloom's bright highlights) or 8-bit sRGB (Low, no bloom)
    const type = q.float ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const colorSpace = q.float ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    const tex = this.sceneTarget.texture;
    if (this.sceneTarget.samples !== samples || tex.type !== type || tex.colorSpace !== colorSpace) {
      this.sceneTarget.dispose();
      this.sceneTarget.samples = samples;
      tex.type = type;
      tex.colorSpace = colorSpace;
    }
    setMaterialDetail(this.robot, q.rich);
    this.stage.setShadows(q.shadows, q.shadowSize);
    if (this.face.configure({ quality: q.face })) this.useFaceTexture();
    this.size = { w: 0, h: 0, ratio: 0 };
    this.resize();
    this.fps = { frames: 0, time: 0, warm: 0 };
    this.emit("quality", { setting: this.look.quality, level: this.level });
  }

  // Auto: below about 50 frames a second for 3 seconds steps down one level
  // (not while filming: the look must not change in the middle of a shot)
  measure(dt) {
    if (this.look.quality !== "auto" || !DOWN[this.level] || this.look.cameraFriendly || this.qualityLocked) return;
    const f = this.fps;
    if (f.warm < 2) {
      f.warm += dt;
      return;
    }
    f.frames++;
    f.time += dt;
    if (f.time < 3) return;
    const rate = f.frames / f.time;
    this.fps = { frames: 0, time: 0, warm: 0 };
    if (rate < 50) {
      this.level = DOWN[this.level];
      this.applyQuality();
    }
  }

  // ---------- Looks ----------
  setLook(look) {
    const before = { ...this.look };
    Object.assign(this.look, look);
    if (look.accent) {
      this.look.accent = linear(look.accent);
      this.look.user = linear(userGlowFor(look.accent));
      this.stage.setAccent(this.look.accent);
      for (const key of ["finGlowL", "finGlowR", "ring"]) this.robot.materials[key]?.emissive.copy(this.look.accent);
    }
    if (look.shell && look.shell !== before.shell) setShellColor(this.robot, look.shell);
    if (look.cameraFriendly !== undefined) this.stage.setCameraFriendly(look.cameraFriendly);
    if (look.theme) this.look.themeColor.set(look.theme.bg);
  }

  useFaceTexture() {
    this.face.texture.userData.shared = true;
    const screen = this.robot.materials.screen;
    if (screen) {
      screen.emissiveMap = this.face.texture;
      screen.needsUpdate = true;
    }
  }

  // Your own model, or back to the built-in one (info from /api/robot/model/info)
  async useModel(info) {
    let next;
    if (info?.custom) {
      next = await loadRobot(`/api/robot/model?v=${encodeURIComponent(info.uploadedAt)}`, { accent: this.look.accent, faceTexture: this.face.texture });
    } else {
      if (this.robot.builtIn) return this.robot;
      next = buildRobot({ shell: this.look.shell, accent: this.look.accent, faceTexture: this.face.texture });
    }
    const old = this.robot;
    this.robot = next;
    this.stage.scene.add(next.root);
    this.world.setRobot(next);
    disposeRobot(old);
    for (const twin of this.twins.values()) twin.dispose();
    this.twins.clear();
    this.face.configure({ aspect: next.screenAspect || SCREEN_ASPECT });
    this.useFaceTexture();
    setMaterialDetail(next, QUALITY[this.level].rich);
    return next;
  }

  // ---------- Each frame ----------
  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.active) return;
    this.measure(dt);
    const options = this.animator.options;
    options.reducedMotion = this.reducedMotion.matches;
    options.cameraFriendly = this.look.cameraFriendly;
    options.roam = this.roamAmount();
    this.hooks.beforeUpdate?.(dt);
    const pose = this.animator.update(dt);
    this.draw(pose, dt);
    this.active?.options.onFrame?.(this.canvas);
  }

  draw(pose, dt) {
    const look = this.look;
    const background = this.hostOption("background");
    const bloomOn = QUALITY[this.level].bloom && background !== "green" && background !== "blue";
    applyPose(this.robot, pose, { accent: look.accent, user: look.user, cameraFriendly: look.cameraFriendly, glowBoost: bloomOn ? 1 : 1.3 });
    this.stage.follow(pose.hoverY, pose.posX, pose.posZ);
    this.updateWorld(dt, pose, background);
    this.face.render(pose, { eyes: look.eyes, largerFace: look.largerFace, color: look.accent });

    this.stage.setBackground(background);
    this.frameCamera(dt, pose);

    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.stage.scene, this.camera);
    if (bloomOn) {
      this.renderGlow();
      this.bloom.strength = look.cameraFriendly ? 0.35 : 0.5;
      this.bloom.render(r, null, this.glowTarget, dt, false);
    }
    this.paintBackground(background, bloomOn, pose);
    r.setRenderTarget(null);
    this.final.render(r);
  }

  // The scene once more, where only light shows: glowing parts as their light
  // alone (no reflections), solid parts black so they still hide what's behind,
  // see-through ones (shadows, the floor glow) left out
  renderGlow() {
    if (this.glowingFor !== this.robot) {
      const m = this.robot.materials;
      this.glowing = new Set([m.screen, m.finGlowL, m.finGlowR, m.ring, this.stage.lampShade].filter(Boolean));
      this.glowingFor = this.robot;
    }
    const swapped = this.swapped;
    this.stage.scene.traverseVisible(this.glowVisit);
    const r = this.renderer;
    const shadows = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setRenderTarget(this.glowTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.stage.scene, this.camera);
    r.shadowMap.enabled = shadows;
    for (let i = 0; i < swapped.length; i += 3) {
      const o = swapped[i];
      if (swapped[i + 2]) o.material = swapped[i + 1];
      else o.visible = true;
    }
    swapped.length = 0;
  }

  paintBackground(kind, bloomOn, pose) {
    const u = this.final.material.uniforms;
    u.tScene.value = this.sceneTarget.texture;
    u.tBloom.value = this.bloom.renderTargetsHorizontal[0].texture;
    u.uBloom.value = bloomOn ? 1 : 0;
    u.uAspect.value = this.camera.aspect;
    u.uExposure.value = this.look.cameraFriendly ? 1.06 : 1;
    u.uFriendly.value = this.look.cameraFriendly ? 1 : 0;
    u.uSeed.value = (u.uSeed.value + 17.13) % 1000;
    // Where the robot is on screen, for the vignette and the glow
    this.projected.set(pose.posX || 0, 0.72, pose.posZ || 0).project(this.camera);
    u.uCenter.value.set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5);
    if (kind === "green" || kind === "blue") {
      u.uMode.value = 0;
      u.uBg.value.copy(CHROMA[kind]);
    } else if (kind === "dock") {
      u.uMode.value = 2;
      u.uBg.value.copy(this.look.themeColor);
      u.uBgEdge.value.copy(this.look.themeColor);
      u.uGlow.value.copy(this.look.accent);
      u.uGlowAmount.value = this.look.theme.glow;
    } else {
      u.uMode.value = kind === "accent" ? 2 : 1;
      u.uBg.value.copy(STUDIO.middle);
      u.uBgEdge.value.copy(STUDIO.edge);
      u.uGlow.value.copy(this.look.accent);
      u.uGlowAmount.value = 0.28;
    }
  }

  // The virtual camera: the shot, the robot's place in the picture (thirds),
  // a slow drift and a push-in on emphasis when "cinematic" is on
  frameCamera(dt, pose) {
    const shot = SHOTS[this.hostOption("shot")] || SHOTS.medium;
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // With the room on, a little more of the floor shows (its reflection is part of the picture)
    const roomy = this.worldKey.startsWith("true") && shot !== SHOTS.close ? 1 : 0;
    const height = shot.height * (1 + 0.13 * roomy);
    let dist = Math.max(height / 2 / t, shot.width / 2 / (t * aspect));
    let center = shot.center - 0.09 * roomy;
    // Portrait voice mode and videos: a little room below for the captions
    if (portrait && this.hostOption("roomBelow")) center -= height * 0.08;
    const moving = this.hostOption("cinematic") && !this.reducedMotion.matches;
    const time = pose.t;
    let orbit = 0;
    let rise = 0;
    if (moving) {
      dist *= 1 - 0.07 * Math.max(0, pose.emphasis) + 0.025 * Math.sin((time * Math.PI * 2) / 31 + 1);
      orbit = 0.06 * Math.sin((time * Math.PI * 2) / 23);
      rise = 0.02 * Math.sin((time * Math.PI * 2) / 19 + 2);
    }
    // Peeking around with the pointer, dragging the view, and keeping a roaming robot in frame
    const pointer = this.pointer;
    const interactive = Boolean(this.hostOption("interactive")) && !this.look.cameraFriendly && !this.active?.options.fixed && !this.reducedMotion.matches;
    let yaw = 0;
    let pitch = 0;
    if (interactive) {
      if (this.drag.until > performance.now()) {
        yaw += this.drag.yaw;
        pitch += this.drag.pitch;
      }
    }
    const follow = (pose.posX || 0) * 0.55;
    const place = portrait ? "center" : this.hostOption("position");
    const shift = place === "left" ? 1 / 6 : place === "right" ? -1 / 6 : 0;
    const c = this.cam;
    if (!c.ready) {
      c.dist = { x: dist, v: 0 };
      c.center = { x: center, v: 0 };
      c.shift = { x: shift, v: 0 };
      c.yaw = { x: yaw, v: 0 };
      c.pitch = { x: pitch, v: 0 };
      c.follow = { x: follow, v: 0 };
      c.ready = true;
    } else {
      springStep(c.dist, dist, 4, dt);
      springStep(c.center, center, 4, dt);
      springStep(c.shift, shift, 4, dt);
      springStep(c.yaw, yaw, 3.2, dt);
      springStep(c.pitch, pitch, 3.2, dt);
      springStep(c.follow, follow, 2.4, dt);
    }
    const d = c.dist.x + (pose.posZ || 0) * 0.55; // it comes nearer, mostly by getting bigger, a little by the camera backing off
    const angle = orbit + c.yaw.x;
    const y = c.center.x + d * (0.1 + c.pitch.x) + rise; // a touch from above
    this.camera.position.set(Math.sin(angle) * d + c.follow.x, y, Math.cos(angle) * d);
    this.camera.lookAt(c.follow.x, c.center.x, 0);
    // Moves the picture sideways without turning the camera, so the robot sits on a third
    const { w, h } = this.size;
    if (Math.abs(c.shift.x) > 1e-4 && w && h) this.camera.setViewOffset(w, h, c.shift.x * w, 0, w, h);
    else this.camera.clearViewOffset();
  }

  // ---------- Roaming, and the room ----------
  // How far it may roam (0 = stays put): not while filming (the frame must
  // stay steady), less at the desk (there are things in the way)
  roamAmount() {
    const place = this.active?.options;
    if (!place?.roam || !this.look.roam || this.look.cameraFriendly) return 0;
    const bg = this.hostOption("background");
    return bg === "desk" ? 0.5 : 1;
  }

  updateWorld(dt, pose, background) {
    const place = this.active?.options;
    const on = Boolean(place?.world) && this.look.world && !this.look.cameraFriendly && (background === "studio" || background === "accent");
    const key = `${on}|${this.level}`;
    if (key !== this.worldKey) {
      this.worldKey = key;
      this.world.setActive(on, this.level);
    }
    if (on) this.world.update(dt, pose, { accent: this.look.accent, user: this.look.user });
  }

  // ---------- The pointer ----------
  bindPointer(el) {
    const on = (type, fn) => el.addEventListener(type, fn);
    const handlers = {
      pointermove: (e) => this.onPointerMove(e),
      pointerdown: (e) => this.onPointerDown(e),
      pointerup: (e) => this.onPointerUp(e),
      pointercancel: () => this.onPointerLeave(),
      pointerleave: () => this.onPointerLeave(),
    };
    for (const [type, fn] of Object.entries(handlers)) on(type, fn);
    this.listening = { el, handlers };
  }

  unbindPointer() {
    const l = this.listening;
    if (!l) return;
    for (const [type, fn] of Object.entries(l.handlers)) l.el.removeEventListener(type, fn);
    l.el.style.cursor = "";
    this.listening = null;
    this.onPointerLeave();
  }

  // Updates the pointer's place (-1..1 on the picture) and tests it against the robot
  trackPointer(e) {
    const rect = this.listening.el.getBoundingClientRect();
    const p = this.pointer;
    p.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    p.y = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    p.inside = true;
    const pose = this.animator.pose;
    this.hitSphere.center.set(pose.posX || 0, 0.72 + (pose.hoverY || 0), pose.posZ || 0);
    this.raycaster.setFromCamera({ x: p.x, y: p.y }, this.camera);
    const hit = this.raycaster.ray.intersectSphere(this.hitSphere, this.tmp) !== null;
    // Where it is on the picture, so the pointer is "to its left" or "above it"
    this.tmp.set(this.hitSphere.center.x, 0.72, this.hitSphere.center.z).project(this.camera);
    const rel = { x: clamp((p.x - this.tmp.x) * 1.1, -1, 1), y: clamp((p.y - this.tmp.y) * 1.1, -1, 1) };
    return { hit, rel };
  }

  onPointerMove(e) {
    if (this.look.cameraFriendly) return;
    const p = this.pointer;
    const { hit, rel } = this.trackPointer(e);
    if (hit !== p.hover) {
      p.hover = hit;
      this.listening.el.style.cursor = hit ? "pointer" : "";
    }
    if (p.down) {
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      p.moved = Math.max(p.moved, moved);
      if (!p.onRobot && p.moved > 4) {
        // Dragging the empty room turns the view (it eases back after a moment)
        this.drag.yaw = clamp((e.clientX - p.sx) * -0.0016, -0.5, 0.5);
        this.drag.pitch = clamp((e.clientY - p.sy) * 0.0008, -0.12, 0.2);
        this.drag.until = performance.now() + 3000;
      } else if (p.onRobot && p.moved > 10) {
        clearTimeout(p.timer);
      }
    }
  }

  onPointerDown(e) {
    if (this.look.cameraFriendly || (e.pointerType === "mouse" && e.button !== 0)) return;
    const p = this.pointer;
    const { hit, rel } = this.trackPointer(e);
    Object.assign(p, { down: true, onRobot: hit, moved: 0, held: false, sx: e.clientX, sy: e.clientY, rel: rel.x });
    this.listening.el.setPointerCapture?.(e.pointerId);
    clearTimeout(p.timer);
    if (hit) p.timer = setTimeout(() => {
      if (p.down && p.onRobot && p.moved < 10) {
        p.held = true;
        this.animator.poke("hold");
      }
    }, 650);
  }

  onPointerUp(e) {
    const p = this.pointer;
    if (!p.down) return;
    clearTimeout(p.timer);
    p.down = false;
    this.listening?.el.releasePointerCapture?.(e.pointerId);
    if (p.onRobot && !p.held && p.moved < 10) this.animator.poke("tap", { x: p.rel });
    else if (!p.onRobot) this.drag.until = performance.now() + 1800;
  }

  onPointerLeave() {
    const p = this.pointer;
    clearTimeout(p.timer);
    Object.assign(p, { inside: false, down: false, hover: false });
    if (this.listening) this.listening.el.style.cursor = "";
    this.animator.setPointer(null);
  }

  // Draws one frame right now (used before a snapshot); the loop keeps going
  renderNow() {
    if (!this.active || this.lost) return;
    this.draw(this.animator.pose, 0);
  }

  dispose() {
    this.stop();
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    disposeRobot(this.robot);
    this.unbindPointer();
    this.world.dispose();
    this.stage.dispose();
    this.face.dispose();
    this.sceneTarget.dispose();
    this.glowTarget.dispose();
    this.black.dispose();
    for (const twin of this.twins.values()) twin.dispose();
    this.bloom.dispose();
    this.final.material.dispose();
    this.final.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
