// ---------- Settings → Data & backups ----------
// Backups of the data folder (server/backup.js): made once a day by themselves,
// on request, and before every restore. Export downloads one, Import puts one back.
import { api } from "./api.js";
import { t, tp, nf, formatDateTime } from "./i18n.js";
import { confirmDialog } from "./dialogs.js";
import { skeleton } from "./ui.js";

const list = document.getElementById("backup-list");
const status = document.getElementById("backup-status");
const dirLabel = document.getElementById("backup-dir");
const withFiles = document.getElementById("backup-with-files");
const fileInput = document.getElementById("backup-file");
const importMode = document.getElementById("backup-import-mode");

list.append(skeleton("li"));

const KINDS = { auto: t("Automatic"), manual: t("Made by you"), "before-restore": t("Before a restore"), import: t("Imported") };

function say(text, kind = "") {
  status.textContent = text;
  status.className = `test-feedback ${kind}`;
}

const size = (n) => (n > 1024 * 1024 ? `${nf(n / 1024 / 1024, { maximumFractionDigits: 1 })} MB` : `${nf(Math.max(1, Math.round(n / 1024)))} KB`);

function row(b) {
  const li = document.createElement("li");
  li.className = "backup-item";
  const when = formatDateTime(new Date(b.createdAt));
  li.innerHTML = `<div class="backup-text"><span class="backup-when"></span><span class="backup-meta"></span></div>
    <a class="btn small" download>${t("Download")}</a>
    <button type="button" class="btn small" data-act="restore">${t("Restore")}</button>
    <button type="button" class="btn small btn-danger" data-act="delete">${t("Delete")}</button>`;
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
    if (!backups.length) list.innerHTML = `<li class="memory-empty">${t("No backups yet. Press “Back up now”, or wait: the first automatic one comes within a day.")}</li>`;
  } catch (err) {
    list.replaceChildren();
    say(err.message, "error");
  }
}

// After a restore everything on the page may be out of date
function reloadSoon(text) {
  say(`${text} ${t("Reloading…")}`, "ok");
  setTimeout(() => location.reload(), 1200);
}

list.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-act]");
  if (!button) return;
  const name = button.closest(".backup-item").dataset.name;
  if (button.dataset.act === "delete") {
    const ok = await confirmDialog({ title: t("Delete this backup?"), message: t("The backup file will be removed from this computer. This can't be undone."), confirm: t("Delete backup"), danger: true });
    if (!ok) return;
    await api.backups.remove(name).catch((err) => say(err.message, "error"));
    return refresh();
  }
  const ok = await confirmDialog({
    title: t("Replace everything with this backup?"),
    message: t("Your chats, memory and settings will be replaced by the ones in this backup. The state you have now is backed up first."),
    confirm: t("Replace everything"),
    danger: true,
  });
  if (!ok) return;
  say(t("Restoring…"));
  try {
    const result = await api.backups.restore(name, "replace");
    reloadSoon(tp("Restored {n} file. The state before is backed up too.", "Restored {n} files. The state before is backed up too.", result.files));
  } catch (err) {
    say(err.message, "error");
  }
});

document.getElementById("backup-now").addEventListener("click", async () => {
  say(t("Backing up…"));
  try {
    const made = await api.backups.create();
    say(t("Saved ({size}).", { size: size(made.size) }), "ok");
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
  if (importMode.value === "replace") {
    const ok = await confirmDialog({
      title: t("Replace what is here with this file?"),
      message: t("Your current chats, memory and settings will be replaced by the ones in the file. The state you have now is backed up first."),
      confirm: t("Replace everything"),
      danger: true,
    });
    if (!ok) return;
  }
  say(t("Importing {name}…", { name: file.name }));
  try {
    const result = await api.backups.import(file, importMode.value);
    reloadSoon(tp("Imported {n} file.", "Imported {n} files.", result.files));
  } catch (err) {
    say(err.message, "error");
  }
});

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "data") refresh();
});
