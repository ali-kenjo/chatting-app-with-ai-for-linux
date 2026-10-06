const { test, describe, after, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Local Markdown Notes Vault", () => {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-vault-test-"));
  const localNotes = require("../server/local-notes");

  after(() => {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test("writeNote and readNote work correctly", async () => {
    const res = await localNotes.writeNote("daily/2026-10-06.md", "# Today's Plan\n- Focus on voice mode #goals\n- Meet with co-host", vaultDir);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.path, "daily/2026-10-06.md");

    const note = await localNotes.readNote("daily/2026-10-06.md", vaultDir);
    assert.strictEqual(note.path, "daily/2026-10-06.md");
    assert.strictEqual(note.title, "Today's Plan");
    assert.deepStrictEqual(note.tags, ["#goals"]);
    assert.match(note.content, /Meet with co-host/);
  });

  test("appendToNote appends content with proper spacing", async () => {
    await localNotes.appendToNote("daily/2026-10-06.md", "Additional evening note #reflection", vaultDir);
    const note = await localNotes.readNote("daily/2026-10-06.md", vaultDir);
    assert.match(note.content, /Additional evening note/);
    assert.ok(note.tags.includes("#reflection"));
  });

  test("listNotes returns notes metadata with extracted tags", async () => {
    await localNotes.writeNote("ideas/podcast.md", "# Podcast Episode 1\nBrainstorming ideas #show #creativity", vaultDir);
    const list = await localNotes.listNotes(vaultDir);
    assert.ok(list.length >= 2);
    const podcastNote = list.find((n) => n.path === "ideas/podcast.md");
    assert.ok(podcastNote);
    assert.strictEqual(podcastNote.title, "Podcast Episode 1");
    assert.ok(podcastNote.tags.includes("#show"));
    assert.ok(podcastNote.tags.includes("#creativity"));
  });

  test("searchNotes finds matches by query and tag", async () => {
    const results = await localNotes.searchNotes("#show", vaultDir);
    assert.ok(results.length >= 1);
    assert.strictEqual(results[0].path, "ideas/podcast.md");

    const textResults = await localNotes.searchNotes("co-host", vaultDir);
    assert.ok(textResults.length >= 1);
    assert.strictEqual(textResults[0].path, "daily/2026-10-06.md");
  });

  test("security: path traversal attempts are blocked", async () => {
    await assert.rejects(
      async () => {
        await localNotes.readNote("../../etc/passwd", vaultDir);
      },
      /Path traversal blocked/
    );

    await assert.rejects(
      async () => {
        await localNotes.writeNote("../escape.md", "malicious", vaultDir);
      },
      /Path traversal blocked/
    );
  });

  test("deleteNote removes a note", async () => {
    await localNotes.writeNote("temp.md", "# Temporary", vaultDir);
    const delRes = await localNotes.deleteNote("temp.md", vaultDir);
    assert.strictEqual(delRes.ok, true);

    await assert.rejects(
      async () => {
        await localNotes.readNote("temp.md", vaultDir);
      },
      /does not exist/
    );
  });
});
