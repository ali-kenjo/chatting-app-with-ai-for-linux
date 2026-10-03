const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert");

process.env.FRIENDS_GEMINI_RETRY_MS = "0";
const gemini = require("../server/gemini");
const workspace = require("../server/workspace");

const part = (p) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [p] } }] })}`;

describe("Gemini streaming and fallbacks", () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  test("the last event counts even without a final newline", async () => {
    global.fetch = async () => new Response(`${part({ text: "one " })}\n\n${part({ text: "two" })}`, { status: 200 });
    let text = "";
    await gemini.streamChat({ key: "h1", model: "gemini-3.8-flash", contents: [], onText: (t) => (text += t) });
    assert.strictEqual(text, "one two");
  });

  test("a damaged event doesn't throw away the reply", async () => {
    global.fetch = async () => new Response(`data: {oops\n\n${part({ text: "fine" })}\n\n`, { status: 200 });
    let text = "";
    await gemini.streamChat({ key: "h2", model: "gemini-3.8-flash", contents: [], onText: (t) => (text += t) });
    assert.strictEqual(text, "fine");
  });

  test("after a tool ran, a rate limit doesn't start over on another model", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return new Response(part({ functionCall: { name: "send_gmail", args: {} } }) + "\n\n", { status: 200 });
      return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
    };
    let ran = 0;
    await assert.rejects(
      gemini.streamChat({ key: "h3", model: "gemini-3.8-flash", contents: [], tools: [{ name: "send_gmail" }], runTool: async () => (ran++, { ok: true }), onText() {} }),
      (err) => err.status === 429
    );
    assert.strictEqual(ran, 1);
    assert.strictEqual(calls, 2);
  });
});

describe("Gmail", () => {
  test("an address with a line break can't add headers", async () => {
    await assert.rejects(workspace.sendGmail("token", { to: "a@b.com\r\nBcc: x@y.com", subject: "s", body: "b" }), /valid email/);
    await assert.rejects(workspace.sendGmail("token", { to: "a@b.com, c@d.com", subject: "s", body: "b" }), /valid email/);
  });
});
