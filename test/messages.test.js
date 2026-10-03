const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Editing, answering again, likes, pins and follow-ups", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-messages-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.LOG_LEVEL = "error";

  const { start } = require("../server/server");
  const chats = require("../server/chats");
  const notes = require("../server/notes");

  // A fake Gemini: streamed replies say "Reply N", one-shot requests return suggestions
  const realFetch = global.fetch;
  let replies = 0;
  global.fetch = async (url, options) => {
    const u = String(url);
    if (!u.includes("generativelanguage")) return realFetch(url, options);
    if (u.includes(":streamGenerateContent")) {
      const chunk = { candidates: [{ content: { parts: [{ text: `Reply ${++replies}` }] } }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (u.includes(":generateContent")) {
      const text = '```json\n["Tell me more", "Give an example", "Shorter please", "A fourth one"]\n```';
      return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    return Response.json({ models: [] });
  };

  let server;
  let baseUrl;
  before(async () => {
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const call = async (method, urlPath, body) => {
    const res = await realFetch(baseUrl + urlPath, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const chat = async (body) => {
    const { text } = await call("POST", "/api/chat", body);
    return text.trim().split("\n").map((l) => JSON.parse(l));
  };

  test("chats saved before messages had ids get stable ids", () => {
    const old = chats.create("Old chat");
    old.messages.push({ role: "user", text: "hi", at: 1 }, { role: "model", text: "hello", at: 2 });
    fs.mkdirSync(path.join(tempDir, "chats"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "chats", `${old.id}.json`), JSON.stringify(old));
    const first = chats.get(old.id).messages.map((m) => m.id);
    assert.ok(first.every((id) => /^[0-9a-f-]{36}$/.test(id)));
    assert.deepStrictEqual(chats.get(old.id).messages.map((m) => m.id), first);
  });

  test("the chat event names your message and the reply, which are saved with those ids", async () => {
    const events = await chat({ text: "First question" });
    const { id, userId, replyId } = events[0];
    assert.ok(userId && replyId);
    assert.strictEqual(events.at(-1).type, "done");
    const saved = chats.get(id).messages;
    assert.deepStrictEqual(saved.map((m) => m.id), [userId, replyId]);
  });

  test("editing a message replaces it and everything after it", async () => {
    const [first] = await chat({ text: "Question one" });
    const [second] = await chat({ chatId: first.id, text: "Question two" });
    const [edited] = await chat({ chatId: first.id, text: "Question one, better", from: first.userId });
    const saved = chats.get(first.id).messages;
    assert.deepStrictEqual(saved.map((m) => m.text.startsWith("Reply") ? "reply" : m.text), ["Question one, better", "reply"]);
    assert.ok(!saved.some((m) => m.id === second.userId));
    assert.strictEqual(saved[0].id, edited.userId);
  });

  test("answering again replaces the last reply", async () => {
    const [first] = await chat({ text: "Tell me a joke" });
    const oldReply = chats.get(first.id).messages[1];
    const [again] = await chat({ chatId: first.id, retry: true, from: first.replyId });
    const saved = chats.get(first.id).messages;
    assert.strictEqual(saved.length, 2);
    assert.strictEqual(saved[1].id, again.replyId);
    assert.notStrictEqual(saved[1].text, oldReply.text);
  });

  test("a message that's gone can't be edited", async () => {
    const [first] = await chat({ text: "Hello" });
    const res = await call("POST", "/api/chat", { chatId: first.id, text: "x", from: "11111111-1111-1111-1111-111111111111" });
    assert.strictEqual(res.status, 404);
  });

  test("a summary of removed messages is dropped", () => {
    const c = chats.create("Summarized");
    for (let i = 0; i < 6; i++) c.messages.push({ role: i % 2 ? "model" : "user", text: `m${i}`, at: i });
    c.summary = { text: "old", upTo: 4 };
    chats.save(c);
    chats.truncate(chats.get(c.id), chats.get(c.id).messages[2].id);
    assert.strictEqual(chats.get(c.id).summary, undefined);
  });

  test("liking a reply is saved on it", async () => {
    const [first] = await chat({ text: "Nice" });
    const res = await call("PATCH", `/api/chats/${first.id}/messages/${first.replyId}`, { liked: true });
    assert.strictEqual(res.json.liked, true);
    await call("PATCH", `/api/chats/${first.id}/messages/${first.replyId}`, { liked: false });
    assert.strictEqual(chats.get(first.id).messages[1].liked, undefined);
  });

  test("pinning keeps the reply in the AI's notes, unpinning removes it", async () => {
    const [first] = await chat({ text: "Remember this" });
    const pinned = (await call("PATCH", `/api/chats/${first.id}/messages/${first.replyId}`, { pinned: true })).json;
    assert.strictEqual(pinned.pinned, true);
    const note = notes.list().find((n) => n.id === pinned.pinnedNote);
    assert.ok(note && note.content.startsWith("Reply"));
    await call("PATCH", `/api/chats/${first.id}/messages/${first.replyId}`, { pinned: false });
    assert.ok(!notes.list().some((n) => n.id === pinned.pinnedNote));
    assert.strictEqual(chats.get(first.id).messages[1].pinnedNote, undefined);
  });

  test("follow-up suggestions are at most three short strings", async () => {
    const [first] = await chat({ text: "Explain rainbows" });
    const res = await call("POST", `/api/chats/${first.id}/suggestions`);
    assert.deepStrictEqual(res.json.suggestions, ["Tell me more", "Give an example", "Shorter please"]);
  });
});
