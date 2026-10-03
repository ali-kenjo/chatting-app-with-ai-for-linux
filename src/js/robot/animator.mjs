// ---------- The robot's animation, layer by layer ----------
// Each frame, from the bottom up:
//   1. idle life     hover bob, sway, breathing, blinks, glances, fin shimmer
//   2. state         listening, thinking, speaking... (presets.mjs STATES)
//   3. mood          happy, curious, sleepy... (MOOD_POSES), smoothed by MoodSmoother
//   4. gestures      one-shot moves from a queue (GESTURE_DEFS)
//   5. audio         the AI's voice: mouth, syllables, fins
//   6. attention     where it looks: you, the audience, the composer
// Layers make target values; springs ease every value toward its target, so
// nothing snaps. Pure module (no DOM, no three.js); give it a seeded random()
// and it is fully repeatable, which the tests rely on.
import { Springs, Mixer, MoodSmoother, GestureQueue, noise1, clamp, lerp } from "./spring.mjs";
import { CHANNELS, NEUTRAL, MOOD_POSES, MOODS, STATES, GESTURE_DEFS, gestureDuration, PRIORITY } from "./presets.mjs";
import { voiceShape, SyllableDetector } from "./bands.mjs";

const TAU = Math.PI * 2;
const SILENT = [0, 0, 0, 0];

// Where each gaze mode looks, -1..1 (+x the viewer's right, +y up)
const GAZE = { audience: [0, 0], up: [0.35, 0.55], down: [0, -0.5], composer: [-0.6, -0.45] };
// Where you sit, as you look at the screen
export const SEATS = { front: [0, -0.05], left: [-0.85, -0.05], right: [0.85, -0.05] };

