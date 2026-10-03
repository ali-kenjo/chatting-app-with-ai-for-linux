const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Chats Management and Search", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-chats-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;

  const chats = require("../server/chats");

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("create generates a new chat with title from first text", () => {
    const chat = chats.create("How do I setup a Docker container for Node.js?");
    assert.ok(chat.id);
    assert.strictEqual(chat.title, "How do I setup a Docker container for Node.js?");
    assert.deepStrictEqual(chat.messages, []);

    chats.save(chat);
    const retrieved = chats.get(chat.id);
    assert.strictEqual(retrieved.id, chat.id);
    assert.strictEqual(retrieved.title, chat.title);
  });

  test("rename updates chat title", () => {
    const chat = chats.create("Old title");
    chats.save(chat);

    const renamed = chats.rename(chat.id, "New Brand New Title");
    assert.strictEqual(renamed.title, "New Brand New Title");

    const reloaded = chats.get(chat.id);
    assert.strictEqual(reloaded.title, "New Brand New Title");
  });

  test("search finds matches in title and message text, and handles messages without text safely", () => {
    const chat1 = chats.create("Kubernetes deployment guide");
    chat1.messages.push({ role: "user", text: "Explain ingress controllers" });
    // Message without text (e.g. attachment only) - this used to crash before our fix
    chat1.messages.push({ role: "user", attachments: [{ id: "abc", name: "diag.png" }] });
    // Message with activity only
    chat1.messages.push({ role: "model", activity: ["Read folder"] });
    chats.save(chat1);

    const chat2 = chats.create("Cooking recipes");
    chat2.messages.push({ role: "user", text: "How to make pasta carbonara" });
    chats.save(chat2);

    // Search by title
    const titleResults = chats.search("Kubernetes");
    assert.strictEqual(titleResults.length, 1);
    assert.strictEqual(titleResults[0].id, chat1.id);

    // Search by message text
    const messageResults = chats.search("ingress");
    assert.strictEqual(messageResults.length, 1);
    assert.strictEqual(messageResults[0].id, chat1.id);
    assert.ok(messageResults[0].snippet.toLowerCase().includes("ingress"));

    // Search for pasta
    const pastaResults = chats.search("carbonara");
    assert.strictEqual(pastaResults.length, 1);
    assert.strictEqual(pastaResults[0].id, chat2.id);

    // Empty search returns recent
    const emptyResults = chats.search("");
    assert.strictEqual(emptyResults.length, 4);
  });

  test("remove deletes the chat", () => {
    const chat = chats.create("Temporary chat");
    chats.save(chat);

    assert.ok(chats.list().some((c) => c.id === chat.id));
    chats.remove(chat.id);
    assert.ok(!chats.list().some((c) => c.id === chat.id));
    assert.throws(() => chats.get(chat.id), /Chat not found/);
  });
});
