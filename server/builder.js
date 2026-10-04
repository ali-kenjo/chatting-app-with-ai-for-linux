// Builder mode (Settings → Builder): building apps, SaaS and websites
// together. Code tools that work inside the allowed folders (edit part of a
// file, search code, read lines, see a project's tree), project starters,
// running commands (tests, builds, installs, dev servers) under the approval
// mode you pick, and a live preview of a website. Every path follows the same
// rules as the other file tools (files.js).
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const files = require("./files");
const templates = require("./templates");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "venv", "__pycache__", ".cache", "coverage", "target"]);
const MAX_FILE = 1024 * 1024;

// ---------- Code tools ----------
// Replaces an exact piece of a file (it must be there once, unless all: true)
async function editPart(real, find, replace, { all = false } = {}) {
  if ((await files.kind(real)) !== "file") throw new Error("That file doesn't exist.");
  const text = await fsp.readFile(real, "utf8");
  const needle = String(find ?? "");
  if (!needle) throw new Error("Say which text to replace (find).");
  const count = text.split(needle).length - 1;
  if (!count) throw new Error("That text isn't in the file. Read the file again and copy the exact lines, including spaces.");
  if (count > 1 && !all) throw new Error(`That text is in the file ${count} times. Include more lines so it's unique, or set all to replace every one.`);
  const next = all ? text.split(needle).join(String(replace ?? "")) : text.replace(needle, () => String(replace ?? ""));
  await fsp.writeFile(real, next);
  return { path: files.shown(real), replaced: all ? count : 1 };
}

// Lines start..end of a text file (1-based, inclusive), numbered
async function readLines(real, start = 1, end) {
  const stat = await fsp.stat(real);
  if (stat.isDirectory()) throw new Error("That's a folder, not a file.");
  if (stat.size > 5 * MAX_FILE) throw new Error("The file is larger than 5 MB.");
  const lines = (await fsp.readFile(real, "utf8")).split("\n");
  const from = Math.max(1, Math.round(Number(start)) || 1);
  const to = Math.min(lines.length, Math.round(Number(end)) || from + 299);
  const width = String(to).length;
  return { path: files.shown(real), totalLines: lines.length, from, to, text: lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width)}  ${l}`).join("\n") };
}

// Files whose text matches (plain text, or a regular expression), with line numbers
async function search(real, query, { regex = false, glob = "", max = 100 } = {}) {
  const q = String(query ?? "");
  if (!q) throw new Error("What should be searched for?");
  let re;
  try {
    re = regex ? new RegExp(q, "i") : null;
  } catch (err) {
    throw new Error(`That isn't a valid regular expression: ${err.message}`);
  }
  const lower = q.toLowerCase();
  const ext = glob.replace(/^\*+/, "");
  const hits = [];
  let scanned = 0;
  async function scan(full) {
    scanned++;
    let text;
    try {
      if ((await fsp.stat(full)).size > MAX_FILE) return;
      const buf = await fsp.readFile(full);
      if (buf.subarray(0, 4000).includes(0)) return;
      text = buf.toString("utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (re ? re.test(lines[i]) : lines[i].toLowerCase().includes(lower)) hits.push({ file: files.shown(full), line: i + 1, text: lines[i].trim().slice(0, 200) });
    }
  }
  async function walk(dir) {
    if (hits.length >= max || scanned > 5000) return;
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= max) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(full);
      } else if (e.isFile() && (!ext || e.name.endsWith(ext))) await scan(full);
    }
  }
  if ((await fsp.stat(real)).isFile()) await scan(real);
  else await walk(real);
  return { matches: hits, truncated: hits.length >= max };
}

// A project's files and folders, a few levels deep (without node_modules and the like)
async function tree(real, depth = 3) {
  const lines = [];
  let count = 0;
  async function walk(dir, prefix, level) {
    let entries = [];
    try {
      entries = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => !SKIP_DIRS.has(e.name) && e.name !== ".DS_Store").sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (++count > 400) return;
      lines.push(`${prefix}${e.name}${e.isDirectory() ? "/" : ""}`);
      if (e.isDirectory() && level < depth) await walk(path.join(dir, e.name), `${prefix}  `, level + 1);
    }
  }
  await walk(real, "", 1);
  return { path: files.shown(real), tree: lines.join("\n"), truncated: count > 400 };
}

