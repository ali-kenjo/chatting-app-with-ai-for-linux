const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-local-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.KEYRING_BACKEND = "file";
process.env.GEMINI_API_KEY = "gemini-secret-must-not-leak";
process.env.LOG_LEVEL = "error";
process.env.FRIENDS_VOICE_PORT = "58181";

const openai = require("../server/openai");
const brains = require("../server/brains");
const { start } = require("../server/server");

// A fake local AI server (OpenAI-compatible): records requests, answers like Ollama/LM Studio
const seen = [];
let toolSupport = true;
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });

  if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "tiny:latest" }, { id: "nomic-embed-text" }, { id: "big" }] }));
  if (req.url !== "/v1/chat/completions") return res.writeHead(404).end("{}");
  if (body.model === "missing") return res.writeHead(404).end(JSON.stringify({ error: { message: "model 'missing' not found" } }));
  if (body.tools && !toolSupport) return res.writeHead(400).end(JSON.stringify({ error: { message: `${body.model} does not support tools` } }));
  if (!body.stream) return res.end(JSON.stringify({ choices: [{ message: { content: "<think>hmm</think>A short reply." } }] }));

  const sse = (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const last = body.messages.at(-1);
  if (last.role === "tool") {
    sse({ content: "The note is saved." });
  } else if (/save a note/i.test(String(last.content))) {
    sse({ tool_calls: [{ index: 0, id: "call_1", function: { name: "save_note", arguments: '{"type":"user","title":"T",' } }] });
    sse({ tool_calls: [{ index: 0, function: { arguments: '"description":"d","content":"c","id":null}' } }] });
  } else {
    sse({ content: "<thi" });
    sse({ content: "nk>secret</think>Hel" });
    sse({ content: "lo wörld" });
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

let url;
before(async () => {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${fake.address().port}`;
});
after(async () => {
  await new Promise((resolve) => fake.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Local AI provider", () => {
  test("addresses are tidied and checked", () => {
    assert.strictEqual(openai.normalizeUrl("localhost:11434"), "http://localhost:11434/v1");
    assert.strictEqual(openai.normalizeUrl("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
    assert.strictEqual(openai.normalizeUrl("https://ai.example/api/v1"), "https://ai.example/api/v1");
    assert.strictEqual(openai.normalizeUrl("", { required: false }), "");
    assert.throws(() => openai.normalizeUrl(""), /address/);
    assert.throws(() => openai.normalizeUrl("ftp://x"), /http/);
    assert.throws(() => openai.normalizeUrl("http://user:pw@x"), /key field/);
  });

  test("thinking written inside a reply is dropped, even when split across pieces", () => {
    const filter = new openai.ThinkFilter();
    const out = ["a<th", "ink>x", "y</thi", "nk>\n b <", "c"].map((p) => filter.push(p)).join("") + filter.flush();
    assert.strictEqual(out, "a\n b <c");
    assert.strictEqual(openai.stripThinking("<think>a</think>\nHi"), "Hi");
  });

  test("Gemini-style messages and tools become OpenAI ones", () => {
    const messages = openai.toMessages(
      [
        { role: "user", parts: [{ text: "one" }] },
        { role: "user", parts: [{ text: "two" }, { inlineData: { mimeType: "image/png", data: "AAA" } }, { inlineData: { mimeType: "application/pdf", data: "B" } }] },
        { role: "model", parts: [{ text: "ok" }] },
      ],
      "be kind"
    );
    assert.strictEqual(messages[0].role, "system");
    assert.strictEqual(messages.length, 3); // the two user messages were merged
    assert.strictEqual(messages[1].content[2].image_url.url, "data:image/png;base64,AAA");
    assert.match(messages[1].content[3].text, /application\/pdf/);
    assert.strictEqual(messages[2].content, "ok");
    const [tool] = openai.toTools([{ name: "f", description: "d", behavior: "NON_BLOCKING", parameters: { type: "OBJECT", properties: { p: { type: "STRING", enum: ["a"] } }, required: ["p"] } }]);
    assert.deepStrictEqual(tool.function.parameters, { type: "object", properties: { p: { type: "string", enum: ["a"] } }, required: ["p"] });
  });

  test("lists chat models only, with or without a key", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    assert.deepStrictEqual(await api.listModels(""), ["tiny:latest", "big"]);
    await api.listModels("secret");
    assert.strictEqual(seen.at(-1).auth, "Bearer secret");
    await api.listModels("");
    assert.strictEqual(seen.at(-1).auth, undefined);
  });

  test("streams text, without the thinking", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    let text = "";
    await api.streamChat({ key: "", model: "tiny", contents: [{ role: "user", parts: [{ text: "hi" }] }], system: "sys", temperature: 0.4, onText: (t) => (text += t) });
    assert.strictEqual(text, "Hello wörld");
    const sent = seen.at(-1).body;
    assert.deepStrictEqual([sent.stream, sent.temperature, sent.messages[0].role], [true, 0.4, "system"]);
  });

  test("runs tool calls and sends the results back", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    let text = "";
    const ran = [];
    await api.streamChat({
      key: "",
      model: "tiny",
      contents: [{ role: "user", parts: [{ text: "Please save a note" }] }],
      tools: [{ name: "save_note", description: "d", parameters: { type: "OBJECT", properties: {}, required: [] } }],
      runTool: async (name, args) => (ran.push([name, args]), { ok: true }),
      onText: (t) => (text += t),
    });
    assert.deepStrictEqual(ran, [["save_note", { type: "user", title: "T", description: "d", content: "c" }]]);
    assert.strictEqual(text, "The note is saved.");
    const followUp = seen.at(-1).body.messages;
    assert.strictEqual(followUp.at(-2).tool_calls[0].function.name, "save_note");
    assert.strictEqual(followUp.at(-1).tool_call_id, "call_1");
  });

  test("a model that can't use tools still chats, and isn't asked again", async () => {
    toolSupport = false;
    const api = openai.create({ baseUrl: `${url}/v1` });
    const tools = [{ name: "f", description: "d", parameters: { type: "OBJECT", properties: {}, required: [] } }];
    let text = "";
    await api.streamChat({ key: "", model: "notools", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools, runTool: async () => ({}), onText: (t) => (text += t) });
    assert.strictEqual(text, "Hello wörld");
    const before = seen.length;
    await api.streamChat({ key: "", model: "notools", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools, runTool: async () => ({}), onText() {} });
    assert.strictEqual(seen.length - before, 1);
    toolSupport = true;
  });

  test("plain text replies drop the thinking too", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    assert.strictEqual(await api.generateText({ key: "", model: "tiny", prompt: "x" }), "A short reply.");
  });

  test("errors say what to do", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    await assert.rejects(api.checkModel({ key: "", model: "missing" }), /model "missing" isn't available/);
    const down = openai.create({ baseUrl: "http://127.0.0.1:1/v1" });
    await assert.rejects(down.listModels(""), /Couldn't reach the AI server/);
  });

  test("speech: listening needs a speech server, the voice is the browser's", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    await assert.rejects(api.transcribe({ key: "", audio: "AAAA" }), /local voice/);
    await assert.rejects(api.speak(), /NO_TTS/);
  });
});

describe("Local brains", () => {
  test("a local brain is saved without a key and never gets the Gemini key", async () => {
    const state = await brains.saveBrain({ provider: "local", name: "Mine", baseUrl: url, model: "tiny" });
    const brain = state.brains.find((b) => b.name === "Mine");
    assert.strictEqual(brain.baseUrl, `${url}/v1`);
    assert.strictEqual(brain.keyHint, undefined);
    const forChat = brains.getForChat(brain.id);
    assert.strictEqual(forChat.key, "");
    assert.strictEqual(forChat.api.name, "local");
    await forChat.api.listModels(forChat.key);
    assert.strictEqual(seen.at(-1).auth, undefined);
    assert.ok(!JSON.stringify(seen).includes("gemini-secret"));
  });

  test("the first model is picked when none is named; unknown models and bad servers are refused", async () => {
    const state = await brains.saveBrain({ provider: "local", name: "Auto", baseUrl: `${url}/v1` });
    assert.strictEqual(state.brains.find((b) => b.name === "Auto").model, "tiny:latest");
    await assert.rejects(brains.saveBrain({ provider: "local", baseUrl: url, model: "nope" }), /isn't available on this AI server/);
    await assert.rejects(brains.saveBrain({ provider: "local", baseUrl: "http://127.0.0.1:1", model: "x" }), /Couldn't reach/);
    await assert.rejects(brains.saveBrain({ provider: "local", model: "x" }), /address/);
  });

  test("a name without :latest finds the model, and tests report the speed", async () => {
    const state = await brains.saveBrain({ provider: "local", name: "Short", baseUrl: url, model: "tiny" });
    const brain = state.brains.find((b) => b.name === "Short");
    const result = await brains.testBrain(brain.id);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.isAvailable, true);
    const config = await brains.testConfig({ provider: "local", baseUrl: url });
    assert.strictEqual(config.model, "tiny:latest");
    assert.deepStrictEqual(await brains.listModels({ provider: "local", baseUrl: url }), ["tiny:latest", "big"]);
  });

  test("a brain keeps its provider", async () => {
    const local = brains.publicState().brains.find((b) => b.provider === "local");
    await assert.rejects(brains.saveBrain({ id: local.id, provider: "gemini", key: "k" }), /provider/);
  });
});

describe("Chatting with a local brain through the helper", () => {
  let server;
  let base;
  before(async () => {
    brains.setDefault(brains.publicState().brains.find((b) => b.name === "Mine").id);
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  const chat = async (body) => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  };

  test("replies stream, are saved, and tools work", async () => {
    const events = await chat({ text: "hello there" });
    assert.strictEqual(events.filter((e) => e.type === "text").map((e) => e.text).join(""), "Hello wörld");
    assert.strictEqual(events.at(-1).type, "done");
    const chatId = events[0].id;
    const saved = await (await fetch(`${base}/api/chats/${chatId}`)).json();
    assert.deepStrictEqual(saved.messages.map((m) => m.role), ["user", "model"]);

    const withTool = await chat({ chatId, text: "Please save a note" });
    assert.ok(withTool.some((e) => e.type === "activity" && /memory note/.test(e.text)));
    assert.strictEqual(withTool.at(-1).type, "done");
  });

  test("Live voice is Gemini only, and says so", async () => {
    const live = require("../server/live");
    assert.match(live.liveError("LIVE_NEEDS_GEMINI"), /Gemini brain/);
  });

  test("the other features answer with a local brain too", async () => {
    const { chatId } = { chatId: (await chat({ text: "again" }))[0].id };
    const res = await fetch(`${base}/api/chats/${chatId}/suggestions`, { method: "POST" });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray((await res.json()).suggestions));
    const speak = await fetch(`${base}/api/voice/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    assert.strictEqual(speak.status, 400); // the page then uses the browser's voice
    const heard = await fetch(`${base}/api/voice/transcribe`, { method: "POST", body: Buffer.alloc(100) });
    assert.match((await heard.json()).error, /local voice/);
  });
});

