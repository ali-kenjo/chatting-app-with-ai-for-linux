// ---------- What the robot's moods, states and gestures look like ----------
// Pure data and small curves (no DOM, no three.js). A pose is a flat object of
// numbers ("channels"); the animator eases toward it with springs, then the
// 3D model and the face screen turn it into shapes.
//
// Directions: +x is the viewer's right, +y is up, +z is toward the camera.
// The robot faces the camera, so its right arm (Arm_R) is on the viewer's left.
import { bump, hold, smoothstep } from "./spring.mjs";

export const MOODS = [
  "neutral", "happy", "excited", "laughing", "curious", "thinking", "focused",
  "surprised", "confused", "skeptical", "sad", "affectionate", "proud", "sleepy",
];

export const GESTURES = [
  "nod", "head_shake", "tilt", "wave", "shrug", "bounce", "celebrate", "look_around",
  "lean_in", "point_left", "point_right", "double_take", "shy",
];

// Every channel: [neutral value, spring stiffness]. Face channels are in the
// face screen's own units (see face.js), angles in radians, distances in
// meters (the robot is about 1.2 m tall in its own world).
export const CHANNELS = {
  // Eyes
  eyeW: [1, 14], // size (1 = the eye style's size)
  eyeH: [1, 14],
  eyeRound: [0, 10], // 0 = the style's shape, 1 = fully round
  eyeScaleL: [1, 12], // one eye bigger than the other
  eyeScaleR: [1, 12],
  eyeY: [0, 10], // both eyes up (+) or down (-)
  lookX: [0, 30], // where the eyes look, -1..1
  lookY: [0, 30],
  lidTopL: [0.06, 16], // upper lids, 0 open .. 1 closed
  lidTopR: [0.06, 16],
  lidAngleL: [0, 12], // + inner corner lower (focused), - inner corner higher (sad)
  lidAngleR: [0, 12],
  lidBotL: [0.04, 14], // lower lids rising
  lidBotR: [0.04, 14],
  smile: [0, 12], // eyes turning into smiling crescents
  blush: [0, 6],
  glow: [1, 8], // screen brightness
  // Mouth
  mouthOpen: [0, 26],
  mouthWide: [0.5, 16],
  mouthRound: [0, 16],
  mouthCurve: [0.22, 10], // -1 frown .. 1 smile
  mouthSkew: [0, 10], // lopsided, -1..1
  // Body
  hoverY: [0, 8],
  hoverZ: [0, 6],
  posX: [0, 2.2], // travels through the room: sideways (+ the viewer's right)...
  posZ: [0, 2], // ...and toward (+) or away from the camera; slow, so it glides
  bodyPitch: [0, 7], // + leans toward the camera
  bodyRoll: [0, 7],
  bodyYaw: [0, 5],
  squash: [0, 14], // + stretches tall, - squashes
  headPitch: [0, 10], // + looks down (a nod)
  headYaw: [0, 8], // + turns to the viewer's right
  headRoll: [0, 8], // a head tilt
  armLRaise: [0.3, 9], // sideways and up, away from the body
  armLFwd: [0, 9], // forward and up
  armLIn: [0, 9], // swings in toward the middle (out when negative)
  armRRaise: [0.3, 9],
  armRFwd: [0, 9],
  armRIn: [0, 9],
  finL: [0, 12], // fins perk up (+) or droop (-)
  finR: [0, 12],
  finGlowL: [0.35, 18],
  finGlowR: [0.35, 18],
  finUser: [0, 8], // 1 = the fins glow in "your" color (you're talking)
  ringGlow: [0.6, 6],
  chase: [0, 6], // a light running through the fins (thinking, busy)
  emphasis: [0, 3], // camera push-in
};

export const NEUTRAL = Object.fromEntries(Object.entries(CHANNELS).map(([k, [v]]) => [k, v]));

const both = (l, r = l) => ({ l, r });
const eyes = ({ top, bot, angle } = {}) => {
  const out = {};
  if (top) Object.assign(out, { lidTopL: top.l, lidTopR: top.r });
  if (bot) Object.assign(out, { lidBotL: bot.l, lidBotR: bot.r });
  if (angle) Object.assign(out, { lidAngleL: angle.l, lidAngleR: angle.r });
  return out;
};