// A new project from a starter (templates.js) in a new folder
async function createProject(parentReal, name, template) {
  const t = templates.get(template);
  if (!t) throw new Error(`There's no starter called "${template}". Use one of: ${templates.names().join(", ")}.`);
  const slug = String(name || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!slug) throw new Error("Give the project a name.");
  if ((await files.kind(parentReal)) !== "folder") throw new Error("The folder to put it in doesn't exist.");
  const dir = path.join(parentReal, slug);
  if (await files.kind(dir)) throw new Error(`${files.shown(dir)} already exists.`);
  if (t.command) return { command: t.command(slug), cwd: files.shown(parentReal), note: t.note };
  const made = [];
  for (const [rel, content] of Object.entries(t.files({ name: slug, title: String(name).trim() || slug }))) {
    const file = path.join(dir, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content, { flag: "wx" });
    made.push(rel);
  }
  return { path: files.shown(dir), files: made, next: t.next };
}

// ---------- Commands ----------
// Read-only and everyday development commands: "Smart" runs these by itself
const SAFE = [
  /^(ls|pwd|cat|head|tail|wc|tree|file|stat|du|df|which|whoami|date|uname|echo|printf|sort|uniq|cut|diff|basename|dirname|realpath)\b/,
  /^(grep|rg|egrep|fgrep)\b/,
  /^find\b(?!.*\s-(delete|exec|execdir|ok)\b)/,
  /^git (status|log|diff|show|branch(?!.*\s-[dDmM])|remote -v|rev-parse|ls-files|blame|describe|tag(?!.*\s-d)|stash list|shortlog|config --get)\b/,
  /^(node|npm|npx|pnpm|yarn|bun|deno|python3?|pip3?|cargo|go|rustc|java|javac|ruby|php|tsc)\s+(-v|--version|version)\b/,
  /^(npm|pnpm|yarn|bun) (test|run (test|lint|build|check|typecheck|format:check)|ls|list|outdated|audit(?! fix)|why)\b/,
  /^npx (tsc --noEmit|eslint|prettier --check|vitest run|jest)\b/,
  /^(pytest|python3? -m (pytest|unittest|py_compile)|pip3? (list|show|freeze))\b/,
  /^(cargo (check|test|build|clippy|fmt --check)|go (test|build|vet)|make (test|check|lint))\b/,
];

// Dangerous: always asks, even in Auto (your own list adds to it)
const RISKY = [
  /(^|[;&|]\s*)(sudo|su|doas|pkexec)\b/,
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r|-R|--recursive)\b.*(\s\/(\s|$)|\s~\/?(\s|$)|\$HOME|\s\.\.(\/|\s|$)|\s\*(\s|$))/,
  /\brm\s+-[a-z]*[rRf][a-z]*\s+\/\S*/,
  /\b(mkfs|fdisk|parted|wipefs|shred)\b/,
  /\bdd\s+.*\bof=/,
  /:\(\)\s*\{.*\};\s*:/,
  /\bchmod\s+(-R\s+)?[0-7]*777\b.*\s\/(\s|$)|\bchown\s+-R\b/,
  /\b(shutdown|reboot|poweroff|halt|systemctl|service|init\s+0)\b/,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/,
  /\bgit\s+(push\s+.*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*f|filter-branch|update-ref\s+-d)/,
  /\bgit\s+push\b/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  /\bdocker\s+(system\s+prune|rm|rmi|volume\s+rm)\b/,
  /\b(crontab|at)\s/,
  /\b(ssh|scp|sftp|rsync)\b/,
  /\beval\b|\bsource\s+\/|\bexec\s+\//,
  />\s*\/(etc|dev|boot|usr|bin|sbin|lib|var|sys|proc)\//,
  /\b(kill|pkill|killall)\b/,
  /(~|\$HOME)\/\.(ssh|gnupg|config\/friends|aws|kube|netrc|password-store)/,
  /\b(env|printenv|set)\s*($|[|;&>])/,
];

