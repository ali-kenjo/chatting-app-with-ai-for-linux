import "./i18n.js";
import "./a11y.js";
import { closeSettings } from "./settings.js";
import { openVoice, closeVoice, isVoiceOpen } from "./voice/index.js";
import { closeSearch } from "./chats.js";
import "./store.js";
import "./appearance.js";
import "./layout.js";
import "./brains.js";
import "./permissions.js";
import "./memory.js";
import "./personality.js";
import "./characters.js";
import "./activities.js";
import "./episodes.js";
import "./life.js";
import "./apps.js";
import "./composer.js";
import "./onboarding.js";
import "./chat.js";
import "./shortcuts.js";
import "./auth.js";
import "./workspace.js";
import "./data.js";
import "./robot/settings-pane.js";
import "./voice-settings.js";

// Check if launched with ?voice=true or ?voice=1
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get("voice") === "true" || params.get("voice") === "1") {
    setTimeout(() => openVoice(), 250);
  }
} catch (e) {
  console.warn("Auto-voice launch check:", e);
}

// The tray's "Voice conversation" (the address #voice)
document.addEventListener("friends:open-voice", () => openVoice());

// Escape closes whatever is open on top
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeSettings();
  closeSearch();
  if (isVoiceOpen()) closeVoice();
});
