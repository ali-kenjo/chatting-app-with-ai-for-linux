// Local Markdown Notes Vault: stores notes as clean, standard .md files
// in <data folder>/notes-vault/ (or user-configured folder in Settings).
// 100% offline, privacy-first, and compatible with Obsidian, Logseq, and text editors.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { dataDir } = require("./config");
const logger = require("./logger");

const defaultVaultDir = path.join(dataDir, "notes-vault");

function getVaultDir(ctx) {
  if (typeof ctx === "string" && ctx.trim()) {
    const s = ctx.trim();
    if (s === "~") return os.homedir();
    if (s.startsWith("~/")) return path.join(os.homedir(), s.slice(2));
    return path.resolve(s);
  }
  const custom =
    ctx?.localNotes?.folder?.trim() ||
    ctx?.life?.notesDir?.trim() ||
    ctx?.vaultDir?.trim() ||
    ctx?.dir?.trim();
  if (custom) {
    if (custom === "~") return os.homedir();
    if (custom.startsWith("~/")) return path.join(os.homedir(), custom.slice(2));
    return path.resolve(custom);
  }
  return defaultVaultDir;
}

function ensureVault(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dailyDir = path.join(dir, "daily");
  fs.mkdirSync(dailyDir, { recursive: true, mode: 0o700 });
}

function slugify(title) {
  return String(title || "")
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function todayFileName() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return path.join("daily", `${yyyy}-${mm}-${dd}.md`);
}

function resolvePath(dir, filename) {
  let clean = String(filename || "").trim();
  if (!clean.endsWith(".md")) clean += ".md";
  const resolved = path.resolve(dir, clean);
  const normalizedDir = path.resolve(dir);
  if (!resolved.startsWith(normalizedDir + path.sep) && resolved !== normalizedDir) {
    throw new Error("Path traversal blocked: Note path outside notes vault.");
  }
  return resolved;
}

function extractTags(text) {
  const tags = new Set();
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const tagLine = fmMatch[1].match(/tags:\s*\[(.*?)\]/);
    if (tagLine) {
      tagLine[1]
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean)
        .forEach((t) => tags.add(`#${t}`));
    }
  }
  const inline = text.match(/(?:^|\s)#[a-zA-Z0-9_\-]+/g);
  if (inline) {
    inline.map((s) => s.trim()).filter(Boolean).forEach((t) => tags.add(t));
  }
  return [...tags];
}

function extractTitle(file, content) {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return path.basename(file, ".md");
}