const MODES = ["off", "suggest", "ask", "smart", "auto"];

// Splits a command line into its simple commands (by && || ; |)
const segments = (command) => command.split(/\s*(?:&&|\|\||;|\|)\s*/).map((s) => s.trim()).filter(Boolean);

function matchesAny(text, patterns) {
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.startsWith(p)));
}

// Every path in the command (~/…, /…, ../…) is inside the allowed folders
async function pathsInside(command, folders, cwd) {
  const words = command.match(/(?:^|\s)(~\/?[^\s;&|><'"]*|\/[^\s;&|><'"]*|\.\.\/?[^\s;&|><'"]*)/g) || [];
  for (const w of words) {
    const p = w.trim();
    try {
      await files.resolve(path.isAbsolute(p) || p.startsWith("~") ? p : path.join(cwd, p), folders);
    } catch {
      return false;
    }
  }
  return true;
}

// What happens to a command: "run" (by itself), "ask", or "suggest" (only shown).
// settings.builder: { commands: mode, allow: [prefix], block: [prefix] }
async function decide(command, settings, cwdReal) {
  const b = settings.builder || {};
  const mode = MODES.includes(b.commands) ? b.commands : "off";
  if (mode === "off") return { action: "off" };
  if (mode === "suggest") return { action: "suggest" };
  const c = String(command).trim().replace(/\s+/g, " ");
  const risky = matchesAny(c, RISKY) || (b.block || []).some((p) => p && c.includes(p));
  // Private mode: nothing goes out by itself (installs and fetches would)
  if (mode === "ask" || risky || settings.privacy?.localOnly === true) return { action: "ask", risky };
  if (mode === "auto") return { action: "run" };
  // Smart: each piece is on the safe list (or yours), with no writing to files, and touches only the allowed folders
  const own = (b.allow || []).filter(Boolean);
  const safe = !/[`]|\$\(|>|<\(/.test(c) && segments(c).every((s) => matchesAny(s, SAFE) || own.some((p) => s.startsWith(p)));
  if (safe && (await pathsInside(c, settings.permissions.folders, cwdReal))) return { action: "run" };
  return { action: "ask" };
}

// The environment for commands: yours, without the keys Friends knows about
function cleanEnv() {
  const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: process.env.CI || "" };
  for (const key of Object.keys(env)) if (/^(GEMINI_API_KEY|FRIENDS_|ELECTRON_|NODE_TEST_CONTEXT$)/.test(key)) delete env[key];
  return env;
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n");

// Keeps the start and (mostly) the end of a long output
function trimOutput(text, max = 30000) {
  if (text.length <= max) return text;
  return `${text.slice(0, 4000)}\n[… ${text.length - max} characters cut …]\n${text.slice(-(max - 4000))}`;
}

const LOCAL_URL = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(:\d+)?[^\s"'<>)]*/;
const processes = new Map(); // id → { id, kind, command, cwd, proc|server, output, started, exitCode, url }
const MAX_BACKGROUND = 6;

function kill(p) {
  try {
    if (p.proc && p.exitCode === null) process.kill(-p.proc.pid, "SIGTERM");
  } catch {
    try {
      p.proc?.kill("SIGTERM");
    } catch {}
  }
  p.server?.close();
}

// Runs a command in a folder. background: keeps running (a dev server); the
// first seconds of output come back, the rest with commandOutput(id).
function runCommand(command, cwdReal, { timeout = 120, background = false } = {}) {
  if (background && [...processes.values()].filter((p) => p.exitCode === null).length >= MAX_BACKGROUND) {
    throw new Error(`${MAX_BACKGROUND} things are already running. Stop one first (stop_command).`);
  }
  const proc = spawn("/bin/bash", ["-c", command], { cwd: cwdReal, env: cleanEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const entry = { id: crypto.randomUUID().slice(0, 6), kind: "command", command, cwd: files.shown(cwdReal), proc, output: "", started: Date.now(), exitCode: null };
  let sawAddress = null; // a dev server printed where it is
  const add = (d) => {
    entry.output = trimOutput(entry.output + stripAnsi(d.toString("utf8")), 60000);
    if (sawAddress && LOCAL_URL.test(entry.output)) sawAddress();
  };
  proc.stdout.on("data", add);
  proc.stderr.on("data", add);
  const done = new Promise((resolve) => {
    proc.on("error", (err) => {
      entry.exitCode = -1;
      entry.output += `\n${err.message}`;
      resolve();
    });
    proc.on("close", (code, signal) => {
      entry.exitCode = code ?? (signal ? 128 : -1);
      entry.signal = signal;
      resolve();
    });
  });
  if (background) {
    processes.set(entry.id, entry);
    // Its first words: as soon as it says its address, or after a few seconds (or an error)
    const ready = new Promise((r) => (sawAddress = () => setTimeout(r, 300)));
    return Promise.race([done, ready, new Promise((r) => setTimeout(r, 8000))]).then(() => {
      entry.url = entry.output.match(LOCAL_URL)?.[0]?.replace("0.0.0.0", "localhost");
      return { id: entry.id, running: entry.exitCode === null, exitCode: entry.exitCode, url: entry.url, output: trimOutput(entry.output, 8000) };
    });
  }
  const limit = Math.min(600, Math.max(5, Number(timeout) || 120)) * 1000;
  const timer = setTimeout(() => {
    entry.timedOut = true;
    kill(entry);
  }, limit);
  return done.then(() => {
    clearTimeout(timer);
    return { exitCode: entry.exitCode, timedOut: entry.timedOut === true, seconds: Math.round((Date.now() - entry.started) / 100) / 10, output: trimOutput(entry.output) };
  });
}

function commandOutput(id) {
  const p = processes.get(String(id));
  if (!p) throw new Error("There's nothing running with that id.");
  return { id: p.id, command: p.command, running: p.exitCode === null, exitCode: p.exitCode, url: p.url, output: trimOutput(p.output || "", 20000) };
}

function stop(id) {
  const p = processes.get(String(id));
  if (!p) throw new Error("There's nothing running with that id.");
  kill(p);
  processes.delete(p.id);
  return { ok: true, stopped: p.command };
}

function running() {
  return [...processes.values()].map((p) => ({ id: p.id, kind: p.kind, command: p.command, cwd: p.cwd, url: p.url, running: p.kind === "preview" || p.exitCode === null, started: p.started }));
}

function stopAll() {
  for (const p of processes.values()) kill(p);
  processes.clear();
}

// ---------- Live preview of a website ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4", ".wasm": "application/wasm" };

// Serves a folder on this computer only (127.0.0.1), like a simple web host
function preview(rootReal) {
  for (const p of processes.values()) if (p.kind === "preview" && p.root === rootReal) return Promise.resolve({ id: p.id, url: p.url, reused: true });
  if (processes.size >= MAX_BACKGROUND * 2) throw new Error("Too many things are running. Stop one first.");
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      return res.writeHead(400).end();
    }
    let file = path.resolve(rootReal, "." + path.posix.normalize("/" + rel));
    if (file !== rootReal && !file.startsWith(rootReal + path.sep)) return res.writeHead(403).end();
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, "index.html");
      fs.readFile(file, (err2, data) => {
        if (err2) {
          // Single-page apps: unknown paths get index.html
          return fs.readFile(path.join(rootReal, "index.html"), (e3, index) => (e3 || path.extname(rel) ? res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found") : res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" }).end(index)));
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(data);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const entry = { id: crypto.randomUUID().slice(0, 6), kind: "preview", command: `preview ${files.shown(rootReal)}`, cwd: files.shown(rootReal), root: rootReal, server, url: `http://127.0.0.1:${server.address().port}/`, started: Date.now(), exitCode: null };
      processes.set(entry.id, entry);
      resolve({ id: entry.id, url: entry.url });
    });
  });
}

module.exports = { editPart, readLines, search, tree, createProject, decide, runCommand, commandOutput, stop, running, stopAll, preview, segments, MODES, SAFE, RISKY, home: os.homedir() };
