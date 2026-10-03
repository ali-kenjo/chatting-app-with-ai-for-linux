// Which AI answers a message: a local one (on this computer), a cloud one
// (Gemini), or both, by the mode in Settings → AI control.
//
//   fixed    the one brain chosen in the model menu (no routing)
//   local    only a local AI
//   cloud    only a cloud AI
//   auto     by what the message needs: local by default, the cloud for what a
//            local model is bad at (a PDF, a very long chat, a hard question)
//   dynamic  auto, and it also reacts to how things are going: a local AI that is
//            slow, failing or sends an empty reply is replaced by the cloud for a
//            while, a cloud that is down by the local one
//   fastest  asks both at once; whichever starts answering first wins
//
// Private mode turns every mode into "local". In the modes that choose by
// themselves, the cloud is only used after you agree (Settings: "Ask before
// using the cloud"). Whatever happens, an answer that has started is never
// repeated by another AI, and no tool runs twice.
//
// plan() decides, execute() runs the plan. Both are free of HTTP and files, so
// they're tested alone (test/router.test.js); server.js supplies the AI calls.

class RouteError extends Error {}

const SLOW_COOLDOWN_MS = 10 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 3 * 60 * 1000;

const KIND_NAME = { local: "local AI", cloud: "cloud AI" };

// ---------- How the AIs have been doing (Dynamic mode) ----------
const penalty = { local: 0, cloud: 0 }; // until when a kind is avoided

const penalize = (kind, ms, now = Date.now()) => (penalty[kind] = now + ms);
const penalized = (kind, now = Date.now()) => penalty[kind] > now;
const forgive = (kind) => (penalty[kind] = 0);
const resetHealth = () => {
  penalty.local = 0;
  penalty.cloud = 0;
};

// ---------- What a message needs ----------
// Models that read images (a name is all there is to go by for most servers)
const VISION = /vision|llava|bakllava|moondream|minicpm-v|pixtral|gemma3|qwen\d*(\.\d+)?-?vl|internvl|granite3\.2-vision|mistral-small3\.\d|llama4/i;

const estimateTokens = (text) => Math.ceil(String(text || "").length / 3.5);

