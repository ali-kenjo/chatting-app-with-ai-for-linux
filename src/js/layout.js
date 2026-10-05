// ---------- Layout: sidebar, greeting ----------
import { getSettings, onSettings } from "./store.js";
import { t } from "./i18n.js";
import { announce } from "./a11y.js";
const app = document.querySelector(".app");
const narrow = window.matchMedia("(max-width: 760px)");

// On a computer the sidebar can be hidden (remembered); on a phone it slides in over the page
function setSidebar(open) {
  const sidebar = document.getElementById("sidebar");
  if (narrow.matches) {
    app.classList.toggle("sidebar-open", open);
    // Off screen means off the tab order too; opening moves focus in, closing brings it back to the button
    sidebar.inert = !open;
    if (open) sidebar.querySelector("#new-chat")?.focus();
    else if (sidebar.contains(document.activeElement)) document.getElementById("sidebar-open").focus();
  } else {
    app.classList.toggle("sidebar-hidden", !open);
    try {
      localStorage.setItem("friends.sidebar", open ? "shown" : "hidden");
    } catch {}
  }
}

try {
  if (localStorage.getItem("friends.sidebar") === "hidden") app.classList.add("sidebar-hidden");
} catch {}

document.getElementById("sidebar-toggle").addEventListener("click", () => setSidebar(false));
document.getElementById("sidebar-open").addEventListener("click", () => setSidebar(true));
document.getElementById("sidebar-backdrop").addEventListener("click", () => setSidebar(false));

// On a phone, close the sidebar after picking something in it
document.querySelector(".sidebar").addEventListener("click", (e) => {
  if (narrow.matches && e.target.closest(".chat-link, #new-chat, #search-open, #voice-open, #today-open, #settings-btn, #shortcuts-btn")) setSidebar(false);
});
narrow.addEventListener("change", () => {
  app.classList.remove("sidebar-open");
  document.getElementById("sidebar").inert = narrow.matches;
});
document.getElementById("sidebar").inert = narrow.matches;
// Esc closes the sidebar that slid in over the page
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && narrow.matches && app.classList.contains("sidebar-open") && !document.querySelector(".modal-backdrop:not([hidden]), .search-backdrop:not([hidden])")) setSidebar(false);
});

// "Chats" folds the chat list in and out
const chatsNav = document.getElementById("chats-nav");
chatsNav.addEventListener("click", (e) => {
  e.preventDefault();
  const folded = document.getElementById("chat-history").classList.toggle("folded");
  chatsNav.classList.toggle("active", !folded);
  chatsNav.setAttribute("aria-expanded", String(!folded));
  announce(folded ? t("Chats hidden") : t("Chats shown"));
});

// A greeting that fits the time of day, with your name from Settings → Characters
function greet() {
  const s = getSettings();
  const name = s?.personality.userName?.trim();
  const hour = new Date().getHours();
  const part = hour < 5 ? t("Hello") : hour < 12 ? t("Good morning") : hour < 18 ? t("Good afternoon") : t("Good evening");
  const el = document.getElementById("greeting");
  el.textContent = name ? t("{greeting}, {name}", { greeting: part, name }) : part;
  // Who's here to talk
  const who = s?.characters?.list.find((c) => c.id === s.characters.active);
  el.title = who ? `${who.name}: ${who.tagline}` : "";
}
greet();
onSettings(greet);
setInterval(greet, 10 * 60 * 1000);
