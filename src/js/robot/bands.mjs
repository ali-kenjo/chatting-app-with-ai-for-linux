// ---------- The AI's voice, as numbers ----------
// Splits a voice into four bands (the same ones the Aurora visualizer uses):
// pitch, the two main vowel ranges, and the "s" sounds. From them come the
// mouth's shape and the moments a syllable starts. Pure module: no DOM.

export const VOICE_BANDS = [[90, 300], [300, 900], [900, 2400], [2400, 6000]]; // Hz

// bins: an analyser's getByteFrequencyData(); hzPerBin: sampleRate / fftSize.
// floor and levels (4 numbers each) are updated in place: floor follows the
// quietest level lately, so only what's above it counts; levels rise fast and
// fall slower, so they feel alive but stay smooth.
export function updateVoiceLevels(bins, hzPerBin, floor, levels) {
  for (let i = 0; i < VOICE_BANDS.length; i++) {
    const [lo, hi] = VOICE_BANDS[i];
    const from = Math.max(1, Math.floor(lo / hzPerBin));
    const to = Math.max(from + 1, Math.ceil(hi / hzPerBin));
    let sum = 0;
    for (let b = from; b < to; b++) sum += bins[b] || 0;
    const v = sum / (to - from) / 255;
    floor[i] = v < floor[i] ? v : floor[i] + (v - floor[i]) * 0.003;
    const target = Math.min(1, Math.max(0, (v - floor[i] - 0.03) / 0.3));
    levels[i] += (target - levels[i]) * (target > levels[i] ? 0.5 : 0.1);
  }
  return levels;
}

export function decayLevels(levels, k = 0.9) {
  for (let i = 0; i < levels.length; i++) levels[i] *= k;
  return levels;
}

// A believable mouth from the four bands (each 0..1):
// open  - how loud, most of all in the first vowel range ("a" opens wide)
// wide  - the second vowel range over the first ("e", "i" spread the lips)
// round - low and quiet above ("o", "u" round them)
// out: an object to fill (saves making a new one every frame)
export function voiceShape(levels, out = {}) {
  const [low, f1, f2, hiss] = levels;
  const energy = (low * 0.8 + f1 * 1.2 + f2 + hiss * 0.5) / 3.5;
  out.open = Math.min(1, energy * 1.5 + f1 * 0.25);
  out.wide = Math.min(1, Math.max(0, 0.45 + (f2 - f1) * 0.7 + hiss * 0.15));
  out.round = Math.min(1, Math.max(0, (low - f2) * 1.1 + (f1 - hiss) * 0.2));
  out.energy = Math.min(1, energy * 1.3);
  return out;
}

// Notices when a syllable starts: the voice gets clearly louder quickly.
// At most `maxRate` a second, so a fast talker doesn't make it jitter.
export class SyllableDetector {
  constructor({ rise = 0.12, min = 0.22, maxRate = 6 } = {}) {
    Object.assign(this, { rise, min, maxRate });
    this.slow = 0; // a slower-moving loudness to compare against
    this.last = -Infinity;
    this.t = 0;
  }

  // energy 0..1, dt in seconds. Returns true on a syllable's start.
  update(energy, dt) {
    this.t += dt;
    const k = 1 - Math.exp(-dt * 10);
    const onset = energy > this.min && energy - this.slow > this.rise && this.t - this.last > 1 / this.maxRate;
    this.slow += (energy - this.slow) * k;
    if (onset) this.last = this.t;
    return onset;
  }
}
