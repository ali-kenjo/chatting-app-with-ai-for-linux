// The voice screen's elements, and the little things every voice module needs
export const voiceMode = document.getElementById("voice-mode");
export const voiceStatus = document.getElementById("voice-status");
export const voiceMute = document.getElementById("voice-mute");
export const canvas = document.getElementById("voice-waves");

export const BACKGROUND = "#131314"; // painted on the canvas, so recordings match the screen

// localStorage that never throws (private windows, blocked storage)
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

export const isMuted = () => voiceMode.classList.contains("muted");