// Each mood as the channels it changes; everything else stays neutral
export const MOOD_POSES = {
  neutral: {},
  happy: {
    smile: 0.55, ...eyes({ bot: both(0.2) }), mouthCurve: 0.85, mouthWide: 0.66, mouthOpen: 0.12,
    finL: 0.25, finR: 0.25, blush: 0.15, glow: 1.05, hoverY: 0.01, headRoll: 0.05,
  },
  excited: {
    eyeW: 1.12, eyeH: 1.16, ...eyes({ top: both(0), bot: both(0) }), mouthOpen: 0.36, mouthRound: 0.2,
    mouthCurve: 0.95, mouthWide: 0.7, finL: 0.6, finR: 0.6, finGlowL: 0.75, finGlowR: 0.75,
    squash: 0.035, glow: 1.15, hoverY: 0.02, ringGlow: 0.9,
  },
  laughing: {
    smile: 1, eyeH: 0.78, mouthOpen: 0.58, mouthCurve: 1, mouthWide: 0.82, mouthRound: 0,
    headPitch: -0.08, finL: 0.4, finR: 0.4, blush: 0.25, glow: 1.1,
  },
  curious: {
    eyeScaleL: 1.12, eyeScaleR: 0.94, ...eyes({ top: both(0, 0.08), bot: both(0) }), headRoll: 0.17,
    headPitch: -0.03, mouthOpen: 0.08, mouthRound: 0.65, mouthWide: 0.34, mouthCurve: 0.1,
    finL: 0.45, finR: 0.1, hoverZ: 0.03, bodyPitch: 0.04,
  },
  thinking: {
    lookX: 0.45, lookY: 0.5, ...eyes({ top: both(0.22), bot: both(0.16) }), mouthSkew: 0.35,
    mouthWide: 0.34, mouthCurve: -0.02, headRoll: -0.07, headYaw: 0.1, headPitch: -0.07, chase: 1,
  },
  focused: {
    eyeH: 0.86, ...eyes({ top: both(0.3), bot: both(0.2), angle: both(0.12) }), mouthCurve: 0,
    mouthWide: 0.4, bodyPitch: 0.07, hoverZ: 0.03, headPitch: 0.04, finL: 0.15, finR: 0.15,
  },
  surprised: {
    eyeW: 1.2, eyeH: 1.3, eyeRound: 1, ...eyes({ top: both(0), bot: both(0) }), mouthOpen: 0.46,
    mouthRound: 1, mouthWide: 0.3, mouthCurve: 0, finL: 0.75, finR: 0.75, squash: 0.06,
    headPitch: -0.06, bodyPitch: -0.06, glow: 1.12,
  },
  confused: {
    eyeScaleL: 1.16, eyeScaleR: 0.84, ...eyes({ angle: both(-0.16, 0.2), top: both(0, 0.18) }),
    mouthCurve: -0.2, mouthSkew: -0.6, mouthWide: 0.4, headRoll: 0.22, finL: 0.35, finR: -0.25, glow: 0.92,
  },
  skeptical: {
    ...eyes({ top: both(0.46, 0.04), angle: both(0.12, 0), bot: both(0.12, 0.04) }), eyeScaleR: 1.05,
    mouthSkew: 0.8, mouthCurve: 0.3, mouthWide: 0.5, headRoll: -0.06, headYaw: 0.08, finL: -0.1, finR: 0.2,
  },
  sad: {
    ...eyes({ angle: both(-0.3), top: both(0.3) }), eyeH: 0.9, lookY: -0.25, mouthCurve: -0.75,
    mouthWide: 0.44, finL: -0.45, finR: -0.45, headPitch: 0.12, squash: -0.03, glow: 0.85,
    hoverY: -0.02, ringGlow: 0.4, finGlowL: 0.2, finGlowR: 0.2,
  },
  affectionate: {
    smile: 0.72, ...eyes({ top: both(0.18) }), blush: 0.8, mouthCurve: 0.72, mouthWide: 0.5,
    mouthOpen: 0.05, headRoll: 0.15, finL: 0.2, finR: 0.2, glow: 1.05,
  },
  proud: {
    ...eyes({ top: both(0.26) }), smile: 0.35, mouthCurve: 0.78, mouthWide: 0.6, headPitch: -0.1,
    bodyPitch: -0.05, finL: 0.5, finR: 0.5, squash: 0.03, glow: 1.08,
  },
  sleepy: {
    ...eyes({ top: both(0.62), bot: both(0.2) }), eyeH: 0.86, lookY: -0.15, mouthCurve: 0.05,
    mouthWide: 0.36, headPitch: 0.1, headRoll: 0.08, finL: -0.35, finR: -0.35, glow: 0.72,
    hoverY: -0.015, ringGlow: 0.35, finGlowL: 0.18, finGlowR: 0.18,
  },
};

