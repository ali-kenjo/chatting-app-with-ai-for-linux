// Visualizer: Zen Ripples (rings spreading from a calm centre on each vocal inflection)

// Zen ripples
const zenRipples = [];
let lastRippleTime = 0;

export function draw(ctx, t, w, h, f) {
  const { loudness } = f;
  const cx = w / 2;
  const cy = h / 2;

  // Generate ripple on vocal inflection
  if (loudness > 0.06 && performance.now() - lastRippleTime > 180) {
    zenRipples.push({
      r: 10,
      maxR: Math.min(w, h) * (0.35 + loudness * 0.45),
      alpha: 0.85,
      speed: 2.2 + loudness * 4,
    });
    lastRippleTime = performance.now();
  }

  // Dark reflective water background
  const water = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  water.addColorStop(0, "#082630");
  water.addColorStop(1, "#030e12");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);

  // Update and draw ripples
  for (let i = zenRipples.length - 1; i >= 0; i--) {
    const rip = zenRipples[i];
    rip.r += rip.speed;
    rip.alpha *= 0.97;

    ctx.beginPath();
    ctx.arc(cx, cy, rip.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(100, 255, 218, ${rip.alpha})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (rip.r >= rip.maxR || rip.alpha < 0.02) {
      zenRipples.splice(i, 1);
    }
  }

  // Calm central water stone / lotus reflection
  const centerPulse = 18 + loudness * 22;
  const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, centerPulse);
  centerGrad.addColorStop(0, "#ffffff");
  centerGrad.addColorStop(0.5, "rgba(100, 255, 218, 0.7)");
  centerGrad.addColorStop(1, "rgba(2, 119, 189, 0)");
  ctx.fillStyle = centerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, centerPulse, 0, Math.PI * 2);
  ctx.fill();
}
