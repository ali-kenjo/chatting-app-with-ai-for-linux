// ---------- The Robot Studio's panels ----------
// One builder per tab. Each makes its controls once and returns { el, refresh(robot) }: refresh
// moves every control to what the settings say now (without firing the controls' own handlers),
// so dragging a slider and the settings staying in step never fight.
import * as D from "../design.mjs";
import * as R from "../room.mjs";
import { BUILTIN_LOOKS } from "../looks.mjs";
import { t } from "../../i18n.js";
import { h, section, hint, swatches, tiles, slider, toggle, textField, button, arrowKeys, nextId } from "./ui.js";

const OUTFIT_COLORS = ["#e05a47", "#f2c14e", "#4d8a62", "#3b6fd6", "#7a5cf0", "#f06bb0", "#f4efe6", "#2b2e35", "#8a5a33", "#5eead4", "#ff8a3d"];
const ROOM_COLORS = ["#0b0b0d", "#26272c", "#3a4ea8", "#5aa6f2", "#7a5cf0", "#c0507f", "#f3a469", "#4a7a4a", "#6b4a3a", "#eaf4ff", "#ffd9b0", "#ff3ea5"];
const BLUSH_COLORS = ["#ff6f91", "#f472b6", "#ff8a3d", "#c084fc", "#5eead4"];
const percent = (v) => `${Math.round(v * 100)}%`;

const pair = (obj, path) => {
  const keys = path.split(".");
  const last = keys.pop();
  return [keys.reduce((o, k) => o[k], obj), last];
};

// ctx: { edit(fn(robotSettings)), set(path, value) for the design, setRoom(path, value) }
export function colorsPanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  const palette = D.SHELL_COLORS.map((c) => ({ color: c.color, label: c.label }));
  let linked = true;
  const head = swatches({ label: t("Head"), colors: palette, onChange: (c) => (linked ? ctx.design((d) => (d.colors.head = d.colors.body = d.colors.arms = c)) : ctx.design((d) => (d.colors.head = c))) });
  const body = swatches({ label: t("Body"), colors: palette, onChange: (c) => ctx.design((d) => (d.colors.body = c)) });
  const arms = swatches({ label: t("Arms and hands"), colors: palette, onChange: (c) => ctx.design((d) => (d.colors.arms = c)) });
  const joint = swatches({ label: t("Neck and shoulders"), colors: D.JOINT_COLORS, onChange: (c) => ctx.design((d) => (d.colors.joint = c)) });
  const same = toggle({
    label: t("One color for the whole robot"),
    onChange: (on) => {
      manual = !on;
      linked = on;
      if (on) ctx.design((d) => (d.colors.body = d.colors.arms = d.colors.head));
      sync();
    },
  });
  const separate = h("div", { class: "rs-indent" }, body.el, arms.el);
  const finish = tiles({ label: t("Finish"), items: D.FINISHES, onChange: (v) => ctx.design((d) => (d.finish = v)), compact: true, columns: 5 });
  const light = swatches({
    label: t("Light"), colors: D.LIGHT_COLORS, empty: { label: t("Auto"), title: t("Like the app's accent color (Settings → Appearance)") },
    onChange: (c) => ctx.design((d) => (d.colors.light = c)),
    hint: t("The fins, the ring and the eyes glow in this color. Auto follows the app's accent color."),
  });
  const user = swatches({
    label: t("Light while you talk"), colors: D.LIGHT_COLORS, empty: { label: t("Auto"), title: t("A color that differs from its light") },
    onChange: (c) => ctx.design((d) => (d.colors.user = c)),
  });
  const glow = slider({ label: t("How bright the lights are"), min: D.RANGES.glow[0], max: D.RANGES.glow[1], step: D.RANGES.glow[3], def: 1, value: 1, onChange: (v) => ctx.design((d) => (d.glow = v)) });

  el.append(
    section(t("Shell"), same.el, head.el, separate, joint.el, finish.el),
    section(t("Light"), light.el, user.el, glow.el)
  );
  let manual = false; // you switched "one color" off yourself: keep the separate pickers even while the colors match
  function sync() {
    separate.hidden = linked;
    head.el.querySelector(".rs-label").textContent = linked ? t("Color") : t("Head");
    same.set(linked);
  }
  return {
    el,
    refresh(robot) {
      const d = robot.design;
      const equal = d.colors.head === d.colors.body && d.colors.body === d.colors.arms;
      linked = equal && !manual;
      head.set(d.colors.head);
      body.set(d.colors.body);
      arms.set(d.colors.arms);
      joint.set(d.colors.joint);
      finish.set(d.finish);
      light.set(d.colors.light);
      user.set(d.colors.user);
      glow.set(d.glow);
      sync();
    },
  };
}

