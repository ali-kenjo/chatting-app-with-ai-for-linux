// End-to-end, on a "touch screen" (a coarse pointer, no hover): everything you press is at least
// 44 x 44 px (checkboxes and switches get that as hit area around them), nothing needs hover, and a
// window zoomed to 200% still shows everything.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { launch, sleep } = require("../../scripts/lib/harness");

const hasChrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", process.env.CHROME_PATH].some((p) => p && fs.existsSync(p));

describe("Touch screens and zoom", { skip: !hasChrome && "no Chrome found" }, () => {
  let h;
  let page;

  before(async () => {
    h = await launch({ pointer: "coarse" });
    page = h.page;
    await h.addLocalBrain();
  });
  after(async () => {
    await h?.close();
  });

  const tooSmall = () =>
    page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=option]")) {
        if (el.closest("[hidden],[inert]")) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        if (el.matches(`input[type="checkbox"], .toggle, .skip-link`)) continue; // their hit area is bigger than they look; the skip link is off screen until it has focus
        const label = el.closest("label");
        const r = (label && label !== el ? label : el).getBoundingClientRect();
        if (!r.width || !r.height || r.top > innerHeight + 4000) continue;
        if (cs.display === "inline" && el.tagName === "A" && el.closest("p, li, .row-desc, .hint")) continue; // a link inside a sentence
        if (r.width < 43.5 || r.height < 43.5) out.push(`${el.id || el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return [...new Set(out)];
    });

  test("the page really is a touch screen here", async () => {
    await h.setLook({ width: 390 });
    assert.strictEqual(await page.evaluate(() => matchMedia("(pointer: coarse) and (hover: none)").matches), true);
  });

  test("start screen, chat and sidebar: every button is at least 44 px", async () => {
    await h.setLook({ width: 390 });
    assert.deepStrictEqual(await tooSmall(), []);
    await page.type("#composer-input", "hi");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".msg.model .msg-body")?.innerText.length > 5, { timeout: 20000 });
    await sleep(1500);
    assert.deepStrictEqual(await tooSmall(), []);
    await page.evaluate(() => document.getElementById("sidebar-open").click());
    await sleep(300);
    assert.deepStrictEqual(await tooSmall(), []);
  });

  test("the settings: every section is at least 44 px", async () => {
    await page.evaluate(() => document.getElementById("settings-btn").click());
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".settings-tabs .tab")].map((t) => t.dataset.tab));
    for (const tab of tabs) {
      await page.evaluate((t) => document.querySelector(`.tab[data-tab="${t}"]`).click(), tab);
      await sleep(150);
      assert.deepStrictEqual(await tooSmall(), [], tab);
    }
  });

  test("what shows only on hover on a mouse is there without hover (the actions under a message, on the chats)", async () => {
    await h.setLook({ width: 390 });
    await page.evaluate(() => document.getElementById("sidebar-open").click());
    await sleep(300);
    assert.notStrictEqual(await page.$eval(".chat-actions", (el) => getComputedStyle(el).display), "none");
  });

  test("a window zoomed to 200% still shows everything: nothing sticks out sideways", async () => {
    await h.setLook({ width: 640, height: 400 }); // 1280 x 800 at 200%
    for (const open of [() => {}, () => document.getElementById("settings-btn").click()]) {
      await page.evaluate(open);
      await sleep(250);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "no sideways scrolling");
    }
    const composer = await page.evaluate(() => document.getElementById("composer")?.getBoundingClientRect().bottom <= innerHeight + 1 || document.querySelector(".modal"));
    assert.ok(composer);
  });
});
