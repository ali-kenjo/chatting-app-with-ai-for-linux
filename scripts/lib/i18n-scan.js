// Finds every text the interface can show, and reads the translation catalogs (src/js/i18n/).
// Used by scripts/i18n.js and test/i18n.test.js. No dependencies, no browser.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const SRC = path.join(root, "src");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", mdash: "—", ndash: "–", rarr: "→", larr: "←", times: "×", copy: "©" };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const normalize = (s) => s.replace(/\s+/g, " ").trim();
const hasLetters = (s) => /\p{L}/u.test(s);

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP_TEXT = new Set(["script", "style", "code", "kbd", "textarea", "svg"]);

// The page's own text, the way js/i18n.js reads it: { keys: Set, html: Map(key → inner HTML) }
function htmlStrings(html) {
  const keys = new Set();
  const htmlKeys = new Map();
  const title = html.match(/<title>([^<]*)<\/title>/);
  if (title) keys.add(normalize(decode(title[1])));
  const description = html.match(/<meta name="description" content="([^"]*)"/);
  if (description) keys.add(normalize(decode(description[1])));

  const body = html.slice(html.indexOf("<body")).replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  const stack = []; // { name, skipAll, skipText, htmlKey }
  const tokens = body.matchAll(/<(\/)?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/)?>|([^<]+)/g);
  for (const m of tokens) {
    if (m[5] !== undefined) {
      const top = stack.some((s) => s.skipAll || s.skipText || s.htmlKey);
      const text = normalize(decode(m[5]));
      if (!top && text && hasLetters(text)) keys.add(text);
      continue;
    }
    const [, closing, rawName, attrs = "", selfClose] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      while (stack.length && stack.pop().name !== name);
      continue;
    }
    const parentSkip = stack.some((s) => s.skipAll);
    const own = {
      name,
      skipAll: parentSkip || /\bdata-no-i18n\b/.test(attrs),
      skipText: SKIP_TEXT.has(name),
      htmlKey: (attrs.match(/\bdata-i18n-html="([^"]+)"/) || [])[1],
    };
    if (!parentSkip) {
      for (const attr of ["title", "placeholder", "aria-label", "alt"]) {
        const found = attrs.match(new RegExp(`\\s${attr}="([^"]*)"`));
        if (found && hasLetters(found[1]) && !stack.some((s) => s.htmlKey)) keys.add(normalize(decode(found[1])));
      }
    }
    if (own.htmlKey) htmlKeys.set(own.htmlKey, null);
    if (!VOID.has(name) && !selfClose) stack.push(own);
  }
  // The inner HTML of each data-i18n-html element, for checking a translation keeps its links
  for (const key of htmlKeys.keys()) {
    const m = html.match(new RegExp(`<(\\w+)[^>]*data-i18n-html="${key.replace(/\./g, "\\.")}"[^>]*>([\\s\\S]*?)</\\1>`));
    htmlKeys.set(key, m ? m[2] : "");
  }
  return { keys, html: htmlKeys };
}

const unescapeJs = (quote, body) => {
  if (quote === "`") return body;
  return JSON.parse(`"${body.replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`);
};

// t("…") and tp("…", "…", n) with literal texts
function jsStrings(code) {
  const keys = new Set();
  const plurals = new Set();
  const lit = '("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`[^`$\\\\]*`)';
  const lines = code.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  const text = lines.join("\n");
  for (const m of text.matchAll(new RegExp(`(?<![\\w.$])t\\(\\s*${lit}`, "g"))) keys.add(unescapeJs(m[1][0], m[1].slice(1, -1)));
  for (const m of text.matchAll(new RegExp(`(?<![\\w.$])tp\\(\\s*${lit}\\s*,\\s*${lit}`, "g"))) plurals.add(`${unescapeJs(m[1][0], m[1].slice(1, -1))}|${unescapeJs(m[2][0], m[2].slice(1, -1))}`);
  return { keys, plurals };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Texts made by code that can't use the translator (the server, pure modules): src/js/i18n/elsewhere.js
function elsewhere() {
  const file = path.join(SRC, "js", "i18n", "elsewhere.js");
  if (!fs.existsSync(file)) return [];
  return evaluate(file) || [];
}

function evaluate(file) {
  const src = fs.readFileSync(file, "utf8");
  const body = src.replace(/^[\s\S]*?export default/, "").trim().replace(/;\s*$/, "");
  return new Function(`return (${body})`)();
}

// What the helper hands the page to show: activities, voices, character fields, app cards
function serverStrings() {
  const out = new Set();
  const os = require("node:os");
  process.env.FRIENDS_DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "friends-i18n-"));
  process.env.KEYRING_BACKEND ||= "file";
  const { ACTIVITIES } = require(path.join(root, "server", "activities"));
  for (const a of ACTIVITIES) out.add(a.title);
  const { GEMINI_VOICES, FIELDS } = require(path.join(root, "server", "characters"));
  for (const v of GEMINI_VOICES) out.add(v.sound);
  for (const f of Object.values(FIELDS)) out.add(f.label);
  const connectors = require(path.join(root, "server", "connectors"));
  const settings = require(path.join(root, "server", "settings")).get();
  for (const app of connectors.list(settings)) {
    for (const k of ["name", "description", "help"]) if (app[k]) out.add(app[k]);
    for (const f of app.fields || []) {
      for (const k of ["label", "help"]) if (f[k]) out.add(f[k]);
      for (const o of f.options || []) out.add(o[1]);
    }
  }
  return out;
}

function scan() {
  const page = htmlStrings(fs.readFileSync(path.join(SRC, "index.html"), "utf8"));
  const keys = new Set(page.keys);
  const plurals = new Set();
  const sources = new Map(); // key → first file, for error messages
  for (const key of page.keys) sources.set(key, "src/index.html");
  for (const file of walk(path.join(SRC, "js"))) {
    const rel = path.relative(root, file);
    if (/i18n(-core)?\.m?js$|\/i18n\//.test(rel)) continue;
    const found = jsStrings(fs.readFileSync(file, "utf8"));
    for (const k of found.keys) (keys.add(k), !sources.has(k) && sources.set(k, rel));
    for (const k of found.plurals) (plurals.add(k), !sources.has(k) && sources.set(k, rel));
  }
  for (const k of elsewhere()) (keys.add(k), !sources.has(k) && sources.set(k, "src/js/i18n/elsewhere.js"));
  for (const k of serverStrings()) (keys.add(k), !sources.has(k) && sources.set(k, "server/"));
  return { keys, plurals, html: page.html, sources };
}

const LANGS = ["de", "ar"];
function loadCatalog(lang) {
  const file = path.join(SRC, "js", "i18n", `${lang}.js`);
  return fs.existsSync(file) ? evaluate(file) : {};
}

module.exports = { scan, loadCatalog, htmlStrings, jsStrings, LANGS, root };
