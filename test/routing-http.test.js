// Auto, Dynamic, Fastest, Local only, Cloud only: through the real helper, with a
// fake Ollama (local) and a fake Gemini (cloud).
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-routing-test-"));

let behave = { local: {}, cloud: {} }; // per test: { status, delay, text }
const hits = { local: 0, cloud: 0, localAborted: 0, cloudAborted: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fakeLocal = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:latest" }] }));
  if (req.url === "/api/chat" && body.stream === false) return res.end(JSON.stringify({ message: { content: "ok" }, done: true }));
  if (req.url === "/api/chat") {
    hits.local++;
    res.on("close", () => !res.writableFinished && hits.localAborted++);
    if (behave.local.status) return res.writeHead(behave.local.status).end(JSON.stringify({ error: "broken" }));
    await sleep(behave.local.delay || 0);
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { role: "assistant", content: behave.local.text ?? "answer from the local AI" } }) + "\n");
    return res.end(JSON.stringify({ done: true }) + "\n");
  }
  res.writeHead(404).end("{}");
});

const fakeCloud = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.url.startsWith("/models?")) return res.end(JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] }));
  if (req.url.includes(":generateContent")) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
  if (req.url.includes(":streamGenerateContent")) {
    hits.cloud++;
    res.on("close", () => !res.writableFinished && hits.cloudAborted++);
    if (behave.cloud.status) return res.writeHead(behave.cloud.status).end(JSON.stringify({ error: { message: "broken" } }));
    await sleep(behave.cloud.delay || 0);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    return res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: behave.cloud.text ?? "answer from the cloud AI" }] } }] })}\n\n`);
  }
  res.writeHead(404).end("{}");
});

let server;
let base;
let settings;
let brains;
const url = (s) => `http://127.0.0.1:${s.address().port}`;

