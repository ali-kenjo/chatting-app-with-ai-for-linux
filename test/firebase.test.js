const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-firebase-test-"));
process.env.FRIENDS_DATA_DIR = tempDir;
process.env.FRIENDS_VOICE_PORT = "58185";
process.env.LOG_LEVEL = "error";

const firebase = require("../server/firebase");
const { start } = require("../server/server");

const KEY = "AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY123";
const snippet = `// Import the functions you need
const firebaseConfig = {
  apiKey: "${KEY}",
  authDomain: "demo-app.firebaseapp.com",
  projectId: "demo-app",
  storageBucket: "demo-app.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};
const app = initializeApp(firebaseConfig);`;

describe("Google sign-in setup", () => {
  test("the snippet from the Firebase console, JSON, or an object all work", () => {
    const expected = { apiKey: KEY, authDomain: "demo-app.firebaseapp.com", projectId: "demo-app", storageBucket: "demo-app.firebasestorage.app", messagingSenderId: "1234567890", appId: "1:1234567890:web:abcdef123456" };
    assert.deepStrictEqual(firebase.parse(snippet), expected);
    assert.deepStrictEqual(firebase.parse(JSON.stringify(expected)), expected);
    assert.deepStrictEqual(firebase.parse(expected), expected);
    assert.strictEqual(firebase.parse(`{ apiKey: '${KEY}', projectId: 'p', appId: 'a' }`).authDomain, "p.firebaseapp.com");
  });

  test("something else is refused, and says what's missing", () => {
    assert.throws(() => firebase.parse(""), /apiKey, projectId, appId are missing/);
    assert.throws(() => firebase.parse('{ "apiKey": "x", "projectId": "p", "appId": "a" }'), /apiKey doesn't look right/);
    assert.throws(() => firebase.parse("const a = 1;"), /Firebase web config/);
  });

  describe("through the helper", () => {
    let server;
    let base;
    before(async () => {
      server = start(0, "127.0.0.1");
      await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
    const call = async (method, body) => {
      const res = await fetch(`${base}/api/firebase-config`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, json: await res.json() };
    };

    test("not set up → saved in the data folder (private file) → read back → removed", async () => {
      assert.deepStrictEqual((await call("GET")).json, { notConfigured: true });
      const bad = await call("PUT", { config: "nonsense" });
      assert.strictEqual(bad.status, 400);
      assert.match(bad.json.error, /Firebase web config/);
      const saved = await call("PUT", { config: snippet });
      assert.deepStrictEqual(saved.json, { ok: true, projectId: "demo-app" });
      const file = path.join(tempDir, "firebase-applet-config.json");
      assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
      assert.strictEqual((await call("GET")).json.apiKey, KEY);
      await call("DELETE");
      assert.ok(!fs.existsSync(file));
      assert.deepStrictEqual((await call("GET")).json, { notConfigured: true });
    });

    test("Private mode: no Google sign-in at all", async () => {
      const settings = require("../server/settings");
      await call("PUT", { config: snippet });
      settings.set({ ...settings.get(), privacy: { localOnly: true } });
      try {
        assert.deepStrictEqual((await call("GET")).json, { private: true });
      } finally {
        settings.set({ ...settings.get(), privacy: { localOnly: false } });
        await call("DELETE");
      }
    });
  });
});
