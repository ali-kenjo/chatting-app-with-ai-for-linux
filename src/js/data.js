// ---------- Settings → Data & backups ----------
// Backups of the data folder (server/backup.js): made once a day by themselves,
// on request, and before every restore. Export downloads one, Import puts one back.
import { api } from "./api.js";

const list = document.getElementById("backup-list");
const status = document.getElementById("backup-status");
const dirLabel = document.getElementById("backup-dir");
const withFiles = document.getElementById("backup-with-files");
const fileInput = document.getElementById("backup-file");
const importMode = document.getElementById("backup-import-mode");

const KINDS = { auto: "Automatic", manual: "Made by you", "before-restore": "Before a restore", import: "Imported" };

function say(text, kind = "") {
  status.textContent = text;
  status.className = `test-feedback ${kind}`;
}

const size = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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

function row(b) {
  const li = document.createElement("li");
  li.className = "backup-item";
  const when = new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  li.innerHTML = `<div class="backup-text"><span class="backup-when"></span><span class="backup-meta"></span></div>
    <a class="btn small" download>Download</a>
    <button type="button" class="btn small" data-act="restore">Restore</button>
    <button type="button" class="btn small btn-danger" data-act="delete">Delete</button>`;
  li.querySelector(".backup-when").textContent = when;
  li.querySelector(".backup-meta").textContent = `${KINDS[b.kind] || b.kind} · ${size(b.size)}`;
  li.querySelector("a").href = `/api/backups/${encodeURIComponent(b.name)}/download`;
  li.querySelector("a").setAttribute("download", b.name);
  li.dataset.name = b.name;
  return li;
}

async function refresh() {
  try {
    const { dir, backups } = await api.backups.list();
    dirLabel.textContent = dir;
    list.replaceChildren(...backups.slice(0, 30).map(row));
    if (!backups.length) list.innerHTML = '<li class="memory-empty">No backups yet.</li>';
  } catch (err) {
    say(err.message, "error");
  }
}

// After a restore everything on the page may be out of date
function reloadSoon(text) {
  say(`${text} Reloading…`, "ok");
  setTimeout(() => location.reload(), 1200);
}

list.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-act]");
  if (!button) return;
  const name = button.closest(".backup-item").dataset.name;
  if (button.dataset.act === "delete") {
    if (!armed(button, "Sure?")) return;
    await api.backups.remove(name).catch((err) => say(err.message, "error"));
    return refresh();
  }
  if (!armed(button, "Replace all?")) return;
  say("Restoring…");
  try {
    const result = await api.backups.restore(name, "replace");
    reloadSoon(`Restored ${result.files} files. The state before is backed up too.`);
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("backup-now").addEventListener("click", async () => {
  say("Backing up…");
  try {
    const made = await api.backups.create();
    say(`Saved (${size(made.size)}).`, "ok");
    refresh();
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("backup-export").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = `/api/backups/export${withFiles.checked ? "?files=1" : ""}`;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
});

document.getElementById("backup-import").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  say(`Importing ${file.name}…`);
  try {
    const result = await api.backups.import(file, importMode.value);
    reloadSoon(`Imported ${result.files} files.`);
  } catch (err) {
    say(err.message, "error");
  }
});

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "data") refresh();
});
