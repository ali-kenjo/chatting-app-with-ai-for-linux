// Captions: on screen (under the status), and drawn into recorded videos when wanted
import { t } from "../i18n.js";

const voiceCaption = document.getElementById("voice-caption");

let line = { user: false, text: "", at: 0 }; // what the canvas draws
let shown = { who: "", text: "" }; // what the page shows

// Words fade in as they arrive; a line that only grows (streaming) adds just the new words
function appendWords(el, text, stagger) {
  const parts = text.match(/\S+\s*|\s+/g) || [];
  parts.forEach((part, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = part;
    if (stagger) span.style.animationDelay = `${Math.min(i * 22, 380)}ms`;
    el.append(span);
  });
}

export const captions = {
  // On the page only
  set(who, text) {
    if (!text) {
      voiceCaption.innerHTML = "";
      shown = { who: "", text: "" };
      return;
    }
    const isUser = who === "You";
    const body = voiceCaption.querySelector(".caption-text");
    if (body && shown.who === who && text.startsWith(shown.text)) {
      appendWords(body, text.slice(shown.text.length), false);
    } else {
      voiceCaption.innerHTML = `
    <span class="caption-tag ${isUser ? "user" : "companion"}"></span>
    <span class="caption-text"></span>
  `;
      voiceCaption.querySelector(".caption-tag").textContent = isUser ? t("You") : who;
      appendWords(voiceCaption.querySelector(".caption-text"), text, true);
    }
    shown = { who, text };
  },

  // On the page and in the video
  show(who, text, isUser) {
    captions.set(who, text);
    line = { user: isUser, text, at: performance.now() };
  },

  clear() {
    captions.set("", "");
  },

  // Voice mode opened: nothing said yet
  reset() {
    captions.clear();
    line = { user: false, text: "", at: 0 };
  },

  // The last two lines of what's being said, drawn into the picture
  draw(ctx, w, h) {
    const { text, user, at } = line;
    if (!text) return;
    const age = performance.now() - at;
    const fade = age < 4000 ? 1 : Math.max(0, 1 - (age - 4000) / 600);
    if (!fade) return;

    const portrait = h > w;
    const size = Math.round(Math.min(w, h) * (portrait ? 0.05 : 0.042));
    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = w * (portrait ? 0.86 : 0.72);

    const lines = [];
    let current = "";
    for (const word of text.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    const last = lines.slice(-2);

    const lineHeight = size * 1.35;
    let y = h * (portrait ? 0.8 : 0.84) - ((last.length - 1) * lineHeight) / 2;
    for (const text of last) {
      const width = ctx.measureText(text).width + size * 1.1;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * fade})`;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(w / 2 - width / 2, y - lineHeight / 2, width, lineHeight, size * 0.3);
      else ctx.rect(w / 2 - width / 2, y - lineHeight / 2, width, lineHeight);
      ctx.fill();
      ctx.fillStyle = user ? `rgba(255, 236, 214, ${0.8 * fade})` : `rgba(255, 255, 255, ${fade})`;
      ctx.fillText(text, w / 2, y);
      y += lineHeight;
    }
  },
};
