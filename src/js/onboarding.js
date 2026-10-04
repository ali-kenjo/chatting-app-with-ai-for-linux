// ---------- First run ----------
// Until an AI is set up, the start screen shows a short guide instead of the voice card: it looks for
// an AI on this computer (and offers it with one click), or takes a free Gemini key. "Not now" hides
// it; the status line under the start screen brings it back.
import { api } from "./api.js";
import { getSettings, onSettings, updateSettings, flushSettings } from "./store.js";
import { announce } from "./a11y.js";
import { t, tp } from "./i18n.js";

const card = document.getElementById("onboarding");
const hero = document.getElementById("voice-hero-card");
const status = document.getElementById("onb-local-status");
const actions = document.getElementById("onb-local-actions");
const help = document.getElementById("onb-local-help");
const cloudForm = document.getElementById("onb-cloud");
const keyInput = document.getElementById("onb-key");
const cloudSave = document.getElementById("onb-cloud-save");
const cloudError = document.getElementById("onb-cloud-error");
const chip = document.getElementById("ws-status-indicator");

const DEFAULT_CONTEXT = 8192;
let brains = null; // unknown until the helper has told us
let reopened = false; // asked for again after "Not now"
let timer = null;
let busy = false;

const hasAI = () => (brains || []).some((b) => b.enabled);

function shouldShow() {
  const s = getSettings();
  if (!s || brains === null || hasAI()) return false;
  return reopened || !s.onboarding?.done;
}

function sync() {
  const show = shouldShow();
  const was = !card.hidden;
  card.hidden = !show;
  hero.hidden = show;
  if (show && !was) detect();
  if (!show) clearTimeout(timer);
}

// ----- An AI on this computer -----
async function detect() {
  clearTimeout(timer);
  let servers = [];
  try {
    servers = (await api.local.servers()).servers.filter((s) => s.running);
  } catch {}
  renderLocal(servers);
  // Maybe they're starting one right now: look again every few seconds while the guide is up
  if (!card.hidden) timer = setTimeout(detect, 5000);
}

function renderLocal(servers) {
  if (busy) return;
  actions.replaceChildren();
  const models = servers.flatMap((server) => server.models.slice(0, 4).map((model) => ({ server, model })));
  help.hidden = models.length > 0;
  if (!servers.length) {
    status.textContent = t("No AI found on this computer yet.");
    const again = button(t("Look again"), "btn", detect);
    actions.append(again);
    return;
  }
  if (!models.length) {
    status.textContent = t("{name} is running but has no model yet. Run ollama pull llama3.2 in a terminal.", { name: servers[0].label });
    actions.append(button(t("Look again"), "btn", detect));
    return;
  }
  const names = [...new Set(servers.map((s) => s.label))].join(", ");
  status.textContent = tp("Found {name} with {n} model.", "Found {name} with {n} models.", models.length, { name: names });
  models.forEach(({ server, model }, i) => {
    const label = model.replace(/:latest$/, "");
    actions.append(button(t("Use {model}", { model: label }), i === 0 ? "btn btn-primary" : "btn", (e) => useLocal(server, model, e.currentTarget)));
  });
}

function button(text, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

async function useLocal(server, model, el) {
  busy = true;
  const label = el.textContent;
  el.disabled = true;
  el.textContent = t("Loading…"); // the first request loads the model, which can take a moment
  try {
    const data = { provider: "local", protocol: server.protocol, name: model.replace(/:latest$/, ""), baseUrl: server.url, model };
    if (server.protocol === "ollama") data.contextSize = DEFAULT_CONTEXT;
    done(await api.brains.save(data), data.name);
  } catch (err) {
    status.textContent = err.message;
    el.disabled = false;
    el.textContent = label;
  } finally {
    busy = false;
  }
}

// ----- Gemini -----
cloudForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = keyInput.value.trim();
  if (!key) return;
  cloudError.hidden = true;
  cloudSave.disabled = true;
  cloudSave.textContent = t("Checking the key…");
  try {
    done(await api.brains.save({ provider: "gemini", name: "Gemini", model: "", key }), "Gemini");
    keyInput.value = "";
  } catch (err) {
    cloudError.textContent = err.message;
    cloudError.hidden = false;
  } finally {
    cloudSave.disabled = false;
    cloudSave.textContent = t("Connect Gemini");
  }
});

// ----- Done, or later -----
function done(state, name) {
  brains = state.brains || [];
  // brains.js owns the list in Settings and the model menu: hand it the new state
  document.dispatchEvent(new CustomEvent("friends:brains-apply", { detail: state }));
  updateSettings((s) => ((s.onboarding ||= {}).done = true));
  flushSettings();
  reopened = false;
  sync();
  announce(t("{name} is ready. Say hello.", { name }));
  document.getElementById("composer-input").focus();
}

document.getElementById("onb-skip").addEventListener("click", () => {
  updateSettings((s) => ((s.onboarding ||= {}).done = true));
  reopened = false;
  sync();
  document.getElementById("composer-input").focus();
});

// The status line, or a message that found no AI, brings the guide back
export function openOnboarding() {
  reopened = true;
  sync();
  card.scrollIntoView({ block: "center" });
  (card.querySelector("#onb-local-actions .btn-primary") || keyInput).focus({ preventScroll: true });
}
export const onboardingShowing = () => !card.hidden;

chip.addEventListener("click", () => {
  if (!hasAI()) openOnboarding();
  else document.getElementById("model-picker").click();
});
document.addEventListener("friends:onboarding-open", openOnboarding);

document.addEventListener("friends:brains-changed", (e) => {
  brains = e.detail.brains || [];
  sync();
});
onSettings(sync);