// States (voice mode and text chat). `mood` shows through at `moodWeight`
// (a thinking face is mostly about thinking); `gaze`: where it looks.
export const STATES = {
  idle: { pose: {}, moodWeight: 1, gaze: "audience" },
  connecting: { pose: {}, moodWeight: 0, gaze: "audience" },
  listening: { pose: { finL: 0.2, finR: 0.2, ...eyes({ top: both(0.02) }), hoverZ: 0.02 }, moodWeight: 1, gaze: "user" },
  hearing: {
    pose: { finL: 0.3, finR: 0.3, ...eyes({ top: both(0) }), bodyPitch: 0.06, hoverZ: 0.05, eyeW: 1.04, eyeH: 1.06 },
    moodWeight: 0.8,
    gaze: "user",
  },
  thinking: { pose: MOOD_POSES.thinking, moodWeight: 0.25, gaze: "up" },
  speaking: { pose: {}, moodWeight: 1, gaze: "audience" },
  standby: { pose: MOOD_POSES.sleepy, moodWeight: 0.15, gaze: "down" },
  error: {
    pose: { ...MOOD_POSES.confused, glow: 0.6, ringGlow: 0.3, finGlowL: 0.15, finGlowR: 0.15 },
    moodWeight: 0.1,
    gaze: "audience",
  },
  // Text chat
  typing: {
    pose: { lookX: -0.2, lookY: -0.6, headPitch: 0.14, headYaw: -0.1, eyeW: 1.05, finL: 0.25, finR: 0.3, ...MOOD_POSES.curious },
    moodWeight: 0.4,
    gaze: "composer",
  },
  waiting: { pose: MOOD_POSES.thinking, moodWeight: 0.25, gaze: "up" },
  streaming: { pose: {}, moodWeight: 1, gaze: "audience" },
  busy: {
    pose: { ...eyes({ top: both(0.28), bot: both(0.16), angle: both(0.1) }), mouthWide: 0.35, chase: 1, lookX: 0.3, lookY: -0.1 },
    moodWeight: 0.3,
    gaze: "audience",
  },
};

// ---------- Gestures ----------
// offsets(t, o, rm): t runs 0..1 over the gesture; add the change to `o`;
// rm is true with reduced motion (big body moves shrink, faces stay).
// Every curve starts and ends at 0, so gestures blend in and out smoothly.
const add = (o, k, v) => (o[k] = (o[k] || 0) + v);

