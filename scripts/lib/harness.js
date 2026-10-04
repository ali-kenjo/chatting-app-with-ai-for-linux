// Shared by scripts/design-shots.js and scripts/a11y.js: the real helper on a scratch data
// folder with a fake Ollama, many seeded chats, and a Chrome driven by puppeteer-core.
// Nothing of yours is read or written, and the page can't reach other websites.
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..", "..");

const REPLY = [
  "Sure. Here's a small example, the formula, and a diagram.",
  "",
  "```js",
  "function greet(name) {",
  "  return `Hello, ${name}!`;",
  "}",
  "```",
  "",
  "Euler's identity: $e^{i\\pi} + 1 = 0$, and the quadratic formula:",
  "",
  "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$",
  "",
  "```mermaid",
  "graph LR; A[Idea] --> B[Draft] --> C[Ship]",
  "```",
  "",
  "مرحباً! هذه جملة بالعربية مع English and Deutsch gemischt.",
].join("\n");

const TITLES = ["Planning the weekend trip", "Explain ingress controllers", "كيف أحسّن نومي؟", "Recipe: pasta carbonara", "Bug in my login form", "Gedichte für Oma", "Ideas for the next video", "Budget for October", "Learning Rust", "What is a monad?", "Birthday present ideas", "Train times to Berlin"];

function findChrome() {
  return [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && fs.existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { base, page, api, behave, fakeUrl, tempDir, setLook, addLocalBrain, removeBrains, close }
async function launch() {
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome found (set CHROME_PATH).");

  const behave = { text: REPLY, status: 0 };
  const fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }, { name: "phi4-mini:latest" }] }));
    if (req.url === "/api/chat") {
      const body = JSON.parse(Buffer.concat(chunks));
      if (!body.stream) return res.end(JSON.stringify({ message: { content: '["Tell me more","Show another example","Thanks!"]' }, done: true }));
      if (behave.status) return res.writeHead(behave.status).end(JSON.stringify({ error: "broken" }));
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ message: { role: "assistant", content: behave.text }, done: false }) + "\n");
      return res.end(JSON.stringify({ done: true }) + "\n");
    }
    res.writeHead(404).end("{}");
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-ui-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.FRIENDS_VOICE_DIR = path.join(tempDir, "voice");
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  delete process.env.GEMINI_API_KEY;
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  process.env.FRIENDS_LOCAL_SERVERS = JSON.stringify([{ label: "Fake Ollama", url: fakeUrl, protocol: "ollama" }]);

  // Many chats for the sidebar, spread over a few days
  const chatsDir = path.join(tempDir, "chats");
  fs.mkdirSync(chatsDir, { recursive: true });
  const day = 86400000;
  TITLES.forEach((title, i) => {
    const id = crypto.randomUUID();
    const t = Date.now() - i * day * 0.7 - 60000;
    fs.writeFileSync(
      path.join(chatsDir, `${id}.json`),
      JSON.stringify({ id, title, createdAt: t, updatedAt: t, messages: [{ id: crypto.randomUUID(), role: "user", text: title, at: t }, { id: crypto.randomUUID(), role: "model", text: "Happy to help with that.", at: t }] })
    );
  });

  const { start } = require(path.join(root, "server", "server"));
  const server = start(0, "127.0.0.1");
  await new Promise((r) => (server.listening ? r() : server.on("listening", r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (method, url, body) => fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader", "--lang=en-US"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:", "about:"].includes(u.protocol)) return req.abort();
    req.continue();
  });
  page.on("pageerror", (e) => console.log("  page error:", e.message));

  const removeBrains = async () => {
    for (const b of (await api("GET", "/api/brains")).brains || []) await api("DELETE", `/api/brains/${b.id}`);
  };
  const addLocalBrain = async () => {
    if (!((await api("GET", "/api/brains")).brains || []).length) await api("POST", "/api/brains", { provider: "local", protocol: "ollama", name: "llama3.2", baseUrl: fakeUrl, model: "llama3.2:latest", contextSize: 8192 });
  };
  // Theme, language and viewport; onboarding off unless asked, then a fresh load
  const setLook = async ({ theme = "dark", width = 1280, height, lang = "en", onboarding = true } = {}) => {
    const s = await api("GET", "/api/settings");
    await api("PUT", "/api/settings", { ...s, theme: { ...s.theme, appearance: theme }, ui: { ...(s.ui || {}), language: lang }, onboarding: { ...(s.onboarding || {}), done: onboarding } });
    await page.setViewport({ width, height: height || (width < 500 ? 844 : 900), deviceScaleFactor: 1, isMobile: width < 500, hasTouch: width < 500 });
    await page.goto(base + "/", { waitUntil: "networkidle2" });
    await sleep(400);
  };

  const close = async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    fake.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return { base, page, api, behave, fakeUrl, tempDir, setLook, addLocalBrain, removeBrains, close, REPLY };
}

module.exports = { launch, sleep, root };
