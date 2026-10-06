// Auto, Dynamic, Fastest, Local only and Cloud only in the real page: the model menu,
// the settings, the "who answered" badge, the cloud question, answering again with the other AI.
//   npm run test:e2e
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fakes = require("../helpers/fakes").create();

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-e2e-routing-"));

describe("Choosing the AI in the page", { skip: !CHROME && "no Chrome found" }, () => {
  let browser;
  let page;
  let server;
  const problems = [];

  before(async () => {
    await fakes.start();
    Object.assign(process.env, {
      FRIENDS_DATA_DIR: tempDir,
      FRIENDS_VOICE_DIR: path.join(tempDir, "voice"),
      FRIENDS_VOICE_PORT: "58183",
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

    browser = await require("puppeteer-core").launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    page = await browser.newPage();
    // The interface language follows the browser's; these tests read the English
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] }));
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", (err) => problems.push(err.message));
    page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource/.test(msg.text()) && problems.push(msg.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle2" });
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
    await fakes.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const menuItems = () => page.evaluate(() => [...document.querySelectorAll("#model-menu .model-item")].map((b) => ({ text: b.innerText.replace(/\s+/g, " ").trim(), disabled: b.disabled, mode: b.dataset.mode || null })));
  const openMenu = async () => {
    await page.evaluate(() => document.getElementById("model-menu").hidden && document.getElementById("model-picker").click());
    await page.waitForSelector("#model-menu .model-item", { visible: true });
  };
  const pickMode = async (mode) => {
    await openMenu();
    await page.evaluate((m) => document.querySelector(`#model-menu [data-mode="${m}"]`).click(), mode);
    await page.waitForFunction((m) => fetch("/api/settings").then((r) => r.json()).then((s) => s.routing.mode === m), {}, mode);
  };
  const lastReply = () => page.evaluate(() => {
    const m = [...document.querySelectorAll("#messages .msg.model")].at(-1);
    return m ? { text: m.querySelector(".msg-body")?.innerText.trim(), via: m.querySelector(".msg-via")?.textContent, reason: m.querySelector(".msg-via")?.title } : null;
  });
  const say = async (text) => {
    await page.type("#composer-input", text);
    await page.keyboard.press("Enter");
  };
  const waitReply = async (pattern) => {
    try {
      await page.waitForFunction((p) => new RegExp(p).test([...document.querySelectorAll("#messages .msg.model")].at(-1)?.querySelector(".msg-body")?.innerText || ""), { timeout: 20000 }, pattern);
    } catch (err) {
      const seen = await page.evaluate(() => ({ messages: [...document.querySelectorAll("#messages .msg")].map((m) => `${m.className}: ${m.innerText.replace(/\s+/g, " ").slice(0, 120)}`), input: document.getElementById("composer-input").value, modal: document.querySelector(".ws-modal-backdrop")?.hidden }));
      throw new Error(`No reply matching ${pattern}. Page: ${JSON.stringify(seen)}`);
    }
  };
  const newChat = () => page.evaluate(() => document.getElementById("new-chat")?.click() || [...document.querySelectorAll("a,button")].find((e) => /New chat/.test(e.textContent))?.click());

  test("the model menu offers the modes and the single AIs", async () => {
    await openMenu();
    const items = await menuItems();
    const texts = items.map((i) => i.text);
    for (const label of ["Auto", "Dynamic", "Fastest", "Local only", "Cloud only"]) assert.ok(texts.some((t) => t.includes(label)), label);
    assert.ok(texts.some((t) => t.includes("Llama")) && texts.some((t) => t.includes("Gemini")));
    assert.ok(items.filter((i) => i.mode).every((i) => !i.disabled), "both kinds exist: every mode is available");
    await page.keyboard.press("Escape");
  });

  test("Auto: a short message is answered locally, and the reply says who answered", async () => {
    await pickMode("auto");
    assert.match(await page.$eval("#model-picker", (el) => el.innerText), /Auto/);
    await say("What is two plus two?");
    await waitReply("answer from the local AI");
    const reply = await lastReply();
    assert.match(reply.via, /Local · Llama/);
    assert.match(reply.reason, /Short enough/);
  });

  test("answering again with the other AI is offered, and works", async () => {
    assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.bothKinds), "true");
    await page.evaluate(() => [...document.querySelectorAll("#messages .msg.model.last .msg-action")].find((b) => b.dataset.action === "swap").click());
    await waitReply("answer from the cloud AI");
    assert.match((await lastReply()).via, /Cloud · Gemini/);
  });

  test("Auto: a PDF asks before it goes to the cloud; 'keep it local' keeps it", async () => {
    await newChat();
    fs.writeFileSync(path.join(tempDir, "report.pdf"), "%PDF-1.4 test");
    const input = await page.$("#attach-input");
    await input.uploadFile(path.join(tempDir, "report.pdf"));
    await page.waitForFunction(() => document.querySelector("#attachments .attachment.ready, #attachments .attachment:not(.uploading)"));
    await say("Summarize this");
    await page.waitForFunction(() => document.querySelector(".ws-modal-backdrop") && !document.querySelector(".ws-modal-backdrop").hidden, { timeout: 10000 });
    assert.match(await page.$eval("#ws-modal-title", (el) => el.textContent), /cloud AI/);
    assert.match(await page.$eval("#ws-modal-details", (el) => el.innerText), /PDF/);
    await page.click("#ws-modal-cancel"); // keep it local
    await waitReply("answer from the local AI");
    assert.match((await lastReply()).via, /Local/);
  });

  test("Auto: agreeing sends it to the cloud, and the badge says so", async () => {
    await newChat();
    fs.writeFileSync(path.join(tempDir, "second.pdf"), "%PDF-1.4 test");
    await (await page.$("#attach-input")).uploadFile(path.join(tempDir, "second.pdf"));
    await page.waitForFunction(() => document.querySelector("#attachments .attachment:not(.uploading)"));
    await say("And this one?");
    await page.waitForFunction(() => document.querySelector(".ws-modal-backdrop") && !document.querySelector(".ws-modal-backdrop").hidden, { timeout: 10000 });
    await page.click("#ws-modal-confirm");
    await waitReply("answer from the cloud AI");
    assert.match((await lastReply()).via, /Cloud · Gemini/);
  });

  test("Settings → AI & privacy shows the same mode, and what applies to it", async () => {
    await page.evaluate(() => {
      document.getElementById("settings-btn")?.click();
      document.querySelector('.modal-nav .tab[data-tab="ai-control"]')?.click();
    });
    await page.waitForSelector("#routing-mode", { visible: true });
    assert.strictEqual(await page.$eval("#routing-mode", (el) => el.value), "auto");
    const inactive = () => page.$$eval("#routing-options .is-inactive", (els) => els.length);
    const before = await inactive();
    await page.select("#routing-mode", "dynamic");
    await page.waitForFunction(() => fetch("/api/settings").then((r) => r.json()).then((s) => s.routing.mode === "dynamic"));
    assert.ok((await inactive()) < before, "Dynamic uses more of the options");
    assert.match(await page.$eval("#routing-mode-desc", (el) => el.textContent), /reacts to how things are going/);
    await page.select("#routing-mode", "auto");
    await page.evaluate(() => document.getElementById("settings-close").click());
  });

  test("Private mode: the cloud modes and the cloud AI are off in the menu", async () => {
    await page.evaluate(() => fetch("/api/settings").then((r) => r.json()).then((s) => fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...s, privacy: { localOnly: true } }) })));
    await page.reload({ waitUntil: "networkidle2" });
    await openMenu();
    const items = await menuItems();
    const by = (label) => items.find((i) => i.text.includes(label));
    assert.ok(by("Cloud only").disabled && by("Auto").disabled && !by("Local only").disabled);
    assert.ok(by("Gemini") && items.filter((i) => i.text.includes("Gemini") && !i.mode).every((i) => i.disabled));
    assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.bothKinds), "false");
    assert.deepStrictEqual(problems, []);
  });
});
