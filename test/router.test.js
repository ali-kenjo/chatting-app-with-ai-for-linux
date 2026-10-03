const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");
const router = require("../server/router");
const settingsModule = require("../server/settings");

const localBrain = { id: 1, name: "Llama", kind: "local", provider: "local", protocol: "ollama", model: "llama3.1", contextSize: 8192 };
const cloudBrain = { id: 2, name: "Gemini", kind: "cloud", provider: "gemini", model: "gemini-3.8-flash" };

const settingsWith = (routing = {}, aiControl = {}) => {
  const s = settingsModule.sanitize({});
  s.routing = { ...s.routing, ...routing, auto: { ...s.routing.auto, ...routing.auto }, dynamic: { ...s.routing.dynamic, ...routing.dynamic } };
  s.aiControl = { ...s.aiControl, ...aiControl };
  return s;
};
const depsWith = ({ local = localBrain, cloud = cloudBrain, privateMode = false, chosen } = {}) => {
  const brains = { local, cloud };
  return {
    privateMode,
    has: (kind) => Boolean(brains[kind]) && !(kind === "cloud" && privateMode),
    byKind: (kind) => (kind === "cloud" && privateMode ? null : brains[kind] || null),
    chosen: () => chosen ?? local ?? cloud,
  };
};
const planFor = (mode, extra = {}, routing = {}, depsOptions = {}) =>
  router.plan({ settings: settingsWith({ ...routing, mode }, extra.aiControl), deps: depsWith(depsOptions), text: "Hi", ...extra });
const kinds = (p) => p.steps.map((s) => s.kind);

beforeEach(() => router.resetHealth());

