const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("AI Memory Notes Management", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-notes-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;

  const notes = require("../server/notes");

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("save creates a new note with valid UUID and fields", () => {
    const note = notes.save({
      type: "project",
      title: "Deploy to Cloud",
      description: "Set up Docker and CI/CD",
      content: "Complete step 1 and step 2.",
    });

    assert.ok(note.id);
    assert.strictEqual(note.type, "project");
    assert.strictEqual(note.title, "Deploy to Cloud");
    assert.strictEqual(note.description, "Set up Docker and CI/CD");

    const all = notes.list();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, note.id);
  });

  test("save updates an existing note when id is provided", () => {
    const created = notes.save({
      type: "user",
      title: "Initial Title",
      content: "Initial Content",
    });

    const updated = notes.save({
      id: created.id,
      title: "Updated Title",
      content: "Updated Content",
    });

    assert.strictEqual(updated.id, created.id);
    assert.strictEqual(updated.title, "Updated Title");
    assert.strictEqual(updated.content, "Updated Content");
  });

  test("remove deletes the specified note", () => {
    const note = notes.save({
      type: "reference",
      title: "To Be Removed",
      content: "Content",
    });

    assert.ok(notes.list().some((n) => n.id === note.id));
    notes.remove(note.id);
    assert.ok(!notes.list().some((n) => n.id === note.id));
  });

  test("clear removes all notes", () => {
    notes.save({ type: "user", title: "Note 1", content: "Content" });
    notes.save({ type: "feedback", title: "Note 2", content: "Content" });
    assert.ok(notes.list().length >= 2);

    notes.clear();
    assert.strictEqual(notes.list().length, 0);
  });
});
