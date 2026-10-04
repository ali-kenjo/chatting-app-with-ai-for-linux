// The interface languages: how one is chosen, how texts and plurals turn into it, and that every
// text the interface can show has a translation in every language (German, Arabic).
const { test, describe } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { scan, loadCatalog, LANGS, root } = require("../scripts/lib/i18n-scan");

const core = () => import(pathToFileURL(path.join(root, "src", "js", "i18n-core.mjs")));

describe("Choosing the language", () => {
  test("the first language the browser lists that the interface has", async () => {
    const { detectLanguage } = await core();
    assert.strictEqual(detectLanguage(["de-DE", "en"]), "de");
    assert.strictEqual(detectLanguage(["fr", "ar-EG", "en"]), "ar");
    assert.strictEqual(detectLanguage(["en-GB"]), "en");
    assert.strictEqual(detectLanguage(["fr", "ja"]), "en", "nothing it knows: English");
    assert.strictEqual(detectLanguage([]), "en");
  });

  test("\"auto\" follows the browser; a language picked in Settings wins", async () => {
    const { resolveLanguage } = await core();
    assert.strictEqual(resolveLanguage("auto", ["de"]), "de");
    assert.strictEqual(resolveLanguage("ar", ["de"]), "ar");
    assert.strictEqual(resolveLanguage("en", ["de"]), "en");
    assert.strictEqual(resolveLanguage("klingon", ["de"]), "de", "an unknown choice is like auto");
  });

  test("Arabic reads right to left, the others left to right", async () => {
    const { LANGUAGES } = await core();
    assert.strictEqual(LANGUAGES.ar.dir, "rtl");
    assert.strictEqual(LANGUAGES.de.dir, "ltr");
    assert.strictEqual(LANGUAGES.en.dir, "ltr");
  });
});

describe("Texts, plurals, numbers and dates", () => {
  test("a text comes back in the language, with its placeholders filled; English is the fallback", async () => {
    const { createTranslator } = await core();
    const de = createTranslator("de", { "Hello, {name}": "Hallo, {name}" });
    assert.strictEqual(de.t("Hello, {name}", { name: "Sam" }), "Hallo, Sam");
    assert.strictEqual(de.t("Not translated {x}", { x: 1 }), "Not translated 1");
    assert.strictEqual(de.t("Left {alone}", { other: 1 }), "Left {alone}", "an unknown placeholder stays");
  });

  test("German plurals have one and other", async () => {
    const { createTranslator } = await core();
    const de = createTranslator("de", { "{n} task|{n} tasks": ["{n} Aufgabe", "{n} Aufgaben"] });
    assert.strictEqual(de.tp("{n} task", "{n} tasks", 1), "1 Aufgabe");
    assert.strictEqual(de.tp("{n} task", "{n} tasks", 3), "3 Aufgaben");
  });

  test("Arabic plurals use all six forms, with Latin digits", async () => {
    const { createTranslator } = await core();
    const forms = ["لا مهام", "مهمة واحدة", "مهمتان", "{n} مهام", "{n} مهمة", "{n} مهمة (كثيرة)"];
    const ar = createTranslator("ar", { "{n} task|{n} tasks": forms });
    const say = (n) => ar.tp("{n} task", "{n} tasks", n);
    assert.strictEqual(say(0), "لا مهام");
    assert.strictEqual(say(1), "مهمة واحدة");
    assert.strictEqual(say(2), "مهمتان");
    assert.strictEqual(say(3), "3 مهام");
    assert.strictEqual(say(11), "11 مهمة");
    assert.strictEqual(say(100), "100 مهمة (كثيرة)");
    assert.strictEqual(ar.nf(1234.5), "1,234.5", "digits stay 0-9");
  });

  test("without a translation a plural falls back to English", async () => {
    const { createTranslator } = await core();
    const de = createTranslator("de", {});
    assert.strictEqual(de.tp("{n} task", "{n} tasks", 1), "1 task");
    assert.strictEqual(de.tp("{n} task", "{n} tasks", 2), "2 tasks");
  });

  test("numbers and dates follow the language", async () => {
    const { createTranslator } = await core();
    const en = createTranslator("en");
    const de = createTranslator("de");
    assert.strictEqual(en.nf(1234.5), "1,234.5");
    assert.strictEqual(de.nf(1234.5), "1.234,5");
    const day = new Date(2026, 9, 5, 14, 30);
    assert.match(en.formatDate(day, { month: "long" }), /October/);
    assert.match(de.formatDate(day, { month: "long" }), /Oktober/);
    assert.match(createTranslator("ar").formatDate(day, { month: "long" }), /أكتوبر/);
  });
});

