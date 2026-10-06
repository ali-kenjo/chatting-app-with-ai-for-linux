// ---------- The robot's body ----------
// Built from three.js geometry (parts.js), shaped and colored by its design
// (design.mjs): a rounded head with a glossy face screen that follows its
// curve, a short neck, a body, two arms, glowing fins (or ears or antennae)
// and a hover ring; outfit/*.js dresses it. The named parts are the contract a
// custom model from Blender follows:
//
//   Root → Hover → Body → Neck → Head → FaceScreen
//                                Head → Fin_L, Fin_R
//                  Body → Arm_L, Arm_R (pivots at the shoulders)
//          Hover → HoverRing
//
// Sizes are in meters; the robot faces +z (the camera). Its left side (Arm_L,
// Fin_L) is on the viewer's right.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { dimsOf, superellipsoid, faceScreen, lathe, bodyGeometry, buildTop, buildArm, buildHover } from "./parts.js";
import { dress } from "./outfit/index.js";

export const NODE_NAMES = ["Root", "Hover", "Body", "Neck", "Head", "FaceScreen", "Fin_L", "Fin_R", "Arm_L", "Arm_R", "HoverRing"];

// The screen's height / width (the same for every design: it scales with the head)
export const SCREEN_ASPECT = 0.36 / 0.58;

// ---------- Materials ----------
// How the shell feels: [roughness, metalness, clearcoat, sheen, iridescence, envMapIntensity]
const FINISH = {
  matte: [0.82, 0, 0, 0.12, 0, 1],
  satin: [0.55, 0, 0.12, 0.2, 0, 1],
  glossy: [0.42, 0, 0.35, 0.3, 0, 1],
  metal: [0.3, 0.85, 0.15, 0, 0, 2.6],
  pearl: [0.3, 0, 0.8, 0.6, 0.7, 1.3],
};

const SHELL_KEYS = ["head", "body", "arms"];
const lightness = (color) => color.getHSL({}).l;

// Sets a shell material's color and finish (dark colors get a little less shine and sheen)
function setShell(mat, hex, finish) {
  const [roughness, metalness, clearcoat, sheen, iridescence, env] = FINISH[finish] || FINISH.glossy;
  mat.color.set(hex);
  const dark = lightness(mat.color) < 0.4;
  mat.roughness = dark && finish !== "metal" ? roughness + 0.08 : roughness;
  mat.metalness = metalness;
  mat.envMapIntensity = env;
  mat.sheenColor.set("#fff3e6");
  mat.sheenRoughness = 0.6;
  mat.clearcoatRoughness = 0.35;
  mat.iridescenceIOR = 1.35;
  mat.userData.rich = { clearcoat, sheen: dark ? sheen * 0.5 : sheen, iridescence };
  const rich = mat.userData.simple !== true;
  mat.clearcoat = rich ? clearcoat : 0;
  mat.sheen = rich ? mat.userData.rich.sheen : 0;
  mat.iridescence = rich ? iridescence : 0;
  mat.needsUpdate = true;
}

export function makeMaterials(design, light) {
  const shell = () => new THREE.MeshPhysicalMaterial({ color: "#ffffff" });
  const m = {
    head: shell(),
    body: shell(),
    arms: shell(),
    joint: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(design.colors.joint), roughness: 0.5, metalness: 0.15, clearcoat: 0.2 }),
    // Glossy, but its reflections stay soft so they never compete with the eyes
    screen: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#06080c"),
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.28,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 1.1,
    }),
    finGlowL: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(light), emissiveIntensity: 1 }),
    finGlowR: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(light), emissiveIntensity: 1 }),
    ring: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(light), emissiveIntensity: 1 }),
  };
  for (const key of SHELL_KEYS) setShell(m[key], design.colors[key], design.finish);
  return m;
}

