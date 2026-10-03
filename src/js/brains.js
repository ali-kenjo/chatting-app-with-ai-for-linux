// ---------- AI brains & Intelligence Control ----------
import { api as helper } from "./api.js";
import { getSettings, onSettings, updateSettings } from "./store.js";

// Brains are stored by the helper; this module handles model management & AI control.
const PROVIDERS = {
  gemini: { label: "Gemini", company: "Google", color: "#4f8df5", available: true },
  claude: { label: "Claude", company: "Anthropic", color: "#d97757" },
  chatgpt: { label: "ChatGPT", company: "OpenAI", color: "#10a37f" },
  deepseek: { label: "DeepSeek", company: "DeepSeek", color: "#4d6bfe" },
  mistral: { label: "Mistral", company: "Mistral AI", color: "#fa520f" },
  grok: { label: "Grok", company: "xAI", color: "#71767b" },
  custom: { label: "Custom", company: "OpenAI-compatible", color: "#5f6368" },
};

const CURATED_MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-3.8-flash"];

const api = helper.brains;

let brains = [];
let defaultBrainId = null;
let editingId = null; // null while adding a new brain
let confirmDeleteId = null;
let formProvider = "gemini";
let selectedCuratedModel = "gemini-2.5-flash";

const aiOverview = document.getElementById("ai-overview");
const brainList = document.getElementById("brain-list");
const listError = document.getElementById("brain-list-error");
const brainForm = document.getElementById("brain-form");
const formError = document.getElementById("brain-form-error");
const saveBtn = document.getElementById("brain-save");
const providerGrid = document.getElementById("provider-grid");
const modelOptions = document.getElementById("model-options");
const baseUrlField = document.getElementById("baseurl-field");
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

function maskKey(hint) {
  if (!hint) return "No key";
  if (hint === "env") return "System key (Google AI Studio)";
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
  brains = state.brains || [];
  defaultBrainId = state.defaultBrainId;
  renderBrains();
  updateDiagnosticBanner();
}

function updateDiagnosticBanner() {
  const def = brains.find((b) => b.id === defaultBrainId) || brains[0];
  if (!def) {
    if (activeBrainName) activeBrainName.textContent = "No brain connected";
    if (activeBrainMeta) activeBrainMeta.textContent = "Add a Gemini brain below to start chatting";
    return;
  }
  const provider = PROVIDERS[def.provider] || { company: "Custom" };
  if (activeBrainName) activeBrainName.textContent = `${def.name} (Default)`;
  if (activeBrainMeta) activeBrainMeta.textContent = `${provider.company} · ${def.model} · ${maskKey(def.keyHint)}`;
}

