// Saved AI brains, stored as brains.json in Friends' data folder.
// The API keys themselves are kept in the system keyring (see keys.js).
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const gemini = require("./gemini");
const keys = require("./keys");

const PROVIDERS = { gemini };
const file = path.join(dataDir, "brains.json");

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    state = { brains: [], defaultBrainId: null, nextId: 1 };
  }
  if ((!state.brains || state.brains.length === 0) && process.env.GEMINI_API_KEY) {
    state.brains = [
      {
        id: 1,
        enabled: true,
        provider: "gemini",
        name: "Gemini",
        model: "gemini-3.8-flash",
        keyHint: "env",
      },
    ];
    state.defaultBrainId = 1;
    state.nextId = 2;
    persist();
  }
  return state;
}

function persist() {
  writeJson(file, state);
}

function publicState() {
  const { brains, defaultBrainId } = load();
  return { brains, defaultBrainId };
}

function find(id) {
  const brain = load().brains.find((b) => b.id === id);
  if (!brain) throw new Error("That AI brain no longer exists.");
  return brain;
}

// Prefer the newest stable Flash model, e.g. gemini-2.5-flash
function pickDefaultModel(models) {
  const version = (m) => parseFloat(m.match(/^gemini-([\d.]+)/)?.[1] || 0);
  const flash = models.filter((m) => /^gemini-[\d.]+-flash$/.test(m)).sort((a, b) => version(b) - version(a));
  return flash[0] || models[0];
}

async function listModels({ id, key }) {
  if (!key && id) key = keys.getKey(find(id).id);
  if (!key) return [];
  return PROVIDERS.gemini.listModels(key);
}

// Add (no id) or update a brain. The key is checked against the provider
// before anything is saved.
async function saveBrain({ id, provider, name, model, key }) {
  if (!PROVIDERS[provider]) throw new Error("Only Gemini is supported for now.");
  const existing = id ? find(id) : null;
  const plainKey = key || (existing && keys.getKey(existing.id));
  if (!plainKey) throw new Error("Paste an API key first.");

  const models = await PROVIDERS[provider].listModels(plainKey);
  if (!model) model = pickDefaultModel(models);
  if (!models.includes(model)) throw new Error(`The model "${model}" isn't available with this key.`);
  await PROVIDERS[provider].checkModel({ key: plainKey, model });

  const s = load();
  const brainId = existing ? existing.id : s.nextId;
  const fields = { provider, name: name || "Gemini", model };
  if (key) {
    keys.setKey(brainId, key);
    fields.keyHint = key.slice(-4);
  }

  if (existing) {
    Object.assign(existing, fields);
  } else {
    s.nextId++;
    s.brains.push({ id: brainId, enabled: true, ...fields });
    if (!s.defaultBrainId) s.defaultBrainId = brainId;
  }
  persist();
  return publicState();
}

function deleteBrain(id) {
  const s = load();
  s.brains = s.brains.filter((b) => b.id !== id);
  keys.deleteKey(id);
  if (s.defaultBrainId === id) {
    s.defaultBrainId = s.brains[0]?.id ?? null;
    if (s.brains[0]) s.brains[0].enabled = true;
  }
  persist();
  return publicState();
}

function setDefault(id) {
  find(id).enabled = true;
  load().defaultBrainId = id;
  persist();
  return publicState();
}

function setEnabled(id, enabled) {
  if (id === load().defaultBrainId) enabled = true;
  find(id).enabled = !!enabled;
  persist();
  return publicState();
}

// The brain to chat with, including its key (server only, never sent to the page)
// A brain that was deleted or switched off falls back to the default one.
function getForChat(id) {
  const s = load();
  const brain =
    s.brains.find((b) => b.id === id && b.enabled) || s.brains.find((b) => b.id === s.defaultBrainId);
  if (!brain) return null;
  return { ...brain, key: keys.getKey(brain.id), api: PROVIDERS[brain.provider] };
}

async function testBrain(id) {
  const brain = id ? find(id) : getForChat(null);
  if (!brain) throw new Error("No active AI brain configured.");
  const plainKey = keys.getKey(brain.id);
  if (!plainKey) throw new Error("No API key found for this brain.");

  const start = Date.now();
  const models = await PROVIDERS[brain.provider].listModels(plainKey);
  // A real request to this model: the list still names models Google retired
  await PROVIDERS[brain.provider].checkModel({ key: plainKey, model: brain.model });
  const latencyMs = Date.now() - start;
  const isAvailable = models.includes(brain.model);
  return {
    ok: true,
    latencyMs,
    model: brain.model,
    name: brain.name,
    provider: brain.provider,
    isAvailable,
    modelsCount: models.length,
  };
}

async function testConfig({ key, provider = "gemini", model }) {
  if (!PROVIDERS[provider]) throw new Error("Only Gemini is supported for now.");
  if (!key) throw new Error("Paste an API key first.");
  const start = Date.now();
  const models = await PROVIDERS[provider].listModels(key);
  const latencyMs = Date.now() - start;
  return {
    ok: true,
    latencyMs,
    model: model || pickDefaultModel(models),
    modelsCount: models.length,
  };
}

module.exports = {
  publicState,
  listModels,
  saveBrain,
  deleteBrain,
  setDefault,
  setEnabled,
  getForChat,
  testBrain,
  testConfig,
};