describe("Choosing the AI", () => {
  test("fixed: the chosen brain, no fallback; local and cloud only: just that kind", () => {
    assert.deepStrictEqual(kinds(planFor("fixed", {}, {}, { chosen: cloudBrain })), ["cloud"]);
    assert.deepStrictEqual(kinds(planFor("local")), ["local"]);
    assert.deepStrictEqual(kinds(planFor("cloud")), ["cloud"]);
    assert.throws(() => planFor("local", {}, {}, { local: null }), /Local only needs a local AI/);
    assert.throws(() => planFor("cloud", {}, {}, { cloud: null }), /Cloud only needs a cloud AI/);
    assert.deepStrictEqual(planFor("fixed", {}, {}, { chosen: null, local: null, cloud: null }).steps, []);
  });

  test("Private mode makes every mode local, and refuses a forced cloud", () => {
    for (const mode of ["auto", "dynamic", "fastest", "cloud", "fixed"]) assert.deepStrictEqual(kinds(planFor(mode, {}, {}, { privateMode: true })), ["local"], mode);
    assert.deepStrictEqual(kinds(planFor("auto", { force: "cloud" }, {}, { privateMode: true })), ["local"]);
    assert.throws(() => planFor("auto", {}, {}, { privateMode: true, local: null }), /Private mode is on/);
  });

  test("asking for the other AI for one reply wins over the mode", () => {
    const p = planFor("local", { force: "cloud" });
    assert.deepStrictEqual([kinds(p), p.askCloud], [["cloud"], false]);
    assert.deepStrictEqual(kinds(planFor("cloud", { force: "local" })), ["local"]);
    assert.throws(() => planFor("auto", { force: "cloud" }, {}, { cloud: null }), /cloud AI/);
  });

  test("auto: short messages stay local, with the cloud as the fallback", () => {
    const p = planFor("auto", { text: "What's the capital of France?" });
    assert.deepStrictEqual(kinds(p), ["local", "cloud"]);
    assert.strictEqual(p.askCloud, "chat");
    assert.deepStrictEqual([p.race, p.escalate], [false, false]);
  });

  test("auto: a PDF, a picture, a long chat or a hard question goes to the cloud", () => {
    const cloudFirst = (extra, routing) => kinds(planFor("auto", extra, routing))[0] === "cloud";
    assert.ok(cloudFirst({ attachments: [{ name: "a.pdf", mime: "application/pdf" }] }));
    assert.ok(cloudFirst({ attachments: [{ name: "a.png", mime: "image/png" }] }));
    assert.ok(cloudFirst({ messages: Array.from({ length: 30 }, () => ({ text: "word ".repeat(400) })) }));
    assert.ok(cloudFirst({ text: "Please analyze this in depth, step by step: " + "detail ".repeat(150) }));
    assert.ok(!cloudFirst({ text: "x", aiControl: { reasoningEffort: "deep" } }), "deep alone is one point short");
    assert.ok(cloudFirst({ text: "Analyze the trade-offs", aiControl: { reasoningEffort: "deep" } }));
    // and each rule can be switched off
    assert.ok(!cloudFirst({ attachments: [{ name: "a.pdf", mime: "application/pdf" }] }, { auto: { attachments: false } }));
    assert.ok(!cloudFirst({ messages: Array.from({ length: 30 }, () => ({ text: "word ".repeat(400) })) }, { auto: { longChats: false } }));
    assert.ok(!cloudFirst({ text: "Analyze in depth step by step " + "x".repeat(900) }, { auto: { hardQuestions: false } }));
  });

  test("a local model that can see takes the picture itself", () => {
    const vision = { ...localBrain, model: "llama3.2-vision:11b" };
    const p = router.plan({ settings: settingsWith({ mode: "auto" }), deps: depsWith({ local: vision }), text: "What is this?", attachments: [{ name: "a.png", mime: "image/png" }] });
    assert.strictEqual(kinds(p)[0], "local");
  });

  test("the cloud's reason says why", () => {
    const reason = router.cloudReason({ text: "", attachments: [{ name: "report.pdf", mime: "application/pdf" }], settings: settingsWith(), local: localBrain });
    assert.match(reason, /report\.pdf is a PDF/);
    assert.strictEqual(router.cloudReason({ text: "hi", settings: settingsWith(), local: localBrain }), null);
  });

  test("voice stays local for speed; with one kind of AI there's nothing to choose", () => {
    const p = planFor("auto", { voice: true });
    assert.match(p.steps[0].reason, /Voice answers stay local/);
    assert.deepStrictEqual(kinds(planFor("auto", {}, {}, { cloud: null })), ["local"]);
    assert.deepStrictEqual(kinds(planFor("dynamic", {}, {}, { local: null })), ["cloud"]);
    assert.deepStrictEqual(planFor("auto", {}, {}, { local: null, cloud: null }).steps, []);
  });

  test("'ask before the cloud' is 'never' when switched off", () => {
    assert.strictEqual(planFor("auto", {}, { askBeforeCloud: "never" }).askCloud, false);
    assert.strictEqual(planFor("auto", {}, { askBeforeCloud: "always" }).askCloud, "always");
  });

  test("dynamic: watches the local AI, and gives up on a silent one", () => {
    const p = planFor("dynamic");
    assert.deepStrictEqual([kinds(p), p.escalate], [["local", "cloud"], true]);
    assert.strictEqual(planFor("dynamic", {}, { dynamic: { escalate: false } }).escalate, false);
    router.penalize("local", 60000);
    assert.deepStrictEqual(kinds(planFor("dynamic")), ["cloud", "local"]);
    assert.deepStrictEqual(kinds(planFor("auto")), ["local", "cloud"], "auto doesn't remember");
    router.resetHealth();
    router.penalize("cloud", 60000);
    assert.deepStrictEqual(kinds(planFor("dynamic")), ["local"]);
    router.penalize("local", 60000); // both bad: the usual order
    assert.deepStrictEqual(kinds(planFor("dynamic")), ["local", "cloud"]);
  });

  test("fastest asks both", () => {
    const p = planFor("fastest");
    assert.deepStrictEqual([kinds(p), p.race], [["local", "cloud"], true]);
  });
});

// ---------- Running ----------
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(Object.assign(new Error("aborted"), { name: "AbortError" }))), { once: true });
  });

