// The AI's own memory: notes it writes for itself, one JSON file each in
// <data folder>/memory/. You can read, edit and delete them in Settings → Memory.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");

const dir = path.join(dataDir, "memory");
const TYPES = ["user", "feedback", "project", "reference"];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fileFor(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Note not found.");
  return path.join(dir, `${id}.json`);
}

function list() {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {}
  const notes = [];
  for (const name of names) {
    try {
      notes.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    } catch {}
  }
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Create a note, or update it when `id` is given
function save({ id, type, title, description, content }) {
  const existing = id ? list().find((n) => n.id === id) : null;
  if (id && !existing) throw new Error(`No note with id ${id}.`);
  const note = {
    id: existing?.id || crypto.randomUUID(),
    type: TYPES.includes(type) ? type : existing?.type || "user",
    title: String(title ?? existing?.title ?? "").trim().slice(0, 100) || "Untitled",
    description: String(description ?? existing?.description ?? "").trim().slice(0, 200),
    content: String(content ?? existing?.content ?? "").trim().slice(0, 5000),
    updatedAt: Date.now(),
  };
  writeJson(fileFor(note.id), note);
  return note;
}

function remove(id) {
  try {
    fs.unlinkSync(fileFor(id));
  } catch {}
  return { ok: true };
}

function clear() {
  for (const note of list()) remove(note.id);
  return { ok: true };
}

module.exports = { TYPES, dir, list, save, remove, clear };
