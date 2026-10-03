import { closeSettings } from "./settings.js";
import { openVoice, closeVoice, isVoiceOpen } from "./voice.js";
import { closeSearch } from "./chats.js";
import "./store.js";
import "./appearance.js";
import "./layout.js";
import "./brains.js";
import "./permissions.js";
import "./memory.js";
import "./personality.js";
import "./composer.js";
import "./chat.js";
import "./auth.js";
import "./workspace.js";
import "./robot/settings-pane.js";

// Check if launched with ?voice=true or ?voice=1
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get("voice") === "true" || params.get("voice") === "1") {
    setTimeout(() => openVoice(), 250);
  }
} catch (e) {
  console.warn("Auto-voice launch check:", e);
}

// Escape closes whatever is open on top
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeSettings();
  closeSearch();
  if (isVoiceOpen()) closeVoice();
});
