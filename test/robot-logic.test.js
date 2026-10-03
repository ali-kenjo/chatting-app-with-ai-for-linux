// The robot's pure logic (src/js/robot/*.mjs): no browser needed
const { test, describe, before } = require("node:test");
const assert = require("node:assert");

let spring, presets, classifier, keys, bands, animator, director;
before(async () => {
  director = await import("../src/js/robot/director.mjs");
  spring = await import("../src/js/robot/spring.mjs");
  presets = await import("../src/js/robot/presets.mjs");
  classifier = await import("../src/js/robot/classifier.mjs");
  keys = await import("../src/js/robot/keys.mjs");
  bands = await import("../src/js/robot/bands.mjs");
  animator = await import("../src/js/robot/animator.mjs");
});

// A repeatable random()
const seeded = (seed = 7) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe("Springs and the mixer", () => {
  test("a spring settles on its target without overshooting", () => {
    const s = { x: 0, v: 0 };
    let last = 0;
    for (let i = 0; i < 120; i++) {
      spring.springStep(s, 1, 12, 1 / 60);
      assert.ok(s.x >= last - 1e-12, "never moves back");
      assert.ok(s.x <= 1 + 1e-9, "never passes the target");
      last = s.x;
    }
    assert.ok(Math.abs(s.x - 1) < 1e-3);
  });

  test("it moves the same at 30 and 60 frames a second", () => {
    const a = { x: 0, v: 0.5 };
    const b = { x: 0, v: 0.5 };
    for (let i = 0; i < 30; i++) spring.springStep(a, 2, 9, 1 / 30);
    for (let i = 0; i < 60; i++) spring.springStep(b, 2, 9, 1 / 60);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.v - b.v) < 1e-9);
  });

  test("a kick swings out and comes back by itself", () => {
    const springs = new spring.Springs({ nod: [0, 10] });
    springs.impulse("nod", 1);
    let peak = 0;
    for (let i = 0; i < 180; i++) peak = Math.max(peak, springs.step({}, 1 / 60).nod);
    assert.ok(peak > 0.02);
    assert.ok(Math.abs(springs.value.nod) < 1e-3);
  });

  test("the mixer blends layers by weight and adds offsets on top", () => {
    const m = new spring.Mixer({ a: 0, b: 1, c: 5 });
    const out = m.begin().blend({ a: 10, b: 3 }, 0.5).add({ a: 1, c: -1 }).blend({ nope: 7 }).result();
    assert.deepStrictEqual(out, { a: 6, b: 2, c: 4 });
    assert.deepStrictEqual(m.begin().result(), { a: 0, b: 1, c: 5 });
  });
});

describe("Choosing the mood", () => {
  test("a mood stays at least its minimum time", () => {
    const s = new spring.MoodSmoother({ minHold: 1600 });
    assert.ok(s.request("happy", { now: 0 }));
    assert.ok(!s.request("sad", { now: 500 }));
    assert.strictEqual(s.current(500), "happy");
    assert.ok(s.request("sad", { now: 1700 }));
    assert.strictEqual(s.current(1700), "sad");
  });

  test("the AI's own choice wins over captions, and captions can't undo it", () => {
    const s = new spring.MoodSmoother();
    s.request("happy", { now: 0 });
    assert.ok(s.request("proud", { source: "tool", now: 100 }));
    assert.ok(!s.request("happy", { source: "caption", strength: 1, now: 5000 }));
    assert.strictEqual(s.current(5000), "proud");
  });

  test("no flickering back to the mood it just left", () => {
    const s = new spring.MoodSmoother({ minHold: 1000, flipGuard: 4000 });
    s.request("happy", { now: 0 });
    s.request("sad", { now: 1100 });
    assert.ok(!s.request("happy", { now: 2200, strength: 0.6 }));
    assert.ok(s.request("happy", { now: 2200, strength: 0.9 }));
  });

  test("moods fade back to the default when nothing refreshes them", () => {
    const s = new spring.MoodSmoother({ life: 7000 });
    s.request("excited", { now: 0 });
    s.request("excited", { now: 5000 });
    assert.strictEqual(s.current(11000), "excited");
    assert.strictEqual(s.current(12500), "neutral");
  });
});

