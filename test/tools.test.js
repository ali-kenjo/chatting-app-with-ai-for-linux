const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("File tools follow Settings → AI control", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-tools-test-"));
  process.env.FRIENDS_DATA_DIR = path.join(tempDir, "data");
  const allowed = path.join(tempDir, "allowed");
  const outside = path.join(tempDir, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(allowed, "hello.txt"), "hi there");
  fs.writeFileSync(path.join(outside, "secret.txt"), "nope");

  const tools = require("../server/tools");
  const settings = require("../server/settings");

  const withPermissions = (permissions) => {
    const s = settings.get();
    return { ...s, permissions: { ...s.permissions, folders: [allowed], ...permissions } };
  };
  const ctx = (s, answer = true) => {
    const asked = [];
    return { asked, settings: s, confirm: async (summary) => (asked.push(summary), answer) };
  };

  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  test("no file tools are offered without an allowed folder", () => {
    const names = tools.declarations(settings.get()).map((t) => t.name);
    assert.ok(!names.includes("read_file"));
  });

  test("only permitted file tools are offered", () => {
    const names = tools.declarations(withPermissions({})).map((t) => t.name);
    assert.ok(names.includes("read_file") && names.includes("list_folder"));
    assert.ok(!names.includes("delete_item") && !names.includes("edit_file"));
  });

  test("reads inside an allowed folder after you allow it", async () => {
    const c = ctx(withPermissions({}));
    const result = await tools.run("read_file", { path: path.join(allowed, "hello.txt") }, c);
    assert.strictEqual(result.ok, true);
    assert.match(JSON.stringify(result), /hi there/);
    assert.strictEqual(c.asked.length, 1);
  });

  test("files outside the allowed folders are refused", async () => {
    const result = await tools.run("read_file", { path: path.join(outside, "secret.txt") }, ctx(withPermissions({})));
    assert.ok(result.error);
    assert.doesNotMatch(JSON.stringify(result), /nope/);
  });

  test("a denied action doesn't run", async () => {
    const s = withPermissions({ files: { create: true, read: true, edit: false, delete: false } });
    const result = await tools.run("create_file", { path: path.join(allowed, "new.txt"), content: "x" }, ctx(s, false));
    assert.match(result.error, /declined/);
    assert.ok(!fs.existsSync(path.join(allowed, "new.txt")));
  });

  test("actions without permission are refused even if the AI asks", async () => {
    const result = await tools.run("delete_item", { path: path.join(allowed, "hello.txt") }, ctx(withPermissions({})));
    assert.match(result.error, /permission/);
    assert.ok(fs.existsSync(path.join(allowed, "hello.txt")));
  });
});