// The reason a message should go to the cloud, or null when a local AI can take it.
// `local` is the local brain that would answer (its context size is known for Ollama).
function cloudReason({ text = "", attachments = [], messages = [], settings, local }) {
  const rules = settings.routing.auto;
  if (rules.attachments) {
    const pdf = attachments.find((a) => a.mime === "application/pdf");
    if (pdf) return `${pdf.name} is a PDF, which local models can't read`;
    const image = attachments.find((a) => String(a.mime).startsWith("image/"));
    if (image && !(local && VISION.test(local.model))) return "This has a picture, and the local model can't see pictures";
  }
  if (rules.longChats) {
    const window = settings.aiControl?.contextWindow || 20;
    const recent = messages.slice(-window).reduce((sum, m) => sum + estimateTokens(m.text), 0);
    const context = local?.contextSize || (local?.protocol === "ollama" ? 4096 : 8192);
    if (recent + estimateTokens(text) + 2500 > context * 0.7) return "The chat is too long for the local model's memory";
  }
  if (rules.hardQuestions) {
    let score = 0;
    if (text.length > 800) score++;
    if (text.length > 2000) score++;
    if (/```/.test(text) && text.length > 400) score++;
    if (/\b(prove|derive|step[- ]by[- ]step|refactor|optimi[sz]e|architecture|trade-?offs?|write (me )?(a|an) (program|script|essay|report|article|story|chapter)|analy[sz]e|in depth|in detail|beweise|schritt für schritt|ausführlich|analysiere)\b/i.test(text)) score++;
    if ((text.match(/\n\s*(\d+[.)]|[-*])\s+\S/g) || []).length >= 4) score++;
    if (settings.aiControl?.reasoningEffort === "deep") score++; // "Deep" thinking is slow on a small local model
    if (score >= 2) return "This looks like a hard one, so the cloud AI takes it";
  }
  return null;
}

// ---------- Deciding ----------
// input: { mode, settings, text, attachments, messages, voice, force, preferId, deps }
//   deps: { has(kind), byKind(kind, preferId), chosen(preferId), privateMode }
// Returns { mode, steps: [{ kind, brain, reason }], race, escalate, askCloud }
function plan(input) {
  const { settings, text = "", attachments = [], messages = [], voice = false, force = null, preferId = null, deps, now = Date.now() } = input;
  const mode = deps.privateMode ? "local" : force ? "force" : input.mode || settings.routing.mode;
  const base = { mode, race: false, escalate: false, askCloud: false };
  const step = (kind, reason, brain = deps.byKind(kind, preferId)) => ({ kind, reason, brain });
  const need = (kind, how) => {
    const brain = deps.byKind(kind, preferId);
    if (!brain) {
      throw new RouteError(
        kind === "local"
          ? deps.privateMode
            ? "Private mode is on, so only a local AI can answer. Add one in Settings → AI control."
            : `${how} needs a local AI. Add one in Settings → AI control.`
          : `${how} needs a cloud AI (Gemini). Add one in Settings → AI control.`
      );
    }
    return step(kind, "", brain);
  };

  if (mode === "force") {
    const s = need(force, force === "cloud" ? "Asking the cloud AI" : "Asking the local AI");
    return { ...base, steps: [{ ...s, reason: force === "cloud" ? "You asked the cloud AI" : "You asked the local AI" }] };
  }

  if (mode === "fixed") {
    const chosen = deps.chosen(preferId);
    if (!chosen) return { ...base, steps: [] };
    return { ...base, steps: [{ kind: chosen.kind, brain: chosen, reason: "The brain you chose" }] };
  }

  if (mode === "local") {
    const s = need("local", "Local only");
    return { ...base, steps: [{ ...s, reason: deps.privateMode ? "Private mode" : "Local only" }] };
  }
  if (mode === "cloud") {
    const s = need("cloud", "Cloud only");
    return { ...base, steps: [{ ...s, reason: "Cloud only" }] };
  }

  // auto, dynamic, fastest: both kinds may be used
  const local = deps.has("local") ? deps.byKind("local", preferId) : null;
  const cloud = deps.has("cloud") ? deps.byKind("cloud", preferId) : null;
  if (!local && !cloud) return { ...base, steps: [] };
  const ask = settings.routing.askBeforeCloud;
  const askCloud = ask === "never" ? false : ask;
  const onlyOne = local ? { kind: "local", brain: local, reason: "Your only AI" } : { kind: "cloud", brain: cloud, reason: "Your only AI" };
  if (!local || !cloud) return { ...base, steps: [onlyOne] };

  const localStep = (reason) => ({ kind: "local", brain: local, reason });
  const cloudStep = (reason) => ({ kind: "cloud", brain: cloud, reason });

  if (mode === "fastest") {
    return { ...base, race: true, askCloud, steps: [localStep("Racing both"), cloudStep("Racing both")] };
  }

  const wantsCloud = cloudReason({ text, attachments, messages, settings, local });
  const dynamic = mode === "dynamic";
  const slow = dynamic && settings.routing.dynamic.escalate;
  const flags = { ...base, askCloud, escalate: slow };

  if (wantsCloud) return { ...flags, steps: [cloudStep(wantsCloud), localStep("The cloud AI wasn't available")] };
  if (dynamic && penalized("local", now) && !penalized("cloud", now)) {
    return { ...flags, steps: [cloudStep("The local AI was slow or failing a moment ago"), localStep("Back to the local AI")] };
  }
  if (dynamic && penalized("cloud", now) && !penalized("local", now)) {
    return { ...flags, steps: [localStep("The cloud AI had trouble a moment ago")] };
  }
  const why = voice && settings.routing.auto.voiceLocal ? "Voice answers stay local, for speed" : "Short enough for the local AI";
  return { ...flags, steps: [localStep(why), cloudStep(dynamic ? "The local AI didn't manage" : "The local AI failed")] };
}

// ---------- Running a plan ----------
// io: {
//   run(step, { signal, started }) → Promise   the AI call. It must call started() before anything
//                                    visible happens (text, a tool) and stop when it returns false.
//   confirmCloud(step) → Promise<boolean>      asks you before the cloud gets the message
//   cloudAllowed() / allowCloud()              "once per chat" memory
//   emit(event)                                {type:"route", ...} for the page
//   signal                                     the request's (stop button)
//   slowMs                                     Dynamic: give up on a silent local AI after this long
// }
// Resolves { step, ttftMs }; rejects with the error to show.
async function execute(plan, io) {
  if (!plan.steps.length) throw new RouteError("NO_BRAIN");
  const errors = [];
  const describe = (step) => ({ type: "route", mode: plan.mode, kind: step.kind, brainId: step.brain.id, name: step.brain.name, model: step.brain.model, reason: step.reason });

  async function mayUse(step) {
    if (step.kind !== "cloud" || !plan.askCloud) return true;
    if (plan.askCloud === "chat" && io.cloudAllowed()) return true;
    if (!(await io.confirmCloud(step))) return false;
    if (plan.askCloud === "chat") io.allowCloud();
    return true;
  }

  // One AI call. `claim(step)` is for races: the first to start wins.
  async function attempt(step, { hasNext, claim, register }) {
    const ctl = new AbortController();
    register?.(ctl);
    const stop = () => ctl.abort();
    io.signal?.addEventListener("abort", stop, { once: true });
    const t0 = Date.now();
    let visible = false;
    let ttftMs = 0;
    let slow = false;
    let timer = null;
    const started = () => {
      if (ctl.signal.aborted) return false;
      if (claim && !claim(step)) return false;
      if (!visible) {
        visible = true;
        ttftMs = Date.now() - t0;
        clearTimeout(timer);
      }
      return true;
    };
    if (plan.escalate && step.kind === "local" && hasNext && io.slowMs) {
      timer = setTimeout(() => {
        if (!visible) {
          slow = true;
          ctl.abort();
        }
      }, io.slowMs);
    }
    try {
      await io.run(step, { signal: ctl.signal, started });
      return { ok: true, visible, step, ttftMs };
    } catch (err) {
      return { ok: false, visible, slow, err, step, lost: ctl.signal.aborted && !slow && !io.signal?.aborted };
    } finally {
      clearTimeout(timer);
      io.signal?.removeEventListener("abort", stop);
    }
  }

  const note = (step, result) => {
    if (result.ok && result.visible) {
      forgive(step.kind);
      return;
    }
    if (result.slow) penalize(step.kind, SLOW_COOLDOWN_MS);
    else penalize(step.kind, FAILURE_COOLDOWN_MS);
    errors.push(
      result.slow
        ? `The ${KIND_NAME[step.kind]} didn't answer in time.`
        : result.ok
          ? `The ${KIND_NAME[step.kind]} sent an empty reply.`
          : `${plan.steps.length > 1 ? `The ${KIND_NAME[step.kind]}: ` : ""}${result.err?.message || "It failed."}`
    );
  };

  const fail = () => {
    throw new Error(errors.length > 1 ? errors.join(" ") : errors[0] || "No AI could answer.");
  };

  if (plan.race && plan.steps.length === 2) {
    const [local, cloud] = plan.steps;
    // Asking first: if you keep it local, only the local AI answers
    if (!(await mayUse(cloud))) {
      io.emit(describe({ ...local, reason: "You kept it local" }));
      const r = await attempt(local, { hasNext: false });
      if (r.ok && r.visible) return { step: local, ttftMs: r.ttftMs };
      if (io.signal?.aborted) throw r.err;
      note(local, r);
      fail();
    }
    io.emit({ ...describe(local), reason: "Asking both; the first to answer wins" });
    let winner = null;
    const controllers = new Map();
    const claim = (step) => {
      if (winner && winner !== step) return false;
      if (!winner) {
        winner = step;
        for (const [other, ctl] of controllers) if (other !== step) ctl.abort();
        io.emit(describe({ ...step, reason: `${step.kind === "local" ? "The local" : "The cloud"} AI answered first` }));
      }
      return true;
    };
    const results = await Promise.all(plan.steps.map((step) => attempt(step, { claim, register: (ctl) => controllers.set(step, ctl) })));
    const won = results.find((r) => r.step === winner);
    if (won?.ok && won.visible) {
      forgive(won.step.kind);
      return { step: won.step, ttftMs: won.ttftMs };
    }
    if (won) throw won.err; // it had started: nothing else can take over
    if (io.signal?.aborted) throw results[0].err;
    results.forEach((r) => note(r.step, r));
    fail();
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!(await mayUse(step))) {
      errors.push("You chose not to send this to the cloud.");
      continue;
    }
    io.emit(describe(step));
    const r = await attempt(step, { hasNext: i < plan.steps.length - 1 });
    if (r.ok && r.visible) {
      forgive(step.kind);
      return { step, ttftMs: r.ttftMs };
    }
    if (io.signal?.aborted) throw r.err || new Error("Stopped.");
    if (r.visible) throw r.err; // part of the answer is on screen: another AI can't continue it
    note(step, r);
  }
  fail();
}

module.exports = { plan, execute, cloudReason, RouteError, penalized, penalize, forgive, resetHealth, estimateTokens, VISION };
