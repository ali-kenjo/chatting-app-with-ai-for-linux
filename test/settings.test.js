const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Settings Management", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-settings-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;

  const settings = require("../server/settings");

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("get returns defaults when no settings file exists", () => {
    const current = settings.get();
    assert.strictEqual(current.theme.appearance, "dark");
    assert.strictEqual(current.font.size, 16);
    assert.strictEqual(current.personality.voice, 1);
    assert.strictEqual(current.personality.creativity, 5);
  });

  test("set sanitizes and clamps out-of-range values", () => {
    const updated = settings.set({
      font: { size: 999 }, // should clamp to 22
      personality: { creativity: -50, speed: 50, name: "  A very long name that exceeds standard boundaries  " },
      theme: { accent: "invalid-color" },
    });

    assert.strictEqual(updated.font.size, 22);
    assert.strictEqual(updated.personality.creativity, 0);
    assert.strictEqual(updated.personality.speed, 10);
    assert.strictEqual(updated.theme.accent, "#6f9cf5"); // reset to default
  });

  test("set persists changes to disk", () => {
    settings.set({
      theme: { accent: "#34d399", appearance: "light" },
    });

    const fileContent = JSON.parse(fs.readFileSync(path.join(tempDir, "settings.json"), "utf8"));
    assert.strictEqual(fileContent.theme.accent, "#34d399");
    assert.strictEqual(fileContent.theme.appearance, "light");
  });
});
