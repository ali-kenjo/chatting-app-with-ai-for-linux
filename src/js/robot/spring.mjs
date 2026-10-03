// ---------- Springs, the mixer, and choosing moods and gestures ----------
// Pure logic for the robot's animation (no DOM, no three.js), so node:test
// can check it. Everything the robot does eases through critically damped
// springs: they settle as quickly as possible without overshooting, so nothing
// snaps, and they move the same at 30 or 144 frames a second.

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A smooth bump: 0 before `a`, rising to 1 at the middle, back to 0 at `b`
export const bump = (x, a, b) => (x <= a || x >= b ? 0 : Math.sin(((x - a) / (b - a)) * Math.PI) ** 2);

// Rises over [a, a + fade], holds, falls over [b - fade, b]
export const hold = (x, a, b, fade = 0.15) => smoothstep(a, a + fade, x) * (1 - smoothstep(b - fade, b, x));

// Smooth random wobble in -1..1 (the same x always gives the same value)
const hash = (n) => {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
};
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 57.3), hash(i + 1 + seed * 57.3), u);
}

// One exact step of a critically damped spring. s: { x, v } is updated in
// place; omega (1/s) is the stiffness: it has nearly settled after 5 / omega s.
export function springStep(s, target, omega, dt) {
  const e = Math.exp(-omega * dt);
  const delta = s.x - target;
  const tmp = (s.v + omega * delta) * dt;
  s.x = target + (delta + tmp) * e;
  s.v = (s.v - omega * tmp) * e;
  return s.x;
}

// A named set of springs. defs: { name: [start value, omega] }
export class Springs {
  constructor(defs) {
    this.names = Object.keys(defs);
    this.state = {};
    this.omega = {};
    this.value = {}; // name → current value, read every frame
    for (const name of this.names) {
      const [x, omega] = defs[name];
      this.state[name] = { x, v: 0, target: x };
      this.omega[name] = omega;
      this.value[name] = x;
    }
  }

  // Moves every spring toward targets[name]; one without a new target keeps its last
  step(targets, dt) {
    for (const name of this.names) {
      const s = this.state[name];
      if (targets[name] !== undefined) s.target = targets[name];
      this.value[name] = springStep(s, s.target, this.omega[name], dt);
    }
    return this.value;
  }

  // A kick: adds velocity, so the value swings out and eases back by itself
  impulse(name, velocity) {
    if (this.state[name]) this.state[name].v += velocity;
  }

  // Jump straight to a value (e.g. when the robot first appears)
  set(name, x) {
    if (!this.state[name]) return;
    Object.assign(this.state[name], { x, v: 0, target: x });
    this.value[name] = x;
  }
}

// Builds each frame's targets from layers, bottom to top: start from the
// defaults; blend() pulls values toward a layer's by a weight (1 = take them),
// add() adds a layer's values as offsets. Keys not in the defaults are ignored.
export class Mixer {
  constructor(defaults) {
    this.defaults = defaults;
    this.keys = Object.keys(defaults);
    this.out = { ...defaults };
  }

  begin() {
    for (const k of this.keys) this.out[k] = this.defaults[k];
    return this;
  }

  blend(layer, weight = 1) {
    if (!layer || !(weight > 0)) return this;
    const w = Math.min(1, weight);
    for (const k in layer) if (k in this.out) this.out[k] += (layer[k] - this.out[k]) * w;
    return this;
  }

  add(layer, weight = 1) {
    if (!layer || !weight) return this;
    for (const k in layer) if (k in this.out) this.out[k] += layer[k] * weight;
    return this;
  }

  result() {
    return this.out;
  }
}

// ---------- Which mood shows ----------
// Moods come from several places. Higher ranks win: the AI choosing one with
// robot_mood, then the smarter (Gemini) reading, then what the words say
// (captions); the state's own mood is the fallback. A mood stays at least
// minHold ms, and going straight back to the one before needs a clearly
// stronger reason, so the face never flickers between two moods.
export const MOOD_RANK = { caption: 1, smart: 2, tool: 3 };

export class MoodSmoother {
  constructor({ minHold = 1600, life = 7000, toolLife = 9000, flipGuard = 4000 } = {}) {
    Object.assign(this, { minHold, life, toolLife, flipGuard });
    this.fallback = "neutral";
    this.active = null; // { mood, source, strength, since, until }
    this.previous = null;
    this.switchedAt = -Infinity;
  }

  setDefault(mood) {
    this.fallback = mood || "neutral";
  }

