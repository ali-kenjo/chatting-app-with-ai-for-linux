// ---------- The robot's body ----------
// Built from three.js geometry: a rounded head (a superellipsoid) with a
// glossy face screen that follows its curve, a short neck, a bean-shaped
// body, two paddle arms with ball joints, two glowing fins and a hover ring.
// The named parts are the contract a custom model from Blender follows:
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

export const NODE_NAMES = ["Root", "Hover", "Body", "Neck", "Head", "FaceScreen", "Fin_L", "Fin_R", "Arm_L", "Arm_R", "HoverRing"];

const HOVER_HEIGHT = 0.15;
const HEAD = { a: 0.36, b: 0.25, c: 0.3, p: 3.1, y: 0.24 };
const SCREEN = { w: 0.58, h: 0.36, n: 4.2, y: 0.005 };
export const SCREEN_ASPECT = SCREEN.h / SCREEN.w;

// ---------- Shapes ----------
// A sphere pushed out into a rounded box: |x/a|^p + |y/b|^p + |z/c|^p = 1
function superellipsoid(a, b, c, p, widthSegments = 96, heightSegments = 64) {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = Math.pow(Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p, -1 / p);
    pos.setXYZ(i, v.x * k * a, v.y * k * b, v.z * k * c);
  }
  geo.computeVertexNormals();
  return geo;
}

// The face screen: a squircle-shaped patch lying on the head's front surface,
// with texture coordinates running evenly across it
function faceScreen() {
  const { a, b, c, p } = HEAD;
  const { w, h, n, y: dy } = SCREEN;
  const segX = 72;
  const segY = 48;
  const positions = [];
  const uvs = [];
  for (let j = 0; j <= segY; j++) {
    for (let i = 0; i <= segX; i++) {
      const s = (i / segX) * 2 - 1;
      const t = (j / segY) * 2 - 1;
      const r = Math.max(Math.abs(s), Math.abs(t));
      let x = 0;
      let y = 0;
      if (r > 0) {
        const dx = s / r;
        const dyy = t / r;
        const k = Math.pow(Math.abs(dx) ** n + Math.abs(dyy) ** n, -1 / n);
        x = r * dx * k * (w / 2);
        y = r * dyy * k * (h / 2);
      }
      const inner = 1 - Math.abs(x / a) ** p - Math.abs((y + dy) / b) ** p;
      const z = c * Math.pow(Math.max(inner, 0), 1 / p) + 0.004;
      positions.push(x, y + dy, z);
      uvs.push(x / w + 0.5, y / h + 0.5);
    }
  }
  const index = [];
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const a0 = j * (segX + 1) + i;
      const b0 = a0 + 1;
      const c0 = a0 + segX + 1;
      const d0 = c0 + 1;
      index.push(a0, b0, d0, a0, d0, c0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// A smooth profile turned around the y axis. points: [radius, height] from bottom to top
function lathe(points, segments = 64) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

// A profile through a few control points, smoothed into many
function smoothProfile(controls, count = 48) {
  const curve = new THREE.SplineCurve(controls.map(([r, y]) => new THREE.Vector2(r, y)));
  return curve.getPoints(count).map((v) => [Math.max(0, v.x), v.y]);
}

// ---------- Materials ----------
export function makeMaterials({ shell, accent }) {
  return {
    shell: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(shell),
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
      sheen: 0.3,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color("#fff3e6"),
    }),
    joint: new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#2b2e35"), roughness: 0.5, metalness: 0.15, clearcoat: 0.2 }),
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
    finGlowL: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(accent), emissiveIntensity: 1 }),
    finGlowR: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(accent), emissiveIntensity: 1 }),
    ring: new THREE.MeshStandardMaterial({ color: new THREE.Color("#101216"), roughness: 0.3, emissive: new THREE.Color(accent), emissiveIntensity: 1 }),
  };
}

