// `npm run i18n`: how complete the translations are, and what is missing.
//   node scripts/i18n.js            summary per language
//   node scripts/i18n.js --missing  the missing English texts, one per line (to translate)
const { scan, loadCatalog, LANGS } = require("./lib/i18n-scan");

const { keys, plurals, html } = scan();
const want = [...keys, ...plurals, ...[...html.keys()].map((k) => `@${k}`)];
const listMissing = process.argv.includes("--missing");
let incomplete = false;
for (const lang of LANGS) {
  const catalog = loadCatalog(lang);
  const missing = want.filter((k) => catalog[k] === undefined);
  const orphans = Object.keys(catalog).filter((k) => !want.includes(k));
  console.log(`${lang}: ${want.length - missing.length}/${want.length} translated${orphans.length ? `, ${orphans.length} unused entries` : ""}`);
  if (listMissing) for (const k of missing) console.log(`  ${JSON.stringify(k)}`);
  if (missing.length || orphans.length) incomplete = true;
}
process.exit(incomplete && process.argv.includes("--strict") ? 1 : 0);
