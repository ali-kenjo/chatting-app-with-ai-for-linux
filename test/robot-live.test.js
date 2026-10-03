const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");

// A fake Gemini Live server (as in live.test.js); each connection records what the helper sends
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
    conn.send = (msg) => socket.send(Buffer.from(JSON.stringify(msg)));
    waiting.shift()?.(conn);
  });
  server.connection = () => new Promise((resolve) => waiting.push(resolve));
  return server;
}

function openPage(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { origin: `http://127.0.0.1:${port}` });
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

describe("Gemini Live moves the robot without pausing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-live-test-"));
  const allowed = path.join(tempDir, "allowed");
  fs.mkdirSync(allowed);
  process.env.FRIENDS_DATA_DIR = path.join(tempDir, "data");
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  process.env.GEMINI_API_KEY = "test-key";

  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/models?")) {
      return Response.json({
        models: [
          { name: "models/gemini-3.8-live", supportedGenerationMethods: ["bidiGenerateContent"] },
          { name: "models/gemini-3.1-flash-live-preview", supportedGenerationMethods: ["bidiGenerateContent"] },
        ],
      });
    }
    return new Response("{}", { status: 404 });
  };

  const settings = require("../server/settings");
  const chats = require("../server/chats");
  let gemini;
  let server;
  let port;

  before(async () => {
    gemini = fakeGemini();
    await once(gemini, "listening");
    process.env.FRIENDS_LIVE_UPSTREAM = `ws://127.0.0.1:${gemini.address().port}`;
    const s = settings.get();
    // A tool that waits for your OK: creating a file
    settings.set({
      ...s,
      permissions: { ...s.permissions, folders: [allowed], files: { ...s.permissions.files, create: true }, askBeforeActing: true },
    });
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

  const names = (setup) => (setup.tools.find((t) => t.functionDeclarations)?.functionDeclarations || []).map((f) => f.name);

  async function connect(start) {
    const page = openPage(port);
    await once(page.ws, "open");
    const upstream = gemini.connection();
    page.send({ type: "start", ...start });
    const conn = await upstream;
    const { setup } = await conn.next((m) => m.setup);
    return { page, conn, setup };
  }

  test("Gemini 3.8 Live gets the robot tools as non-blocking, with '# Your body'", async () => {
    const { page, conn, setup } = await connect({ robot: true });
    assert.strictEqual(setup.model, "models/gemini-3.8-live");
    const declarations = setup.tools.find((t) => t.functionDeclarations).functionDeclarations;
    const mood = declarations.find((f) => f.name === "robot_mood");
    assert.strictEqual(mood.behavior, "NON_BLOCKING");
    assert.ok(declarations.some((f) => f.name === "robot_gesture" && f.behavior === "NON_BLOCKING"));
    assert.match(setup.systemInstruction.parts[0].text, /# Your body/);
    conn.send({ setupComplete: {} });
    assert.strictEqual((await page.next("ready")).robotTools, true);
    page.ws.close();
  });

  test("picking the Robot style mid-session resumes Live with the robot tools, between turns", async () => {
    const { page, conn, setup } = await connect({ robot: false });
    assert.ok(!names(setup).includes("robot_mood"));
    conn.send({ setupComplete: {} });
    await page.next("ready");
    conn.send({ sessionResumptionUpdate: { newHandle: "h1", resumable: true } });

    // It's talking: the switch waits for the end of its turn
    conn.send({ serverContent: { outputTranscription: { text: "Hello there" } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = gemini.connection();
    page.send({ type: "robot", on: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(conn.socket.readyState, WebSocket.OPEN);
    conn.send({ serverContent: { turnComplete: true } });

    const resumed = await next;
    const { setup: again } = await resumed.next((m) => m.setup);
    assert.ok(names(again).includes("robot_mood"));
    assert.match(again.systemInstruction.parts[0].text, /# Your body/);
    assert.strictEqual(again.sessionResumption.handle, "h1");
    assert.ok(!page.events.some((e) => e.type === "reconnecting"));
    page.ws.close();
  });

  test("without the robot on screen, Live gets no robot tools", async () => {
    const { page, setup } = await connect({ robot: false });
    assert.ok(!names(setup).includes("robot_mood"));
    assert.doesNotMatch(setup.systemInstruction.parts[0].text, /# Your body/);
    page.ws.close();
  });

  test("a robot call is answered at once and SILENT, even while another tool waits for you", async () => {
    const { page, conn } = await connect({ robot: true });
    conn.send({ setupComplete: {} });
    await page.next("ready");

    // A file tool that needs your OK...
    conn.send({ toolCall: { functionCalls: [{ id: "slow-1", name: "create_file", args: { path: path.join(allowed, "a.txt"), content: "x" } }] } });
    const confirm = await page.next("confirm");
    // ...and, while it waits, a robot move and more of its voice
    conn.send({ toolCall: { functionCalls: [{ id: "robot-1", name: "robot_gesture", args: { gesture: "wave" } }] } });
    const move = await page.next("robot");
    assert.deepStrictEqual({ gesture: move.gesture }, { gesture: "wave" });
    const answer = await conn.next((m) => m.toolResponse);
    assert.deepStrictEqual(answer.toolResponse.functionResponses, [{ id: "robot-1", name: "robot_gesture", response: { ok: true, scheduling: "SILENT" } }]);
    const voice = Buffer.from([5, 0, 6, 0]);
    conn.send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: voice.toString("base64") } }] } } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepStrictEqual(page.audio.at(-1), voice, "its voice keeps coming while the file waits");
    assert.ok(!conn.messages.some((m) => m.toolResponse?.functionResponses?.some((r) => r.id === "slow-1")), "the file still waits");

    // You allow the file; that answer comes after
    page.send({ type: "confirm", id: confirm.id, allow: true });
    const slow = await conn.next((m) => m.toolResponse?.functionResponses?.some((r) => r.id === "slow-1"));
    assert.strictEqual(slow.toolResponse.functionResponses[0].response.ok, true);
    page.ws.close();
  });

  test("robot moves aren't saved as steps in the chat", async () => {
    const { page, conn } = await connect({ robot: true });
    conn.send({ setupComplete: {} });
    await page.next("ready");
    conn.send({ toolCall: { functionCalls: [{ id: "m1", name: "robot_mood", args: { mood: "happy" } }] } });
    assert.strictEqual((await page.next("robot")).mood, "happy");
    conn.send({ serverContent: { outputTranscription: { text: "Hey, good to see you!" } } });
    conn.send({ serverContent: { turnComplete: true } });
    const { id } = await page.next("chat");
    const [message] = chats.get(id).messages;
    assert.strictEqual(message.text, "Hey, good to see you!");
    assert.strictEqual(message.activity, undefined);
    page.ws.close();
  });

  test("on a model that only calls tools blocking, the robot follows captions instead", async () => {
    const { page, conn, setup } = await connect({ robot: true });
    assert.ok(names(setup).includes("robot_mood"));
    // 3.8 isn't available: the next model only has synchronous function calling
    const second = gemini.connection();
    conn.socket.close(1008, "models/gemini-3.8-live is not found for API version v1beta");
    const b = await second;
    const { setup: fallback } = await b.next((m) => m.setup);
    assert.strictEqual(fallback.model, "models/gemini-3.1-flash-live-preview");
    assert.ok(!names(fallback).includes("robot_mood"));
    assert.doesNotMatch(fallback.systemInstruction.parts[0].text, /# Your body/);
    b.send({ setupComplete: {} });
    assert.strictEqual((await page.next("ready")).robotTools, false);
    page.ws.close();
  });
});
