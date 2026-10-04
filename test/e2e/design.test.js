// End-to-end: first run, finding a setting, the three languages (and right-to-left), and the whole
// core flow with the keyboard alone. The real page in a real Chrome, a fake local AI.
//   npm run test:e2e
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { launch, sleep } = require("../../scripts/lib/harness");

const hasChrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", process.env.CHROME_PATH].some((p) => p && fs.existsSync(p));

describe("The page, designed", { skip: !hasChrome && "no Chrome found" }, () => {
  let h;
  let page;
  const text = (sel) => page.$eval(sel, (el) => el.innerText);
  const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);
  const press = async (...keys) => {
    for (const key of keys) await page.keyboard.press(key);
  };

  before(async () => {
    h = await launch();
    page = h.page;
  });
  after(async () => {
    await h?.close();
  });

  describe("first run", () => {
    test("with no AI set up, the start screen guides you, finds the local AI, and one click is enough", async () => {
      await h.removeBrains();
      await h.setLook({ onboarding: false });
      await page.waitForFunction(() => !document.getElementById("onboarding").hidden);
      assert.strictEqual(await page.$eval("#voice-hero-card", (el) => el.hidden), true, "the voice card waits");
      await page.waitForFunction(() => /Found Fake Ollama/.test(document.getElementById("onb-local-status").textContent));
      assert.match(await text("#onb-local-actions"), /Use llama3\.2/);
      assert.match(await text("#status-text"), /No AI set up yet/);
      await page.click("#onb-local-actions .btn-primary");
      await page.waitForFunction(() => document.getElementById("onboarding").hidden, { timeout: 20000 });
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), "composer-input", "the cursor is in the message box");
      assert.match(await text("#status-text"), /this computer/);
      const saved = await h.api("GET", "/api/settings");
      assert.strictEqual(saved.onboarding.done, true);
    });

    test("a message sent with no AI says what to do, and offers the way", async () => {
      await h.removeBrains();
      await h.setLook({});
      await page.type("#composer-input", "Hello?");
      await press("Enter");
      await page.waitForSelector(".msg-error", { visible: true });
      const alert = await page.$eval(".msg-error", (el) => ({ role: el.getAttribute("role"), text: el.innerText }));
      assert.strictEqual(alert.role, "alert");
      assert.match(alert.text, /No AI is set up yet/);
      assert.match(alert.text, /Set up an AI/);
      await h.addLocalBrain();
    });
  });

  describe("the shortcuts and the keyboard", () => {
    test("the whole core flow works with the keyboard alone: skip link, write, send, open and close a dialog", async () => {
      await h.setLook({});
      // The first Tab stop is "Skip to the message box"
      await page.evaluate(() => document.body.focus());
      await press("Tab");
      assert.strictEqual(await page.evaluate(() => document.activeElement.className), "skip-link");
      await press("Enter");
      assert.strictEqual(await active(), "composer-input");

      await page.keyboard.type("Hello there");
      await press("Enter");
      await page.waitForFunction(() => /Hello|answer|example/.test(document.querySelector(".msg.model .msg-body")?.innerText || ""), { timeout: 20000 });
      // The finished reply is announced once, in a polite live region (the conversation itself is not live)
      await page.waitForFunction(() => document.getElementById("sr-status").textContent.length > 10);
      assert.strictEqual(await page.$eval("#messages", (el) => el.getAttribute("aria-live")), "off");

      // Ctrl+, opens Settings with the focus inside; Tab can't leave it; Esc closes it and the focus is back
      await page.focus("#composer-input");
      await page.keyboard.down("Control");
      await press(",");
      await page.keyboard.up("Control");
      await page.waitForSelector("#settings-modal:not([hidden])");
      for (let i = 0; i < 12; i++) {
        await press("Tab");
        assert.ok(await page.evaluate(() => document.getElementById("settings-modal").contains(document.activeElement)), `Tab ${i + 1} stayed in Settings`);
      }
      assert.strictEqual(await page.$eval(".app", (el) => el.inert), true, "the page behind is inert");
      await press("Escape");
      await page.waitForFunction(() => document.getElementById("settings-modal").hidden);
      assert.strictEqual(await page.$eval(".app", (el) => el.inert), false);
      assert.strictEqual(await active(), "composer-input", "the focus is back where it was");
    });

    test("? shows every shortcut, and Esc closes the list", async () => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.down("Shift");
      await press("Slash");
      await page.keyboard.up("Shift");
      await page.waitForSelector("#shortcuts-modal:not([hidden])");
      const list = await text("#shortcuts-modal");
      for (const word of ["Ctrl", "K", "F2", "Page Up", "Esc"]) assert.ok(list.includes(word), word);
      await press("Escape");
      await page.waitForFunction(() => document.getElementById("shortcuts-modal").hidden);
    });

    test("the message box grows, Enter sends, Shift+Enter starts a new line", async () => {
      await page.focus("#composer-input");
      await page.keyboard.type("one");
      await page.keyboard.down("Shift");
      await press("Enter");
      await page.keyboard.up("Shift");
      await page.keyboard.type("two");
      assert.strictEqual(await page.$eval("#composer-input", (el) => el.value), "one\ntwo");
      assert.ok(await page.$eval("#composer-input", (el) => el.getBoundingClientRect().height) > 40, "two lines are taller");
      await page.$eval("#composer-input", (el) => ((el.value = ""), el.dispatchEvent(new Event("input"))));
    });

    test("the chat list moves with the arrow keys", async () => {
      await page.evaluate(() => document.querySelector(".chat-link").focus());
      const first = await page.evaluate(() => document.activeElement.getAttribute("href"));
      await press("ArrowDown");
      const second = await page.evaluate(() => document.activeElement.getAttribute("href"));
      assert.notStrictEqual(first, second);
      await press("ArrowUp");
      assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute("href")), first);
    });

    test("deleting something that can't be undone asks first, with the safe answer focused", async () => {
      await page.evaluate(() => {
        document.getElementById("settings-btn").click();
        document.querySelector('.tab[data-tab="memory"]').click();
      });
      await page.waitForSelector("#memory-clear", { visible: true });
      await page.click("#memory-clear");
      await page.waitForSelector(".confirm-modal", { visible: true });
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Cancel/);
      await press("Escape");
      await page.waitForFunction(() => !document.querySelector(".confirm-modal"));
      await page.evaluate(() => document.getElementById("settings-close").click());
    });
  });

  describe("finding a setting", () => {
    test("the search takes you to the setting, opens what's folded, and the arrows and Enter work", async () => {
      await page.evaluate(() => document.getElementById("settings-btn").click());
      await page.focus("#settings-search");
      await page.keyboard.type("backup");
      await page.waitForSelector(".settings-result");
      assert.ok((await page.$$(".settings-result")).length > 1);
      await press("Enter");
      await page.waitForFunction(() => document.querySelector('.tab[data-tab="data"]').getAttribute("aria-selected") === "true");
      await page.evaluate(() => document.getElementById("settings-close").click());
    });

    test("an advanced setting is folded until you look for it", async () => {
      await page.evaluate(() => document.getElementById("settings-btn").click());
      await page.focus("#settings-search");
      await page.keyboard.type("how much");
      await page.waitForSelector(".settings-result");
      await press("Enter");
      await page.waitForFunction(() => document.querySelector("#pane-ai-control details.advanced[open]"));
      await page.evaluate(() => document.getElementById("settings-close").click());
    });
  });

  describe("languages", () => {
    const CASES = [
      { lang: "de", dir: "ltr", sidebar: /Neuer Chat/, composer: /Frag mich/ },
      { lang: "ar", dir: "rtl", sidebar: /محادثة جديدة/, composer: /اسأل/ },
    ];
    for (const { lang, dir, sidebar, composer } of CASES) {
      test(`${lang}: the page starts in it, ${dir === "rtl" ? "mirrored" : "left to right"}, and nothing static is left in English`, async () => {
        await h.setLook({ lang, width: 1280 });
        assert.strictEqual(await page.evaluate(() => document.documentElement.lang), lang);
        assert.strictEqual(await page.evaluate(() => document.documentElement.dir), dir);
        assert.match(await text(".sidebar"), sidebar);
        assert.match(await page.$eval("#composer-input", (el) => el.placeholder), composer);

        // Every static text that has a translation different from the English was translated
        const untranslated = await page.evaluate(async (language) => {
          const catalog = (await import(`/js/i18n/${language}.js`)).default;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const found = [];
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.parentElement.closest("[data-no-i18n], script, style, code, kbd, textarea, svg, [data-i18n-html]")) continue;
            const key = n.nodeValue.replace(/\s+/g, " ").trim();
            if (key.length > 2 && typeof catalog[key] === "string" && catalog[key] !== key) found.push(key); // (the little letters in avatars are made by the page)
          }
          return found;
        }, lang);
        assert.deepStrictEqual(untranslated.slice(0, 10), []);
      });
    }

    test("ar: the sidebar is on the right, the send button on the left, Arabic text is right-aligned and code stays left-to-right", async () => {
      await h.setLook({ lang: "ar", width: 1280 });
      await page.type("#composer-input", "Show code");
      await press("Enter");
      await page.waitForSelector(".msg.model .code-block", { visible: true, timeout: 20000 });
      await sleep(1500);
      const layout = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        return {
          sidebarLeft: rect(".sidebar").left,
          input: rect("#composer-input").left,
          send: rect("#send-btn").left,
          codeDir: getComputedStyle(document.querySelector(".code-block pre")).direction,
          arabic: [...document.querySelectorAll(".msg.model .msg-body p")].map((p) => ({ dir: p.dir, align: getComputedStyle(p).textAlign, rtl: getComputedStyle(p).direction, text: p.textContent.slice(0, 12) })).find((p) => /[؀-ۿ]/.test(p.text)),
        };
      });
      assert.ok(layout.sidebarLeft > 600, `sidebar at the right (${layout.sidebarLeft})`);
      assert.ok(layout.send < layout.input, "send button before the box, i.e. on the left");
      assert.strictEqual(layout.codeDir, "ltr");
      assert.strictEqual(layout.arabic?.rtl, "rtl", "a paragraph of Arabic runs right to left");
      assert.strictEqual(await page.$eval("#messages", (el) => el.scrollWidth <= el.clientWidth), true, "nothing sticks out sideways");
    });

    test("de: German's longer words don't break any settings section, even on a phone", async () => {
      for (const width of [1024, 390]) {
        await h.setLook({ lang: "de", width });
        await page.evaluate(() => document.getElementById("settings-btn").click());
        const tabs = await page.evaluate(() => [...document.querySelectorAll(".settings-tabs .tab")].map((t) => t.dataset.tab));
        for (const tab of tabs) {
          await page.evaluate((t) => document.querySelector(`.tab[data-tab="${t}"]`).click(), tab);
          await sleep(120);
          const over = await page.evaluate(() => {
            const body = document.querySelector(".modal-body");
            return { page: document.documentElement.scrollWidth - innerWidth, pane: body.scrollWidth - body.clientWidth };
          });
          assert.ok(over.page <= 0 && over.pane <= 1, `${tab} at ${width}px: ${JSON.stringify(over)}`);
        }
        await page.evaluate(() => document.getElementById("settings-close").click());
      }
    });

    test("changing the language in Settings changes it at once, and it is remembered", async () => {
      await h.setLook({ lang: "en", width: 1280 });
      await h.stopForcingLanguage(); // from here the page decides, as in real life
      await page.evaluate(() => document.getElementById("settings-btn").click());
      await page.select("#language-select", "de");
      await page.waitForFunction(() => document.documentElement.lang === "de", { timeout: 15000 });
      assert.match(await text(".sidebar"), /Neuer Chat/);
      assert.strictEqual((await h.api("GET", "/api/settings")).ui.language, "de");
      await h.setLook({ lang: "en", width: 1280 });
    });
  });

  describe("small details", () => {
    test("the status line says who will answer", async () => {
      await h.setLook({});
      assert.match(await text("#status-text"), /this computer/);
    });

    test("an error shows what happened and how to go on", async () => {
      await h.setLook({});
      h.behave.status = 500;
      await page.type("#composer-input", "will fail");
      await press("Enter");
      await page.waitForSelector(".msg-error", { visible: true, timeout: 20000 });
      const buttons = await page.$$eval(".msg-error .btn", (els) => els.map((e) => e.textContent));
      assert.ok(buttons.includes("Try again"), buttons.join());
      h.behave.status = 0;
      await page.click('.msg-error [data-action="retry"]');
      await page.waitForFunction(() => !document.querySelector(".msg-error") && document.querySelector(".msg.model .msg-body")?.innerText.length > 5, { timeout: 20000 });
    });

    test("dragging a file over the page lights up the message box", async () => {
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(["x"], "a.txt", { type: "text/plain" }));
        document.getElementById("main").dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
      });
      assert.strictEqual(await page.$eval("#composer", (el) => el.classList.contains("drop-active")), true);
      await page.evaluate(() => document.getElementById("main").dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: new DataTransfer() })));
    });

    test("every control that has only an icon has a name for screen readers", async () => {
      const unnamed = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")].filter((el) => !el.closest("[hidden]") && el.offsetParent !== null && !el.type?.match(/hidden/)).filter((el) => !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title || el.textContent.trim() || el.labels?.length || el.placeholder)).map((el) => el.id || el.className));
      assert.deepStrictEqual(unnamed, []);
    });
  });
});
