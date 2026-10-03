const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-ollama-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.KEYRING_BACKEND = "file";
process.env.GEMINI_API_KEY = "gemini-secret-must-not-leak";
process.env.LOG_LEVEL = "error";
process.env.FRIENDS_VOICE_PORT = "58181";

const openai = require("../server/openai");
const ollama = require("../server/ollama");
const local = require("../server/local");
const brains = require("../server/brains");
const settings = require("../server/settings");
const tools = require("../server/tools");
const { start } = require("../server/server");

// A fake Ollama (its own API): records what it is sent
const seen = [];
const loaded = []; // what /api/ps reports
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
  seen.push({ url: req.url, body });
  const line = (message, extra = {}) => res.write(JSON.stringify({ message, ...extra }) + "\n");

  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.1:latest" }, { name: "nomic-embed-text:latest" }] }));
  if (req.url === "/api/ps") return res.end(JSON.stringify({ models: loaded }));
  if (req.url === "/api/generate") {
    loaded.push({ name: body.model, context_length: body.options?.num_ctx });
    return res.end(JSON.stringify({ done: true, done_reason: "load" }));
  }
  if (req.url !== "/api/chat") return res.writeHead(404).end("{}");
  if (body.model === "gone") return res.writeHead(404).end(JSON.stringify({ error: "model 'gone' not found" }));
  if (body.tools && body.model === "notools") return res.writeHead(400).end(JSON.stringify({ error: `registry.ollama.ai/library/notools does not support tools` }));
  if (!body.stream) return res.end(JSON.stringify({ message: { role: "assistant", content: "<think>x</think>Plain." }, done: true }));

  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  const last = body.messages.at(-1);
  if (last.role === "tool") line({ role: "assistant", content: "Noted." });
  else if (/save a note/i.test(last.content)) line({ role: "assistant", content: "", tool_calls: [{ function: { name: "save_note", arguments: { title: "T", id: null } } }] });
  else {
    line({ role: "assistant", content: "Hel" });
    line({ role: "assistant", content: "lo ✓" });
  }
  res.write(JSON.stringify({ done: true }) + "\n");
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

describe("Ollama's own API", () => {
  test("addresses for Ollama have no /v1", () => {
    assert.strictEqual(openai.normalizeUrl("localhost:11434", { protocol: "ollama" }), "http://localhost:11434");
    assert.strictEqual(openai.normalizeUrl("http://localhost:11434/v1/", { protocol: "ollama" }), "http://localhost:11434");
    assert.strictEqual(openai.normalizeUrl("http://localhost:11434"), "http://localhost:11434/v1");
  });

  test("lists chat models, and sends the context size and keep-alive with every request", async () => {
    const api = ollama.create({ baseUrl: url, contextSize: 16384, keepAlive: 60 });
    assert.deepStrictEqual(await api.listModels(), ["llama3.1:latest"]);
    let text = "";
    await api.streamChat({ model: "llama3.1", contents: [{ role: "user", parts: [{ text: "hi" }, { inlineData: { mimeType: "image/png", data: "AAA" } }] }], system: "sys", temperature: 0.3, onText: (t) => (text += t) });
    assert.strictEqual(text, "Hello ✓");
    const sent = seen.at(-1).body;
    assert.deepStrictEqual(sent.options, { temperature: 0.3, num_ctx: 16384 });
    assert.strictEqual(sent.keep_alive, "60m");
    assert.strictEqual(sent.messages[0].role, "system");
    assert.deepStrictEqual(sent.messages[1].images, ["AAA"]);
  });

  test("without settings, Ollama's defaults are left alone", async () => {
    const api = ollama.create({ baseUrl: url });
    await api.streamChat({ model: "llama3.1", contents: [{ role: "user", parts: [{ text: "hi" }] }], onText() {} });
    const sent = seen.at(-1).body;
    assert.strictEqual(sent.options, undefined);
    assert.strictEqual(sent.keep_alive, undefined);
  });

  test("tool calls run and their results go back (null arguments are dropped)", async () => {
    const api = ollama.create({ baseUrl: url });
    const ran = [];
    let text = "";
    await api.streamChat({
      model: "llama3.1",
      contents: [{ role: "user", parts: [{ text: "Please save a note" }] }],
      tools: [{ name: "save_note", description: "d", parameters: { type: "OBJECT", properties: {}, required: [] } }],
      runTool: async (name, args) => (ran.push([name, args]), { ok: true }),
      onText: (t) => (text += t),
    });
    assert.deepStrictEqual(ran, [["save_note", { title: "T" }]]);
    assert.strictEqual(text, "Noted.");
    const messages = seen.at(-1).body.messages;
    assert.strictEqual(messages.at(-1).role, "tool");
    assert.strictEqual(messages.at(-1).tool_name, "save_note");
    assert.strictEqual(seen.at(-1).body.tools[0].function.parameters.type, "object");
  });

  test("a model without tools still chats; plain text drops thinking; errors say what to do", async () => {
    const api = ollama.create({ baseUrl: url });
    let text = "";
    await api.streamChat({ model: "notools", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools: [{ name: "f", description: "d", parameters: { type: "OBJECT" } }], runTool: async () => ({}), onText: (t) => (text += t) });
    assert.strictEqual(text, "Hello ✓");
    assert.strictEqual(await api.generateText({ model: "llama3.1", prompt: "x" }), "Plain.");
    await assert.rejects(api.checkModel({ model: "gone" }), /ollama pull gone/);
    await assert.rejects(ollama.create({ baseUrl: "http://127.0.0.1:1" }).listModels(), /Is it running/);
  });
});