export const GESTURE_DEFS = {
  nod: {
    duration: 0.8,
    offsets(t, o) {
      add(o, "headPitch", 0.24 * bump(t, 0, 0.45) + 0.13 * bump(t, 0.4, 0.85));
      add(o, "bodyPitch", 0.03 * bump(t, 0, 0.6));
      add(o, "eyeH", -0.08 * bump(t, 0, 0.45));
      add(o, "smile", 0.15 * hold(t, 0, 1, 0.2));
    },
  },
  head_shake: {
    duration: 1,
    offsets(t, o) {
      const env = hold(t, 0, 1, 0.18);
      add(o, "headYaw", 0.26 * Math.sin(t * Math.PI * 5) * env);
      add(o, "lookX", -0.25 * Math.sin(t * Math.PI * 5 - 0.6) * env);
      add(o, "bodyYaw", 0.05 * Math.sin(t * Math.PI * 5) * env);
    },
  },
  tilt: {
    duration: 1.3,
    offsets(t, o) {
      const k = hold(t, 0.02, 0.9, 0.25);
      add(o, "headRoll", 0.32 * k);
      add(o, "eyeScaleL", 0.08 * k);
      add(o, "lookY", 0.1 * k);
      add(o, "finL", 0.25 * k);
      add(o, "finR", -0.1 * k);
    },
  },
  wave: {
    duration: 1.8,
    offsets(t, o, rm) {
      const up = hold(t, 0, 0.95, 0.2);
      add(o, "armRRaise", 2.2 * up + 0.38 * Math.sin((t - 0.15) * Math.PI * 5.2) * hold(t, 0.18, 0.82, 0.12));
      add(o, "armRFwd", 0.35 * up);
      add(o, "headRoll", 0.1 * up);
      add(o, "bodyRoll", (rm ? 0.02 : 0.05) * up);
      add(o, "smile", 0.5 * up);
      add(o, "mouthCurve", 0.35 * up);
      add(o, "finL", 0.2 * up);
      add(o, "finR", 0.3 * up);
      add(o, "hoverY", (rm ? 0.004 : 0.012) * bump(t, 0, 0.4));
    },
  },
  shrug: {
    duration: 1.2,
    offsets(t, o) {
      const s = hold(t, 0.05, 0.85, 0.22);
      for (const side of ["L", "R"]) {
        add(o, `arm${side}Raise`, 0.55 * s);
        add(o, `arm${side}Fwd`, 0.35 * s);
        add(o, `arm${side}In`, -0.5 * s);
      }
      add(o, "hoverY", 0.01 * s);
      add(o, "headPitch", -0.04 * s);
      add(o, "headRoll", 0.12 * s);
      add(o, "lidAngleL", -0.18 * s);
      add(o, "lidAngleR", -0.18 * s);
      add(o, "mouthCurve", -0.35 * s);
      add(o, "mouthSkew", 0.5 * s);
      add(o, "lookY", 0.15 * s);
    },
  },
  bounce: {
    duration: 0.9,
    offsets(t, o, rm) {
      add(o, "hoverY", (rm ? 0.035 : 0.1) * bump(t, 0.12, 0.72));
      add(o, "squash", -0.07 * bump(t, 0, 0.16) + 0.06 * bump(t, 0.14, 0.45) - 0.06 * bump(t, 0.66, 0.86));
      add(o, "armLRaise", 0.5 * bump(t, 0.1, 0.7));
      add(o, "armRRaise", 0.5 * bump(t, 0.1, 0.7));
      add(o, "finL", 0.35 * bump(t, 0.1, 0.75));
      add(o, "finR", 0.35 * bump(t, 0.1, 0.75));
      add(o, "smile", 0.35 * hold(t, 0, 1, 0.2));
    },
  },
  celebrate: {
    duration: 2.2,
    offsets(t, o, rm) {
      const k = hold(t, 0.05, 0.95, 0.18);
      // The spin itself is `spin` below; it can't go through a spring
      add(o, "hoverY", (rm ? 0.03 : 0.09) * bump(t, 0.05, 0.9));
      add(o, "armLRaise", 2.4 * k);
      add(o, "armRRaise", 2.4 * k);
      add(o, "armLIn", 0.25 * Math.sin(t * Math.PI * 6) * k);
      add(o, "armRIn", -0.25 * Math.sin(t * Math.PI * 6) * k);
      add(o, "finL", 0.6 * k);
      add(o, "finR", 0.6 * k);
      add(o, "finGlowL", 0.6 * k);
      add(o, "finGlowR", 0.6 * k);
      add(o, "smile", 0.8 * k);
      add(o, "mouthOpen", 0.35 * k);
      add(o, "mouthCurve", 0.6 * k);
      add(o, "glow", 0.2 * k);
    },
    // A whole turn, eased; 2π looks the same as 0, so it ends without a jump
    spin: (t, rm) => (rm ? 0 : Math.PI * 2 * smoothstep(0.12, 0.78, t)),
  },
  look_around: {
    duration: 2.6,
    offsets(t, o, rm) {
      const left = hold(t, 0.05, 0.45, 0.12);
      const right = hold(t, 0.4, 0.85, 0.12);
      add(o, "headYaw", (rm ? 0.3 : 0.5) * (right - left));
      add(o, "lookX", 0.6 * (hold(t, 0.38, 0.82, 0.08) - hold(t, 0.02, 0.42, 0.08)));
      add(o, "bodyYaw", (rm ? 0.03 : 0.12) * (right - left));
      add(o, "finL", 0.2 * hold(t, 0, 1, 0.2));
      add(o, "finR", 0.2 * hold(t, 0, 1, 0.2));
      add(o, "eyeW", 0.05 * hold(t, 0, 1, 0.2));
    },
  },
  lean_in: {
    duration: 1.6,
    offsets(t, o, rm) {
      const l = hold(t, 0.02, 0.88, 0.25);
      add(o, "bodyPitch", (rm ? 0.08 : 0.2) * l);
      add(o, "hoverZ", (rm ? 0.03 : 0.1) * l);
      add(o, "headPitch", -0.12 * l);
      add(o, "eyeW", 0.08 * l);
      add(o, "eyeH", 0.1 * l);
      add(o, "lidTopL", -0.05 * l);
      add(o, "lidTopR", -0.05 * l);
      add(o, "finL", 0.3 * l);
      add(o, "finR", 0.3 * l);
    },
  },
  // Pointing is for the video: point_left points at the left side of the picture
  point_left: {
    duration: 1.8,
    offsets(t, o, rm) {
      const p = hold(t, 0.02, 0.9, 0.2);
      add(o, "armRRaise", 1.35 * p);
      add(o, "armRFwd", 0.45 * p);
      add(o, "headYaw", -0.35 * p);
      add(o, "lookX", -0.7 * p);
      add(o, "bodyYaw", (rm ? -0.04 : -0.12) * p);
      add(o, "mouthCurve", 0.25 * p);
      add(o, "finR", 0.2 * p);
    },
  },
  point_right: {
    duration: 1.8,
    offsets(t, o, rm) {
      const p = hold(t, 0.02, 0.9, 0.2);
      add(o, "armLRaise", 1.35 * p);
      add(o, "armLFwd", 0.45 * p);
      add(o, "headYaw", 0.35 * p);
      add(o, "lookX", 0.7 * p);
      add(o, "bodyYaw", (rm ? 0.04 : 0.12) * p);
      add(o, "mouthCurve", 0.25 * p);
      add(o, "finL", 0.2 * p);
    },
  },
  double_take: {
    duration: 1.5,
    offsets(t, o, rm) {
      add(o, "headYaw", 0.3 * bump(t, 0, 0.3));
      add(o, "lookX", 0.4 * bump(t, 0, 0.28));
      const snap = hold(t, 0.42, 0.95, 0.06);
      add(o, "eyeW", 0.25 * snap);
      add(o, "eyeH", 0.35 * snap);
      add(o, "lidTopL", -0.06 * snap);
      add(o, "lidTopR", -0.06 * snap);
      add(o, "finL", 0.6 * snap);
      add(o, "finR", 0.6 * snap);
      add(o, "bodyPitch", (rm ? -0.03 : -0.08) * snap);
      add(o, "hoverY", (rm ? 0.01 : 0.03) * bump(t, 0.42, 0.7));
      add(o, "squash", 0.05 * bump(t, 0.42, 0.6));
      add(o, "mouthOpen", 0.3 * snap);
      add(o, "mouthRound", 0.8 * snap);
    },
  },
  // Its arms are too short to reach its eyes, so it hides them its own way:
  // paddles up in front of its chin, eyes squeezed shut, head turned away,
  // blushing, with one quick peek halfway through
  shy: {
    duration: 2.4,
    offsets(t, o) {
      const c = hold(t, 0.05, 0.9, 0.22);
      const peek = bump(t, 0.42, 0.7);
      add(o, "armLFwd", 2.2 * c);
      add(o, "armRFwd", 2.2 * c);
      add(o, "armLIn", 0.75 * c);
      add(o, "armRIn", 0.75 * c);
      add(o, "headPitch", 0.3 * c);
      add(o, "headYaw", 0.3 * c - 0.15 * peek);
      add(o, "headRoll", 0.12 * c);
      add(o, "smile", c - 0.7 * peek);
      add(o, "eyeH", -0.3 * c);
      add(o, "lidBotL", 0.25 * c);
      add(o, "lidBotR", 0.25 * c);
      add(o, "lookX", -0.5 * peek);
      add(o, "blush", c);
      add(o, "finL", -0.25 * c);
      add(o, "finR", -0.25 * c);
      add(o, "bodyRoll", 0.04 * Math.sin(t * Math.PI * 3) * c);
      add(o, "hoverY", -0.01 * c);
    },
  },

  // Played by the app itself, not offered to the AI
  boot: {
    duration: 1.8,
    offsets(t, o) {
      const off = 1 - smoothstep(0.1, 0.55, t);
      add(o, "glow", -1 * off);
      add(o, "ringGlow", -0.6 * (1 - smoothstep(0, 0.4, t)));
      const closed = 1 - smoothstep(0.35, 0.62, t);
      add(o, "lidTopL", 0.94 * closed);
      add(o, "lidTopR", 0.94 * closed);
      add(o, "squash", -0.05 * bump(t, 0.45, 0.62) + 0.09 * bump(t, 0.58, 0.88));
      add(o, "armLRaise", 0.7 * bump(t, 0.55, 0.95));
      add(o, "armRRaise", 0.7 * bump(t, 0.55, 0.95));
      add(o, "finL", -0.5 * (1 - smoothstep(0.2, 0.7, t)) + 0.3 * bump(t, 0.6, 0.95));
      add(o, "finR", -0.5 * (1 - smoothstep(0.2, 0.7, t)) + 0.3 * bump(t, 0.6, 0.95));
      add(o, "hoverY", -0.03 * (1 - smoothstep(0.1, 0.6, t)));
    },
  },
  yawn: {
    duration: 2.4,
    offsets(t, o) {
      const y = hold(t, 0.1, 0.75, 0.2);
      add(o, "mouthOpen", 0.75 * y);
      add(o, "mouthRound", 0.7 * y);
      add(o, "lidTopL", 0.4 * y);
      add(o, "lidTopR", 0.4 * y);
      add(o, "headPitch", -0.12 * hold(t, 0.1, 0.7, 0.2));
      add(o, "armLRaise", 0.4 * bump(t, 0.15, 0.7));
      add(o, "armRRaise", 0.4 * bump(t, 0.15, 0.7));
      add(o, "squash", 0.04 * bump(t, 0.15, 0.7));
    },
  },
  mmhm: {
    duration: 0.55,
    offsets(t, o) {
      add(o, "headPitch", 0.12 * bump(t, 0, 1));
      add(o, "smile", 0.1 * bump(t, 0, 1));
    },
  },
};

