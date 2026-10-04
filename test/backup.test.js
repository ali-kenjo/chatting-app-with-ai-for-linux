const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

describe("Backups", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-backup-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.LOG_LEVEL = "error";
  const backup = require("../server/backup");
  const settings = require("../server/settings");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(tempDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(tempDir, rel), text);
  };
  const exists = (rel) => fs.existsSync(path.join(tempDir, rel));
  const CHAT = "11111111-2222-4333-8444-555555555555";

  before(() => {
    write(`chats/${CHAT}.json`, JSON.stringify({ id: CHAT, title: "Hello", messages: [] }));
    write("settings.json", JSON.stringify({ personality: { name: "Atlas" } }));
    write("secrets.json", JSON.stringify({ 1: "AIza-secret" }));
    write("voice/model.onnx", "big");
    write("desktop/Cache/x", "cache");
    write("attachments/abc", "picture");
  });
  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  test("a backup has the data, never the keys, caches or speech models", () => {
    const snap = backup.snapshot();
    const paths = snap.files.map((f) => f.path).sort();
    assert.deepStrictEqual(paths, [`chats/${CHAT}.json`, "settings.json"]);
    assert.ok(!JSON.stringify(snap).includes("AIza-secret"));
    assert.ok(backup.snapshot({ files: true }).files.some((f) => f.path === "attachments/abc"));
  });

  test("create saves a gzipped file and list shows it", () => {
    const made = backup.create("manual");
    assert.match(made.name, backup.NAME);
    const raw = fs.readFileSync(path.join(backup.dir, made.name));
    assert.strictEqual(JSON.parse(zlib.gunzipSync(raw)).format, "friends-backup");
    assert.ok(backup.list().some((b) => b.name === made.name && b.kind === "manual"));
  });

  test("replace restores the old state and backs up the current one first", () => {
    const made = backup.create("manual");
    const later = "aaaaaaaa-2222-4333-8444-555555555555";
    write(`chats/${later}.json`, "{}");
    write(`chats/${CHAT}.json`, JSON.stringify({ id: CHAT, title: "Changed" }));
    const result = backup.restoreSaved(made.name, { mode: "replace" });
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tempDir, `chats/${CHAT}.json`))).title, "Hello");
    assert.ok(!exists(`chats/${later}.json`), "a chat made after the backup is gone");
    assert.ok(exists("secrets.json") && exists("attachments/abc"), "keys and attachments stay");
    assert.ok(backup.list().some((b) => b.name === result.safety && b.kind === "before-restore"));
  });

  test("merge keeps what's here", () => {
    const made = backup.create("manual");
    const extra = "bbbbbbbb-2222-4333-8444-555555555555";
    write(`chats/${extra}.json`, "{}");
    backup.restore(backup.read(made.name), { mode: "merge" });
    assert.ok(exists(`chats/${extra}.json`));
  });

  test("a restore reloads settings that are kept in memory", () => {
    const made = backup.create("manual");
    settings.set({ ...settings.get(), personality: { ...settings.get().personality, name: "Someone else" } });
    backup.onRestore(() => settings.reload());
    backup.restoreSaved(made.name);
    assert.strictEqual(settings.get().personality.name, "Atlas");
  });

  test("files that would land outside the data folder are refused", () => {
    for (const bad of ["../evil.json", "/etc/passwd", "secrets.json", "chats/../../x", "backups/x.json.gz"]) {
      const buf = zlib.gzipSync(JSON.stringify({ format: "friends-backup", files: [{ path: bad, encoding: "utf8", data: "x" }] }));
      assert.throws(() => backup.restore(buf), /can't be restored safely/, bad);
    }
    assert.throws(() => backup.restore(Buffer.from("not a backup")), /isn't a Friends backup/);
    assert.throws(() => backup.read("../settings.json"), /not found/);
  });

  test("automatic backups: once a day, and only the newest few are kept", () => {
    const opts = () => ({ backup: { auto: true, keep: 3 } });
    for (const b of backup.list()) backup.remove(b.name);
    assert.ok(backup.tick(opts), "the first one is made");
    assert.strictEqual(backup.tick(opts), null, "not again the same day");
    for (let i = 0; i < 5; i++) backup.create("auto", { keep: 3 });
    assert.strictEqual(backup.list().filter((b) => b.kind === "auto").length, 3);
    assert.strictEqual(backup.tick(() => ({ backup: { auto: false, keep: 3 } })), null);
  });
});
