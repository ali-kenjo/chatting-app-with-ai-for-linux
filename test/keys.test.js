const { test, describe, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Keyring and Secrets Storage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-keys-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";
  const savedGeminiApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const keys = require("../server/keys");

  after(() => {
    delete process.env.KEYRING_BACKEND;
    if (savedGeminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedGeminiApiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("setKey and getKey persist key in file backend", () => {
    keys.setKey(101, "test-api-key-101");
    assert.strictEqual(keys.getKey(101), "test-api-key-101");
  });

  test("deleteKey removes the stored key", () => {
    keys.setKey(102, "key-to-delete");
    assert.strictEqual(keys.getKey(102), "key-to-delete");

    keys.deleteKey(102);
    assert.throws(() => keys.getKey(102), /API key is missing/);
  });

  test("getKey falls back to GEMINI_API_KEY environment variable if not in store", () => {
    process.env.GEMINI_API_KEY = "env-secret-fallback-key";
    assert.strictEqual(keys.getKey(999), "env-secret-fallback-key");
    delete process.env.GEMINI_API_KEY;
  });

  test("getKey throws meaningful error when key is completely missing", () => {
    assert.throws(() => keys.getKey(99999), /missing from your keyring/);
  });
});