// ---------- The built-in robot ----------
// design: see design.mjs; light: the color of its fins, ring and eyes (the design's own, or the app's accent)
export function buildRobot({ design, light, faceTexture }) {
  const dims = dimsOf(design.build);
  const m = makeMaterials(design, light);
  m.screen.emissiveMap = faceTexture;
  const group = (name, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    return g;
  };
  const make = (geometry, material, { shadow = true } = {}) => {
    const o = new THREE.Mesh(geometry, material);
    o.castShadow = shadow;
    o.receiveShadow = shadow;
    return o;
  };
  const { head, body: bodyDims, neck: neckDims } = dims;

  const root = group("Root");
  root.scale.setScalar(dims.size);
  const hover = group("Hover", 0, dims.hover, 0);
  root.add(hover);

  // Body
  const body = group("Body", 0, bodyDims.h / 2, 0);
  hover.add(body);
  const bodyMesh = make(bodyGeometry(dims), m.body);
  bodyMesh.position.y = -bodyDims.h / 2;
  body.add(bodyMesh);

  // Neck
  const neck = group("Neck", 0, neckDims.y, 0);
  body.add(neck);
  const neckMesh = make(new THREE.CylinderGeometry(neckDims.r, neckDims.r * 1.18, neckDims.h, 40), m.joint);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);

  // Head with its face screen
  const headNode = group("Head", 0, 0.06, 0);
  neck.add(headNode);
  const headMesh = make(superellipsoid(head.a, head.b, head.c, head.p), m.head);
  headMesh.position.y = head.y;
  headNode.add(headMesh);
  const screen = make(faceScreen(head), m.screen, { shadow: false });
  screen.name = "FaceScreen";
  screen.position.y = head.y;
  screen.receiveShadow = true;
  headNode.add(screen);

  // The top (fins, antennae, ears…)
  const tops = buildTop(design.build.topStyle, design.build.top, dims, m, make);
  for (const t of tops) headNode.add(t);

  // Arms
  body.add(buildArm("Arm_L", 1, dims, m, make), buildArm("Arm_R", -1, dims, m, make));

  // Hover ring (or jets)
  const ring = buildHover(design.build.hover, dims, m, make);
  if (ring) hover.add(ring);

  const robot = finish(root, m, { builtIn: true, screenAspect: SCREEN_ASPECT, dims, light: new THREE.Color(light), simple: false });
  robot.design = design;
  dress(robot, design, { make, group });
  robot.bounds = measure(root);
  return robot;
}

// How tall and wide the robot stands (its hover ring and mirror excluded), for framing it
function measure(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || o.name.includes("HoverRing") || o.parent?.name === "HoverRing") return;
    box.expandByObject(o, true);
  });
  const size = box.getSize(new THREE.Vector3());
  return { height: box.max.y, width: size.x, depth: size.z };
}

