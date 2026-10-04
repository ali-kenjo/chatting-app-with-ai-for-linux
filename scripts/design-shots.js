// Screenshots of every major surface, for the design audit (docs/design/).
//   node scripts/design-shots.js <before|after> [--langs en,de,ar] [--widths 1440,1024,768,390] [--themes dark,light] [--only name]
// Starts the real helper on a scratch data folder with a fake Ollama (no network, nothing of yours),
// then drives the page with puppeteer-core. Needs Chrome (CHROME_PATH or the usual places).
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) || "after";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const LANGS = flag("langs", "en").split(",");
const WIDTHS = flag("widths", "1440,1024,768,390").split(",").map(Number);
const THEMES = flag("themes", "dark,light").split(",");
const ONLY = flag("only", "");
const POINTER = flag("pointer", "");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs", "design", "screenshots", label);

const { launch, sleep } = require("./lib/harness");

// Phones get a finger, everything else a mouse: two runs of this script (they're separate processes,
// because the helper keeps its scratch data folder per process)
async function both() {
  const { spawnSync } = require("node:child_process");
  const phone = WIDTHS.filter((w) => w < 500);
  const desk = WIDTHS.filter((w) => w >= 500);
  let status = 0;
  for (const [pointer, widths] of [["fine", desk], ["coarse", phone]]) {
    if (!widths.length) continue;
    const r = spawnSync(process.execPath, [__filename, label, "--pointer", pointer, "--widths", widths.join(","), "--langs", LANGS.join(","), "--themes", THEMES.join(","), ...(ONLY ? ["--only", ONLY] : [])], { stdio: "inherit" });
    status ||= r.status;
  }
  const lists = [];
  const walk = (dir) => fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.png$/.test(e.name) && lists.push(path.relative(outDir, path.join(dir, e.name)))));
  walk(outDir);
  fs.writeFileSync(path.join(outDir, "index.txt"), lists.sort().join("\n") + "\n");
  process.exit(status);
}

