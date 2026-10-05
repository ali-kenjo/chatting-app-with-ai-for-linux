// Visualizer: Cosmic Pulse (a glowing core, rings and orbiting stars)

// Cosmic particles
const cosmicStars = Array.from({ length: 60 }, () => ({
  angle: Math.random() * Math.PI * 2,
  dist: 40 + Math.random() * 240,
  speed: (0.2 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1),
  size: 1 + Math.random() * 2.5,
  color: Math.random() > 0.5 ? "rgba(111, 156, 245, " : "rgba(235, 118, 255, ",
}));

export function draw(ctx, t, w, h, f) {
  const { levels, loudness } = f;
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.18;
  const pulseR = baseR * (1 + loudness * 0.45);

  // Background stellar nebula
  const nebula = ctx.createRadialGradient(cx, cy, baseR * 0.5, cx, cy, baseR * 3);
  nebula.addColorStop(0, `rgba(124, 77, 255, ${0.2 + loudness * 0.3})`);
  nebula.addColorStop(0.5, `rgba(33, 150, 243, ${0.1 + loudness * 0.2})`);
  nebula.addColorStop(1, "transparent");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);

  // Orbiting star particles
  cosmicStars.forEach((star) => {
    star.angle += (star.speed * 0.015) * (1 + loudness * 1.5);
    const r = star.dist * (1 + levels[1] * 0.25);
    const x = cx + Math.cos(star.angle) * r;
    const y = cy + Math.sin(star.angle) * (r * 0.55);
    ctx.fillStyle = `${star.color}${0.4 + loudness * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, star.size * (1 + loudness * 0.8), 0, Math.PI * 2);
    ctx.fill();
  });

  // Concentric harmonic rings
  for (let ring = 1; ring <= 3; ring++) {
    const ringR = pulseR * (0.8 + ring * 0.35);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(179, 136, 255, ${Math.max(0.1, 0.4 - ring * 0.1 + levels[ring] * 0.4)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Central glowing energy core
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.3, "rgba(224, 64, 251, 0.9)");
  core.addColorStop(0.7, "rgba(101, 31, 255, 0.6)");
  core.addColorStop(1, "rgba(33, 150, 243, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fill();
}
