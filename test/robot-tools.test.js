const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("The AI moves its robot body (tools, chat stream, prompt)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-tools-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.LOG_LEVEL = "error";

  const { start } = require("../server/server");
  const tools = require("../server/tools");
  const settings = require("../server/settings");
  const chats = require("../server/chats");
  const prompt = require("../server/prompt");
  const robot = require("../server/robot");

  // A fake Gemini: each streamed request takes the next scripted answer (a list of parts)
  const realFetch = global.fetch;
  let script = [];
  let streamed = [];
  let oneShot = [];
  let moodAnswer = "Excited.";
  const sse = (parts) => new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts } }] })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  global.fetch = async (url, options) => {
    const u = String(url);
    if (!u.includes("generativelanguage")) return realFetch(url, options);
    const body = options?.body ? JSON.parse(options.body) : null;
    if (u.includes(":streamGenerateContent")) {
      streamed.push(body);
      const next = script.length > 1 ? script.shift() : script[0];
      return sse(next ? next(body) : [{ text: "OK" }]);
    }
    if (u.includes(":generateContent")) {
      oneShot.push(body);
      return Response.json({ candidates: [{ content: { parts: [{ text: moodAnswer }] } }] });
    }
    return Response.json({ models: [] });
  };

  const call = (name, args) => ({ functionCall: { name, args } });
  const withRobot = (change) => {
    const s = settings.get();
    settings.set({ ...s, robot: { ...s.robot, ...change } });
  };

  let server;
  let base;
  before(async () => {
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    global.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    script = [];
    streamed = [];
    oneShot = [];
  });

  const chat = async (body) => {
    const res = await realFetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  };
  const names = (list) => list.map((t) => t.name);

  test("offered only while the robot is on screen, and as Settings → Robot allows", () => {
    const s = settings.get();
    assert.ok(names(tools.declarations(s, { voice: true, robot: true })).includes("robot_mood"));
    assert.ok(names(tools.declarations(s, { voice: true, robot: true })).includes("robot_gesture"));
    assert.ok(!names(tools.declarations(s, { voice: true, robot: false })).includes("robot_mood"), "not without the robot on screen");
    assert.ok(!names(tools.declarations(s, { voice: false, robot: true })).includes("robot_mood"), "text chat: off by default");
    const chatOn = { ...s, robot: { ...s.robot, aiGestures: { voice: false, chat: true } } };
    assert.ok(names(tools.declarations(chatOn, { voice: false, robot: true })).includes("robot_mood"));
    assert.ok(!names(tools.declarations(chatOn, { voice: true, robot: true })).includes("robot_mood"));
  });

  test("they list exactly the robot's moods and gestures; Live gets them non-blocking", () => {
    const list = tools.declarations(settings.get(), { voice: true, robot: true });
    const mood = list.find((t) => t.name === "robot_mood");
    const gesture = list.find((t) => t.name === "robot_gesture");
    assert.deepStrictEqual(mood.parameters.properties.mood.enum, robot.MOODS);
    assert.deepStrictEqual(gesture.parameters.properties.gesture.enum, robot.GESTURES);
    assert.strictEqual(mood.behavior, undefined);
    const live = tools.declarations(settings.get(), { voice: true, robot: true, nonBlocking: true });
    assert.strictEqual(live.find((t) => t.name === "robot_mood").behavior, "NON_BLOCKING");
    assert.strictEqual(live.find((t) => t.name === "write_draft").behavior, undefined, "other tools stay as they were");
  });

  test("a robot tool answers at once and quietly: no confirmation, no activity line", async () => {
    const seen = { robot: [], activity: [], confirm: 0 };
    const ctx = {
      settings: settings.get(),
      onRobot: (e) => seen.robot.push(e),
      onActivity: (t) => seen.activity.push(t),
      confirm: async () => (seen.confirm++, true),
    };
    const started = performance.now();
    assert.deepStrictEqual(await tools.run("robot_mood", { mood: "happy" }, ctx), { ok: true });
    assert.deepStrictEqual(await tools.run("robot_gesture", { gesture: "point_left" }, ctx), { ok: true });
    assert.ok(performance.now() - started < 50);
    assert.deepStrictEqual(seen.robot, [{ mood: "happy" }, { gesture: "point_left" }]);
    const bad = await tools.run("robot_gesture", { gesture: "moonwalk" }, ctx);
    assert.match(bad.error, /wave/);
    assert.strictEqual(seen.robot.length, 2);
    assert.deepStrictEqual(seen.activity, []);
    assert.strictEqual(seen.confirm, 0);
  });

  test("/api/chat streams robot events, and they stay out of the saved chat", async () => {
    withRobot({ aiGestures: { voice: true, chat: true } });
    script = [
      () => [call("robot_mood", { mood: "excited" }), call("robot_gesture", { gesture: "celebrate" })],
      () => [{ text: "That's huge, congratulations!" }],
    ];
    const events = await chat({ text: "I passed my exam!", robot: true });
    assert.deepStrictEqual(events.map((e) => e.type), ["chat", "robot", "robot", "text", "done"]);
    assert.strictEqual(events[1].mood, "excited");
    assert.strictEqual(events[2].gesture, "celebrate");
    assert.ok(names(streamed[0].tools[0].functionDeclarations).includes("robot_mood"));
    assert.match(streamed[0].systemInstruction.parts[0].text, /# Your body/);
    assert.match(streamed[0].systemInstruction.parts[0].text, /Never mention these tools/);
    const saved = chats.get(events[0].id).messages;
    assert.strictEqual(saved[1].text, "That's huge, congratulations!");
    assert.strictEqual(saved[1].activity, undefined);
  });

  test("without the robot on screen: no robot tools and no body in the prompt", async () => {
    withRobot({ aiGestures: { voice: true, chat: true } });
    const events = await chat({ text: "Hi" });
    assert.strictEqual(events.at(-1).type, "done");
    const offered = names(streamed[0].tools?.[0]?.functionDeclarations || []);
    assert.ok(!offered.includes("robot_mood"));
    assert.doesNotMatch(streamed[0].systemInstruction.parts[0].text, /# Your body/);
  });

  test("robot rounds don't use up the 8 rounds meant for real tools", async () => {
    withRobot({ aiGestures: { voice: true, chat: true } });
    script = [
      () => [call("robot_mood", { mood: "thinking" })],
      () => [call("robot_gesture", { gesture: "nod" })],
      () => [call("save_note", { type: "project", title: "t", description: "d", content: "c" })],
    ];
    await chat({ text: "Keep notes", robot: true });
    // 2 robot rounds on top of the usual 8 requests
    assert.strictEqual(streamed.length, 10);
  });

  test("a model that only moves the robot is stopped after a few rounds", async () => {
    withRobot({ aiGestures: { voice: true, chat: true } });
    script = [() => [call("robot_gesture", { gesture: "wave" })]];
    const events = await chat({ text: "Loop", robot: true });
    assert.strictEqual(streamed.length, 5);
    assert.strictEqual(events.at(-1).type, "done");
  });

  test("the prompt's '# Your body' asks for waves and no talk about the tools", () => {
    const list = tools.declarations(settings.get(), { voice: true, robot: true });
    const text = prompt.build(settings.get(), { voice: true, toolsOffered: list });
    assert.match(text, /# Your body/);
    assert.match(text, /robot_gesture "wave"/);
    assert.match(text, /sparingly/);
    assert.doesNotMatch(prompt.build(settings.get(), { voice: true, toolsOffered: [] }), /# Your body/);
  });

  test("Smarter moods: one small request per turn, only when it's on", async () => {
    const mood = async (body) => (await (await realFetch(`${base}/api/robot/mood`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()).mood;
    withRobot({ smartMoods: false });
    assert.strictEqual(await mood({ text: "We did it!" }), null);
    assert.strictEqual(oneShot.length, 0);
    withRobot({ smartMoods: true });
    moodAnswer = "Excited.";
    assert.strictEqual(await mood({ text: "We did it!", heard: "I passed" }), "excited");
    assert.strictEqual(oneShot.length, 1);
    assert.match(oneShot[0].contents[0].parts[0].text, /Choose from: neutral, happy/);
    moodAnswer = "Rather mysterious";
    assert.strictEqual(await mood({ text: "Hmm." }), null);
  });
});