describe("The catalogs", () => {
  const { keys, plurals, html, sources } = scan();
  const want = [...keys, ...plurals, ...[...html.keys()].map((k) => `@${k}`)];

  for (const lang of LANGS) {
    const catalog = loadCatalog(lang);

    test(`${lang}: every text of the interface has a translation`, () => {
      const missing = want.filter((k) => catalog[k] === undefined);
      assert.deepStrictEqual(missing.slice(0, 15).map((k) => `${k.slice(0, 70)} (${sources.get(k) || "html"})`), [], `${missing.length} missing; run: node scripts/i18n.js --missing`);
    });

    test(`${lang}: no translation is left over for a text that is gone`, () => {
      const orphans = Object.keys(catalog).filter((k) => !want.includes(k));
      assert.deepStrictEqual(orphans.slice(0, 15), []);
    });

    test(`${lang}: placeholders like {name} are kept (and none is invented)`, () => {
      const names = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const problems = [];
      for (const [key, value] of Object.entries(catalog)) {
        if (key.startsWith("@")) continue;
        for (const form of [].concat(value)) {
          const given = names(form);
          const allowed = new Set(names(key));
          if (key.includes("|")) allowed.add("n");
          if (given.some((n) => !allowed.has(n))) problems.push(`${key.slice(0, 50)} → ${String(form).slice(0, 50)}`);
          if (!key.includes("|") && names(key).join() !== given.join()) problems.push(`${key.slice(0, 50)} → ${String(form).slice(0, 50)}`);
        }
      }
      assert.deepStrictEqual(problems, []);
    });

    test(`${lang}: plurals list a text for each plural form of the language`, () => {
      const need = lang === "ar" ? 6 : 2;
      const wrong = Object.entries(catalog).filter(([k, v]) => k.includes("|") && !k.startsWith("@") && (!Array.isArray(v) || v.length !== need));
      assert.deepStrictEqual(wrong.map(([k]) => k), []);
    });

    test(`${lang}: translated HTML keeps the links and markup of the English`, () => {
      const shape = (text) => ({
        tags: [...text.matchAll(/<(\w+)/g)].map((m) => m[1]).sort().join(),
        links: [...text.matchAll(/(?:href|data-open-tab|data-open-section|id)="([^"]*)"/g)].map((m) => m[1]).sort().join(),
      });
      const bad = [];
      for (const [key, english] of html) if (catalog[`@${key}`] && JSON.stringify(shape(catalog[`@${key}`])) !== JSON.stringify(shape(english))) bad.push(key);
      assert.deepStrictEqual(bad, []);
    });

    test(`${lang}: nothing is translated into an empty text`, () => {
      assert.deepStrictEqual(Object.entries(catalog).filter(([, v]) => [].concat(v).some((s) => !String(s).trim())).map(([k]) => k), []);
    });
  }
});

describe("The language setting", () => {
  test("the helper keeps Settings → Appearance → Language, and ignores a language it doesn't have", () => {
    const fs = require("node:fs");
    const os = require("node:os");
    process.env.FRIENDS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "friends-i18n-settings-"));
    const settings = require("../server/settings");
    assert.strictEqual(settings.get().ui.language, "auto");
    assert.strictEqual(settings.set({ ui: { language: "de" } }).ui.language, "de");
    assert.strictEqual(settings.set({ ui: { language: "ar" } }).ui.language, "ar");
    assert.strictEqual(settings.set({ ui: { language: "klingon" } }).ui.language, "auto");
    fs.rmSync(process.env.FRIENDS_DATA_DIR, { recursive: true, force: true });
  });
});
