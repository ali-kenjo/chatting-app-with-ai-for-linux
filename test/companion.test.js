// Characters, the memory of conversations, follow-ups, activities, co-host
// mode and the spoken greeting: through the real helper with a fake local AI.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-companion-test-"));
const seen = []; // what the fake AI was asked: { system, messages }
let answer = "Hi, it's me.";

const fakeLocal = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:latest" }] }));
  if (req.url === "/api/chat" && body.stream === false) {
    // generateText: the episode writer asks for JSON
    const prompt = body.messages.at(-1).content;
    if (/long-term memory/.test(prompt)) {
      return res.end(JSON.stringify({ message: { content: '```json\n{"title":"Interview nerves","summary":"They have a job interview on Friday and are nervous.","topics":["job","interview"],"mood":"nervous","followUps":["Ask how the job interview on Friday went"],"resolved":[]}\n```' }, done: true }));
    }
    return res.end(JSON.stringify({ message: { content: "ok" }, done: true }));
  }
  if (req.url === "/api/chat") {
    seen.push({ system: body.messages[0]?.content || "", messages: body.messages, tools: (body.tools || []).map((t) => t.function?.name) });
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write(JSON.stringify({ message: { role: "assistant", content: answer } }) + "\n");
    return res.end(JSON.stringify({ done: true }) + "\n");
  }
  res.writeHead(404).end("{}");
});

let server;
let base;
let settings;
let brains;
let episodes;
let chats;
let prompt;
let tools;
let characters;

async function chat(body) {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const events = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { events, text: events.filter((e) => e.type === "text").map((e) => e.text).join(""), chat: events.find((e) => e.type === "chat") };
}

before(async () => {
  await new Promise((resolve) => fakeLocal.listen(0, "127.0.0.1", resolve));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  delete process.env.GEMINI_API_KEY;
  settings = require("../server/settings");
  brains = require("../server/brains");
  episodes = require("../server/episodes");
  chats = require("../server/chats");
  prompt = require("../server/prompt");
  tools = require("../server/tools");
  characters = require("../server/characters");
  const { start } = require("../server/server");
  await brains.saveBrain({ provider: "local", protocol: "ollama", name: "Local", baseUrl: `http://127.0.0.1:${fakeLocal.address().port}`, model: "tiny" });
  server = start(0, "127.0.0.1");
  await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
  settings.set({ ...settings.get(), personality: { ...settings.get().personality, userName: "Sam" } });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fakeLocal.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Characters", () => {
  test("Atlas and Mira are built in, Atlas answers first, and edits are kept", () => {
    const s = settings.get();
    assert.deepStrictEqual(s.characters.list.map((c) => c.id), ["atlas", "mira"]);
    assert.strictEqual(characters.active(s).name, "Atlas");
    const list = s.characters.list.map((c) => (c.id === "mira" ? { ...c, name: "Mila", catchphrases: "" } : c));
    const saved = settings.set({ ...s, characters: { ...s.characters, list } });
    const mira = saved.characters.list.find((c) => c.id === "mira");
    assert.strictEqual(mira.name, "Mila");
    assert.strictEqual(mira.catchphrases, "", "an emptied part stays empty");
    assert.match(mira.humor, /teasing/, "untouched parts keep the original");
    settings.set({ ...saved, characters: { ...saved.characters, list: s.characters.list } });
  });

  test("bad input is cleaned: unknown voices, too many characters, a missing active one", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, voice: "Nope", gender: "robot" }));
    const out = characters.sanitize({ list: many, active: "gone" });
    assert.strictEqual(out.list.length, characters.MAX_CHARACTERS);
    assert.strictEqual(out.active, "atlas");
    const c = out.list.find((x) => x.id === "c0");
    assert.strictEqual(c.voice, "Sulafat");
    assert.strictEqual(c.gender, "female");
  });

  test("a name given to the AI before characters existed becomes your own character", () => {
    const old = { personality: { name: "Jarvis", voice: 2, style: "Funny" } };
    const migrated = characters.migrate(old, old.personality);
    assert.strictEqual(migrated.active, "custom-1");
    assert.strictEqual(migrated.list[0].name, "Jarvis");
    assert.strictEqual(migrated.list[0].voice, "Charon");
    assert.strictEqual(characters.migrate({ characters: {} }, {}), null, "only once");
    assert.strictEqual(characters.migrate({ personality: { name: "" } }, { name: "" }).active, "atlas");
  });

  test("the active character answers, with its own opinions; another character's replies are marked", async () => {
    seen.length = 0;
    const first = await chat({ text: "Who are you?" });
    assert.match(seen[0].system, /^You are Atlas, talking with Sam/);
    assert.match(seen[0].system, /Bone-dry understatement/);
    const saved = chats.get(first.chat.id);
    assert.strictEqual(saved.messages.at(-1).by, "atlas");

    const s = settings.get();
    settings.set({ ...s, characters: { ...s.characters, active: "mira" } });
    await chat({ chatId: first.chat.id, text: "And now?" });
    assert.match(seen[1].system, /^You are Mira/);
    const atlasLine = seen[1].messages.find((m) => m.role === "assistant");
    assert.match(atlasLine.content, /^\[Atlas, another of the user's AI characters, said:\]/);
    settings.set({ ...settings.get(), characters: { ...settings.get().characters, active: "atlas" } });
  });

  test("each character speaks with its own voice; local voices go by gender", () => {
    const s = settings.get();
    assert.deepStrictEqual(characters.voiceOf(characters.active(s)), { name: "Charon", gender: "male" });
    assert.deepStrictEqual(characters.voiceOf(s.characters.list[1]), { name: "Sulafat", gender: "female" });
    assert.ok(characters.GEMINI_VOICES.length >= 30);
  });
});

