// A podcast studio: a wall of sound panels, a neon sign with your words, a microphone on a boom arm,
// two hanging lamps. The sign and the lamps glow (and bloom).
import * as THREE from "three";
import { canvasTexture, neonTexture, matte, glossy, shade, css, rng, glowSprite, addPlant } from "./kit.js";

export function podcast({ colors, glow, props, sign, keep, group: room }) {
  const group = new THREE.Group();
  group.name = "Podcast studio";
  room.add(group);
  const glowing = [];
  const rand = rng(7);

  // ----- The wall, with sound panels -----
  const panelColor = colors.detail;
  const wallTexture = keep(
    canvasTexture(1536, 768, (ctx, w, h) => {
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, css(colors.wall));
      base.addColorStop(1, css(shade(colors.wall, { l: -0.02 })));
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      if (!props.panels) return;
      const cols = 8;
      const rows = 4;
      const gap = 10;
      const pw = (w - gap * (cols + 1)) / cols;
      const ph = (h - gap * (rows + 1)) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = gap + c * (pw + gap);
          const y = gap + r * (ph + gap);
          const tone = 0.88 + rand() * 0.2;
          const col = new THREE.Color(panelColor).multiplyScalar(tone);
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, pw, ph, 10);
          ctx.clip();
          ctx.fillStyle = css(col);
          ctx.fillRect(x, y, pw, ph);
          // The foam's wedges: soft diagonal ridges
          const dir = (r + c) % 2 ? 1 : -1;
          for (let i = -ph; i < pw + ph; i += 14) {
            const g = ctx.createLinearGradient(x + i, y, x + i + 14 * dir, y + 14);
            g.addColorStop(0, "rgba(255,255,255,0.10)");
            g.addColorStop(0.5, "rgba(0,0,0,0.16)");
            g.addColorStop(1, "rgba(255,255,255,0.0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(x + i, y);
            ctx.lineTo(x + i + 14, y);
            ctx.lineTo(x + i + 14 + ph * dir, y + ph);
            ctx.lineTo(x + i + ph * dir, y + ph);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
      }
    })
  );
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(10, 5)), keep(matte("#ffffff", { map: wallTexture })));
  wall.position.set(0, 1.5, -2.6);
  group.add(wall);

  // ----- The neon sign -----
  let signMaterial = null;
  if (props.sign) {
    const texture = keep(neonTexture(sign || "ON AIR", `#${glow.getHexString()}`));
    signMaterial = keep(new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: texture, emissiveIntensity: 1.7, transparent: true, map: texture, roughness: 1, depthWrite: false }));
    // (the picture is both the glow and the shape; the color of the plane itself is black)
    const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.2, 0.825)), signMaterial);
    mesh.position.set(-1.55, 2.05, -2.5);
    mesh.rotation.z = 0.025;
    group.add(mesh);
    glowing.push(signMaterial);
    const halo = glowSprite(keep, glow, 3.4, 0.22);
    halo.position.set(-1.55, 2.05, -2.55);
    halo.scale.set(3.8, 2.2, 1);
    group.add(halo);
  }

  // ----- Hanging lamps -----
  const bulbs = [];
  if (props.pendants) {
    const metal = keep(glossy("#23252b", 0.35, { metalness: 0.6, side: THREE.DoubleSide }));
    const bulbMaterial = keep(new THREE.MeshStandardMaterial({ color: "#2a1d10", emissive: "#ffc88a", emissiveIntensity: 2.4, roughness: 0.4 }));
    glowing.push(bulbMaterial);
    for (const [x, z, drop] of [[-0.95, -1.5, 0.0], [0.95, -1.6, 0.18]]) {
      const lamp = new THREE.Group();
      lamp.position.set(x, 2.65 - drop, z);
      lamp.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.004, 0.004, 1.2, 6)), keep(matte("#111317"))).translateY(0.6 + 0.18));
      const shadeMesh = new THREE.Mesh(keep(new THREE.LatheGeometry([new THREE.Vector2(0.03, 0.18), new THREE.Vector2(0.08, 0.15), new THREE.Vector2(0.17, 0.06), new THREE.Vector2(0.22, 0.0)], 40)), metal);
      shadeMesh.castShadow = false;
      lamp.add(shadeMesh);
      const bulb = new THREE.Mesh(keep(new THREE.SphereGeometry(0.06, 20, 14)), bulbMaterial);
      bulb.position.y = 0.02;
      lamp.add(bulb);
      const halo = glowSprite(keep, "#ffc88a", 1.5, 0.35);
      halo.position.set(0, -0.05, 0);
      lamp.add(halo);
      bulbs.push(halo);
      group.add(lamp);
    }
  }

  // ----- The microphone on its boom -----
  if (props.mic) {
    const dark = keep(glossy("#1b1d22", 0.35, { metalness: 0.5 }));
    const chrome = keep(glossy("#b9bec9", 0.25, { metalness: 0.9 }));
    const mic = new THREE.Group();
    mic.position.set(1.55, 0, -0.5);
    mic.scale.setScalar(1.15);
    // The stand: a base, a pole, and an arm that reaches in toward the robot
    const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 36)), dark);
    base.position.y = 0.02;
    mic.add(base);
    const pole = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.018, 0.018, 1.66, 14)), chrome);
    pole.position.y = 0.83;
    mic.add(pole);
    const beam = (a, b, radius, material) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(radius, radius, dir.length(), 10)), material);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return m;
    };
    const top = new THREE.Vector3(0, 1.64, 0);
    const elbow = new THREE.Vector3(-0.4, 1.5, 0.2);
    const end = new THREE.Vector3(-0.66, 1.16, 0.38);
    mic.add(beam(top, elbow, 0.014, chrome), beam(elbow, end, 0.012, chrome));
    // The microphone itself, hanging in its shock mount, pointing at the robot, with a pop filter in front
    const head = new THREE.Group();
    head.position.set(-0.77, 1.1, 0.38);
    head.rotation.z = Math.PI / 2;
    head.rotation.x = -0.05;
    head.add(new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.05, 0.16, 8, 20)), dark));
    const grille = new THREE.Mesh(keep(new THREE.CapsuleGeometry(0.052, 0.1, 8, 20)), keep(glossy("#8a8f9b", 0.5, { metalness: 0.7 })));
    grille.position.y = 0.04;
    head.add(grille);
    for (const y of [-0.08, 0.12]) {
      const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.072, 0.006, 8, 30)), chrome);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      head.add(ring);
    }
    const pop = new THREE.Mesh(keep(new THREE.CircleGeometry(0.12, 32)), keep(new THREE.MeshStandardMaterial({ color: "#15171c", transparent: true, opacity: 0.5, roughness: 0.8, side: THREE.DoubleSide, depthWrite: false })));
    pop.rotation.x = Math.PI / 2;
    pop.position.y = 0.2;
    head.add(pop);
    const popRim = new THREE.Mesh(keep(new THREE.TorusGeometry(0.12, 0.005, 8, 36)), chrome);
    popRim.rotation.x = Math.PI / 2;
    popRim.position.y = 0.2;
    head.add(popRim);
    mic.add(head);
    group.add(mic);
  }

  if (props.plant) addPlant(group, keep, -2.4, -1.3, shade(colors.detail, { l: 0.12 }), { scale: 1.6 });

  const wallEdge = colors.wall.clone().multiplyScalar(0.3);
  return {
    glow: glowing,
    backdrop: { mode: "vignette", bg: colors.wall, edge: wallEdge, glow: 0, glowColor: glow, blobs: [] },
    update(dt, time, pose, fx) {
      // A neon tube's slight unevenness, and now and then a quick flicker (steady when filming)
      const calm = fx.friendly || fx.reduced;
      if (signMaterial) signMaterial.emissiveIntensity = calm ? 1.7 : 1.7 + Math.sin(time * 41) * 0.03 + (Math.sin(time * 0.7) > 0.985 ? -0.5 : 0);
      bulbs.forEach((b, i) => (b.material.opacity = calm ? 0.33 : 0.33 + 0.03 * Math.sin(time * 1.3 + i)));
    },
  };
}
