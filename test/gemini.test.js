const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert");

process.env.FRIENDS_GEMINI_RETRY_MS = "0";
const gemini = require("../server/gemini");

// A fake Gemini API: records requests, answers from `reply(url, body)`
function fakeFetch(reply) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    return reply(url, body);
  };
  return calls;
}

const sse = (text) =>
  new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`, { status: 200 });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

describe("Gemini requests", () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  test("quick replies on 2.5 Flash skip thinking", async () => {
    const calls = fakeFetch(() => sse("hi"));
    let text = "";
    await gemini.streamChat({ key: "k1", model: "gemini-2.5-flash", contents: [], fast: true, onText: (t) => (text += t) });
    assert.strictEqual(text, "hi");
    assert.deepStrictEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });

  test("normal replies and other models keep their default thinking", async () => {
    const calls = fakeFetch(() => sse("hi"));
    await gemini.streamChat({ key: "k2", model: "gemini-2.5-flash", contents: [], temperature: 0.5, onText() {} });
    await gemini.streamChat({ key: "k2", model: "gemini-2.5-pro", contents: [], fast: true, onText() {} });
    assert.strictEqual(calls[0].body.generationConfig.thinkingConfig, undefined);
    assert.strictEqual(calls[1].body.generationConfig, undefined);
  });

  test("quick replies on Gemini 3.x think at the lowest level they all accept", async () => {
    const calls = fakeFetch(() => sse("hi"));
    await gemini.streamChat({ key: "k4", model: "gemini-3.8-flash", contents: [], fast: true, onText() {} });
    assert.deepStrictEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  });

  test("generateText returns the reply as plain text", async () => {
    const calls = fakeFetch(() => json({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "A summary." }] } }] }));
    const text = await gemini.generateText({ key: "k5", model: "gemini-3.8-flash", prompt: "Summarize" });
    assert.strictEqual(text, "A summary.");
    assert.match(calls[0].url, /gemini-3\.8-flash:generateContent$/);
  });

  test("Live models: the ones the key has, known good ones first", async () => {
    fakeFetch(() => json({ models: [
      { name: "models/gemini-9-live", supportedGenerationMethods: ["bidiGenerateContent"] },
      { name: "models/gemini-3.8-live-extended-thinking", supportedGenerationMethods: ["bidiGenerateContent"] },
      { name: "models/gemini-3.5-transcribe-live", supportedGenerationMethods: ["bidiGenerateContent"] },
      { name: "models/gemini-3.5-live-translate-preview", supportedGenerationMethods: ["bidiGenerateContent"] },
      { name: "models/gemini-3.8-live", supportedGenerationMethods: ["bidiGenerateContent"] },
    ] }));
    assert.deepStrictEqual(await gemini.liveModels("k6"), ["gemini-3.8-live", "gemini-9-live"]);
  });

  test("Live models: without a list, the known ones are tried", async () => {
    fakeFetch(() => json({ error: { message: "nope" } }, 500));
    assert.deepStrictEqual(await gemini.liveModels("k7"), gemini.LIVE_MODELS);
  });

  test("fallbacks skip models the key doesn't have", async () => {
    const calls = fakeFetch((url) => {
      if (url.includes("/models?")) return json({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
      if (url.includes("gemini-2.5-pro")) return json({ error: { message: "quota" } }, 429);
      return sse("ok");
    });
    let text = "";
    await gemini.streamChat({ key: "k3", model: "gemini-2.5-pro", contents: [], onText: (t) => (text += t) });
    assert.strictEqual(text, "ok");
    const tried = calls.filter((c) => c.url.includes(":stream")).map((c) => c.url.match(/models\/([^:]+):/)[1]);
    assert.deepStrictEqual(tried, ["gemini-2.5-pro", "gemini-2.5-flash"]);
  });

  test("a retired model is skipped after its first 404, also for plain text requests", async () => {
    const calls = fakeFetch((url) => {
      if (url.includes("/models?")) return json({ models: ["gemini-2.5-flash", "gemini-3.8-flash"].map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ["generateContent"] })) });
      if (url.includes("gemini-2.5-flash")) return json({ error: { message: "This model models/gemini-2.5-flash is no longer available to new users." } }, 404);
      if (url.includes(":stream")) return sse("ok");
      return json({ candidates: [{ content: { parts: [{ text: "fine" }] } }] });
    });
    await gemini.streamChat({ key: "k8", model: "gemini-2.5-flash", contents: [], onText() {} });
    assert.strictEqual(await gemini.generateText({ key: "k8", model: "gemini-2.5-flash", prompt: "x" }), "fine");
    const used = calls.filter((c) => c.url.includes("Content")).map((c) => c.url.match(/models\/([^:]+):/)[1]);
    assert.deepStrictEqual(used, ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-3.8-flash"]);
  });

  test("checkModel reports a retired model, which the models list still names", async () => {
    fakeFetch(() => json({ error: { message: "This model models/gemini-2.5-flash is no longer available to new users." } }, 404));
    await assert.rejects(gemini.checkModel({ key: "k9", model: "gemini-2.5-flash" }), /retired/);
  });

  test("a passing 500 from Gemini is tried once more", async () => {
    let n = 0;
    fakeFetch(() => (++n === 1 ? json({ error: { message: "Internal error" } }, 500) : sse("back")));
    let text = "";
    await gemini.streamChat({ key: "k10", model: "gemini-3.8-flash", contents: [], onText: (t) => (text += t) });
    assert.strictEqual(text, "back");
    assert.strictEqual(n, 2);
  });
});
