// Is what the microphone heard just the AI's own voice coming back?
//
// On speakers the mic picks up the AI as well. When that echo is taken as
// something you said, the AI answers itself and seems to repeat its words. The
// speech-to-text turns the echo into the AI's own sentences, so it can be told
// apart from you: nearly all of its words appear in the same order in what the
// AI said a moment ago. (Pure functions, no page needed: test/echo.test.js.)

const words = (text) => String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// The longest run of words that both lists share, in order (gaps allowed)
function sharedWords(a, b) {
  let prev = new Uint16Array(b.length + 1);
  let row = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    [prev, row] = [row, prev];
  }
  return prev[b.length];
}

// heard: what was transcribed from the mic; said: what the AI said lately.
// Short phrases ("yes", "I think so") are never called an echo: they may well be you.
export function isEcho(heard, said, { minWords = 4, ratio = 0.85, window = 400 } = {}) {
  const h = words(heard);
  if (h.length < minWords) return false;
  const s = words(said).slice(-window);
  if (s.length < minWords) return false;
  return sharedWords(h, s) / h.length >= ratio;
}

// The last few things the AI said, for isEcho()
export function createSpoken({ keep = 3 } = {}) {
  let list = [];
  return {
    add(text) {
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (clean) list = [...list, clean].slice(-keep);
    },
    // With `partial`: also what it's saying right now
    text: (partial = "") => [...list, partial].join(" ").trim(),
    clear() {
      list = [];
    },
  };
}