describe("Warming up", () => {
  test("a model is loaded with the brain's context once, and not again while it's there", async () => {
    const api = ollama.create({ baseUrl: url, contextSize: 8192, keepAlive: 30 });
    seen.length = 0;
    assert.deepStrictEqual(await api.warm({ model: "llama3.1:latest" }), { warm: true });
    const generate = seen.find((r) => r.url === "/api/generate");
    assert.deepStrictEqual([generate.body.prompt, generate.body.options.num_ctx, generate.body.keep_alive], ["", 8192, "30m"]);
    seen.length = 0;
    assert.deepStrictEqual(await api.warm({ model: "llama3.1" }), { warm: true, already: true });
    assert.ok(!seen.some((r) => r.url === "/api/generate"));
    // loaded with another context size: loaded again with this one
    seen.length = 0;
    await ollama.create({ baseUrl: url, contextSize: 16384 }).warm({ model: "llama3.1" });
    assert.ok(seen.some((r) => r.url === "/api/generate"));
    loaded.length = 0;
  });

  test("it never throws, and the others have nothing to load", async () => {
    assert.deepStrictEqual(await ollama.create({ baseUrl: "http://127.0.0.1:1" }).warm({ model: "x" }), { warm: false });
    assert.strictEqual(openai.create({ baseUrl: url }).warm, undefined);
    const voice = require("../server/voice");
    assert.deepStrictEqual(await voice.warm(), { warm: false }); // not set up here
  });
});

describe("Finding local servers", () => {
  test("running servers are listed with their models", async () => {
    const found = await local.detect({ timeoutMs: 1000, servers: [{ label: "Fake Ollama", url, protocol: "ollama" }, { label: "Nothing", url: "http://127.0.0.1:1", protocol: "openai" }] });
    assert.deepStrictEqual(found.map((s) => [s.label, s.running, s.models]), [["Fake Ollama", true, ["llama3.1:latest"]], ["Nothing", false, []]]);
    assert.ok(local.SERVERS.some((s) => s.protocol === "ollama"));
  });
});

