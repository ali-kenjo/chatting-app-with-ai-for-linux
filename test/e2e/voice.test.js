// Voice conversation in the real page, with a fake microphone and fake AIs:
// the engines (Studio, Instant, and Live falling back to Studio), typing a turn,
// mute, recording, the visualizer styles, closing.
//   npm run test:e2e
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fakes = require("../helpers/fakes").create();

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-e2e-voice-"));

describe("Voice conversation", { skip: !CHROME && "no Chrome found" }, () => {
  let browser;
  let page;
  let server;
  const problems = [];

  before(async () => {
    await fakes.start();
    Object.assign(process.env, {
      FRIENDS_DATA_DIR: tempDir,
      FRIENDS_VOICE_DIR: path.join(tempDir, "voice"),
      FRIENDS_VOICE_PORT: "58184",
      KEYRING_BACKEND: "file",
      LOG_LEVEL: "error",
      FRIENDS_GEMINI_API: fakes.cloudUrl(),
      FRIENDS_GEMINI_RETRY_MS: "0",
      FRIENDS_LOCAL_SERVERS: JSON.stringify([{ label: "Fake Ollama", url: fakes.localUrl(), protocol: "ollama" }]),
    });
    delete process.env.GEMINI_API_KEY;
    const brains = require("../../server/brains");
    await brains.saveBrain({ provider: "local", protocol: "ollama", name: "Llama", baseUrl: fakes.localUrl(), model: "tiny" });
    await brains.saveBrain({ provider: "gemini", name: "Gemini", key: "test-key", model: "gemini-3.8-flash" });
    const { start } = require("../../server/server");
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));

    browser = await require("puppeteer-core").launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] }));
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", (err) => problems.push(err.message));
    page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource/.test(msg.text()) && problems.push(msg.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle2" });
    // Auto mode with a local AI: spoken answers stay local, so Live isn't wanted yet
    await pickMode("auto");
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
    await fakes.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
  const status = () => page.$eval("#voice-status", (el) => el.textContent.trim());
  const pill = () => page.$eval("#voice-engine-label", (el) => el.textContent.trim());
  const waitStatus = (pattern, timeout = 15000) =>
    page.waitForFunction((p) => new RegExp(p).test(document.getElementById("voice-status").textContent), { timeout, polling: 100 }, pattern).catch(async (err) => {
      throw new Error(`Status never matched ${pattern}; it is "${await status()}" (${err.message})`);
    });

  async function pickMode(mode) {
    await page.evaluate(() => document.getElementById("model-menu").hidden && document.getElementById("model-picker").click());
    await page.waitForSelector("#model-menu .model-item", { visible: true });
    await page.evaluate((m) => document.querySelector(`#model-menu [data-mode="${m}"]`).click(), mode);
    await page.waitForFunction((m) => fetch("/api/settings").then((r) => r.json()).then((s) => s.routing.mode === m), {}, mode);
  }

  // Types a turn into voice mode's own text box
  async function typeTurn(text) {
    await click("#voice-keyboard-btn");
    await page.waitForSelector("#voice-type-input", { visible: true });
    await page.type("#voice-type-input", text);
    await page.keyboard.press("Enter");
  }

  const captionText = () => page.$eval("#voice-caption", (el) => el.innerText.replace(/\s+/g, " ").trim());
  const open = async () => {
    await click("#hero-voice-btn");
    await page.waitForFunction(() => !document.getElementById("voice-mode").hidden);
  };

  test("opens with the microphone, and Studio voice runs when Live isn't wanted", async () => {
    await open();
    await waitStatus("Listening");
    assert.strictEqual(await pill(), "Studio");
    assert.strictEqual(await page.$eval("#voice-perm-banner", (el) => el.hidden), true, "no microphone banner");
  });

  test("a typed turn is answered, captioned, written in the transcript and spoken, then it listens again", async () => {
    await typeTurn("Hello there");
    await page.waitForFunction(() => /answer from the local AI/.test(document.getElementById("voice-caption").innerText), { timeout: 15000 });
    await waitStatus("Listening", 20000);
    await click("#voice-drafts-btn");
    await click('.voice-drawer-tab[data-tab="transcript"]');
    const transcript = await page.$eval("#voice-transcript", (el) => el.innerText);
    assert.match(transcript, /Hello there/);
    assert.match(transcript, /answer from the local AI/);
    await click("#voice-drawer-close");
  });

  test("the pill goes through Studio, Instant and Live, and Instant also answers", async () => {
    await click("#voice-engine"); // Studio → Instant
    assert.strictEqual(await pill(), "Instant");
    await waitStatus("Listening");
    await typeTurn("Second question");
    await page.waitForFunction(() => /answer from the local AI/.test(document.getElementById("voice-caption").innerText) && document.getElementById("voice-mode").dataset.state !== "thinking", { timeout: 15000 });
    await waitStatus("Listening", 20000);
  });

  test("mute stops the mic and says so; unmuting listens again", async () => {
    await click("#voice-mute");
    assert.strictEqual(await page.$eval("#voice-mode", (el) => el.classList.contains("muted")), true);
    assert.match(await status(), /muted/i);
    await click("#voice-mute");
    assert.strictEqual(await page.$eval("#voice-mode", (el) => el.classList.contains("muted")), false);
    await waitStatus("Listening");
  });

  test("recording a video swaps Instant for Studio voice (the browser's own voice can't be recorded)", async () => {
    assert.strictEqual(await pill(), "Instant");
    await click("#voice-record");
    await click("#voice-rec-start");
    await page.waitForFunction(() => document.getElementById("voice-mode").classList.contains("recording"), { timeout: 5000 });
    assert.strictEqual(await pill(), "Studio");
    await click("#voice-record"); // stop and save
    await page.waitForFunction(() => !document.getElementById("voice-mode").classList.contains("recording"));
  });

  test("every visualizer style draws on the canvas, and Robot shows its host", async () => {
    for (const theme of ["sunset", "aurora", "cosmic", "zen", "hearth"]) {
      await click(`.voice-theme-btn[data-theme="${theme}"]`);
      assert.strictEqual(await page.$eval("#voice-mode", (el) => el.dataset.style), theme);
      await new Promise((r) => setTimeout(r, 400));
      const painted = await page.evaluate(() => {
        const c = document.getElementById("voice-waves");
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4 * 31) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) lit++;
        return lit;
      });
      assert.ok(painted > 20, `${theme} paints something (${painted} lit samples)`);
    }
    await click('.voice-theme-btn[data-theme="robot"]');
    await page.waitForFunction(() => ["robot", "sunset"].includes(document.getElementById("voice-mode").dataset.style));
    await click('.voice-theme-btn[data-theme="sunset"]');
  });

  test("closing ends the conversation and reopening works", async () => {
    await click("#voice-end");
    await page.waitForFunction(() => document.getElementById("voice-mode").hidden, { timeout: 5000 });
    await open();
    await waitStatus("Listening");
    await click("#voice-end");
    await page.waitForFunction(() => document.getElementById("voice-mode").hidden, { timeout: 5000 });
  });

  test("Live that can't connect falls back to Studio voice and says why", async () => {
    await pickMode("cloud"); // spoken answers go to Gemini Live now
    await open();
    await waitStatus("Listening");
    assert.strictEqual(await pill(), "Instant", "the pill remembers the last choice");
    await click("#voice-engine"); // Instant → Live
    await waitStatus("Using Studio voice instead", 30000);
    assert.strictEqual(await pill(), "Studio");
    await click("#voice-end");
    await page.waitForFunction(() => document.getElementById("voice-mode").hidden, { timeout: 5000 });
  });

  test("nothing in the page broke", () => {
    assert.deepStrictEqual(problems, []);
  });
});
