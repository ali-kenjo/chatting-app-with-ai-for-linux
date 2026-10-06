// Things on the robot's back: a cape, a backpack, wings, a jetpack, a tail. They hang on the Body,
// so they lean and turn with it, and the ones that can move do (a cape's sway, a wing's flap).
import * as THREE from "three";
import { bodySurface, shoulderStrap, plate, roundedRect } from "./kit.js";

const shoulderY = (c) => c.dims.body.h * 0.86 - c.dims.body.h / 2;

const cape = (c) => {
  const { body } = c.dims;
  const outer = c.paint(1, { roughness: 0.75, side: THREE.FrontSide });
  const lining = c.paint(2, { roughness: 0.75, side: THREE.BackSide });
  const clasp = c.paint(2, { roughness: 0.25, metalness: 0.85 });
  const length = body.h * 1.05;
  const top = body.h * 0.9;
  const geo = new THREE.PlaneGeometry(1, 1, 16, 22);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // -0.5 … 0.5
    const v = 0.5 - pos.getY(i); // 0 at the top … 1 at the hem
    const y = top - v * length;
    const r = c.dims.bodyRadius(Math.max(0.02, Math.min(body.h, y))) * body.depth + 0.028 + v * 0.07;
    const width = 0.22 + v * 0.8;
    const theta = (u * width) / Math.max(0.12, r);
    pos.setXYZ(i, Math.sin(theta) * r * 1.0, y - body.h / 2, -Math.cos(theta) * r + Math.pow(Math.abs(u), 2) * v * 0.04);
  }
  geo.computeVertexNormals();
  const pivot = new THREE.Group();
  pivot.position.set(0, top - body.h / 2, 0);
  const mesh = new THREE.Group();
  mesh.position.y = -(top - body.h / 2);
  mesh.add(c.make(geo, outer), c.make(geo, lining, { shadow: false }));
  pivot.add(mesh);
  // The clasp at the neck
  for (const s of [1, -1]) {
    const k = c.make(new THREE.SphereGeometry(0.017, 14, 10), clasp);
    const y = top - 0.01;
    k.position.set(s * 0.075, y - body.h / 2 - 0.0, body.depth * Math.sqrt(Math.max(0, c.dims.bodyRadius(y) ** 2 - 0.075 ** 2)) + 0.006);
    mesh.add(k);
  }
  const neck = c.make(new THREE.TorusGeometry(c.dims.bodyRadius(top) + 0.008, 0.011, 10, 40), outer);
  neck.rotation.x = Math.PI / 2;
  neck.position.set(0, top - body.h / 2, 0);
  neck.scale.set(1, body.depth, 1);
  neck.scale.set(1, 1, body.depth);
  mesh.add(neck);
  return {
    object: pivot,
    update(pose, time) {
      const talk = pose.speaking || 0;
      pivot.rotation.x = -0.04 - (pose.bodyPitch || 0) * 0.5 + Math.sin(time * 1.6) * 0.025 + talk * Math.sin(time * 9) * 0.015;
      pivot.rotation.z = -(pose.bodyRoll || 0) * 0.3 + Math.sin(time * 1.1 + 1) * 0.015;
    },
  };
};

const backpack = (c) => {
  const { body } = c.dims;
  const pack = c.paint(1, { roughness: 0.75 });
  const trim = c.paint(2, { roughness: 0.6 });
  const g = new THREE.Group();
  const y = body.h * 0.5;
  const s = bodySurface(c, y);
  const w = Math.min(0.3, s.r * 1.15);
  const main = c.make(plate(roundedRect(w, 0.32, 0.07), 0.1, 0.012), pack);
  main.position.set(0, y - body.h / 2, -(s.z + 0.05));
  g.add(main);
  const flap = c.make(plate(roundedRect(w * 1.02, 0.12, 0.05), 0.108, 0.01), trim);
  flap.position.set(0, y - body.h / 2 + 0.12, -(s.z + 0.05));
  g.add(flap);
  const pocket = c.make(plate(roundedRect(w * 0.7, 0.1, 0.03), 0.045, 0.008), trim);
  pocket.position.set(0, y - body.h / 2 - 0.08, -(s.z + 0.115));
  g.add(pocket);
  for (const sx of [1, -1]) g.add(shoulderStrap(c, sx * 0.1, { from: 0.42, over: 0.93, to: 0.5, width: 0.034, material: trim }));
  return { object: g };
};

// A wing made of overlapping feathers, fanned out from the shoulder
function feathers(c, side, mats, { count = 5, length = 0.3, spread = 1.2, lift = 0.5 }) {
  const wing = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 20, 12);
  for (let i = 0; i < count; i++) {
    const len = length * (1 - i * 0.1);
    const f = c.make(geo, i < count - 2 ? mats[0] : mats[1], { shadow: false });
    f.scale.set(len / 2, 0.034, 0.012);
    const a = lift - i * (spread / count);
    f.position.set((Math.cos(a) * len) / 2, Math.sin(a) * len / 2 - i * 0.012, -i * 0.004);
    f.rotation.z = a;
    wing.add(f);
  }
  wing.scale.x = side;
  return wing;
}

const wings = (c) => {
  const { body } = c.dims;
  const a = c.paint(1, { roughness: 0.55, physical: true });
  const b = c.paint(2, { roughness: 0.6 });
  const g = new THREE.Group();
  const y = shoulderY(c) - 0.02;
  const s = bodySurface(c, y + body.h / 2);
  const sides = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.07, y, -(s.z + 0.01));
    pivot.add(feathers(c, side, [a, b], { count: 6, length: 0.46, spread: 1.4, lift: 0.75 }));
    pivot.rotation.y = side * 0.35;
    g.add(pivot);
    return [pivot, side];
  });
  return {
    object: g,
    update(pose, time) {
      const flap = Math.sin(time * 1.9) * 0.05 + (pose.speaking || 0) * Math.sin(time * 11) * 0.05 + (pose.finL || 0) * 0.12;
      for (const [pivot, side] of sides) pivot.rotation.y = side * (0.35 + flap);
    },
  };
};

