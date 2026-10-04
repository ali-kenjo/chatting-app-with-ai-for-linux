// ---------- Characters ----------
// Who the AI is: Atlas, Mira or your own (server/characters.js has the
// built-ins and what each part means). One is active; the names at the top of
// the chat and in voice mode switch between them, and Settings → Characters
// edits them. Each can have its own look: switching keeps the robot's shell,
// eyes and the accent color with the character you leave, and brings back the
// new one's.
import { api } from "./api.js";
import { getSettings, onSettings, updateSettings } from "./store.js";
import { playbackRate, voiceErrorText } from "./personality.js";

const switches = [document.getElementById("character-switch"), document.getElementById("voice-character-switch")];
const grid = document.getElementById("char-grid");
const editor = document.getElementById("char-editor");
const template = document.getElementById("char-template");
const status = document.getElementById("char-status");
const voiceError = document.getElementById("voice-error");

let meta = null; // voices, fields, built-ins and templates, from the helper
let editing = null; // id of the character open in the editor
let renderedEditor = null; // what the editor shows now (it isn't redrawn while you type)

export const activeCharacter = (s = getSettings()) => s?.characters?.list.find((c) => c.id === s.characters.active) || s?.characters?.list[0] || null;
export const characterName = () => activeCharacter()?.name || "Companion";

const initial = (name) => (name || "?").trim().charAt(0).toUpperCase();

// Switches to a character. Its look comes with it (when that's on).
export function activate(id) {
  const s = getSettings();
  if (!s || s.characters.active === id) return;
  updateSettings((s) => {
    const chars = s.characters;
    const prev = chars.list.find((c) => c.id === chars.active);
    const next = chars.list.find((c) => c.id === id);
    if (!next) return;
    if (chars.switchLook) {
      if (prev) prev.look = { shell: s.robot.shell, eyes: s.robot.eyes, accent: s.theme.accent };
      if (next.look) {
        s.robot.shell = next.look.shell;
        s.robot.eyes = next.look.eyes;
        s.theme.accent = next.look.accent;
      }
    }
    chars.active = id;
  });
  document.dispatchEvent(new CustomEvent("friends:character", { detail: { id } }));
}

// ----- The switch (chat and voice mode) -----
function renderSwitch(el, s) {
  if (!el) return;
  const list = s.characters.list;
  el.replaceChildren(
    ...list.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "character-chip";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(c.id === s.characters.active));
      b.dataset.id = c.id;
      b.title = c.tagline ? `${c.name}: ${c.tagline}` : c.name;
      b.style.setProperty("--c", c.look?.accent || "var(--accent)");
      b.innerHTML = '<span class="character-dot" aria-hidden="true"></span><span class="character-name"></span>';
      b.querySelector(".character-dot").textContent = initial(c.name);
      b.querySelector(".character-name").textContent = c.name;
      return b;
    })
  );
  el.hidden = list.length < 2;
}

for (const el of switches) {
  el?.addEventListener("click", (e) => {
    const chip = e.target.closest(".character-chip");
    if (chip) activate(chip.dataset.id);
  });
}

// ----- Settings → Characters: the cards -----
function renderGrid(s) {
  grid.replaceChildren(
    ...s.characters.list.map((c) => {
      const card = document.createElement("div");
      card.className = "char-card";
      card.classList.toggle("active", c.id === s.characters.active);
      card.classList.toggle("editing", c.id === editing);
      card.dataset.id = c.id;
      card.style.setProperty("--c", c.look?.accent || "var(--accent)");
      card.innerHTML = `<span class="char-avatar" aria-hidden="true"></span>
        <span class="char-text"><strong></strong><span class="char-tagline"></span><span class="char-voice"></span></span>
        <span class="char-actions">
          <button type="button" class="btn small" data-act="talk"></button>
          <button type="button" class="btn small" data-act="edit"></button>
        </span>`;
      card.querySelector(".char-avatar").textContent = initial(c.name);
      card.querySelector("strong").textContent = c.name;
      card.querySelector(".char-tagline").textContent = c.tagline || "";
      const voice = meta?.voices.find((v) => v.name === c.voice);
      card.querySelector(".char-voice").textContent = `Voice: ${c.voice}${voice ? ` · ${voice.sound}` : ""}`;
      const talk = card.querySelector('[data-act="talk"]');
      talk.textContent = c.id === s.characters.active ? "Talking" : "Talk to";
      talk.disabled = c.id === s.characters.active;
      card.querySelector('[data-act="edit"]').textContent = c.id === editing ? "Close" : "Edit";
      return card;
    })
  );
}