async function main() {
  const h = await launch({ pointer: POINTER || "fine" });
  const { page, api, behave, tempDir, setLook: look } = h;
  const outDirFor = (lang) => path.join(outDir, lang === "en" ? "" : lang);

  const list = [];
  let n = 0;
  const shot = async (name, theme, width, lang) => {
    if (ONLY && !name.includes(ONLY)) return;
    const dir = outDirFor(lang);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${name}-${theme}-${width}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    list.push(path.join(lang === "en" ? "" : lang, file));
    n++;
  };

  const setLook = (theme, width, lang, onboarding = true) => look({ theme, width, lang, onboarding });
  const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  const closeAll = () =>
    page.evaluate(() => {
      document.getElementById("settings-close")?.click();
      document.getElementById("life-close")?.click();
      document.getElementById("voice-end")?.click();
      document.getElementById("search-modal").hidden = true;
      document.getElementById("find-bar").hidden = true;
      document.getElementById("shortcuts-modal").hidden = true;
    });
  const sidebarOpen = async (width) => {
    if (width <= 760) await click("#sidebar-open");
    await sleep(200);
  };
  const REPLY = h.REPLY;
  const fakeUrl = h.fakeUrl;
  void fakeUrl;

  for (const lang of LANGS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        console.log(`${label}: ${lang} ${theme} ${width}`);

        // --- First run, nothing configured yet: the guide, then (guide skipped) the start screen and a first message
        await h.removeBrains();
        await setLook(theme, width, lang, false);
        await sleep(600);
        await shot("00-first-run-guide", theme, width, lang);
        await setLook(theme, width, lang);
        await shot("01-start-no-ai", theme, width, lang);
        await page.type("#composer-input", "Hello?");
        await page.keyboard.press("Enter");
        await sleep(1200);
        await shot("02-error-no-ai", theme, width, lang);

        // --- With a local AI
        await h.addLocalBrain();
        await setLook(theme, width, lang);
        await shot("03-start", theme, width, lang);

        // Sidebar with many chats
        await sidebarOpen(width);
        await shot("04-sidebar", theme, width, lang);
        await click("#sidebar-backdrop");

        // A real conversation: code, math, mermaid, mixed text, follow-ups
        behave.text = REPLY;
        await page.type("#composer-input", "Show me code, math and a diagram");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.querySelector(".msg.model .msg-body")?.innerText.length > 40, { timeout: 20000 }).catch(() => {});
        await sleep(2500);
        await shot("05-chat", theme, width, lang);
        await page.evaluate(() => document.querySelector("#messages")?.scrollTo(0, 0));
        await sleep(200);

        // Attachment chip in the composer
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
        fs.writeFileSync(path.join(tempDir, "photo.png"), png);
        const input = await page.$("#attach-input");
        await input.uploadFile(path.join(tempDir, "photo.png"));
        await sleep(800);
        await shot("06-attachment", theme, width, lang);
        await page.evaluate(() => document.querySelector("#attachments .attachment-remove, #attachments button")?.click());

        // Model menu
        await click("#model-picker");
        await sleep(250);
        await shot("07-model-menu", theme, width, lang);
        await click("#model-picker");

        // Find in chat
        await click("#find-open");
        await page.type("#find-input", "code").catch(() => {});
        await sleep(250);
        await shot("08-find", theme, width, lang);
        await page.keyboard.press("Escape"); // clears the marks as a person would
        await closeAll();

        // Keyboard shortcuts
        await page.evaluate(() => document.getElementById("shortcuts-btn").click());
        await sleep(300);
        await shot("08b-shortcuts", theme, width, lang);
        await closeAll();

        // Search
        await sidebarOpen(width);
        await click("#search-open");
        await sleep(200);
        await page.type("#search-input", "pasta");
        await sleep(500);
        await shot("09-search", theme, width, lang);
        await closeAll();

        // Today panel, every tab
        await sidebarOpen(width);
        await click("#today-open");
        await sleep(400);
        for (const tab of ["today", "tasks", "reminders", "habits", "journal"]) {
          await click(`[data-life-tab="${tab}"]`);
          await sleep(250);
          await shot(`10-today-${tab}`, theme, width, lang);
        }
        await closeAll();

        // Every Settings pane
        await page.evaluate(() => document.getElementById("settings-btn").click());
        await sleep(300);
        const tabs = await page.evaluate(() => [...document.querySelectorAll(".modal-nav .tab")].map((t) => t.dataset.tab));
        for (const tab of tabs) {
          await page.evaluate((t) => document.querySelector(`.modal-nav .tab[data-tab="${t}"]`)?.click(), tab);
          await sleep(350);
          await shot(`11-settings-${tab}`, theme, width, lang);
        }
        await closeAll();

        // Voice mode (no microphone here: it shows the permission banner) and Filming setup
        await page.evaluate(() => document.getElementById("voice-open")?.click());
        await sleep(1500);
        await shot("12-voice", theme, width, lang);
        for (const style of ["sunset", "robot"]) {
          await click(`[data-theme="${style}"].voice-theme-btn`);
          await sleep(1200);
          await shot(`13-voice-${style}`, theme, width, lang);
        }
        await click("#voice-filming");
        await sleep(500);
        await shot("14-filming-setup", theme, width, lang);
        await page.keyboard.press("Escape");
        await sleep(300);
        await closeAll();
        await sleep(300);

        // Error state: the AI breaks
        behave.status = 500;
        await setLook(theme, width, lang);
        await page.type("#composer-input", "Will this work?");
        await page.keyboard.press("Enter");
        await sleep(2500);
        await shot("15-error-ai-fails", theme, width, lang);
        behave.status = 0;
      }
    }
  }

  console.log(`${n} screenshots in ${path.relative(root, outDir)}`);
  await h.close();
  process.exit(0);
}

(POINTER ? main() : both()).catch((err) => {
  console.error(err);
  process.exit(1);
});
