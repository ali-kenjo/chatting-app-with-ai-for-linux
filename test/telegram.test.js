const { test, describe, after, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Telegram Companion Bot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-telegram-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";

  const telegram = require("../server/telegram");

  after(() => {
    telegram.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("status reports correct defaults when not configured", () => {
    const st = telegram.status();
    assert.strictEqual(st.enabled, false);
    assert.strictEqual(st.running, false);
    assert.strictEqual(typeof st.hasToken, "boolean");
  });

  test("testConnection rejects when no token is provided", async () => {
    await assert.rejects(
      async () => {
        await telegram.testConnection("");
      },
      /No token provided/
    );
  });

  test("saveConfig updates configuration safely", () => {
    const st = telegram.saveConfig({
      enabled: true,
      allowedUsers: "12345678, 87654321",
      notifyReminders: true,
    });
    assert.strictEqual(st.enabled, true);
    assert.strictEqual(st.allowedUsers, "12345678, 87654321");
    assert.strictEqual(st.notifyReminders, true);

    const check = telegram.status();
    assert.strictEqual(check.enabled, true);
    assert.strictEqual(check.allowedUsers, "12345678, 87654321");
  });
});
