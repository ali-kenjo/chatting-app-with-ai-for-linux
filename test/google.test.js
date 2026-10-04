// Staying signed in to Google (server/google.js), against a fake Google.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-google-test-"));
const seen = [];
let refreshAnswer = null; // null: fine; "invalid_grant": revoked

const fakeGoogle = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
  seen.push({ url: req.url, form });
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/token" && form.grant_type === "authorization_code") {
    return res.end(JSON.stringify({ access_token: "access-1", expires_in: 3600, refresh_token: "refresh-1" }));
  }
  if (req.url === "/token" && form.grant_type === "refresh_token") {
    if (refreshAnswer) return res.writeHead(400).end(JSON.stringify({ error: refreshAnswer, error_description: "Token has been expired or revoked." }));
    return res.end(JSON.stringify({ access_token: "access-2", expires_in: 3600 }));
  }
  if (req.url === "/userinfo") return res.end(JSON.stringify({ email: "sam@example.org", name: "Sam", picture: "" }));
  res.writeHead(404).end("{}");
});

let google;
let server;
let base;

before(async () => {
  await new Promise((resolve) => fakeGoogle.listen(0, "127.0.0.1", resolve));
  const g = `http://127.0.0.1:${fakeGoogle.address().port}`;
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";
  process.env.LOG_LEVEL = "error";
  process.env.FRIENDS_GOOGLE_TOKEN = `${g}/token`;
  process.env.FRIENDS_GOOGLE_USERINFO = `${g}/userinfo`;
  google = require("../server/google");
  server = require("../server/server").start(0, "127.0.0.1");
  await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fakeGoogle.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Staying signed in to Google", () => {
  test("not set up: nothing to sign in with, and the client is checked", async () => {
    assert.deepStrictEqual(google.status(), { configured: false, connected: false, clientId: "", account: null });
    assert.throws(() => google.setClient({ clientId: "nope", clientSecret: "x" }), /client ID doesn't look right/);
    assert.throws(() => google.start("http://localhost:1"), /Set up/);
    assert.strictEqual(await google.token(), null);
  });

  test("set up: the sign-in address asks for lasting access, with PKCE", async () => {
    const s = google.setClient({ clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret-value" });
    assert.strictEqual(s.configured, true);
    assert.ok(!JSON.stringify(s).includes("GOCSPX"), "the secret never goes to the page");
    const res = await fetch(`${base}/api/google/signin`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);
    const to = new URL(res.headers.get("location"));
    assert.strictEqual(to.hostname, "accounts.google.com");
    assert.strictEqual(to.searchParams.get("access_type"), "offline");
    assert.strictEqual(to.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(to.searchParams.get("redirect_uri"), `${base}/api/google/callback`);
    assert.match(to.searchParams.get("scope"), /youtube\.readonly/);
    assert.throws(() => google.start("https://evil.example"), /localhost/);
  });

  test("coming back from Google: signed in, and it stays that way", async () => {
    const res = await fetch(`${base}/api/google/signin`, { redirect: "manual" });
    const state = new URL(res.headers.get("location")).searchParams.get("state");
    const page = await (await fetch(`${base}/api/google/callback?code=the-code&state=${state}`)).text();
    assert.match(page, /You're signed in/);
    const exchange = seen.find((r) => r.form.grant_type === "authorization_code");
    assert.strictEqual(exchange.form.code, "the-code");
    assert.ok(exchange.form.code_verifier && exchange.form.client_secret === "GOCSPX-secret-value");
    const status = await (await fetch(`${base}/api/google/status`)).json();
    assert.strictEqual(status.connected, true);
    assert.strictEqual(status.account.email, "sam@example.org");
    assert.strictEqual((await (await fetch(`${base}/api/google/token`)).json()).accessToken, "access-1");
    // An old or made-up state is refused
    assert.match(await (await fetch(`${base}/api/google/callback?code=x&state=${state}`)).text(), /expired/);
  });

  test("the token is renewed with the refresh token; a revoked one signs out", async () => {
    // As if Friends had restarted: nothing in memory, only the keyring
    delete require.cache[require.resolve("../server/google")];
    const fresh = require("../server/google");
    assert.strictEqual(await fresh.token(), "access-2");
    assert.strictEqual(seen.at(-1).form.refresh_token, "refresh-1");
    delete require.cache[require.resolve("../server/google")];
    const again = require("../server/google");
    refreshAnswer = "invalid_grant";
    assert.strictEqual(await again.token(), null);
    assert.strictEqual(again.status().connected, false);
    refreshAnswer = null;
  });

  test("Private mode: no Google", async () => {
    const settings = require("../server/settings");
    settings.set({ ...settings.get(), privacy: { localOnly: true } });
    assert.deepStrictEqual(await (await fetch(`${base}/api/google/status`)).json(), { private: true });
    assert.match(await (await fetch(`${base}/api/google/signin`)).text(), /Private mode/);
    settings.set({ ...settings.get(), privacy: { localOnly: false } });
  });
});