export const gestureDuration = (name) => GESTURE_DEFS[name]?.duration || 0;

// How much a gesture matters when several want to play
export const PRIORITY = { boot: 5, tool: 3, reaction: 2, caption: 1, idle: 0 };

// ---------- Looks you can choose (Settings → Robot) ----------
// Eye styles, in face units: half-width, half-height, corner roundness,
// distance from the middle, height. The face is 2 units wide.
export const EYE_STYLES = {
  classic: { w: 0.13, h: 0.22, round: 1, gap: 0.37, y: 0.07 }, // tall capsules
  round: { w: 0.18, h: 0.18, round: 1, gap: 0.39, y: 0.06 }, // big round eyes
  wide: { w: 0.22, h: 0.13, round: 0.5, gap: 0.39, y: 0.07 }, // wide, soft ovals
  big: { w: 0.21, h: 0.24, round: 1, gap: 0.42, y: 0.04 }, // large, close to a cartoon's
  dots: { w: 0.085, h: 0.085, round: 1, gap: 0.3, y: 0.05 }, // small and beady
  tall: { w: 0.1, h: 0.27, round: 1, gap: 0.34, y: 0.06 }, // thin and tall
  square: { w: 0.14, h: 0.16, round: 0.22, gap: 0.38, y: 0.06 }, // pixels
  visor: { w: 0.27, h: 0.075, round: 0.6, gap: 0.285, y: 0.06 }, // two bars that almost meet
};

