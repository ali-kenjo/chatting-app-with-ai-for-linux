// Visualizer: Firefly Hearth (fireflies drawn toward a warm glow while it speaks)

// Fireflies
const fireflies = Array.from({ length: 45 }, () => ({
  x: Math.random(),
  y: Math.random(),
  vx: (Math.random() - 0.5) * 0.002,
  vy: (Math.random() - 0.5) * 0.002,
  size: 1.5 + Math.random() * 2.5,
  alpha: Math.random(),
  glowSpeed: 1 + Math.random() * 2,
}));

export function draw(ctx, t, w, h, f) {
  const { loudness } = f;
  const cx = w / 2;
  const cy = h * 0.65;
  const hearthR = Math.min(w, h) * (0.2 + loudness * 0.18);

  // Warm campfire hearth glow
  const hearth = ctx.createRadialGradient(cx, cy, hearthR * 0.1, cx, cy, hearthR * 2);
  hearth.addColorStop(0, `rgba(255, 171, 64, ${0.4 + loudness * 0.5})`);
  hearth.addColorStop(0.4, `rgba(255, 87, 34, ${0.2 + loudness * 0.3})`);
  hearth.addColorStop(1, "transparent");
  ctx.fillStyle = hearth;
  ctx.fillRect(0, 0, w, h);

  // Dancing fireflies
  fireflies.forEach((f) => {
    // Gravitate toward center when loud, drift freely when calm
    const dx = cx - f.x * w;
    const dy = cy - f.y * h;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (loudness > 0.08) {
      f.vx += (dx / dist) * 0.00015;
      f.vy += (dy / dist) * 0.00015;
    }
    f.x += f.vx;
    f.y += f.vy;

    // Boundaries
    if (f.x < 0.05 || f.x > 0.95) f.vx *= -1;
    if (f.y < 0.1 || f.y > 0.9) f.vy *= -1;

    f.alpha = 0.3 + 0.7 * Math.sin(t * f.glowSpeed + f.x * 10);
    const fx = f.x * w;
    const fy = f.y * h;
    const fRadius = f.size * (1 + loudness * 0.8);

    // A faint larger circle as the glow: shadowBlur on every firefly is slow
    const a = Math.max(0.1, f.alpha);
    ctx.fillStyle = `rgba(255, 215, 64, ${a * 0.18})`;
    ctx.beginPath();
    ctx.arc(fx, fy, fRadius * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 238, 88, ${a})`;
    ctx.beginPath();
    ctx.arc(fx, fy, fRadius, 0, Math.PI * 2);
    ctx.fill();
  });
}
