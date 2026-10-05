const { test, describe } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "src", "js", "echo.mjs")));

describe("Telling the AI's echo from you", () => {
  const said = "Honestly, I think the first hook is the strongest one. It starts with a question, and that keeps people watching.";

  test("its own words coming back through the mic are an echo, even a little garbled", async () => {
    const { isEcho } = await load();
    assert.ok(isEcho("I think the first hook is the strongest one", said));
    assert.ok(isEcho("Honestly I think the first hook is the strongest one it starts with a question", said));
    // the speech-to-text swapped or dropped a word
    assert.ok(isEcho("honestly i think the first book is the strongest one it starts with a question and that keeps people", said));
  });

  test("you, even about the same thing, are not", async () => {
    const { isEcho } = await load();
    assert.ok(!isEcho("Which hook do you think is the strongest one for a short video", said));
    assert.ok(!isEcho("Yes, I think so too", said));
    assert.ok(!isEcho("Okay", said));
    assert.ok(!isEcho("", said));
  });

  test("short phrases are never called an echo", async () => {
    const { isEcho } = await load();
    assert.ok(!isEcho("the first hook", said));
  });

  test("nothing said yet means nothing to echo", async () => {
    const { isEcho } = await load();
    assert.ok(!isEcho("I think the first hook is the strongest one", ""));
  });

  test("works in German and with other scripts", async () => {
    const { isEcho } = await load();
    assert.ok(isEcho("ich finde den ersten Haken am stärksten", "Ehrlich gesagt, ich finde den ersten Haken am stärksten, weil er mit einer Frage beginnt."));
    assert.ok(isEcho("أعتقد أن الفكرة الأولى هي الأقوى", "في رأيي أعتقد أن الفكرة الأولى هي الأقوى بكل صراحة"));
  });

  test("it remembers only the last few things it said", async () => {
    const { createSpoken } = await load();
    const spoken = createSpoken({ keep: 2 });
    spoken.add("one one one one");
    spoken.add("  two   two two two ");
    spoken.add("three three three three");
    spoken.add("");
    assert.strictEqual(spoken.text(), "two two two two three three three three");
    assert.strictEqual(spoken.text("now"), "two two two two three three three three now");
    spoken.clear();
    assert.strictEqual(spoken.text().trim(), "");
  });
});
