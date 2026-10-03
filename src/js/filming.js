// ---------- Filming mode ----------
// For filming the laptop screen with a camera or phone: fullscreen with no
// UI, the mouse hidden until it moves, the screen kept awake, a framing guide
// to line the phone up, a countdown before the conversation starts, and
// presentation-clicker keys (see robot/keys.mjs) with small confirmations.
// Esc (or leaving fullscreen) ends it and puts everything back.
import { keyAction, isFilmingKey } from "./robot/keys.mjs";
import { getSettings } from "./store.js";

const CONFIRM = {
  mute: (muted) => (muted ? "Mic off" : "Mic on"),
  interrupt: () => "Cut in",
  start: () => "Starting",
  pause: () => "Paused",
  captions: (on) => (on ? "Captions on" : "Captions off"),
};

// controls: pause(), resume(), mute() → muted, interrupt(), running() → bool,
// onEnter(), onExit(); root: the voice mode element
export function createFilming({ root, controls }) {
  const overlay = root.querySelector("#filming-overlay");
  const setup = root.querySelector("#filming-setup");
  const countdown = root.querySelector("#filming-countdown");
  const toastEl = root.querySelector("#filming-toast");
  const wakeNote = root.querySelector("#filming-wake");
  const delayNote = root.querySelector("#filming-delay");
  const startButton = root.querySelector("#filming-start");

  let on = false;
  let phase = "off"; // "setup" | "counting" | "running" | "paused"
  let wakeLock = null;
  let cursorTimer = null;
  let countTimer = null;
  let toastTimer = null;

  const settings = () => getSettings()?.robot?.filming || { delay: 3, cameraFriendly: true, largeCaptions: false, largerFace: false };

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove("show");
    void toastEl.offsetWidth; // restart the fade
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1300);
  }

  // ----- The screen stays on -----
  async function keepAwake() {
    if (!("wakeLock" in navigator)) {
      wakeNote.textContent = "This browser can't keep the screen on; check your power settings.";
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
      wakeNote.textContent = "The screen stays on.";
    } catch {
      wakeLock = null;
      wakeNote.textContent = "The screen may dim: keeping it on isn't allowed here.";
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (on && document.visibilityState === "visible" && !wakeLock) keepAwake();
  });

  // ----- The mouse hides after 2 seconds without moving -----
  function showCursor() {
    root.classList.remove("hide-cursor");
    clearTimeout(cursorTimer);
    if (on) cursorTimer = setTimeout(() => root.classList.add("hide-cursor"), 2000);
  }

  // ----- Countdown, then the conversation -----
  function start() {
    if (phase === "counting") return;
    clearInterval(countTimer);
    setup.hidden = true; // the framing guide goes as the countdown starts
    overlay.classList.remove("guide");
    let left = Number(settings().delay) || 0;
    const go = () => {
      countdown.hidden = true;
      phase = "running";
      controls.resume();
    };
    if (!left) {
      toast(CONFIRM.start());
      return go();
    }
    phase = "counting";
    countdown.hidden = false;
    const show = () => {
      countdown.textContent = String(left);
      countdown.classList.remove("tick");
      void countdown.offsetWidth;
      countdown.classList.add("tick");
    };
    show();
    countTimer = setInterval(() => {
      left--;
      if (left > 0) return show();
      clearInterval(countTimer);
      go();
    }, 1000);
  }

  function pause() {
    clearInterval(countTimer);
    countdown.hidden = true;
    phase = "paused";
    controls.pause();
    toast(CONFIRM.pause());
  }

  function act(action) {
    showCursor();
    if (action === "exit") return exit();
    if (phase === "setup" || phase === "paused") {
      // Before it runs, the clicker's buttons all mean "go"
      if (action === "startStop" || action === "interrupt") return start();
    }
    if (action === "startStop") return phase === "counting" || phase === "running" ? pause() : start();
    if (action === "mute") return toast(CONFIRM.mute(controls.mute()));
    if (action === "interrupt") {
      controls.interrupt();
      return toast(CONFIRM.interrupt());
    }
    if (action === "captions") return toast(CONFIRM.captions(!root.classList.toggle("captions-off")));
  }

  // Keys first, before voice mode's own (Esc must not close voice mode)
  function onKey(e) {
    if (!on) return;
    const action = keyAction(e);
    if (!action) return;
    e.preventDefault(); // F5 would reload, Space would scroll
    e.stopImmediatePropagation();
    act(action);
  }

  function onFullscreen() {
    if (on && !document.fullscreenElement) exit();
  }

  function enter() {
    if (on) return;
    on = true;
    phase = "setup";
    const f = settings();
    root.classList.add("filming");
    root.classList.toggle("big-captions", Boolean(f.largeCaptions));
    root.classList.remove("captions-off");
    overlay.hidden = false;
    overlay.classList.add("guide");
    setup.hidden = false;
    countdown.hidden = true;
    delayNote.textContent = f.delay ? `It starts ${f.delay} seconds after you press start.` : "It starts as soon as you press start.";
    root.requestFullscreen?.().catch(() => {});
    keepAwake();
    showCursor();
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("fullscreenchange", onFullscreen);
    root.addEventListener("mousemove", showCursor);
    controls.onEnter();
    // The conversation waits for the countdown
    if (controls.running()) controls.pause();
    startButton.focus({ preventScroll: true });
  }

  // resume: false when voice mode itself is closing
  function exit({ resume = true } = {}) {
    if (!on) return;
    on = false;
    const wasRunning = phase === "running" || phase === "counting";
    phase = "off";
    clearInterval(countTimer);
    clearTimeout(cursorTimer);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("fullscreenchange", onFullscreen);
    root.removeEventListener("mousemove", showCursor);
    root.classList.remove("filming", "hide-cursor", "big-captions", "captions-off");
    overlay.hidden = true;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
    controls.onExit();
    // Back to a normal conversation
    if (resume && (!wasRunning || !controls.running())) controls.resume();
  }

  startButton.addEventListener("click", () => act("startStop"));
  root.querySelector("#filming-exit").addEventListener("click", () => exit());

  return {
    enter,
    exit,
    get on() {
      return on;
    },
    isFilmingKey,
  };
}
