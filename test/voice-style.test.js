const { test, describe, before } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

describe("Conversation style", () => {
  let prompt;
  let style;
  let settings;
  before(() => {
    process.env.FRIENDS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "friends-style-test-"));
    process.env.KEYRING_BACKEND = "file";
    process.env.LOG_LEVEL = "error";
    prompt = require("../server/prompt");
    style = require("../server/voice-style");
    settings = require("../server/settings");
  });

  const voicePrompt = (s, extra = {}) => prompt.build(settings.sanitize({}), { voice: true, live: true, style: s, ...extra });

  test("the listener waits longest, the chatty one shortest", () => {
    assert.ok(style.SILENCE_MS.listener > style.SILENCE_MS.balanced);
    assert.ok(style.SILENCE_MS.balanced > style.SILENCE_MS.chatty);
    assert.ok(style.SILENCE_MS.balanced >= 1000, "a pause to think doesn't end your turn");
  });

  test("only the native-audio models get the sensitivity settings; the older ones just the pause length", () => {
    assert.deepStrictEqual(style.detection("balanced", "gemini-3.1-flash-live-preview"), { prefixPaddingMs: 100, silenceDurationMs: style.SILENCE_MS.balanced });
    assert.strictEqual(style.detection("balanced", "gemini-3.8-live").endOfSpeechSensitivity, "END_SENSITIVITY_LOW");
    assert.strictEqual(style.detection("listener", "gemini-3.8-live").startOfSpeechSensitivity, "START_SENSITIVITY_LOW");
    assert.strictEqual(style.detection("nonsense", "gemini-3.8-live").silenceDurationMs, style.SILENCE_MS.balanced);
    assert.strictEqual(style.proactive("listener", "gemini-3.8-live"), true);
    assert.strictEqual(style.proactive("balanced", "gemini-3.8-live"), false);
    assert.strictEqual(style.proactive("listener", "gemini-3.1-flash-live-preview"), false);
  });

  test("what the AI is told: listen by default, no nudges to fill a silence", () => {
    for (const s of ["listener", "balanced"]) {
      const text = voicePrompt(s);
      assert.match(text, /# When to talk and when to listen/);
      assert.match(text, /Never fill (the|a) silence/);
      assert.doesNotMatch(text, /If the conversation runs dry/, s);
      assert.doesNotMatch(text, /keep the momentum by suggesting a next step/, s);
    }
    assert.match(voicePrompt("listener"), /say nothing at all/);
    assert.match(voicePrompt("listener"), /Say nothing until they speak to you directly/);
    assert.match(voicePrompt("balanced"), /a pause is not an invitation to talk/);
    const chatty = voicePrompt("chatty");
    assert.match(chatty, /lively back-and-forth/);
    assert.match(chatty, /If the conversation runs dry/);
  });

  test("text chats keep the old companion nudges", () => {
    const text = prompt.build(settings.sanitize({}), {});
    assert.match(text, /If the conversation runs dry/);
    assert.doesNotMatch(text, /When to talk and when to listen/);
  });

  test("Studio and Instant can't stay quiet by saying nothing, so '[silent]' is the way", () => {
    const studio = prompt.build(settings.sanitize({}), { voice: true, live: false, style: "listener" });
    assert.match(studio, /reply with exactly \[silent\]/);
    assert.ok(prompt.isSilent("[silent]") && prompt.isSilent(" [Silent]. ") && !prompt.isSilent("[silent] Hello") && !prompt.isSilent(""));
    assert.doesNotMatch(prompt.build(settings.sanitize({}), { voice: true, live: false, style: "chatty" }), /\[silent\]/);
  });

  test("the interrupt key's name, and the keys voice mode keeps", async () => {
    const { keyLabel, RESERVED_KEYS, endSilence, bargeProfile } = await import(pathToFileURL(path.join(__dirname, "..", "src", "js", "barge.mjs")));
    assert.deepStrictEqual(["Space", "KeyX", "Digit5", "ArrowUp", "NumpadAdd", ""].map((c) => keyLabel(c)), ["Space bar", "X", "5", "ArrowUp", "Num Add", ""]);
    assert.strictEqual(keyLabel("Space", "Leertaste"), "Leertaste");
    assert.deepStrictEqual([...RESERVED_KEYS].sort(), [...settings.VOICE.reservedKeys].sort(), "the page and the helper agree on which keys are taken");
    assert.ok(endSilence("listener") > endSilence("balanced") && endSilence("balanced") > endSilence("chatty"));
    assert.strictEqual(endSilence("unknown"), endSilence("balanced"));
    assert.ok(bargeProfile("hard").factor > bargeProfile("normal").factor && bargeProfile("normal").factor > bargeProfile("easy").factor);
    assert.deepStrictEqual(bargeProfile("nonsense"), bargeProfile("normal"));
  });
});
