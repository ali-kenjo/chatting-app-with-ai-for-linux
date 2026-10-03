// ---------- Find in this chat ----------
// Ctrl+F while a chat is open (or a result from the search panel): marks every
// match in the conversation, with Enter / Shift+Enter to step through them.
const main = document.getElementById("main");
const messagesEl = document.getElementById("messages");
const bar = document.getElementById("find-bar");
const field = document.getElementById("find-input");
const count = document.getElementById("find-count");

let hits = [];
let current = -1;
let timer = null;

function clearMarks() {
  for (const mark of messagesEl.querySelectorAll("mark.find-hit")) {
    const parent = mark.parentNode;
    mark.replaceWith(mark.textContent);
    parent.normalize();
  }
  hits = [];
  current = -1;
}

// Wrap each match in <mark>, walking only the text of the messages
function markAll(query) {
  clearMarks();
  const q = query.trim().toLowerCase();
  if (q) {
    const walker = document.createTreeWalker(messagesEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement.closest(".bubble, .msg-body, .draft-card") && !node.parentElement.closest(".katex, .code-head, svg")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let node of nodes) {
      let at = node.data.toLowerCase().indexOf(q);
      while (at !== -1) {
        const match = node.splitText(at);
        node = match.splitText(q.length);
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        match.replaceWith(mark);
        mark.append(match);
        hits.push(mark);
        at = node.data.toLowerCase().indexOf(q);
      }
    }
  }
  go(hits.length ? hits.length - 1 : -1); // start at the newest match
}

function go(index) {
  hits[current]?.classList.remove("current");
  current = hits.length ? (index + hits.length) % hits.length : -1;
  const hit = hits[current];
  if (hit) {
    hit.classList.add("current");
    hit.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  count.textContent = field.value.trim() ? (hits.length ? `${current + 1} of ${hits.length}` : "No matches") : "";
}

export function openFind(query = null) {
  if (!main.classList.contains("has-chat")) return;
  bar.hidden = false;
  if (query !== null) field.value = query;
  field.focus();
  field.select();
  markAll(field.value);
}

export function closeFind() {
  if (bar.hidden) return;
  bar.hidden = true;
  clearMarks();
  field.value = "";
  count.textContent = "";
}

field.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => markAll(field.value), 120);
});

field.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    go(current + (e.shiftKey ? 1 : -1));
  }
  if (e.key === "Escape") {
    e.stopPropagation();
    closeFind();
  }
});

bar.addEventListener("click", (e) => {
  const action = e.target.closest("[data-find]")?.dataset.find;
  if (action === "prev") go(current - 1);
  if (action === "next") go(current + 1);
  if (action === "close") closeFind();
});

document.getElementById("find-open").addEventListener("click", () => openFind());

// Ctrl+F (or Cmd+F) finds in the open chat; without a chat the browser's own find works
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && main.classList.contains("has-chat") && !document.querySelector(".modal-backdrop:not([hidden]), .search-backdrop:not([hidden])")) {
    e.preventDefault();
    openFind();
  }
});
