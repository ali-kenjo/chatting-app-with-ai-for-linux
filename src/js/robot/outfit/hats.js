// Hats: they sit on the middle of the head, between the fins or ears (which stay where they are).
// Each builder gets the context from outfit/index.js and returns { object, update? }.
import * as THREE from "three";
import { starGeometry, around, turned, smooth, bend } from "./kit.js";

// Where a hat starts: the top of the head, a little sunk in so the rim doesn't float on the curve
function base({ group, dims }, sink = 0.035, back = 0.012) {
  const hs = dims.head.a / 0.36;
  const g = group("hat");
  g.position.set(0, dims.headTop(0) - sink * hs, -back * hs);
  g.scale.setScalar(hs);
  return g;
}

const dome = (rx, ry, rz, part = Math.PI / 2) => {
  const geo = new THREE.SphereGeometry(1, 48, 28, 0, Math.PI * 2, 0, part);
  geo.scale(rx, ry, rz);
  return geo;
};

const beanie = (c) => {
  const g = base(c);
  const hat = c.paint(1, { roughness: 0.9 });
  const bobble = c.paint(2, { roughness: 0.85 });
  g.add(c.make(dome(0.19, 0.155, 0.18), hat).translateY(0.02));
  const cuff = c.make(new THREE.TorusGeometry(0.188, 0.03, 18, 56), hat);
  cuff.rotation.x = Math.PI / 2;
  cuff.scale.set(1, 0.95, 1);
  g.add(cuff.translateZ(0));
  const ball = c.make(new THREE.SphereGeometry(0.04, 24, 18), bobble);
  ball.position.y = 0.19;
  g.add(ball);
  return { object: g };
};

const cap = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.7 });
  const button = c.paint(2, { roughness: 0.6 });
  const crown = turned(smooth([[0, 0.105], [0.07, 0.098], [0.13, 0.078], [0.175, 0.045], [0.192, 0.0]]), 48);
  g.add(c.make(crown, hat).translateY(0.0));
  const brim = new THREE.CylinderGeometry(0.17, 0.17, 0.014, 48, 1, false, -Math.PI / 2, Math.PI);
  brim.scale(1.0, 1, 1.1);
  const b = c.make(brim, hat);
  b.position.set(0, 0.012, 0.115);
  b.rotation.x = 0.22;
  g.add(b);
  const knob = c.make(new THREE.SphereGeometry(0.016, 16, 12), button);
  knob.position.y = 0.107;
  g.add(knob);
  return { object: g };
};

const tophat = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.45, physical: true });
  const band = c.paint(2, { roughness: 0.6 });
  g.add(c.make(new THREE.CylinderGeometry(0.2, 0.2, 0.014, 56), hat).translateY(0.007));
  g.add(c.make(new THREE.CylinderGeometry(0.112, 0.12, 0.185, 48), hat).translateY(0.105));
  g.add(c.make(new THREE.CylinderGeometry(0.123, 0.123, 0.04, 48), band).translateY(0.04));
  return { object: g };
};

const beret = (c) => {
  const g = base(c, 0.035);
  const hat = c.paint(1, { roughness: 0.95 });
  const stem = c.paint(2, { roughness: 0.8 });
  const body = c.make(dome(0.215, 0.1, 0.2, Math.PI * 0.62), hat);
  body.position.set(0.025, 0.04, 0);
  body.rotation.z = -0.12;
  g.add(body);
  const s = c.make(new THREE.CylinderGeometry(0.009, 0.012, 0.035, 12), stem);
  s.position.set(0.02, 0.14, 0);
  s.rotation.z = -0.12;
  g.add(s);
  return { object: g };
};

const party = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.6 });
  const trim = c.paint(2, { roughness: 0.6 });
  const cone = c.make(new THREE.ConeGeometry(0.1, 0.25, 40), hat);
  cone.position.y = 0.125;
  g.add(cone);
  for (const [y, r] of [[0.03, 0.093], [0.085, 0.073], [0.14, 0.052]]) {
    const ring = c.make(new THREE.TorusGeometry(r, 0.006, 10, 40), trim);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  const pom = c.make(new THREE.SphereGeometry(0.03, 20, 16), trim);
  pom.position.y = 0.255;
  g.add(pom);
  g.rotation.z = -0.08;
  return { object: g };
};

