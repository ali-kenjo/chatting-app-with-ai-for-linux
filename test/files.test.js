const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Files Sandbox and Operations", () => {
  const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-allowed-dir-"));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-outside-dir-"));

  const files = require("../server/files");

  after(() => {
    fs.rmSync(allowedDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  test("resolve allows paths inside allowed folders", async () => {
    const subfilePath = path.join(allowedDir, "nested.txt");
    const resolved = await files.resolve(subfilePath, [allowedDir]);
    assert.strictEqual(resolved.real, subfilePath);
  });

  test("resolve blocks path traversal outside allowed folders", async () => {
    const outsideFilePath = path.join(outsideDir, "secret.txt");
    await assert.rejects(
      async () => {
        await files.resolve(outsideFilePath, [allowedDir]);
      },
      /is outside the allowed folders/
    );

    // Relative traversal attack
    const traversalPath = path.join(allowedDir, "..", path.basename(outsideDir), "secret.txt");
    await assert.rejects(
      async () => {
        await files.resolve(traversalPath, [allowedDir]);
      },
      /is outside the allowed folders/
    );
  });

  test("createFile, readFile, editFile, listFolder, and remove operate safely", async () => {
    const targetFile = path.join(allowedDir, "doc.txt");

    // Create
    await files.createFile(targetFile, "Hello World Content");
    assert.ok(fs.existsSync(targetFile));

    // Read
    const read = await files.readFile(targetFile);
    assert.strictEqual(read.content, "Hello World Content");

    // Edit
    await files.editFile(targetFile, "Updated Content");
    const reRead = await files.readFile(targetFile);
    assert.strictEqual(reRead.content, "Updated Content");

    // List
    const listed = await files.listFolder(allowedDir);
    assert.ok(listed.items.some((i) => i.name === "doc.txt" && i.type === "file"));

    // Remove
    await files.remove(targetFile, false);
    assert.ok(!fs.existsSync(targetFile));
  });
});
