// Connected apps (Settings → Connected Apps): each one is a small module here
// that says what it needs (nothing, a token, an address), which tools it gives
// the AI, how to test it, and what it adds to the daily briefing. Google
// (Gmail, Calendar, Drive, YouTube, Tasks) is separate: it uses the Google
// sign-in (workspace.js). Any other app can be added through MCP (mcp.js).
//
// Settings that aren't secret are kept in <data folder>/connectors.json;
// tokens go to the system keyring (keys.js), never into backups.
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("../config");
const keys = require("../keys");

const CONNECTORS = [require("./weather"), require("./web"), require("./wikipedia"), require("./currency"), require("./github"), require("./notion"), require("./todoist"), require("./homeassistant")];
const byId = new Map(CONNECTORS.map((c) => [c.id, c]));
const file = path.join(dataDir, "connectors.json");

function loadAll() {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

const secretName = (id, key) => `connector-${id}-${key}`;

// A connector's settings: { enabled, ...fields }; secrets only when asked (never to the page)
function config(id, { secrets = false } = {}) {
  const def = byId.get(id);
  if (!def) throw new Error("There's no such app.");
  const stored = loadAll()[id] || {};
  const out = { enabled: typeof stored.enabled === "boolean" ? stored.enabled : def.defaultOn === true };
  for (const f of def.fields || []) {
    if (f.secret) out[f.key] = secrets ? keys.getSecret(secretName(id, f.key)) : Boolean(keys.getSecret(secretName(id, f.key)));
    else out[f.key] = typeof stored[f.key] === "string" ? stored[f.key] : f.default || "";
  }
  return out;
}

// Saves what the page sent. A secret field left empty keeps the saved one; null removes it.
function save(id, input = {}) {
  const def = byId.get(id);
  if (!def) throw new Error("There's no such app.");
  const all = loadAll();
  const stored = { ...(all[id] || {}) };
  if (typeof input.enabled === "boolean") stored.enabled = input.enabled;
  for (const f of def.fields || []) {
    if (!(f.key in input)) continue;
    const value = input[f.key];
    if (f.secret) {
      if (value === null) keys.deleteSecret(secretName(id, f.key));
      else if (typeof value === "string" && value.trim()) keys.setSecret(secretName(id, f.key), value.trim());
    } else {
      const clean = typeof value === "string" ? value.trim().slice(0, f.max || 300) : "";
      if (clean && f.pattern && !new RegExp(f.pattern).test(clean)) throw new Error(`${f.label}: ${f.patternHelp || "that doesn't look right."}`);
      stored[f.key] = clean;
    }
  }
  all[id] = stored;
  writeJson(file, all);
  return publicInfo(def);
}

// Set up enough to use (all required fields filled)
function ready(def, cfg = config(def.id)) {
  return (def.fields || []).every((f) => !f.required || Boolean(cfg[f.key]));
}

// Is it off because of Private mode? (Apps on your own network still work there.)
function blockedByPrivate(def, settings, cfg) {
  if (settings.privacy?.localOnly !== true || !def.online) return false;
  return !(def.localNetwork && def.localNetwork(cfg));
}

function publicInfo(def, settings) {
  const cfg = config(def.id);
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    description: def.description,
    help: def.help || "",
    link: def.link || "",
    fields: (def.fields || []).map(({ key, label, placeholder, secret, required, help, type, options }) => ({ key, label, placeholder, secret: Boolean(secret), required: Boolean(required), help, type, options })),
    config: cfg,
    ready: ready(def, cfg),
    privateOff: settings ? blockedByPrivate(def, settings, config(def.id, { secrets: true })) : false,
    tools: def.tools.map((t) => t.decl.name),
  };
}

const list = (settings) => CONNECTORS.map((def) => publicInfo(def, settings));

// The ones the AI may use now: switched on, set up, and allowed in this mode
function active(settings, { hidden = false } = {}) {
  const out = [];
  for (const def of CONNECTORS) {
    const cfg = config(def.id, { secrets: true });
    if (!cfg.enabled || !ready(def, cfg) || blockedByPrivate(def, settings, cfg)) continue;
    if (hidden && def.private) continue; // your own accounts stay off camera
    out.push({ def, cfg });
  }
  return out;
}

// Tool declarations of the active connectors. options.live: Gemini Live, which searches the web itself.
function declarations(settings, { hidden = false, live = false } = {}) {
  const decls = [];
  for (const { def, cfg } of active(settings, { hidden })) {
    for (const t of def.tools) {
      if (t.when && !t.when({ settings, cfg, live })) continue;
      decls.push(t.decl);
    }
  }
  return decls;
}

// The connector tool with this name, if any
function find(name) {
  for (const def of CONNECTORS) {
    const tool = def.tools.find((t) => t.decl.name === name);
    if (tool) return { def, tool };
  }
  return null;
}

// Runs a connector tool. ctx is tools.run's: settings, confirm(), onActivity()…
async function run(name, args, ctx) {
  const found = find(name);
  if (!found) return null;
  const { def, tool } = found;
  const cfg = config(def.id, { secrets: true });
  if (!cfg.enabled || !ready(def, cfg)) throw new Error(`${def.name} isn't set up. The user can connect it in Settings → Connected Apps.`);
  if (blockedByPrivate(def, ctx.settings, cfg)) throw new Error(`Private mode is on, so ${def.name} is off.`);
  if (tool.confirm) {
    const summary = tool.confirm(args, cfg);
    if (summary && !(await ctx.confirm(summary, { type: "app", app: def.name, args }))) {
      ctx.onActivity?.(`You declined: ${summary}`);
      return { error: "The user declined this action." };
    }
  }
  return tool.run(args, { cfg, ctx });
}

// Lines for the AI's instructions about the active apps
function promptLines(settings, offered) {
  const lines = [];
  for (const { def } of active(settings)) {
    if (def.prompt && def.tools.some((t) => offered.includes(t.decl.name))) lines.push(`- ${def.prompt}`);
  }
  return lines;
}

// Parts of the daily briefing (weather…)
async function briefing(ctx, out) {
  const jobs = active(ctx.settings).filter(({ def }) => def.briefing).map(({ def, cfg }) => Promise.resolve(def.briefing({ cfg, ctx, out })).catch(() => {}));
  await Promise.all(jobs);
}

// Settings → Connected Apps → Test
async function test(id) {
  const def = byId.get(id);
  if (!def) throw new Error("There's no such app.");
  const cfg = config(id, { secrets: true });
  if (!ready(def, cfg)) throw new Error("Fill in what it needs first.");
  return { ok: true, message: await def.test(cfg) };
}

function remove(id) {
  const def = byId.get(id);
  if (!def) throw new Error("There's no such app.");
  for (const f of def.fields || []) if (f.secret) keys.deleteSecret(secretName(id, f.key));
  const all = loadAll();
  delete all[id];
  writeJson(file, all);
  return publicInfo(def);
}

module.exports = { CONNECTORS, list, config, save, remove, active, declarations, find, run, promptLines, briefing, test, ready };
