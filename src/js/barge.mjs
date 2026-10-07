// How easily your voice cuts the AI off (Settings → Voice → Interrupting by voice).
// While the AI talks, the mic hears it too. Your voice only counts as cutting in when
// it is louder than the AI's own echo by a margin, and lasts a moment.
//   learn   how long at the start of its speech the echo is only measured
//   hold    how long you must stay that loud before it stops
//   floor   the lowest level that can ever cut in
//   factor  how many times louder than the echo you must be
// "live" is for Gemini Live (levels of the mic worklet, in seconds); "classic" for Studio and
// Instant (levels of the mic analyser, in milliseconds).
export const BARGE = {
  easy: { live: { learn: 0.3, hold: 0.15, floor: 0.02, factor: 1.8 }, classic: { learn: 400, hold: 200, floor: 0.04, factor: 1.8 } },
  normal: { live: { learn: 0.4, hold: 0.2, floor: 0.03, factor: 2.2 }, classic: { learn: 500, hold: 280, floor: 0.05, factor: 2.2 } },
  hard: { live: { learn: 0.8, hold: 0.4, floor: 0.05, factor: 3.5 }, classic: { learn: 900, hold: 450, floor: 0.09, factor: 3.5 } },
};

export const bargeProfile = (sensitivity, engine = "live") => (BARGE[sensitivity] || BARGE.normal)[engine];

// How long the quiet that ends your turn is in Studio and Instant (Live: server/voice-style.js)
export const END_SILENCE_MS = { listener: 2200, balanced: 1100, chatty: 650 };
export const endSilence = (style) => END_SILENCE_MS[style] || END_SILENCE_MS.balanced;

// The key that cuts the AI off: a KeyboardEvent.code. Keys voice mode already uses are never offered.
export const RESERVED_KEYS = ["Escape", "KeyM", "KeyF", "Enter", "NumpadEnter", "Tab"];

// "Space bar", "X", "5", "ArrowUp": what to show for a key code (spaceName: the translated "Space bar")
export function keyLabel(code, spaceName = "Space bar") {
  if (!code) return "";
  if (code === "Space") return spaceName;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/^Numpad/, "Num ");
}
