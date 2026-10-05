// `npm run test:a11y`: axe-core over the main surfaces, in dark and light, left-to-right (English)
// and right-to-left (Arabic). Fails on serious or critical violations.
//   node scripts/a11y.js [--langs en,ar] [--themes dark,light] [--width 1280] [--report path.json] [--all-impacts]
// Needs Chrome (CHROME_PATH or the usual places). Runs against the real helper with a fake local AI.
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./lib/harness");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const LANGS = flag("langs", "en,ar").split(",");
const THEMES = flag("themes", "dark,light").split(",");
const WIDTH = Number(flag("width", 1280));
const REPORT = flag("report", "");
const ACCENT = flag("accent", ""); // one of the accent colours of Settings → Appearance, e.g. #f59e0b
const FAIL_ON = args.includes("--all-impacts") ? ["minor", "moderate", "serious", "critical"] : ["serious", "critical"];

const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function main() {
  const h = await launch();
  const { page } = h;
  const results = [];

  const scan = async (surface, lang, theme) => {
    await page.evaluate(axeSource).catch(() => {});
    const out = await page.evaluate(async () => {
      // Scan what's visible; hidden dialogs are scanned when they're open
      const r = await window.axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })), count: v.nodes.length }));
    });
    for (const v of out) results.push({ surface, lang, theme, ...v });
    const bad = out.filter((v) => FAIL_ON.includes(v.impact));
    console.log(`${bad.length ? "✗" : "✓"} ${lang} ${theme} ${surface}${out.length ? `  (${out.length} finding${out.length > 1 ? "s" : ""}, ${bad.length} serious or worse)` : ""}`);
  };
  const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

  for (const lang of LANGS) {
    for (const theme of THEMES) {
      // First run: nothing is set up yet
      await h.removeBrains();
      await h.setLook({ theme, width: WIDTH, lang, onboarding: false, accent: ACCENT });
      await scan("first-run", lang, theme);

      await h.setLook({ theme, width: WIDTH, lang, accent: ACCENT });
      await scan("start-no-ai", lang, theme);

      await h.addLocalBrain();
      await h.setLook({ theme, width: WIDTH, lang, accent: ACCENT });
      await scan("start", lang, theme);

      await page.type("#composer-input", "Show me code, math and a diagram");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".msg.model .msg-body")?.innerText.length > 40, { timeout: 20000 }).catch(() => {});
      await sleep(2500);
      await scan("chat", lang, theme);

      await click("#model-picker");
      await sleep(250);
      await scan("model-menu", lang, theme);
      await click("#model-picker");

      await click("#search-open");
      await sleep(250);
      await scan("search", lang, theme);
      await page.keyboard.press("Escape");

      await click("#today-open");
      await sleep(400);
      for (const tab of ["today", "tasks", "reminders", "habits", "journal"]) {
        await click(`[data-life-tab="${tab}"]`);
        await sleep(250);
        await scan(`today-${tab}`, lang, theme);
      }
      await click("#life-close");

      await click("#settings-btn");
      await sleep(300);
      const tabs = await page.evaluate(() => [...document.querySelectorAll(".modal-nav .tab")].map((t) => t.dataset.tab));
      for (const tab of tabs) {
        await page.evaluate((t) => document.querySelector(`.modal-nav .tab[data-tab="${t}"]`)?.click(), tab);
        await sleep(300);
        await scan(`settings-${tab}`, lang, theme);
      }
      await click("#settings-close");

      await click("#voice-open");
      await sleep(1200);
      await scan("voice", lang, theme);
      await click("#voice-filming");
      await sleep(400);
      await scan("filming-setup", lang, theme);
      await page.keyboard.press("Escape");
      await click("#voice-end");
      await sleep(300);
    }
  }

  await h.close();
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(results, null, 2));

  const bad = results.filter((v) => FAIL_ON.includes(v.impact));
  const byRule = new Map();
  for (const v of results) {
    const e = byRule.get(v.id) || { impact: v.impact, help: v.help, where: new Set(), example: v.nodes[0]?.target };
    e.where.add(v.surface);
    byRule.set(v.id, e);
  }
  if (byRule.size) {
    console.log("\nFindings by rule:");
    for (const [id, e] of byRule) console.log(`  ${e.impact.padEnd(8)} ${id}: ${e.help} — ${[...e.where].slice(0, 6).join(", ")}${e.where.size > 6 ? "…" : ""}  e.g. ${e.example}`);
  }
  if (bad.length) {
    console.error(`\n✗ ${bad.length} ${FAIL_ON.length > 2 ? "" : "serious or critical "}violation${bad.length > 1 ? "s" : ""}`);
    process.exit(1);
  }
  console.log(`\n✓ No ${FAIL_ON.length > 2 ? "" : "serious or critical "}accessibility violations`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
