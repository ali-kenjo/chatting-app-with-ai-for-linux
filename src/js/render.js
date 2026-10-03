// ---------- AI replies as rich text ----------
// Markdown → sanitized HTML, plus: code blocks with a header, Copy and syntax
// colors (highlight.js), math ($…$, $$…$$, \(…\), \[…\]) with KaTeX, and
// ```mermaid blocks drawn as diagrams once the reply is complete.
import { marked } from "/vendor/marked/marked.esm.js";
import DOMPurify from "/vendor/dompurify/purify.es.mjs";
import katex from "/vendor/katex/katex.mjs";

const tex = (source, displayMode) =>
  katex.renderToString(source.trim(), { displayMode, throwOnError: false, output: "htmlAndMathml" });

// "$5 and $10" stays money: inline $…$ needs no space inside the dollars and no digit right after
const INLINE_MATH = [/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/, /^\\\(([\s\S]+?)\\\)/];
const BLOCK_MATH = [/^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/, /^\\\[([\s\S]+?)\\\][^\S\n]*(?:\n|$)/];

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start: (src) => src.match(/\$\$|\\\[/)?.index,
      tokenizer(src) {
        for (const re of BLOCK_MATH) {
          const m = re.exec(src);
          if (m) return { type: "mathBlock", raw: m[0], text: m[1] };
        }
      },
      renderer: (token) => `<div class="math-block">${tex(token.text, true)}</div>`,
    },
    {
      name: "mathInline",
      level: "inline",
      start: (src) => src.match(/\$|\\\(/)?.index,
      tokenizer(src) {
        for (const re of INLINE_MATH) {
          const m = re.exec(src);
          if (m) return { type: "mathInline", raw: m[0], text: m[1] };
        }
      },
      renderer: (token) => tex(token.text, false),
    },
  ],
});

// Links in replies open in a new tab, so the chat stays open
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Syntax colors load on first use; blocks drawn before that are colored when it arrives
let hljs = null;
import("/vendor/highlight/highlight.min.js").then((m) => {
  hljs = m.default;
  hljs.configure({ ignoreUnescapedHTML: true });
  document.querySelectorAll(".code-block pre code:not(.hljs)").forEach(colorize);
  return hljs;
});

function colorize(code) {
  if (!hljs) return;
  const lang = code.closest(".code-block")?.dataset.lang;
  if (lang && !hljs.getLanguage(lang)) return; // unknown language: leave it plain
  hljs.highlightElement(code);
}

const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

// <pre><code class="language-js"> → a block with a header (language, Copy)
function decorateCode(el) {
  for (const pre of el.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1]?.toLowerCase() || "";
    const block = document.createElement("div");
    block.className = "code-block";
    block.dataset.lang = lang;
    block.innerHTML = `<div class="code-head"><span class="code-lang"></span><button type="button" class="code-copy" data-action="copy-code">${COPY_ICON}<span>Copy</span></button></div>`;
    block.querySelector(".code-lang").textContent = lang || "code";
    pre.replaceWith(block);
    block.append(pre);
    colorize(code);
  }
}

// Images are dropped: remote images could be used to track you.
export function renderMarkdown(el, text) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text), { FORBID_TAGS: ["img"] });
  decorateCode(el);
}

// ----- Diagrams -----
let mermaid = null;
let diagramCount = 0;

async function loadMermaid() {
  if (!mermaid) mermaid = (await import("/vendor/mermaid/mermaid.esm.min.mjs")).default;
  // Drawn in the app's own colors (Mermaid wants real color values, not CSS variables)
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: getComputedStyle(document.body).fontFamily,
    themeVariables: {
      darkMode: document.documentElement.dataset.theme !== "light",
      background: color("--bg-main"),
      primaryColor: color("--bg-input"),
      primaryTextColor: color("--text"),
      primaryBorderColor: color("--accent"),
      secondaryColor: color("--bg-hover"),
      tertiaryColor: color("--bg-subtle"),
      lineColor: color("--text-muted"),
      textColor: color("--text"),
      edgeLabelBackground: color("--bg-main"),
      fontSize: "14px",
    },
  });
  return mermaid;
}

async function drawDiagram(block) {
  const source = block.querySelector("code").textContent;
  let view = block.querySelector(".diagram");
  try {
    const m = await loadMermaid();
    const { svg } = await m.render(`diagram-${++diagramCount}`, source);
    if (!view) {
      view = document.createElement("div");
      view.className = "diagram";
      block.querySelector(".code-head").after(view);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "code-copy";
      toggle.dataset.action = "toggle-diagram";
      toggle.textContent = "Code";
      block.querySelector(".code-head").insertBefore(toggle, block.querySelector("[data-action=copy-code]"));
    }
    view.innerHTML = svg; // made by Mermaid in strict mode, which sanitizes labels itself
    block.classList.add("has-diagram");
    block.querySelector(".code-lang").textContent = "diagram";
  } catch {
    view?.remove(); // not valid Mermaid: the code stays visible
    document.getElementById(`ddiagram-${diagramCount}`)?.remove(); // Mermaid's leftover error box
  }
}

// Called when a reply is complete (drawing half-written diagrams would only fail)
export function finishRender(el) {
  el.querySelectorAll('.code-block[data-lang="mermaid"]').forEach(drawDiagram);
}

// Diagrams follow the light/dark theme
new MutationObserver(() => {
  if (mermaid) document.querySelectorAll(".code-block.has-diagram").forEach(drawDiagram);
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