describe("Ollama brains and Private mode", () => {
  let server;
  let base;
  before(async () => {
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  const api = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  test("an Ollama brain keeps its context size and keep-alive; others have none", async () => {
    const state = await brains.saveBrain({ provider: "local", protocol: "ollama", name: "O", baseUrl: `${url}/v1`, model: "llama3.1", contextSize: 16384, keepAlive: 60 });
    const brain = state.brains.find((b) => b.name === "O");
    assert.deepStrictEqual([brain.protocol, brain.baseUrl, brain.contextSize, brain.keepAlive], ["ollama", url, 16384, 60]);
    assert.strictEqual(brains.getForChat(brain.id).api.protocol, "ollama");
    // 0 means "Ollama's default"; a switch to the OpenAI-style API drops the Ollama-only settings
    const again = await brains.saveBrain({ id: brain.id, provider: "local", protocol: "ollama", contextSize: 0, keepAlive: 0, model: "llama3.1" });
    assert.strictEqual(again.brains.find((b) => b.id === brain.id).contextSize, 0);
    assert.deepStrictEqual(await brains.listModels({ provider: "local", protocol: "ollama", baseUrl: url }), ["llama3.1:latest"]);
  });

  test("the local server list answers", async () => {
    const { status, json } = await api("GET", "/api/local/servers");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(json.servers) && json.servers.length >= 5);
  });

  test("Private mode is off by default and survives saving settings", () => {
    assert.strictEqual(settings.get().privacy.localOnly, false);
    assert.strictEqual(settings.sanitize({ privacy: { localOnly: "yes" } }).privacy.localOnly, false);
    assert.strictEqual(settings.sanitize({ privacy: { localOnly: true } }).privacy.localOnly, true);
  });

  test("Private mode: only local brains answer, nothing goes to Google, GitHub or news", async () => {
    const cloud = brains.publicState().brains.find((b) => b.provider === "gemini");
    const mine = brains.publicState().brains.find((b) => b.provider === "local");
    brains.setDefault(cloud.id);
    settings.set({ ...settings.get(), privacy: { localOnly: true } });
    try {
      // the Gemini default is skipped
      assert.strictEqual(brains.getForChat(cloud.id).provider, "local");
      assert.strictEqual(brains.getForChat(null).id, mine.id);
      await assert.rejects(brains.saveBrain({ provider: "gemini", key: "k", model: "m" }), /Private mode/);
      await assert.rejects(brains.listModels({ provider: "gemini", key: "k" }), /Private mode/);
      await assert.rejects(brains.testBrain(cloud.id), /Private mode/);

      const names = tools.declarations(settings.get()).map((t) => t.name);
      for (const gone of ["send_gmail", "search_drive", "search_github", "get_news"]) assert.ok(!names.includes(gone), gone);
      assert.ok(names.includes("save_note"));
      const refused = await tools.run("get_news", { query: "x" }, { settings: settings.get() });
      assert.match(refused.error, /Private mode/);

      assert.match((await api("GET", "/api/news")).json.error, /Private mode/);
      assert.deepStrictEqual((await api("GET", "/api/firebase-config")).json, {});
      const live = require("../server/live");
      assert.match(live.liveError("PRIVATE_MODE"), /Private mode/);

      // with no local brain left, the message says what to do
      brains.deleteBrain(mine.id);
      assert.throws(() => brains.getForChat(null), /Private mode/);
    } finally {
      settings.set({ ...settings.get(), privacy: { localOnly: false } });
    }
    assert.ok(tools.declarations(settings.get()).map((t) => t.name).includes("get_news"));
  });
});

describe("The page", () => {
  test("loads without the internet: no script imports another website at start", () => {
    const dir = path.join(__dirname, "..", "src", "js");
    const offenders = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(d, f.name));
        else if (/\.m?js$/.test(f.name)) {
          const text = fs.readFileSync(path.join(d, f.name), "utf8");
          if (/^\s*(import|export)\b[^;]*\bfrom\s+["']https?:/m.test(text) || /^\s*import\s+["']https?:/m.test(text)) offenders.push(f.name);
        }
      }
    };
    walk(dir);
    assert.deepStrictEqual(offenders, []);
  });
});