describe("Tools for a local AI", () => {
  test("Google tools are only offered once an account is connected", () => {
    const tools = require("../server/tools");
    const prompt = require("../server/prompt");
    const settings = require("../server/settings");
    const names = (o) => tools.declarations(settings.get(), o).map((t) => t.name);
    assert.ok(!names({ workspace: false }).includes("send_gmail"));
    assert.ok(names({ workspace: false }).includes("get_news"));
    assert.ok(names({}).includes("send_gmail"));
    const text = prompt.build(settings.get(), { toolsOffered: tools.declarations(settings.get(), { workspace: false }) });
    assert.ok(!text.includes("send_gmail") && text.includes("get_news"));
  });
});

describe("Local models and optional parameters", () => {
  test("null arguments count as not given", async () => {
    const api = openai.create({ baseUrl: `${url}/v1` });
    const seenArgs = [];
    await api.streamChat({
      key: "", model: "tiny",
      contents: [{ role: "user", parts: [{ text: "Please save a note" }] }],
      tools: [{ name: "save_note", description: "d", parameters: { type: "OBJECT", properties: {}, required: [] } }],
      runTool: async (name, args) => (seenArgs.push({ ...args, id: args.id }), { ok: true }),
      onText() {},
    });
    assert.strictEqual(seenArgs[0].id, undefined);
  });
});