describe("Gestures", () => {
  const lengths = { nod: 0.8, wave: 1.8, shrug: 1.2, tilt: 1.3 };
  const queue = () => new spring.GestureQueue((n) => lengths[n] || 0, { maxWait: 2500 });

  test("a gesture plays to the end before the next one starts", () => {
    const q = queue();
    q.push("wave", { priority: 1, now: 0 });
    assert.strictEqual(q.update(0).name, "wave");
    q.push("nod", { priority: 3, now: 100 });
    assert.strictEqual(q.update(1700).name, "wave");
    assert.strictEqual(q.update(1810).name, "nod");
  });

  test("higher priority goes first; duplicates and unknown gestures are dropped", () => {
    const q = queue();
    q.push("wave", { now: 0 });
    q.update(0);
    q.push("shrug", { priority: 1, now: 10 });
    q.push("tilt", { priority: 2, now: 20 });
    assert.ok(!q.push("tilt", { priority: 2, now: 30 }));
    assert.ok(!q.push("moonwalk", { now: 30 }));
    assert.deepStrictEqual(q.queue.map((g) => g.name), ["tilt", "shrug"]);
  });

  test("a gesture that waited too long is skipped", () => {
    const q = queue();
    q.push("wave", { now: 0 });
    q.update(0);
    q.push("nod", { now: 0 });
    assert.strictEqual(q.update(2600), null);
  });

  test("clearing lets the current gesture ease out instead of stopping dead", () => {
    const q = queue();
    q.push("wave", { now: 0 });
    q.update(0);
    const before = q.update(600).weight;
    q.clear(600);
    const mid = q.update(750);
    assert.ok(mid && mid.weight > 0 && mid.weight < before);
    assert.strictEqual(q.update(950), null);
  });
});

describe("Moods, states and gestures look complete", () => {
  test("every mood and state uses real channels only", () => {
    const channels = Object.keys(presets.CHANNELS);
    for (const mood of presets.MOODS) {
      assert.ok(presets.MOOD_POSES[mood], `pose for ${mood}`);
      for (const key of Object.keys(presets.MOOD_POSES[mood])) assert.ok(channels.includes(key), `${mood}.${key}`);
    }
    for (const [name, state] of Object.entries(presets.STATES)) {
      for (const key of Object.keys(state.pose)) assert.ok(channels.includes(key), `${name}.${key}`);
      assert.ok(state.moodWeight >= 0 && state.moodWeight <= 1);
    }
  });

  test("every gesture starts and ends at rest, and stays in a sane range", () => {
    for (const name of [...presets.GESTURES, "boot", "yawn", "mmhm"]) {
      const def = presets.GESTURE_DEFS[name];
      assert.ok(def && def.duration > 0, name);
      for (const t of [0, 1]) {
        const o = {};
        def.offsets(t, o, false);
        for (const [k, v] of Object.entries(o)) {
          if (name === "boot" && t === 0) continue; // it starts switched off on purpose
          assert.ok(Math.abs(v) < 1e-6, `${name} ${k} at t=${t} is ${v}`);
        }
      }
      for (let t = 0; t <= 1; t += 0.05) {
        const o = {};
        def.offsets(t, o, false);
        for (const [k, v] of Object.entries(o)) {
          assert.ok(k in presets.CHANNELS, `${name}: ${k}`);
          assert.ok(Number.isFinite(v) && Math.abs(v) < 3.2, `${name} ${k}=${v}`);
        }
      }
    }
  });

  test("the AI's tools name the same moods and gestures as the page", () => {
    const robot = require("../server/robot");
    assert.deepStrictEqual(robot.MOODS, presets.MOODS);
    assert.deepStrictEqual(robot.GESTURES, presets.GESTURES);
  });

  test("your glow color always differs from the robot's", () => {
    assert.strictEqual(presets.userGlowFor("#6f9cf5"), "#ffb074"); // blue accent → warm
    assert.strictEqual(presets.userGlowFor("#f59e0b"), "#5eead4"); // amber accent → teal
    assert.strictEqual(presets.userGlowFor("bogus"), "#ffb074");
  });
});

