// ---------- The robot, for the rest of the app ----------
// One robot character, shared by voice mode, the chat dock and the settings
// preview. Voice mode and the chat tell `robot.director` what happens; places
// that show the robot register as hosts. The 3D engine (three.js) loads the
// first time a host is shown; without WebGL the robot is just unavailable
// and the rest of the app carries on.
import { Animator } from "./animator.mjs";
import { Director } from "./director.mjs";
import { SHELLS } from "./presets.mjs";
import { FaceTracker } from "./facetrack.js";
import { getSettings, onSettings } from "../store.js";

export const animator = new Animator();

async function smartMood(text, heard) {
  if (!getSettings()?.robot?.smartMoods) return null;
  try {
    const res = await fetch("/api/robot/mood", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 2000), heard: String(heard || "").slice(0, 600) }) });
    return res.ok ? (await res.json()).mood || null : null;
  } catch {
    return null;
  }
}

export const director = new Director(animator, { smartMood });

let engine = null;
let loading = null;
let unavailable = ""; // why the 3D robot can't be shown, once that's known
const hosts = new Map(); // name → { el, options, visible }
const filming = { on: false, cameraFriendly: true, largerFace: false };
let modelInfo = { custom: false };

export function webglSupported() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

function notify(name, detail) {
  document.dispatchEvent(new CustomEvent(`friends:robot-${name}`, { detail }));
}

// The engine, loaded once. Rejects (and stays unavailable) without WebGL 2.
export function loadEngine() {
  if (engine) return Promise.resolve(engine);
  if (!unavailable && !loading && !webglSupported()) {
    // Decided at once, so everyone asking gets the same answer
    unavailable = "WebGL isn't available in this browser.";
    notify("unavailable", { reason: unavailable });
  }
  if (unavailable) return Promise.reject(new Error(unavailable));
  loading ||= (async () => {
    const { RobotEngine } = await import("./engine.js");
    const e = new RobotEngine({ animator, hooks: { beforeUpdate: (dt) => director.frame(dt) } });
    engine = e;
    applySettings(getSettings());
    for (const [name, h] of hosts) {
      e.attach(name, h.el, h.options);
      e.setVisible(name, h.visible);
    }
    if (modelInfo.custom) useModel(modelInfo).catch(() => {});
    notify("ready", {});
    return e;
  })().catch((err) => {
    unavailable = err.message || "The 3D robot couldn't start.";
    loading = null;
    console.warn("Robot unavailable:", err);
    notify("unavailable", { reason: unavailable });
    throw err;
  });
  return loading;
}

// ---------- Settings → the robot's looks ----------
function themeBackground() {
  const css = getComputedStyle(document.documentElement);
  return css.getPropertyValue("--bg-main").trim() || "#131314";
}

function applySettings(s) {
  if (!s) return;
  const r = s.robot;
  animator.setOptions({ mouth: r.mouth });
  animator.setSeat(r.seat);
  // The 2D faces (chat avatars, the eye-style buttons) match the robot
  const root = document.documentElement;
  root.style.setProperty("--robot-shell", SHELLS[r.shell] || SHELLS.warm);
  root.dataset.robotEyes = r.eyes;
  root.dataset.robotMouth = r.mouth ? "on" : "off";
  if (!engine) return;
  engine.setLook({
    shell: SHELLS[r.shell] || SHELLS.warm,
    eyes: r.eyes,
    accent: s.theme.accent,
    background: r.background,
    shot: r.shot,
    position: r.position,
    cinematic: r.cinematic,
    roam: r.roam !== false,
    world: r.world !== false,
    cameraFriendly: filming.on && filming.cameraFriendly,
    largerFace: filming.on && filming.largerFace,
    theme: { bg: themeBackground(), glow: document.documentElement.dataset.theme === "light" ? 0.06 : 0.08 },
  });
  if (engine.look.quality !== r.quality) engine.setQuality(r.quality);
}

onSettings(applySettings);

// ---------- "Follow my face" ----------
// The camera is on only while the setting is on, a robot is showing and the
// tab is visible; otherwise it's let go (and its light goes off).
const tracker = new FaceTracker({
  onFace: (face) => animator.setFace(face),
  onStatus: (status) => {
    faceStatus = status;
    notify("face", status);
  },
});
let faceStatus = { state: "off", message: "" };
let faceBlocked = false; // a failure waits for the setting to be switched again

function syncFace() {
  const s = getSettings();
  const wanted = Boolean(s?.robot?.followFace) && [...hosts.values()].some((h) => h.visible) && !document.hidden;
  if (wanted && !tracker.running && !faceBlocked) {
    tracker.start().then(() => {
      if (["blocked", "busy", "none", "error"].includes(faceStatus.state)) faceBlocked = true;
    });
  } else if (!wanted && tracker.running) {
    tracker.stop();
  }
}

let followFace = false;
onSettings((s) => {
  if (s.robot.followFace !== followFace) {
    followFace = s.robot.followFace;
    faceBlocked = false;
    if (!followFace) {
      tracker.stop();
      faceStatus = { state: "off", message: "" };
      notify("face", faceStatus);
    }
  }
  syncFace();
});
document.addEventListener("visibilitychange", syncFace);
// The theme can change without the settings changing ("System" follows the desktop)
new MutationObserver(() => applySettings(getSettings())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

async function useModel(info) {
  modelInfo = info || { custom: false };
  if (!engine) return null;
  try {
    const model = await engine.useModel(modelInfo);
    notify("model", { info: modelInfo, missing: model.missing || [], faceWithoutUv: Boolean(model.faceWithoutUv) });
    return model;
  } catch (err) {
    notify("model", { info: modelInfo, error: err.message });
    if (modelInfo.custom) await engine.useModel({ custom: false });
    throw err;
  }
}

// Your own model, if you uploaded one
fetch("/api/robot/model/info")
  .then((res) => (res.ok ? res.json() : { custom: false }))
  .then((info) => {
    modelInfo = info;
    if (info.custom && engine) useModel(info).catch(() => {});
  })
  .catch(() => {});

export const robot = {
  director,
  animator,
  get engine() {
    return engine;
  },
  get unavailable() {
    return unavailable;
  },

  // A place that shows the robot. options: see RobotEngine.attach
  host(name, el, options = {}) {
    hosts.set(name, { el, options, visible: false });
    engine?.attach(name, el, options);
  },

  // Shown or not; the first host shown loads the engine
  show(name, visible = true) {
    const h = hosts.get(name);
    if (!h) return;
    h.visible = visible;
    if (visible && !engine && !unavailable) loadEngine().catch(() => {});
    engine?.setVisible(name, visible);
    syncFace();
  },

  get faceStatus() {
    return faceStatus;
  },

  options(name, options) {
    const h = hosts.get(name);
    if (!h) return;
    Object.assign(h.options, options);
    engine?.setHostOptions(name, options);
  },

  // Filming mode: the camera-friendly look, and bigger features if wanted
  setFilming(on, { cameraFriendly = true, largerFace = false } = {}) {
    Object.assign(filming, { on, cameraFriendly, largerFace });
    if (engine) engine.qualityLocked = on;
    applySettings(getSettings());
  },

  useModel,
  get modelInfo() {
    return modelInfo;
  },
};

// For checking the robot by hand or in a test browser: open the app with ?robot-debug
if (new URLSearchParams(location.search).has("robot-debug")) window.friendsRobot = robot;