export function shapePanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  const b = D.RANGES.build;
  const sliderFor = (key, label, note = "") => slider({ label, min: b[key][0], max: b[key][1], step: b[key][3], def: b[key][2], value: b[key][2], onChange: (v) => ctx.design((d) => (d.build[key] = v)), format: percent });
  const body = tiles({ label: t("Body"), items: D.BODIES, onChange: (v) => ctx.design((d) => (d.build.bodyShape = v)), compact: true, columns: 5 });
  const top = tiles({ label: t("On top of its head"), items: D.TOPS, onChange: (v) => ctx.design((d) => (d.build.topStyle = v)), compact: true, columns: 5 });
  const hands = tiles({ label: t("Hands"), items: D.HANDS, onChange: (v) => ctx.design((d) => (d.build.handStyle = v)), compact: true, columns: 4 });
  const hover = tiles({ label: t("How it floats"), items: D.HOVERS, onChange: (v) => ctx.design((d) => (d.build.hover = v)), compact: true, columns: 4 });
  const sliders = {
    size: sliderFor("size", t("Overall size")),
    head: sliderFor("head", t("Head size")),
    roundness: slider({ label: t("Head shape"), min: 0, max: 1, step: 0.01, def: b.roundness[2], value: b.roundness[2], onChange: (v) => ctx.design((d) => (d.build.roundness = v)), format: (v) => (v < 0.2 ? t("Boxy") : v > 0.8 ? t("Round") : t("Soft")) }),
    width: sliderFor("width", t("Body width")),
    height: sliderFor("height", t("Body height")),
    arms: sliderFor("arms", t("Arm length")),
    hands: sliderFor("hands", t("Hand size")),
    top: sliderFor("top", t("Size of the fins, ears or antennae")),
  };
  el.append(
    section(t("Shapes"), body.el, top.el, hands.el, hover.el),
    section(t("Proportions"), hint(t("Double-click a slider to put it back.")), ...Object.values(sliders).map((s) => s.el))
  );
  return {
    el,
    refresh(robot) {
      const bd = robot.design.build;
      body.set(bd.bodyShape);
      top.set(bd.topStyle);
      hands.set(bd.handStyle);
      hover.set(bd.hover);
      for (const [key, s] of Object.entries(sliders)) s.set(bd[key]);
    },
  };
}