describe("Moods from words (English, German, Arabic)", () => {
  const mood = (text, options) => classifier.classify(text, options).mood;
  const gesture = (text, options) => classifier.classify(text, options).gesture;

  test("English", () => {
    assert.strictEqual(mood("Hahaha, that's hilarious!"), "laughing");
    assert.strictEqual(mood("Oh wow, that's amazing!"), "excited");
    assert.strictEqual(mood("Hmm, let me think about that..."), "thinking");
    assert.strictEqual(mood("I'm so sorry to hear that."), "sad");
    assert.strictEqual(mood("Step by step: first we outline the hook."), "focused");
    assert.strictEqual(mood("Wait, you did WHAT?!"), "surprised");
    assert.strictEqual(mood("Sure... if you say so."), "skeptical");
    assert.strictEqual(mood("Congratulations, I'm so proud of you!"), "proud");
    assert.strictEqual(mood("The meeting is at three."), "neutral");
  });

  test("German", () => {
    assert.strictEqual(mood("Das ist ja wunderbar, freut mich!"), "happy");
    assert.strictEqual(mood("Echt jetzt?! Nicht dein Ernst!"), "surprised");
    assert.strictEqual(mood("Das tut mir leid, das ist wirklich traurig."), "sad");
    assert.strictEqual(mood("Na ja, wer's glaubt..."), "skeptical");
    assert.strictEqual(mood("Ich bin so müde, gute Nacht.", { role: "user" }), "sleepy");
    assert.strictEqual(mood("Wahnsinn, das ist ja krass!"), "excited");
  });

  test("Arabic, with or without vowel marks and letter variants", () => {
    assert.strictEqual(mood("هههههه ضحكتني"), "laughing");
    assert.strictEqual(mood("للأسف، هذا خبر سيء"), "sad");
    assert.strictEqual(mood("مبروك! أنا فخور بك جداً"), "proud");
    assert.strictEqual(mood("مش فاهم شو قصدك", { role: "user" }), "confused");
    assert.strictEqual(mood("أنا سعيدة جدا اليوم"), "happy"); // feminine ending, hamza on the alef
    assert.strictEqual(mood("واو، هذا مذهل!"), "excited");
  });

  test("emoji and punctuation count too", () => {
    assert.strictEqual(mood("see you tomorrow 😴"), "sleepy");
    assert.strictEqual(mood("okay 😂"), "laughing");
    assert.strictEqual(mood("That is great ❤️"), "affectionate");
  });

  test("a 'not' in front turns a word off", () => {
    assert.strictEqual(mood("That's not great."), "neutral");
    assert.strictEqual(mood("Das ist nicht schön."), "neutral");
  });

  test("gestures: hello and goodbye wave, 'no idea' shrugs, sentence starts nod or shake", () => {
    assert.strictEqual(gesture("Hey there! Good to see you.", { turnStart: true }), "wave");
    assert.strictEqual(gesture("Hey there!", { turnStart: false }), null);
    assert.strictEqual(gesture("Okay, talk soon, bye!"), "wave");
    assert.strictEqual(gesture("Tschüss, bis bald!"), "wave");
    assert.strictEqual(gesture("مع السلامة"), "wave");
    assert.strictEqual(gesture("Keine Ahnung, ehrlich."), "shrug");
    assert.strictEqual(gesture("Yeah, exactly that."), "nod");
    assert.strictEqual(gesture("No, I don't think so."), "head_shake");
    assert.strictEqual(gesture("Na ja, wer's glaubt."), null);
  });

  test("your words: it reacts (good news excites it, a compliment makes it shy)", () => {
    const news = classifier.classify("I got the job!!", { role: "user" });
    assert.strictEqual(news.reaction, "excited");
    assert.strictEqual(classifier.classify("Ich habe es geschafft, bestanden!", { role: "user" }).reaction, "excited");
    assert.strictEqual(classifier.classify("نجحت في الامتحان", { role: "user" }).reaction, "excited");
    assert.strictEqual(classifier.classify("I failed my exam today", { role: "user" }).reaction, "sad");
    const compliment = classifier.classify("You're so cute", { role: "user" });
    assert.strictEqual(compliment.gesture, "shy");
    assert.strictEqual(compliment.reaction, "affectionate");
    assert.strictEqual(classifier.classify("Hahaha", { role: "user" }).reaction, "laughing");
  });

  test("streamed captions give a reading as each sentence ends", () => {
    const c = new classifier.CaptionMood();
    const results = ["Oh ", "wow! ", "That's ", "incredible. ", "Anyway"].map((p) => c.push(p));
    assert.strictEqual(results[0], null);
    assert.strictEqual(results[1].mood, "excited");
    assert.strictEqual(results[3].mood, "excited");
    assert.strictEqual(results[4], null);
    assert.ok(c.flush());
    c.reset();
    assert.strictEqual(c.push("Hello! ").gesture, "wave");
  });
});

