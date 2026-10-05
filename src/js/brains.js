// ---------- AI brains & Intelligence Control ----------
import { api as helper } from "./api.js";
import { getSettings, onSettings, updateSettings } from "./store.js";
import { t, tp, nf } from "./i18n.js";
import { announce } from "./a11y.js";
import { skeleton } from "./ui.js";

// Brains are stored by the helper; this module handles model management & AI control.
const PROVIDERS = {
  gemini: { label: "Gemini", company: "Google", color: "#4f8df5", available: true },
  local: { label: t("Local AI"), company: t("On this computer"), color: "#3fa56b", available: true },
  claude: { label: "Claude", company: "Anthropic", color: "#d97757" },
  chatgpt: { label: "ChatGPT", company: "OpenAI", color: "#10a37f" },
  deepseek: { label: "DeepSeek", company: "DeepSeek", color: "#4d6bfe" },
  mistral: { label: "Mistral", company: "Mistral AI", color: "#fa520f" },
  grok: { label: "Grok", company: "xAI", color: "#71767b" },
};

// Servers that run models on your computer; each speaks the OpenAI API
// (Ollama is used through its own API, which lets Friends set the context size)
const LOCAL_SERVERS = [
  { label: "Ollama", url: "http://127.0.0.1:11434", protocol: "ollama" },
  { label: "LM Studio", url: "http://127.0.0.1:1234/v1" },
  { label: "llama.cpp", url: "http://127.0.0.1:8080/v1" },
  { label: "Jan", url: "http://127.0.0.1:1337/v1" },
  { label: "vLLM", url: "http://127.0.0.1:8000/v1" },
  { label: "LocalAI", url: "http://127.0.0.1:8080/v1" },
  { label: "KoboldCpp", url: "http://127.0.0.1:5001/v1" },
  { label: t("Other…"), url: "" },
];
const DEFAULT_CONTEXT = 8192;
// A typed address on Ollama's port is Ollama
const protocolFor = (url) => (/:11434(\/|$)/.test(url) ? "ollama" : "openai");

const CURATED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-3.8-flash"];

const api = helper.brains;

let brains = [];
let loadedBrains = false; // the helper hasn't told us yet: the list shows grey bars, not "No AI yet"
let defaultBrainId = null;
let editingId = null; // null while adding a new brain
let confirmDeleteId = null;
let formProvider = "gemini";
let selectedCuratedModel = "gemini-2.5-flash";
let presetGiven = false; // the form was opened from a quick-add preset
let formProtocol = "openai"; // how a local brain is talked to: "ollama" or "openai"

const aiOverview = document.getElementById("ai-overview");
const brainList = document.getElementById("brain-list");
const listError = document.getElementById("brain-list-error");
const brainForm = document.getElementById("brain-form");
const formError = document.getElementById("brain-form-error");
const saveBtn = document.getElementById("brain-save");
const providerGrid = document.getElementById("provider-grid");
const modelOptions = document.getElementById("model-options");
const baseUrlField = document.getElementById("baseurl-field");
const localPresetsField = document.getElementById("local-presets-field");
const localPresets = document.getElementById("local-presets");
const modelSelectField = document.getElementById("model-select-field");
const speechField = document.getElementById("speech-field");
const keyLabel = document.getElementById("key-label");
const keyDesc = document.getElementById("key-desc");
const ollamaField = document.getElementById("ollama-field");
const GEMINI_KEY_DESC = keyDesc.innerHTML;
const keyToggle = document.getElementById("key-toggle");

// Status & diagnostic elements
const activeBrainName = document.getElementById("ai-active-brain-name");
const activeBrainMeta = document.getElementById("ai-active-brain-meta");
const pingBtn = document.getElementById("ai-ping-btn");
const pingStatus = document.getElementById("ai-ping-status");

// Form test elements
const modelCuratedGrid = document.getElementById("model-curated-grid");
const modelCustomWrapper = document.getElementById("model-custom-wrapper");
const brainTestBtn = document.getElementById("brain-test-btn");
const brainTestFeedback = document.getElementById("brain-test-feedback");