export function facePanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  const eyes = tiles({ label: t("Eyes"), items: D.EYES, onChange: (v) => ctx.design((d) => (d.face.eyes = v)), compact: true, columns: 4 });
  const eyeSize = slider({ label: t("Eye size"), min: D.RANGES.face.eyeSize[0], max: D.RANGES.face.eyeSize[1], step: 0.01, def: 1, value: 1, onChange: (v) => ctx.design((d) => (d.face.eyeSize = v)), format: percent });
  const eyeGap = slider({ label: t("Space between the eyes"), min: D.RANGES.face.eyeGap[0], max: D.RANGES.face.eyeGap[1], step: 0.01, def: 1, value: 1, onChange: (v) => ctx.design((d) => (d.face.eyeGap = v)), format: percent });
  const mouth = tiles({ label: t("Mouth"), items: D.MOUTHS, onChange: (v) => ctx.design((d) => (d.face.mouth = v)), compact: true, columns: 5 });
  const color = swatches({
    label: t("Color of the eyes and mouth"), colors: D.LIGHT_COLORS, empty: { label: t("Light"), title: t("Like its light color") },
    onChange: (c) => ctx.design((d) => (d.colors.face = c)),
  });
  const blush = swatches({ label: t("Blush"), colors: BLUSH_COLORS, onChange: (c) => ctx.design((d) => (d.face.blush = c)), hint: t("Shows when it's shy or happy.") });
  el.append(section(t("Eyes"), eyes.el, eyeSize.el, eyeGap.el), section(t("Mouth"), mouth.el), section(t("Colors"), color.el, blush.el));
  return {
    el,
    refresh(robot) {
      const d = robot.design;
      eyes.set(d.face.eyes);
      eyeSize.set(d.face.eyeSize);
      eyeGap.set(d.face.eyeGap);
      mouth.set(d.face.mouth);
      color.set(d.colors.face);
      blush.set(d.face.blush);
    },
  };
}

// ---------- Outfit ----------
export function outfitPanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  let slot = "hat";
  let shown = null; // which item the open slot's controls were made for
  const nav = h("div", { class: "rs-subtabs", role: "tablist", "aria-label": t("Part of the robot") });
  const tabs = new Map();
  for (const s of D.SLOTS) {
    const b = h("button", { type: "button", class: "rs-subtab", role: "tab", id: nextId("rs-slot"), "aria-selected": "false", "data-slot": s.id }, h("span", { text: t(s.label) }), h("i", { class: "rs-dot", "aria-hidden": "true" }));
    b.addEventListener("click", () => {
      slot = s.id;
      shown = null;
      ctx.refresh();
    });
    tabs.set(s.id, b);
    nav.append(b);
  }
  arrowKeys(nav, 'button[role="tab"]');
  const content = h("div", { class: "rs-slot-body", role: "tabpanel" });
  el.append(nav, content);

  function render(robot) {
    const o = robot.design.outfit[slot];
    const def = D.SLOTS.find((s) => s.id === slot);
    const items = D.OUTFIT[slot];
    const key = `${slot}|${o.item}`;
    for (const [id, b] of tabs) {
      const on = id === slot;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("on", on);
      b.classList.toggle("worn", robot.design.outfit[id].item !== "none");
    }
    content.setAttribute("aria-labelledby", tabs.get(slot).id);
    if (shown === key) return updateColors(robot);
    shown = key;
    content.replaceChildren();
    const choose = tiles({
      label: null, items, value: o.item, columns: 4,
      onChange: (id) => {
        ctx.design((d) => {
          const it = D.ITEMS[slot][id];
          d.outfit[slot] = { item: id, c1: it.colors[0] ?? "", c2: it.colors[1] ?? "", pattern: d.outfit[slot].pattern };
        });
      },
    });
    content.append(choose.el);
    const item = D.ITEMS[slot][o.item];
    if (o.item !== "none") {
      const colors = h("div", { class: "rs-colors" });
      const names = item.names;
      const make = (n) => {
        const empty = item.colors[n] === "" ? { label: t("Light"), title: t("Like its light color") } : null;
        return swatches({ label: t(names[n] || (n ? "Second color" : "Color")), colors: OUTFIT_COLORS, empty, onChange: (c) => ctx.design((d) => (d.outfit[slot][n ? "c2" : "c1"] = c)) });
      };
      const first = make(0);
      colors.append(first.el);
      const second = names.length > 1 ? make(1) : null;
      if (second) colors.append(second.el);
      content.append(section(t("Colors"), colors));
      content.colors = [first, second];
      if (def.pattern) {
        const pattern = tiles({ label: t("Pattern"), items: D.PATTERNS, value: o.pattern, columns: 4, compact: true, onChange: (v) => ctx.design((d) => (d.outfit[slot].pattern = v)) });
        content.append(section(t("Pattern"), pattern.el));
        content.pattern = pattern;
      } else content.pattern = null;
    } else {
      content.colors = null;
      content.append(hint(t("Nothing here yet. Pick something above.")));
    }
    content.choose = choose;
    updateColors(robot);
  }
  function updateColors(robot) {
    const o = robot.design.outfit[slot];
    content.choose?.set(o.item);
    if (content.colors) {
      content.colors[0]?.set(o.c1);
      content.colors[1]?.set(o.c2);
    }
    content.pattern?.set(o.pattern);
  }
  return { el, refresh: render };
}

