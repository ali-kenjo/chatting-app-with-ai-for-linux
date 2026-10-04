// ---------- Layout: sidebar, greeting ----------
import { getSettings, onSettings } from "./store.js";
const app = document.querySelector(".app");
const narrow = window.matchMedia("(max-width: 760px)");

// On a computer the sidebar can be hidden (remembered); on a phone it slides in over the page
function setSidebar(open) {
  if (narrow.matches) {
    app.classList.toggle("sidebar-open", open);
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
  if (narrow.matches && e.target.closest(".chat-link, #new-chat, #search-open, #voice-open")) setSidebar(false);
});
narrow.addEventListener("change", () => app.classList.remove("sidebar-open"));

// "Chats" folds the chat list in and out
const chatsNav = document.getElementById("chats-nav");
chatsNav.addEventListener("click", (e) => {
  e.preventDefault();
  const folded = document.getElementById("chat-history").classList.toggle("folded");
  chatsNav.classList.toggle("active", !folded);
});

// A greeting that fits the time of day, with your name from Settings → Characters
function greet() {
  const s = getSettings();
  const name = s?.personality.userName?.trim();
  const hour = new Date().getHours();
  const part = hour < 5 ? "Hello" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const el = document.getElementById("greeting");
  el.textContent = name ? `${part}, ${name}` : part;
  // Who's here to talk
  const who = s?.characters?.list.find((c) => c.id === s.characters.active);
  el.title = who ? `${who.name}: ${who.tagline}` : "";
}
greet();
onSettings(greet);
setInterval(greet, 10 * 60 * 1000);
