// Files attached to messages (the + button): images, PDFs and text files.
// Stored in <data folder>/attachments/ as <id> plus <id>.json with details.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");

const dir = path.join(dataDir, "attachments");
const MAX_SIZE = 15 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Sent to Gemini as files
const INLINE = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"];
// Sent to Gemini as text
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|jsx|tsx|py|rb|go|rs|java|c|h|cpp|hpp|sh|ya?ml|toml|ini|log|sql)$/i;

function kindOf(name, mime) {
  if (INLINE.includes(mime)) return mime;
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name)) return "text";
  return null;
}

function metaFile(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Attachment not found.");
  return path.join(dir, `${id}.json`);
}

function save(buffer, name, mime) {
  name = path.basename(String(name || "file")).slice(0, 200);
  mime = String(mime || "").split(";")[0].trim().toLowerCase();
  if (!buffer.length) throw new Error("The file is empty.");
  if (buffer.length > MAX_SIZE) throw new Error("Files can be up to 15 MB.");
  if (!kindOf(name, mime)) throw new Error("Only images (PNG, JPEG, WebP), PDFs and text files can be attached.");

  const meta = { id: crypto.randomUUID(), name, mime: kindOf(name, mime) === "text" ? "text/plain" : mime, size: buffer.length, createdAt: Date.now() };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, meta.id), buffer, { mode: 0o600 });
  writeJson(metaFile(meta.id), meta);
  return meta;
}

function get(id) {
  const meta = JSON.parse(fs.readFileSync(metaFile(id), "utf8"));
  return { meta, file: path.join(dir, meta.id) };
}

// Message parts for Gemini; null if the file is gone
function toPart(id) {
  try {
    const { meta, file } = get(id);
    const data = fs.readFileSync(file);
    if (meta.mime === "text/plain") {
      return { text: `Attached file "${meta.name}":\n\n${data.toString("utf8").slice(0, 200000)}` };
    }
    return { inlineData: { mimeType: meta.mime, data: data.toString("base64") } };
  } catch {
    return null;
  }
}

module.exports = { MAX_SIZE, save, get, toPart };
