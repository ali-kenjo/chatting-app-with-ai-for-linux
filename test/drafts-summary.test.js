const { test, describe, after, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Drafts, summaries and the voice prompt", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-drafts-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;

  const tools = require("../server/tools");
  const settings = require("../server/settings");
  const chats = require("../server/chats");
  const summary = require("../server/summary");
  const prompt = require("../server/prompt");
  const realFetch = global.fetch;

  afterEach(() => (global.fetch = realFetch));
  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const chatWith = (count) => {
    const chat = chats.create("Long chat");
    for (let i = 0; i < count; i++) chat.messages.push({ role: i % 2 ? "model" : "user", text: `message ${i}`, at: i });
    chats.save(chat);
    return chat;
  };

  test("write_draft is offered in voice conversations only", () => {
    const names = (voice) => tools.declarations(settings.get(), { voice }).map((t) => t.name);
    assert.ok(names(true).includes("write_draft"));
    assert.ok(!names(false).includes("write_draft"));
  });

  test("write_draft hands the draft over and doesn't read it out", async () => {
    const drafts = [];
    const result = await tools.run("write_draft", { title: "  Reel   hook ", kind: "script", content: "# Hook\nStop scrolling." }, {
      settings: settings.get(),
      onDraft: (d) => drafts.push(d),
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(drafts[0].title, "Reel hook");
    assert.strictEqual(drafts[0].kind, "script");
    assert.match(drafts[0].id, /^[0-9a-f-]{36}$/);
  });

  test("an empty draft is refused", async () => {
    const result = await tools.run("write_draft", { title: "x", kind: "post", content: " " }, { settings: settings.get() });
    assert.match(result.error, /empty/);
  });

  test("drafts can be found with search", () => {
    const chat = chats.create("Ideas");
    chat.messages.push({ role: "model", text: "Done.", drafts: [{ id: "d", title: "Coffee reel", kind: "script", content: "Espresso at dawn", at: 1 }] });
    chats.save(chat);
    assert.ok(chats.search("espresso").some((r) => r.id === chat.id));
  });

  test("short chats aren't summarized", async () => {
    let called = false;
    global.fetch = async () => ((called = true), new Response("{}"));
    const chat = chatWith(25);
    assert.strictEqual(await summary.update(chat.id, { key: "k", model: "gemini-3.8-flash", window: 20 }), null);
    assert.strictEqual(called, false);
  });

  test("long chats get a summary of what dropped out of the window", async () => {
    let sent = "";
    global.fetch = async (url, options) => {
      sent = JSON.parse(options.body).contents[0].parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "They talked about 0 to 29." }] } }] }));
    };
    const chat = chatWith(50);
    const result = await summary.update(chat.id, { key: "k", model: "gemini-3.8-flash", window: 20 });
    assert.deepStrictEqual([result.text, result.upTo], ["They talked about 0 to 29.", 30]);
    assert.match(sent, /User: message 0\n/);
    assert.doesNotMatch(sent, /message 30/);
    assert.strictEqual(chats.get(chat.id).summary.upTo, 30);
    // Word for word from the summary's end: no message falls in a gap
    chat.messages.push({ role: "user", text: "new", at: 99 });
    assert.strictEqual(summary.windowStart({ ...chat, summary: result }, 20), 30);
  });

  test("before the first summary, the oldest messages are still sent", () => {
    const messages = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "model" : "user", text: `m${i}` }));
    assert.strictEqual(summary.windowStart({ messages: messages(24) }, 20), 0);
    assert.strictEqual(summary.windowStart({ messages: messages(30) }, 20), 0);
    // A summary that keeps failing doesn't make every request bigger and bigger
    assert.strictEqual(summary.windowStart({ messages: messages(50) }, 20), 20);
  });

  test("saving an older copy of a chat keeps its summary", () => {
    const chat = chatWith(4);
    const stale = chats.get(chat.id);
    const fresh = chats.get(chat.id);
    fresh.summary = { text: "S", upTo: 2, at: 1 };
    chats.save(fresh);
    stale.messages.push({ role: "user", text: "more", at: 5 });
    chats.save(stale);
    const saved = chats.get(chat.id);
    assert.strictEqual(saved.summary.text, "S");
    assert.strictEqual(saved.messages.length, 5);
  });

  test("the voice prompt: a personal JARVIS, drafts only when offered", () => {
    const s = settings.get();
    s.personality.userName = "Sam";
    const withDrafts = prompt.build(s, { voice: true, toolsOffered: [{ name: "write_draft" }] });
    assert.match(withDrafts, /JARVIS/);
    assert.match(withDrafts, /Use Sam's name now and then/);
    assert.match(withDrafts, /write_draft/);
    assert.match(withDrafts, /language they speak to you/);
    assert.doesNotMatch(prompt.build(s, { voice: true }), /write_draft/);
    assert.doesNotMatch(prompt.build(s, {}), /JARVIS/);
  });

  test("the text chat gets the summary of a long conversation", () => {
    const text = prompt.build(settings.get(), { summary: "They planned a coffee reel." });
    assert.match(text, /# This conversation so far\nSummary of the earlier part:\nThey planned a coffee reel\./);
  });
});