// ---------- The built-in robot ----------
export function buildRobot({ shell, accent, faceTexture }) {
  const m = makeMaterials({ shell, accent });
  m.screen.emissiveMap = faceTexture;
  const group = (name, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    return g;
  };
  const mesh = (geometry, material, { shadow = true } = {}) => {
    const o = new THREE.Mesh(geometry, material);
    o.castShadow = shadow;
    o.receiveShadow = shadow;
    return o;
  };

  const root = group("Root");
  const hover = group("Hover", 0, HOVER_HEIGHT, 0);
  root.add(hover);

  // Body: a soft bean, widest at the belly, narrower at the shoulders
  const body = group("Body", 0, 0.27, 0);
  hover.add(body);
  const bodyProfile = smoothProfile([
    [0.0, 0.0],
    [0.13, 0.012],
    [0.225, 0.07],
    [0.262, 0.19],
    [0.245, 0.33],
    [0.195, 0.45],
    [0.1, 0.515],
    [0.0, 0.53],
  ]);
  const bodyGeo = lathe(bodyProfile, 72);
  bodyGeo.scale(1, 1, 0.9);
  const bodyMesh = mesh(bodyGeo, m.shell);
  bodyMesh.position.y = -0.27;
  body.add(bodyMesh);

  // Neck
  const neck = group("Neck", 0, 0.235, 0);
  body.add(neck);
  const neckMesh = mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.09, 40), m.joint);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);

  // Head with its face screen
  const head = group("Head", 0, 0.06, 0);
  neck.add(head);
  const headMesh = mesh(superellipsoid(HEAD.a, HEAD.b, HEAD.c, HEAD.p), m.shell);
  headMesh.position.y = HEAD.y;
  head.add(headMesh);
  const screen = mesh(faceScreen(), m.screen, { shadow: false });
  screen.name = "FaceScreen";
  screen.position.y = HEAD.y;
  screen.receiveShadow = true;
  head.add(screen);

  // Fins: little rounded blades on top, glowing at their tips
  const finProfile = smoothProfile([
    [0.0, 0.0],
    [0.04, 0.004],
    [0.042, 0.05],
    [0.052, 0.1],
    [0.045, 0.14],
    [0.022, 0.168],
    [0.0, 0.172],
  ], 40);
  const finBaseGeo = lathe(finProfile.filter(([, y]) => y <= 0.092).concat([[0.05, 0.092]]), 40);
  const finTipGeo = lathe([[0.0495, 0.088], ...finProfile.filter(([, y]) => y > 0.092)], 40);
  for (const g of [finBaseGeo, finTipGeo]) g.scale(1, 1, 0.55);
  const fin = (name, side, glow) => {
    const f = group(name, side * 0.25, HEAD.y + 0.2, -0.03);
    f.rotation.z = -side * 0.35;
    f.add(mesh(finBaseGeo, m.shell));
    const tip = mesh(finTipGeo, glow, { shadow: false });
    tip.name = `${name}_Light`;
    f.add(tip);
    return f;
  };
  head.add(fin("Fin_L", 1, m.finGlowL), fin("Fin_R", -1, m.finGlowR));

  // Arms: a ball joint at the shoulder, a short arm and a paddle hand
  const upperGeo = new THREE.CapsuleGeometry(0.043, 0.13, 8, 24);
  const handGeo = new THREE.SphereGeometry(0.066, 40, 28);
  handGeo.scale(0.82, 1.12, 0.56);
  const jointGeo = new THREE.SphereGeometry(0.052, 32, 20);
  const arm = (name, side) => {
    const a = group(name, side * 0.25, 0.13, 0.0);
    a.add(mesh(jointGeo, m.joint));
    const upper = mesh(upperGeo, m.shell);
    upper.position.y = -0.1;
    a.add(upper);
    const hand = mesh(handGeo, m.shell);
    hand.position.y = -0.225;
    hand.name = `${name}_Hand`;
    a.add(hand);
    return a;
  };
  body.add(arm("Arm_L", 1), arm("Arm_R", -1));

  // Hover ring under the body
  const ring = mesh(new THREE.TorusGeometry(0.16, 0.019, 20, 80), m.ring, { shadow: false });
  ring.name = "HoverRing";
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.03;
  hover.add(ring);

  return finish(root, m, { builtIn: true, screenAspect: SCREEN_ASPECT });
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
export function applyPose(robot, pose, { accent, user, cameraFriendly = false, glowBoost = 1 }) {
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
  const chase = pose.chase * (cameraFriendly ? 0.35 : 0.5);
  const glowL = Math.max(0, pose.finGlowL * (1 + chase * Math.sin(pose.chasePhase)));
  const glowR = Math.max(0, pose.finGlowR * (1 + chase * Math.sin(pose.chasePhase + Math.PI)));
  const mix = Math.min(1, Math.max(0, pose.finUser));
  white.copy(accent).lerp(user, mix);
  const finBoost = (cameraFriendly ? 2.6 : 3.2) * glowBoost;
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
    m.ring.emissiveIntensity = Math.max(0, pose.ringGlow) * (cameraFriendly ? 1.3 : 1.6);
  }
  if (m.screen) m.screen.emissiveIntensity = Math.max(0, pose.glow) * (cameraFriendly ? 0.95 : 1.1) * glowBoost;
}

// Low quality: the same colors with simpler shaders (no clearcoat, no sheen)
export function setMaterialDetail(robot, rich) {
  if (!robot.builtIn) return;
  for (const mat of [robot.materials.shell, robot.materials.joint, robot.materials.screen]) {
    if (!mat) continue;
    mat.userData.rich ||= { clearcoat: mat.clearcoat, sheen: mat.sheen };
    mat.clearcoat = rich ? mat.userData.rich.clearcoat : 0;
    mat.sheen = rich ? mat.userData.rich.sheen : 0;
  }
}

export function setShellColor(robot, color) {
  robot.materials.shell?.color.set(color);
  const graphite = new THREE.Color(color).getHSL({}).l < 0.4;
  const shell = robot.materials.shell;
  if (shell) {
    shell.roughness = graphite ? 0.5 : 0.42;
    shell.userData.rich = { clearcoat: 0.35, sheen: graphite ? 0.15 : 0.3 };
    if (shell.sheen > 0) shell.sheen = shell.userData.rich.sheen;
  }
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
