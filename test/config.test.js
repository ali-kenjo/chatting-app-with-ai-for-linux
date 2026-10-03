const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Configuration and Storage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-config-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;

  const config = require("../server/config");

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("dataDir respects FRIENDS_DATA_DIR environment variable", () => {
    assert.strictEqual(config.dataDir, tempDir);
  });

  test("version is defined", () => {
    assert.ok(typeof config.version === "string");
    assert.match(config.version, /^\d+\.\d+\.\d+/);
  });

  test("writeJson atomically creates directory and writes valid JSON", () => {
    const target = path.join(tempDir, "nested", "test.json");
    const payload = { hello: "world", count: 42 };

    config.writeJson(target, payload);

    assert.ok(fs.existsSync(target));
    const content = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.deepStrictEqual(content, payload);

    const stats = fs.statSync(target);
    // mode 0600 in octal is 33152 or 33206 on various POSIX
    assert.ok((stats.mode & 0o600) === 0o600);
  });

  test("checkStorage reports ok for writable data directory", () => {
    const status = config.checkStorage();
    assert.strictEqual(status.ok, true);
    assert.strictEqual(status.path, tempDir);
  });
});
