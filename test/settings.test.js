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

  test("the first-run guide and the language start unset, and are kept", () => {
    const current = settings.get();
    assert.strictEqual(current.onboarding.done, false);
    assert.strictEqual(current.ui.language, "auto");
    const saved = settings.set({ ...current, onboarding: { done: true }, ui: { language: "ar" } });
    assert.strictEqual(saved.onboarding.done, true);
    assert.strictEqual(saved.ui.language, "ar");
    settings.set({ ...saved, onboarding: { done: false }, ui: { language: "auto" } });
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

  test("voice settings: a style, an interrupt key and how easily your voice cuts in", () => {
    const d = settings.sanitize({}).voice;
    assert.deepStrictEqual(d, { style: "balanced", interruptKey: "Space", interruptSensitivity: "normal" });
    assert.deepStrictEqual(settings.sanitize({ voice: { style: "listener", interruptKey: "KeyX", interruptSensitivity: "hard" } }).voice, { style: "listener", interruptKey: "KeyX", interruptSensitivity: "hard" });
    // unknown values and keys that voice mode already uses fall back; no key at all is allowed
    assert.deepStrictEqual(settings.sanitize({ voice: { style: "loud", interruptKey: "KeyM", interruptSensitivity: "max" } }).voice, d);
    assert.strictEqual(settings.sanitize({ voice: { interruptKey: "Escape" } }).voice.interruptKey, "Space");
    assert.strictEqual(settings.sanitize({ voice: { interruptKey: "not a key!" } }).voice.interruptKey, "Space");
    assert.strictEqual(settings.sanitize({ voice: { interruptKey: "" } }).voice.interruptKey, "");
  });
});
