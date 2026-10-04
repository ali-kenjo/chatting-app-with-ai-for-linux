// ---------- Settings → Connected Apps: apps and MCP servers ----------
// The built-in apps (server/connectors/) as cards you switch on, set up and
// test, and any other app through MCP (server/mcp.js).
import { api } from "./api.js";

const grid = document.getElementById("app-grid");
const mcpList = document.getElementById("mcp-list");
const form = document.getElementById("mcp-form");
const mcpStatus = document.getElementById("mcp-status");
const presetSelect = document.getElementById("mcp-preset");
const presetHelp = document.getElementById("mcp-preset-help");

// Well-known MCP servers, to start from (they need Node's npx or Python's uvx)
const PRESETS = {
  playwright: { name: "Browser", transport: "stdio", command: "npx", args: "-y @playwright/mcp@latest", trust: "ask", help: "Opens and uses web pages in a real browser: test the websites you build, fill forms, take screenshots. Needs Node.js." },
  context7: { name: "Code docs", transport: "stdio", command: "npx", args: "-y @upstash/context7-mcp", trust: "all", help: "Up-to-date documentation and examples for programming libraries, for building apps. Needs Node.js." },
  git: { name: "Git", transport: "stdio", command: "uvx", args: "mcp-server-git --repository ~/projects/my-app", trust: "read-only", local: true, help: "History, diffs, branches and commits of one Git repository (change the path). Needs uv: pipx install uv." },
  files: { name: "Files", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-filesystem ~/Documents", trust: "read-only", local: true, help: "Reads and writes files in the folders you list. (Friends' own file access in Settings → AI control does this too.)" },
  memory: { name: "Knowledge graph", transport: "stdio", command: "npx", args: "-y @modelcontextprotocol/server-memory", trust: "all", local: true, help: "A graph of people, things and how they relate, kept on this computer." },
  fetch: { name: "Fetch", transport: "stdio", command: "uvx", args: "mcp-server-fetch", trust: "read-only", help: "Fetches web pages as Markdown. Needs uv." },
  github: { name: "GitHub MCP", transport: "http", url: "https://api.githubcopilot.com/mcp/", trust: "read-only", help: "GitHub's own MCP server, with everything GitHub can do. Paste a personal access token below." },
};

for (const [id, p] of Object.entries(PRESETS)) presetSelect.append(Object.assign(document.createElement("option"), { value: id, textContent: p.name }));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ----- Built-in apps -----
function statusOf(app) {
  if (!app.config.enabled) return ["Off", "off"];
  if (app.privateOff) return ["Off in Private mode", "off"];
  if (!app.ready) return ["Needs setting up", "warn"];
  return ["On", "on"];
}

function card(app) {
  const c = el("div", "app-card");
  c.dataset.id = app.id;
  const head = el("div", "app-head");
  const toggle = Object.assign(document.createElement("input"), { type: "checkbox", className: "toggle", checked: app.config.enabled });
  toggle.setAttribute("aria-label", `${app.name} on`);
  toggle.addEventListener("change", () => save(app.id, { enabled: toggle.checked }));
  const [label, kind] = statusOf(app);
  const title = el("div", "app-title");
  title.append(el("strong", "", `${app.icon} ${app.name}`), el("span", `app-status ${kind}`, label));
  head.append(title, toggle);
  c.append(head, el("p", "row-desc", app.description));

  if (app.fields.length) {
    const box = el("details", "app-setup");
    box.append(el("summary", "", app.ready ? "Settings" : "Set up"));
    if (!app.ready && app.config.enabled) box.open = true;
    if (app.help) box.append(el("p", "row-desc", app.help));
    if (app.link) {
      const a = Object.assign(el("a", "app-link", "Open the page ↗"), { href: app.link, target: "_blank", rel: "noopener noreferrer" });
      box.append(a);
    }
    const inputs = {};
    for (const f of app.fields) {
      const wrap = el("label", "form-field");
      wrap.append(el("span", "row-label", f.label));
      let input;
      if (f.type === "select") {
        input = el("select", "field");
        for (const [value, text] of f.options) input.append(Object.assign(document.createElement("option"), { value, textContent: text }));
        input.value = app.config[f.key] || f.options[0][0];
      } else {
        input = Object.assign(document.createElement("input"), { className: "field", type: f.secret ? "password" : "text", autocomplete: "off", spellcheck: false });
        input.placeholder = f.secret && app.config[f.key] ? "Saved (type to replace)" : f.placeholder || "";
        if (!f.secret) input.value = app.config[f.key] || "";
      }
      if (f.help) wrap.append(el("span", "row-desc", f.help));
      wrap.append(input);
      inputs[f.key] = input;
      box.append(wrap);
    }
    const bar = el("div", "form-test-bar");
    const saveBtn = el("button", "btn small btn-primary", "Save");
    const testBtn = el("button", "btn small", "Test");
    const feedback = el("span", "test-feedback");
    saveBtn.type = testBtn.type = "button";
    saveBtn.addEventListener("click", async () => {
      const body = { enabled: true };
      for (const f of app.fields) {
        const v = inputs[f.key].value;
        if (!f.secret || v.trim()) body[f.key] = v;
      }
      await save(app.id, body, feedback);
    });
    testBtn.addEventListener("click", () => test(app.id, feedback));
    bar.append(saveBtn, testBtn);
    if (app.fields.some((f) => f.secret && app.config[f.key])) {
      const forget = el("button", "btn small btn-danger", "Disconnect");
      forget.type = "button";
      forget.addEventListener("click", async () => {
        await api.connectors.remove(app.id).catch(() => {});
        refresh();
      });
      bar.append(forget);
    }
    bar.append(feedback);
    box.append(bar);
    c.append(box);
  } else {
    const bar = el("div", "form-test-bar");
    const testBtn = el("button", "btn small", "Test");
    testBtn.type = "button";
    const feedback = el("span", "test-feedback");
    testBtn.addEventListener("click", () => test(app.id, feedback));
    bar.append(testBtn, feedback);
    c.append(bar);
  }
  return c;
}

async function save(id, body, feedback) {
  try {
    await api.connectors.save(id, body);
    if (feedback) {
      feedback.textContent = "Saved.";
      feedback.className = "test-feedback ok";
    }
    setTimeout(refresh, feedback ? 700 : 0);
  } catch (err) {
    if (feedback) {
      feedback.textContent = err.message;
      feedback.className = "test-feedback error";
    }
  }
}

async function test(id, feedback) {
  feedback.textContent = "Testing…";
  feedback.className = "test-feedback";
  try {
    const r = await api.connectors.test(id);
    feedback.textContent = r.message;
    feedback.className = "test-feedback ok";
  } catch (err) {
    feedback.textContent = err.message;
    feedback.className = "test-feedback error";
  }
}

// ----- MCP servers -----
const STATUS = { ready: ["Running", "on"], starting: ["Starting…", "warn"], error: ["Problem", "error"], stopped: ["Stopped", "off"], off: ["Off", "off"] };

function mcpItem(s) {
  const li = el("li", "app-card mcp-item");
  const head = el("div", "app-head");
  const [label, kind] = STATUS[s.status] || [s.status, "off"];
  const title = el("div", "app-title");
  title.append(el("strong", "", `🧩 ${s.name}`), el("span", `app-status ${kind}`, label));
  const toggle = Object.assign(document.createElement("input"), { type: "checkbox", className: "toggle", checked: s.enabled });
  toggle.setAttribute("aria-label", `${s.name} on`);
  toggle.addEventListener("change", async () => {
    await api.mcp.save({ id: s.id, enabled: toggle.checked }).catch(() => {});
    setTimeout(refresh, 1500);
  });
  head.append(title, toggle);
  li.append(head);
  li.append(el("p", "row-desc mcp-where", s.transport === "http" ? s.url : `${s.command} ${s.args}`.trim()));
  if (s.error) li.append(el("p", "form-error", s.error));
  if (s.tools.length) {
    const tools = el("details", "app-setup");
    tools.append(el("summary", "", `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}`));
    const ul = el("ul", "mcp-tools");
    for (const t of s.tools) {
      const item = el("li", "");
      item.append(el("code", "", t.name), document.createTextNode(` ${t.readOnly ? "(reads only) " : ""}${t.description.slice(0, 140)}`));
      ul.append(item);
    }
    tools.append(ul);
    li.append(tools);
  }
  const bar = el("div", "form-test-bar");
  const trust = el("select", "field");
  for (const [v, t] of [["ask", "Always ask"], ["read-only", "Ask, except reading"], ["all", "Never ask"]]) trust.append(Object.assign(document.createElement("option"), { value: v, textContent: t }));
  trust.value = s.trust;
  trust.setAttribute("aria-label", "Ask before each action");
  trust.addEventListener("change", () => api.mcp.save({ id: s.id, trust: trust.value }).then(refresh, () => {}));
  const restart = el("button", "btn small", "Restart");
  restart.type = "button";
  restart.addEventListener("click", async () => {
    restart.disabled = true;
    await api.mcp.restart(s.id).catch(() => {});
    refresh();
  });
  const remove = el("button", "btn small btn-danger", "Remove");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!remove.dataset.armed) {
      remove.dataset.armed = "1";
      remove.textContent = "Sure?";
      return setTimeout(() => {
        delete remove.dataset.armed;
        remove.textContent = "Remove";
      }, 4000);
    }
    await api.mcp.remove(s.id).catch(() => {});
    refresh();
  });
  bar.append(trust, restart, remove);
  li.append(bar);
  return li;
}

