// ---------- The Robot Studio's controls ----------
// Small builders: a row of color swatches, a grid of tiles, a slider, a switch, a section.
// Each returns { el, set(value) } (set updates it from outside without firing onChange), so a panel
// can be built once and kept in step with the settings while you drag.
import { t } from "../../i18n.js";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

let uid = 0;
export const nextId = (prefix = "rs") => `${prefix}-${++uid}`;

// A heading and a group of controls
export function section(title, ...kids) {
  const id = nextId("rs-sec");
  const sec = h("section", { class: "rs-section", "aria-labelledby": id }, h("h4", { id, class: "rs-section-title", text: title }), ...kids);
  return sec;
}

export function hint(text) {
  return h("p", { class: "rs-hint", text });
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// A row of color swatches plus a custom color. empty: { label, title } adds a first chip for "" (automatic)
export function swatches({ label, colors, value = "", onChange, empty = null, hint: note = "" }) {
  const id = nextId("rs-sw");
  const group = h("div", { class: "rs-swatches", role: "radiogroup", "aria-labelledby": id });
  const buttons = [];
  const make = (color, name, extra = {}) => {
    const b = h("button", { type: "button", class: `rs-swatch ${extra.class || ""}`, role: "radio", "aria-checked": "false", "aria-label": name, title: name, "data-color": color, style: color ? `--c:${color}` : "" });
    b.addEventListener("click", () => onChange(color));
    buttons.push(b);
    return b;
  };
  if (empty) {
    const auto = make("", empty.label, { class: "auto" });
    auto.title = empty.title || empty.label;
    auto.textContent = empty.label;
    group.append(auto);
  }
  for (const c of colors) group.append(make(c.color || c, c.label ? t(c.label) : c.color || c));
  // Any color: the browser's own picker, shown as a swatch with a ring of colors
  const custom = h("label", { class: "rs-swatch custom", title: t("Pick any color") }, h("span", { class: "sr-only", text: t("Pick any color") }));
  const input = h("input", { type: "color", "aria-label": t("Pick any color") });
  input.addEventListener("input", () => onChange(input.value));
  custom.append(input);
  group.append(custom);
  const el = h("div", { class: "rs-field" }, h("div", { id, class: "rs-label", text: label }), group, note ? h("div", { class: "rs-note", text: note }) : null);
  const set = (v) => {
    let found = false;
    for (const b of buttons) {
      const on = same(b.dataset.color, v);
      b.setAttribute("aria-checked", String(on));
      b.classList.toggle("on", on);
      b.tabIndex = on ? 0 : -1;
      if (on) found = true;
    }
    custom.classList.toggle("on", !found && Boolean(v));
    custom.style.setProperty("--c", !found && v ? v : "");
    if (v && /^#[0-9a-f]{6}$/i.test(v)) input.value = v;
    if (!found && !v) buttons[0]?.setAttribute("tabindex", "0");
    if (!buttons.some((b) => b.tabIndex === 0)) buttons[0] && (buttons[0].tabIndex = 0);
  };
  arrowKeys(group, 'button[role="radio"]');
  set(value);
  return { el, set };
}

// A grid of tiles (an icon and a name): one is chosen
export function tiles({ label, items, value, onChange, columns = 0, compact = false, hint: note = "" }) {
  const id = nextId("rs-tiles");
  const group = h("div", { class: `rs-tiles${compact ? " compact" : ""}`, role: "radiogroup", "aria-labelledby": id, style: columns ? `--cols:${columns}` : "" });
  const buttons = new Map();
  for (const item of items) {
    const b = h("button", { type: "button", class: "rs-tile", role: "radio", "aria-checked": "false", "data-id": item.id, title: item.about ? `${t(item.label)}: ${t(item.about)}` : t(item.label) }, h("span", { class: "rs-tile-icon", "aria-hidden": "true", text: item.icon || "" }), h("span", { class: "rs-tile-label", text: t(item.label) }));
    b.addEventListener("click", () => onChange(item.id));
    buttons.set(item.id, b);
    group.append(b);
  }
  arrowKeys(group, 'button[role="radio"]');
  const el = h("div", { class: "rs-field" }, label ? h("div", { id, class: "rs-label", text: label }) : h("span", { id, class: "sr-only", text: "" }), group, note ? h("div", { class: "rs-note", text: note }) : null);
  const set = (v) => {
    let any = false;
    for (const [k, b] of buttons) {
      const on = k === v;
      b.setAttribute("aria-checked", String(on));
      b.classList.toggle("on", on);
      b.tabIndex = on ? 0 : -1;
      any ||= on;
    }
    if (!any) buttons.values().next().value.tabIndex = 0;
  };
  set(value);
  return { el, set, buttons };
}

// A slider; format turns the number into the words shown next to it
export function slider({ label, min, max, step = 0.01, value, def, onChange, format = (v) => `${Math.round(v * 100)}%` }) {
  const id = nextId("rs-range");
  const out = h("output", { for: id, class: "rs-value" });
  const input = h("input", { id, type: "range", min, max, step, class: "rs-range" });
  const el = h("div", { class: "rs-field rs-slider" }, h("label", { for: id, class: "rs-label rs-label-row" }, h("span", { text: label }), out), input);
  input.addEventListener("input", () => {
    out.textContent = format(+input.value);
    onChange(+input.value);
  });
  // Double-click (or double-tap) puts it back to its usual size
  input.addEventListener("dblclick", () => {
    if (def === undefined) return;
    set(def);
    onChange(def);
  });
  const set = (v) => {
    input.value = v;
    out.textContent = format(+v);
    input.style.setProperty("--p", `${((v - min) / (max - min)) * 100}%`);
  };
  input.addEventListener("input", () => input.style.setProperty("--p", `${((+input.value - min) / (max - min)) * 100}%`));
  set(value);
  return { el, set };
}

export function toggle({ label, value = false, onChange, note = "" }) {
  const input = h("input", { type: "checkbox", class: "toggle" });
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  const el = h("label", { class: "rs-toggle" }, h("span", { class: "rs-toggle-text" }, h("span", { class: "rs-label", text: label }), note ? h("span", { class: "rs-note", text: note }) : null), input);
  return { el, set: (v) => (input.checked = Boolean(v)) };
}

export function textField({ label, value = "", max = 16, onChange, placeholder = "" }) {
  const id = nextId("rs-text");
  const input = h("input", { id, type: "text", class: "field", maxlength: max, placeholder, autocomplete: "off", spellcheck: "false" });
  input.value = value;
  input.addEventListener("input", () => onChange(input.value));
  const el = h("div", { class: "rs-field" }, h("label", { for: id, class: "rs-label", text: label }), input);
  return { el, set: (v) => document.activeElement !== input && (input.value = v), input };
}

export function button(text, onClick, { primary = false, small = true, icon = "", title = "" } = {}) {
  const b = h("button", { type: "button", class: `btn${small ? " small" : ""}${primary ? " btn-primary" : ""}`, title: title || undefined }, icon ? h("span", { "aria-hidden": "true", text: icon }) : null, icon ? " " : null, text);
  b.addEventListener("click", onClick);
  return b;
}

// Arrow keys move between the choices of a radio group, like any other
export function arrowKeys(group, selector) {
  group.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const list = [...group.querySelectorAll(selector)];
    const at = list.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const rtl = document.documentElement.dir === "rtl";
    let next = at;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else {
      const back = e.key === "ArrowUp" || (e.key === "ArrowLeft" && !rtl) || (e.key === "ArrowRight" && rtl);
      next = (at + (back ? -1 : 1) + list.length) % list.length;
    }
    list[next].focus();
    list[next].click();
  });
}
