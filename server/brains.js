// Saved AI brains, stored as brains.json in Friends' data folder.
// The API keys themselves are kept in the system keyring (see keys.js).
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const gemini = require("./gemini");
const openai = require("./openai");
const ollama = require("./ollama");
const keys = require("./keys");
const settings = require("./settings");

// "gemini" is Google's cloud API; "local" is any OpenAI-compatible server
// (Ollama, LM Studio, llama.cpp, vLLM...), see openai.js
const PROVIDERS = { gemini: true, local: true };

// The functions that talk to a brain's provider (same for both, see openai.js)
function apiFor({ provider, protocol, baseUrl, contextSize, keepAlive, speechUrl, speechModel }) {
  if (provider === "local") {
    if (protocol === "ollama") return ollama.create({ baseUrl, contextSize, keepAlive, speechUrl, speechModel });
    return openai.create({ baseUrl, speechUrl, speechModel });
  }
  return gemini;
}

// Private mode (Settings → AI control): only local AI, nothing goes to the internet
const privateMode = () => settings.get().privacy?.localOnly === true;
const PRIVATE_MESSAGE = "Private mode is on, so only a local AI can answer. Add a Local AI brain, or turn Private mode off in Settings → AI control.";

// Local servers rarely have a key; Gemini always does
const keyFor = (brain) => (brain.provider === "local" ? keys.getOptionalKey(brain.id) : keys.getKey(brain.id));
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

async function listModels({ id, key, provider = "gemini", protocol, baseUrl }) {
  key = typeof key === "string" ? key.trim() : "";
  if (privateMode() && !(id ? find(Number(id)).provider === "local" : provider === "local")) throw new Error(PRIVATE_MESSAGE);
  if (id) {
    const brain = find(Number(id));
    return apiFor(brain).listModels(key || keyFor(brain));
  }
  if (provider === "local") {
    const fields = localFields({ protocol, baseUrl });
    return apiFor({ provider, ...fields }).listModels(key);
  }
  if (!key) return [];
  return gemini.listModels(key);
}

// The settings that belong to a local brain, checked
const clampInt = (value, lo, hi) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : 0;
};

function localFields({ protocol, baseUrl, speechUrl, speechModel, contextSize, keepAlive }) {
  protocol = protocol === "ollama" ? "ollama" : "openai";
  const fields = {
    protocol,
    baseUrl: openai.normalizeUrl(baseUrl, { protocol }),
    speechUrl: openai.normalizeUrl(speechUrl, { required: false }),
    speechModel: String(speechModel || "").trim().slice(0, 200),
  };
  // Only Ollama's own API can set these (0 = the server's own default)
  if (protocol === "ollama") {
    fields.contextSize = clampInt(contextSize, 1024, 1048576);
    fields.keepAlive = clampInt(keepAlive, 1, 1440);
  }
  return fields;
}

// Ollama names models "name:latest"; "name" means the same
const hasModel = (models, model) => models.includes(model) || models.includes(`${model}:latest`);

