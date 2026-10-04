// MCP (Model Context Protocol): connects Friends to any app that has an MCP
// server (Settings → Connected Apps → More apps). A server is either a program
// on this computer (started with a command, talking over stdin/stdout) or an
// address (Streamable HTTP, with an optional token). Its tools are offered to
// the AI as mcp_<server>_<tool>; every call asks you first unless you trust
// the server (all its tools, or the ones it marks read-only).
//
// Servers are kept in <data folder>/mcp.json; tokens in the keyring.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dataDir, writeJson, version } = require("./config");
const keys = require("./keys");
const logger = require("./logger");

const file = path.join(dataDir, "mcp.json");
const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 60000;
const MAX_SERVERS = 20;
const TRUST = ["ask", "read-only", "all"];

// ---------- Settings ----------
function load() {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";

// "--flag value 'two words'" → ["--flag", "value", "two words"]
function splitArgs(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(String(text || ""))); ) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

// "KEY=value" lines → { KEY: "value" }
function parseEnv(text) {
  const env = {};
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function clean(input, existing = {}) {
  const transport = input.transport === "http" ? "http" : "stdio";
  const s = {
    id: existing.id || crypto.randomUUID().slice(0, 8),
    name: String(input.name ?? existing.name ?? "").trim().slice(0, 40),
    enabled: typeof input.enabled === "boolean" ? input.enabled : existing.enabled !== false,
    transport,
    command: String(input.command ?? existing.command ?? "").trim().slice(0, 500),
    args: String(input.args ?? existing.args ?? "").trim().slice(0, 2000),
    cwd: String(input.cwd ?? existing.cwd ?? "").trim().slice(0, 500),
    url: String(input.url ?? existing.url ?? "").trim().slice(0, 500),
    trust: TRUST.includes(input.trust) ? input.trust : existing.trust || "ask",
    local: typeof input.local === "boolean" ? input.local : existing.local === true, // allowed in Private mode
  };
  if (!s.name) throw new Error("Give the app a name.");
  if (transport === "stdio" && !s.command) throw new Error("Which command starts it? (for example npx or uvx)");
  if (transport === "http" && !/^https?:\/\//.test(s.url)) throw new Error("The address starts with https:// (or http:// on this computer).");
  return s;
}

const secretName = (id, key) => `mcp-${id}-${key}`;

function list() {
  return load().map((s) => {
    const c = clients.get(s.id);
    return {
      ...s,
      hasToken: Boolean(keys.getSecret(secretName(s.id, "token"))),
      hasEnv: Boolean(keys.getSecret(secretName(s.id, "env"))),
      status: c?.status || (s.enabled ? "stopped" : "off"),
      error: c?.error || "",
      tools: (c?.tools || []).map((t) => ({ name: t.name, description: t.description || "", readOnly: t.annotations?.readOnlyHint === true })),
    };
  });
}

// Adds or changes a server. token / env: secrets (empty keeps them, null removes them).
function save(input = {}) {
  const all = load();
  const at = input.id ? all.findIndex((s) => s.id === input.id) : -1;
  if (at < 0 && all.length >= MAX_SERVERS) throw new Error(`Up to ${MAX_SERVERS} apps.`);
  const server = clean(input, at >= 0 ? all[at] : {});
  if (at >= 0) all[at] = server;
  else all.push(server);
  for (const key of ["token", "env"]) {
    if (input[key] === null) keys.deleteSecret(secretName(server.id, key));
    else if (typeof input[key] === "string" && input[key].trim()) keys.setSecret(secretName(server.id, key), input[key].trim());
  }
  writeJson(file, all);
  restart(server.id);
  return list().find((s) => s.id === server.id);
}

function remove(id) {
  stop(id);
  for (const key of ["token", "env"]) keys.deleteSecret(secretName(id, key));
  writeJson(file, load().filter((s) => s.id !== id));
  return { ok: true };
}

// ---------- Talking to a server (JSON-RPC 2.0) ----------
class Client {
  constructor(server) {
    this.server = server;
    this.status = "starting";
    this.error = "";
    this.tools = [];
    this.nextId = 1;
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.proc = null;
    this.session = null; // Mcp-Session-Id (HTTP)
    this.buffer = "";
    this.stderr = "";
  }

  async start() {
    try {
      if (this.server.transport === "stdio") this.spawn();
      const init = await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Friends", version } });
      this.protocol = init?.protocolVersion || PROTOCOL;
      this.notify("notifications/initialized");
      await this.listTools();
      this.status = "ready";
      this.error = "";
    } catch (err) {
      this.status = "error";
      this.error = err.message + (this.stderr ? ` (${this.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)})` : "");
      this.close();
      logger.warn(`MCP ${this.server.name}: ${this.error}`);
    }
  }

  spawn() {
    const extraEnv = parseEnv(keys.getSecret(secretName(this.server.id, "env")));
    const cwd = this.server.cwd ? this.server.cwd.replace(/^~(?=$|\/)/, require("os").homedir()) : undefined;
    this.proc = spawn(this.server.command, splitArgs(this.server.args), { cwd, env: { ...process.env, ...extraEnv }, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.receive(line);
      }
    });
    this.proc.stderr.on("data", (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    this.proc.on("error", (err) => this.failAll(err.code === "ENOENT" ? `"${this.server.command}" isn't installed (or isn't on the PATH).` : err.message));
    this.proc.on("exit", (code) => {
      this.failAll(`It stopped (exit code ${code}).`);
      if (this.status === "ready") {
        this.status = "error";
        this.error = `It stopped (exit code ${code}).`;
      }
    });
  }

  receive(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // a log line on stdout
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) this.handle(m);
  }

  handle(m) {
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message || "The app reported an error."));
      else p.resolve(m.result);
    } else if (m.method && m.id !== undefined) {
      // The server asks us something: only ping is answered
      this.send(m.method === "ping" ? { jsonrpc: "2.0", id: m.id, result: {} } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Not supported by Friends" } });
    } else if (m.method === "notifications/tools/list_changed") {
      this.listTools().catch(() => {});
    }
  }

  failAll(message) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }

  send(msg) {
    if (this.server.transport === "stdio") {
      if (!this.proc?.stdin.writable) throw new Error("The app isn't running.");
      this.proc.stdin.write(JSON.stringify(msg) + "\n");
      return Promise.resolve();
    }
    return this.post(msg);
  }

  notify(method, params) {
    Promise.resolve(this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })).catch(() => {});
  }

  request(method, params, { timeout = TIMEOUT_MS } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`It didn't answer within ${Math.round(timeout / 1000)} seconds.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      Promise.resolve(this.send({ jsonrpc: "2.0", id, method, params })).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  // Streamable HTTP: one POST per message; the answer is JSON or a short event stream
  async post(msg) {
    const token = keys.getSecret(secretName(this.server.id, "token"));
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": this.protocol || PROTOCOL };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    let res;
    try {
      res = await fetch(this.server.url, { method: "POST", headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`Couldn't reach ${this.server.url} (${err.cause?.code || err.message}).`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 401 || res.status === 403) throw new Error("The app didn't accept the token (or needs a sign-in Friends can't do yet).");
    if (!res.ok && res.status !== 202) throw new Error(`The app answered ${res.status}.`);
    if (res.status === 202 || msg.id === undefined) return;
    const type = res.headers.get("content-type") || "";
    const text = await res.text();
    if (type.includes("text/event-stream")) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        if (data) this.receive(data);
      }
    } else if (text.trim()) {
      this.receive(text);
    }
  }

  async listTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const r = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
      if (!cursor) break;
    }
    this.tools = tools.slice(0, 100);
  }

  async call(name, args) {
    if (this.status !== "ready") throw new Error(`${this.server.name} isn't running${this.error ? `: ${this.error}` : ""}.`);
    return this.request("tools/call", { name, arguments: args || {} }, { timeout: 120000 });
  }

  close() {
    this.failAll("Closed.");
    if (this.proc) {
      this.proc.removeAllListeners("exit");
      try {
        this.proc.stdin.end();
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    if (this.server.transport === "http" && this.session) {
      const headers = { "Mcp-Session-Id": this.session };
      fetch(this.server.url, { method: "DELETE", headers, signal: AbortSignal.timeout(3000) }).catch(() => {});
      this.session = null;
    }
  }
}

// ---------- The running servers ----------
const clients = new Map(); // id → Client

function stop(id) {
  clients.get(id)?.close();
  clients.delete(id);
}

function restart(id) {
  stop(id);
  const server = load().find((s) => s.id === id);
  if (!server?.enabled) return null;
  const client = new Client(server);
  clients.set(id, client);
  return client.start().then(() => client);
}

function startAll() {
  for (const s of load()) if (s.enabled && !clients.has(s.id)) restart(s.id);
}

function stopAll() {
  for (const id of [...clients.keys()]) stop(id);
}

// JSON Schema → Gemini's schema (openai.js lowers it again for other AIs)
function toSchema(schema, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 6) return { type: "STRING" };
  const options = schema.anyOf || schema.oneOf;
  if (Array.isArray(options) && options.length) {
    const first = options.find((o) => o && o.type !== "null") || options[0];
    return toSchema({ ...first, description: schema.description || first.description }, depth + 1);
  }
  let type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (!type) type = schema.properties ? "object" : schema.items ? "array" : "string";
  if (!["string", "number", "integer", "boolean", "array", "object"].includes(type)) type = "string";
  const out = { type: type.toUpperCase() };
  if (schema.description) out.description = String(schema.description).slice(0, 500);
  if (type === "string" && Array.isArray(schema.enum)) out.enum = schema.enum.filter((x) => typeof x === "string").slice(0, 50);
  if (type === "array") out.items = toSchema(schema.items || { type: "string" }, depth + 1);
  if (type === "object") {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties || {}).slice(0, 40)) out.properties[key] = toSchema(value, depth + 1);
    const required = (schema.required || []).filter((k) => k in out.properties);
    if (required.length) out.required = required;
  }
  return out;
}

