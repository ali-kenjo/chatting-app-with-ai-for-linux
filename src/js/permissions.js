// ---------- Permissions ----------
// Allowed folders and the create/read/edit/delete grid. The helper enforces
// them; this module only edits the settings.
import { onSettings, updateSettings } from "./store.js";

const folderList = document.getElementById("folder-list");
const folderAdd = document.getElementById("folder-add");
const folderAddOpen = document.getElementById("folder-add-open");
const permGrid = document.getElementById("perm-grid");
const FOLDER_ICON = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const REMOVE_ICON = '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

// Grid rows in the page → settings keys
const ROW_KEY = { files: "files", folders: "dirs" };

function renderFolders(folders) {
  folderList.innerHTML = "";
  if (!folders.length) {
    folderList.innerHTML = '<li class="folder-empty">No folders yet. The AI can\'t touch any files.</li>';
  }
  folders.forEach((path, i) => {
    const li = document.createElement("li");
    li.innerHTML = `${FOLDER_ICON}<span class="folder-path"></span>
      <button class="icon-btn small" title="Remove folder" data-index="${i}">${REMOVE_ICON}</button>`;
    li.querySelector(".folder-path").textContent = path;
    li.querySelector(".folder-path").title = path;
    folderList.append(li);
  });
}

onSettings((s) => {
  renderFolders(s.permissions.folders);
  permGrid.querySelectorAll(".perm-check").forEach((box) => {
    box.checked = s.permissions[ROW_KEY[box.dataset.row]][box.dataset.perm];
  });
});

function showFolderAdd(show) {
  folderAdd.hidden = !show;
  folderAddOpen.hidden = show;
  folderAdd.reset();
  if (show) folderAdd.elements.path.focus();
}

folderList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-index]");
  if (btn) updateSettings((s) => s.permissions.folders.splice(Number(btn.dataset.index), 1));
});

folderAdd.addEventListener("submit", (e) => {
  e.preventDefault();
  const path = folderAdd.elements.path.value.trim();
  showFolderAdd(false);
  if (path) {
    updateSettings((s) => {
      if (!s.permissions.folders.includes(path)) s.permissions.folders.push(path);
    });
  }
});

folderAddOpen.addEventListener("click", () => showFolderAdd(true));
document.getElementById("folder-add-cancel").addEventListener("click", () => showFolderAdd(false));

// Creating, editing or deleting needs Read; turning Read off turns the rest off
permGrid.addEventListener("change", (e) => {
  const box = e.target;
  updateSettings((s) => {
    const row = s.permissions[ROW_KEY[box.dataset.row]];
    row[box.dataset.perm] = box.checked;
    if (box.dataset.perm === "read" && !box.checked) Object.keys(row).forEach((k) => (row[k] = false));
    if (box.dataset.perm !== "read" && box.checked) row.read = true;
  });
});