describe("Filming-mode keys", () => {
  const act = (key, extra = {}) => keys.keyAction({ key, ...extra });

  test("clicker buttons", () => {
    assert.strictEqual(act("PageDown"), "interrupt");
    assert.strictEqual(act("PageUp"), "mute");
    assert.strictEqual(act("F5"), "startStop");
    assert.strictEqual(act("F5", { shiftKey: true }), "startStop");
    assert.strictEqual(act("b"), "captions");
    assert.strictEqual(act("B"), "captions");
    assert.strictEqual(act("."), "captions");
    assert.strictEqual(act("Escape"), "exit");
  });

  test("keyboard letters, and what's left alone", () => {
    assert.strictEqual(act("m"), "mute");
    assert.strictEqual(act("i"), "interrupt");
    assert.strictEqual(act("s"), "startStop");
    assert.strictEqual(act("c"), "captions");
    assert.strictEqual(act("m", { ctrlKey: true }), null);
    assert.strictEqual(act("b", { shiftKey: true }), null);
    assert.strictEqual(act("PageDown", { repeat: true }), null);
    assert.strictEqual(act("x"), null);
    assert.ok(keys.isFilmingKey({ key: "f" }));
    assert.ok(!keys.isFilmingKey({ key: "f", ctrlKey: true }));
  });
});

describe("The voice, as numbers", () => {
  test("loud vowels open the mouth; silence closes it", () => {
    assert.ok(bands.voiceShape([0.5, 0.9, 0.3, 0.1]).open > 0.5);
    assert.strictEqual(bands.voiceShape([0, 0, 0, 0]).open, 0);
    assert.ok(bands.voiceShape([0.1, 0.2, 0.8, 0.4]).wide > bands.voiceShape([0.6, 0.5, 0.1, 0]).wide);
    assert.ok(bands.voiceShape([0.8, 0.4, 0.05, 0]).round > bands.voiceShape([0.1, 0.3, 0.8, 0.5]).round);
  });

  test("band levels follow the analyser and rise faster than they fall", () => {
    const bins = new Uint8Array(512);
    const floor = [0, 0, 0, 0];
    const levels = [0, 0, 0, 0];
    bins.fill(200, 4, 60);
    bands.updateVoiceLevels(bins, 48000 / 1024, floor, levels);
    const risen = levels[1];
    assert.ok(risen > 0.3);
    bins.fill(0);
    bands.updateVoiceLevels(bins, 48000 / 1024, floor, levels);
    assert.ok(levels[1] > risen * 0.5 && levels[1] < risen);
  });

  test("syllables are noticed, but not faster than a person talks", () => {
    const d = new bands.SyllableDetector({ maxRate: 6 });
    let count = 0;
    for (let i = 0; i < 120; i++) if (d.update(i % 4 < 2 ? 0.8 : 0.05, 1 / 60)) count++;
    assert.ok(count >= 4 && count <= 13, `${count} syllables in 2 s`);
  });
});

