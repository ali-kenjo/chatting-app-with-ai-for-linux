// The buttons and pop-ups around the picture: scene settings, the calm screen,
// the microphone banner, typing, hide-everything, style bar, fullscreen,
// on-air and things to do. Pure screen wiring: what the buttons do to the
// conversation is handed in as `actions`.
import { t } from "../i18n.js";
import { isOnAir, onOnAir, toggleOnAir } from "../onair.js";
import { activityPrompt } from "../activities.js";
import { getSettings } from "../store.js";
import { canvas, store, voiceMode, voiceMute, voiceStatus } from "./dom.js";
import { recording } from "./recording.js";
import { isRobotStyle, setVoiceTheme } from "./stage.js";
import { status } from "./status.js";

const $ = (id) => document.getElementById(id);

// actions: { ask(text), retryMic(), statusClicked(), toggleMute(), interrupt(), isFilming() }
export function initControls(actions) {
  // ---------- The robot's scene settings, without leaving voice mode ----------
  const sceneButton = $("voice-scene");
  const scenePop = $("voice-scene-pop");

  function closeScenePop() {
    scenePop.hidden = true;
    sceneButton.classList.remove("active");
    sceneButton.setAttribute("aria-expanded", "false");
  }

  sceneButton.addEventListener("click", () => {
    const open = scenePop.hidden;
    recording.closePop();
    scenePop.hidden = !open;
    sceneButton.classList.toggle("active", open);
    sceneButton.setAttribute("aria-expanded", String(open));
  });

  // ---------- Things to do ----------
  const activitiesButton = $("voice-activities-btn");
  const activitiesPop = $("voice-activities");

  function closeActivities() {
    activitiesPop.hidden = true;
    activitiesButton.setAttribute("aria-expanded", "false");
  }

  activitiesButton.addEventListener("click", () => {
    const open = activitiesPop.hidden;
    recording.closePop();
    closeScenePop();
    activitiesPop.hidden = !open;
    activitiesButton.setAttribute("aria-expanded", String(open));
  });
  activitiesPop.addEventListener("click", (e) => {
    const prompt = activityPrompt(e.target.closest(".activity-chip")?.dataset.id);
    if (!prompt) return;
    closeActivities();
    actions.ask(prompt);
  });

  // ---------- On air (co-host mode) ----------
  const onAirButton = $("voice-onair");
  function syncOnAir(on = isOnAir()) {
    onAirButton.classList.toggle("on", on);
    onAirButton.setAttribute("aria-pressed", String(on));
    voiceMode.classList.toggle("on-air", on);
  }
  onAirButton.addEventListener("click", () => {
    toggleOnAir();
    status.note(isOnAir() ? t("On air: co-host mode, nothing private.") : t("Off air."), 2500);
  });
  onOnAir(syncOnAir);
  syncOnAir();

  // ---------- Typing instead of talking ----------
  const typeButton = $("voice-keyboard-btn");
  const typeForm = $("voice-type-form");
  const typeInput = $("voice-type-input");
  const typing = () => Boolean(typeForm && !typeForm.hidden);

  typeButton?.addEventListener("click", () => {
    if (!typeForm) return;
    typeForm.hidden = !typeForm.hidden;
    if (!typeForm.hidden) typeInput?.focus();
  });
  typeForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = typeInput?.value?.trim();
    if (val) {
      typeInput.value = "";
      typeForm.hidden = true;
      actions.ask(val);
    }
  });

  // ---------- The microphone banner ----------
  const banner = $("voice-perm-banner");

  function showPermBanner(canRetry, text) {
    if (!banner) return;
    banner.hidden = false;
    $("voice-perm-title").textContent = t("Microphone access needed");
    $("voice-perm-text").textContent =
      text || t("Click the lock 🔒 or site settings icon in your browser address bar, set Microphone to “Allow”, then press Try again.");
    $("voice-perm-retry-btn").hidden = !canRetry;
  }

  function hidePermBanner() {
    if (banner) banner.hidden = true;
  }

  $("voice-perm-retry-btn")?.addEventListener("click", () => actions.retryMic());
  $("voice-perm-type-btn")?.addEventListener("click", () => {
    hidePermBanner();
    if (typeForm) {
      typeForm.hidden = false;
      typeInput?.focus();
    }
  });
  // Clicking on status allows retrying microphone connection
  voiceStatus?.addEventListener("click", () => actions.statusClicked());

  // ---------- Calm screen ----------
  // In the Robot style the buttons fade away after a few quiet seconds, leaving
  // the robot and its room; any movement or key brings them back. They stay
  // while something needs you (an error, a menu, the side panel, a hovered button).
  const voiceTop = voiceMode.querySelector(".voice-top");
  const voiceControls = voiceMode.querySelector(".voice-controls");
  let calmTimer = 0;

  function calmAllowed() {
    if (!isRobotStyle() || voiceMode.hidden || actions.isFilming()) return false;
    if (status.state === "error" || status.state === "standby") return false;
    if (!banner.hidden || !scenePop.hidden || recording.popOpen) return false;
    if (!$("voice-drawer").hidden || typing()) return false;
    return !voiceTop.matches(":hover, :focus-within") && !voiceControls.matches(":hover, :focus-within");
  }

  function wake() {
    voiceMode.classList.remove("calm");
    clearTimeout(calmTimer);
    if (isRobotStyle() && !voiceMode.hidden) {
      calmTimer = setTimeout(() => calmAllowed() && voiceMode.classList.add("calm"), 5000);
    }
  }
  for (const type of ["pointermove", "pointerdown", "touchstart"]) voiceMode.addEventListener(type, wake, { passive: true });
  document.addEventListener("keydown", wake);

  // Shown once: how to play with the robot
  function showHint() {
    const hint = $("voice-hint");
    if (store.get("friends.voiceHintSeen") || !isRobotStyle() || voiceMode.hidden) return;
    store.set("friends.voiceHintSeen", "1");
    hint.hidden = false;
    requestAnimationFrame(() => hint.classList.add("show"));
    setTimeout(() => {
      hint.classList.remove("show");
      setTimeout(() => (hint.hidden = true), 700);
    }, 7000);
  }

  // ---------- Hide everything but the picture; the same button brings it all back ----------
  const hideButton = $("voice-hide");
  hideButton?.addEventListener("click", () => {
    const hidden = voiceMode.classList.toggle("ui-hidden");
    hideButton.title = hidden ? t("Show everything") : t("Hide everything");
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.setAttribute("aria-pressed", String(hidden));
  });

  // ---------- The style bar, fullscreen, mute, interrupt ----------
  $("voice-theme-bar")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (btn) setVoiceTheme(btn.dataset.theme);
  });

  $("voice-fullscreen")?.addEventListener("click", () => {
    if (!document.fullscreenElement) voiceMode.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });

  voiceMute?.addEventListener("click", () => actions.toggleMute());

  // M mutes (not while typing)
  document.addEventListener("keydown", (e) => {
    if (voiceMode.hidden || actions.isFilming() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() !== "m" || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    actions.toggleMute();
  });

  // The interrupt key (Settings → Voice; Space unless you changed it): cuts it off while it talks.
  // Not while typing; Space on a focused button would also press the button, so its key-up is swallowed too.
  let interruptKeyDown = null;
  document.addEventListener("keydown", (e) => {
    const key = getSettings()?.voice?.interruptKey;
    if (!key || e.code !== key || voiceMode.hidden || actions.isFilming() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (status.state !== "speaking") return;
    e.preventDefault();
    interruptKeyDown = key;
    if (!e.repeat) actions.interrupt();
  });
  document.addEventListener("keyup", (e) => {
    if (interruptKeyDown !== e.code) return;
    interruptKeyDown = null;
    e.preventDefault();
  });

  // Tap anywhere on canvas to interrupt
  canvas?.addEventListener("click", () => {
    if (status.state === "speaking") actions.interrupt();
  });

  return {
    closeScenePop,
    closeActivities,
    showPermBanner,
    hidePermBanner,
    wake,
    closeTyping() {
      if (typeForm) typeForm.hidden = true;
    },
    // The robot appeared or went away
    onRobotSync(on) {
      if (!isRobotStyle()) closeScenePop();
      wake();
      if (on) setTimeout(showHint, 2500);
    },
  };
}