grid.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-act]");
  if (!button) return;
  const id = button.closest(".char-card").dataset.id;
  if (button.dataset.act === "talk") return activate(id);
  editing = editing === id ? null : id;
  renderAll(getSettings());
});

// ----- The editor -----
const find = (id) => getSettings()?.characters.list.find((c) => c.id === id);

function change(id, fn) {
  updateSettings((s) => {
    const c = s.characters.list.find((x) => x.id === id);
    if (c) fn(c);
  });
}

function field(label, control, desc = "") {
  const wrap = document.createElement("label");
  wrap.className = "form-field";
  wrap.innerHTML = '<span class="row-label"></span>';
  wrap.firstChild.textContent = label;
  if (desc) {
    const d = document.createElement("span");
    d.className = "row-desc";
    d.textContent = desc;
    wrap.append(d);
  }
  wrap.append(control);
  return wrap;
}

function voiceOptions(select, gender, chosen) {
  select.replaceChildren();
  const groups = gender === "male" ? ["male", "female"] : ["female", "male"];
  for (const g of groups) {
    const group = document.createElement("optgroup");
    group.label = g === "male" ? "Male voices" : "Female voices";
    for (const v of meta.voices.filter((x) => x.gender === g)) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = `${v.name} · ${v.sound}`;
      group.append(o);
    }
    select.append(group);
  }
  select.value = chosen;
}

function renderEditor() {
  const c = editing && find(editing);
  if (!c || !meta) {
    editor.replaceChildren();
    editor.hidden = true;
    renderedEditor = null;
    return;
  }
  if (renderedEditor === c.id) return; // already showing it; don't disturb typing
  renderedEditor = c.id;
  editor.hidden = false;
  editor.replaceChildren();

  const head = document.createElement("div");
  head.className = "char-editor-head";
  head.textContent = `Editing ${c.name}`;
  editor.append(head);

  const name = Object.assign(document.createElement("input"), { className: "field", value: c.name, maxLength: 40, autocomplete: "off" });
  name.addEventListener("input", () => change(c.id, (x) => (x.name = name.value)));
  editor.append(field("Name", name));

  const row = document.createElement("div");
  row.className = "char-voice-row";
  const gender = document.createElement("select");
  gender.className = "field";
  gender.innerHTML = '<option value="female">Female</option><option value="male">Male</option>';
  gender.value = c.gender;
  const voice = document.createElement("select");
  voice.className = "field";
  voiceOptions(voice, c.gender, c.voice);
  const play = document.createElement("button");
  play.type = "button";
  play.className = "btn small";
  play.textContent = "▶ Listen";
  gender.addEventListener("change", () => {
    change(c.id, (x) => (x.gender = gender.value));
    // A voice of the new gender, unless the chosen one already is
    const current = meta.voices.find((v) => v.name === voice.value);
    const pick = current?.gender === gender.value ? current.name : meta.voices.find((v) => v.gender === gender.value).name;
    voiceOptions(voice, gender.value, pick);
    change(c.id, (x) => (x.voice = pick));
  });
  voice.addEventListener("change", () => change(c.id, (x) => (x.voice = voice.value)));
  play.addEventListener("click", () => playSample(play, voice.value));
  row.append(field("Gender", gender, "Picks the local voice too"), field("Voice", voice, "Gemini voices, in Live and Studio"), play);
  editor.append(row);

  for (const [key, { label, max }] of Object.entries(meta.fields)) {
    const area = document.createElement("textarea");
    area.className = "field textarea";
    area.rows = key === "tagline" ? 1 : 3;
    area.maxLength = max;
    area.value = c[key] || "";
    area.placeholder = meta.builtin.atlas[key] || "";
    area.addEventListener("input", () => change(c.id, (x) => (x[key] = area.value)));
    editor.append(field(label, area, key === "identity" ? "{user} becomes your name" : key === "onCamera" ? "How they act as your co-host" : ""));
  }

  const actions = document.createElement("div");
  actions.className = "form-test-bar";
  if (c.builtin) {
    const reset = Object.assign(document.createElement("button"), { type: "button", className: "btn small", textContent: `Reset ${meta.builtin[c.builtin].name} to the original` });
    reset.addEventListener("click", () => {
      if (!armed(reset, "Sure? Your changes are lost")) return;
      const original = meta.builtin[c.builtin];
      change(c.id, (x) => Object.assign(x, structuredClone(original)));
      renderedEditor = null;
      renderAll(getSettings());
    });
    actions.append(reset);
  } else {
    const remove = Object.assign(document.createElement("button"), { type: "button", className: "btn small btn-danger", textContent: "Delete this character" });
    remove.addEventListener("click", () => {
      if (!armed(remove, "Sure?")) return;
      updateSettings((s) => {
        s.characters.list = s.characters.list.filter((x) => x.id !== c.id);
        if (s.characters.active === c.id) s.characters.active = s.characters.list[0]?.id || "atlas";
      });
      editing = null;
      renderAll(getSettings());
    });
    actions.append(remove);
  }
  editor.append(actions);
}

