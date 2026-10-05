const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-voice-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.LOG_LEVEL = "error";
// A free port nobody listens on, so a real local voice can't interfere
process.env.FRIENDS_VOICE_PORT = "58179";
if (!process.env.FRIENDS_TEST_VOICE) process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");

const openai = require("../server/openai");
const ollama = require("../server/ollama");
const voice = require("../server/voice");

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

// A fake speech server: records what it gets
const seen = [];
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  seen.push({ url: req.url, type: req.headers["content-type"], auth: req.headers.authorization, body: Buffer.concat(chunks) });
  res.end(JSON.stringify({ text: " hello there " }));
});
let url;
before(async () => {
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${fake.address().port}/v1`;
});
after(() => new Promise((resolve) => fake.close(resolve)));

describe("Local voice", { skip: Boolean(process.env.FRIENDS_TEST_VOICE) }, () => {
  test("not set up: nothing runs, and the messages say what to do", async () => {
    const status = await voice.status();
    assert.deepStrictEqual([status.installed, status.running, status.installing], [false, false, false]);
    assert.strictEqual(await voice.ensure(), null);
    const api = openai.create({ baseUrl: "http://127.0.0.1:1/v1" });
    await assert.rejects(api.transcribe({ key: "", audio: "AAAA" }), /Settings → AI & privacy/);
    await assert.rejects(api.speak({ text: "hi" }), /NO_TTS/);
    await assert.rejects(ollama.create({ baseUrl: "http://127.0.0.1:1" }).transcribe({ key: "", audio: "AAAA" }), /local voice/);
  });

  test("a speech server set for the brain gets the recording (OpenAI-style) and replies as text", async () => {
    for (const make of [() => openai.create({ baseUrl: "http://127.0.0.1:1/v1", speechUrl: url, speechModel: "my-whisper" }), () => ollama.create({ baseUrl: "http://127.0.0.1:1", speechUrl: url, speechModel: "my-whisper" })]) {
      seen.length = 0;
      const text = await make().transcribe({ key: "k", audio: Buffer.from("RIFFdata").toString("base64") });
      assert.strictEqual(text, "hello there");
      assert.strictEqual(seen[0].url, "/v1/audio/transcriptions");
      assert.match(seen[0].type, /^multipart\/form-data/);
      assert.strictEqual(seen[0].auth, "Bearer k");
      const body = seen[0].body.toString("latin1");
      assert.ok(body.includes("my-whisper") && body.includes("RIFFdata") && body.includes('name="file"'));
    }
  });

  test("setup is refused in Private mode (it downloads), and the status answers", async () => {
    const settings = require("../server/settings");
    const { start } = require("../server/server");
    const server = start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.strictEqual((await (await fetch(`${base}/api/voice/local`)).json()).installed, false);
      settings.set({ ...settings.get(), privacy: { localOnly: true } });
      const res = await fetch(`${base}/api/voice/local/install`, { method: "POST" });
      assert.strictEqual(res.status, 400);
      assert.match((await res.json()).error, /Private mode/);
    } finally {
      settings.set({ ...settings.get(), privacy: { localOnly: false } });
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

// Needs local voice installed for real: FRIENDS_TEST_VOICE=1 FRIENDS_VOICE_DIR=<its folder> npm test
describe("Local voice, for real", { skip: !process.env.FRIENDS_TEST_VOICE || !voice.installed() }, () => {
  test("what it says, it hears again (English and German)", async () => {
    const api = openai.create({ baseUrl: "http://127.0.0.1:1/v1" });
    for (const [text, voiceName, expected] of [
      ["Hello, this is a quick test of my local voice.", "Sulafat", /quick test/i],
      ["Hallo, das ist ein kurzer Test meiner lokalen Stimme.", "Charon", /kurzer Test/i],
    ]) {
      const wav = await api.speak({ text, voice: voiceName });
      assert.strictEqual(wav.subarray(0, 4).toString(), "RIFF");
      assert.match(await api.transcribe({ key: "", audio: wav.toString("base64") }), expected);
    }
  });
});
