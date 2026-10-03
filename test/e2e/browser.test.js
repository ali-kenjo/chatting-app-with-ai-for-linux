// End-to-end: the real page in a real Chrome, against the real helper and a fake
// Ollama. Skipped when no Chrome is found (set CHROME_PATH to point at one).
//   npm run test:e2e
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-e2e-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");
process.env.KEYRING_BACKEND = "file";
process.env.LOG_LEVEL = "error";
delete process.env.GEMINI_API_KEY;

// A fake Ollama with one model that answers "Hello from the local model."
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:latest" }] }));
  if (req.url === "/api/chat") {
    const body = JSON.parse(Buffer.concat(chunks));
    if (!body.stream) return res.end(JSON.stringify({ message: { content: '["Tell me more"]' }, done: true }));
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { role: "assistant", content: "Hello from the " } }) + "\n");
    res.write(JSON.stringify({ message: { role: "assistant", content: "local model." }, done: true }) + "\n");
    return res.end();
  }
  res.writeHead(404).end("{}");
});

describe("The page in Chrome", { skip: !CHROME && "no Chrome found" }, () => {
  let browser;
  let page;
  let server;
  let base;
  const external = [];
  const problems = [];

  before(async () => {
    await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
    process.env.FRIENDS_LOCAL_SERVERS = JSON.stringify([{ label: "Fake Ollama", url: `http://127.0.0.1:${fake.address().port}`, protocol: "ollama" }]);
    const { start } = require("../../server/server");
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;

    const puppeteer = require("puppeteer-core");
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"] });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && !["data:", "blob:", "about:"].includes(url.protocol)) {
        external.push(req.url());
        return req.abort();
      }
      req.continue();
    });
    page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
    page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource/.test(msg.text()) && problems.push(`console: ${msg.text()}`));
    await page.goto(base, { waitUntil: "networkidle0" });
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => fake.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const openAiControl = async () => {
    await page.evaluate(() => {
      document.getElementById("settings-btn")?.click();
      [...document.querySelectorAll(".modal-nav .tab")].find((t) => /AI control/.test(t.textContent))?.click();
    });
    await page.waitForSelector("#local-card", { visible: true });
  };

  test("starts offline: it asks no other website for anything, and has no errors", () => {
    assert.deepStrictEqual(external, []);
    assert.deepStrictEqual(problems, []);
  });

  test("Settings → AI control shows Private mode and finds the local AI", async () => {
    await openAiControl();
    await page.waitForFunction(() => document.querySelectorAll(".local-server .local-model").length > 0);
    const text = await page.$eval("#local-card", (el) => el.innerText);
    assert.match(text, /Fake Ollama/);
    assert.match(text, /tiny:latest/);
    assert.ok(await page.$("#private-mode-toggle"));
  });

  test("one click adds the model, and a message gets the local answer", async () => {
    await page.evaluate(() => [...document.querySelectorAll(".local-model button")].find((b) => b.textContent === "Add").click());
    await page.waitForFunction(() => document.querySelector("#local-servers .added"), { timeout: 20000 });
    const brain = await page.$eval("#brain-list .brain", (el) => el.innerText);
    assert.match(brain, /tiny/);

    await page.evaluate(() => document.getElementById("settings-close").click());
    await page.type("#composer-input", "Hi there");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => /Hello from the local model\./.test(document.querySelector(".msg.model")?.innerText || ""), { timeout: 20000 });
    assert.deepStrictEqual(external, []);
  });

  test("Private mode hides what needs the internet and refuses it", async () => {
    await openAiControl();
    await page.click("#private-mode-toggle");
    await page.waitForFunction(() => document.documentElement.dataset.private === "true");
    const visible = await page.evaluate(() => [...document.querySelectorAll(".prompt-chip")].filter((c) => c.offsetParent).map((c) => c.textContent));
    assert.ok(!visible.some((t) => /Gmail|GitHub|news|Drive|Calendar/i.test(t)), visible.join());
    // (the page saves the switch to the helper a moment after showing it)
    await page.waitForFunction(() => fetch("/api/settings").then((r) => r.json()).then((s) => s.privacy.localOnly === true));
    const news = await page.evaluate(() => fetch("/api/news").then((r) => r.json()));
    assert.match(news.error, /Private mode/);
    await page.click("#private-mode-toggle"); // back off
    await page.waitForFunction(() => document.documentElement.dataset.private === "false");
    await page.waitForFunction(() => fetch("/api/settings").then((r) => r.json()).then((s) => s.privacy.localOnly === false));
    assert.deepStrictEqual(external, []);
  });

  test("the settings work on a phone screen", async () => {
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await openAiControl();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.strictEqual(overflow, false);
    await page.setViewport({ width: 1280, height: 900 });
  });
});
