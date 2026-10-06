const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// The first bytes of each picture type, padded to a plausible size
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(64, 5)]);

describe("Your own picture behind the robot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-bg-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.LOG_LEVEL = "error";

  let server;
  let port;
  let base;
  before(async () => {
    server = require("../server/server").start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const upload = async (body, name = "my picture.png") => {
    const res = await fetch(`${base}/api/robot/background`, { method: "PUT", headers: { "Content-Type": "image/png", "X-File-Name": encodeURIComponent(name) }, body });
    return { status: res.status, json: await res.json() };
  };

  test("with no picture, the page is told so", async () => {
    assert.deepStrictEqual(await (await fetch(`${base}/api/robot/background/info`)).json(), { custom: false });
    assert.strictEqual((await fetch(`${base}/api/robot/background`)).status, 404);
  });

  test("a PNG, a JPEG and a WebP are kept, and served with their own type", async () => {
    for (const [make, mime, ext] of [[png, "image/png", "png"], [jpg, "image/jpeg", "jpg"], [webp, "image/webp", "webp"]]) {
      const file = make();
      const { status, json } = await upload(file, `my picture.${ext}`);
      assert.strictEqual(status, 200);
      assert.strictEqual(json.custom, true);
      assert.strictEqual(json.mime, mime);
      assert.strictEqual(json.name, `my picture.${ext}`);
      assert.strictEqual(json.size, file.length);
      const res = await fetch(`${base}/api/robot/background`);
      assert.strictEqual(res.headers.get("content-type"), mime);
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(file));
      assert.strictEqual(fs.statSync(path.join(tempDir, "robot", `background.${ext}`)).mode & 0o777, 0o600);
    }
    // Only the last one is kept
    assert.deepStrictEqual(fs.readdirSync(path.join(tempDir, "robot")).filter((f) => f.startsWith("background.")).sort(), ["background.json", "background.webp"]);
  });

  test("anything else is refused: text, an SVG (it can carry scripts), a program", async () => {
    for (const bad of [Buffer.from("not a picture at all, sorry, no way, really not one"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.concat([Buffer.from("MZ"), Buffer.alloc(80)])]) {
      const { status, json } = await upload(bad);
      assert.strictEqual(status, 400);
      assert.match(json.error, /PNG, JPEG or WebP/);
    }
    assert.strictEqual((await (await fetch(`${base}/api/robot/background/info`)).json()).mime, "image/webp");
  });

  test("a picture over 12 MB is refused", async () => {
    const { status, json } = await upload(Buffer.alloc(12 * 1024 * 1024 + 16, 1));
    assert.strictEqual(status, 400);
    assert.match(json.error, /12 MB/);
  });

  test("other websites can't upload or read it", async () => {
    const res = await fetch(`${base}/api/robot/background`, { method: "PUT", headers: { Origin: "https://evil.example" }, body: png() });
    assert.strictEqual(res.status, 403);
    const del = await fetch(`${base}/api/robot/background`, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.strictEqual(del.status, 403);
    const status = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/api/robot/background", headers: { Host: "evil.example" } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on("error", reject);
    });
    assert.strictEqual(status, 403);
  });

  test("removing it", async () => {
    const res = await fetch(`${base}/api/robot/background`, { method: "DELETE" });
    assert.deepStrictEqual(await res.json(), { custom: false });
    assert.strictEqual((await fetch(`${base}/api/robot/background`)).status, 404);
    assert.deepStrictEqual(await (await fetch(`${base}/api/robot/background/info`)).json(), { custom: false });
    assert.deepStrictEqual(fs.readdirSync(path.join(tempDir, "robot")).filter((f) => f.startsWith("background.")), []);
  });
});
