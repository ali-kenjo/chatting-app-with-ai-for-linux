// The part of the interface translation that needs no page: which languages there are, how a
// language is chosen, and how a text, a plural, a number or a date turns into the language's.
// js/i18n.js adds the page to it (html lang and dir, the static text); node:test checks this file.

export const LANGUAGES = {
  en: { name: "English", dir: "ltr", locale: "en" },
  de: { name: "Deutsch", dir: "ltr", locale: "de" },
  // Latin digits (0-9) in Arabic text: they read the same everywhere and match code and numbers in chats
  ar: { name: "العربية", dir: "rtl", locale: "ar-u-nu-latn" },
};

// The plural categories each language's catalog entries list, in this order (Intl.PluralRules names)
export const CATEGORIES = { en: ["one", "other"], de: ["one", "other"], ar: ["zero", "one", "two", "few", "many", "other"] };

// The first language the browser lists that the interface has
export function detectLanguage(preferred = []) {
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

const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text);

// catalog: { "English text": "translation", "{n} task|{n} tasks": ["one form", "other form"], "@html.key": "<b>html</b>" }
export function createTranslator(language, catalog = {}) {
  const { locale } = LANGUAGES[language] || LANGUAGES.en;
  const nf = (n, options) => new Intl.NumberFormat(locale, options).format(n);
  const plural = new Intl.PluralRules(locale);
  return {
    language,
    locale,
    // t("Hello, {name}", { name }) → the text in the language (the English itself when there's no translation)
    t: (text, params) => fill(catalog[text] ?? text, params),
    // tp("{n} task", "{n} tasks", n): the form for the number n; {n} is filled with n, formatted
    tp(one, other, n, params) {
      const forms = catalog[`${one}|${other}`];
      let text = n === 1 ? one : other;
      if (Array.isArray(forms)) text = forms[(CATEGORIES[language] || CATEGORIES.en).indexOf(plural.select(n))] ?? forms[forms.length - 1];
      return fill(text, { n: nf(n), ...params });
    },
    nf,
    formatDate: (date, options = { dateStyle: "medium" }) => new Intl.DateTimeFormat(locale, options).format(date),
    formatTime: (date, options = { hour: "2-digit", minute: "2-digit" }) => new Intl.DateTimeFormat(locale, options).format(date),
    formatDateTime: (date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date),
    html: (key) => catalog[`@${key}`],
  };
}