// A risky button needs a second click within a few seconds
function armed(button, label) {
  if (button.dataset.armed) return true;
  const original = button.textContent;
  button.dataset.armed = "1";
  button.textContent = label;
  setTimeout(() => {
    delete button.dataset.armed;
    button.textContent = original;
  }, 4000);
  return false;
}

document.getElementById("char-add").addEventListener("click", () => {
  const s = getSettings();
  if (!s || !meta) return;
  if (s.characters.list.length >= meta.max) {
    status.textContent = `Up to ${meta.max} characters.`;
    status.className = "test-feedback error";
    return;
  }
  const source = template.value === "copy" ? find(editing || s.characters.active) : meta.templates[template.value];
  const id = `c-${Date.now().toString(36)}`;
  const fresh = { ...structuredClone(source || meta.templates.blank), id, builtin: undefined };
  if (template.value === "copy") fresh.name = `${source.name} 2`;
  delete fresh.builtin;
  updateSettings((s) => s.characters.list.push(fresh));
  editing = id;
  status.textContent = "";
  renderAll(getSettings());
});

// ----- Hearing a voice -----
let sample = null; // { button, audio }

function stopSample() {
  if (!sample) return;
  sample.audio?.pause();
  sample.button.classList.remove("playing");
  sample = null;
}

async function playSample(button, voiceName) {
  const same = sample?.button === button;
  stopSample();
  if (same) return;
  const mine = (sample = { button, audio: null });
  button.classList.add("playing");
  voiceError.hidden = true;
  const s = getSettings();
  const c = find(editing) || activeCharacter();
  try {
    const blob = await api.voice.speak(`Hi! I'm ${c?.name || "your friend"}. This is how I sound when we talk.`, voiceName);
    if (sample !== mine) return;
    const audio = new Audio(URL.createObjectURL(blob));
    audio.playbackRate = s ? playbackRate(s) : 1;
    mine.audio = audio;
    audio.addEventListener("ended", () => sample === mine && stopSample());
    await audio.play();
  } catch (err) {
    if (sample !== mine) return;
    stopSample();
    voiceError.textContent = voiceErrorText(err.message);
    voiceError.hidden = false;
  }
}

// ----- Keeping it all in step -----
function renderAll(s) {
  if (!s?.characters) return;
  if (editing && !s.characters.list.some((c) => c.id === editing)) editing = null;
  for (const el of switches) renderSwitch(el, s);
  renderGrid(s);
  renderEditor();
  document.documentElement.dataset.character = s.characters.active;
}

onSettings(renderAll);

api.characters
  .meta()
  .then((m) => {
    meta = m;
    renderAll(getSettings());
  })
  .catch((err) => console.error("Couldn't load the characters:", err.message));