describe("The animator", () => {
  const run = (a, seconds, each) => {
    let pose;
    for (let i = 0; i < seconds * 60; i++) {
      each?.(a, i);
      pose = a.update(1 / 60);
    }
    return pose;
  };

  test("it is repeatable with the same random numbers", () => {
    const a = new animator.Animator({ random: seeded(3) });
    const b = new animator.Animator({ random: seeded(3) });
    const pa = run(a, 3);
    const pb = run(b, 3);
    assert.strictEqual(pa.hoverY, pb.hoverY);
    assert.strictEqual(pa.lookX, pb.lookX);
  });

  test("a mood shows on the face; the voice opens the mouth only while it talks", () => {
    const a = new animator.Animator({ random: seeded() });
    a.setState("speaking");
    a.setMood("happy", { source: "tool" });
    let pose = run(a, 1.5, (x) => x.setAudio([0.6, 0.8, 0.4, 0.2]));
    assert.strictEqual(pose.mood, "happy");
    assert.ok(pose.mouthCurve > 0.7);
    assert.ok(pose.mouthOpen > 0.5);
    pose = run(a, 1.5);
    assert.ok(pose.mouthOpen < 0.2, `mouth ${pose.mouthOpen}`);
  });

  test("it blinks every few seconds", () => {
    const a = new animator.Animator({ random: seeded(11) });
    let blinks = 0;
    let closed = false;
    run(a, 12, (x) => {
      const now = x.pose.blink > 0.9;
      if (now && !closed) blinks++;
      closed = now;
    });
    assert.ok(blinks >= 2 && blinks <= 8, `${blinks} blinks in 12 s`);
  });

  test("a wave raises its arm, then puts it back down", () => {
    const a = new animator.Animator({ random: seeded() });
    const rest = run(a, 1).armRRaise;
    a.gesture("wave", { priority: 3 });
    assert.ok(run(a, 0.9).armRRaise > rest + 1.5);
    assert.ok(Math.abs(run(a, 2.5).armRRaise - rest) < 0.1);
  });

  test("reduced motion keeps the face but calms the body", () => {
    const hover = (reducedMotion) => {
      const a = new animator.Animator({ random: seeded(5) });
      a.setOptions({ reducedMotion });
      let max = 0;
      run(a, 6, (x) => (max = Math.max(max, Math.abs(x.pose.hoverY))));
      return max;
    };
    assert.ok(hover(true) < hover(false) * 0.5);
    const a = new animator.Animator({ random: seeded() });
    a.setOptions({ reducedMotion: true });
    a.setMood("sad", { source: "tool" });
    assert.ok(run(a, 2).mouthCurve < -0.5);
  });

  test("while you talk it leans in and takes your color, then nods when you pause", () => {
    const a = new animator.Animator({ random: seeded() });
    a.setState("listening");
    const talking = run(a, 1.5, (x) => x.setUser(0.5));
    assert.ok(talking.finUser > 0.8);
    assert.ok(talking.bodyPitch > 0.03);
    let nodded = false;
    run(a, 1.5, (x) => (nodded ||= x.pose.gesture === "mmhm"));
    assert.ok(nodded);
  });

  test("where you sit turns its head to you while it listens", () => {
    const a = new animator.Animator({ random: seeded() });
    a.setState("listening");
    a.setSeat("right");
    assert.ok(run(a, 2).headYaw > 0.2);
    a.setState("speaking");
    assert.ok(Math.abs(run(a, 2).headYaw) < 0.12);
  });

  test("stays finite whatever the frame times", () => {
    const a = new animator.Animator({ random: seeded(9) });
    const rand = seeded(2);
    for (const state of ["connecting", "listening", "hearing", "thinking", "speaking", "standby", "error", "typing", "busy"]) {
      a.setState(state);
      for (const g of presets.GESTURES) a.gesture(g, { priority: 3 });
      run(a, 2, (x) => {
        x.setAudio([rand(), rand(), rand(), rand()]);
        x.setUser(rand());
        x.pose.t && x.update(rand() * 0.2);
      });
    }
    for (const [k, v] of Object.entries(a.pose)) if (typeof v === "number") assert.ok(Number.isFinite(v), k);
  });
});

