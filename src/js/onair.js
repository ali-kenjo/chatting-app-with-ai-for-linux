// ---------- On air: co-host mode ----------
// When it's on, the AI knows it's on camera: it plays to the audience as your
// co-host, and (Settings → Characters → On camera) keeps everything private out
// of it. On with the ON AIR button in voice mode, and by itself in filming mode
// and while a video is recorded (when "On by itself" is on).
import { getSettings, onSettings } from "./store.js";

let manual = false;
const reasons = new Set(); // "filming", "recording"
const listeners = new Set();
let last = false;

export function isOnAir() {
  const auto = getSettings()?.onAir?.auto !== false && reasons.size > 0;
  return manual || auto;
}

function changed() {
  const now = isOnAir();
  if (now === last) return;
  last = now;
  listeners.forEach((fn) => fn(now));
}

// fn(on) runs whenever it goes on or off
export function onOnAir(fn) {
  listeners.add(fn);
}

export function toggleOnAir() {
  // Switching off while filming turns the automatic part off for now, too
  if (isOnAir()) {
    manual = false;
    reasons.clear();
  } else manual = true;
  changed();
}

// filming.js and the recorder say when they start and stop
export function autoOnAir(reason, on) {
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  changed();
}

export function resetOnAir() {
  manual = false;
  reasons.clear();
  changed();
}

onSettings(changed);
