const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");

// A fake Gemini Live server; each connection records what the helper sends
function fakeGemini() {
  const server = new WebSocketServer({ port: 0 });
  const waiting = [];
  server.on("connection", (socket, req) => {
    const conn = { socket, req, messages: [], waiters: [] };
    socket.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      conn.messages.push(msg);
      conn.waiters = conn.waiters.filter((w) => !(w.match(msg) && (w.resolve(msg), true)));
    });
    conn.next = (match) =>
      new Promise((resolve) => {
        const seen = conn.messages.find(match);
        if (seen) resolve(seen);
        else conn.waiters.push({ match, resolve });
      });
    // Gemini sends its JSON in binary frames
    conn.send = (msg) => socket.send(Buffer.from(JSON.stringify(msg)));
    waiting.shift()?.(conn);
  });
  server.connection = () => new Promise((resolve) => waiting.push(resolve));
  return server;
}

// The page's side: events as they arrive, binary audio separately
function openPage(port, origin = `http://127.0.0.1:${port}`) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { origin });
  const page = { ws, events: [], audio: [], waiters: [] };
  ws.on("message", (data, isBinary) => {
    if (isBinary) return page.audio.push(Buffer.from(data));
    const event = JSON.parse(data.toString());
    page.events.push(event);
    page.waiters = page.waiters.filter((w) => !(w.match(event) && (w.resolve(event), true)));
  });
  page.next = (type) =>
    new Promise((resolve) => {
      const match = (e) => e.type === type && !e.seen && (e.seen = true);
      const seen = page.events.find(match);
      if (seen) resolve(seen);
      else page.waiters.push({ match, resolve });
    });
  page.send = (msg) => ws.send(JSON.stringify(msg));
  return page;
}

