// ---------- Theme and chat font ----------
import { onSettings, updateSettings } from "./store.js";

const root = document.documentElement;
const appearance = document.getElementById("appearance");
const accentColors = document.getElementById("accent-colors");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

const FONTS = {
  default: "inherit",
  sans: 'system-ui, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

let current = "dark";

function applyTheme() {
  const light = current === "light" || (current === "system" && !systemDark.matches);
  root.dataset.theme = light ? "light" : "dark";
}

onSettings((s) => {
  current = s.theme.appearance;
  applyTheme();
  root.style.setProperty("--accent", s.theme.accent);
  root.style.setProperty("--chat-font", FONTS[s.font.family] || FONTS.default);
  root.style.setProperty("--chat-size", `${s.font.size}px`);
  root.dataset.chatStyle = s.chat.style;
  root.dataset.chatDensity = s.chat.density;

  appearance.querySelectorAll(".choice").forEach((c) => c.classList.toggle("selected", c.dataset.appearance === current));
  accentColors.querySelectorAll(".color").forEach((c) => c.classList.toggle("selected", c.dataset.color === s.theme.accent));
});

// "System" follows your desktop's light/dark setting, live
systemDark.addEventListener("change", applyTheme);

appearance.addEventListener("click", (e) => {
  const choice = e.target.closest("[data-appearance]");
  if (choice) updateSettings((s) => (s.theme.appearance = choice.dataset.appearance));
});

accentColors.addEventListener("click", (e) => {
  const color = e.target.closest("[data-color]");
  if (color) updateSettings((s) => (s.theme.accent = color.dataset.color));
});