describe("Remembering conversations", () => {
  let chatId;

  test("a quiet chat becomes an episode with a follow-up", async () => {
    const r = await chat({ text: "I have a job interview on Friday and I'm nervous." });
    chatId = r.chat.id;
    await chat({ chatId, text: "Any tips?" });
    const brain = brains.forTask();
    const episode = await episodes.update(chatId, brain, { character: "atlas" });
    assert.strictEqual(episode.title, "Interview nerves");
    assert.strictEqual(episode.mood, "nervous");
    assert.strictEqual(episode.upTo, 4);
    const open = episodes.followUps();
    assert.strictEqual(open.length, 1);
    assert.match(open[0].text, /job interview/);
    assert.deepStrictEqual(await episodes.update(chatId, brain), episodes.read(chatId), "nothing new: unchanged");
  });

  test("only chats that have been quiet a while are written up", () => {
    const now = Date.now();
    assert.ok(!episodes.due(now).includes(chatId), "it has its episode");
    const quiet = chats.list().find((c) => c.id !== chatId);
    assert.ok(episodes.due(now + episodes.IDLE_MS + 1000).includes(quiet.id));
    assert.ok(!episodes.due(now).includes(quiet.id), "not while it's still going");
  });

  test("a new conversation starts with what it remembers and what to ask about", () => {
    const text = prompt.build(settings.get(), { toolsOffered: tools.declarations(settings.get()) });
    assert.match(text, /# What you remember[\s\S]*Interview nerves/);
    assert.match(text, /# Things to follow up on[\s\S]*Ask how the job interview on Friday went/);
    assert.match(text, /never mention that you keep notes/);
    assert.doesNotMatch(prompt.build(settings.get(), { chatId }), /Interview nerves/, "not about the chat it's in");
  });

  test("recall_conversations finds it, and a follow-up can be resolved", async () => {
    const found = await tools.run("recall_conversations", { query: "interview" }, { settings: settings.get() });
    assert.strictEqual(found.conversations[0].title, "Interview nerves");
    const id = episodes.followUps()[0].id;
    assert.deepStrictEqual(await tools.run("resolve_follow_up", { id }, { settings: settings.get() }), { ok: true, text: "Ask how the job interview on Friday went" });
    assert.strictEqual(episodes.followUps().length, 0);
    assert.match((await tools.run("resolve_follow_up", { id }, { settings: settings.get() })).error, /no open follow-up/);
  });

  test("turned off: no memory in the prompt and no recall tools", () => {
    const s = structuredClone(settings.get());
    s.companion.recall = false;
    assert.doesNotMatch(prompt.build(s, {}), /# What you remember/);
    assert.ok(!tools.declarations(s).some((t) => t.name === "recall_conversations"));
  });

  test("deleting a chat forgets its episode; the API lists and clears them", async () => {
    let list = await (await fetch(`${base}/api/episodes`)).json();
    assert.strictEqual(list.episodes.length, 1);
    await fetch(`${base}/api/chats/${chatId}`, { method: "DELETE" });
    list = await (await fetch(`${base}/api/episodes`)).json();
    assert.strictEqual(list.episodes.length, 0);
  });
});

describe("Co-host mode and the greeting", () => {
  test("on camera: nothing private in the prompt, no private tools", () => {
    const s = structuredClone(settings.get());
    s.memory.items = [{ id: "1", text: "My address is 1 Secret Street" }];
    s.permissions.folders = ["/tmp"];
    const offered = tools.declarations(s, { onAir: true });
    const names = offered.map((t) => t.name);
    for (const hidden of ["search_gmail", "get_calendar_events", "read_file", "recall_conversations"]) assert.ok(!names.includes(hidden), hidden);
    const text = prompt.build(s, { onAir: true, toolsOffered: offered });
    assert.match(text, /# On camera/);
    assert.match(text, /co-hosting with Sam/);
    assert.match(text, /The straight man of the duo/);
    assert.doesNotMatch(text, /Secret Street/);
    const off = prompt.build(s, { toolsOffered: tools.declarations(s) });
    assert.match(off, /Secret Street/);
    assert.doesNotMatch(off, /# On camera/);
    s.onAir.hidePrivate = false;
    assert.match(prompt.build(s, { onAir: true }), /Secret Street/, "when you allow it");
  });

  test("the greeting: the AI speaks first and nothing of yours is saved", async () => {
    seen.length = 0;
    answer = "Hey Sam, good to see you.";
    const r = await chat({ greet: true, voice: true });
    assert.strictEqual(r.text, "Hey Sam, good to see you.");
    assert.match(seen[0].messages.at(-1).content, /App note, not from Sam: Sam just opened voice mode/);
    const saved = chats.get(r.chat.id);
    assert.strictEqual(saved.title, "Voice conversation");
    assert.deepStrictEqual(saved.messages.map((m) => m.role), ["model"]);
    // What you say next names the chat
    await chat({ chatId: r.chat.id, text: "Let's plan my week", voice: true });
    assert.strictEqual(chats.get(r.chat.id).title, "Let's plan my week");
  });

  test("activities and the character choices are served", async () => {
    const { activities } = await (await fetch(`${base}/api/activities`)).json();
    assert.ok(activities.length >= 12 && activities.every((a) => a.id && a.prompt && a.title));
    const meta = await (await fetch(`${base}/api/characters/meta`)).json();
    assert.ok(meta.voices.some((v) => v.name === "Charon"));
    assert.ok(meta.builtin.atlas && meta.builtin.mira);
    assert.ok(meta.formats.includes("podcast"));
  });
});
