const { test, describe, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("The robot's look: design, room and saved looks", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "friends-robot-look-test-"));
  process.env.FRIENDS_DATA_DIR = tempDir;
  process.env.KEYRING_BACKEND = "file";

  const settings = require("../server/settings");
  const characters = require("../server/characters");
  const { design: D, room: R } = require("../server/robot-look");

  after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  test("the default design is complete and stays what sanitizing makes of it", () => {
    const d = D.defaultDesign();
    assert.deepStrictEqual(D.sanitizeDesign(d), d);
    assert.deepStrictEqual(D.sanitizeDesign(undefined), d);
    assert.deepStrictEqual(D.sanitizeDesign("junk"), d);
    assert.deepStrictEqual(Object.keys(d.outfit), D.SLOTS.map((s) => s.id));
    for (const slot of Object.values(d.outfit)) assert.strictEqual(slot.item, "none");
  });

  test("colors must be #rrggbb, numbers are clamped, unknown choices fall back", () => {
    const d = D.sanitizeDesign({
      colors: { head: "red", body: "#ABCDEF", light: "", user: "nope", face: "#00ff00" },
      finish: "shiny",
      glow: 99,
      build: { size: -4, head: "big", roundness: 0.2, topStyle: "horns", bodyShape: "cube", hover: "jets" },
      face: { eyes: "visor", mouth: "evil", eyeSize: 9, eyeGap: 0 },
    });
    assert.strictEqual(d.colors.head, D.DEFAULT_DESIGN.colors.head);
    assert.strictEqual(d.colors.body, "#abcdef");
    assert.strictEqual(d.colors.light, "");
    assert.strictEqual(d.colors.user, "");
    assert.strictEqual(d.colors.face, "#00ff00");
    assert.strictEqual(d.finish, "glossy");
    assert.strictEqual(d.glow, D.RANGES.glow[1]);
    assert.strictEqual(d.build.size, D.RANGES.build.size[0]);
    assert.strictEqual(d.build.head, 1);
    assert.strictEqual(d.build.roundness, 0.2);
    assert.strictEqual(d.build.topStyle, "horns");
    assert.strictEqual(d.build.bodyShape, "bean");
    assert.strictEqual(d.build.hover, "jets");
    assert.strictEqual(d.face.eyes, "visor");
    assert.strictEqual(d.face.mouth, "line");
    assert.strictEqual(d.face.eyeSize, D.RANGES.face.eyeSize[1]);
    assert.strictEqual(d.face.eyeGap, D.RANGES.face.eyeGap[0]);
  });

  test("an outfit item starts with its own colors; a pattern only belongs to clothes", () => {
    const d = D.sanitizeDesign({ outfit: { hat: { item: "crown", pattern: "stars" }, torso: { item: "sweater", c1: "#112233", pattern: "stripes" }, back: { item: "dragon" } } });
    assert.deepStrictEqual(d.outfit.hat, { item: "crown", c1: "#f2c14e", c2: "#d9435b", pattern: "solid" });
    assert.deepStrictEqual(d.outfit.torso, { item: "sweater", c1: "#112233", c2: "#f4efe6", pattern: "stripes" });
    assert.strictEqual(d.outfit.back.item, "none");
    assert.strictEqual(d.outfit.back.c1, "");
  });

  test("every catalog item has a name and starting colors that are valid", () => {
    for (const [slot, list] of Object.entries(D.OUTFIT)) {
      assert.strictEqual(list[0].id, "none", slot);
      for (const it of list) {
        assert.ok(it.label && it.icon, `${slot}/${it.id}`);
        for (const c of it.colors) assert.ok(c === "" || D.HEX.test(c), `${slot}/${it.id}: ${c}`);
        assert.strictEqual(it.names.length, it.colors.length, `${slot}/${it.id}`);
      }
      assert.strictEqual(new Set(list.map((i) => i.id)).size, list.length, `${slot} ids`);
    }
  });

  test("Surprise me: a seed always gives the same valid robot, and different seeds differ", () => {
    const a = D.randomDesign(7);
    assert.deepStrictEqual(a, D.randomDesign(7));
    assert.deepStrictEqual(a, D.sanitizeDesign(a));
    const seen = new Set(Array.from({ length: 12 }, (_, i) => JSON.stringify(D.randomDesign(i + 1))));
    assert.ok(seen.size >= 10);
  });

  test("the shape key ignores colors but notices anything that changes the shapes", () => {
    const d = D.defaultDesign();
    const recolored = D.sanitizeDesign({ ...d, colors: { ...d.colors, head: "#ff0000" }, finish: "matte", glow: 1.5 });
    assert.strictEqual(D.shapeKey(recolored), D.shapeKey(d));
    assert.notStrictEqual(D.shapeKey(D.sanitizeDesign({ ...d, build: { ...d.build, head: 1.2 } })), D.shapeKey(d));
    assert.notStrictEqual(D.shapeKey(D.sanitizeDesign({ ...d, outfit: { ...d.outfit, hat: { item: "beanie" } } })), D.shapeKey(d));
    const worn = D.sanitizeDesign({ outfit: { hat: { item: "beanie" } } });
    const recoloredHat = D.sanitizeDesign({ outfit: { hat: { item: "beanie", c1: "#00ff00" } } });
    assert.strictEqual(D.shapeKey(worn), D.shapeKey(recoloredHat));
  });

  test("a room belongs to a place, and only that place's props are kept", () => {
    const r = R.sanitizeRoom({ place: "podcast", props: { sign: false, plant: true, planet: true }, sign: "  LIVE\n NOW  ", light: "disco", brightness: 7, air: "snow", colors: { wall: "#101010", floor: "bad" } });
    assert.strictEqual(r.place, "podcast");
    assert.deepStrictEqual(Object.keys(r.props), ["sign", "panels", "mic", "pendants", "plant"]);
    assert.strictEqual(r.props.sign, false);
    assert.strictEqual(r.props.plant, true);
    assert.strictEqual(r.props.panels, true);
    assert.strictEqual(r.sign, "LIVE NOW");
    assert.strictEqual(r.light, "neon");
    assert.strictEqual(r.brightness, R.RANGES.brightness[1]);
    assert.strictEqual(r.air, "snow");
    assert.strictEqual(r.colors.wall, "#101010");
    assert.strictEqual(r.colors.floor, R.PLACE_BY_ID.podcast.colors.floor);
    assert.deepStrictEqual(R.sanitizeRoom(r), r);
    assert.strictEqual(R.sanitizeRoom({ place: "https://evil.example" }).place, "studio");
  });

  test("moving to another place starts from that place, but keeps your sign text and brightness", () => {
    const r = R.sanitizeRoom({ place: "studio", sign: "MY SHOW", brightness: 1.3, colors: { wall: "#ff0000" } });
    const moved = R.changePlace(r, "city");
    assert.strictEqual(moved.place, "city");
    assert.strictEqual(moved.colors.wall, R.PLACE_BY_ID.city.colors.wall);
    assert.strictEqual(moved.sign, "MY SHOW");
    assert.strictEqual(moved.brightness, 1.3);
    assert.deepStrictEqual(R.sanitizeRoom(moved), moved);
  });

  test("every place has what the 3D room needs: names for its colors, valid light, floor and air", () => {
    for (const p of R.PLACES) {
      assert.ok(R.LIGHT_MOODS[p.light], p.id);
      assert.ok(R.FLOORS.some((f) => f.id === p.floor), p.id);
      assert.ok(R.AIRS.some((a) => a.id === p.air), p.id);
      if (!p.chroma) for (const key of R.COLOR_KEYS) assert.ok(p.names[key], `${p.id}.${key}`);
      for (const c of Object.values(p.colors)) assert.ok(c === "" || /^#[0-9a-f]{6}$/.test(c), p.id);
    }
    const green = R.resolved(R.roomFor("green"));
    assert.strictEqual(green.place.chroma, true);
  });

  test("older settings: the shell, eyes and mouth become the design, the background the room", () => {
    const s = settings.sanitize({ robot: { shell: "mint", eyes: "round", mouth: false, background: "accent", shot: "close" } });
    assert.strictEqual(s.robot.design.colors.head, "#c9e5d6");
    assert.strictEqual(s.robot.design.colors.arms, "#c9e5d6");
    assert.strictEqual(s.robot.design.face.eyes, "round");
    assert.strictEqual(s.robot.design.face.mouth, "none");
    assert.strictEqual(s.robot.room.place, "glow");
    assert.strictEqual(s.robot.shot, "close");
    assert.strictEqual(s.robot.shell, undefined);
    assert.strictEqual(s.robot.background, undefined);
    // a design that is already there wins over the old keys
    const both = settings.sanitize({ robot: { shell: "mint", design: { colors: { head: "#112233" } } } });
    assert.strictEqual(both.robot.design.colors.head, "#112233");
  });

  test("a saved design and room survive saving, with a podcast room's props", () => {
    const design = D.randomDesign(3);
    const room = R.sanitizeRoom({ place: "podcast", sign: "HELLO", props: { mic: false } });
    const saved = settings.set({ robot: { design, room } }).robot;
    assert.deepStrictEqual(saved.design, design);
    assert.deepStrictEqual(saved.room, room);
    const again = JSON.parse(fs.readFileSync(path.join(tempDir, "settings.json"), "utf8")).robot;
    assert.deepStrictEqual(again.room, room);
    assert.strictEqual(again.room.props.mic, false);
  });

  test("saved looks: at most 24, names kept short, ids unique, junk dropped", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `look-${i}`, name: `Look ${i}`, design: D.randomDesign(i + 1), room: R.roomFor("space") }));
    many.push(null, "x", 5);
    const looks = settings.set({ robot: { looks: many } }).robot.looks;
    assert.strictEqual(looks.length, 24);
    assert.strictEqual(looks[0].room.place, "space");
    const dupes = settings.set({ robot: { looks: [{ id: "a", name: "A".repeat(100) }, { id: "a", name: "B" }] } }).robot.looks;
    assert.strictEqual(dupes.length, 1);
    assert.strictEqual(dupes[0].name.length, 40);
    assert.deepStrictEqual(dupes[0].design, D.defaultDesign());
    assert.deepStrictEqual(settings.set({ robot: { looks: "nope" } }).robot.looks, []);
  });

  test("a character's look carries a design and a room; old looks are upgraded", () => {
    const list = characters.sanitize({ list: [] }).list;
    const atlas = list.find((c) => c.id === "atlas");
    const mira = list.find((c) => c.id === "mira");
    assert.strictEqual(atlas.look.design.colors.head, "#50555f");
    assert.strictEqual(mira.look.design.face.eyes, "round");
    assert.strictEqual(mira.look.room.place, "studio");
    const old = characters.sanitize({ list: [{ id: "x1", name: "Old", look: { shell: "mint", eyes: "wide", accent: "#abcdef" } }] }).list.find((c) => c.id === "x1");
    assert.strictEqual(old.look.design.colors.head, "#c9e5d6");
    assert.strictEqual(old.look.design.face.eyes, "wide");
    assert.strictEqual(old.look.accent, "#abcdef");
    const fresh = characters.sanitize({ list: [{ id: "x2", name: "New", look: { design: { colors: { head: "#123456" }, outfit: { hat: { item: "crown" } } }, room: { place: "garden" } } }] }).list.find((c) => c.id === "x2");
    assert.strictEqual(fresh.look.design.colors.head, "#123456");
    assert.strictEqual(fresh.look.design.outfit.hat.item, "crown");
    assert.strictEqual(fresh.look.room.place, "garden");
  });
});
