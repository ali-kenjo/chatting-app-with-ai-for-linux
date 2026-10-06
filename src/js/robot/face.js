// ---------- The face screen ----------
// Eyes and mouth are drawn from signed distance functions (shapes described by
// math, not pixels) into a texture every frame, then shown on the face
// screen as light. Edges are anti-aliased from the shapes themselves and the
// texture has mipmaps, so they stay crisp in a close-up and don't shimmer
// (which a camera would turn into moiré) when the robot is small.
import * as THREE from "three";
import { EYE_STYLES, MOUTH_STYLES } from "./presets.mjs";

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uEyeL;   // center x, y, half width, half height (face units)
uniform vec4 uEyeR;
uniform vec4 uLidL;   // top 0..1, bottom 0..1, slant, smile 0..1
uniform vec4 uLidR;
uniform vec2 uEye;    // roundness, blink
uniform vec4 uMouth;  // center x, y, half width, opening
uniform vec4 uMouth2; // curve, skew, roundness, line thickness
uniform vec4 uMisc;   // unused, blush, mouth visible, aspect (height / width)
uniform vec3 uColor;
uniform vec3 uBlush;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Inside = 1, outside = 0, with a soft edge about a pixel wide
float fill(float d) {
  float w = max(fwidth(d) * 0.8, 1e-5);
  return 1.0 - smoothstep(-w, w, d);
}

// One eye: its shape, cut by the lids and (smiling) by a circle from below.
// side: +1 for the robot's left eye (on the viewer's right), -1 for its right.
float eye(vec2 p, vec4 e, vec4 lid, float side) {
  float blink = uEye.y;
  vec2 b = e.zw;
  vec2 q = p - e.xy;
  // A blink flattens the eye toward its lower part
  q.y += b.y * 0.35 * blink;
  b.y = mix(b.y, max(b.y * 0.1, 0.012), blink);
  float r = mix(0.35, 1.0, uEye.x) * min(b.x, b.y);
  float d = sdRoundBox(q, b, r);
  // Upper lid: a slanted line coming down; + slant lowers the inner corner
  float a = -lid.z * side;
  d = max(d, dot(q, vec2(sin(a), cos(a))) - b.y * (1.0 - 2.0 * lid.x));
  // Lower lid rising
  d = max(d, -q.y - b.y * (1.0 - 2.0 * lid.y));
  // Smiling eyes: only an arch stays
  float R = b.x * 1.3;
  float cy = mix(-b.y - R, 0.5 * b.y - R, lid.w);
  d = max(d, R - length(q - vec2(0.0, cy)));
  return d;
}

// The mouth: a rounded line bent by curve and skew that opens into a shape
float mouth(vec2 p) {
  vec2 q = p - uMouth.xy;
  float w = max(uMouth.z, 0.01);
  float curve = uMouth2.x;
  float skew = uMouth2.y;
  float t = uMouth2.w;
  float xc = clamp(q.x, -w, w);
  float u = xc / w;
  float bend = 0.55 * w * curve;
  float c = bend * (u * u - 0.35) + skew * 0.3 * w * u;
  float slope = (2.0 * bend * u + skew * 0.3 * w) / w;
  float profile = sqrt(max(0.0, 1.0 - u * u));
  // A happy open mouth has a flat top; a round one opens evenly
  float up = mix(mix(0.5, 0.12, clamp(curve, 0.0, 1.0)), 0.5, uMouth2.z);
  float dy = q.y - c;
  if (abs(q.x) > w) return length(vec2(q.x - xc, dy)) - t * 0.5;
  float half_ = dy > 0.0 ? t * 0.5 + uMouth.w * up * profile : t * 0.5 + uMouth.w * (1.0 - up) * profile;
  return (abs(dy) - half_) / sqrt(1.0 + slope * slope);
}

float dot2(vec2 v) { return dot(v, v); }