// Mouth styles: how wide, and how heavy the line is, compared with the default
export const MOUTH_STYLES = {
  line: { width: 1, weight: 1, show: 1 },
  small: { width: 0.6, weight: 1, show: 1 },
  wide: { width: 1.35, weight: 1, show: 1 },
  bold: { width: 1, weight: 1.9, show: 1 },
  none: { width: 1, weight: 1, show: 0 },
};

// Shell colors: all a little off pure white, which glares on camera
export const SHELLS = {
  warm: "#ede4d6",
  cloud: "#e2e7ee",
  graphite: "#50555f",
  peach: "#f0ccb6",
  mint: "#c9e5d6",
};

// The second glow color, shown while you talk. The robot glows in your accent
// color, so yours is whichever of these differs most from it in hue.
const USER_GLOWS = ["#ffb074", "#5eead4", "#f472b6", "#a3e635"];

function hue(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function userGlowFor(accent) {
  if (!/^#[0-9a-f]{6}$/i.test(accent || "")) return USER_GLOWS[0];
  const a = hue(accent);
  const distance = (c) => {
    const d = Math.abs(hue(c) - a) % 360;
    return Math.min(d, 360 - d);
  };
  return USER_GLOWS.reduce((best, c) => (distance(c) > distance(best) ? c : best));
}