describe("The director: app events become moods and moves", () => {
  const make = (smartMood = null) => {
    const a = new animator.Animator({ random: seeded() });
    return { a, d: new director.Director(a, { smartMood }) };
  };
  const tick = (d, a, seconds) => {
    for (let i = 0; i < seconds * 60; i++) {
      d.frame(1 / 60);
      a.update(1 / 60);
    }
  };

  test("voice mode: its first words get a wave, only once", () => {
    const { a, d } = make();
    d.openVoice();
    d.voiceState("listening");
    d.voiceState("speaking");
    assert.strictEqual(a.gestures.update(a.now)?.name, "wave");
    tick(d, a, 3);
    d.voiceState("listening");
    d.voiceState("speaking");
    tick(d, a, 0.1);
    assert.notStrictEqual(a.pose.gesture, "wave");
  });

  test("muted listening looks sleepy", () => {
    const { a, d } = make();
    d.openVoice();
    d.voiceState("listening", { muted: true });
    assert.strictEqual(a.state, "standby");
    d.voiceState("speaking", { muted: true });
    assert.strictEqual(a.state, "speaking");
  });

  test("captions set the mood; your good news excites it", () => {
    const { a, d } = make();
    d.openVoice();
    for (const piece of ["Haha, ", "that's ", "hilarious! "]) d.caption("model", piece);
    assert.strictEqual(a.moods.current(a.now), "laughing");
    const { a: a2, d: d2 } = make();
    d2.openVoice();
    d2.caption("user", "I got the job! ");
    assert.strictEqual(a2.moods.current(a2.now), "excited");
  });

  test("the AI's own choice beats the words", () => {
    const { a, d } = make();
    d.openVoice();
    d.toolEvent({ mood: "proud", gesture: "celebrate" });
    d.caption("model", "Oh no, that's so sad. ");
    assert.strictEqual(a.moods.current(a.now), "proud");
    assert.strictEqual(a.gestures.update(a.now).name, "celebrate");
  });

  test("gestures from words are rationed", () => {
    const { a, d } = make();
    d.openVoice();
    assert.ok(d.gesture("nod", presets.PRIORITY.caption));
    tick(d, a, 3);
    assert.ok(!d.gesture("nod", presets.PRIORITY.caption), "no second nod within 6 s");
    assert.ok(d.gesture("nod", presets.PRIORITY.tool), "the AI may still nod itself");
  });

  test("End waves goodbye even over another gesture, and says how long it takes", () => {
    const { a, d } = make();
    d.openVoice();
    d.toolEvent({ gesture: "shrug" });
    tick(d, a, 0.3);
    assert.ok(d.goodbye() <= 1000);
    tick(d, a, 0.6);
    assert.strictEqual(a.pose.gesture, "wave");
  });

  test("text chat: typing, waiting, talking at the text's pace, then the reply's mood", () => {
    const { a, d } = make();
    d.typing();
    assert.strictEqual(a.state, "typing");
    tick(d, a, 3);
    assert.strictEqual(a.state, "idle", "back to idle when you stop typing");
    d.waiting();
    assert.strictEqual(a.state, "waiting");
    d.text("Wow, that's amazing news! Congratulations on the new job.");
    assert.strictEqual(a.state, "streaming");
    tick(d, a, 0.5);
    assert.ok(a.pose.mouthOpen > 0.1, "the mouth moves while the text comes in");
    d.done();
    assert.ok(["excited", "proud"].includes(a.moods.current(a.now)));
    tick(d, a, 5);
    assert.strictEqual(a.state, "idle");
  });

  test("text chat events are ignored while voice mode is open", () => {
    const { a, d } = make();
    d.openVoice();
    d.voiceState("listening");
    d.typing();
    d.waiting();
    assert.strictEqual(a.state, "listening");
    d.closeVoice();
    d.typing();
    assert.strictEqual(a.state, "typing");
  });

  test("likes bounce, pins nod, errors confuse it", () => {
    const { a, d } = make();
    d.liked();
    assert.strictEqual(a.gestures.update(a.now).name, "bounce");
    assert.strictEqual(a.moods.current(a.now), "happy");
    tick(d, a, 2);
    d.pinned();
    assert.strictEqual(a.gestures.update(a.now).name, "nod");
    d.error();
    assert.strictEqual(a.state, "error");
    assert.strictEqual(a.moods.current(a.now), "confused");
  });

  test("Smarter moods: the answer shows once the turn is over", async () => {
    const asked = [];
    const { a, d } = make(async (text, heard) => (asked.push([text, heard]), "affectionate"));
    d.openVoice();
    d.caption("user", "Thanks for helping me today");
    d.caption("model", "Any time, I loved it.");
    d.turnDone();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepStrictEqual(asked, [["Any time, I loved it.", "Thanks for helping me today"]]);
    assert.strictEqual(a.moods.current(a.now), "affectionate");
  });
});

