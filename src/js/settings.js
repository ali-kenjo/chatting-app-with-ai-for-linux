// Settings panel: open / close / switch sections, find a setting, and say when changes are saved.
// "friends:settings" tells others whether it's open and which section shows (the Robot section's
// preview draws only then).
import { t } from "./i18n.js";
import { retrySave } from "./store.js";

const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const settingsClose = document.getElementById("settings-close");
const tablist = document.getElementById("settings-tabs");

// The font and theme sections became one
const ALIASES = { font: "appearance", theme: "appearance" };
const tabs = () => [...tablist.querySelectorAll(".tab")];

function announce() {
  const tab = tablist.querySelector(".tab.active")?.dataset.tab || null;
  document.dispatchEvent(new CustomEvent("friends:settings", { detail: { open: !settingsModal.hidden, tab } }));
}

// tab: a section name; section: the id of something in it to scroll to (a <details> there opens)
export function openSettings(tab, { section } = {}) {
  if (tab) switchTab(tab);
  settingsModal.hidden = false;
  announce();
  if (section) jumpTo(document.getElementById(section));
}

export function closeSettings() {
  if (settingsModal.hidden) return;
  settingsModal.hidden = true;
  clearSearch();
  announce();
}

function switchTab(name, { focus = false } = {}) {
  name = ALIASES[name] || name;
  for (const tab of tabs()) {
    const on = tab.dataset.tab === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  document.querySelectorAll(".modal-body .pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === name));
  document.querySelector(".modal-body")?.scrollTo(0, 0);
  if (!settingsModal.hidden) announce();
}

settingsBtn.addEventListener("click", () => openSettings());
settingsClose.addEventListener("click", closeSettings);

// Close when clicking outside the panel
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});

tablist.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) switchTab(tab.dataset.tab);
});

// Arrow keys move between sections (Home and End jump to the first and last)
tablist.addEventListener("keydown", (e) => {
  const all = tabs();
  const at = all.indexOf(document.activeElement);
  if (at < 0) return;
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const target = all[(next + all.length) % all.length];
  switchTab(target.dataset.tab, { focus: true });
});

// Links inside the panel that lead to another section: <a data-open-tab="ai-control" data-open-section="permissions-section">
settingsModal.addEventListener("click", (e) => {
  const link = e.target.closest("[data-open-tab]");
  if (!link) return;
  e.preventDefault();
  openSettings(link.dataset.openTab, { section: link.dataset.openSection });
});

// ----- Find a setting -----
const searchInput = document.getElementById("settings-search");
const results = document.getElementById("settings-results");
let index = null;
let shown = [];
let active = -1;

// Everything with a title: sections, rows, folded parts. Built when first needed, in the language of the page.
function buildIndex() {
  const entries = [];
  const panes = new Map(tabs().map((tab) => [tab.dataset.tab, tab.textContent.trim()]));
  for (const el of document.querySelectorAll(".modal-body .pane :is(.row-label, .subhead-title, summary, .choice-title)")) {
    const pane = el.closest(".pane").dataset.pane;
    const label = el.textContent.trim().replace(/\s+/g, " ");
    if (!label || label.length > 80) continue;
    const box = el.closest(".row, .form-field, .subhead, details") || el.parentElement;
    const hint = box.querySelector(".row-desc, .hint")?.textContent.trim().replace(/\s+/g, " ") || "";
    entries.push({ el, pane, paneName: panes.get(pane), label, haystack: `${label} ${hint}`.toLowerCase() });
  }
  return entries;
}

function search(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  index ||= buildIndex();
  return index
    .filter((e) => !e.el.closest("[hidden]") && words.every((w) => e.haystack.includes(w)))
    .sort((a, b) => Number(b.label.toLowerCase().includes(words[0])) - Number(a.label.toLowerCase().includes(words[0])))
    .slice(0, 8);
}

function render() {
  results.replaceChildren();
  results.setAttribute("role", shown.length ? "listbox" : "list");
  if (!searchInput.value.trim()) {
    results.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    return;
  }
  results.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  if (!shown.length) {
    const none = document.createElement("li");
    none.className = "settings-result none";
    none.textContent = t("No setting matches that.");
    results.append(none);
    return;
  }
  shown.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "settings-result";
    li.id = `settings-result-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));
    li.innerHTML = "<strong></strong><span></span>";
    li.firstChild.textContent = entry.label;
    li.lastChild.textContent = entry.paneName;
    li.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the box
    li.addEventListener("click", () => pick(i));
    results.append(li);
  });
  if (active >= 0) searchInput.setAttribute("aria-activedescendant", `settings-result-${active}`);
  else searchInput.removeAttribute("aria-activedescendant");
}

function clearSearch() {
  searchInput.value = "";
  shown = [];
  active = -1;
  render();
}

function jumpTo(el) {
  if (!el) return;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
  el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const box = el.closest(".row, .form-field, .subhead, details") || el;
  box.classList.add("flash");
  setTimeout(() => box.classList.remove("flash"), 1800);
  (box.querySelector("input, select, textarea, button, summary") || el).focus?.({ preventScroll: true });
}

function pick(i) {
  const entry = shown[i];
  if (!entry) return;
  clearSearch();
  switchTab(entry.pane);
  jumpTo(entry.el);
}

searchInput.addEventListener("input", () => {
  shown = search(searchInput.value);
  active = shown.length ? 0 : -1;
  render();
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!shown.length) return;
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
    render();
  } else if (e.key === "Enter") {
    e.preventDefault();
    pick(Math.max(active, 0));
  } else if (e.key === "Escape" && searchInput.value) {
    e.stopPropagation(); // the first Escape clears the search, the next one closes Settings
    clearSearch();
  }
});
document.addEventListener("friends:language-ready", () => (index = null));

// ----- "Saved" -----
const saved = document.getElementById("settings-saved");
let savedTimer = null;
function say(text, { retry = false } = {}) {
  clearTimeout(savedTimer);
  saved.replaceChildren(text);
  saved.classList.toggle("error", retry);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-btn";
    button.textContent = t("Try again");
    button.addEventListener("click", retrySave);
    saved.append(" ", button);
  } else if (text) {
    savedTimer = setTimeout(() => saved.replaceChildren(), 2500);
  }
}
document.addEventListener("friends:saving", () => say(t("Saving…")));
document.addEventListener("friends:saved", () => say(t("All changes saved")));
document.addEventListener("friends:save-failed", () => say(t("Couldn't save your changes."), { retry: true }));

// Screen readers: controls that sit next to their title (not inside a <label>)
// get that title as their name
function nameControls() {
  for (const el of settingsModal.querySelectorAll("input, select, textarea")) {
    if (el.type === "hidden" || el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) continue;
    let text = "";
    for (let node = el, hops = 0; node && node !== settingsModal && hops < 4 && !text; node = node.parentElement, hops++) {
      for (let prev = node.previousElementSibling; prev && !text; prev = prev.previousElementSibling) {
        text = (prev.matches(".row-label") ? prev : prev.querySelector(".row-label"))?.textContent.trim() || "";
      }
      if (!text && node.parentElement?.matches(".row")) text = node.parentElement.querySelector(".row-label")?.textContent.trim() || "";
    }
    if (text) el.setAttribute("aria-label", text);
  }
}
nameControls();
