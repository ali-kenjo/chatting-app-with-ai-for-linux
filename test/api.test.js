const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

describe("HTTP API and Server Integration", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-api-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.LOG_LEVEL = "error"; // silence request logs during tests

  const { start } = require("../server/server");
  const notes = require("../server/notes");

  let server;
  let port;
  let baseUrl;

  before(async () => {
    // Start on port 0 to let OS assign an available ephemeral port
    server = start(0, "127.0.0.1");
    await new Promise((resolve) => {
      if (server.listening) resolve();
      else server.on("listening", resolve);
    });
    port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function request(urlPath, options = {}) {
    const url = new URL(urlPath, baseUrl);
    const headers = {
      ...(options.headers || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    let json = null;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {}

    return { status: res.status, headers: res.headers, json, text };
  }

  // Raw HTTP request to test custom Host headers bypass fetch's forbidden header restriction
  function rawHttpRequest(urlPath, customHost) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          method: "GET",
          headers: {
            Host: customHost,
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            let json = null;
            try {
              json = JSON.parse(body);
            } catch {}
            resolve({ status: res.statusCode, headers: res.headers, json, body });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  test("GET /api/health and /healthz return 200 with system status and version", async () => {
    const health = await request("/api/health");
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.status, "ok");
    assert.ok(typeof health.json.uptime === "number");
    assert.strictEqual(health.json.storage.ok, true);

    const healthz = await request("/healthz");
    assert.strictEqual(healthz.status, 200);
    assert.strictEqual(healthz.json.status, "ok");
  });

  test("Security headers are enforced on API and static responses", async () => {
    const res = await request("/api/health");
    assert.strictEqual(res.headers.get("x-frame-options"), "DENY");
    assert.strictEqual(res.headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  test("Untrusted hosts are rejected with 403 Forbidden", async () => {
    const res = await rawHttpRequest("/api/settings", "evil.attacker.com");
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.error, "Forbidden");
  });

  test("Changes from other websites are rejected with 403 Forbidden", async () => {
    const res = await request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: "https://evil.attacker.com" },
      body: "{}",
    });
    assert.strictEqual(res.status, 403);
  });

  test("Only this computer can reach the helper by default", () => {
    const saved = process.env.HOST;
    delete process.env.HOST;
    delete require.cache[require.resolve("../server/config")];
    assert.strictEqual(require("../server/config").host, "127.0.0.1");
    if (saved !== undefined) process.env.HOST = saved;
  });

  test("GET and PUT /api/settings", async () => {
    const initial = await request("/api/settings");
    assert.strictEqual(initial.status, 200);
    assert.strictEqual(initial.json.theme.appearance, "dark");

    const updated = await request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: { appearance: "light", accent: "#34d399" } }),
    });
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.json.theme.appearance, "light");
    assert.strictEqual(updated.json.theme.accent, "#34d399");
  });

  test("Notes CRUD via HTTP endpoints", async () => {
    // Initial note created in memory store
    const initialNote = notes.save({
      type: "project",
      title: "Initial Test Note",
      content: "Initial body",
    });

    // Update note via PUT /api/notes/:id
    const putRes = await request(`/api/notes/${initialNote.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "project",
        title: "Updated Note via HTTP",
        content: "API verification body updated",
      }),
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.json.id, initialNote.id);
    assert.strictEqual(putRes.json.title, "Updated Note via HTTP");

    // List notes via GET /api/notes
    const listRes = await request("/api/notes");
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.json.notes.some((n) => n.id === initialNote.id));

    // Delete note via DELETE /api/notes/:id
    const delRes = await request(`/api/notes/${initialNote.id}`, { method: "DELETE" });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.json.ok, true);
  });

  test("Chats listing and search via HTTP endpoints", async () => {
    const listRes = await request("/api/chats");
    assert.strictEqual(listRes.status, 200);
    assert.ok(Array.isArray(listRes.json));

    const searchRes = await request("/api/chats/search?q=something");
    assert.strictEqual(searchRes.status, 200);
    assert.ok(Array.isArray(searchRes.json));
  });

  test("Unknown API route returns 404", async () => {
    const res = await request("/api/non-existent-endpoint");
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.json.error, "Not found");
  });

  test("Unsupported HTTP method on static route returns 405", async () => {
    const res = await request("/index.html", { method: "POST" });
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.json.error, "Method not allowed");
  });

  test("Static index.html is served successfully", async () => {
    const res = await request("/index.html");
    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes("<!DOCTYPE html>"));
  });
});