// Collects the named parts and remembers how each one rests
function finish(root, materials, extra) {
  const nodes = {};
  root.traverse((o) => {
    if (NODE_NAMES.includes(o.name) && !nodes[o.name]) nodes[o.name] = o;
  });
  if (!nodes.Root) nodes.Root = root;
  const rest = {};
  for (const [name, node] of Object.entries(nodes)) {
    rest[name] = { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
  }
  return { root, nodes, rest, materials, ...extra };
}

// ---------- Changing the looks of a robot that's there ----------
// Colors, finish and glow need no new shapes; the outfit's colors follow too
export function applyLook(robot, design, light) {
  if (!robot.builtIn) return;
  const m = robot.materials;
  robot.design = design;
  for (const key of SHELL_KEYS) setShell(m[key], design.colors[key], design.finish);
  m.joint.color.set(design.colors.joint);
  robot.light.set(light);
  for (const key of ["finGlowL", "finGlowR", "ring"]) m[key]?.emissive.set(light);
  robot.glow = design.glow;
  robot.outfit?.recolor(design, robot.light);
}

// ---------- Moving it ----------
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const white = new THREE.Color();

function turn(node, rest, x, y, z, order = "YXZ") {
  euler.set(x, y, z, order);
  quat.setFromEuler(euler);
  node.quaternion.copy(rest.quaternion).multiply(quat);
}

// pose: the animator's output; accent, user: THREE.Color; cameraFriendly: the
// filming look; glowBoost: a little more light when there's no bloom (Low)
export function applyPose(robot, pose, { accent, user, cameraFriendly = false, glowBoost = 1, time = 0 }) {
  const { nodes: n, rest: r, materials: m } = robot;
  if (n.Hover) {
    n.Hover.position.set(r.Hover.position.x + pose.posX, r.Hover.position.y + pose.hoverY, r.Hover.position.z + pose.hoverZ + pose.posZ);
  }
  if (n.Body) {
    turn(n.Body, r.Body, pose.bodyPitch, pose.bodyYaw + pose.spin, pose.bodyRoll);
    const s = pose.squash;
    n.Body.scale.set(r.Body.scale.x * (1 - s * 0.5), r.Body.scale.y * (1 + s), r.Body.scale.z * (1 - s * 0.5));
  }
  if (n.Head) turn(n.Head, r.Head, pose.headPitch, pose.headYaw, pose.headRoll);
  // Arms: forward first, then sideways, then swung in toward the middle
  if (n.Arm_L) turn(n.Arm_L, r.Arm_L, -pose.armLFwd, -pose.armLIn, pose.armLRaise, "YZX");
  if (n.Arm_R) turn(n.Arm_R, r.Arm_R, -pose.armRFwd, pose.armRIn, -pose.armRRaise, "YZX");
  if (n.Fin_L) turn(n.Fin_L, r.Fin_L, 0.3 * pose.finL, 0, 0.9 * pose.finL);
  if (n.Fin_R) turn(n.Fin_R, r.Fin_R, 0.3 * pose.finR, 0, -0.9 * pose.finR);

  // Light: the fins follow the voice (in your color while you talk), and a
  // light runs from fin to fin while it thinks; slower and softer on camera
  const strength = robot.glow ?? 1;
  const chase = pose.chase * (cameraFriendly ? 0.35 : 0.5);
  const glowL = Math.max(0, pose.finGlowL * (1 + chase * Math.sin(pose.chasePhase)));
  const glowR = Math.max(0, pose.finGlowR * (1 + chase * Math.sin(pose.chasePhase + Math.PI)));
  const mix = Math.min(1, Math.max(0, pose.finUser));
  white.copy(accent).lerp(user, mix);
  const finBoost = (cameraFriendly ? 2.6 : 3.2) * glowBoost * strength;
  if (m.finGlowL) {
    m.finGlowL.emissive.copy(white);
    m.finGlowL.emissiveIntensity = 0.25 + glowL * finBoost;
  }
  if (m.finGlowR) {
    m.finGlowR.emissive.copy(white);
    m.finGlowR.emissiveIntensity = 0.25 + glowR * finBoost;
  }
  if (m.ring) {
    m.ring.emissive.copy(accent).lerp(user, mix * 0.5);
    m.ring.emissiveIntensity = Math.max(0, pose.ringGlow) * (cameraFriendly ? 1.3 : 1.6) * strength;
  }
  if (m.screen) m.screen.emissiveIntensity = Math.max(0, pose.glow) * (cameraFriendly ? 0.95 : 1.1) * glowBoost * Math.min(1.25, 0.6 + 0.4 * strength);
  // Things that move by themselves (a propeller, a cape's sway, a glowing chest)
  robot.outfit?.update(pose, time, { accent, user, mix, cameraFriendly });
}

// Low quality: the same colors with simpler shaders (no clearcoat, no sheen)
export function setMaterialDetail(robot, rich) {
  if (!robot.builtIn) return;
  for (const key of [...SHELL_KEYS, "joint", "screen"]) {
    const mat = robot.materials[key];
    if (!mat) continue;
    if (key === "joint" || key === "screen") {
      mat.userData.rich ||= { clearcoat: mat.clearcoat, sheen: mat.sheen, iridescence: 0 };
    }
    mat.userData.simple = !rich;
    mat.clearcoat = rich ? mat.userData.rich.clearcoat : 0;
    mat.sheen = rich ? mat.userData.rich.sheen : 0;
    mat.iridescence = rich ? mat.userData.rich.iridescence : 0;
    mat.needsUpdate = true;
  }
  robot.outfit?.setDetail?.(rich);
}

export function disposeRobot(robot) {
  const seen = new Set();
  robot.root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    for (const mat of [].concat(o.material || [])) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap", "bumpMap"]) {
        const tex = mat[key];
        // The face texture belongs to the engine, not to the model
        if (tex && !seen.has(tex) && !tex.userData?.shared) {
          seen.add(tex);
          tex.dispose();
        }
      }
      mat.dispose();
    }
  });
  robot.root.removeFromParent();
}