// ---------- Room ----------
export function roomPanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  const places = tiles({ label: t("Place"), items: R.PLACES, onChange: (id) => ctx.place(id), columns: 3 });
  const dynamic = h("div", { class: "rs-room-dynamic" });
  const light = tiles({ label: t("Light"), items: R.LIGHTS, onChange: (v) => ctx.room((r) => (r.light = v)), compact: true, columns: 4 });
  const brightness = slider({ label: t("Brightness"), min: R.RANGES.brightness[0], max: R.RANGES.brightness[1], step: 0.01, def: 1, value: 1, onChange: (v) => ctx.room((r) => (r.brightness = v)), format: percent });
  const floor = tiles({ label: t("Floor"), items: R.FLOORS, onChange: (v) => ctx.room((r) => (r.floor = v)), compact: true, columns: 5 });
  const air = tiles({ label: t("In the air"), items: R.AIRS, onChange: (v) => ctx.room((r) => (r.air = v)), compact: true, columns: 5 });
  const amount = slider({ label: t("How much"), min: R.RANGES.airAmount[0], max: R.RANGES.airAmount[1], step: 0.01, def: 1, value: 1, onChange: (v) => ctx.room((r) => (r.airAmount = v)), format: percent });
  const surprise = button(t("Surprise me"), () => ctx.randomRoom(), { icon: "🎲" });
  const lighting = section(t("Lighting"), light.el, brightness.el);
  const ground = section(t("Floor"), floor.el);
  const atmosphere = section(t("Atmosphere"), air.el, amount.el);
  el.append(section(t("Place"), places.el, h("div", { class: "rs-actions" }, surprise)), dynamic, lighting, ground, atmosphere);

  let builtFor = null;
  let colorControls = {};
  let propControls = {};
  let sign = null;
  let photo = null;

  function build(room) {
    const place = R.PLACE_BY_ID[room.place];
    builtFor = room.place;
    colorControls = {};
    propControls = {};
    sign = null;
    photo = null;
    dynamic.replaceChildren();
    const colors = [];
    if (!place.chroma) {
      for (const key of R.COLOR_KEYS) {
        if (!place.names[key]) continue;
        const c = swatches({
          label: t(place.names[key]), colors: ROOM_COLORS, empty: key === "glow" ? { label: t("Light"), title: t("Like the robot's light color") } : null,
          onChange: (v) => ctx.room((r) => (r.colors[key] = v)),
        });
        colorControls[key] = c;
        colors.push(c.el);
      }
    }
    if (colors.length) dynamic.append(section(t("Colors"), ...colors, h("div", { class: "rs-actions" }, button(t("Back to the usual colors"), () => ctx.room((r) => (r.colors = { ...place.colors })), { icon: "↺" }))));
    if (place.props.length || place.sign) {
      const list = [];
      for (const prop of place.props) {
        const c = toggle({ label: t(prop.label), onChange: (on) => ctx.room((r) => (r.props[prop.id] = on)) });
        propControls[prop.id] = c;
        list.push(c.el);
      }
      if (place.sign) {
        sign = textField({ label: t("Words on the sign"), max: 16, placeholder: t("ON AIR"), onChange: (v) => ctx.room((r) => (r.sign = v)) });
        list.push(sign.el);
      }
      dynamic.append(section(t("What's in the room"), ...list));
    }
    if (place.photo) {
      photo = ctx.photoControls();
      dynamic.append(section(t("Your picture"), photo.el));
    }
    el.classList.toggle("is-chroma", Boolean(place.chroma));
    lighting.hidden = ground.hidden = atmosphere.hidden = Boolean(place.chroma);
  }
  return {
    el,
    refresh(robot) {
      const room = robot.room;
      if (builtFor !== room.place) build(room);
      places.set(room.place);
      for (const [key, c] of Object.entries(colorControls)) c.set(room.colors[key]);
      for (const [id, c] of Object.entries(propControls)) c.set(room.props[id]);
      sign?.set(room.sign);
      photo?.refresh(room);
      light.set(room.light);
      brightness.set(room.brightness);
      floor.set(room.floor);
      air.set(room.air);
      amount.set(room.airAmount);
      amount.el.hidden = room.air === "none";
    },
  };
}