function syncTransport() {
  const http = form.transport.value === "http";
  form.querySelector(".mcp-http").hidden = !http;
  form.querySelector(".mcp-stdio").hidden = http;
}
form.transport.addEventListener("change", syncTransport);

presetSelect.addEventListener("change", () => {
  const p = PRESETS[presetSelect.value];
  presetHelp.textContent = p?.help || "";
  if (!p) return;
  form.name.value = p.name;
  form.transport.value = p.transport;
  form.command.value = p.command || "";
  form.args.value = p.args || "";
  form.url.value = p.url || "";
  form.trust.value = p.trust || "ask";
  form.local.checked = p.local === true;
  syncTransport();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  mcpStatus.textContent = "Adding…";
  mcpStatus.className = "test-feedback";
  try {
    await api.mcp.save({
      name: form.name.value,
      transport: form.transport.value,
      command: form.command.value,
      args: form.args.value,
      cwd: form.cwd.value,
      env: form.env.value,
      url: form.url.value,
      token: form.token.value,
      trust: form.trust.value,
      local: form.local.checked,
    });
    form.reset();
    presetHelp.textContent = "";
    syncTransport();
    mcpStatus.textContent = "Added. It starts in a moment (the first start can take a minute while it downloads).";
    mcpStatus.className = "test-feedback ok";
    refresh();
    setTimeout(refresh, 5000);
    setTimeout(refresh, 20000);
  } catch (err) {
    mcpStatus.textContent = err.message;
    mcpStatus.className = "test-feedback error";
  }
});

// ----- Drawing it all -----
async function refresh() {
  try {
    const { apps, mcp } = await api.connectors.list();
    grid.replaceChildren(...apps.map(card));
    mcpList.replaceChildren(...(mcp.length ? mcp.map(mcpItem) : [el("li", "memory-empty", "No MCP apps yet.")]));
  } catch (err) {
    grid.replaceChildren(el("p", "form-error", err.message));
  }
}

document.addEventListener("friends:settings", (e) => {
  if (e.detail.open && e.detail.tab === "integrations") refresh();
});
