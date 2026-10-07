// Things worn on the sides of the head: headphones, a headset with a microphone, earmuffs.
import * as THREE from "three";

// The band over the head, from one ear to the other: it goes back as it rises, so it
// passes behind the fins instead of through them
function band(c, material, thickness = 0.013) {
  const { head } = c.dims;
  const side = c.dims.headSide(head.y, 0) + 0.02;
  const rise = head.b + 0.012;
  const points = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * Math.PI;
    points.push(new THREE.Vector3(Math.cos(t) * side, head.y + Math.sin(t) * rise, -Math.sin(t) * 0.05 * (head.c / 0.3)));
  }
  return c.make(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, thickness, 10), material, { shadow: false });
}

// One ear cup: a flat cylinder facing the head, with a soft cushion on the inner side
function cup(c, side, shell, cushion, radius = 0.072) {
  const { head } = c.dims;
  const x = c.dims.headSide(head.y, 0) + 0.022;
  const g = new THREE.Group();
  g.position.set(side * x, head.y, 0);
  const hs = head.a / 0.36;
  const r = radius * hs;
  const outer = c.make(new THREE.CylinderGeometry(r, r, 0.05, 40), shell);
  outer.rotation.z = Math.PI / 2;
  g.add(outer);
  const pad = c.make(new THREE.TorusGeometry(r * 0.88, 0.017, 14, 40), cushion);
  pad.rotation.y = Math.PI / 2;
  pad.position.x = -side * 0.027;
  g.add(pad);
  return g;
}

const headphones = (c) => {
  const g = new THREE.Group();
  const shell = c.paint(1, { roughness: 0.4, metalness: 0.15 });
  const cushion = c.paint(2, { roughness: 0.7 });
  g.add(band(c, shell));
  g.add(cup(c, 1, shell, cushion), cup(c, -1, shell, cushion));
  return { object: g };
};

const headset = (c) => {
  const g = new THREE.Group();
  const shell = c.paint(1, { roughness: 0.4, metalness: 0.15 });
  const cushion = c.paint(2, { roughness: 0.7 });
  g.add(band(c, shell));
  const left = cup(c, 1, shell, cushion);
  g.add(left, cup(c, -1, shell, cushion));
  // The boom: from the cup forward and down to the corner of the mouth
  const { head } = c.dims;
  const hs = head.a / 0.36;
  const x0 = left.position.x - 0.01;
  const mouthY = head.y + head.screen.y - 0.3 * head.screen.w * 0.5;
  const tipZ = c.dims.headFront(0.1 * hs, mouthY) + 0.035;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x0, head.y - 0.02, 0.01),
    new THREE.Vector3(x0 + 0.015, head.y - 0.075, tipZ * 0.55),
    new THREE.Vector3(x0 - 0.05, mouthY - 0.01, tipZ - 0.03),
    new THREE.Vector3(0.095 * hs, mouthY, tipZ),
  ]);
  g.add(c.make(new THREE.TubeGeometry(curve, 28, 0.0052, 8), shell, { shadow: false }));
  const capsule = c.make(new THREE.CapsuleGeometry(0.0125, 0.02, 6, 14), cushion, { shadow: false });
  capsule.position.set(0.095 * hs, mouthY, tipZ);
  capsule.rotation.z = Math.PI / 2;
  g.add(capsule);
  return { object: g };
};

const earmuffs = (c) => {
  const g = new THREE.Group();
  const shell = c.paint(1, { roughness: 0.5 });
  const fluff = c.paint(2, { roughness: 1 });
  g.add(band(c, shell, 0.011));
  const { head } = c.dims;
  const hs = head.a / 0.36;
  for (const s of [1, -1]) {
    const x = c.dims.headSide(head.y, 0) + 0.03;
    const puff = new THREE.SphereGeometry(1, 36, 24);
    puff.scale(0.04, 0.085 * hs, 0.085 * hs);
    const m = c.make(puff, fluff);
    m.position.set(s * x, head.y, 0);
    g.add(m);
    // a rim of tufts
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const tuft = c.make(new THREE.SphereGeometry(0.02 * hs, 12, 10), fluff);
      tuft.position.set(s * (x + 0.0), head.y + Math.sin(a) * 0.082 * hs, Math.cos(a) * 0.082 * hs);
      g.add(tuft);
    }
  }
  return { object: g };
};

export default { headphones, headset, earmuffs };
