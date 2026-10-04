// Interface language: English, German and Arabic, with no library.
//
// English is the source text. t("Open settings") returns it as it is, or its translation from
// js/i18n/<language>.js (a catalog: { "English text": "translation" }). A missing translation
// falls back to the English, so nothing is ever blank. test/i18n.test.js makes sure the catalogs
// are complete.
//
// The static page (index.html) is translated once when it loads: every text, title, placeholder,
// aria-label and alt in it is looked up by its English text. An element whose text holds markup
// (a link inside a sentence) carries data-i18n-html, and its whole inner HTML is the key.
// data-no-i18n keeps a part of the page (your chats, your notes) as it is.
//
// Changing the language reloads the page, so every piece of the interface starts again in it.

export const LANGUAGES = {
  en: { name: "English", dir: "ltr", locale: "en" },
  de: { name: "Deutsch", dir: "ltr", locale: "de" },
  // Latin digits (0-9) in Arabic text: they read the same everywhere and match code and numbers in chats
  ar: { name: "العربية", dir: "rtl", locale: "ar-u-nu-latn" },
};

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

// The first language the browser lists that the interface has
export function detectLanguage(preferred = globalThis.navigator?.languages || []) {
  for (const tag of preferred) {
    const primary = String(tag).toLowerCase().split("-")[0];
    if (LANGUAGES[primary]) return primary;
  }
  return "en";
}

// "auto" (follow the browser), or one of the languages
export function resolveLanguage(setting, preferred) {
  return LANGUAGES[setting] ? setting : detectLanguage(preferred);
}

let setting = store.get() || "auto";
let lang = resolveLanguage(setting);
let catalog = {};
if (lang !== "en") {
  try {
    catalog = (await import(`./i18n/${lang}.js`)).default;
  } catch (err) {
    console.warn(`Couldn't load the ${lang} translations:`, err.message);
    lang = "en";
  }
}

const root = document.documentElement;
root.lang = lang;
root.dir = LANGUAGES[lang].dir;

export const getLanguage = () => ({ setting, language: lang, dir: LANGUAGES[lang].dir, locale: LANGUAGES[lang].locale });
export const isRtl = () => LANGUAGES[lang].dir === "rtl";

const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text);

// t("Hello, {name}", { name }) → the text in the interface language
export function t(text, params) {
  return fill(catalog[text] ?? text, params);
}

// tp("{n} task", "{n} tasks", n): the form for the number n. Catalogs hold an array with one
// text per plural category of the language (Intl.PluralRules order: zero, one, two, few, many, other).
const CATEGORIES = { en: ["one", "other"], de: ["one", "other"], ar: ["zero", "one", "two", "few", "many", "other"] };
export function tp(one, other, n, params) {
  const forms = catalog[`${one}|${other}`];
  let text = n === 1 ? one : other;
  if (Array.isArray(forms)) {
    const category = new Intl.PluralRules(LANGUAGES[lang].locale).select(n);
    text = forms[CATEGORIES[lang].indexOf(category)] ?? forms[forms.length - 1];
  }
  return fill(text, { n: nf(n), ...params });
}
export const pluralCategories = (language) => CATEGORIES[language];

// Numbers, dates and times in the interface language
const { locale } = LANGUAGES[lang];
export const nf = (n, options) => new Intl.NumberFormat(locale, options).format(n);
export const formatDate = (date, options = { dateStyle: "medium" }) => new Intl.DateTimeFormat(locale, options).format(date);
export const formatTime = (date, options = { hour: "2-digit", minute: "2-digit" }) => new Intl.DateTimeFormat(locale, options).format(date);
export const formatDateTime = (date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
export const compare = new Intl.Collator(locale).compare;

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
    if (SKIP.has(el.tagName.toUpperCase())) return;
    if (el.hasAttribute("data-i18n-html")) {
      const found = catalog[normalize(el.innerHTML)];
      if (found) el.innerHTML = found;
      return;
    }
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
  if (resolveLanguage(saved) !== lang) location.reload();
  else setting = saved;
}
