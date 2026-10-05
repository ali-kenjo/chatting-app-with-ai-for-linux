// Visualizer: Sunset Waves (a sun, embers and rolling hills that swell with the AI's voice)

const sunsetHills = [
  { rgb: "255, 224, 130", band: 3, freq: 5.2, speed: 0.6, phase: 0.0 },
  { rgb: "255, 183, 77", band: 2, freq: 4.4, speed: -0.8, phase: 1.7 },
  { rgb: "255, 138, 101", band: 1, freq: 3.8, speed: 1.0, phase: 3.1 },
  { rgb: "216, 67, 21", band: 0, freq: 3.2, speed: -0.7, phase: 4.4 },
];

// Visualizer embers
const embers = Array.from({ length: 30 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 1 + Math.random() * 2.5,
  speed: 0.4 + Math.random() * 0.8,
  sway: Math.random() * Math.PI * 2,
}));

// f: { levels (4 smoothed bands, 0..1), loudness (their mean), voiceLevels, state, muted }
export function draw(ctx, t, w, h, f) {
  const { levels, loudness } = f;
  const horizon = h * 0.72;
  const cx = w / 2;
  const sunY = horizon - h * 0.08;
  const sunR = Math.min(w, h) * (0.16 + loudness * 0.12);

  // Radiant warm sun
  const sun = ctx.createRadialGradient(cx, sunY, sunR * 0.1, cx, sunY, sunR);
  sun.addColorStop(0, "#ffffff");
  sun.addColorStop(0.3, "#ffe082");
  sun.addColorStop(0.7, "#ff9800");
  sun.addColorStop(1, "rgba(230, 81, 0, 0)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Floating buoyant embers
  embers.forEach((e) => {
    e.y += (0.0007 + loudness * 0.005) * e.speed;
    if (e.y > 1) {
      e.y = 0;
      e.x = Math.random();
    }
    const x = e.x * w + Math.sin(t + e.sway) * 16;
    const y = horizon - e.y * h * 0.55;
    ctx.fillStyle = `rgba(255, 213, 79, ${(1 - e.y) * 0.8})`;
    ctx.beginPath();
    ctx.arc(x, y, e.r, 0, Math.PI * 2);
    ctx.fill();
  });

  // Layered rolling waves
  sunsetHills.forEach((hill, i) => {
    const base = horizon + i * h * 0.055;
    const amp = h * (0.02 + 0.008 * Math.sin(t * 1.3 + i)) + levels[hill.band] * h * 0.18;
    const phase = t * hill.speed + hill.phase;

    const crest = [];
    for (let x = 0; x <= w + 6; x += 6) {
      const u = (x / w) * 2 - 1;
      const env = 0.45 + 0.55 * Math.exp(-u * u * 2.8);
      const wave = 0.65 * Math.sin(u * hill.freq + phase) + 0.35 * Math.sin(u * hill.freq * 2.2 - phase * 0.7);
      crest.push([x, base - amp * env * wave]);
    }

    ctx.beginPath();
    ctx.moveTo(0, h);
    crest.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(w, h);
    ctx.closePath();

    const fill = ctx.createLinearGradient(0, base - amp, 0, h);
    fill.addColorStop(0, `rgba(${hill.rgb}, 0.95)`);
    fill.addColorStop(0.6, "rgba(35, 18, 12, 0.98)");
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    crest.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = "rgba(255, 248, 225, 0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}
