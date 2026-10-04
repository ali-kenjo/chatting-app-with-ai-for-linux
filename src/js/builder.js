// ---------- Settings → Builder ----------
// How commands run (server/builder.js decides with these), the lists, and what's running now.
import { api } from "./api.js";
import { getSettings, onSettings, updateSettings } from "./store.js";
import { openSettings } from "./settings.js";

const modes = document.getElementById("builder-modes");
const allow = document.getElementById("builder-allow");
const block = document.getElementById("builder-block");
const warning = document.getElementById("builder-auto-warning");
const foldersNote = document.getElementById("builder-folders-note");
const runningList = document.getElementById("builder-running");

const lines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

onSettings((s) => {
  const mode = s.builder?.commands || "ask";
  modes.querySelectorAll(".choice").forEach((c) => {
    c.classList.toggle("selected", c.dataset.mode === mode);
    c.setAttribute("aria-checked", String(c.dataset.mode === mode));
    c.setAttribute("role", "radio");
  });
  warning.hidden = mode !== "auto";
  foldersNote.hidden = s.permissions.folders.length > 0;
  if (document.activeElement !== allow) allow.value = (s.builder?.allow || []).join("\n");
  if (document.activeElement !== block) block.value = (s.builder?.block || []).join("\n");
});

modes.addEventListener("click", (e) => {
  const c = e.target.closest(".choice");
  if (c) updateSettings((s) => (s.builder.commands = c.dataset.mode));
});
allow.addEventListener("change", () => updateSettings((s) => (s.builder.allow = lines(allow.value))));
block.addEventListener("change", () => updateSettings((s) => (s.builder.block = lines(block.value))));

document.querySelector('[data-open-tab="ai-control"]')?.addEventListener("click", (e) => {
  e.preventDefault();
  openSettings("ai-control");
});

async function refreshRunning() {
  let list = [];
  try {
    list = await api.builder.running();
  } catch {}
  runningList.replaceChildren(
    ...(list.length
      ? list.map((p) => {
          const li = document.createElement("li");
          li.className = "life-item";
          const text = document.createElement("span");
          text.className = "life-text";
          const title = document.createElement("span");
          title.className = "life-title mcp-where";
          title.textContent = p.command;
          const meta = document.createElement("span");
          meta.className = "life-meta";
          meta.textContent = `${p.cwd}${p.running ? "" : " · finished"}`;
          text.append(title, meta);
          if (p.url) {
            const a = Object.assign(document.createElement("a"), { href: p.url, target: "_blank", rel: "noopener noreferrer", textContent: p.url, className: "app-link" });
            text.append(a);
          }
          const stop = document.createElement("button");
          stop.type = "button";
          stop.className = "btn small";
          stop.textContent = "Stop";
          stop.addEventListener("click", async () => {
            await api.builder.stop(p.id).catch(() => {});
            refreshRunning();
          });
          li.append(text, stop);
          return li;
        })
      : [Object.assign(document.createElement("li"), { className: "memory-empty", textContent: "Nothing is running." })])
  );
}

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "builder") refreshRunning();
});
