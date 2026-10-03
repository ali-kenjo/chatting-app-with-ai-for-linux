// A fake Ollama (local AI) and a fake Gemini (cloud AI) for tests that need both.
// behave.local / behave.cloud: { status, delay, text }
const http = require("node:http");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function create() {
  const behave = { local: {}, cloud: {} };
  const hits = { local: 0, cloud: 0 };

  const local = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "tiny:latest" }] }));
    if (req.url === "/api/chat" && body.stream === false) return res.end(JSON.stringify({ message: { content: "ok" }, done: true }));
    if (req.url === "/api/chat") {
      hits.local++;
      if (behave.local.status) return res.writeHead(behave.local.status).end(JSON.stringify({ error: "broken" }));
      await sleep(behave.local.delay || 0);
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { role: "assistant", content: behave.local.text ?? "answer from the local AI" } }) + "\n");
      return res.end(JSON.stringify({ done: true }) + "\n");
    }
    res.writeHead(404).end("{}");
  });

  const cloud = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url.startsWith("/models?")) return res.end(JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] }));
    if (req.url.includes(":generateContent")) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '["Tell me more"]' }] } }] }));
    if (req.url.includes(":streamGenerateContent")) {
      hits.cloud++;
      if (behave.cloud.status) return res.writeHead(behave.cloud.status).end(JSON.stringify({ error: { message: "broken" } }));
      await sleep(behave.cloud.delay || 0);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      return res.end(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: behave.cloud.text ?? "answer from the cloud AI" }] } }] })}\n\n`);
    }
    res.writeHead(404).end("{}");
  });

  const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = (server) => new Promise((resolve) => server.close(resolve));
  const url = (server) => `http://127.0.0.1:${server.address().port}`;

  return {
    behave,
    hits,
    localUrl: () => url(local),
    cloudUrl: () => url(cloud),
    start: async () => (await listen(local), await listen(cloud)),
    stop: async () => (await close(local), await close(cloud)),
  };
}

module.exports = { create, sleep };
