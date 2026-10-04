// Connected apps: the safe web fetcher, each app against a fake of its API,
// the Google extras, and MCP (a fake server over stdio and one over HTTP).
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-connectors-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.KEYRING_BACKEND = "file";
process.env.LOG_LEVEL = "error";
delete process.env.GEMINI_API_KEY;

const net = require("../server/net");
const connectors = require("../server/connectors");
const tools = require("../server/tools");
const settings = require("../server/settings");
const workspace = require("../server/workspace");
const mcp = require("../server/mcp");

const realFetch = global.fetch;
let routes = []; // [RegExp, (url, init) => body | { status, body }]
const calls = [];
function fakeFetch(url, init = {}) {
  calls.push({ url: String(url), init });
  const hit = routes.find(([re]) => re.test(String(url)));
  if (!hit) return realFetch(url, init);
  const out = hit[1](String(url), init);
  const { status = 200, body } = out && out.status ? out : { body: out };
  return Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const ctx = (extra = {}) => ({ settings: settings.get(), confirm: async () => true, onActivity: () => {}, ...extra });

before(() => (global.fetch = fakeFetch));
after(() => {
  global.fetch = realFetch;
  mcp.stopAll();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("The safe web fetcher", () => {
  test("private and local addresses are refused", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.178.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
      assert.ok(net.isPrivateAddress(ip), ip);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1"]) assert.ok(!net.isPrivateAddress(ip), ip);
  });

  test("it won't open this computer, even by name", async () => {
    await assert.rejects(net.readPage("http://127.0.0.1:1/"), /private network/);
    await assert.rejects(net.readPage("http://localhost:1/"), /private network/);
    await assert.rejects(net.readPage("http://[::1]/"), /private network/);
    await assert.rejects(net.readPage("file:///etc/passwd"), /Only http and https/);
    await assert.rejects(net.readPage("http://user:pw@example.com"), /password/);
  });

  test("HTML becomes readable text, the article first", () => {
    const html = `<html><head><title>My &amp; Page</title><style>.x{}</style><script>alert(1)</script></head><body><nav>Menu</nav>
      <article><h1>Big news</h1><p>First &quot;line&quot;.</p><ul><li>One</li><li>Two</li></ul><p>${"Long text. ".repeat(60)}</p></article><footer>©</footer></body></html>`;
    const { title, text } = net.htmlToText(html);
    assert.strictEqual(title, "My & Page");
    assert.match(text, /# Big news/);
    assert.match(text, /First "line"\./);
    assert.match(text, /- One\n- Two/);
    assert.doesNotMatch(text, /alert|Menu|©/);
  });
});

describe("Apps", () => {
  test("the free ones are on by default; the ones with accounts need setting up", () => {
    const apps = connectors.list(settings.get());
    const by = Object.fromEntries(apps.map((a) => [a.id, a]));
    assert.ok(by.weather.config.enabled && by.web.config.enabled && by.wikipedia.config.enabled);
    assert.ok(!by.github.config.enabled && !by.github.ready);
    const names = tools.declarations(settings.get()).map((t) => t.name);
    assert.ok(names.includes("get_weather") && names.includes("web_search") && names.includes("read_webpage"));
    assert.ok(!names.includes("github_my_repos"));
  });

  test("weather: the place is found, the forecast comes in words", async () => {
    routes = [
      [/geocoding-api/, () => ({ results: [{ name: "Berlin", admin1: "Berlin", country: "Germany", latitude: 52.5, longitude: 13.4 }] })],
      [/api\.open-meteo\.com/, () => ({ current: { temperature_2m: 14.6, apparent_temperature: 12.1, relative_humidity_2m: 70, weather_code: 61, wind_speed_10m: 12 }, daily: { time: ["2030-01-01"], weather_code: [3], temperature_2m_max: [16], temperature_2m_min: [9], precipitation_probability_max: [40], sunrise: ["2030-01-01T07:10"], sunset: ["2030-01-01T18:20"] } })],
    ];
    connectors.save("weather", { place: "Berlin" });
    const r = await tools.run("get_weather", {}, ctx());
    assert.strictEqual(r.weather.place, "Berlin, Berlin, Germany");
    assert.strictEqual(r.weather.now.condition, "light rain");
    assert.strictEqual(r.weather.now.temperature, "15°C");
    assert.strictEqual(r.weather.days[0].rainChance, "40%");
    const brief = await tools.briefing({ settings: { ...settings.get(), privacy: { localOnly: false }, life: { briefingNews: false } } });
    assert.strictEqual(brief.weather.place, "Berlin, Berlin, Germany", "the briefing has the weather");
  });

  test("wikipedia and currency", async () => {
    routes = [
      [/search\/page/, () => ({ pages: [{ key: "Ada_Lovelace", title: "Ada Lovelace" }] })],
      [/page\/summary/, () => ({ title: "Ada Lovelace", description: "English mathematician", extract: "Ada was…", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Ada_Lovelace" } } })],
      [/frankfurter/, (url) => ({ date: "2030-01-01", rates: { USD: 1.1 } })],
    ];
    const w = await tools.run("wikipedia", { query: "Ada Lovelace" }, ctx());
    assert.strictEqual(w.article.summary, "Ada was…");
    const c = await tools.run("convert_currency", { amount: 10, from: "eur", to: "usd" }, ctx());
    assert.strictEqual(c.result, 11);
    assert.match((await tools.run("convert_currency", { amount: 1, from: "euro", to: "usd" }, ctx())).error, /three-letter/);
  });

  test("GitHub: a token makes its tools appear; creating an issue asks first", async () => {
    connectors.save("github", { enabled: true, token: "ghp_test" });
    assert.ok(tools.declarations(settings.get()).some((t) => t.name === "github_create_issue"));
    assert.ok(!tools.declarations(settings.get(), { onAir: true }).some((t) => t.name === "github_my_repos"), "not on camera");
    assert.ok(!JSON.stringify(connectors.list(settings.get())).includes("ghp_test"), "the token never goes to the page");
    routes = [[/api\.github\.com\/repos\/me\/app\/issues/, (url, init) => (init.method === "POST" ? { number: 7, html_url: "https://github.com/me/app/issues/7" } : [{ number: 1, title: "Bug", state: "open", user: { login: "me" }, labels: [] }])]];
    let asked = null;
    const declined = await tools.run("github_create_issue", { repo: "me/app", title: "Idea" }, ctx({ confirm: async (s) => ((asked = s), false) }));
    assert.match(asked, /Open the issue "Idea" in me\/app/);
    assert.match(declined.error, /declined/);
    const made = await tools.run("github_create_issue", { repo: "https://github.com/me/app", title: "Idea" }, ctx());
    assert.strictEqual(made.number, 7);
    assert.strictEqual(calls.at(-1).init.headers.Authorization, "Bearer ghp_test");
    const issues = await tools.run("github_issues", { repo: "me/app" }, ctx());
    assert.strictEqual(issues.issues[0].title, "Bug");
    assert.match((await tools.run("github_issues", { repo: "not a repo" }, ctx())).error, /owner\/name/);
  });

  test("Notion: Markdown becomes blocks, links become page ids", () => {
    const notion = require("../server/connectors/notion");
    const blocks = notion.toBlocks("# Title\n- one\n- [x] done\n1. first\nText");
    assert.deepStrictEqual(blocks.map((b) => b.type), ["heading_1", "bulleted_list_item", "to_do", "numbered_list_item", "paragraph"]);
    assert.strictEqual(blocks[2].to_do.checked, true);
    assert.strictEqual(notion.idOf("https://www.notion.so/My-Page-0123456789abcdef0123456789abcdef"), "01234567-89ab-cdef-0123-456789abcdef");
  });

  test("Home Assistant: devices, switching, risky things ask, and it works in Private mode at home", async () => {
    connectors.save("homeassistant", { enabled: true, url: "http://192.168.1.20:8123", token: "ha-token" });
    routes = [
      [/\/api\/states/, () => [{ entity_id: "light.living_room", state: "on", attributes: { friendly_name: "Living room", brightness: 200 } }, { entity_id: "lock.front_door", state: "locked", attributes: { friendly_name: "Front door" } }, { entity_id: "automation.x", state: "on", attributes: {} }]],
      [/\/api\/services\//, () => []],
    ];
    const devices = await tools.run("home_devices", {}, ctx());
    assert.deepStrictEqual(devices.devices.map((d) => d.id), ["light.living_room", "lock.front_door"]);
    let asked = 0;
    const c = ctx({ confirm: async () => (asked++, true) });
    await tools.run("home_control", { entity_id: "light.living_room", action: "turn_on", value: 40 }, c);
    assert.strictEqual(asked, 0, "lights don't ask");
    assert.match(calls.at(-1).url, /\/api\/services\/light\/turn_on$/);
    assert.deepStrictEqual(JSON.parse(calls.at(-1).init.body), { entity_id: "light.living_room", brightness_pct: 40 });
    await tools.run("home_control", { entity_id: "lock.front_door", action: "unlock" }, c);
    assert.strictEqual(asked, 1, "locks ask");
    assert.match(calls.at(-1).url, /\/api\/services\/lock\/unlock$/);
    const priv = { ...settings.get(), privacy: { localOnly: true } };
    const names = tools.declarations(priv).map((t) => t.name);
    assert.ok(names.includes("home_control"), "on your own network: allowed in Private mode");
    assert.ok(!names.includes("web_search") && !names.includes("github_my_repos"), "the internet ones aren't");
  });

  test("the web search falls back to DuckDuckGo without a Gemini brain", async () => {
    const web = require("../server/connectors/web");
    const html = `<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example <b>A</b></a>
      <a class="result__snippet" href="#">About &amp; more</a>`;
    const html2 = html + `<a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>`;
    assert.deepStrictEqual(web.parseDuckDuckGo(html2), [{ title: "Example A", url: "https://example.com/a", snippet: "About & more" }]);
  });
});

describe("Google extras", () => {
  test("errors say what to do", () => {
    assert.match(workspace.explain("Request had insufficient authentication scopes."), /Sign out and in again/);
    assert.match(workspace.explain("Google Tasks API has not been used in project 1 before or it is disabled"), /Google Tasks API is off/);
  });

  test("an email's text, plain or from HTML", () => {
    const b64 = (s) => Buffer.from(s).toString("base64url");
    assert.strictEqual(workspace.messageText({ parts: [{ mimeType: "text/plain", body: { data: b64("Hello Sam") } }, { mimeType: "text/html", body: { data: b64("<p>x</p>") } }] }), "Hello Sam");
    assert.strictEqual(workspace.messageText({ mimeType: "text/html", body: { data: b64("<p>Hi <b>there</b></p>") } }), "Hi there");
  });

  test("the tools are offered with Google, and the essential few to a local AI", () => {
    const all = tools.declarations(settings.get());
    for (const n of ["youtube_my_channel", "youtube_comments", "google_add_task", "draft_gmail", "read_gmail", "update_calendar_event"]) assert.ok(all.some((t) => t.name === n), n);
    const local = tools.forLocal(all, settings.get()).map((t) => t.name);
    assert.ok(local.includes("add_task") && local.includes("get_weather") && !local.includes("youtube_comments"));
    assert.strictEqual(tools.forLocal(all, { ...settings.get(), aiControl: { localTools: "all" } }).length, all.length);
  });
});

describe("MCP", () => {
  test("JSON Schema becomes Gemini's schema", () => {
    const s = mcp.toSchema({ type: "object", properties: { a: { type: ["string", "null"] }, b: { anyOf: [{ type: "null" }, { type: "integer" }] }, c: { type: "array", items: { type: "object", properties: { x: { type: "boolean" } } } }, d: { enum: ["x", 1] } }, required: ["a", "zz"] });
    assert.deepStrictEqual(s, { type: "OBJECT", properties: { a: { type: "STRING" }, b: { type: "INTEGER" }, c: { type: "ARRAY", items: { type: "OBJECT", properties: { x: { type: "BOOLEAN" } } } }, d: { type: "STRING", enum: ["x"] } }, required: ["a"] });
    assert.deepStrictEqual(mcp.splitArgs(`-y "@a/b c" 'd e' f`), ["-y", "@a/b c", "d e", "f"]);
    assert.deepStrictEqual(mcp.parseEnv("A=1\n bad line\nB_2 = two"), { A: "1", B_2: "two" });
  });

  test("a server on this computer: started, its tools offered, read-only ones trusted", async () => {
    const saved = mcp.save({ name: "Fake Notes", transport: "stdio", command: process.execPath, args: path.join(__dirname, "helpers", "fake-mcp.js"), env: "FAKE_SECRET=s3cret", trust: "read-only" });
    assert.ok(saved.hasEnv && !JSON.stringify(saved).includes("s3cret"));
    await mcp.restart(saved.id);
    const item = mcp.list().find((s) => s.id === saved.id);
    assert.strictEqual(item.status, "ready", item.error);
    assert.deepStrictEqual(item.tools.map((t) => t.name), ["echo", "add-note"]);
    const decl = tools.declarations(settings.get()).find((t) => t.name === "mcp_fake_notes_echo");
    assert.ok(decl);
    assert.match(decl.description, /^\[Fake Notes\] Says it back/);
    assert.deepStrictEqual(decl.parameters.required, ["text"]);

    let asked = 0;
    const c = ctx({ confirm: async () => (asked++, true) });
    const r = await tools.run("mcp_fake_notes_echo", { text: "hi", loud: true }, c);
    assert.deepStrictEqual(r, { ok: true, result: "HI (env s3cret)" });
    assert.strictEqual(asked, 0, "read-only: no question");
    const bad = await tools.run("mcp_fake_notes_add_note", { note: "x" }, c);
    assert.strictEqual(asked, 1, "the rest asks");
    assert.strictEqual(bad.error, "notes are full");

    // Private mode: only servers marked as working on this computer
    const priv = { ...settings.get(), privacy: { localOnly: true } };
    assert.ok(!tools.declarations(priv).some((t) => t.name.startsWith("mcp_")));
    mcp.save({ id: saved.id, local: true });
    await mcp.restart(saved.id);
    assert.ok(tools.declarations(priv).some((t) => t.name === "mcp_fake_notes_echo"));
    assert.ok(!tools.declarations(settings.get(), { onAir: true }).some((t) => t.name.startsWith("mcp_")), "not on camera");
    mcp.remove(saved.id);
    assert.ok(!tools.declarations(settings.get()).some((t) => t.name.startsWith("mcp_")));
  });

  test("a command that isn't installed says so", async () => {
    const s = mcp.save({ name: "Missing", transport: "stdio", command: "friends-no-such-command-xyz" });
    await mcp.restart(s.id);
    const item = mcp.list().find((x) => x.id === s.id);
    assert.strictEqual(item.status, "error");
    assert.match(item.error, /isn't installed/);
    mcp.remove(s.id);
  });

  test("a server at an address (Streamable HTTP, answering with an event stream)", async () => {
    let session = null;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (req.method === "DELETE") return res.end();
      const m = JSON.parse(Buffer.concat(chunks));
      if (req.headers.authorization !== "Bearer t0k") return res.writeHead(401).end();
      if (m.method === "initialize") {
        session = "sess-1";
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": session });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      }
      assert.strictEqual(req.headers["mcp-session-id"], session);
      if (m.id === undefined) return res.writeHead(202).end();
      const result = m.method === "tools/list" ? { tools: [{ name: "time", description: "The time", inputSchema: { type: "object" } }] } : { content: [{ type: "text", text: "12:00" }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const s = mcp.save({ name: "Clock", transport: "http", url: `http://127.0.0.1:${server.address().port}/mcp`, token: "t0k", trust: "all" });
    await mcp.restart(s.id);
    assert.strictEqual(mcp.list().find((x) => x.id === s.id).status, "ready");
    assert.deepStrictEqual(await tools.run("mcp_clock_time", {}, ctx()), { ok: true, result: "12:00" });
    mcp.remove(s.id);
    server.close();
  });
});
