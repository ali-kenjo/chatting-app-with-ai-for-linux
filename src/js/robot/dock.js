// ---------- The robot next to your text chats ----------
// A small live robot in the bottom right corner. It only uses the empty space
// beside the centered chat column, so it never covers messages or the
// composer: it gets smaller as that space shrinks and hides when there's
// none (or the window is under 760 px). You can fold it away; that's
// remembered. It draws nothing while folded, hidden or behind voice mode.
import { robot } from "./index.js";
import { getSettings, onSettings } from "../store.js";

const main = document.getElementById("main");
const dock = document.getElementById("robot-dock");
const stage = document.getElementById("robot-dock-stage");
const foldButton = document.getElementById("robot-dock-toggle");
const openButton = document.getElementById("robot-dock-open");
const voiceMode = document.getElementById("voice-mode");
const narrow = window.matchMedia("(max-width: 760px)");

// Sizes, biggest first: [name, width, height]; each needs its width + 32 px of space
const SIZES = [
  ["large", 176, 204],
  ["compact", 132, 156],
  ["tiny", 96, 116],
];
const COLUMN = { chat: 760, welcome: 700 }; // the centered content's width (style.css)

let folded = false;
try {
  folded = localStorage.getItem("friends.robotDock") === "folded";
} catch {}

robot.host("dock", stage, { priority: 1, shot: "dock", background: "dock", position: "center", cinematic: false });

// How much room is free beside the centered column
function freeSpace() {
  const column = main.classList.contains("has-chat") ? COLUMN.chat : COLUMN.welcome;
  return (main.clientWidth - column) / 2;
}

let size = null;
function update() {
  const on = Boolean(getSettings()?.robot?.chatDock) && !robot.unavailable;
  const room = freeSpace();
  size = narrow.matches ? null : SIZES.find(([, w]) => room >= w + 32) || null;
  const fits = on && Boolean(size);
  dock.hidden = !fits || folded;
  openButton.hidden = !fits || !folded;
  if (size) {
    dock.dataset.size = size[0];
    dock.style.setProperty("--dock-w", `${size[1]}px`);
    dock.style.setProperty("--dock-h", `${size[2]}px`);
  }
  robot.show("dock", fits && !folded && voiceMode.hidden);
}

function setFolded(value) {
  folded = value;
  try {
    localStorage.setItem("friends.robotDock", folded ? "folded" : "open");
  } catch {}
  update();
  (folded ? openButton : foldButton).focus({ preventScroll: true });
}

foldButton.addEventListener("click", () => setFolded(true));
openButton.addEventListener("click", () => setFolded(false));

// Say hi: a click (or Enter) on the robot makes it wave
stage.addEventListener("click", () => robot.director.toolEvent({ gesture: "wave" }));
stage.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    robot.director.toolEvent({ gesture: "wave" });
  }
});

new ResizeObserver(update).observe(main);
new MutationObserver(update).observe(main, { attributes: true, attributeFilter: ["class"] });
new MutationObserver(update).observe(voiceMode, { attributes: true, attributeFilter: ["hidden"] });
narrow.addEventListener("change", update);
onSettings(update);
document.addEventListener("friends:robot-unavailable", update);

// "Follow my face" is using the camera: a small dot on the dock says so
document.addEventListener("friends:robot-face", (e) => {
  dock.classList.toggle("camera-on", e.detail.state === "on" || e.detail.state === "looking");
});

// The robot is on screen next to the chat (so the AI may be offered its tools)
export const dockShowing = () => !dock.hidden && robot.engine?.active?.name === "dock";
