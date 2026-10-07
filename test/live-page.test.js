// The page's side of Gemini Live (src/js/live.js) with a fake audio context and a fake WebSocket
const { test, describe, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class FakeSocket {
  static all = [];
  constructor() {
    this.readyState = 0;
    this.sent = [];
    FakeSocket.all.push(this);
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(event) {
    this.onmessage?.({ data: typeof event === "string" ? event : JSON.stringify(event) });
  }
}
FakeSocket.OPEN = 1;
FakeSocket.CONNECTING = 0;

function fakeContext() {
  const ctx = {
    currentTime: 10,
    outputLatency: 0,
    destination: {},
    audioWorklet: { addModule: () => ctx.loading },
    loading: Promise.resolve(),
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    createBuffer: (channels, length, rate) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, buffer: null }),
  };
  return ctx;
}

describe("Gemini Live, the page's side", () => {
  let LiveVoice;
  const realWebSocket = globalThis.WebSocket;

  before(async () => {
    // i18n.js (imported by live.js) touches the page at start-up
    globalThis.document = { documentElement: {}, body: { hasAttribute: () => true } };
    Object.defineProperty(globalThis, "navigator", { value: { languages: ["en-US"], language: "en-US" }, configurable: true }); // English, whatever this computer speaks
    globalThis.location = { protocol: "http:", host: "localhost:3000" };
    globalThis.AudioWorkletNode = class {
      constructor() {
        this.port = {};
      }
      connect() {}
      disconnect() {}
    };
    ({ LiveVoice } = await import(pathToFileURL(path.join(__dirname, "..", "src", "js", "live.js"))));
  });

  const made = [];
  beforeEach(() => {
    FakeSocket.all = [];
    globalThis.WebSocket = FakeSocket;
  });
  afterEach(() => {
    for (const voice of made.splice(0)) voice.stop(); // its timers would keep the test run alive
  });

  const make = (ctx = fakeContext(), handlers = {}, extra = {}) => {
    const voice = new LiveVoice({ audioCtx: ctx, micSource: { connect() {}, disconnect() {} }, output: {}, handlers, ...extra });
    made.push(voice);
    return voice;
  };
  const ready = async (voice) => {
    const starting = voice.start({});
    await new Promise((resolve) => setImmediate(resolve));
    const socket = FakeSocket.all.at(-1);
    socket.open();
    socket.message({ type: "ready" });
    await starting;
    return socket;
  };
  // ~1 s of its voice, from "now"
  const speak = (voice, seconds = 1) => voice.play(new Int16Array(24000 * seconds).buffer);

  test("stopped while the microphone loads: no connection is opened behind your back", async () => {
    const ctx = fakeContext();
    let loaded;
    ctx.loading = new Promise((resolve) => (loaded = resolve));
    const voice = make(ctx);
    const starting = voice.start({});
    voice.stop(); // voice mode closed, or another engine picked
    loaded();
    await assert.rejects(starting, /closed/);
    assert.strictEqual(FakeSocket.all.length, 0);
  });

  test("its voice and the room's echo are held back from Gemini, and the speakers' delay counts", async () => {
    const ctx = fakeContext();
    ctx.outputLatency = 0.2;
    const voice = make(ctx);
    const socket = await ready(voice);
    const chunk = new Int16Array(640).buffer;
    speak(voice); // plays from 10.08 to 11.08
    ctx.currentTime = 11.5; // 0.42 s after it ended: the echo tail (0.35 s + the speakers' 0.2 s) isn't over
    voice.fromMic({ pcm: chunk, level: 0.001 });
    assert.strictEqual(socket.sent.filter((d) => typeof d !== "string").length, 0);
    ctx.currentTime = 11.7; // past the tail
    voice.fromMic({ pcm: chunk, level: 0.001 });
    assert.strictEqual(socket.sent.filter((d) => typeof d !== "string").length, 1);
  });

  test("an echo turn: its answer isn't played, the helper is told, and the next answer is", async () => {
    const voice = make();
    const socket = await ready(voice);
    voice.dropEcho();
    assert.deepStrictEqual(JSON.parse(socket.sent.at(-1)), { type: "echo" });
    speak(voice);
    assert.strictEqual(voice.sources.size, 0, "the answer to the echo isn't played");
    socket.message({ type: "turn-complete" });
    speak(voice);
    assert.strictEqual(voice.sources.size, 1, "the next answer is");
    voice.stop();
  });

  test("a connection that was lost mid-answer doesn't leave the next answer silenced", async () => {
    const voice = make();
    const socket = await ready(voice);
    speak(voice);
    assert.ok(voice.turnOpen);
    voice.silence(); // you cut in; Gemini's own "interrupted" never comes, the connection dropped
    assert.ok(voice.dropAudio);
    socket.message({ type: "reconnecting" });
    socket.message({ type: "resumed" });
    speak(voice);
    assert.strictEqual(voice.sources.size, 1);
    voice.stop();
  });

  test("an echo answer that never ends doesn't silence the conversation for long", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const voice = make();
    await ready(voice);
    voice.dropEcho();
    assert.ok(voice.dropAudio);
    t.mock.timers.tick(6000);
    assert.ok(!voice.dropAudio);
    voice.stop();
  });

  test("muting stops what it is saying at once, and doesn't tell Gemini your turn ended", async () => {
    const voice = make();
    const socket = await ready(voice);
    speak(voice, 5);
    assert.strictEqual(voice.sources.size, 1);
    voice.setMuted(true);
    assert.strictEqual(voice.sources.size, 0, "what was queued is cut");
    assert.ok(voice.playEnd <= voice.ctx.currentTime);
    const sent = socket.sent.filter((d) => typeof d === "string").map((d) => JSON.parse(d));
    assert.deepStrictEqual(sent.at(-1), { type: "mute", on: true });
    assert.ok(!sent.some((m) => m.type === "audio-end"));
    // the rest of that answer, and one that hadn't started, aren't played while you're muted
    speak(voice);
    assert.strictEqual(voice.sources.size, 0);
    voice.fromMic({ pcm: new Int16Array(640).buffer, level: 0.5 });
    assert.strictEqual(socket.sent.filter((d) => typeof d !== "string").length, 0, "nothing of you is sent");
  });

  test("unmuting: the next answer is heard again", async () => {
    const voice = make();
    const socket = await ready(voice);
    voice.setMuted(true);
    voice.setMuted(false);
    assert.deepStrictEqual(JSON.parse(socket.sent.at(-1)), { type: "mute", on: false });
    speak(voice);
    assert.strictEqual(voice.sources.size, 1);
  });

  test("typing to it while muted still gets an answer out loud", async () => {
    const voice = make();
    await ready(voice);
    voice.setMuted(true);
    voice.sendText("what time is it?");
    speak(voice);
    assert.strictEqual(voice.sources.size, 1);
  });

  test("how easily your voice cuts in follows the setting", async () => {
    const { bargeProfile } = await import(pathToFileURL(path.join(__dirname, "..", "src", "js", "barge.mjs")));
    const cutsIn = async (sensitivity, level) => {
      const ctx = fakeContext();
      let interrupted = 0;
      const voice = make(ctx, { onInterrupted: () => interrupted++ }, { barge: () => bargeProfile(sensitivity) });
      await ready(voice);
      speak(voice, 5);
      ctx.currentTime += 1; // past what's spent learning how loud its echo is
      for (let i = 0; i < 40; i++) {
        voice.fromMic({ pcm: new Int16Array(640).buffer, level });
        ctx.currentTime += 0.04;
      }
      return interrupted > 0;
    };
    assert.strictEqual(await cutsIn("easy", 0.04), true, "a quiet voice cuts in when it's easy");
    assert.strictEqual(await cutsIn("hard", 0.04), false, "but not when it's hard");
    assert.strictEqual(await cutsIn("hard", 0.3), true, "a clearly loud voice always does");
  });
});
