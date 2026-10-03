const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("The page can load the 3D robot safely", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-page-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.LOG_LEVEL = "error";

  const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));

  let server;
  let base;
  before(async () => {
    server = require("../server/server").start(0, "127.0.0.1");
    await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("the import map is allowed by its exact hash, not by loosening the policy", () => {
    const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
    const hash = `'sha256-${crypto.createHash("sha256").update(map).digest("base64")}'`;
    assert.ok(scriptSrc.includes(hash), `script-src needs ${hash}`);
    const imports = JSON.parse(map).imports;
    assert.strictEqual(imports.three, "/vendor/three/build/three.module.js");
    assert.strictEqual(imports["three/addons/"], "/vendor/three/addons/");
    // Only WebAssembly compiling is added (for the face detector); no eval, no CDNs for the robot
    assert.ok(scriptSrc.includes("'wasm-unsafe-eval'"));
    assert.ok(!scriptSrc.includes("'unsafe-eval'"));
    assert.ok(!/cdn|jsdelivr|unpkg/i.test(csp));
  });

  test("three.js, its addons, MediaPipe and the face model come from this helper", async () => {
    const files = [
      ["/vendor/three/build/three.module.js", /javascript/],
      ["/vendor/three/build/three.core.js", /javascript/],
      ["/vendor/three/addons/loaders/GLTFLoader.js", /javascript/],
      ["/vendor/three/addons/postprocessing/UnrealBloomPass.js", /javascript/],
      ["/vendor/three/addons/environments/RoomEnvironment.js", /javascript/],
      ["/vendor/mediapipe/vision_bundle.mjs", /javascript/],
      ["/vendor/mediapipe/wasm/vision_wasm_internal.js", /javascript/],
      ["/vendor/mediapipe/wasm/vision_wasm_internal.wasm", /^application\/wasm$/],
      ["/models/face/blaze_face_short_range.tflite", /octet-stream/],
      ["/js/robot/animator.mjs", /javascript/],
    ];
    for (const [url, type] of files) {
      const res = await fetch(base + url, { method: "HEAD" });
      assert.strictEqual(res.status, 200, url);
      assert.match(res.headers.get("content-type"), type, url);
    }
    // The rest of node_modules stays private
    assert.strictEqual((await fetch(`${base}/vendor/three/../../package.json`)).status, 404);
    assert.strictEqual((await fetch(`${base}/vendor/three/build/../package.json`)).status, 404);
  });

  test("the camera may be used by this page only (for Follow my face)", async () => {
    const res = await fetch(`${base}/index.html`);
    const policy = res.headers.get("permissions-policy");
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /camera=\(self\)/);
  });
});