void main() {
  vec2 p = vec2(vUv.x * 2.0 - 1.0, (vUv.y * 2.0 - 1.0) * uMisc.w);
  float dL = eye(p, uEyeL, uLidL, 1.0);
  float dR = eye(p, uEyeR, uLidR, -1.0);
  float dE = min(dL, dR);
  // Eyes glow a little brighter inside, like a lit screen
  float eyes = fill(dE) * (0.86 + 0.14 * smoothstep(0.0, -0.06, dE));
  // A soft highlight in each eye (same light direction in both)
  float hl = fill(length(p - (uEyeL.xy + vec2(-0.3, 0.42) * uEyeL.zw)) - 0.3 * min(uEyeL.z, uEyeL.w)) * fill(dL);
  hl += fill(length(p - (uEyeR.xy + vec2(-0.3, 0.42) * uEyeR.zw)) - 0.3 * min(uEyeR.z, uEyeR.w)) * fill(dR);
  hl *= 1.0 - uEye.y;
  // The mouth: a bright rim, darker inside when it's open
  float dM = mouth(p);
  float mo = (fill(dM) - 0.7 * fill(dM + uMouth2.w * 0.9)) * uMisc.z;
  // Light spilling softly around the features
  float halo = exp(-max(dE, 0.0) * 18.0) * 0.16 + exp(-max(dM, 0.0) * 22.0) * 0.08 * uMisc.z;
  // Blush under the eyes
  float bl = exp(-dot2((p - vec2(uEyeL.x, uEyeL.y - uEyeL.w - 0.08)) * vec2(6.0, 11.0)));
  bl += exp(-dot2((p - vec2(uEyeR.x, uEyeR.y - uEyeR.w - 0.08)) * vec2(6.0, 11.0)));
  vec3 color = uColor * (eyes + mo + halo) + vec3(1.0, 0.97, 0.93) * hl * 0.5 + uBlush * bl * uMisc.y * 0.5;
  gl_FragColor = vec4(min(color, vec3(1.0)), 1.0);
}`;

// Width of the face texture per quality level (its height follows the screen's shape)
const SIZES = { low: 1024, medium: 1536, high: 2048 };
const BLUSH = new THREE.Color("#ff6f91");

export class Face {
  // aspect: the face screen's height / width
  constructor(renderer, { aspect = 0.62 } = {}) {
    this.renderer = renderer;
    this.aspect = aspect;
    this.quality = "high";
    this.uniforms = {
      uEyeL: { value: new THREE.Vector4() },
      uEyeR: { value: new THREE.Vector4() },
      uLidL: { value: new THREE.Vector4() },
      uLidR: { value: new THREE.Vector4() },
      uEye: { value: new THREE.Vector2() },
      uMouth: { value: new THREE.Vector4() },
      uMouth2: { value: new THREE.Vector4() },
      uMisc: { value: new THREE.Vector4(1, 0, 1, aspect) },
      uColor: { value: new THREE.Color("#6f9cf5") },
      uBlush: { value: BLUSH.clone() },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.target = this.makeTarget();
  }

  makeTarget() {
    const width = SIZES[this.quality] || SIZES.high;
    const height = Math.round((width * this.aspect) / 4) * 4;
    const target = new THREE.WebGLRenderTarget(width, height, {
      colorSpace: THREE.SRGBColorSpace, // 8 bits, but smooth: stored as sRGB, read back as linear
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    target.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    target.texture.name = "robot face";
    return target;
  }

  get texture() {
    return this.target.texture;
  }

  // A new size or shape. Materials keep using `texture`, so they're told to update.
  configure({ quality = this.quality, aspect = this.aspect } = {}) {
    if (quality === this.quality && Math.abs(aspect - this.aspect) < 1e-3) return false;
    this.quality = quality;
    this.aspect = aspect;
    this.uniforms.uMisc.value.w = aspect;
    const old = this.target;
    this.target = this.makeTarget();
    old.dispose();
    return true;
  }

  // pose: the animator's output; look: { face (the design's: eyes, eyeSize, eyeGap, mouth, blush), largerFace, color }
  render(pose, { face = {}, largerFace = false, color }) {
    const s = EYE_STYLES[face.eyes] || EYE_STYLES.classic;
    const mouth = MOUTH_STYLES[face.mouth] || MOUTH_STYLES.line;
    const k = largerFace ? 1.15 : 1;
    const size = face.eyeSize ?? 1;
    const gapScale = face.eyeGap ?? 1;
    const u = this.uniforms;
    const lookX = pose.lookX * 0.13;
    const lookY = pose.lookY * 0.09;
    const y = s.y + pose.eyeY * 0.1 + lookY;
    const w = s.w * k * size * pose.eyeW;
    const h = s.h * k * size * pose.eyeH;
    const gap = s.gap * k * gapScale;
    // The robot's left eye is on the viewer's right
    u.uEyeL.value.set(gap + lookX, y, w * pose.eyeScaleL, h * pose.eyeScaleL);
    u.uEyeR.value.set(-gap + lookX, y, w * pose.eyeScaleR, h * pose.eyeScaleR);
    u.uLidL.value.set(clamp01(pose.lidTopL), clamp01(pose.lidBotL), pose.lidAngleL, clamp01(pose.smile));
    u.uLidR.value.set(clamp01(pose.lidTopR), clamp01(pose.lidBotR), pose.lidAngleR, clamp01(pose.smile));
    u.uEye.value.set(clamp01(s.round + (1 - s.round) * pose.eyeRound), clamp01(pose.blink));

    const round = clamp01(pose.mouthRound);
    const open = clamp01(pose.mouthOpen);
    const halfWidth = 0.15 * k * mouth.width * (0.55 + 0.9 * clamp01(pose.mouthWide)) * (1 - 0.45 * round);
    u.uMouth.value.set(pose.mouthSkew * 0.03 + lookX * 0.4, -0.3 * k + lookY * 0.4 - open * 0.05, halfWidth, open * 0.3 * k * (1 + 0.35 * round));
    u.uMouth2.value.set(pose.mouthCurve, pose.mouthSkew, round, 0.05 * k * mouth.weight);
    u.uMisc.value.set(1, clamp01(pose.blush), pose.mouthVisible * mouth.show, this.aspect);
    if (color) u.uColor.value.copy(color);
    if (face.blush) u.uBlush.value.set(face.blush);

    const r = this.renderer;
    const before = r.getRenderTarget();
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(before);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