function ioWith(behaviour, extra = {}) {
  const log = { events: [], runs: [], asked: [] };
  const state = { cloudOk: false };
  return {
    log,
    state,
    io: {
      run: async (step, ctl) => {
        log.runs.push(step.kind);
        return behaviour[step.kind](step, ctl);
      },
      emit: (e) => log.events.push(e),
      signal: extra.signal,
      slowMs: extra.slowMs,
      cloudAllowed: () => state.cloudOk,
      allowCloud: () => (state.cloudOk = true),
      confirmCloud: async (step) => (log.asked.push(step.reason), extra.answer ?? true),
    },
  };
}
const says = (ctl) => ctl.started() || Promise.reject(new Error("lost"));

describe("Running the plan", () => {
  test("the first AI answers and says so", async () => {
    const { io, log } = ioWith({ local: async (_s, ctl) => says(ctl), cloud: async () => assert.fail("not needed") });
    const out = await router.execute(planFor("auto"), io);
    assert.strictEqual(out.step.kind, "local");
    assert.deepStrictEqual(log.runs, ["local"]);
    assert.deepStrictEqual([log.events[0].type, log.events[0].kind, log.events[0].name, log.events[0].mode], ["route", "local", "Llama", "auto"]);
    assert.deepStrictEqual(log.asked, [], "the cloud wasn't used, so nobody was asked");
  });

  test("a local failure before any answer falls back to the cloud, after asking", async () => {
    const { io, log } = ioWith({ local: async () => { throw new Error("connection refused"); }, cloud: async (_s, ctl) => says(ctl) });
    const out = await router.execute(planFor("auto"), io);
    assert.strictEqual(out.step.kind, "cloud");
    assert.strictEqual(log.asked.length, 1);
    assert.deepStrictEqual(log.events.map((e) => e.kind), ["local", "cloud"]);
  });

  test("an empty local reply is replaced too; and both failing says both", async () => {
    let r = ioWith({ local: async () => {}, cloud: async (_s, ctl) => says(ctl) });
    assert.strictEqual((await router.execute(planFor("auto"), r.io)).step.kind, "cloud");
    router.resetHealth();
    r = ioWith({ local: async () => {}, cloud: async () => { throw new Error("quota used up"); } });
    await assert.rejects(router.execute(planFor("auto"), r.io), (err) => /local AI sent an empty reply/.test(err.message) && /cloud AI: quota used up/.test(err.message));
  });

  test("an answer that has started is never taken over", async () => {
    const { io, log } = ioWith({
      local: async (_s, ctl) => {
        says(ctl);
        throw new Error("model crashed");
      },
      cloud: async () => assert.fail("must not start over"),
    });
    await assert.rejects(router.execute(planFor("auto"), io), /model crashed/);
    assert.deepStrictEqual(log.runs, ["local"]);
  });

  test("you can keep it local: declining the cloud leaves the local AI's failure", async () => {
    const { io, log } = ioWith({ local: async () => { throw new Error("down"); }, cloud: async () => assert.fail("declined") }, { answer: false });
    await assert.rejects(router.execute(planFor("auto"), io), /down.*You chose not to send this to the cloud/);
    assert.deepStrictEqual(log.runs, ["local"]);
    // a cloud-first message you decline is answered locally
    const r = ioWith({ local: async (_s, ctl) => says(ctl), cloud: async () => assert.fail("declined") }, { answer: false });
    const out = await router.execute(planFor("auto", { attachments: [{ name: "a.pdf", mime: "application/pdf" }] }), r.io);
    assert.strictEqual(out.step.kind, "local");
  });

  test("'once per chat' asks the first time only; 'always' every time; 'never' not at all", async () => {
    const cloud = { local: async () => { throw new Error("x"); }, cloud: async (_s, ctl) => says(ctl) };
    const once = ioWith(cloud);
    await router.execute(planFor("auto"), once.io);
    await router.execute(planFor("auto"), once.io);
    assert.strictEqual(once.log.asked.length, 1);
    const always = ioWith(cloud);
    await router.execute(planFor("auto", {}, { askBeforeCloud: "always" }), always.io);
    await router.execute(planFor("auto", {}, { askBeforeCloud: "always" }), always.io);
    assert.strictEqual(always.log.asked.length, 2);
    const never = ioWith(cloud);
    await router.execute(planFor("auto", {}, { askBeforeCloud: "never" }), never.io);
    assert.strictEqual(never.log.asked.length, 0);
    // choosing "Cloud only" yourself is consent enough
    const chosen = ioWith(cloud);
    await router.execute(planFor("cloud"), chosen.io);
    assert.strictEqual(chosen.log.asked.length, 0);
  });

  test("dynamic: a local AI that stays silent is dropped for the cloud, and avoided for a while", async () => {
    const { io, log } = ioWith({ local: (_s, ctl) => wait(5000, ctl.signal), cloud: async (_s, ctl) => says(ctl) }, { slowMs: 40 });
    const out = await router.execute(planFor("dynamic"), io);
    assert.strictEqual(out.step.kind, "cloud");
    assert.deepStrictEqual(log.runs, ["local", "cloud"]);
    assert.ok(router.penalized("local"));
    assert.deepStrictEqual(kinds(planFor("dynamic")), ["cloud", "local"]);
  });

  test("dynamic: a local AI that answers in time isn't dropped, and its slowness is forgiven", async () => {
    router.penalize("local", 1);
    const { io } = ioWith({ local: async (_s, ctl) => (await wait(10), says(ctl)), cloud: async () => assert.fail() }, { slowMs: 500 });
    assert.strictEqual((await router.execute(planFor("dynamic"), io)).step.kind, "local");
    assert.ok(!router.penalized("local"));
  });

  test("fastest: the first to start wins and the other is stopped", async () => {
    let localStopped = false;
    const { io, log } = ioWith({
      local: async (_s, ctl) => {
        try {
          await wait(2000, ctl.signal);
        } catch (err) {
          localStopped = true; // its signal was aborted when the cloud started first
          throw err;
        }
      },
      cloud: async (_s, ctl) => (await wait(10), says(ctl)),
    });
    const out = await router.execute(planFor("fastest"), io);
    assert.strictEqual(out.step.kind, "cloud");
    assert.ok(log.events.some((e) => /cloud AI answered first/.test(e.reason)));
    assert.ok(localStopped);
  });

  test("fastest: a loser that reaches for a tool or text is told it lost", async () => {
    let loserTold = false;
    const { io } = ioWith({
      local: async (_s, ctl) => (await wait(60, ctl.signal), says(ctl)),
      cloud: async (_s, ctl) => {
        says(ctl);
        await wait(20, ctl.signal).catch(() => {});
      },
    });
    const out = await router.execute(planFor("fastest"), {
      ...io,
      run: async (step, ctl) => {
        try {
          return await io.run(step, ctl);
        } catch (err) {
          if (step.kind === "local") loserTold = true;
          throw err;
        }
      },
    });
    assert.strictEqual(out.step.kind, "cloud");
    assert.ok(loserTold);
  });

  test("fastest: if one fails before starting, the other answers; if you keep it local, only local runs", async () => {
    let r = ioWith({ local: async () => { throw new Error("down"); }, cloud: async (_s, ctl) => (await wait(20), says(ctl)) });
    assert.strictEqual((await router.execute(planFor("fastest"), r.io)).step.kind, "cloud");
    r = ioWith({ local: async (_s, ctl) => says(ctl), cloud: async () => assert.fail("declined") }, { answer: false });
    assert.strictEqual((await router.execute(planFor("fastest"), r.io)).step.kind, "local");
    assert.deepStrictEqual(r.log.runs, ["local"]);
  });

  test("pressing stop stops it, with no fallback", async () => {
    const stop = new AbortController();
    const { io, log } = ioWith({ local: (_s, ctl) => wait(5000, ctl.signal), cloud: async () => assert.fail("no fallback after stop") }, { signal: stop.signal });
    setTimeout(() => stop.abort(), 30);
    await assert.rejects(router.execute(planFor("auto"), io), (err) => err.name === "AbortError");
    assert.deepStrictEqual(log.runs, ["local"]);
  });

  test("no brain at all", async () => {
    await assert.rejects(router.execute({ mode: "fixed", steps: [] }, ioWith({}).io), /NO_BRAIN/);
  });
});
