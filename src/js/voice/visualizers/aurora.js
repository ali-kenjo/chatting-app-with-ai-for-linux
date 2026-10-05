// Visualizer: Aurora Ribbons. Each ribbon follows one part of the AI's voice (see levels.js).

// Aurora ribbons, in warm colors. Each ribbon follows one part
// of the AI's voice: its pitch (gold), the two main vowel ranges (coral,
// rose) and the "s" sounds (orchid).
const auroraLayers = [
  { rgb: "255, 190, 110", band: 0, freq: 3.2, speed: 1.0, phase: 0.0 },
  { rgb: "255, 122, 110", band: 1, freq: 4.1, speed: -1.3, phase: 1.3 },
  { rgb: "255, 102, 168", band: 2, freq: 5.0, speed: 1.6, phase: 2.6 },
  { rgb: "190, 134, 255", band: 3, freq: 3.7, speed: -0.9, phase: 4.0 },
];
let auroraLast = 0;
let auroraFlow = 0; // how far the ribbons have moved; faster while it talks
let auroraEnergy = 0; // the voice's loudness last frame
let auroraPulse = 0; // a short bloom when a sound starts

export const voiceBands = true; // wants the finer voice bands (levels.js readVoice)

export function draw(ctx, t, w, h, f) {
  const { voiceLevels } = f;
  const dt = Math.min(0.05, Math.max(0, t - auroraLast));
  auroraLast = t;

  const energy = voiceLevels.reduce((a, b) => a + b, 0) / voiceLevels.length;
  if (energy > auroraEnergy + 0.06) auroraPulse = Math.min(1, auroraPulse + (energy - auroraEnergy) * 1.6);
  auroraPulse *= 0.93;
  auroraEnergy = energy;

  const thinking = f.state === "thinking";
  const muted = f.muted;
  // Calm drift when quiet, livelier while someone talks
  auroraFlow += dt * (0.55 + energy * 1.3 + (thinking ? 0.6 : 0));

  const cy = h / 2;
  // On screen it looks as before; a 1080p video frame gets proportionally
  // bigger waves and lines, and tall pictures (phones, 9:16) taller waves
  const scale = Math.max(1, Math.min(w, h) / 800);
  const maxAmp = Math.min(h * 0.28, w * (h > w ? 0.34 : 0.22), 220 * scale);

  // Warm glow behind the ribbons: breathing slowly, brighter with the voice
  const glow = ctx.createRadialGradient(w / 2, cy, 0, w / 2, cy, Math.max(w, h) * 0.6);
  glow.addColorStop(0, `rgba(255, 146, 110, ${0.15 + 0.04 * Math.sin(t * 1.1) + energy * 0.22 + auroraPulse * 0.12})`);
  glow.addColorStop(0.55, `rgba(200, 90, 160, ${0.06 + energy * 0.1})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const step = Math.max(4, w / 240);
  const spread = 2.4 - Math.min(1, energy) * 1.1; // the waves widen when it's loud

  auroraLayers.forEach((layer, i) => {
    // Breathe when quiet, ripple while thinking, follow the voice otherwise
    const breath = 0.17 + 0.07 * Math.sin(t * 1.1 + i * 1.4);
    const ripple = thinking ? 0.16 * (0.5 + 0.5 * Math.sin(t * 3.2 - i * 0.9)) : 0;
    const level = Math.min(1.15, Math.max(voiceLevels[layer.band], breath + ripple) + auroraPulse * 0.3);
    const amp = maxAmp * level;
    const phase = auroraFlow * layer.speed + layer.phase;

    ctx.beginPath();
    for (let x = -step; x <= w + step; x += step) {
      const u = (x / w) * 2 - 1;
      const env = Math.exp(-u * u * spread);
      const wave = Math.sin(u * layer.freq + phase) * 0.7 + Math.sin(u * layer.freq * 1.8 - phase * 0.6) * 0.3;
      const y = cy + wave * amp * env + (i - 1.5) * 22 * scale;
      if (x === -step) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // Fading out at the screen edges instead of being cut off
    const alpha = (0.65 + level * 0.35) * (muted ? 0.5 : 1);
    const color = ctx.createLinearGradient(0, 0, w, 0);
    color.addColorStop(0, `rgba(${layer.rgb}, 0)`);
    color.addColorStop(0.15, `rgba(${layer.rgb}, ${alpha})`);
    color.addColorStop(0.85, `rgba(${layer.rgb}, ${alpha})`);
    color.addColorStop(1, `rgba(${layer.rgb}, 0)`);
    ctx.strokeStyle = color;
    ctx.lineWidth = (3 + level * 4.5) * scale;
    ctx.shadowColor = `rgba(${layer.rgb}, 0.9)`;
    ctx.shadowBlur = (18 + level * 26 + auroraPulse * 14) * scale;
    ctx.stroke();
  });
  ctx.shadowBlur = 0;
}
