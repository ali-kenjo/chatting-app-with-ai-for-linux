const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// A small binary glTF: a JSON chunk (padded to 4 bytes) and an optional BIN chunk
function glb(json, { bin = null, magic = 0x46546c67, version = 2, lengthDelta = 0 } = {}) {
  let text = typeof json === "string" ? json : JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " ";
  const jsonChunk = Buffer.from(text);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), jsonChunk];
  parts[1].writeUInt32LE(jsonChunk.length, 0);
  parts[1].writeUInt32LE(0x4e4f534a, 4);
  if (bin) {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(bin.length, 0);
    head.writeUInt32LE(0x004e4942, 4);
    parts.push(head, bin);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  parts[0].writeUInt32LE(magic, 0);
  parts[0].writeUInt32LE(version, 4);
  parts[0].writeUInt32LE(total + lengthDelta, 8);
  return Buffer.concat(parts);
}

const ROBOT = {
  asset: { version: "2.0", generator: "Blender" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "Root", children: [1] },
    { name: "Hover", children: [2] },
    { name: "Body", children: [3] },
    { name: "Neck", children: [4] },
    { name: "Head", children: [5] },
    { name: "FaceScreen" },
  ],
};

describe("Your own robot model (.glb)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-model-test-"));
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

  const upload = async (body, headers = {}) => {
    const res = await fetch(`${base}/api/robot/model`, { method: "PUT", headers: { "Content-Type": "model/gltf-binary", "X-File-Name": "my-robot.glb", ...headers }, body });
    return { status: res.status, json: await res.json() };
  };

  test("a valid .glb is kept, and it says which named parts it found", async () => {
    const file = glb(ROBOT, { bin: Buffer.alloc(16, 1) });
    const { status, json } = await upload(file);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.custom, true);
    assert.strictEqual(json.name, "my-robot.glb");
    assert.strictEqual(json.size, file.length);
    assert.deepStrictEqual(json.nodes, ["Root", "Hover", "Body", "Neck", "Head", "FaceScreen"]);

    const stored = path.join(tempDir, "robot", "model.glb");
    assert.ok(fs.readFileSync(stored).equals(file));
    assert.strictEqual(fs.statSync(stored).mode & 0o777, 0o600);

    const res = await fetch(`${base}/api/robot/model`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "model/gltf-binary");
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(file));
    assert.strictEqual((await (await fetch(`${base}/api/robot/model/info`)).json()).custom, true);
  });

  test("files that aren't a usable glTF 2.0 binary are refused with a clear reason", async () => {
    const cases = [
      [Buffer.from("not a model at all, sorry"), /isn't a \.glb/],
      [glb(ROBOT, { magic: 0x12345678 }), /glTF Binary/],
      [glb(ROBOT, { version: 1 }), /glTF 2\.0/],
      [glb(ROBOT, { lengthDelta: 8 }), /incomplete or damaged/],
      [glb("{ this is not json"), /can't be read/],
      [glb({ ...ROBOT, asset: { version: "1.0" } }), /glTF 2\.0/],
      [glb({ ...ROBOT, images: [{ uri: "https://example.com/track.png" }] }), /other files/],
      [glb({ ...ROBOT, buffers: [{ uri: "robot.bin", byteLength: 4 }] }), /other files/],
      [glb({ ...ROBOT, extensionsRequired: ["KHR_draco_mesh_compression"] }), /without compression/],
    ];
    for (const [file, message] of cases) {
      const { status, json } = await upload(file);
      assert.strictEqual(status, 400, String(message));
      assert.match(json.error, message);
    }
    // The good one from before is still there
    assert.strictEqual((await (await fetch(`${base}/api/robot/model/info`)).json()).name, "my-robot.glb");
  });

  test("a model over 30 MB is refused", async () => {
    const big = Buffer.alloc(30 * 1024 * 1024 + 16);
    const { status, json } = await upload(big);
    assert.strictEqual(status, 400);
    assert.match(json.error, /30 MB/);
  });

  test("other websites can't upload one or read it", async () => {
    const res = await fetch(`${base}/api/robot/model`, { method: "PUT", headers: { Origin: "https://evil.example" }, body: glb(ROBOT) });
    assert.strictEqual(res.status, 403);
    const del = await fetch(`${base}/api/robot/model`, { method: "DELETE", headers: { Origin: "https://evil.example" } });
    assert.strictEqual(del.status, 403);
    const status = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/api/robot/model", headers: { Host: "evil.example" } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on("error", reject);
    });
    assert.strictEqual(status, 403);
  });

  test("reset to the built-in robot", async () => {
    const res = await fetch(`${base}/api/robot/model`, { method: "DELETE" });
    assert.deepStrictEqual(await res.json(), { custom: false });
    assert.strictEqual((await fetch(`${base}/api/robot/model`)).status, 404);
    assert.deepStrictEqual(await (await fetch(`${base}/api/robot/model/info`)).json(), { custom: false });
  });
});