// Policy elements
const reasoningGrid = document.getElementById("reasoning-effort-grid");
const contextSlider = document.getElementById("context-window-slider");
const contextValLabel = document.getElementById("context-val-label");

const ICONS = {
  star: '<svg viewBox="0 0 24 24"><polygon points="12 3 14.8 8.8 21 9.6 16.5 14 17.6 20.2 12 17.2 6.4 20.2 7.5 14 3 9.6 9.2 8.8"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
  lightning: '<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};

// What a brain's list entry says about its credentials or where it runs
function maskKey(hint, brain) {
  if (brain?.provider === "local") return brain.baseUrl.replace(/^https?:\/\//, "").replace(/\/v1$/, "");
  if (!hint) return t("No key");
  if (hint === "env") return t("System key (Google AI Studio)");
  return "••••" + hint;
}

function logoFor(provider) {
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const el = document.createElement("div");
  el.className = "brain-logo";
  el.style.setProperty("--c", p.color);
  el.textContent = p.label[0];
  return el;
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

// Take the latest state from the helper and redraw
function apply(state) {
  loadedBrains = true;
  brains = state.brains || [];
  defaultBrainId = state.defaultBrainId;
  renderBrains();
  updateDiagnosticBanner();
}

// The first-run guide (onboarding.js) added an AI itself
document.addEventListener("friends:brains-apply", (e) => apply(e.detail));

function updateDiagnosticBanner() {
  const def = brains.find((b) => b.id === defaultBrainId) || brains[0];
  if (!def) {
    if (activeBrainName) activeBrainName.textContent = t("No AI connected");
    if (activeBrainMeta) activeBrainMeta.textContent = t("Add an AI below to start chatting");
    return;
  }
  const provider = PROVIDERS[def.provider] || { company: t("Custom") };
  if (activeBrainName) activeBrainName.textContent = t("{name} (default)", { name: def.name });
  if (activeBrainMeta) activeBrainMeta.textContent = `${provider.company} · ${def.model} · ${maskKey(def.keyHint, def)}`;
}

function renderBrains() {
  brainList.innerHTML = "";
  if (!loadedBrains) {
    brainList.append(skeleton("li"));
    return;
  }

  if (!brains.length) {
    brainList.innerHTML = '<li class="brain-empty"></li>';
    brainList.querySelector("li").textContent = t("No AI yet. Add one to start chatting.");
    document.dispatchEvent(new CustomEvent("friends:brains-changed", { detail: { brains, defaultBrainId } }));
    return;
  }

  brains.forEach((b) => {
    const li = document.createElement("li");
    li.className = "brain";
    li.dataset.id = b.id;

    if (confirmDeleteId === b.id) {
      li.classList.add("confirm");
      li.innerHTML = `
        <span role="alert"></span>
        <div class="brain-actions">
          <button class="btn" data-action="cancel-delete">${t("Cancel")}</button>
          <button class="btn btn-danger" data-action="confirm-delete">${t("Delete")}</button>
        </div>`;
      li.querySelector("span").textContent = t("Delete {name}?", { name: b.name });
      brainList.append(li);
      return;
    }

    const isDefault = b.id === defaultBrainId;
    li.classList.toggle("is-default", isDefault);
    li.classList.toggle("is-off", !b.enabled);
    li.innerHTML = `
      <div class="brain-info">
        <div class="brain-name"><span></span>${isDefault ? '<span class="badge">${t("Default")}</span>' : ""}</div>
        <div class="brain-meta"></div>
      </div>
      <div class="brain-actions">
        <button class="icon-btn small" data-action="test" title="${t("Test the connection")}" aria-label="${t("Test the connection to {name}", { name: b.name })}">${ICONS.lightning}</button>
        <input type="checkbox" class="toggle" data-action="toggle" title="${isDefault ? t("The default AI stays on") : t("On / off")}" aria-label="${t("{name} on", { name: b.name })}"
          ${b.enabled ? "checked" : ""} ${isDefault ? "disabled" : ""}>
        <button class="icon-btn small ${isDefault ? "star-on" : ""}" data-action="default" title="${isDefault ? t("The default AI") : t("Make default")}" aria-label="${isDefault ? t("{name} is the default AI", { name: b.name }) : t("Make {name} the default", { name: b.name })}" aria-pressed="${isDefault}">${ICONS.star}</button>
        <button class="icon-btn small" data-action="edit" title="${t("Edit")}" aria-label="${t("Edit {name}", { name: b.name })}">${ICONS.edit}</button>
        <button class="icon-btn small danger" data-action="delete" title="${t("Delete")}" aria-label="${t("Delete {name}", { name: b.name })}">${ICONS.trash}</button>
      </div>`;
    li.prepend(logoFor(b.provider));
    li.querySelector(".brain-name span").textContent = b.name;
    const meta = li.querySelector(".brain-meta");
    meta.textContent = `${PROVIDERS[b.provider]?.company || t("AI")} · ${b.model} · ${maskKey(b.keyHint, b)}`;
    brainList.append(li);
  });

  // The model picker in the composer follows these changes
  document.dispatchEvent(new CustomEvent("friends:brains-changed", { detail: { brains, defaultBrainId } }));
}

// Run a change in the helper, then redraw with the result
async function update(action) {
  showError(listError, "");
  try {
    apply(await action());
  } catch (err) {
    showError(listError, err.message);
    renderBrains();
  }
}

// Ping / Test a single brain
async function testSingleBrain(id, triggerBtn) {
  const brainLi = triggerBtn.closest(".brain");
  const meta = brainLi?.querySelector(".brain-meta");
  const origText = meta ? meta.textContent : "";
  triggerBtn.disabled = true;
  if (meta) meta.textContent = t("Testing connection…");

  try {
    const res = await api.test(id);
    if (meta) meta.textContent = `✓ ${t("{ms} ms latency", { ms: nf(res.latencyMs) })} · ${t("{model} verified", { model: res.model })}`;
    if (meta) announce(meta.textContent);
  } catch (err) {
    if (meta) meta.textContent = `⚠️ ${t("Connection error: {message}", { message: err.message })}`;
    if (meta) announce(meta.textContent, { urgent: true });
  } finally {
    triggerBtn.disabled = false;
    setTimeout(() => {
      if (meta && (meta.textContent.includes("✓") || meta.textContent.includes("⚠️"))) {
        const b = brains.find((x) => x.id === id);
        if (b) meta.textContent = `${PROVIDERS[b.provider]?.company || t("AI")} · ${b.model} · ${maskKey(b.keyHint, b)}`;
      }
    }, 4500);
  }
}

// Brain list actions
brainList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.dataset.action === "toggle") return;
  const id = Number(btn.closest(".brain").dataset.id);

  switch (btn.dataset.action) {
    case "test":
      return testSingleBrain(id, btn);
    case "default":
      return update(() => api.setDefault(id));
    case "edit":
      return openBrainForm(id);
    case "delete":
      confirmDeleteId = id;
      break;
    case "cancel-delete":
      confirmDeleteId = null;
      break;
    case "confirm-delete":
      confirmDeleteId = null;
      return update(() => api.remove(id));
  }
  renderBrains();
});