// ---------- Looks ----------
export function looksPanel(ctx) {
  const el = h("div", { class: "rs-panel-body" });
  const builtin = h("div", { class: "rs-looks", role: "list" });
  const mine = h("div", { class: "rs-looks", role: "list" });
  const empty = hint(t("Nothing saved yet. Make it yours in the other tabs, then save it here."));
  const name = textField({ label: t("Name this look"), max: 40, value: "", placeholder: t("My look"), onChange: () => {} });
  const save = button(t("Save this look"), () => ctx.saveLook(name.input.value), { primary: true, icon: "💾" });
  const surprise = button(t("Surprise me"), () => ctx.randomLook(), { icon: "🎲" });
  const exportBtn = button(t("Export…"), () => ctx.exportLook(name.input.value), { icon: "⤓", title: t("Save this look as a file you can share") });
  const importBtn = button(t("Import…"), () => ctx.importLook(), { icon: "⤒", title: t("Open a look someone shared") });
  const note = h("p", { class: "rs-hint", text: t("Each character keeps its own look while \"Each has its own look\" is on (Settings → Characters).") });
  el.append(
    section(t("Make it yours"), h("div", { class: "rs-save" }, name.el, save), h("div", { class: "rs-actions" }, surprise, exportBtn, importBtn), note),
    section(t("My looks"), mine, empty),
    section(t("Start from a look"), builtin)
  );

  const card = (look, { saved = false } = {}) => {
    const d = look.design;
    const worn = Object.values(d.outfit).filter((o) => o.item !== "none").map((o) => D.ITEMS[Object.keys(d.outfit).find((k) => d.outfit[k] === o)][o.item].icon);
    const place = R.PLACE_BY_ID[look.room.place];
    const b = h(
      "button", { type: "button", class: "rs-look", role: "listitem", "data-id": look.id, title: look.about ? t(look.about) : "" },
      h("span", { class: "rs-look-swatch", "aria-hidden": "true", style: `--a:${d.colors.head};--b:${d.colors.body};--c:${d.colors.light || "var(--accent)"}` }, h("span", { class: "rs-look-eyes" }, h("i"), h("i"))),
      h("span", { class: "rs-look-name", text: look.builtin ? t(look.label) : look.name }),
      h("span", { class: "rs-look-things", "aria-hidden": "true", text: `${worn.slice(0, 4).join(" ")} ${place?.icon || ""}`.trim() })
    );
    b.addEventListener("click", () => ctx.applyLook(look));
    if (!saved) return b;
    const wrap = h("div", { class: "rs-look-wrap" }, b);
    const del = h("button", { type: "button", class: "rs-look-del", "aria-label": t("Delete {name}", { name: look.name }), title: t("Delete this look") }, "✕");
    del.addEventListener("click", () => ctx.deleteLook(look));
    wrap.append(del);
    return wrap;
  };
  builtin.replaceChildren(...BUILTIN_LOOKS.map((l) => card(l)));

  let key = "";
  return {
    el,
    refresh(robot) {
      const k = JSON.stringify(robot.looks.map((l) => [l.id, l.name]));
      if (k === key) return;
      key = k;
      mine.replaceChildren(...robot.looks.map((l) => card(l, { saved: true })));
      empty.hidden = robot.looks.length > 0;
    },
  };
}