describe("Gemini Live bridge", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-live-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  process.env.GEMINI_API_KEY = "test-key";

  // The key's models list: two Live models
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/models?")) {
      return new Response(JSON.stringify({
        models: [
          { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-3.8-live", supportedGenerationMethods: ["bidiGenerateContent"] },
          { name: "models/gemini-3.1-flash-live-preview", supportedGenerationMethods: ["bidiGenerateContent"] },
        ],
      }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };

  let gemini;
  let server;
  let port;
  const chats = require("../server/chats");
  const settings = require("../server/settings");

  before(async () => {
    gemini = fakeGemini();
    await once(gemini, "listening");
    process.env.FRIENDS_LIVE_UPSTREAM = `ws://127.0.0.1:${gemini.address().port}`;
    settings.set({ ...settings.get(), personality: { ...settings.get().personality, userName: "Sam", voice: 2 } });
    server = require("../server/server").start(0, "127.0.0.1");
    if (!server.listening) await once(server, "listening");
    port = server.address().port;
  });

  after(async () => {
    global.fetch = realFetch;
    gemini.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("other websites can't open a live connection", async () => {
    const page = openPage(port, "https://evil.example");
    const [err] = await once(page.ws, "error");
    assert.match(err.message, /403/);
  });

  test("a spoken conversation: setup, voices both ways, a draft, saved turns", async () => {
    const page = openPage(port);
    await once(page.ws, "open");
    const upstream = gemini.connection();
    page.send({ type: "start", chatId: null });
    const conn = await upstream;
    assert.strictEqual(conn.req.headers["x-goog-api-key"], "test-key");

    const { setup } = await conn.next((m) => m.setup);
    assert.strictEqual(setup.model, "models/gemini-3.8-live");
    assert.deepStrictEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
    assert.strictEqual(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Charon");
    assert.match(setup.systemInstruction.parts[0].text, /You are Atlas/);
    assert.match(setup.systemInstruction.parts[0].text, /Sam/);
    assert.deepStrictEqual(setup.tools[0], { googleSearch: {} });
    assert.ok(setup.tools[1].functionDeclarations.some((f) => f.name === "write_draft"));
    assert.deepStrictEqual(setup.contextWindowCompression, { slidingWindow: {} });
    assert.deepStrictEqual(setup.sessionResumption, {});
    assert.deepStrictEqual(setup.inputAudioTranscription, {});
    assert.deepStrictEqual(setup.outputAudioTranscription, {});

    conn.send({ setupComplete: {} });
    assert.strictEqual((await page.next("ready")).model, "gemini-3.8-live");

    // It greets first; that note from the app isn't saved as something you said
    const greeting = await conn.next((m) => m.realtimeInput?.text);
    assert.match(greeting.realtimeInput.text, /App note/);
    const voice = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    conn.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: voice.toString("base64") } }] }, outputTranscription: { text: "Evening, Sam." } } });
    conn.send({ serverContent: { turnComplete: true } });
    await page.next("turn-complete");
    assert.deepStrictEqual(page.audio[0], voice);
    const created = await page.next("chat");
    assert.strictEqual(created.title, "Voice conversation");

    // Your voice goes to Gemini as 16 kHz PCM
    page.ws.send(Buffer.from([9, 8, 7, 6]));
    const heard = await conn.next((m) => m.realtimeInput?.audio);
    assert.deepStrictEqual(heard.realtimeInput.audio, { data: Buffer.from([9, 8, 7, 6]).toString("base64"), mimeType: "audio/pcm;rate=16000" });

    // You ask for a script; it writes a draft instead of reading it out
    conn.send({ serverContent: { inputTranscription: { text: "Write me a hook" } } });
    assert.strictEqual((await page.next("transcript")).text, "Evening, Sam.");
    conn.send({ toolCall: { functionCalls: [{ id: "call-1", name: "write_draft", args: { title: "Hook", kind: "script", content: "Stop scrolling." } }] } });
    const { draft } = await page.next("draft");
    assert.strictEqual(draft.title, "Hook");
    const answer = await conn.next((m) => m.toolResponse);
    assert.strictEqual(answer.toolResponse.functionResponses[0].id, "call-1");
    assert.strictEqual(answer.toolResponse.functionResponses[0].response.ok, true);
    conn.send({ serverContent: { outputTranscription: { text: "It's in your drafts." } } });
    conn.send({ serverContent: { turnComplete: true } });
    await page.next("turn-complete");

    const renamed = await page.next("chat");
    assert.strictEqual(renamed.title, "Write me a hook");
    const chat = chats.get(created.id);
    assert.deepStrictEqual(chat.messages.map((m) => [m.role, m.text]), [
      ["model", "Evening, Sam."],
      ["user", "Write me a hook"],
      ["model", "It's in your drafts."],
    ]);
    assert.strictEqual(chat.messages[2].drafts[0].content, "Stop scrolling.");
    page.ws.close();
  });

  test("a new session in an old chat gets the conversation so far", async () => {
    const chat = chats.list()[0];
    const page = openPage(port);
    await once(page.ws, "open");
    const upstream = gemini.connection();
    page.send({ type: "start", chatId: chat.id });
    const conn = await upstream;
    const { setup } = await conn.next((m) => m.setup);
    assert.match(setup.systemInstruction.parts[0].text, /# This conversation so far[\s\S]*Sam: Write me a hook/);
    conn.send({ setupComplete: {} });
    const greeting = await conn.next((m) => m.realtimeInput?.text);
    assert.match(greeting.realtimeInput.text, /welcome them back/);
    page.ws.close();
  });

  test("when Gemini ends the connection, the same session continues", async () => {
    const page = openPage(port);
    await once(page.ws, "open");
    const first = gemini.connection();
    page.send({ type: "start" });
    const a = await first;
    await a.next((m) => m.setup);
    a.send({ setupComplete: {} });
    await page.next("ready");
    a.send({ sessionResumptionUpdate: { newHandle: "handle-1", resumable: true } });

    const second = gemini.connection();
    a.send({ goAway: { timeLeft: "10s" } });
    await page.next("reconnecting");
    const b = await second;
    const { setup } = await b.next((m) => m.setup);
    assert.deepStrictEqual(setup.sessionResumption, { handle: "handle-1" });
    b.send({ setupComplete: {} });
    await page.next("resumed");
    page.ws.close();
  });

  test("a key that can't be used gives a clear error", async () => {
    const page = openPage(port);
    await once(page.ws, "open");
    const upstream = gemini.connection();
    page.send({ type: "start" });
    const conn = await upstream;
    await conn.next((m) => m.setup);
    conn.socket.close(1008, "API key not valid. Please pass a valid API key.");
    assert.strictEqual((await page.next("error")).error, "Gemini Live didn't accept your API key.");
  });

  test("when a Live model isn't available, the next one is tried", async () => {
    const page = openPage(port);
    await once(page.ws, "open");
    const first = gemini.connection();
    page.send({ type: "start" });
    const a = await first;
    const tried = (await a.next((m) => m.setup)).setup.model;
    const second = gemini.connection();
    a.socket.close(1008, `${tried} is not found for API version v1beta, or is not supported for bidiGenerateContent`);
    const b = await second;
    const next = (await b.next((m) => m.setup)).setup.model;
    assert.notStrictEqual(next, tried);
    b.send({ setupComplete: {} });
    assert.strictEqual((await page.next("ready")).model, next.replace("models/", ""));
    page.ws.close();
  });
});