const crown = (c) => {
  const g = base(c, 0.03);
  const gold = c.paint(1, { roughness: 0.28, metalness: 0.75, side: THREE.DoubleSide });
  const gem = c.paint(2, { roughness: 0.15, metalness: 0.1 });
  const band = c.make(new THREE.CylinderGeometry(0.15, 0.158, 0.06, 40, 1, true), gold);
  band.position.y = 0.03;
  g.add(band);
  g.add(around(5, 0.152, (i, a) => {
    const spike = c.make(new THREE.ConeGeometry(0.036, 0.11, 4), gold);
    spike.position.y = 0.105;
    const grp = new THREE.Group();
    grp.add(spike);
    const jewel = c.make(new THREE.SphereGeometry(0.014, 14, 10), gem);
    jewel.position.set(0, 0.168, 0);
    grp.add(jewel);
    return grp;
  }));
  g.add(around(5, 0.157, (i) => {
    const jewel = c.make(new THREE.SphereGeometry(0.013, 14, 10), gem);
    jewel.position.y = 0.03;
    return jewel;
  }, { start: Math.PI / 5 }));
  return { object: g };
};

const wizard = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.8 });
  const star = c.paint(2, { roughness: 0.4, metalness: 0.3 });
  g.add(c.make(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 56), hat).translateY(0.006));
  const lower = c.make(new THREE.CylinderGeometry(0.075, 0.12, 0.16, 40), hat);
  lower.position.y = 0.09;
  g.add(lower);
  const tip = new THREE.ConeGeometry(0.075, 0.2, 40);
  tip.translate(0, 0.1, 0);
  bend(tip, -0.9, "z");
  const t = c.make(tip, hat);
  t.position.y = 0.17;
  g.add(t);
  for (const [y, a, s] of [[0.07, 0.3, 0.02], [0.115, -0.5, 0.016], [0.045, -0.7, 0.014]]) {
    const st = c.make(starGeometry(s, s * 0.45, 5, 0.006), star);
    st.position.set(Math.sin(a) * 0.1, y, Math.cos(a) * 0.1);
    st.rotation.y = a;
    g.add(st);
  }
  g.rotation.z = -0.04;
  return { object: g };
};

const chef = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.9 });
  const fold = c.paint(2, { roughness: 0.95 });
  g.add(c.make(new THREE.CylinderGeometry(0.115, 0.12, 0.07, 40), hat).translateY(0.035));
  const puff = new THREE.SphereGeometry(1, 40, 28);
  puff.scale(0.16, 0.115, 0.15);
  g.add(c.make(puff, hat).translateY(0.15));
  for (const x of [-0.07, 0, 0.07]) {
    const f = c.make(new THREE.CapsuleGeometry(0.008, 0.07, 4, 10), fold);
    f.position.set(x, 0.075, 0.113 - Math.abs(x) * 0.25);
    g.add(f);
  }
  return { object: g };
};

const propeller = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.6 });
  const blades = c.paint(2, { roughness: 0.4 });
  g.add(c.make(dome(0.16, 0.1, 0.15), hat).translateY(0.01));
  const stem = c.make(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10), hat);
  stem.position.y = 0.11;
  g.add(stem);
  const rotor = new THREE.Group();
  rotor.position.y = 0.142;
  for (const k of [0, Math.PI / 2]) {
    const blade = c.make(new THREE.BoxGeometry(0.24, 0.006, 0.034), blades);
    blade.rotation.y = k;
    blade.rotation.z = 0.12;
    rotor.add(blade);
  }
  rotor.add(c.make(new THREE.SphereGeometry(0.014, 14, 10), blades));
  g.add(rotor);
  let angle = 0;
  let last = null;
  return {
    object: g,
    update(pose, time) {
      const dt = last === null ? 0 : Math.max(0, Math.min(0.1, time - last));
      last = time;
      angle += dt * (4 + 26 * Math.min(1, (pose.speaking || 0) + 0.25 * Math.abs(pose.finL || 0)));
      rotor.rotation.y = angle;
    },
  };
};