const butterfly = (c) => {
  const { body } = c.dims;
  const top = c.paint(1, { roughness: 0.5, side: THREE.DoubleSide, physical: true });
  const bottom = c.paint(2, { roughness: 0.5, side: THREE.DoubleSide, physical: true });
  const g = new THREE.Group();
  const y = shoulderY(c) - 0.04;
  const s = bodySurface(c, y + body.h / 2);
  const upper = new THREE.Shape();
  upper.moveTo(0, 0);
  upper.bezierCurveTo(0.08, 0.2, 0.3, 0.3, 0.38, 0.17);
  upper.bezierCurveTo(0.43, 0.04, 0.3, -0.08, 0.1, -0.04);
  upper.closePath();
  const lower = new THREE.Shape();
  lower.moveTo(0, 0);
  lower.bezierCurveTo(0.12, -0.04, 0.3, -0.04, 0.27, -0.2);
  lower.bezierCurveTo(0.24, -0.34, 0.08, -0.3, 0, -0.04);
  lower.closePath();
  const sides = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.05, y, -(s.z + 0.012));
    const wing = new THREE.Group();
    wing.add(c.make(plate(upper, 0.008, 0.002), top, { shadow: false }), c.make(plate(lower, 0.008, 0.002), bottom, { shadow: false }));
    wing.scale.set(side * 1.35, 1.35, 1.35);
    pivot.add(wing);
    pivot.rotation.y = side * 0.55;
    g.add(pivot);
    return [pivot, side];
  });
  return {
    object: g,
    update(pose, time) {
      const flap = Math.sin(time * 2.4) * 0.12 + (pose.speaking || 0) * Math.sin(time * 12) * 0.08;
      for (const [pivot, side] of sides) pivot.rotation.y = side * (0.55 + flap);
    },
  };
};

const jetpack = (c) => {
  const { body } = c.dims;
  const tank = c.paint(1, { roughness: 0.3, metalness: 0.7 });
  const trim = c.paint(2, { roughness: 0.4 });
  const flameMat = c.glow(2, 1.8, { transparent: true, opacity: 0.9 });
  const g = new THREE.Group();
  const y = body.h * 0.55;
  const s = bodySurface(c, y);
  const flames = [];
  for (const side of [1, -1]) {
    const x = side * (s.r * 0.78);
    const z = -(s.z * 0.55 + 0.05);
    const t = c.make(new THREE.CapsuleGeometry(0.052, 0.2, 8, 24), tank);
    t.position.set(x, y - body.h / 2, z);
    g.add(t);
    const band = c.make(new THREE.TorusGeometry(0.054, 0.007, 8, 24), trim);
    band.rotation.x = Math.PI / 2;
    band.position.set(x, y - body.h / 2 + 0.04, z);
    g.add(band);
    const nozzle = c.make(new THREE.CylinderGeometry(0.036, 0.048, 0.04, 20), trim);
    nozzle.position.set(x, y - body.h / 2 - 0.155, z);
    g.add(nozzle);
    const flame = c.make(new THREE.ConeGeometry(0.036, 0.16, 20, 1, true), flameMat, { shadow: false });
    flame.rotation.x = Math.PI;
    flame.position.set(x, y - body.h / 2 - 0.255, z);
    g.add(flame);
    flames.push(flame);
  }
  const bar = c.make(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 10), trim);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, y - body.h / 2 + 0.03, -(s.z + 0.03));
  g.add(bar);
  return {
    object: g,
    update(pose, time) {
      flames.forEach((f, i) => {
        f.scale.y = 0.85 + 0.2 * Math.sin(time * 31 + i * 2) + (pose.speaking || 0) * 0.25;
        f.position.y = -0.255 - (f.scale.y - 1) * 0.08 + (c.dims.body.h * 0.55 - c.dims.body.h / 2);
      });
    },
  };
};

const tail = (c) => {
  const { body } = c.dims;
  const fur = c.paint(1, { roughness: 1 });
  const tip = c.paint(2, { roughness: 1 });
  const root = new THREE.Group();
  const y = body.h * 0.2;
  const s = bodySurface(c, y);
  root.position.set(0, y - body.h / 2, -(s.z - 0.01));
  const sway = new THREE.Group();
  root.add(sway);
  const path = [[0, 0, 0, 0.055], [0.05, -0.01, -0.08, 0.07], [0.13, 0.02, -0.14, 0.08], [0.22, 0.09, -0.17, 0.082], [0.3, 0.18, -0.17, 0.07], [0.34, 0.28, -0.15, 0.058]];
  path.forEach(([x, yy, z, r], i) => {
    const m = c.make(new THREE.SphereGeometry(r, 20, 14), i === path.length - 1 ? tip : fur);
    m.position.set(x, yy, z);
    sway.add(m);
  });
  const end = c.make(new THREE.SphereGeometry(0.052, 20, 14), tip);
  end.position.set(0.34, 0.34, -0.13);
  sway.add(end);
  return {
    object: root,
    update(pose, time) {
      sway.rotation.y = Math.sin(time * 1.7) * 0.28 + (pose.speaking || 0) * Math.sin(time * 8) * 0.1;
      sway.rotation.z = Math.sin(time * 1.2 + 1) * 0.06;
    },
  };
};

export default { cape, backpack, wings, butterfly, jetpack, tail };
