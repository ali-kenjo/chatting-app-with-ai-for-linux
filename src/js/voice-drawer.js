// ---------- Voice mode's side panel ----------
// "Drafts": what the AI wrote in this conversation (scripts, posts, ideas…).
// "Transcript": what you both said, as it's said.
import { draftCard } from "./drafts.js";
import { t } from "./i18n.js";
import { characterName } from "./characters.js";

const drawer = document.getElementById("voice-drawer");
const draftsPane = document.getElementById("voice-drafts");
const transcriptPane = document.getElementById("voice-transcript");
const draftsButton = document.getElementById("voice-drafts-btn");
const badge = document.getElementById("voice-drafts-badge");

const EMPTY = {
  drafts: t("Scripts, posts and ideas the AI writes land here, ready to copy. Try: “Write me three hooks for a video about…”"),
  transcript: t("What you both say shows up here."),
};

let tab = "drafts";
let unseen = 0;
let lines = { user: null, model: null }; // the transcript lines of this turn, still growing

const companion = characterName;

function placeholder(pane, text) {
  const p = document.createElement("p");
  p.className = "voice-drawer-empty";
  p.textContent = text;
  pane.replaceChildren(p);
}

function updateBadge() {
  badge.hidden = !unseen;
  badge.textContent = unseen;
}

function showTab(next) {
  tab = next;
  drawer.querySelectorAll(".voice-drawer-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  draftsPane.hidden = tab !== "drafts";
  transcriptPane.hidden = tab !== "transcript";
  if (tab === "drafts") {
    unseen = 0;
    updateBadge();
  } else {
    transcriptPane.scrollTop = transcriptPane.scrollHeight;
  }
}

export function toggleDrawer(show = drawer.hidden) {
  drawer.hidden = !show;
  draftsButton.classList.toggle("active", show);
  draftsButton.setAttribute("aria-expanded", String(show));
  if (show) showTab(tab);
}

// Fills the panel from a saved chat (or empties it for a new one)
export function resetDrawer(messages = []) {
  lines = { user: null, model: null };
  unseen = 0;
  updateBadge();
  const drafts = messages.flatMap((m) => m.drafts || []);
  if (drafts.length) draftsPane.replaceChildren(...drafts.reverse().map(draftCard));
  else placeholder(draftsPane, EMPTY.drafts);
  transcriptPane.replaceChildren();
  for (const m of messages) {
    if (!m.text) continue;
    addTranscript(m.role === "user" ? "user" : "model", m.text);
    endTurn();
  }
  if (!transcriptPane.children.length) placeholder(transcriptPane, EMPTY.transcript);
}

export function addDraft(draft) {
  draftsPane.querySelector(".voice-drawer-empty")?.remove();
  draftsPane.prepend(draftCard(draft));
  if (drawer.hidden || tab !== "drafts") {
    unseen++;
    updateBadge();
  }
}

// A piece of what someone said; the pieces of one turn join into one line
export function addTranscript(role, text) {
  transcriptPane.querySelector(".voice-drawer-empty")?.remove();
  let line = lines[role];
  if (!line) {
    line = document.createElement("div");
    line.className = `voice-line ${role}`;
    line.innerHTML = '<span class="voice-line-who"></span><p class="voice-line-text"></p>';
    line.querySelector(".voice-line-who").textContent = role === "user" ? "You" : companion();
    // Your words can arrive a little after its answer started; they still go first
    if (role === "user" && lines.model) transcriptPane.insertBefore(line, lines.model);
    else transcriptPane.append(line);
    lines[role] = line;
  }
  const stick = transcriptPane.scrollHeight - transcriptPane.scrollTop - transcriptPane.clientHeight < 60;
  const p = line.querySelector(".voice-line-text");
  p.textContent = (p.textContent + text).replace(/\s+/g, " ").trimStart();
  if (stick) transcriptPane.scrollTop = transcriptPane.scrollHeight;
}

// What was heard turned out not to be you (the AI's own echo): its line goes
export function discardLine(role) {
  lines[role]?.remove();
  lines[role] = null;
  if (!transcriptPane.children.length) placeholder(transcriptPane, EMPTY.transcript);
}

export function endTurn() {
  lines = { user: null, model: null };
}

drawer.querySelector(".voice-drawer-tabs").addEventListener("click", (e) => {
  const button = e.target.closest("[data-tab]");
  if (button) showTab(button.dataset.tab);
});
document.getElementById("voice-drawer-close").addEventListener("click", () => toggleDrawer(false));
draftsButton.addEventListener("click", () => toggleDrawer());
