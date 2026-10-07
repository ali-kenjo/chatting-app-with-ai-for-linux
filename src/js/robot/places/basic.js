// The places that are only a backdrop: the dark studio, the glow, a gradient, your own picture, and the
// two flat colors for keying out in a video editor.
import * as THREE from "three";

// The vignette's rim: the same hue as the middle, much darker
const rim = (wall) => wall.clone().multiplyScalar(0.29);

export function studio({ colors }) {
  return { backdrop: { mode: "vignette", bg: colors.wall, edge: rim(colors.wall), glow: 0, glowColor: colors.glow, blobs: [] } };
}

export function glow({ colors }) {
  return { backdrop: { mode: "vignette", bg: colors.wall, edge: rim(colors.wall), glow: 0.28, glowColor: colors.glow, blobs: [] } };
}

// Two colors, top and bottom, with an optional spot of light behind the robot
export function gradient({ colors, props }) {
  return { backdrop: { mode: "gradient", bg: colors.wall, edge: colors.floor, glow: props.spot ? 0.3 : 0, glowColor: colors.glow, blobs: [] } };
}

// Your own picture, made by the RoomScene from the uploaded image; until there is one, a plain dark backdrop
export function photo({ colors }) {
  return { backdrop: { mode: "image", bg: colors.wall, edge: rim(colors.wall), glow: 0, glowColor: colors.glow, blobs: [] }, photo: true };
}

const chroma = (hex) => () => ({ backdrop: { mode: "flat", bg: new THREE.Color(hex), edge: new THREE.Color(hex), glow: 0, glowColor: new THREE.Color(hex), blobs: [] } });

export const green = chroma("#00b140");
export const blue = chroma("#0047bb");