function renderBrains() {
  brainList.innerHTML = "";

  if (!brains.length) {
    brainList.innerHTML = '<li class="brain-empty">No AI brains yet. Add one to start chatting.</li>';
    return;
  }

  brains.forEach((b) => {
    const li = document.createElement("li");
    li.className = "brain";
    li.dataset.id = b.id;

    if (confirmDeleteId === b.id) {
      li.classList.add("confirm");
      li.innerHTML = `
        <span>Delete <strong></strong>?</span>
        <div class="brain-actions">
          <button class="btn" data-action="cancel-delete">Cancel</button>
          <button class="btn btn-danger" data-action="confirm-delete">Delete</button>
        </div>`;
      li.querySelector("strong").textContent = b.name;
      brainList.append(li);
      return;
    }

    const isDefault = b.id === defaultBrainId;
    li.classList.toggle("is-default", isDefault);
    li.classList.toggle("is-off", !b.enabled);
    li.innerHTML = `
      <div class="brain-info">
        <div class="brain-name"><span></span>${isDefault ? '<span class="badge">Default</span>' : ""}</div>
        <div class="brain-meta"></div>
      </div>
      <div class="brain-actions">
        <button class="icon-btn small" data-action="test" title="Test latency & connection">${ICONS.lightning}</button>
        <input type="checkbox" class="toggle" data-action="toggle" title="${isDefault ? "The default brain stays on" : "On / off"}"
          ${b.enabled ? "checked" : ""} ${isDefault ? "disabled" : ""}>
        <button class="icon-btn small ${isDefault ? "star-on" : ""}" data-action="default" title="${isDefault ? "Default brain" : "Make default"}">${ICONS.star}</button>
        <button class="icon-btn small" data-action="edit" title="Edit">${ICONS.edit}</button>
        <button class="icon-btn small danger" data-action="delete" title="Delete">${ICONS.trash}</button>
      </div>`;
    li.prepend(logoFor(b.provider));
    li.querySelector(".brain-name span").textContent = b.name;
    const meta = li.querySelector(".brain-meta");
    meta.textContent = `${PROVIDERS[b.provider]?.company || "AI"} · ${b.model} · ${maskKey(b.keyHint)}`;
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
  if (meta) meta.textContent = "Testing connection…";

  try {
    const res = await api.test(id);
    if (meta) meta.textContent = `✓ ${res.latencyMs}ms latency · ${res.model} verified`;
  } catch (err) {
    if (meta) meta.textContent = `⚠️ Connection error: ${err.message}`;
  } finally {
    triggerBtn.disabled = false;
    setTimeout(() => {
      if (meta && meta.textContent.includes("latency")) {
        const b = brains.find((x) => x.id === id);
        if (b) meta.textContent = `${PROVIDERS[b.provider]?.company || "AI"} · ${b.model} · ${maskKey(b.keyHint)}`;
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
    pingBtn.innerHTML = `<span>Pinging…</span>`;
    showError(pingStatus, "");
    pingStatus.className = "ai-ping-status";
    pingStatus.hidden = false;
    pingStatus.textContent = "Testing model connection and round-trip latency…";

    try {
      const activeId = defaultBrainId || brains[0]?.id;
      const res = await api.test(activeId);
      pingStatus.className = "ai-ping-status ok";
      pingStatus.textContent = `✓ Online · ${res.latencyMs}ms round-trip · Model "${res.model}" is active and ready for chat & voice`;
    } catch (err) {
      pingStatus.className = "ai-ping-status error";
      pingStatus.textContent = `⚠️ Connection error: ${err.message}`;
    } finally {
      pingBtn.disabled = false;
      pingBtn.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>Test Ping</span>`;
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
    soon.textContent = "Soon";
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

  baseUrlField.hidden = key !== "custom";
  f.baseUrl.required = key === "custom";
}

// Fill the model suggestions with what this key can actually use
async function loadModels(query) {
  const f = brainForm.elements;
  modelOptions.innerHTML = "";
  f.model.placeholder = "Loading models…";
  try {
    const models = await api.models(query);
    models.forEach((m) => modelOptions.append(new Option(m)));
    f.model.placeholder = "Leave empty to pick automatically";
  } catch (err) {
    f.model.placeholder = "Leave empty to pick automatically";
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
  document.getElementById("brain-form-title").textContent = brain ? "Edit AI brain" : "Add AI brain";
  f.name.value = brain ? brain.name : (preset ? preset.name : "");
  
  const targetModel = brain ? brain.model : (preset ? preset.model : "gemini-2.5-flash");
  f.model.value = targetModel;
  f.model.placeholder = "Leave empty to pick automatically";
  
  // Highlight curated model card or custom
  if (CURATED_MODELS.includes(targetModel)) {
    selectCuratedModel(targetModel);
  } else {
    selectCuratedModel("custom");
    f.model.value = targetModel;
  }

  // When editing, an empty key field keeps the saved key
  f.key.required = !brain && !preset;
  f.key.placeholder = brain ? `${maskKey(brain.keyHint)} — leave empty to keep` : "Paste your API key";

  formProvider = brain ? brain.provider : "gemini";
  selectProvider(formProvider);
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
      brainTestFeedback.textContent = "Testing credentials…";
    }

    try {
      let res;
      if (editingId && !key) {
        res = await api.test(editingId);
      } else {
        res = await api.testConfig({ key, provider: formProvider, model });
      }
      if (brainTestFeedback) {
        brainTestFeedback.className = "test-feedback ok";
        brainTestFeedback.textContent = `✓ Key valid (${res.latencyMs}ms) · ${res.modelsCount || "Active"} models available`;
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
  if (key) loadModels({ key });
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

  showError(formError, "");
  saveBtn.disabled = true;
  saveBtn.textContent = "Checking key…";
  try {
    apply(await api.save(data));
    closeBrainForm();
  } catch (err) {
    showError(formError, err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save brain";
  }
});

keyToggle.addEventListener("click", () => {
  const input = brainForm.elements.key;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  keyToggle.title = show ? "Hide key" : "Show key";
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
  if (contextValLabel) contextValLabel.textContent = `${e.target.value} msgs`;
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
    contextValLabel.textContent = `${ai.contextWindow} msgs`;
  }
});

renderBrains();
api.list().then(apply, (err) => showError(listError, err.message));
