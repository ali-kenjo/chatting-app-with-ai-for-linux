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

module.exports = { resolve, kind, shown, listFolder, readFile, createFile, editFile, createFolder, move, remove };