// ---------- A robot from Blender (.glb) ----------
// Parts are found by name; missing ones just don't move. FaceScreen gets the
// eyes as light, the fins and the hover ring glow in the accent color.
export async function loadRobot(url, { accent, faceTexture }) {
  const loader = new GLTFLoader();
  // Textures load through <img>, which the page's security policy allows for blob: URLs
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: "friends_image_textures" };
  });
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene || gltf.scenes?.[0];
  if (!scene) throw new Error("The model has no scene.");

  let root = scene.getObjectByName("Root");
  if (!root) {
    root = new THREE.Group();
    root.name = "Root";
    root.add(scene);
  } else {
    root.removeFromParent();
  }
  root.updateMatrixWorld(true);

  // A model far off the robot's size is scaled to about 1.35 m and stood on the ground
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const holder = new THREE.Group();
  holder.add(root);
  if (size.y > 0 && (size.y < 0.6 || size.y > 2.5)) holder.scale.setScalar(1.35 / size.y);
  holder.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(holder);
  holder.position.set(-(fitted.min.x + fitted.max.x) / 2, -fitted.min.y, -(fitted.min.z + fitted.max.z) / 2);

  const materials = { screen: null, finGlowL: null, finGlowR: null, ring: null };
  const own = (mesh) => {
    // Its own copy, so the glow can change without touching shared materials
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const copy = mat?.isMeshStandardMaterial ? mat.clone() : new THREE.MeshStandardMaterial({ color: mat?.color || new THREE.Color("#222222") });
    mesh.material = copy;
    return copy;
  };
  const meshesOf = (node) => {
    const list = [];
    node?.traverse((o) => o.isMesh && list.push(o));
    return list;
  };
  let screenAspect = SCREEN_ASPECT;
  let faceMissing = false;
  const faceNode = root.getObjectByName("FaceScreen");
  for (const mesh of meshesOf(faceNode)) {
    if (!mesh.geometry.attributes.uv) {
      faceMissing = true;
      continue;
    }
    const mat = own(mesh);
    mat.emissive = new THREE.Color("#ffffff");
    mat.emissiveMap = faceTexture;
    mat.emissiveIntensity = 2;
    materials.screen = mat;
    mesh.geometry.computeBoundingBox();
    const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
    if (s.x > 0 && s.y > 0) screenAspect = s.y / s.x;
  }
  const glowOf = (name, key) => {
    const meshes = meshesOf(root.getObjectByName(name));
    // Prefer a part named like "Fin_L_Light"; else the whole fin glows softly
    const lit = meshes.filter((mesh) => /light|glow/i.test(mesh.name));
    for (const mesh of lit.length ? lit : meshes) {
      const mat = own(mesh);
      mat.emissive = new THREE.Color(accent);
      materials[key] = materials[key] || mat;
      if (materials[key] !== mat) mat.emissive = materials[key].emissive; // share one color object
      mesh.material = materials[key];
    }
  };
  glowOf("Fin_L", "finGlowL");
  glowOf("Fin_R", "finGlowR");
  glowOf("HoverRing", "ring");
  holder.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const robot = finish(holder, materials, { builtIn: false, screenAspect });
  robot.nodes.Root = root;
  robot.missing = NODE_NAMES.filter((name) => !robot.nodes[name]);
  robot.faceWithoutUv = faceMissing;
  return robot;
}
