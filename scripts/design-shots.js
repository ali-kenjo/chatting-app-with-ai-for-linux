// Screenshots of every major surface, for the design audit (docs/design/).
//   node scripts/design-shots.js <before|after> [--langs en,de,ar] [--widths 1440,1024,768,390] [--themes dark,light] [--only name]
// Starts the real helper on a scratch data folder with a fake Ollama (no network, nothing of yours),
// then drives the page with puppeteer-core. Needs Chrome (CHROME_PATH or the usual places).
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
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

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome found (set CHROME_PATH).");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs", "design", "screenshots", label);

const REPLY = [
  "Sure. Here's a small example, the formula, and a diagram.",
  "",
  "```js",
  "function greet(name) {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
  "Euler's identity: $e^{i\\pi} + 1 = 0$, and the quadratic formula:",
  "",
  "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$",
  "",
  "```mermaid",
  "graph LR; A[Idea] --> B[Draft] --> C[Ship]",
  "```",
  "",
  "مرحباً! هذه جملة بالعربية مع English and Deutsch gemischt.",
].join("\n");

const behave = { text: REPLY, status: 0 };
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "phi4-mini:latest" }] }));
  if (req.url === "/api/chat") {
    const body = JSON.parse(Buffer.concat(chunks));
    if (!body.stream) return res.end(JSON.stringify({ message: { content: '["Tell me more","Show another example","Thanks!"]' }, done: true }));
    if (behave.status) return res.writeHead(behave.status).end(JSON.stringify({ error: "broken" }));
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { role: "assistant", content: behave.text }, done: false }) + "\n");
    return res.end(JSON.stringify({ done: true }) + "\n");
  }
  res.writeHead(404).end("{}");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-shots-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  delete process.env.GEMINI_API_KEY;
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  process.env.FRIENDS_LOCAL_SERVERS = JSON.stringify([{ label: "Fake Ollama", url: fakeUrl, protocol: "ollama" }]);

  // Many chats for the sidebar, spread over a few days
  const crypto = require("node:crypto");
  const chatsDir = path.join(tempDir, "chats");
  fs.mkdirSync(chatsDir, { recursive: true });
  const day = 86400000;
  const titles = ["Planning the weekend trip", "Explain ingress controllers", "كيف أحسّن نومي؟", "Recipe: pasta carbonara", "Bug in my login form", "Gedichte für Oma", "Ideas for the next video", "Budget for October", "Learning Rust", "What is a monad?", "Birthday present ideas", "Train times to Berlin"];
  titles.forEach((title, i) => {
    const id = crypto.randomUUID();
    const t = Date.now() - i * day * 0.7 - 60000;
    fs.writeFileSync(path.join(chatsDir, `${id}.json`), JSON.stringify({ id, title, createdAt: t, updatedAt: t, messages: [{ id: crypto.randomUUID(), role: "user", text: title, at: t }, { id: crypto.randomUUID(), role: "model", text: "Happy to help with that.", at: t }] }));
  });

  const { start } = require("../server/server");
  const server = start(0, "127.0.0.1");
  await new Promise((r) => (server.listening ? r() : server.on("listening", r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (method, url, body) => fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--lang=en-US"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) return req.abort();
    req.continue();
  });
  page.on("pageerror", (e) => console.log("  page error:", e.message));

  const list = [];
  let n = 0;
  const shot = async (name, theme, width, lang) => {
    if (ONLY && !name.includes(ONLY)) return;
    const dir = path.join(outDir, lang === "en" ? "" : lang);
    fs.mkdirSync(dir, { recursive: true });
    const file = `${name}-${theme}-${width}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    list.push(path.join(lang === "en" ? "" : lang, file));
    n++;
  };

  const setLook = async (theme, width, lang) => {
    await api("PUT", "/api/settings", { ...(await api("GET", "/api/settings")), theme: { appearance: theme, accent: "#6f9cf5" }, ui: { language: lang }, onboarding: { done: true } });
    await page.setViewport({ width, height: width < 500 ? 844 : 900, deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
    await page.goto(base + "/", { waitUntil: "networkidle2" });
    await sleep(400);
  };
  const click = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  const closeAll = () =>
    page.evaluate(() => {
      document.getElementById("settings-close")?.click();
      document.getElementById("life-close")?.click();
      document.getElementById("voice-end")?.click();
      document.getElementById("search-modal").hidden = true;
      document.getElementById("find-bar").hidden = true;
    });
  const sidebarOpen = async (width) => {
    if (width <= 760) await click("#sidebar-open");
    await sleep(200);
  };

  for (const lang of LANGS) {
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        console.log(`${label}: ${lang} ${theme} ${width}`);

        // --- Nothing configured yet (no AI): start screen and a first message
        await api("DELETE", "/api/brains/1").catch(() => {});
        await setLook(theme, width, lang);
        await shot("01-start-no-ai", theme, width, lang);
        await page.type("#composer-input", "Hello?");
        await page.keyboard.press("Enter");
        await sleep(1200);
        await shot("02-error-no-ai", theme, width, lang);

        // --- With a local AI
        const brains = await api("GET", "/api/brains");
        if (!brains.brains?.length) await api("POST", "/api/brains", { provider: "local", protocol: "ollama", name: "llama3.2", baseUrl: fakeUrl, model: "llama3.2:latest", contextSize: 8192 });
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
        await page.goto(base + "/", { waitUntil: "networkidle2" });
        await page.type("#composer-input", "Will this work?");
        await page.keyboard.press("Enter");
        await sleep(2500);
        await shot("15-error-ai-fails", theme, width, lang);
        behave.status = 0;
      }
    }
  }

  fs.writeFileSync(path.join(outDir, "index.txt"), list.join("\n") + "\n");
  console.log(`${n} screenshots in ${path.relative(root, outDir)}`);
  await browser.close();
  await new Promise((r) => server.close(r));
  fake.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
