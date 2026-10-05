// ---------- Theme and chat font ----------
import { onSettings, updateSettings, flushSettings } from "./store.js";
import { setLanguage, getLanguage } from "./i18n.js";

const root = document.documentElement;
const appearance = document.getElementById("appearance");
const accentColors = document.getElementById("accent-colors");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const languageSelect = document.getElementById("language-select");

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
  // Private mode: the page hides what needs the internet (see style.css)
  root.dataset.private = s.privacy?.localOnly === true ? "true" : "false";
  current = s.theme.appearance;
  applyTheme();
  root.style.setProperty("--accent", s.theme.accent);
  root.style.setProperty("--chat-font", FONTS[s.font.family] || FONTS.default);
  root.style.setProperty("--chat-size", `${s.font.size}px`);
  root.dataset.chatStyle = s.chat.style;
  root.dataset.chatDensity = s.chat.density;

  appearance.querySelectorAll(".choice").forEach((c) => {
    const on = c.dataset.appearance === current;
    c.classList.toggle("selected", on);
    c.setAttribute("aria-checked", String(on));
  });
  accentColors.querySelectorAll(".color").forEach((c) => {
    const on = c.dataset.color === s.theme.accent;
    c.classList.toggle("selected", on);
    c.setAttribute("aria-checked", String(on));
  });
  languageSelect.value = s.ui?.language || "auto";
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

// The interface language: saved, then the page starts again in it
languageSelect.value = getLanguage().setting;
languageSelect.addEventListener("change", async () => {
  const choice = languageSelect.value;
  updateSettings((s) => ((s.ui ||= {}).language = choice));
  await flushSettings();
  setLanguage(choice);
});
