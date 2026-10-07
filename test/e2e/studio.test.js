// The Robot Studio in the real page: opening it, changing the robot's colors, clothes and room, undo,
// saved looks, the keyboard, and each character keeping its own look.
//   npm run test:e2e
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-e2e-studio-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");
process.env.KEYRING_BACKEND = "file";
process.env.LOG_LEVEL = "error";
delete process.env.GEMINI_API_KEY;

describe("The Robot Studio", { skip: !CHROME && "no Chrome found" }, () => {
  let browser;
  let page;
  let server;
  let base;
  const problems = [];

  const settings = () => fetch(`${base}/api/settings`).then((r) => r.json());
  // The settings are saved a moment after a change
  const savedWhere = async (check, what) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (check(await settings())) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.fail(`Not saved: ${what}`);
  };
  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
  const robotState = () =>
    page.evaluate(() => {
      const e = window.friendsRobot?.engine;
      if (!e) return null;
      const names = [];
      e.robot.root.traverse((o) => o.name && names.push(o.name));
      return { place: e.rooms.place?.id, names, shape: e.shape };
    });

  before(async () => {
    const { start } = require("../../server/server");
    // The settings are made before the page starts: no robot next to the chat (it would only slow a software renderer down)
    const settingsModule = require("../../server/settings");
    settingsModule.set({ ...settingsModule.get(), onboarding: { done: true }, robot: { ...settingsModule.get().robot, chatDock: false, quality: "low" } });
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await require("puppeteer-core").launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    page = await browser.newPage();
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] }));
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
    page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource/.test(msg.text()) && problems.push(`console: ${msg.text()}`));
    await page.goto(`${base}/?robot-debug`, { waitUntil: "networkidle2" });
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("Settings → Robot opens the Studio: six tabs, focus inside, the page behind is inert", async () => {
    await click("#settings-btn");
    await click("#tab-robot");
    assert.match(await page.$eval("#robot-look-summary", (el) => el.textContent), /Studio/);
    await click("#robot-studio-open");
    await page.waitForFunction(() => !document.getElementById("robot-studio").hidden);
    assert.deepStrictEqual(await page.$$eval("#rs-tabs [role=tab]", (tabs) => tabs.map((t) => t.textContent.trim())), ["🎨Colors", "🧩Shape", "😊Face", "🎩Outfit", "🏠Room", "✨Looks"]);
    assert.strictEqual(await page.evaluate(() => document.getElementById("robot-studio").contains(document.activeElement)), true);
    assert.strictEqual(await page.evaluate(() => document.getElementById("settings-modal").inert), true);
    // The robot is drawn in the Studio's stage
    await page.waitForFunction(() => document.querySelector("#rs-stage canvas"), { timeout: 20000 });
  });

  test("a color you pick changes the robot at once, and is saved", async () => {
    await click("#rs-tab-colors");
    await page.evaluate(() => document.querySelector('#rs-panel-colors .rs-swatch[data-color="#f4b6c8"]').click());
    await savedWhere((s) => s.robot.design.colors.head === "#f4b6c8" && s.robot.design.colors.body === "#f4b6c8", "the pink shell");
    // Three.js keeps colors in linear space; what's drawn is the same pink once it's back in sRGB
    await page.waitForFunction(() => window.friendsRobot.engine.robot.materials.head.color.getHexString("srgb") === "f4b6c8", { timeout: 8000 });
  });

  test("a hat you pick is put on, and a new shape rebuilds the robot with it", async () => {
    await click("#rs-tab-outfit");
    await page.evaluate(() => document.querySelector("#rs-panel-outfit .rs-tile[data-id=crown]").click());
    await savedWhere((s) => s.robot.design.outfit.hat.item === "crown" && s.robot.design.outfit.hat.c1 === "#f2c14e", "the crown");
    await page.waitForFunction(() => window.friendsRobot.engine.robot.nodes.Head.getObjectByName("Outfit_hat"), { timeout: 8000 });
    // A color of the hat doesn't rebuild it, a different hat does
    const before = (await robotState()).shape;
    await page.evaluate(() => document.querySelector('#rs-panel-outfit .rs-swatch[data-color="#e05a47"]').click());
    await savedWhere((s) => s.robot.design.outfit.hat.c1 === "#e05a47", "the red crown");
    assert.strictEqual((await robotState()).shape, before);
    await page.evaluate(() => document.querySelector("#rs-panel-outfit .rs-tile[data-id=wizard]").click());
    await savedWhere((s) => s.robot.design.outfit.hat.item === "wizard", "the wizard hat");
    assert.notStrictEqual((await robotState()).shape, before);
  });

  test("a place changes the room: its own colors and props, the right set pieces, the right light", async () => {
    await click("#rs-tab-room");
    await page.evaluate(() => document.querySelector('#rs-panel-room .rs-tile[data-id=space]').click());
    await savedWhere((s) => s.robot.room.place === "space" && s.robot.room.props.planet === true && s.robot.room.floor === "grid", "space");
    await page.waitForFunction(() => window.friendsRobot.engine.rooms.place?.id === "space", { timeout: 8000 });
    assert.strictEqual(await page.$$eval("#rs-panel-room .rs-toggle", (rows) => rows.length), 3, "planet, moon, window frame");
    await page.evaluate(() => document.querySelector('#rs-panel-room .rs-tile[data-id=podcast]').click());
    await savedWhere((s) => s.robot.room.place === "podcast" && s.robot.room.sign === "ON AIR", "the podcast studio");
    // The words on the sign
    await page.evaluate(() => document.querySelector("#rs-panel-room input[type=text]").select());
    await page.type("#rs-panel-room input[type=text]", "MY SHOW");
    await savedWhere((s) => s.robot.room.sign === "MY SHOW", "the sign's words");
    // The Chroma places are flat: nothing else to choose
    await page.evaluate(() => document.querySelector('#rs-panel-room .rs-tile[data-id=green]').click());
    await savedWhere((s) => s.robot.room.place === "green", "the green screen");
    assert.strictEqual(await page.evaluate(() => window.friendsRobot.engine.rooms.isChroma), true);
  });

  test("undo and redo bring the last changes back", async () => {
    const before = (await settings()).robot.room.place;
    assert.strictEqual(before, "green");
    assert.strictEqual(await page.$eval("#rs-undo", (b) => b.disabled), false);
    await click("#rs-undo");
    await savedWhere((s) => s.robot.room.place !== "green", "undo");
    await click("#rs-redo");
    await savedWhere((s) => s.robot.room.place === "green", "redo");
  });

  test("a look is saved with a name, shows up, is applied again and can be deleted", async () => {
    await click("#rs-tab-looks");
    await page.evaluate(() => document.querySelector('#rs-panel-looks .rs-tile, #rs-panel-looks .rs-look').scrollIntoView());
    await page.type("#rs-panel-looks .rs-save input", "Green friend");
    await page.evaluate(() => [...document.querySelectorAll("#rs-panel-looks .btn")].find((b) => /Save this look/.test(b.textContent)).click());
    await savedWhere((s) => s.robot.looks.length === 1 && s.robot.looks[0].name === "Green friend" && s.robot.looks[0].room.place === "green", "the saved look");
    assert.strictEqual(await page.$$eval("#rs-panel-looks .rs-look-wrap", (e) => e.length), 1);
    // A ready-made look replaces the robot and the room…
    await page.evaluate(() => document.querySelector('#rs-panel-looks .rs-look[data-id="builtin:wizard"]').click());
    await savedWhere((s) => s.robot.room.place === "space" && s.robot.design.outfit.hat.item === "wizard" && s.robot.design.colors.head === "#c9b8f0", "the wizard look");
    // …and your own comes back
    await page.evaluate(() => document.querySelector('#rs-panel-looks .rs-look-wrap .rs-look').click());
    await savedWhere((s) => s.robot.room.place === "green", "the saved look, applied");
    await click("#rs-panel-looks .rs-look-del");
    await page.waitForSelector(".confirm-backdrop");
    await page.evaluate(() => document.querySelector('.confirm-backdrop [data-answer="yes"]').click());
    await savedWhere((s) => s.robot.looks.length === 0, "the deleted look");
  });

  test("the keyboard works: arrows move between tabs and tiles, Escape closes only the Studio", async () => {
    await page.evaluate(() => document.getElementById("rs-tab-colors").focus());
    await page.keyboard.press("ArrowRight");
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), "rs-tab-shape");
    assert.strictEqual(await page.$eval("#rs-tab-shape", (b) => b.getAttribute("aria-selected")), "true");
    await page.evaluate(() => document.querySelector("#rs-panel-shape .rs-tile[aria-checked=true]").focus());
    await page.keyboard.press("ArrowRight");
    await savedWhere((s) => s.robot.design.build.bodyShape === "egg", "the next body shape, by keyboard");
    await page.keyboard.press("Escape");
    assert.strictEqual(await page.$eval("#robot-studio", (el) => el.hidden), true);
    assert.strictEqual(await page.$eval("#settings-modal", (el) => el.hidden), false, "Settings stays open");
    assert.strictEqual(await page.evaluate(() => document.getElementById("settings-modal").inert), false);
  });

  test("the Settings summary and the place menu follow the Studio", async () => {
    assert.match(await page.$eval("#robot-look-summary", (el) => el.textContent), /Green screen/);
    assert.strictEqual(await page.$eval("#robot-place", (el) => el.value), "green");
    await page.select("#robot-place", "lounge");
    await savedWhere((s) => s.robot.room.place === "lounge" && s.robot.room.props.rug === true, "the living room, chosen in Settings");
  });

  test("each character keeps its own look when you switch", async () => {
    await click("#settings-close");
    // Atlas wears what we set; Mira has her own
    const s = await settings();
    assert.strictEqual(s.characters.active, "atlas");
    await page.evaluate(() => document.querySelector('#character-switch .character-chip[data-id="mira"]')?.click());
    await savedWhere((x) => x.characters.active === "mira" && x.robot.design.colors.head === "#f0ccb6" && x.robot.design.face.eyes === "round" && x.robot.room.place === "studio", "Mira's look");
    await page.evaluate(() => document.querySelector('#character-switch .character-chip[data-id="atlas"]')?.click());
    await savedWhere((x) => x.characters.active === "atlas" && x.robot.room.place === "lounge" && x.robot.design.outfit.hat.item === "wizard", "Atlas's look is back");
  });

  test("nothing went wrong in the page", async () => {
    assert.deepStrictEqual(problems, []);
  });
});
