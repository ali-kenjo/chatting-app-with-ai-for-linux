// ---------- Memory ----------
// "Your memories" live in the settings; the AI's own notes come from the helper.
import { api } from "./api.js";
import { onSettings, updateSettings } from "./store.js";
import { t } from "./i18n.js";
import { confirmDialog } from "./dialogs.js";

// ----- Your memories -----
const memoryList = document.getElementById("memory-list");
const memoryAdd = document.getElementById("memory-add");
const memoryClear = document.getElementById("memory-clear");
const REMOVE_ICON = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

onSettings((s) => {
  memoryList.innerHTML = "";
  if (!s.memory.items.length) {
    memoryList.innerHTML = '<li class="memory-empty">Nothing yet. Add things you want the AI to always know.</li>';
  }
  for (const item of s.memory.items) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><button class="icon-btn small" title="Remove" data-id="">${REMOVE_ICON}</button>`;
    li.querySelector("span").textContent = item.text;
    li.querySelector("button").dataset.id = item.id;
    memoryList.append(li);
  }
  document.getElementById("ai-notes").classList.toggle("off", !s.aiNotes.enabled);
});

memoryAdd.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = memoryAdd.elements.text.value.trim();
  if (!text) return;
  updateSettings((s) => s.memory.items.push({ id: `${Date.now()}`, text }));
  memoryAdd.reset();
});

memoryList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-id]");
  if (btn) updateSettings((s) => (s.memory.items = s.memory.items.filter((m) => m.id !== btn.dataset.id)));
});

// Clearing asks first
function askToClear(button, action, { title, message, confirm }) {
  button.addEventListener("click", async () => {
    if (await confirmDialog({ title, message, confirm, danger: true })) action();
  });
}

askToClear(memoryClear, () => updateSettings((s) => (s.memory.items = [])), {
  title: t("Clear everything you asked it to remember?"),
  message: t("These memories will be deleted. This can't be undone."),
  confirm: t("Clear memories"),
});

// ----- AI memory (its own notes) -----
const NOTE_TYPES = {
  user: { label: "About you", color: "#6f9cf5" },
  feedback: { label: "Feedback", color: "#f5b451" },
  project: { label: "Projects", color: "#34d399" },
  reference: { label: "References", color: "#a78bfa" },
};

const DAY = 24 * 60 * 60 * 1000;
const CHEVRON = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';

let aiNotes = [];
let noteFilter = "all";
let openNoteId = null;
let editingNoteId = null;

const noteFilters = document.getElementById("note-filters");
const noteList = document.getElementById("note-list");
const notesClear = document.getElementById("notes-clear");

function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60 * 60 * 1000) return "Just now";
  if (diff < DAY) return `${Math.floor(diff / 3600000)} h ago`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function renderNotes() {
  // Filter chips with counts
  noteFilters.innerHTML = "";
  [["all", "All"], ...Object.entries(NOTE_TYPES).map(([k, t]) => [k, t.label])].forEach(([key, label]) => {
    const count = key === "all" ? aiNotes.length : aiNotes.filter((n) => n.type === key).length;
    const chip = document.createElement("button");
    chip.className = "chip" + (key === noteFilter ? " selected" : "");
    chip.dataset.filter = key;
    chip.innerHTML = `${label}<span class="count">${count}</span>`;
    noteFilters.append(chip);
  });

  noteList.innerHTML = "";
  const shown = aiNotes.filter((n) => noteFilter === "all" || n.type === noteFilter);
  if (!shown.length) {
    noteList.innerHTML = `<li class="note-empty">${aiNotes.length ? "No notes of this type." : "The AI hasn't saved any notes yet."}</li>`;
  }

  shown.forEach((note) => {
    const type = NOTE_TYPES[note.type] || NOTE_TYPES.user;
    const li = document.createElement("li");
    li.className = "note" + (note.id === openNoteId ? " open" : "");
    li.dataset.id = note.id;
    li.innerHTML = `
      <button class="note-head" data-action="toggle">
        <span class="note-type" style="--c: ${type.color}">${type.label}</span>
        <span class="note-text"><span class="note-title"></span><span class="note-desc"></span></span>
        <span class="note-date">${timeAgo(note.updatedAt)}</span>
        ${CHEVRON}
      </button>
      <div class="note-body"></div>`;
    li.querySelector(".note-title").textContent = note.title;
    li.querySelector(".note-desc").textContent = note.description;

    const body = li.querySelector(".note-body");
    if (note.id === editingNoteId) {
      body.innerHTML = `
        <textarea class="field textarea" maxlength="5000"></textarea>
        <div class="note-actions">
          <button class="btn" data-action="cancel-edit">Cancel</button>
          <button class="btn btn-primary" data-action="save">Save</button>
        </div>`;
      body.querySelector("textarea").value = note.content;
    } else {
      body.innerHTML = `
        <p class="note-content"></p>
        <div class="note-actions">
          <button class="btn" data-action="edit">Edit</button>
          <button class="btn btn-danger" data-action="delete">Delete</button>
        </div>`;
      body.querySelector(".note-content").textContent = note.content;
    }
    noteList.append(li);
  });
}

async function loadNotes() {
  try {
    const { dir, notes } = await api.notes.list();
    aiNotes = notes;
    document.getElementById("notes-dir").textContent = dir.replace(/^\/home\/[^/]+/, "~");
  } catch {}
  if (!editingNoteId) renderNotes();
}

noteFilters.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  noteFilter = chip.dataset.filter;
  renderNotes();
});

noteList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const li = btn.closest(".note");
  const id = li.dataset.id;

  switch (btn.dataset.action) {
    case "toggle":
      openNoteId = openNoteId === id ? null : id;
      editingNoteId = null;
      break;
    case "edit":
      editingNoteId = id;
      break;
    case "cancel-edit":
      editingNoteId = null;
      break;
    case "save":
      try {
        await api.notes.save(id, { content: li.querySelector("textarea").value });
      } catch {}
      editingNoteId = null;
      return loadNotes();
    case "delete":
      try {
        await api.notes.remove(id);
      } catch {}
      return loadNotes();
  }
  renderNotes();
  if (btn.dataset.action === "edit") noteList.querySelector("textarea").focus();
});

askToClear(
  notesClear,
  async () => {
    try {
      await api.notes.clear();
    } catch {}
    openNoteId = editingNoteId = null;
    loadNotes();
  },
  { title: t("Clear the AI's notes?"), message: t("Everything the AI wrote down about you and your work will be deleted. This can't be undone."), confirm: t("Clear notes") }
);

// Refresh when the tab opens, and after chats (the AI may have saved something)
document.querySelector('.tab[data-tab="memory"]').addEventListener("click", loadNotes);
document.addEventListener("friends:chats-changed", loadNotes);

loadNotes();
