// Interface language: English, German and Arabic, with no library.
//
// English is the source text. t("Open settings") returns it as it is, or its translation from
// js/i18n/<language>.js (a catalog: { "English text": "translation" }). A missing translation
// falls back to the English, so nothing is ever blank. test/i18n.test.js makes sure the catalogs
// are complete. (The pure part, no page needed, is in i18n-core.mjs.)
//
// The static page (index.html) is translated once when it loads: every text, title, placeholder,
// aria-label and alt in it is looked up by its English text. An element whose text holds markup
// (a link inside a sentence) carries data-i18n-html="some.key": its translation is the catalog's
// "@some.key", whole inner HTML included (the English stays in the page).
// data-no-i18n keeps a part of the page (your chats, your notes) as it is.
//
// Changing the language reloads the page, so every piece of the interface starts again in it.
import { LANGUAGES, createTranslator, detectLanguage, resolveLanguage } from "./i18n-core.mjs";

export { LANGUAGES, detectLanguage, resolveLanguage };

const KEY = "friends.language";

const store = {
  get() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch {}
  },
};

let setting = store.get() || "auto";
let lang = resolveLanguage(setting, globalThis.navigator?.languages);
let catalog = {};
if (lang !== "en") {
  try {
    catalog = (await import(`./i18n/${lang}.js`)).default;
  } catch (err) {
    console.warn(`Couldn't load the ${lang} translations:`, err.message);
    lang = "en";
  }
}

const translator = createTranslator(lang, catalog);
export const { t, tp, nf, formatDate, formatTime, formatDateTime } = translator;
export const compare = new Intl.Collator(translator.locale).compare;

const root = document.documentElement;
root.lang = lang;
root.dir = LANGUAGES[lang].dir;

export const getLanguage = () => ({ setting, language: lang, dir: LANGUAGES[lang].dir, locale: translator.locale });
export const isRtl = () => LANGUAGES[lang].dir === "rtl";

// ----- The static page -----
const KEYED = ["title", "placeholder", "aria-label", "alt"];
const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "KBD", "SVG", "TEXTAREA"]); // their text isn't translated (their attributes are)
const normalize = (text) => text.replace(/\s+/g, " ").trim();

function translateText(node) {
  const raw = node.nodeValue;
  const key = normalize(raw);
  if (!key) return;
  const found = catalog[key];
  if (found === undefined) return;
  node.nodeValue = raw.match(/^\s*/)[0] + found + raw.match(/\s*$/)[0];
}

export function translateTree(start = document.body) {
  if (lang === "en") return;
  const walk = (el) => {
    if (el.hasAttribute("data-no-i18n")) return;
    for (const name of KEYED) {
      const value = el.getAttribute(name);
      const found = value && catalog[normalize(value)];
      if (found) el.setAttribute(name, found);
    }
    if (el.hasAttribute("data-i18n-html")) {
      const found = translator.html(el.getAttribute("data-i18n-html"));
      if (found) el.innerHTML = found;
      return;
    }
    if (SKIP.has(el.tagName.toUpperCase())) return;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) translateText(child);
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
    }
  };
  walk(start);
}

translateTree(document.body);
if (lang !== "en") {
  const title = catalog[document.title];
  if (title) document.title = title;
  const description = document.querySelector('meta[name="description"]');
  if (description && catalog[description.content]) description.content = catalog[description.content];
}

// Settings → Appearance → Language: "auto", "en", "de" or "ar". Reloads when it changes how the page reads.
export function setLanguage(next) {
  if (next === setting) return;
  store.set(next);
  location.reload();
}

// The language saved in the helper's settings: if it differs from the one the page started with
// (a new browser, a restored backup), follow it
export function followSetting(saved) {
  if (!saved || saved === setting) return;
  store.set(saved);
  if (resolveLanguage(saved, globalThis.navigator?.languages) !== lang) location.reload();
  else setting = saved;
}
