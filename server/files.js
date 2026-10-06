// File access for the AI, limited to the allowed folders from
// Settings → AI & privacy. Every path is resolved to its real location first
// (following "..", "~" and symbolic links), then checked against those folders.
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const home = os.homedir();
const MAX_READ = 1024 * 1024; // 1 MB
const MAX_LIST = 500;

function expand(p) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

// How paths are shown to the AI and to you: ~/Documents/... instead of /home/you/...
function shown(p) {
  return p === home ? "~" : p.startsWith(home + path.sep) ? "~/" + p.slice(home.length + 1) : p;
}

// The real location of p, even if p doesn't exist yet (resolve its nearest existing parent)
async function realLocation(p) {
  const missing = [];
  let current = p;
  for (;;) {
    try {
      return path.join(await fsp.realpath(current), ...missing);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) return p;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function roots(folders) {
  const found = [];
  for (const folder of folders) {
    try {
      found.push(await fsp.realpath(expand(folder)));
    } catch {} // an allowed folder that doesn't exist (yet) is skipped
  }
  return found;
}

// The real path of `p` if it's inside an allowed folder; otherwise an error
async function resolve(p, folders) {
  if (typeof p !== "string" || !p.trim()) throw new Error("A path is required.");
  const allowed = await roots(folders);
  if (!allowed.length) throw new Error("None of the allowed folders exist.");

  let abs = expand(p.trim());
  if (!path.isAbsolute(abs)) abs = path.join(allowed[0], abs);
  const real = await realLocation(path.resolve(abs));
  const root = allowed.find((r) => real === r || real.startsWith(r + path.sep));
  if (!root) throw new Error(`${p} is outside the allowed folders.`);
  return { real, isRoot: real === root };
}

async function kind(real) {
  try {
    const stat = await fsp.stat(real);
    return stat.isDirectory() ? "folder" : "file";
  } catch {
    return null;
  }
}

async function listFolder(real) {
  const entries = await fsp.readdir(real, { withFileTypes: true });
  const items = [];
  for (const entry of entries.slice(0, MAX_LIST)) {
    const item = { name: entry.name, type: entry.isDirectory() ? "folder" : "file" };
    if (item.type === "file") {
      try {
        item.size = (await fsp.stat(path.join(real, entry.name))).size;
      } catch {}
    }
    items.push(item);
  }
  return { path: shown(real), items, truncated: entries.length > MAX_LIST };
}

async function readFile(real) {
  const stat = await fsp.stat(real);
  if (stat.isDirectory()) throw new Error("That's a folder, not a file.");
  if (stat.size > MAX_READ) throw new Error("The file is larger than 1 MB.");
  const data = await fsp.readFile(real);
  if (data.subarray(0, 8000).includes(0)) throw new Error("That's not a text file.");
  return { path: shown(real), content: data.toString("utf8") };
}

async function createFile(real, content) {
  if (!(await kind(path.dirname(real)))) throw new Error("The folder for this file doesn't exist. Create it first.");
  await fsp.writeFile(real, String(content ?? ""), { flag: "wx" }).catch((err) => {
    throw new Error(err.code === "EEXIST" ? "A file with that name already exists." : err.message);
  });
  return { path: shown(real) };
}

async function editFile(real, content) {
  if ((await kind(real)) !== "file") throw new Error("That file doesn't exist.");
  await fsp.writeFile(real, String(content ?? ""));
  return { path: shown(real) };
}

async function createFolder(real) {
  await fsp.mkdir(real, { recursive: true });
  return { path: shown(real) };
}

async function move(from, to) {
  if (await kind(to)) throw new Error("Something already exists at the new location.");
  if ((await kind(path.dirname(to))) !== "folder") throw new Error("The destination folder doesn't exist.");
  await fsp.rename(from, to);
  return { from: shown(from), to: shown(to) };
}

// Delete to the desktop trash (restorable) or permanently
async function remove(real, useTrash) {
  let movedToTrash = false;
  if (useTrash) {
    try {
      await new Promise((resolve, reject) =>
        execFile("gio", ["trash", real], (err, _out, stderr) => {
          if (err) {
            if (err.code === "ENOENT") return reject(err);
            return reject(new Error(stderr.trim() || "Couldn't move it to the trash."));
          }
          resolve();
        })
      );
      movedToTrash = true;
    } catch (err) {
      if (err.code === "ENOENT") {
        // Headless/container environment without desktop trash: fallback to direct removal
        await fsp.rm(real, { recursive: true });
      } else {
        throw err;
      }
    }
  } else {
    await fsp.rm(real, { recursive: true });
  }
  return { path: shown(real), trash: movedToTrash };
}

async function editPart(real, find, replace, { all = false } = {}) {
  if ((await kind(real)) !== "file") throw new Error("That file doesn't exist.");
  const text = await fsp.readFile(real, "utf8");
  const needle = String(find ?? "");
  if (!needle) throw new Error("Say which text to replace (find).");
  const count = text.split(needle).length - 1;
  if (!count) throw new Error("That text isn't in the file. Read the file again and copy the exact lines, including spaces.");
  if (count > 1 && !all) throw new Error(`That text is in the file ${count} times. Include more lines so it's unique, or set all to replace every one.`);
  const next = all ? text.split(needle).join(String(replace ?? "")) : text.replace(needle, () => String(replace ?? ""));
  await fsp.writeFile(real, next);
  return { path: shown(real), replaced: all ? count : 1 };
}

async function readLines(real, start = 1, end) {
  const stat = await fsp.stat(real);
  if (stat.isDirectory()) throw new Error("That's a folder, not a file.");
  if (stat.size > 5 * 1024 * 1024) throw new Error("The file is larger than 5 MB.");
  const lines = (await fsp.readFile(real, "utf8")).split("\n");
  const from = Math.max(1, Math.round(Number(start)) || 1);
  const to = Math.min(lines.length, Math.round(Number(end)) || from + 299);
  const width = String(to).length;
  return { path: shown(real), totalLines: lines.length, from, to, text: lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width)}  ${l}`).join("\n") };
}

const SKIP_SEARCH_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "venv", "__pycache__", ".cache"]);

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
      if ((await fsp.stat(full)).size > 1024 * 1024) return;
      const buf = await fsp.readFile(full);
      if (buf.subarray(0, 4000).includes(0)) return;
      text = buf.toString("utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && hits.length < max; i++) {
      if (re ? re.test(lines[i]) : lines[i].toLowerCase().includes(lower)) hits.push({ file: shown(full), line: i + 1, text: lines[i].trim().slice(0, 200) });
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
        if (!SKIP_SEARCH_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(full);
      } else if (e.isFile() && (!ext || e.name.endsWith(ext))) await scan(full);
    }
  }
  if ((await fsp.stat(real)).isFile()) await scan(real);
  else await walk(real);
  return { matches: hits, truncated: hits.length >= max };
}

module.exports = { resolve, kind, shown, listFolder, readFile, createFile, editFile, editPart, readLines, search, createFolder, move, remove };
