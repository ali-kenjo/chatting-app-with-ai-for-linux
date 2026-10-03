// The AI's robot body: the moods and gestures it can show (the same lists as
// src/js/robot/presets.mjs; a test keeps them equal), your own robot model
// (a .glb from Blender), and "Smarter moods" (Gemini reads a reply's mood).
const fs = require("fs");
const path = require("path");
const { dataDir } = require("./config");

const MOODS = [
  "neutral", "happy", "excited", "laughing", "curious", "thinking", "focused",
  "surprised", "confused", "skeptical", "sad", "affectionate", "proud", "sleepy",
];

const GESTURES = [
  "nod", "head_shake", "tilt", "wave", "shrug", "bounce", "celebrate", "look_around",
  "lean_in", "point_left", "point_right", "double_take", "shy",
];

// ---------- Your own model ----------
// Named parts the robot animates (README: "Your own robot from Blender")
const NODES = ["Root", "Hover", "Body", "Neck", "Head", "FaceScreen", "Fin_L", "Fin_R", "Arm_L", "Arm_R", "HoverRing"];
const MAX_MODEL = 30 * 1024 * 1024;
const dir = path.join(dataDir, "robot");
const modelFile = path.join(dir, "model.glb");
const infoFile = path.join(dir, "model.json");

// Compressed geometry and textures need decoders the page doesn't load
const UNSUPPORTED = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu"];

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

// Checks a .glb (binary glTF 2.0) and returns its JSON part; throws with a
// message a person can act on when it isn't one Friends can show.
function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) throw new Error("That isn't a .glb file.");
  if (buffer.length > MAX_MODEL) throw new Error("The model can be up to 30 MB.");
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error("That isn't a .glb file (binary glTF). In Blender, export as glTF Binary (.glb).");
  if (buffer.readUInt32LE(4) !== 2) throw new Error("Only glTF 2.0 models can be used.");
  if (buffer.readUInt32LE(8) !== buffer.length) throw new Error("The .glb file is incomplete or damaged.");

  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== CHUNK_JSON || jsonLength === 0 || 20 + jsonLength > buffer.length) {
    throw new Error("The .glb file is damaged (its first part isn't glTF JSON).");
  }
  let gltf;
  try {
    gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  } catch {
    throw new Error("The .glb file is damaged (its glTF JSON can't be read).");
  }
  if (!gltf || typeof gltf !== "object" || !String(gltf.asset?.version || "").startsWith("2")) {
    throw new Error("Only glTF 2.0 models can be used.");
  }
  // A second chunk, if any, must be the binary buffer and fit in the file
  const next = 20 + jsonLength;
  if (next < buffer.length) {
    if (next + 8 > buffer.length || buffer.readUInt32LE(next + 4) !== CHUNK_BIN || next + 8 + buffer.readUInt32LE(next) > buffer.length) {
      throw new Error("The .glb file is damaged (its binary part doesn't fit).");
    }
  }
  const unsupported = (gltf.extensionsRequired || []).filter((e) => UNSUPPORTED.includes(e));
  if (unsupported.length) throw new Error(`Export it without compression (${unsupported.join(", ")} isn't supported).`);
  // Everything must be inside the file: no links to other files or websites
  const external = [...(gltf.buffers || []), ...(gltf.images || [])].some((x) => x && typeof x.uri === "string" && !x.uri.startsWith("data:"));
  if (external) throw new Error("The model points to other files. Export it as one .glb with everything embedded.");
  return gltf;
}

// The contract's named parts this model has
const nodesIn = (gltf) => NODES.filter((name) => (gltf.nodes || []).some((n) => n && n.name === name));

function info() {
  try {
    const meta = JSON.parse(fs.readFileSync(infoFile, "utf8"));
    if (fs.existsSync(modelFile)) return { custom: true, ...meta };
  } catch {}
  return { custom: false };
}

function saveModel(buffer, name = "model.glb") {
  const gltf = validateGlb(buffer);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = modelFile + ".tmp";
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  fs.renameSync(tmp, modelFile);
  const meta = {
    name: path.basename(String(name || "model.glb")).slice(0, 120),
    size: buffer.length,
    uploadedAt: Date.now(),
    nodes: nodesIn(gltf),
  };
  fs.writeFileSync(infoFile, JSON.stringify(meta, null, 2), { mode: 0o600 });
  return { custom: true, ...meta };
}

function removeModel() {
  for (const file of [modelFile, infoFile]) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
  return { custom: false };
}

// ---------- Smarter moods ----------
// One small request per turn: which mood fits this reply? Returns a mood or null.
async function readMood({ brain, text, heard = "" }) {
  const reply = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (!reply) return null;
  const answer = await brain.api.generateText({
    key: brain.key,
    model: brain.model,
    prompt: [
      "Which one word best describes the mood of this reply from an AI companion?",
      `Choose from: ${MOODS.join(", ")}.`,
      "Reply with that one word only.",
      "",
      heard ? `The user said: """${String(heard).replace(/\s+/g, " ").trim().slice(0, 600)}"""` : "",
      `The reply: """${reply}"""`,
    ].filter(Boolean).join("\n"),
    temperature: 0,
  });
  const word = String(answer || "").toLowerCase().match(/[a-z]+/g) || [];
  return word.find((w) => MOODS.includes(w)) || null;
}

module.exports = { MOODS, GESTURES, NODES, MAX_MODEL, modelFile, validateGlb, info, saveModel, removeModel, readMood };