before(async () => {
  await new Promise((resolve) => fakeLocal.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => fakeCloud.listen(0, "127.0.0.1", resolve));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");
  process.env.FRIENDS_VOICE_PORT = "58182";
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  process.env.FRIENDS_GEMINI_RETRY_MS = "0";
  process.env.FRIENDS_GEMINI_API = url(fakeCloud);
  process.env.FRIENDS_ROUTER_SLOW_MS = "250";
  delete process.env.GEMINI_API_KEY;
  settings = require("../server/settings");
  brains = require("../server/brains");
  const { start } = require("../server/server");
  await brains.saveBrain({ provider: "local", protocol: "ollama", name: "Local", baseUrl: url(fakeLocal), model: "tiny" });
  await brains.saveBrain({ provider: "gemini", name: "Cloud", key: "test-key", model: "gemini-3.8-flash" });
  server = start(0, "127.0.0.1");
  await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
  base = url(server);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fakeLocal.close(resolve));
  await new Promise((resolve) => fakeCloud.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const setRouting = (routing, privacy = false) => {
  const s = settings.get();
  settings.set({ ...s, privacy: { localOnly: privacy }, routing: { ...s.routing, ...routing } });
};

beforeEach(() => {
  behave = { local: {}, cloud: {} };
  Object.keys(hits).forEach((k) => (hits[k] = 0));
  require("../server/router").resetHealth();
  setRouting({ mode: "auto", askBeforeCloud: "never" });
});

// Streams /api/chat; `answer(event)` can respond to a confirmation
async function chat(body, answer = () => true) {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const events = [];
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "confirm") await fetch(`${base}/api/confirm/${event.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow: answer(event) }) });
    }
  }
  const text = events.filter((e) => e.type === "text").map((e) => e.text).join("");
  return { events, text, route: events.filter((e) => e.type === "route").at(-1), error: events.find((e) => e.type === "error")?.error };
}

const uploadPdf = async () => {
  const res = await fetch(`${base}/api/attachments`, { method: "POST", headers: { "Content-Type": "application/pdf", "X-File-Name": "report.pdf" }, body: Buffer.from("%PDF-1.4 fake") });
  return (await res.json()).id;
};

describe("Routing through the helper", () => {
  test("Local only and Cloud only answer from their kind", async () => {
    setRouting({ mode: "local" });
    let r = await chat({ text: "hi" });
    assert.strictEqual(r.text, "answer from the local AI");
    assert.deepStrictEqual([r.route.kind, r.route.mode, r.route.name], ["local", "local", "Local"]);
    setRouting({ mode: "cloud" });
    r = await chat({ text: "hi" });
    assert.strictEqual(r.text, "answer from the cloud AI");
    assert.strictEqual(r.route.kind, "cloud");
    assert.strictEqual(hits.local, 1);
  });

  test("a fixed brain behaves as before: no route event", async () => {
    setRouting({ mode: "fixed" });
    const cloud = brains.publicState().brains.find((b) => b.provider === "gemini");
    const r = await chat({ text: "hi", brainId: cloud.id });
    assert.strictEqual(r.text, "answer from the cloud AI");
    assert.ok(!r.events.some((e) => e.type === "route"));
  });

  test("Auto: a short message stays local, and says why; the reply remembers who answered", async () => {
    const r = await chat({ text: "What's the capital of France?" });
    assert.strictEqual(r.text, "answer from the local AI");
    assert.match(r.route.reason, /Short enough/);
    assert.strictEqual(hits.cloud, 0);
    const saved = await (await fetch(`${base}/api/chats/${r.events[0].id}`)).json();
    assert.deepStrictEqual([saved.messages[1].via.kind, saved.messages[1].via.name, saved.messages[1].via.mode], ["local", "Local", "auto"]);
  });

  test("Auto: a PDF goes to the cloud after you agree, once per chat", async () => {
    setRouting({ askBeforeCloud: "chat" });
    const id = await uploadPdf();
    let asked = 0;
    const first = await chat({ text: "Summarize this", attachments: [id] }, (event) => (asked++, assert.strictEqual(event.details.type, "cloud"), assert.match(event.details.reason, /report\.pdf is a PDF/), true));
    assert.strictEqual(first.text, "answer from the cloud AI");
    assert.strictEqual(asked, 1);
    const second = await chat({ chatId: first.events[0].id, text: "And the second page?", attachments: [await uploadPdf()] });
    assert.strictEqual(second.text, "answer from the cloud AI");
    assert.strictEqual(asked, 1, "remembered for this chat");
    const saved = await (await fetch(`${base}/api/chats/${first.events[0].id}`)).json();
    assert.strictEqual(saved.cloudOk, true);
    assert.strictEqual(saved.messages.at(-1).via.kind, "cloud");
  });

  test("Auto: declining the cloud keeps it local", async () => {
    setRouting({ askBeforeCloud: "always" });
    const r = await chat({ text: "Summarize this", attachments: [await uploadPdf()] }, () => false);
    assert.strictEqual(r.text, "answer from the local AI");
    assert.strictEqual(hits.cloud, 0);
  });

  test("Auto: a failing local AI falls back to the cloud", async () => {
    behave.local = { status: 500 };
    const r = await chat({ text: "hi" });
    assert.strictEqual(r.text, "answer from the cloud AI");
    assert.deepStrictEqual(r.events.filter((e) => e.type === "route").map((e) => e.kind), ["local", "cloud"]);
    assert.ok(!r.error);
  });

  test("Auto: a failing cloud AI falls back to the local one", async () => {
    behave.cloud = { status: 500 };
    const r = await chat({ text: "Summarize this", attachments: [await uploadPdf()] });
    assert.strictEqual(r.text, "answer from the local AI");
    assert.deepStrictEqual(r.events.filter((e) => e.type === "route").map((e) => e.kind), ["cloud", "local"]);
  });

  test("Auto: an empty local reply is answered by the cloud", async () => {
    behave.local = { text: "" };
    assert.strictEqual((await chat({ text: "hi" })).text, "answer from the cloud AI");
  });

  test("Dynamic: a local AI that is too slow is replaced, then avoided", async () => {
    setRouting({ mode: "dynamic" });
    behave.local = { delay: 3000 };
    const first = await chat({ text: "hi" });
    assert.strictEqual(first.text, "answer from the cloud AI");
    assert.strictEqual(hits.localAborted, 1, "the slow request was cancelled");
    behave.local = {};
    const second = await chat({ text: "hi again" });
    assert.strictEqual(second.route.kind, "cloud");
    assert.match(second.route.reason, /slow or failing/);
    assert.strictEqual(hits.local, 1, "the local AI is left alone for a while");
  });

  test("Fastest: the first to answer wins, the other is cancelled", async () => {
    setRouting({ mode: "fastest" });
    behave.local = { delay: 800 };
    const r = await chat({ text: "hi" });
    assert.strictEqual(r.text, "answer from the cloud AI");
    assert.match(r.route.reason, /cloud AI answered first/);
    await sleep(100); // the cancelled request is noticed by the fake a moment later
    assert.strictEqual(hits.localAborted, 1);
    behave = { local: {}, cloud: { delay: 800 } };
    const again = await chat({ text: "hi" });
    assert.strictEqual(again.text, "answer from the local AI");
    assert.strictEqual(again.text.includes("cloud"), false);
  });

  test("asking for the other AI for one reply", async () => {
    setRouting({ mode: "local" });
    const first = await chat({ text: "hi" });
    const again = await chat({ chatId: first.events[0].id, retry: true, from: first.events[0].replyId, force: "cloud" });
    assert.strictEqual(again.text, "answer from the cloud AI");
    assert.strictEqual(again.route.reason, "You asked the cloud AI");
  });

  test("Private mode: every mode answers locally, and the cloud is never called", async () => {
    setRouting({ mode: "cloud" }, true);
    const r = await chat({ text: "hi" });
    assert.strictEqual(r.text, "answer from the local AI");
    setRouting({ mode: "auto" }, true);
    const pdf = await chat({ text: "Summarize this", attachments: [await uploadPdf()] });
    assert.strictEqual(pdf.text, "answer from the local AI");
    assert.strictEqual(hits.cloud, 0);
  });

  test("the small jobs follow the mode: a local AI writes the follow-up chips when there is one", async () => {
    const r = await chat({ text: "hi" });
    const res = await fetch(`${base}/api/chats/${r.events[0].id}/suggestions`, { method: "POST" });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(brains.forTask().provider, "local");
    setRouting({ mode: "cloud" });
    assert.strictEqual(brains.forTask().provider, "gemini");
    setRouting({ mode: "fixed" });
  });

  test("listening and speaking: the cloud unless a local AI's voice is ready, or the mode says otherwise", async () => {
    setRouting({ mode: "auto" });
    assert.strictEqual(brains.forVoice().provider, "gemini", "local voice isn't set up here");
    setRouting({ mode: "local" });
    assert.strictEqual(brains.forVoice().provider, "local");
    setRouting({ mode: "cloud" });
    assert.strictEqual(brains.forVoice().provider, "gemini");
    setRouting({ mode: "auto" }, true);
    assert.strictEqual(brains.forVoice().provider, "local", "Private mode");
  });

  test("with no brain of the needed kind, the error says what to add", async () => {
    const cloud = brains.publicState().brains.find((b) => b.provider === "gemini");
    brains.setEnabled(cloud.id, false);
    setRouting({ mode: "cloud" });
    const r = await chat({ text: "hi" });
    assert.match(r.error, /Cloud only needs a cloud AI/);
    brains.setEnabled(cloud.id, true);
  });
});
