// ---------- Keys in filming mode ----------
// Presentation clickers are small keyboards: "next" sends PageDown (or an
// arrow key), "back" sends PageUp, "start/stop" sends F5 or Shift+F5, and
// "blank screen" sends B or a period. Pure module, so node:test checks it.
//
//   interrupt  cut the AI off            PageDown, →, ↓, I
//   mute       mute or unmute your mic   PageUp, ←, ↑, M
//   startStop  start or pause talking    F5, Shift+F5, S, Space, Enter
//   captions   captions on or off        B, period, C
//   exit       leave filming mode        Esc
export const KEY_ACTIONS = {
  PageDown: "interrupt",
  ArrowRight: "interrupt",
  ArrowDown: "interrupt",
  i: "interrupt",
  PageUp: "mute",
  ArrowLeft: "mute",
  ArrowUp: "mute",
  m: "mute",
  F5: "startStop",
  s: "startStop",
  " ": "startStop",
  Enter: "startStop",
  b: "captions",
  ".": "captions",
  c: "captions",
  Escape: "exit",
};

// e: a KeyboardEvent (or anything with key, shiftKey, ctrlKey, altKey,
// metaKey, repeat). Returns an action name, or null for keys it leaves alone.
export function keyAction(e) {
  if (!e || e.repeat) return null;
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key?.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey && key !== "F5") return null; // Shift+F5 is a clicker's "start"
  return KEY_ACTIONS[key] || null;
}

// The key that opens filming mode from voice mode (F, no modifiers)
export const isFilmingKey = (e) => Boolean(e) && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key?.toLowerCase() === "f";