describe("Roaming and touch", () => {
  const run = (a, seconds) => {
    for (let i = 0; i < seconds * 60; i++) a.update(1 / 60);
  };
  const make = () => new animator.Animator({ random: seeded(3) });

  test("it stays where it is unless roaming is switched on", () => {
    const a = make();
    run(a, 20);
    assert.ok(Math.abs(a.pose.posX) < 1e-6 && Math.abs(a.pose.posZ) < 1e-6);
  });

  test("with roaming on it moves about, but never leaves its stage", () => {
    const a = make();
    a.setOptions({ roam: 1 });
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 60 * 90; i++) {
      a.update(1 / 60);
      min = Math.min(min, a.pose.posX);
      max = Math.max(max, a.pose.posX);
      assert.ok(Math.abs(a.pose.posX) <= 0.5 && a.pose.posZ >= -0.4 && a.pose.posZ <= 0.4, "inside the stage");
    }
    assert.ok(max - min > 0.2, "it actually travels");
  });

  test("it comes closer while you talk and backs off while it thinks", () => {
    const a = make();
    a.setOptions({ roam: 1 });
    a.setState("hearing");
    run(a, 6);
    const near = a.pose.posZ;
    a.setState("thinking");
    run(a, 6);
    assert.ok(near > 0.1 && a.pose.posZ < near - 0.2, `${near} -> ${a.pose.posZ}`);
  });

  test("reduced motion or filming (roam 0) keeps it still", () => {
    const a = make();
    a.setOptions({ roam: 1, reducedMotion: true });
    run(a, 20);
    assert.ok(Math.abs(a.pose.posX) < 1e-6);
  });

  test("it banks into a sideways move", () => {
    const a = make();
    a.setOptions({ roam: 1 });
    a.springs.impulse("posX", 1.5);
    a.update(1 / 60);
    assert.ok(a.pose.speed > 0.5);
    assert.ok(a.pose.bodyRoll < -0.05, "leans toward the way it moves");
  });

  test("poking it reacts, escalates with more pokes and pushes it away", () => {
    const a = make();
    a.setOptions({ roam: 1 });
    assert.strictEqual(a.poke("tap", { x: -1 }), true);
    assert.strictEqual(a.moods.current(a.now), "surprised");
    assert.ok(a.springs.state.posX.v > 0.5, "pushed to the right when poked on the left");
    for (let i = 0; i < 3; i++) {
      run(a, 2.5);
      a.poke("tap");
    }
    run(a, 0.05);
    assert.strictEqual(a.pokes.count, 4);
    assert.ok([a.gestures.current?.name, ...a.gestures.queue.map((g) => g.name)].includes("celebrate"));
  });
});