export class Animator {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.springs = new Springs(CHANNELS);
    this.mixer = new Mixer(NEUTRAL);
    this.moods = new MoodSmoother();
    this.gestures = new GestureQueue(gestureDuration);
    this.syllables = new SyllableDetector();
    this.t = 0; // seconds of animation so far
    this.state = "idle";
    this.stateSince = 0;
    this.options = { reducedMotion: false, cameraFriendly: false, mouth: true, roam: 0 };
    this.wander = { x: 0, z: 0, next: 0, state: "", side: 1 }; // where it is heading in the room
    this.pointer = null; // { x, y, at } the mouse or finger, relative to the robot
    this.pokes = { count: 0, last: -100, hover: -100 };
    this.seat = "front";
    this.face = null; // { x, y } from "Follow my face", or null
    this.audio = { bands: [0, 0, 0, 0], at: -Infinity };
    this.user = { level: 0, at: -Infinity };
    this.talk = { since: -1, quietSince: -1, lastNod: -10 };
    this.userTalking = 0;
    this.blinkState = { next: 1.2 + random() * 2, start: -1, double: false, length: 0.15 };
    this.saccade = { next: 0.8, x: 0, y: 0 };
    this.nextIdleGesture = 10 + random() * 8;
    this.bobPhase = random() * TAU;
    this.breathPhase = random() * TAU;
    this.chasePhase = 0;
    this.emphasisAvg = 0;
    this.lastEmphasis = -10;
    this.lastActivity = 0;
    this.offsets = { ...NEUTRAL }; // reused every frame: additive changes (zeroed each frame)
    this.gestureOffsets = {};
    this.pose = { ...NEUTRAL, blink: 0, spin: 0, chasePhase: 0, mouthVisible: 1, speaking: 0, userTalking: 0, mood: "neutral", gesture: "", t: 0 };
  }

  // ---------- Inputs ----------
  get now() {
    return this.t * 1000;
  }

  setState(state) {
    if (!STATES[state] || state === this.state) return;
    this.state = state;
    this.stateSince = this.t;
    this.lastActivity = this.t;
    if (state === "connecting") this.gesture("boot", { priority: PRIORITY.boot });
  }

  setOptions(options) {
    Object.assign(this.options, options);
  }

  setSeat(seat) {
    if (SEATS[seat]) this.seat = seat;
  }

  // x, y in -1..1 (the viewer's right and up), or null when no face is seen
  setFace(face) {
    this.face = face ? { x: clamp(face.x, -1, 1), y: clamp(face.y, -1, 1) } : null;
  }

  // The mouse or a finger, relative to the robot (-1..1, +x the viewer's right,
  // +y up), or null when it has left. Its eyes and head follow it for a while.
  setPointer(pointer) {
    this.pointer = pointer ? { x: clamp(pointer.x, -1, 1), y: clamp(pointer.y, -1, 1), at: this.t } : null;
  }

  // Someone touches the robot. kind: "hover" | "tap" | "hold"; x: where on it
  // (-1 left .. 1 right), so a poke on one side pushes it the other way.
  // Taps escalate: a start, a laugh, then a victory spin.
  poke(kind = "tap", { x = 0 } = {}) {
    const k = this.pokes;
    if (kind === "hover") {
      if (this.t - k.hover < 6 || this.gestures.busy || this.state === "thinking") return false;
      k.hover = this.t;
      this.setMood("curious", { source: "tool", strength: 0.6 });
      this.springs.impulse("finL", 2);
      this.springs.impulse("finR", 2);
      return true;
    }
    this.lastActivity = this.t;
    this.moods.clear(); // a poke is answered at once, whatever mood it was in
    if (kind === "hold") {
      this.setMood("affectionate", { source: "tool", strength: 0.9 });
      this.gestures.push("lean_in", { priority: PRIORITY.tool, now: this.now });
      return true;
    }
    k.count = this.t - k.last < 5 ? k.count + 1 : 1;
    k.last = this.t;
    const rm = this.options.reducedMotion;
    const push = this.options.roam > 0 && !rm ? 1 : 0.25;
    this.springs.impulse("posX", -clamp(x, -1, 1) * 1.1 * push);
    this.springs.impulse("posZ", -0.8 * push);
    this.springs.impulse("squash", 0.7);
    this.springs.impulse("eyeH", -2);
    this.springs.impulse("finL", 3);
    this.springs.impulse("finR", 3);
    const steps = [
      ["surprised", "double_take"],
      ["happy", "bounce"],
      ["laughing", "bounce"],
    ];
    const [mood, gesture] = steps[Math.min(k.count, 4) - 1] || ["excited", "celebrate"];
    this.setMood(mood, { source: "tool", strength: 0.9 });
    this.gestures.push(gesture, { priority: PRIORITY.tool, now: this.now });
    return true;
  }

  // The AI's voice this frame: four band levels 0..1 (see bands.mjs)
  setAudio(bands) {
    this.audio.bands = bands;
    this.audio.at = this.t;
  }

  // Your voice this frame, 0..1. Only call it when it can't be the AI's echo.
  setUser(level) {
    this.user.level = level;
    this.user.at = this.t;
  }

  // source: "caption" | "smart" | "tool"
  setMood(mood, { source = "caption", strength = 0.6 } = {}) {
    if (!MOODS.includes(mood)) return false;
    this.lastActivity = this.t;
    return this.moods.request(mood, { source, strength, now: this.now });
  }

  gesture(name, { priority = PRIORITY.caption } = {}) {
    if (!GESTURE_DEFS[name]) return false;
    this.lastActivity = this.t;
    return this.gestures.push(name, { priority, now: this.now });
  }

  // Drops waiting gestures; the one playing eases out (a spin finishes its turn)
  cancelGestures() {
    const current = this.gestures.current;
    if (current && GESTURE_DEFS[current.name]?.spin) this.gestures.queue = [];
    else this.gestures.clear(this.now);
  }

  // ---------- One frame ----------
  update(dt) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    this.t += dt;
    const now = this.now;
    const rm = this.options.reducedMotion;
    const state = STATES[this.state] || STATES.idle;
    const mood = this.moods.current(now);

    const o = this.offsets;
    for (const k in o) o[k] = 0;

    // 1-3: state and mood as targets, idle life on top
    const m = this.mixer.begin();
    m.blend(state.pose, 1);
    m.blend(MOOD_POSES[mood], state.moodWeight);
    this.idle(o, dt, mood);
    this.roam(o);
    this.maybeIdleGesture(mood);

    // 4: the gesture playing now
    const g = this.gestures.update(now);
    let spin = 0;
    if (g) {
      const go = this.gestureOffsets;
      for (const k in go) go[k] = 0;
      const def = GESTURE_DEFS[g.name];
      def.offsets(g.t, go, rm);
      m.add(go, g.weight);
      if (def.spin) spin = def.spin(g.t, rm);
    }

    // 6: attention; and reacting to you while you talk
    this.gaze(o, state.gaze);
    this.listen(o, dt);
    m.add(o, 1);

    // 5: the AI's voice shapes the mouth over whatever the mood wants
    const speaking = this.voice(m.out, dt);

    const v = this.springs.step(m.out, dt);
    const p = this.pose;
    for (const k in v) p[k] = v[k];
    // Travelling shows in the body: it banks into a sideways move, leans into
    // a forward one, and its glow brightens with speed
    const vx = this.springs.state.posX.v;
    const vz = this.springs.state.posZ.v;
    const rm2 = rm ? 0.3 : 1;
    p.bodyRoll -= clamp(vx * 0.9, -0.2, 0.2) * rm2;
    p.headRoll += clamp(vx * 0.5, -0.12, 0.12) * rm2;
    p.bodyYaw += clamp(vx * 0.55, -0.15, 0.15) * rm2;
    p.bodyPitch += clamp(vz * 0.6, -0.15, 0.15) * rm2;
    p.speed = Math.hypot(vx, vz);
    p.ringGlow += Math.min(0.5, p.speed * 1.2);
    p.blink = this.blink(dt, mood);
    p.spin = spin;
    this.chasePhase += dt * (this.options.cameraFriendly ? 2.4 : 3.6);
    p.chasePhase = this.chasePhase;
    p.mouthVisible = this.options.mouth ? 1 : 0;
    p.speaking = speaking;
    p.userTalking = this.userTalking;
    p.mood = mood;
    p.gesture = g ? g.name : "";
    p.t = this.t;
    return p;
  }

  // Hover, sway, breathing and shimmer; faster when excited, slower asleep
  idle(o, dt, mood) {
    const t = this.t;
    const body = this.options.reducedMotion ? 0.3 : 1;
    const sleepy = mood === "sleepy" || this.state === "standby";
    this.bobPhase += dt * TAU * (sleepy ? 0.2 : mood === "excited" ? 0.5 : 0.33);
    this.breathPhase += dt * TAU * (sleepy ? 0.15 : 0.25);
    o.hoverY += Math.sin(this.bobPhase) * 0.016 * body;
    o.ringGlow += Math.sin(this.bobPhase + 1.2) * 0.08; // the ring brightens as it dips
    o.bodyRoll += noise1(t * 0.35, 1) * 0.025 * body;
    o.bodyYaw += noise1(t * 0.22, 2) * 0.035 * body;
    o.headRoll += noise1(t * 0.3, 3) * 0.025 * body;
    o.headYaw += noise1(t * 0.27, 4) * 0.03 * body;
    o.headPitch += noise1(t * 0.25, 5) * 0.02 * body;
    o.squash += Math.sin(this.breathPhase) * (sleepy ? 0.014 : 0.008);
    const shimmer = this.options.cameraFriendly ? 0.03 : 0.06;
    o.finGlowL += noise1(t * 1.3, 6) * shimmer;
    o.finGlowR += noise1(t * 1.3, 7) * shimmer;
    o.finL += noise1(t * 0.5, 8) * 0.05 * body;
    o.finR += noise1(t * 0.5, 9) * 0.05 * body;

    if (mood === "laughing") {
      const k = 0.5 + 0.5 * Math.sin(t * TAU * 4.2);
      o.hoverY += 0.012 * k * body;
      o.headPitch -= 0.035 * k;
      o.squash += 0.012 * k;
      o.bodyRoll += 0.02 * Math.sin(t * TAU * 2.1) * body;
    } else if (mood === "excited") {
      o.hoverY += 0.006 * Math.sin(t * TAU * 1.6) * body;
    } else if (mood === "happy" || mood === "affectionate") {
      o.bodyRoll += 0.02 * Math.sin(t * TAU * 0.45) * body;
    }
  }

  // Where it goes in the room. It keeps to a small stage (about +-0.4 m
  // sideways, a little nearer or further), choosing a new spot every few
  // seconds, and the state decides where: closer and turned to you while you
  // talk, back and to the side while it thinks, drifting about while it talks.
  roam(o) {
    const amount = this.options.reducedMotion ? 0 : clamp(this.options.roam || 0, 0, 1);
    if (amount <= 0) return;
    const w = this.wander;
    const state = this.state;
    if (this.t >= w.next || w.state !== state) {
      w.state = state;
      w.side = -w.side;
      const r = this.random;
      const near = state === "listening" || state === "hearing";
      if (state === "connecting") {
        w.x = 0;
        w.z = -0.3;
        w.next = this.t + 2;
      } else if (near) {
        w.x = SEATS[this.seat][0] * 0.14 + (r() - 0.5) * 0.12;
        w.z = state === "hearing" ? 0.3 : 0.2;
        w.next = this.t + 3 + r() * 3;
      } else if (state === "thinking" || state === "waiting" || state === "busy") {
        w.x = w.side * (0.2 + r() * 0.2);
        w.z = -0.22;
        w.next = this.t + 2.2 + r() * 1.6;
      } else if (state === "speaking" || state === "streaming") {
        w.x = w.side * (0.12 + r() * 0.3);
        w.z = -0.04 + r() * 0.24;
        w.next = this.t + 3.5 + r() * 3;
      } else if (state === "standby") {
        w.x = 0;
        w.z = -0.18;
        w.next = this.t + 8;
      } else {
        w.x = w.side * (0.1 + r() * 0.3);
        w.z = -0.12 + r() * 0.22;
        w.next = this.t + 6 + r() * 4;
      }
    }
    // When you move in front of the camera, it keeps its eyes (and a little of itself) on you
    const follow = this.face && (state === "listening" || state === "hearing") ? this.face.x * 0.12 : 0;
    o.posX += (w.x + follow) * amount;
    o.posZ += w.z * amount + 0.05 * clamp(this.springs.value.emphasis || 0, 0, 2) * amount;
  }

  // Now and then, when nothing else is going on: a yawn, a tilt, a look around
  maybeIdleGesture(mood) {
    if (this.t < this.nextIdleGesture) return;
    this.nextIdleGesture = this.t + 8 + this.random() * 8;
    if (this.gestures.busy || this.t - this.audio.at < 2 || this.userTalking > 0) return;
    const quiet = this.t - this.lastActivity;
    let name = null;
    if (mood === "sleepy" || this.state === "standby") name = "yawn";
    else if (mood === "curious") name = "tilt";
    else if (mood === "excited") name = "bounce";
    else if ((this.state === "listening" || this.state === "idle") && quiet > 20) name = this.random() < 0.5 ? "look_around" : "tilt";
    if (name) this.gestures.push(name, { priority: PRIORITY.idle, now: this.now });
  }

  // Looks where the state says, with small quick glances around that point
  gaze(o, mode) {
    let [x, y] = GAZE[mode] || GAZE.audience;
    if (mode === "user") [x, y] = this.face ? [this.face.x, this.face.y] : SEATS[this.seat];
    // Your mouse (or finger) wins for a few seconds after it moves, unless the webcam sees you
    const ptr = this.pointer;
    if (ptr && !this.face && this.t - ptr.at < 5 && (mode === "audience" || mode === "user")) [x, y] = [ptr.x, ptr.y];
    // Talking to the audience: straight out, but the eyes still find your face
    let eyesOnly = null;
    if (mode === "audience" && this.face) eyesOnly = [this.face.x * 0.5, this.face.y * 0.5];

    const body = this.options.reducedMotion ? 0.5 : 1;
    o.headYaw += x * 0.42 * body;
    o.headPitch += -y * 0.22 * body;
    o.bodyYaw += x * 0.15 * body;

    const s = this.saccade;
    if (this.t >= s.next) {
      const scanning = this.state === "thinking" || this.state === "waiting" || this.state === "busy";
      if (scanning) {
        s.x = (this.random() - 0.5) * 0.9;
        s.y = this.random() * 0.25;
        s.next = this.t + 0.45 + this.random() * 0.6;
      } else {
        const r = this.state === "speaking" ? 0.08 : 0.14;
        s.x = (this.random() - 0.5) * 2 * r;
        s.y = (this.random() - 0.5) * r;
        s.next = this.t + 1.2 + this.random() * 2.8;
      }
    }
    const [ex, ey] = eyesOnly || [x, y];
    o.lookX += ex * 0.55 + s.x;
    o.lookY += ey * 0.5 + s.y;
  }

  // You're talking: it leans in, its eyes follow your voice, its fins take
  // your color, and when you pause it gives a small "mm-hm" nod
  listen(o, dt) {
    const level = this.t - this.user.at < 0.3 ? this.user.level : 0;
    const talking = level > 0.12;
    const tk = this.talk;
    if (talking) {
      if (tk.since < 0) tk.since = this.t;
      tk.quietSince = -1;
      this.lastActivity = this.t;
    } else if (tk.since >= 0) {
      if (tk.quietSince < 0) tk.quietSince = this.t;
      const talkedFor = tk.quietSince - tk.since;
      const quietFor = this.t - tk.quietSince;
      if (talkedFor > 0.8 && quietFor > 0.35 && this.t - tk.lastNod > 2.4) {
        this.gestures.push("mmhm", { priority: PRIORITY.idle, now: this.now });
        tk.lastNod = this.t;
        tk.since = -1;
      } else if (quietFor > 1.2) {
        tk.since = -1;
      }
    }
    this.userTalking = talking ? 1 : Math.max(0, this.userTalking - dt / 0.6);
    const k = this.userTalking;
    const body = this.options.reducedMotion ? 0.4 : 1;
    o.finUser += k;
    o.bodyPitch += 0.07 * k * body;
    o.hoverZ += 0.04 * k * body;
    o.eyeW += 0.05 * level;
    o.eyeH += 0.1 * level;
    o.finL += 0.2 * level;
    o.finR += 0.2 * level;
  }

  // The mouth follows the voice: open with loudness, shaped by the vowels;
  // each syllable squashes the eyes a touch and nods the head. Returns loudness.
  voice(target, dt) {
    const bands = this.t - this.audio.at < 0.3 ? this.audio.bands : SILENT;
    const shape = voiceShape(bands, (this.shape ||= {}));
    const e = shape.energy;
    const w = clamp(e * 4);
    if (w > 0) {
      // Speech opens the mouth wider than tall ("a", "e"); only clear "o" sounds round it
      target.mouthOpen = Math.max(target.mouthOpen * (1 - w * 0.6), shape.open * 0.8);
      target.mouthWide = lerp(target.mouthWide, 0.45 + 0.45 * shape.wide, w);
      target.mouthRound = lerp(target.mouthRound, shape.round, w * 0.6);
      target.finGlowL += 0.45 * bands[0] + 0.3 * bands[1];
      target.finGlowR += 0.45 * bands[2] + 0.35 * bands[3];
      target.glow += 0.06 * e;
      target.finUser *= 1 - w; // its own voice: its own color
      this.lastActivity = this.t;
    }
    if (this.syllables.update(e, dt)) {
      this.springs.impulse("eyeH", -(1.6 + 1.6 * e));
      this.springs.impulse("headPitch", (this.options.reducedMotion ? 0.15 : 0.45) + 0.5 * e);
      this.springs.impulse("squash", 0.3 + 0.3 * e);
    }
    // Clearly louder than lately: emphasis (the camera may push in)
    this.emphasisAvg += (e - this.emphasisAvg) * (1 - Math.exp(-dt / 2.5));
    if (e > 0.5 && e > this.emphasisAvg * 1.7 && this.t - this.lastEmphasis > 4) {
      this.springs.impulse("emphasis", 2.8);
      this.lastEmphasis = this.t;
    }
    return e;
  }

  // Random blinks, sometimes two in a row; slow ones when sleepy
  blink(dt, mood) {
    const b = this.blinkState;
    const sleepy = mood === "sleepy" || this.state === "standby";
    if (b.start < 0 && this.t >= b.next) {
      b.start = this.t;
      b.length = sleepy ? 0.38 : 0.15;
    }
    if (b.start < 0) return 0;
    const p = (this.t - b.start) / b.length;
    if (p >= 1) {
      b.start = -1;
      if (!b.double && this.random() < 0.14) {
        b.double = true;
        b.next = this.t + 0.09;
      } else {
        b.double = false;
        b.next = this.t + (sleepy ? 1.6 + this.random() * 2 : 2.2 + this.random() * 4.2);
      }
      return 0;
    }
    return clamp(p < 0.4 ? p / 0.4 : p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45);
  }
}
