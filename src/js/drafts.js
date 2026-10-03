// ---------- Drafts ----------
// Writing the AI makes in voice conversations (scripts, posts, captions,
// outlines, ideas): shown as cards you can read, copy and download, in the
// chat and in voice mode's side panel.
import { marked } from "/vendor/marked/marked.esm.js";
import DOMPurify from "/vendor/dompurify/purify.es.mjs";

const KINDS = { script: "Script", post: "Post", caption: "Caption", outline: "Outline", ideas: "Ideas", email: "Email", other: "Draft" };

const fileName = (title) => `${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "draft"}.md`;

function flash(button, text) {
  const before = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = before), 1500);
}

export function draftCard(draft) {
  const card = document.createElement("article");
  card.className = "draft-card";
  card.dataset.id = draft.id;
  card.innerHTML = `
    <header class="draft-head"><span class="draft-kind"></span><span class="draft-title"></span></header>
    <div class="draft-body markdown"></div>
    <div class="draft-actions">
      <button type="button" class="btn btn-sm" data-action="copy">Copy</button>
      <button type="button" class="btn btn-sm" data-action="download">Download</button>
    </div>`;
  card.querySelector(".draft-kind").textContent = KINDS[draft.kind] || KINDS.other;
  card.querySelector(".draft-title").textContent = draft.title;
  // Written by the AI: sanitized, and without images (they could track you)
  card.querySelector(".draft-body").innerHTML = DOMPurify.sanitize(marked.parse(draft.content), { FORBID_TAGS: ["img"] });
  card.querySelector(".draft-actions").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "copy") {
      try {
        await navigator.clipboard.writeText(draft.content);
        flash(button, "Copied");
      } catch {
        flash(button, "Couldn't copy");
      }
    } else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([draft.content], { type: "text/markdown" }));
      link.download = fileName(draft.title);
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    }
  });
  return card;
}