brainList.addEventListener("change", (e) => {
  if (e.target.dataset.action !== "toggle") return;
  const id = Number(e.target.closest(".brain").dataset.id);
  update(() => api.setEnabled(id, e.target.checked));
});

// Diagnostic Header Ping Button
if (pingBtn) {
  pingBtn.addEventListener("click", async () => {
    pingBtn.disabled = true;
    pingBtn.innerHTML = `<span>${t("Pinging…")}</span>`;
    showError(pingStatus, "");
    pingStatus.className = "ai-ping-status";
    pingStatus.hidden = false;
    pingStatus.textContent = t("Testing the connection and how fast it answers…");

    try {
      const activeId = defaultBrainId || brains[0]?.id;
      const res = await api.test(activeId);
      pingStatus.className = "ai-ping-status ok";
      pingStatus.textContent = `✓ ${t("Online · answers in {ms} ms · {model} is ready for chat and voice", { ms: nf(res.latencyMs), model: res.model })}`;
      announce(pingStatus.textContent);
    } catch (err) {
      pingStatus.className = "ai-ping-status error";
      pingStatus.textContent = `⚠️ ${t("Connection error: {message}", { message: err.message })}`;
      announce(pingStatus.textContent, { urgent: true });
    } finally {
      pingBtn.disabled = false;
      pingBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>${t("Test connection")}</span>`;
    }
  });
}

// Provider tiles in the form
Object.entries(PROVIDERS).forEach(([key, p]) => {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "provider";
  tile.dataset.provider = key;
  tile.disabled = !p.available;
  tile.append(logoFor(key), p.label);
  if (!p.available) {
    const soon = document.createElement("span");
    soon.className = "soon";
    soon.textContent = t("Soon");
    tile.append(soon);
  }
  tile.addEventListener("click", () => selectProvider(key));
  providerGrid.append(tile);
});

function selectProvider(key) {
  const prev = PROVIDERS[formProvider];
  const f = brainForm.elements;
  const changed = key !== formProvider;
  formProvider = key;

  providerGrid.querySelectorAll(".provider").forEach((t) =>
    t.classList.toggle("selected", t.dataset.provider === key)
  );

  // Keep an auto-filled name in sync with the chosen provider
  if (!f.name.value || (changed && f.name.value === prev.label)) f.name.value = PROVIDERS[key].label;

  const local = key === "local";
  baseUrlField.hidden = !local;
  localPresetsField.hidden = !local;
  speechField.hidden = !local;
  ollamaField.hidden = !local || formProtocol !== "ollama";
  modelSelectField.hidden = local;
  modelCustomWrapper.hidden = !local && selectedCuratedModel !== "custom";
  f.baseUrl.required = local;
  f.key.required = !local && !editingId && !presetGiven;
  keyLabel.textContent = local ? t("API key (optional)") : t("API key");
  document.getElementById("model-label").textContent = local ? t("Model") : t("Custom model name");
  keyDesc.innerHTML = local ? t("Most local servers need none. Leave empty unless yours asks for one.") : GEMINI_KEY_DESC;
  if (local && changed) {
    if (!f.baseUrl.value) pickLocalServer(LOCAL_SERVERS[0].url);
    else loadModels(localQuery());
  }
}

// What the form says about a local server, for the helper
const localQuery = () => {
  const f = brainForm.elements;
  return { provider: "local", protocol: formProtocol, baseUrl: f.baseUrl.value.trim(), key: f.key.value.trim() };
};

function setProtocol(protocol) {
  const f = brainForm.elements;
  formProtocol = protocol;
  ollamaField.hidden = formProvider !== "local" || protocol !== "ollama";
  // A new Ollama brain starts with a context that fits a normal chat
  if (protocol === "ollama" && !editingId && f.contextSize.value === "0") f.contextSize.value = String(DEFAULT_CONTEXT);
}

function pickLocalServer(url, protocol = protocolFor(url)) {
  const f = brainForm.elements;
  localPresets.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("selected", b.dataset.url === url));
  setProtocol(protocol);
  if (url) {
    f.baseUrl.value = url;
    f.model.value = "";
    loadModels(localQuery(), { fill: true });
  } else {
    f.baseUrl.focus();
  }
}

LOCAL_SERVERS.forEach((s) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chip preset-btn";
  btn.dataset.url = s.url;
  btn.textContent = s.label;
  btn.addEventListener("click", () => pickLocalServer(s.url, s.protocol));
  localPresets.append(btn);
});

brainForm.elements.baseUrl.addEventListener("change", () => {
  if (formProvider !== "local") return;
  const url = brainForm.elements.baseUrl.value.trim();
  const preset = LOCAL_SERVERS.find((s) => s.url && s.url === url);
  setProtocol(preset ? preset.protocol || "openai" : protocolFor(url));
  localPresets.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("selected", b.dataset.url === url));
  loadModels(localQuery(), { fill: true });
});

// Fill the model suggestions with what this key can actually use
let modelsRequest = 0;
async function loadModels(query, { fill = false } = {}) {
  const f = brainForm.elements;
  const mine = ++modelsRequest;
  modelOptions.innerHTML = "";
  f.model.placeholder = t("Loading models…");
  const placeholder = query.provider === "local" ? t("Pick or type a model name") : t("Leave empty to pick automatically");
  try {
    const models = await api.models(query);
    if (mine !== modelsRequest) return; // a newer lookup is running
    models.forEach((m) => modelOptions.append(new Option(m)));
    f.model.placeholder = placeholder;
    if (fill && !f.model.value && models.length) f.model.value = models[0];
    showError(formError, "");
  } catch (err) {
    if (mine !== modelsRequest) return;
    f.model.placeholder = placeholder;
    showError(formError, err.message);
  }
}

// Select curated model card in form
function selectCuratedModel(modelKey) {
  selectedCuratedModel = modelKey;
  const f = brainForm.elements;

  modelCuratedGrid?.querySelectorAll(".model-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.model === modelKey);
  });

  if (modelKey === "custom") {
    if (modelCustomWrapper) modelCustomWrapper.hidden = false;
    f.model.focus();
  } else {
    if (modelCustomWrapper) modelCustomWrapper.hidden = true;
    f.model.value = modelKey;
  }
}

modelCuratedGrid?.addEventListener("click", (e) => {
  const card = e.target.closest(".model-card");
  if (!card) return;
  selectCuratedModel(card.dataset.model);
});

// Quick Add Presets
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset;
    if (preset === "flash") {
      openBrainForm(null, { name: "Gemini 2.5 Flash", model: "gemini-2.5-flash" });
    } else if (preset === "pro") {
      openBrainForm(null, { name: "Gemini 2.5 Pro", model: "gemini-2.5-pro" });
    } else if (preset === "flash2") {
      openBrainForm(null, { name: "Gemini 2.0 Flash", model: "gemini-2.0-flash" });
    } else if (preset === "local") {
      openBrainForm(null, { name: t("Local AI"), provider: "local", protocol: "ollama" });
    }
  });
});

function openBrainForm(id = null, preset = null) {
  const brain = brains.find((b) => b.id === id);
  const f = brainForm.elements;
  editingId = brain ? id : null;
  confirmDeleteId = null;

  brainForm.reset();
  showError(formError, "");
  if (brainTestFeedback) {
    brainTestFeedback.textContent = "";
    brainTestFeedback.className = "test-feedback";
  }
  modelOptions.innerHTML = "";
  f.key.type = "password";
  document.getElementById("brain-form-title").textContent = brain ? t("Edit this AI") : t("Add an AI");
  f.name.value = brain ? brain.name : (preset ? preset.name : "");
  
  const provider = brain ? brain.provider : preset?.provider || "gemini";
  const targetModel = brain ? brain.model : preset?.model || (provider === "gemini" ? "gemini-2.5-flash" : "");
  f.model.value = targetModel;
  f.model.placeholder = t("Leave empty to pick automatically");

  // Highlight curated model card or custom
  if (CURATED_MODELS.includes(targetModel)) {
    selectCuratedModel(targetModel);
  } else {
    selectCuratedModel("custom");
    f.model.value = targetModel;
  }

  // When editing, an empty key field keeps the saved key
  presetGiven = Boolean(preset);
  f.key.placeholder = brain && brain.keyHint ? `${maskKey(brain.keyHint, brain)} — ${t("leave empty to keep")}` : provider === "local" ? t("Usually none") : t("Paste your API key");
  formProtocol = brain?.protocol === "ollama" ? "ollama" : "openai";
  if (preset?.protocol) formProtocol = preset.protocol;
  f.contextSize.value = String(brain?.contextSize ?? (formProtocol === "ollama" && !brain ? DEFAULT_CONTEXT : 0));
  f.keepAlive.value = String(brain?.keepAlive ?? 0);
  if (brain?.provider === "local") {
    f.baseUrl.value = brain.baseUrl || "";
    localPresets.querySelectorAll(".preset-btn").forEach((b) => b.classList.toggle("selected", b.dataset.url === brain.baseUrl));
    f.speechUrl.value = brain.speechUrl || "";
    f.speechModel.value = brain.speechModel || "";
    speechField.open = Boolean(brain.speechUrl);
  } else {
    speechField.open = false;
  }

  formProvider = provider === "local" && !brain ? "gemini" : provider; // so choosing "local" below counts as a change
  selectProvider(provider);
  if (brain) loadModels({ id: brain.id });

  aiOverview.hidden = true;
  brainForm.hidden = false;
  f.name.focus();
}

function closeBrainForm() {
  brainForm.hidden = true;
  aiOverview.hidden = false;
  renderBrains();
}

// Form test button: verify key & model before saving
if (brainTestBtn) {
  brainTestBtn.addEventListener("click", async () => {
    const f = brainForm.elements;
    const key = f.key.value.trim();
    const model = f.model.value.trim();
    brainTestBtn.disabled = true;
    if (brainTestFeedback) {
      brainTestFeedback.className = "test-feedback";
      brainTestFeedback.textContent = t("Testing…");
    }

    try {
      let res;
      if (editingId && !key) {
        res = await api.test(editingId);
      } else {
        res = await api.testConfig({ key, provider: formProvider, model, protocol: formProtocol, baseUrl: f.baseUrl.value.trim() });
      }
      if (brainTestFeedback) {
        brainTestFeedback.className = "test-feedback ok";
        brainTestFeedback.textContent = formProvider === "local"
          ? `✓ ${t("Server reachable ({ms} ms)", { ms: nf(res.latencyMs) })} · ${tp("{n} model available", "{n} models available", res.modelsCount ?? 0)}`
          : `✓ ${t("Key works ({ms} ms)", { ms: nf(res.latencyMs) })} · ${tp("{n} model available", "{n} models available", res.modelsCount ?? 0)}`;
      announce(brainTestFeedback.textContent);
      }
    } catch (err) {
      if (brainTestFeedback) {
        brainTestFeedback.className = "test-feedback error";
        brainTestFeedback.textContent = `⚠️ ${err.message}`;
      }
    } finally {
      brainTestBtn.disabled = false;
    }
  });
}

// A newly pasted key: fetch its models once the field is left
brainForm.elements.key.addEventListener("change", (e) => {
  const key = e.target.value.trim();
  showError(formError, "");
  if (formProvider === "local") loadModels(localQuery());
  else if (key) loadModels({ key });
});

brainForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = brainForm.elements;
  const data = {
    id: editingId,
    provider: formProvider,
    name: f.name.value.trim() || PROVIDERS[formProvider].label,
    model: f.model.value.trim(),
  };
  if (f.key.value.trim()) data.key = f.key.value.trim();
  if (formProvider === "local") {
    data.protocol = formProtocol;
    if (formProtocol === "ollama") {
      data.contextSize = Number(f.contextSize.value) || 0;
      data.keepAlive = Number(f.keepAlive.value) || 0;
    }
    data.baseUrl = f.baseUrl.value.trim();
    data.speechUrl = f.speechUrl.value.trim();
    data.speechModel = f.speechModel.value.trim();
  }

  showError(formError, "");
  saveBtn.disabled = true;
  saveBtn.textContent = formProvider === "local" ? t("Checking the server…") : t("Checking the key…");
  try {
    apply(await api.save(data));
    closeBrainForm();
  } catch (err) {
    showError(formError, err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t("Save");
  }
});

keyToggle.addEventListener("click", () => {
  const input = brainForm.elements.key;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  keyToggle.title = show ? t("Hide the key") : t("Show the key");
  keyToggle.setAttribute("aria-label", keyToggle.title);
});

document.getElementById("brain-add").addEventListener("click", () => openBrainForm());
document.getElementById("brain-back").addEventListener("click", closeBrainForm);
document.getElementById("brain-cancel").addEventListener("click", closeBrainForm);

// Reasoning Effort Switcher
reasoningGrid?.addEventListener("click", (e) => {
  const choice = e.target.closest("[data-effort]");
  if (!choice) return;
  const effort = choice.dataset.effort;
  updateSettings((s) => {
    if (!s.aiControl) s.aiControl = {};
    s.aiControl.reasoningEffort = effort;
  });
});

// Context slider label live sync
contextSlider?.addEventListener("input", (e) => {
  if (contextValLabel) contextValLabel.textContent = tp("{n} message", "{n} messages", Number(e.target.value));
});

// Sync AI Control settings
onSettings((s) => {
  const ai = s.aiControl || {};
  if (reasoningGrid) {
    reasoningGrid.querySelectorAll("[data-effort]").forEach((btn) => {
      const isSelected = btn.dataset.effort === (ai.reasoningEffort || "balanced");
      btn.classList.toggle("selected", isSelected);
      btn.setAttribute("aria-checked", isSelected);
    });
  }
  if (contextValLabel && ai.contextWindow) {
    contextValLabel.textContent = tp("{n} message", "{n} messages", ai.contextWindow);
  }
});

// ----- Privacy & local AI -----
const localServers = document.getElementById("local-servers");
const localStatus = document.getElementById("local-card-status");
const localHelp = document.getElementById("local-help");
const privateNote = document.getElementById("private-mode-note");
let detected = [];
let detecting = false;

const isPrivate = () => getSettings()?.privacy?.localOnly === true;

function renderLocal() {
  localServers.innerHTML = "";
  const running = detected.filter((s) => s.running);
  localHelp.hidden = running.length > 0 || detecting;
  localStatus.textContent = detecting
    ? t("Looking for AI model servers…")
    : running.length
      ? t("{names} found. Add a model with one click.", { names: running.map((s) => s.label).join(", ") })
      : t("No local AI server is running.");

  for (const server of running) {
    const box = document.createElement("div");
    box.className = "local-server";
    const name = document.createElement("div");
    name.className = "local-server-name";
    name.innerHTML = '<span class="dot"></span><span class="label"></span><span class="meta"></span>';
    name.querySelector(".label").textContent = server.label;
    name.querySelector(".meta").textContent = `${tp("{n} model", "{n} models", server.models.length)} · ${server.url.replace(/^https?:\/\//, "")}`;
    box.append(name);

    const models = document.createElement("div");
    models.className = "local-models";
    if (!server.models.length) {
      const none = document.createElement("span");
      none.className = "row-desc";
      none.textContent = server.protocol === "ollama" ? t("No models yet. Run: ollama pull llama3.2") : t("No model is loaded yet. Load one in the server.");
      models.append(none);
    }
    for (const model of server.models) {
      const chip = document.createElement("span");
      chip.className = "local-model";
      const label = document.createElement("span");
      label.textContent = model;
      chip.append(label);
      if (brains.some((b) => b.provider === "local" && b.baseUrl.replace(/\/v1$/, "") === server.url.replace(/\/v1$/, "") && b.model.replace(/:latest$/, "") === model.replace(/:latest$/, ""))) {
        const done = document.createElement("span");
        done.className = "added";
        done.textContent = t("✓ Added");
        chip.append(done);
      } else {
        const add = document.createElement("button");
        add.type = "button";
        add.className = "btn";
        add.textContent = t("Add");
        add.setAttribute("aria-label", t("Add {model}", { model }));
        add.addEventListener("click", () => addDetected(server, model, add));
        chip.append(add);
      }
      models.append(chip);
    }
    box.append(models);
    localServers.append(box);
  }
}

async function addDetected(server, model, button) {
  button.disabled = true;
  button.textContent = t("Loading…"); // the first request loads the model, which can take a moment
  showError(listError, "");
  try {
    const data = { provider: "local", protocol: server.protocol, name: model.replace(/:latest$/, ""), baseUrl: server.url, model };
    if (server.protocol === "ollama") data.contextSize = DEFAULT_CONTEXT;
    apply(await api.save(data));
  } catch (err) {
    showError(listError, err.message);
    button.disabled = false;
    button.textContent = t("Add");
  }
}

async function detectLocal() {
  if (detecting) return;
  detecting = true;
  renderLocal();
  try {
    detected = (await helper.local.servers()).servers;
  } catch {
    detected = [];
  }
  detecting = false;
  renderLocal();
}

// ----- Local voice (listening and speaking on this computer) -----
const voiceStatus = document.getElementById("local-voice-status");
const voiceBtn = document.getElementById("local-voice-btn");
let voicePoll = null;

function renderVoice(s) {
  voiceBtn.hidden = false;
  voiceBtn.disabled = false;
  if (s.installing) {
    voiceStatus.textContent = t("Setting up… {step} (a few minutes, once)", { step: s.step || "" });
    voiceBtn.textContent = t("Setting up…");
    voiceBtn.disabled = true;
  } else if (s.installed) {
    voiceStatus.textContent = t("Ready. Listens (Whisper) and speaks (Piper) in English, German and Arabic. It starts when you talk and stops when idle.");
    voiceBtn.hidden = true;
  } else {
    voiceStatus.textContent = s.error || t("Talk to a local AI and hear it answer, all on this computer. One-time download of about {size} GB.", { size: nf(s.sizeMb / 1000, { maximumFractionDigits: 1 }) });
    voiceBtn.textContent = s.error ? t("Try again") : t("Set up");
  }
}

async function refreshVoice() {
  try {
    const s = await helper.local.voice();
    renderVoice(s);
    if (s.installing && !voicePoll) voicePoll = setInterval(refreshVoice, 2000);
    if (!s.installing && voicePoll) {
      clearInterval(voicePoll);
      voicePoll = null;
    }
  } catch {}
}

voiceBtn.addEventListener("click", async () => {
  voiceBtn.disabled = true;
  try {
    renderVoice(await helper.local.installVoice());
    refreshVoice();
  } catch (err) {
    voiceStatus.textContent = err.message;
    voiceBtn.disabled = false;
  }
});

document.getElementById("local-refresh").addEventListener("click", () => {
  detectLocal();
  refreshVoice();
});
document.getElementById("local-add-manual").addEventListener("click", () => openBrainForm(null, { name: t("Local AI"), provider: "local", protocol: "ollama" }));
window.addEventListener("focus", () => {
  if (!aiOverview.hidden && aiOverview.offsetParent) detectLocal();
});

// Private mode: cloud brains are shown as off, and a note says what to do
function renderPrivate() {
  const on = isPrivate();
  brainList.querySelectorAll(".brain").forEach((li) => {
    const brain = brains.find((b) => b.id === Number(li.dataset.id));
    li.classList.toggle("is-blocked", on && brain?.provider !== "local");
  });
  const noLocal = !brains.some((b) => b.provider === "local");
  privateNote.hidden = !(on && noLocal);
  privateNote.textContent = on && noLocal ? t("Private mode is on, but there's no local AI yet. Add one below, or chat won't work.") : "";
}

// ----- Which AI answers -----
const MODE_TEXT = {
  fixed: t("Every message goes to the one AI you pick in the model menu."),
  auto: t("Short and ordinary messages go to a local AI; the cloud AI takes what a local one can't (below). If one fails, the other answers."),
  dynamic: t("Like Auto, and it reacts to how things are going: a local AI that is slow or fails is replaced by the cloud for a while, a cloud AI that is down by the local one."),
  fastest: t("Asks the local and the cloud AI at once, and the first one to start answering wins; the other is cancelled."),
  local: t("Only an AI on this computer answers."),
  cloud: t("Only a cloud AI (Gemini) answers."),
};
const routingOptions = document.getElementById("routing-options");

function renderRouting() {
  const mode = isPrivate() ? "local" : getSettings()?.routing?.mode || "fixed";
  document.getElementById("routing-mode-desc").textContent = isPrivate() ? t("Private mode is on, so only a local AI answers.") : MODE_TEXT[mode];
  routingOptions.querySelectorAll("[data-for]").forEach((el) => el.classList.toggle("is-inactive", !el.dataset.for.split(" ").includes(mode)));
  // The fine rules are only worth showing for the modes that use them
  document.getElementById("routing-advanced").hidden = !routingOptions.querySelector("#routing-advanced [data-for]:not(.is-inactive)");
}

onSettings(renderPrivate);
onSettings(renderRouting);
document.addEventListener("friends:brains-changed", () => {
  renderPrivate();
  renderLocal();
});

renderBrains();
api.list().then((state) => {
  apply(state);
  renderPrivate();
}, (err) => {
  loadedBrains = true;
  renderBrains();
  showError(listError, err.message);
});
detectLocal();
refreshVoice();