const cowboy = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.85, side: THREE.DoubleSide });
  const band = c.paint(2, { roughness: 0.7 });
  const brim = turned([[0.09, 0], [0.17, -0.004], [0.22, 0.006], [0.255, 0.034], [0.258, 0.04], [0.25, 0.04], [0.215, 0.015], [0.17, 0.006], [0.09, 0.008]], 56);
  g.add(c.make(brim, hat).translateY(0.01));
  const crown = turned(smooth([[0.105, 0], [0.1, 0.07], [0.082, 0.12], [0.055, 0.135], [0.0, 0.128]]), 40);
  g.add(c.make(crown, hat).translateY(0.012));
  g.add(c.make(new THREE.CylinderGeometry(0.108, 0.108, 0.03, 40), band).translateY(0.03));
  return { object: g };
};

const santa = (c) => {
  const g = base(c, 0.03);
  const hat = c.paint(1, { roughness: 0.95 });
  const fur = c.paint(2, { roughness: 1 });
  const cone = turned(smooth([[0.165, 0], [0.15, 0.05], [0.12, 0.11], [0.082, 0.17], [0.04, 0.23], [0.012, 0.275]]), 44);
  bend(cone, 1.6);
  g.add(c.make(cone, hat).translateY(0.01));
  const trim = c.make(new THREE.TorusGeometry(0.168, 0.034, 16, 56), fur);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.012;
  g.add(trim);
  const pom = c.make(new THREE.SphereGeometry(0.036, 20, 16), fur);
  pom.position.set(1.6 * 0.275 * 0.275 + 0.0, 0.285, 0);
  g.add(pom);
  return { object: g };
};

const bow = (c) => {
  const g = base(c, 0.02);
  const ribbon = c.paint(1, { roughness: 0.45, physical: true });
  const knot = c.paint(2, { roughness: 0.5 });
  const loop = new THREE.SphereGeometry(1, 28, 20);
  loop.scale(0.085, 0.052, 0.022);
  for (const s of [1, -1]) {
    const l = c.make(loop, ribbon);
    l.position.set(s * 0.085, 0.05, 0);
    l.rotation.z = s * 0.38;
    g.add(l);
    const tail = c.make(new THREE.ConeGeometry(0.025, 0.08, 4), ribbon);
    tail.position.set(s * 0.03, 0.01, 0.0);
    tail.rotation.z = s * 2.5;
    tail.scale.set(1, 1, 0.3);
    g.add(tail);
  }
  g.add(c.make(new THREE.SphereGeometry(0.03, 20, 14), knot).translateY(0.052));
  return { object: g };
};

const flower = (c) => {
  const g = base(c, 0.012);
  g.position.x = 0.08 * (c.dims.head.a / 0.36);
  g.rotation.set(0.5, -0.3, -0.35);
  const petal = c.paint(1, { roughness: 0.55 });
  const middle = c.paint(2, { roughness: 0.6 });
  const geo = new THREE.SphereGeometry(1, 20, 14);
  geo.scale(0.034, 0.016, 0.052);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const p = c.make(geo, petal);
    p.position.set(Math.sin(a) * 0.052, 0.02, Math.cos(a) * 0.052);
    p.rotation.y = a;
    g.add(p);
  }
  g.add(c.make(new THREE.SphereGeometry(0.03, 20, 14), middle).translateY(0.03));
  return { object: g };
};

const halo = (c) => {
  const g = base(c, -0.1, 0);
  const light = c.glow(1, 1.8);
  const ring = c.make(new THREE.TorusGeometry(0.13, 0.013, 16, 64), light, { shadow: false });
  ring.rotation.x = Math.PI / 2 + 0.12;
  g.add(ring);
  const y0 = g.position.y;
  return {
    object: g,
    update(pose, time) {
      g.position.y = y0 + Math.sin(time * 2.1) * 0.008;
      ring.rotation.z = Math.sin(time * 0.9) * 0.08;
    },
  };
};

export default { beanie, cap, tophat, beret, party, crown, wizard, chef, propeller, cowboy, santa, bow, flower, halo };