// The AI's name for a server's tool: mcp_<server>_<tool>, at most 64 characters
const toolName = (server, tool) => `mcp_${slug(server.name).slice(0, 20)}_${slug(tool.name)}`.slice(0, 64);

function usable(settings) {
  const privateMode = settings.privacy?.localOnly === true;
  return [...clients.values()].filter((c) => c.status === "ready" && (!privateMode || c.server.local));
}

// The tools of the servers that are running (hidden on camera: they're your accounts)
function declarations(settings, { hidden = false } = {}) {
  if (hidden) return [];
  const out = [];
  for (const c of usable(settings)) {
    for (const t of c.tools) {
      out.push({ name: toolName(c.server, t), description: `[${c.server.name}] ${String(t.description || t.title || t.name).slice(0, 900)}`, parameters: { ...toSchema(t.inputSchema || { type: "object" }), type: "OBJECT" } });
    }
  }
  return out;
}

function find(name, settings) {
  if (!name.startsWith("mcp_")) return null;
  for (const c of usable(settings)) {
    const tool = c.tools.find((t) => toolName(c.server, t) === name);
    if (tool) return { client: c, tool };
  }
  return null;
}

// What a tool call gave back, for the AI
function resultText(result) {
  const parts = [];
  for (const item of result?.content || []) {
    if (item.type === "text") parts.push(item.text);
    else if (item.type === "resource" && item.resource?.text) parts.push(item.resource.text);
    else if (item.type === "resource_link") parts.push(`[link: ${item.name || ""} ${item.uri}]`);
    else parts.push(`[${item.type}]`);
  }
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  const text = parts.join("\n");
  return text.length > 30000 ? `${text.slice(0, 30000)}\n[…cut off]` : text;
}

async function run(name, args, ctx) {
  const found = find(name, ctx.settings);
  if (!found) return null;
  const { client, tool } = found;
  const trust = client.server.trust;
  const quiet = trust === "all" || (trust === "read-only" && tool.annotations?.readOnlyHint === true);
  const summary = `${client.server.name}: ${tool.title || tool.name}`;
  if (!quiet && !(await ctx.confirm(`Use ${summary}`, { type: "app", app: client.server.name, tool: tool.name, args }))) {
    ctx.onActivity?.(`You declined: ${summary}`);
    return { error: "The user declined this action." };
  }
  ctx.onActivity?.(summary);
  const result = await client.call(tool.name, args);
  const text = resultText(result);
  return result?.isError ? { error: text || "The app reported an error." } : { ok: true, result: text };
}

module.exports = { list, save, remove, restart, startAll, stopAll, declarations, find, run, toSchema, toolName, splitArgs, parseEnv, resultText, TRUST };