async function listNotes(...args) {
  let vault = null;
  let limit = 50;
  if (typeof args[0] === "number") {
    limit = args[0];
  } else if (typeof args[0] === "object" && args[0] !== null) {
    if (args[0].limit) limit = args[0].limit;
    vault = args[0];
  } else if (typeof args[0] === "string") {
    vault = args[0];
    if (typeof args[1] === "number") limit = args[1];
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);
  const results = [];

  async function walk(current, rel = "") {
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= limit) return;
      const full = path.join(current, e.name);
      const relPath = path.join(rel, e.name);
      if (e.isDirectory() && !e.name.startsWith(".")) {
        await walk(full, relPath);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        try {
          const stat = await fsp.stat(full);
          const content = await fsp.readFile(full, "utf8");
          const tags = extractTags(content);
          const title = extractTitle(full, content);
          results.push({
            path: relPath,
            title,
            tags,
            updatedAt: stat.mtimeMs,
            size: stat.size,
          });
        } catch {}
      }
    }
  }

  await walk(dir);
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readNote(...args) {
  let vault = null;
  let filename = "";
  if (args.length === 1) {
    filename = args[0];
  } else if (typeof args[0] === "object" && args[0] !== null) {
    vault = args[0];
    filename = args[1];
  } else {
    filename = args[0];
    vault = args[1];
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);
  if (filename === "today" || filename === "daily") {
    filename = todayFileName();
  }
  const file = resolvePath(dir, filename);
  try {
    const content = await fsp.readFile(file, "utf8");
    const stat = await fsp.stat(file);
    return {
      path: path.relative(dir, file),
      title: extractTitle(file, content),
      tags: extractTags(content),
      content,
      updatedAt: stat.mtimeMs,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Note '${filename}' does not exist.`);
    }
    throw err;
  }
}

async function writeNote(...args) {
  let vault = null;
  let title = "";
  let content = "";
  let tags = "";

  if (typeof args[0] === "object" && args[0] !== null) {
    vault = args[0];
    title = args[1];
    content = args[2];
    tags = args[3]?.tags || args[3] || "";
  } else {
    title = args[0];
    content = args[1];
    if (args.length === 3) {
      if (typeof args[2] === "string" && (args[2].includes("/") || args[2].includes("\\") || args[2].startsWith("~"))) {
        vault = args[2];
      } else if (typeof args[2] === "object") {
        tags = args[2]?.tags || "";
        vault = args[2]?.vaultDir || args[2]?.dir || null;
      } else {
        tags = args[2];
      }
    } else if (args.length >= 4) {
      tags = args[2]?.tags || args[2] || "";
      vault = args[3];
    }
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);

  let relPath;
  if (title === "today" || title === "daily") {
    relPath = todayFileName();
  } else if (title.includes("/") || title.endsWith(".md")) {
    relPath = title.endsWith(".md") ? title : `${title}.md`;
  } else {
    const slug = slugify(title) || "untitled";
    relPath = `${slug}.md`;
  }
  const file = resolvePath(dir, relPath);

  let body = String(content || "").trim();
  const tagList = Array.isArray(tags)
    ? tags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean)
    : String(tags || "")
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);

  let header = "";
  if (tagList.length) {
    header = `---\ntags: [${tagList.join(", ")}]\ndate: ${new Date().toISOString()}\n---\n\n`;
  }

  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, header + body + "\n", { encoding: "utf8" });
  logger.info(`Saved local note: ${relPath}`);
  return { path: relPath, title: extractTitle(file, body), ok: true };
}

async function appendToNote(...args) {
  let vault = null;
  let title = "";
  let text = "";

  if (typeof args[0] === "object" && args[0] !== null) {
    vault = args[0];
    title = args[1];
    text = args[2];
  } else {
    title = args[0];
    text = args[1];
    vault = args[2];
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);

  let relPath;
  if (title === "today" || title === "daily") {
    relPath = todayFileName();
  } else if (title.includes("/") || title.endsWith(".md")) {
    relPath = title.endsWith(".md") ? title : `${title}.md`;
  } else {
    const slug = slugify(title) || "untitled";
    relPath = `${slug}.md`;
  }
  const file = resolvePath(dir, relPath);
  const stamp = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const addition = `\n- [${stamp}] ${String(text || "").trim()}\n`;

  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, addition, { encoding: "utf8" });
  logger.info(`Appended to local note: ${relPath}`);
  return { path: relPath, ok: true };
}

async function searchNotes(...args) {
  let vault = null;
  let query = "";
  if (typeof args[0] === "object" && args[0] !== null) {
    vault = args[0];
    query = args[1];
  } else {
    query = args[0];
    vault = args[1];
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);
  const q = String(query || "").trim().toLowerCase();
  if (!q) return listNotes(vault, 20);

  const notes = await listNotes(vault, 100);
  const hits = [];

  for (const n of notes) {
    const file = path.join(dir, n.path);
    try {
      const text = await fsp.readFile(file, "utf8");
      const textLower = text.toLowerCase();
      const hasTagMatch = n.tags && n.tags.some((t) => t.toLowerCase().includes(q));
      if (n.title.toLowerCase().includes(q) || textLower.includes(q) || hasTagMatch) {
        const at = textLower.indexOf(q);
        const start = Math.max(0, at - 40);
        const snippet =
          at >= 0
            ? (start > 0 ? "…" : "") +
              text.slice(start, at + q.length + 60).replace(/\s+/g, " ") +
              (at + q.length + 60 < text.length ? "…" : "")
            : text.slice(0, 100).replace(/\s+/g, " ");
        hits.push({ ...n, snippet });
      }
    } catch {}
    if (hits.length >= 25) break;
  }
  return hits;
}

async function deleteNote(...args) {
  let vault = null;
  let filename = "";
  if (typeof args[0] === "object" && args[0] !== null) {
    vault = args[0];
    filename = args[1];
  } else {
    filename = args[0];
    vault = args[1];
  }

  const dir = getVaultDir(vault);
  ensureVault(dir);
  if (filename === "today" || filename === "daily") {
    filename = todayFileName();
  }
  const file = resolvePath(dir, filename);
  try {
    await fsp.unlink(file);
    return { ok: true, path: path.relative(dir, file) };
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Note '${filename}' does not exist.`);
    }
    throw err;
  }
}

module.exports = {
  getVaultDir,
  listNotes,
  readNote,
  writeNote,
  appendToNote,
  searchNotes,
  deleteNote,
  removeNote: deleteNote,
};
