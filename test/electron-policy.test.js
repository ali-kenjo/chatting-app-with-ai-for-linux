// The desktop window's rules (electron/policy.js): no Electron needed
const { test, describe } = require("node:test");
const assert = require("node:assert");
const policy = require("../electron/policy");

const ORIGIN = "http://127.0.0.1:38417";
const WINDOW_ORIGIN = "http://localhost:38417"; // what the desktop app opens (Firebase accepts localhost for Google sign-in)

describe("Desktop window rules", () => {
  test("only this app's own page may use the microphone and camera", () => {
    assert.strictEqual(policy.permissionAllowed("media", `${ORIGIN}/`, ORIGIN), true);
    assert.strictEqual(policy.permissionAllowed("media", "https://evil.example/", ORIGIN), false);
    assert.strictEqual(policy.permissionAllowed("media", "http://127.0.0.1:9999/", ORIGIN), false);
  });

  test("everything else that can be asked for is refused", () => {
    for (const p of ["geolocation", "notifications", "display-capture", "midi", "clipboard-read", "openExternal"]) {
      assert.strictEqual(policy.permissionAllowed(p, ORIGIN, ORIGIN), false, p);
    }
    assert.strictEqual(policy.permissionAllowed("fullscreen", ORIGIN, ORIGIN), true);
  });

  test("links: own pages stay, Google sign-in gets a popup, the web opens in the browser", () => {
    assert.strictEqual(policy.openAction(`${ORIGIN}/x`, ORIGIN), "inside");
    assert.strictEqual(policy.openAction("https://accounts.google.com/o/oauth2/auth", ORIGIN), "popup");
    assert.strictEqual(policy.openAction("https://my-project.firebaseapp.com/__/auth/handler", ORIGIN), "popup");
    assert.strictEqual(policy.openAction("https://github.com/example/friends", ORIGIN), "external");
    assert.strictEqual(policy.openAction("mailto:a@b.c", ORIGIN), "external");
  });

  test("look-alike hosts and odd schemes are not trusted", () => {
    assert.strictEqual(policy.openAction("https://google.com.evil.example/", ORIGIN), "external");
    assert.strictEqual(policy.openAction("https://notgoogle.com/", ORIGIN), "external");
    assert.strictEqual(policy.openAction("file:///etc/passwd", ORIGIN), "deny");
    assert.strictEqual(policy.openAction("javascript:alert(1)", ORIGIN), "deny");
    assert.strictEqual(policy.openAction("not a url", ORIGIN), "deny");
  });

  test("the window never navigates away from the helper", () => {
    assert.strictEqual(policy.navigationAllowed(`${ORIGIN}/?voice=1`, ORIGIN), true);
    assert.strictEqual(policy.navigationAllowed("https://example.com/", ORIGIN), false);
    assert.strictEqual(policy.navigationAllowed("http://127.0.0.1:38418/", ORIGIN), false);
  });

  test("the user agent doesn't say Electron (Google refuses sign-in there)", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) friends/0.1.0 Chrome/152.0.0.0 Electron/44.4.5 Safari/537.36";
    assert.strictEqual(policy.cleanUserAgent(ua), "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");
  });
});

test("the desktop app's own localhost address is trusted, other ports and the IP address are not", () => {
  assert.strictEqual(policy.permissionAllowed("media", "http://localhost:38417/", WINDOW_ORIGIN), true);
  assert.strictEqual(policy.navigationAllowed("http://localhost:38417/#chat/x", WINDOW_ORIGIN), true);
  assert.strictEqual(policy.navigationAllowed("http://localhost:38418/", WINDOW_ORIGIN), false);
  assert.strictEqual(policy.navigationAllowed("http://127.0.0.1:38417/", WINDOW_ORIGIN), false);
  assert.strictEqual(policy.openAction("https://accounts.google.com/o/oauth2/auth", WINDOW_ORIGIN), "popup");
});
