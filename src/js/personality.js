// ---------- How the AI talks (shared helpers) ----------
// The characters themselves (name, voice, personality) are in characters.js.
import { t } from "./i18n.js";

// Speaking speed 0–10 → playback rate 0.75–1.25 (the pitch stays the same)
export function playbackRate(settings) {
  return 0.75 + settings.personality.speed * 0.05;
}

// Messages for voice errors that need explaining
export function voiceErrorText(message) {
  if (message === "NO_BRAIN") return t("Set up an AI first (Settings → AI & privacy).");
  if (message === "NO_TTS") return t("Your Gemini key has no speech model, so the voices can't be played.");
  return message;
}