  current(now) {
    return this.active && now < this.active.until ? this.active.mood : this.fallback;
  }

  // source: "caption" | "smart" | "tool"; strength 0..1. Returns true when it shows.
  request(mood, { source = "caption", strength = 0.6, now = 0 } = {}) {
    const rank = MOOD_RANK[source] || 1;
    const life = source === "tool" ? this.toolLife : source === "smart" ? this.life * 1.3 : this.life;
    const cur = this.active && now < this.active.until ? this.active : null;

    if (cur && cur.mood === mood) {
      cur.until = Math.max(cur.until, now + life);
      cur.strength = Math.max(cur.strength, strength);
      if (rank > (MOOD_RANK[cur.source] || 1)) cur.source = source;
      return true;
    }
    if (!cur && mood === this.fallback) return true;

    const curRank = cur ? MOOD_RANK[cur.source] || 1 : 0;
    if (cur && rank < curRank) return false;
    if (cur && rank === curRank) {
      if (now - cur.since < this.minHold) return false;
      if (strength < cur.strength * 0.8 && now - cur.since < this.minHold * 2) return false;
    }
    // Straight back to the mood it just left: only for a clear reason
    const flipBack = mood === this.previous && now - this.switchedAt < this.flipGuard;
    if (flipBack && rank <= curRank && strength < 0.85) return false;

    this.previous = cur ? cur.mood : this.fallback;
    this.switchedAt = now;
    this.active = { mood, source, strength, since: now, until: now + life };
    return true;
  }

  // Lets the current mood end soon (e.g. a new turn starts); it doesn't snap away
  release(now, after = 600) {
    if (this.active && this.active.until > now + after) this.active.until = now + after;
  }

  clear() {
    this.active = null;
    this.previous = null;
    this.switchedAt = -Infinity;
  }
}

// ---------- Gestures, one at a time ----------
// A gesture always plays to its end; others wait in a short queue, higher
// priority first. Waiting too long makes one stale (a nod two seconds late
// looks wrong), and clear() lets the current one ease out instead of cutting it.
export class GestureQueue {
  // duration(name) → seconds, or 0 for an unknown gesture
  constructor(duration, { maxQueue = 3, maxWait = 2500, release = 0.3 } = {}) {
    this.duration = duration;
    Object.assign(this, { maxQueue, maxWait, release });
    this.current = null; // { name, start (ms), length (ms), priority }
    this.queue = []; // { name, priority, at }
  }

  get busy() {
    return Boolean(this.current);
  }

  push(name, { priority = 1, now = 0 } = {}) {
    const seconds = this.duration(name);
    if (!seconds) return false;
    if (this.current?.name === name || this.queue.some((g) => g.name === name)) return false;
    const item = { name, priority, at: now };
    if (this.queue.length >= this.maxQueue) {
      const lowest = this.queue.reduce((a, b) => (b.priority < a.priority ? b : a));
      if (lowest.priority >= priority) return false;
      this.queue.splice(this.queue.indexOf(lowest), 1);
    }
    const at = this.queue.findIndex((g) => g.priority < priority);
    if (at < 0) this.queue.push(item);
    else this.queue.splice(at, 0, item);
    return true;
  }

  // The gesture playing now: { name, t (0..1 of its length), elapsed (s), weight } or null
  update(now) {
    if (this.current && now >= this.current.start + this.current.length) this.current = null;
    if (!this.current) {
      this.queue = this.queue.filter((g) => now - g.at <= this.maxWait);
      const next = this.queue.shift();
      if (next) this.current = { name: next.name, priority: next.priority, start: now, length: this.duration(next.name) * 1000, full: this.duration(next.name) * 1000 };
    }
    if (!this.current) return null;
    const c = this.current;
    const elapsed = (now - c.start) / 1000;
    const length = c.length / 1000;
    // Eased in and out, so even a shortened gesture blends away smoothly
    const weight = smoothstep(0, 0.12, elapsed) * (1 - smoothstep(length - this.release, length, elapsed));
    // One object, refilled each frame
    const out = (this.playing ||= {});
    out.name = c.name;
    out.t = clamp((now - c.start) / c.full);
    out.elapsed = elapsed;
    out.weight = weight;
    return out;
  }

  // Everything waiting is dropped; the current gesture fades out over `release`
  clear(now) {
    this.queue = [];
    if (this.current) {
      const left = this.current.start + this.current.length - now;
      if (left > this.release * 1000) this.current.length = now - this.current.start + this.release * 1000;
    }
  }
}