// Add (no id) or update a brain. The key is checked against the provider
// before anything is saved.
async function saveBrain({ id, provider, name, model, key, protocol, baseUrl, speechUrl, speechModel, contextSize, keepAlive }) {
  key = typeof key === "string" ? key.trim() : key;
  id = id ? Number(id) : id;
  if (!PROVIDERS[provider]) throw new Error("That kind of AI isn't supported.");
  const existing = id ? find(id) : null;
  if (existing && existing.provider !== provider) throw new Error("A brain can't change its provider. Add a new one instead.");
  const local = provider === "local";
  if (privateMode() && !local) throw new Error(PRIVATE_MESSAGE);
  const extra = local
    ? localFields({
        protocol: protocol ?? existing?.protocol,
        baseUrl: baseUrl ?? existing?.baseUrl,
        speechUrl: speechUrl ?? existing?.speechUrl,
        speechModel: speechModel ?? existing?.speechModel,
        contextSize: contextSize ?? existing?.contextSize,
        keepAlive: keepAlive ?? existing?.keepAlive,
      })
    : {};
  const plainKey = key || (existing && keyFor(existing)) || "";
  if (!local && !plainKey) throw new Error("Paste an API key first.");

  const api = apiFor({ provider, ...extra });
  let models = [];
  try {
    models = await api.listModels(plainKey);
  } catch (err) {
    // A server without a models list can still work when you name the model
    if (!local || !model) throw err;
  }
  if (!model) {
    model = local ? models[0] : pickDefaultModel(models);
    if (!model) throw new Error("This AI server has no models yet. Pull or load one first (for Ollama: ollama pull llama3.2).");
  }
  if (models.length && !(local ? hasModel(models, model) : models.includes(model))) {
    throw new Error(`The model "${model}" isn't available${local ? " on this AI server" : " with this key"}.`);
  }
  await api.checkModel({ key: plainKey, model });

  const s = load();
  const brainId = existing ? existing.id : s.nextId;
  const fields = { provider, name: name || (local ? "Local AI" : "Gemini"), model, ...extra };
  if (key) {
    keys.setKey(brainId, key);
    fields.keyHint = key.slice(-4);
  }

  if (existing) {
    if (local && extra.protocol !== "ollama") {
      delete existing.contextSize;
      delete existing.keepAlive;
    }
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

// "local" runs on this computer, "cloud" is anything online (Gemini)
const kindOf = (b) => (b.provider === "local" ? "local" : "cloud");

// A saved brain with its key and its functions (server only, never sent to the page)
const materialize = (b) => ({ ...b, key: keyFor(b), api: apiFor(b), kind: kindOf(b) });

// The enabled brains of one kind, best first: the preferred one, the default, then the rest.
// Private mode has no cloud brains.
function ofKind(kind, preferId) {
  if (kind === "cloud" && privateMode()) return [];
  const s = load();
  const rank = (b) => (b.id === preferId ? 0 : b.id === s.defaultBrainId ? 1 : 2);
  return s.brains.filter((b) => b.enabled && kindOf(b) === kind).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}

const has = (kind) => ofKind(kind).length > 0;
const getByKind = (kind, preferId) => {
  const b = ofKind(kind, preferId)[0];
  return b ? materialize(b) : null;
};

// The brain for small jobs (follow-up chips, moods, summaries) by the routing mode:
// a local AI when there is one (private and free), else the cloud
function forTask() {
  const mode = privateMode() ? "local" : settings.get().routing.mode;
  if (mode === "fixed") return getForChat(null);
  if (mode === "local") return getByKind("local");
  if (mode === "cloud") return getByKind("cloud");
  return getByKind("local") || getByKind("cloud");
}

// The brain for listening and speaking: a local AI only when its voice is ready
function forVoice() {
  const mode = privateMode() ? "local" : settings.get().routing.mode;
  if (mode === "fixed") return getForChat(null);
  const localReady = require("./voice").installed();
  const local = getByKind("local");
  const cloud = getByKind("cloud");
  if (mode === "local") return local;
  if (mode === "cloud") return cloud;
  return (localReady && local) || cloud || local;
}

// The brain to chat with, including its key (server only, never sent to the page)
// A brain that was deleted or switched off falls back to the default one.
function getForChat(id) {
  const s = load();
  const usable = (b) => !privateMode() || b.provider === "local";
  const brain =
    s.brains.find((b) => b.id === id && b.enabled && usable(b)) ||
    s.brains.find((b) => b.id === s.defaultBrainId && usable(b)) ||
    (privateMode() ? s.brains.find((b) => b.enabled && usable(b)) : null);
  if (!brain) {
    if (privateMode() && s.brains.length) throw new Error(PRIVATE_MESSAGE);
    return null;
  }
  return materialize(brain);
}

// Gets a local model ready before the first message (Ollama only; others load on demand).
// voice: also the speech models, for a spoken conversation.
async function warm({ brainId, voice } = {}) {
  const brain = getForChat(Number(brainId) || null);
  const out = { warm: false };
  if (brain?.provider === "local" && brain.api.warm) Object.assign(out, await brain.api.warm({ model: brain.model }));
  if (voice && brain?.provider === "local") out.voice = (await require("./voice").warm()).warm;
  return out;
}

async function testBrain(id) {
  const brain = id ? find(id) : getForChat(null);
  if (!brain) throw new Error("No active AI brain configured.");
  if (privateMode() && brain.provider !== "local") throw new Error(PRIVATE_MESSAGE);
  const plainKey = keyFor(brain);
  if (!plainKey && brain.provider !== "local") throw new Error("No API key found for this brain.");

  const api = apiFor(brain);
  const start = Date.now();
  const models = await api.listModels(plainKey).catch((err) => {
    if (brain.provider === "local") return []; // not every server lists its models
    throw err;
  });
  // A real request to this model: the list still names models Google retired
  await api.checkModel({ key: plainKey, model: brain.model });
  const latencyMs = Date.now() - start;
  const isAvailable = !models.length || (brain.provider === "local" ? hasModel(models, brain.model) : models.includes(brain.model));
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

async function testConfig({ key, provider = "gemini", model, protocol, baseUrl }) {
  key = typeof key === "string" ? key.trim() : key;
  if (!PROVIDERS[provider]) throw new Error("That kind of AI isn't supported.");
  const local = provider === "local";
  if (privateMode() && !local) throw new Error(PRIVATE_MESSAGE);
  if (!local && !key) throw new Error("Paste an API key first.");
  const api = apiFor({ provider, ...(local ? localFields({ protocol, baseUrl }) : {}) });
  const start = Date.now();
  const models = await api.listModels(key || "");
  const latencyMs = Date.now() - start;
  return {
    ok: true,
    latencyMs,
    model: model || (local ? models[0] : pickDefaultModel(models)),
    modelsCount: models.length,
  };
}

// Read brains.json again (after a backup was restored)
function reload() {
  state = null;
}

module.exports = {
  reload,
  publicState,
  listModels,
  saveBrain,
  deleteBrain,
  setDefault,
  setEnabled,
  getForChat,
  getByKind,
  ofKind,
  has,
  kindOf,
  forTask,
  forVoice,
  warm,
  testBrain,
  testConfig,
};
