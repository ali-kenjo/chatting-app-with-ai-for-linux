// Talks to the Gemini API (https://ai.google.dev/api). Runs in the helper
// only, so API keys never reach the page.
// Tests can point this at a fake Gemini
const API = process.env.FRIENDS_GEMINI_API || "https://generativelanguage.googleapis.com/v1beta";
const logger = require("./logger");

class GeminiError extends Error {}

// Turn an API error response into a message a person can act on
async function toError(res) {
  let detail = "";
  let retryDelay = "";
  try {
    const data = await res.json();
    detail = data.error?.message || "";
    const retryInfo = data.error?.details?.find((d) => d["@type"]?.includes("RetryInfo"));
    if (retryInfo?.retryDelay) retryDelay = retryInfo.retryDelay;
  } catch {}
  // What Gemini itself said, for the terminal (the page gets a friendlier message)
  logger.warn(`Gemini ${res.status}: ${detail || res.statusText}`);

  if (res.status === 400 && /api key/i.test(detail)) return new GeminiError("Your Gemini API key isn't valid. Check it in Settings → AI & privacy.");
  if (res.status === 403) return new GeminiError("This API key isn't allowed to use Gemini. Check the key's permissions in Google AI Studio.");
  if (res.status === 404) {
    const err = new GeminiError(/no longer available/i.test(detail)
      ? "Google retired this model. Edit the AI in Settings → AI & privacy and pick a newer one."
      : "That model wasn't found. Pick another model in Settings → AI & privacy.");
    err.status = 404;
    return err;
  }
  if (res.status === 429) {
    const waitMsg = retryDelay ? ` (wait ${retryDelay} or switch models in Settings → AI & privacy)` : "";
    const err = new GeminiError(`Gemini free tier quota reached for this model${waitMsg}.`);
    err.status = 429;
    err.retryDelay = retryDelay;
    return err;
  }
  if (res.status >= 500) {
    // "High demand" on one model: another model usually answers (see withFallback)
    const err = new GeminiError("Gemini is having trouble right now. Try again in a moment.");
    err.status = res.status;
    err.overloaded = res.status === 503 || /high demand|overloaded|unavailable/i.test(detail);
    return err;
  }
  return new GeminiError(detail || `Gemini returned an error (${res.status}).`);
}

async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new GeminiError("Couldn't reach Gemini. Check your internet connection.");
  }
}

// Gemini sometimes answers 500 for a moment; such a request is tried once more
const RETRY_MS = Number(process.env.FRIENDS_GEMINI_RETRY_MS ?? 1000);

async function post(url, key, body, signal) {
  const send = () => request(url, {
    method: "POST",
    signal,
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let res = await send();
  // A hiccup (500) is tried once more; a busy model (503) isn't: another model answers sooner
  if (res.status === 500) {
    logger.warn(`Gemini ${res.status}, trying again`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    if (signal?.aborted) throw signal.reason;
    res = await send();
  }
  if (!res.ok) throw await toError(res);
  return res;
}

// Everything the models list says about this key's models
async function fetchModels(key) {
  const res = await request(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw await toError(res);
  const { models = [] } = await res.json();
  return models;
}

const namesFor = (models, method) =>
  models
    .filter((m) => m.supportedGenerationMethods?.includes(method))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((name) => name.startsWith("gemini"));

// All Gemini models this key can use, e.g. ["gemini-2.5-flash", ...]
async function listAllModels(key) {
  return namesFor(await fetchModels(key), "generateContent");
}

// Models for chatting (speech-only models are left out)
async function listModels(key) {
  return (await listAllModels(key)).filter((m) => !/tts|image|embedding/.test(m));
}

// The key's models, looked up once per 30 minutes; null if the lookup failed
const modelCache = new Map(); // key → { models, at }
async function cachedModels(key) {
  const cached = modelCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.models;
  try {
    const models = await listAllModels(key);
    modelCache.set(key, { models, at: Date.now() });
    return models;
  } catch {
    return null;
  }
}

// Fallback models when rate limits (429) or deprecated model (404) are hit
const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];

// For the small background jobs (follow-up chips, memories, summaries, the
// briefing): a light model, so they don't use up the main model's free quota
const TASK_MODEL = "gemini-flash-lite-latest";

// Models whose quota is used up, per key, until Gemini says they're back.
// They're skipped until then, so a reply doesn't wait for a request that fails.
const exhausted = new Map(); // key → Map(model → until, ms)

function retryMs(delay) {
  const seconds = parseFloat(String(delay || "").replace(/s$/, ""));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 24 * 60 * 60 * 1000) : 60 * 1000;
}

function markExhausted(key, model, retryDelay, ms = retryMs(retryDelay)) {
  if (!exhausted.has(key)) exhausted.set(key, new Map());
  exhausted.get(key).set(model, Date.now() + ms);
}

const isExhausted = (key, model) => (exhausted.get(key)?.get(model) || 0) > Date.now();

// "in about 6 hours" for the soonest model to come back
function backIn(key, models) {
  const soonest = Math.min(...models.map((m) => exhausted.get(key)?.get(m) || Infinity));
  if (!Number.isFinite(soonest)) return "";
  const minutes = Math.max(1, Math.round((soonest - Date.now()) / 60000));
  return minutes < 90 ? ` (back in about ${minutes} minute${minutes === 1 ? "" : "s"})` : ` (back in about ${Math.round(minutes / 60)} hours)`;
}

// Models that answered 404 (retired, or not offered to this key), per key.
// The models list can still name a retired model, so this is learned by trying;
// later requests skip it instead of paying for another failed round trip.
const unavailable = new Map(); // key → Set of model names

const canFallBack = (err) => err.status === 429 || err.status === 404 || err.overloaded === true || /quota|rate limit|not available|not found/i.test(err.message);

// Runs attempt(model) with the brain's model, then with the fallbacks the key
// has, until one works. An error with `final` set (e.g. after part of a reply
// was already shown) isn't retried with another model.
async function withFallback(key, model, attempt) {
  const skip = unavailable.get(key) || new Set();
  const candidates = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  let lastError = null;
  let available; // looked up only once a fallback is needed
  let tried = 0;

  for (const current of candidates) {
    if (skip.has(current) || isExhausted(key, current)) continue;
    if (current !== model) {
      if (available === undefined) available = await cachedModels(key);
      if (available && !available.includes(current)) continue;
    }
    tried++;
    try {
      return await attempt(current);
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError" || err.final || !canFallBack(err)) throw err;
      if (err.status === 404) unavailable.set(key, skip.add(current));
      if (err.status === 429) markExhausted(key, current, err.retryDelay);
      if (err.overloaded) markExhausted(key, current, null, 2 * 60 * 1000); // busy: rest it for a moment
      logger.warn(`Gemini model ${current} ${err.status === 404 ? "isn't available" : err.overloaded ? "is overloaded" : "hit a limit"}, trying the next one`);
    }
  }
  if (!tried || lastError?.status === 429 || lastError?.overloaded) {
    throw new GeminiError(`Every Gemini model your key can use is busy or out of free quota right now${backIn(key, candidates)}. Try again in a little while, add a local AI in Settings → AI & privacy, or turn on billing for your key in Google AI Studio for higher limits.`);
  }
  throw lastError || new GeminiError("Gemini's rate limit or quota was reached. Wait a moment and try again.");
}

// Checks that this exact model answers (no fallbacks), with a tiny request.
// The models list alone isn't enough: it still names retired models.
async function checkModel({ key, model }) {
  await post(`${API}/models/${encodeURIComponent(model)}:generateContent`, key, {
    contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    generationConfig: { ...generationConfig(model, { fast: true }), maxOutputTokens: 16 },
  });
}

// Models think before answering, which can take seconds. For quick replies
// (voice, "Fast") they think as little as they allow: 2.5 Flash not at all,
// Gemini 3.x at "low" (the lowest level every 3.x model accepts). Other
// models keep their defaults, since not all of them accept these settings.
function generationConfig(model, { temperature, fast } = {}) {
  const config = {};
  if (temperature !== undefined) config.temperature = temperature;
  if (fast && /^gemini-2\.5-flash/.test(model)) config.thinkingConfig = { thinkingBudget: 0 };
  else if (fast && /^gemini-3/.test(model)) config.thinkingConfig = { thinkingLevel: "low" };
  return Object.keys(config).length ? config : undefined;
}

// One reply as plain text, without streaming or tools (e.g. for summaries)
async function generateText({ key, model, system, prompt, temperature = 0.3, signal }) {
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return withFallback(key, model, async (current) => {
    const config = generationConfig(current, { temperature, fast: true });
    const res = await post(`${API}/models/${encodeURIComponent(current)}:generateContent`, key, config ? { ...body, generationConfig: config } : body, signal);
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => (p.thought ? "" : p.text || "")).join("").trim();
  });
}

// Gemini Live models (real-time voice), best first. Only the ones the key has
// when its models list names any; otherwise the known ones are tried in turn.
const LIVE_MODELS = ["gemini-3.8-live", "gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-preview-12-2025"];
const liveCache = new Map(); // key → { models, at }

async function liveModels(key) {
  const cached = liveCache.get(key);
  // Ones whose quota is used up go last (they're tried only if nothing else works)
  const order = (list) => [...list.filter((m) => !isExhausted(key, m)), ...list.filter((m) => isExhausted(key, m))];
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return order(cached.models);
  let available = [];
  try {
    available = namesFor(await fetchModels(key), "bidiGenerateContent");
  } catch {}
  // Extended-thinking models answer slower, which spoils a conversation; the
  // transcribe, translate and robotics ones can't hold a conversation at all
  const extra = available.filter((m) => !LIVE_MODELS.includes(m) && !/thinking|transcribe|translate|robotics/.test(m));
  const models = available.length ? [...LIVE_MODELS.filter((m) => available.includes(m)), ...extra] : [...LIVE_MODELS];
  if (!models.length) models.push(...LIVE_MODELS);
  liveCache.set(key, { models, at: Date.now() });
  return order(models);
}

// Live models that take function calls without pausing their speech: calls
// declared "behavior": "NON_BLOCKING" and answered with "scheduling": "SILENT"
// (https://ai.google.dev/gemini-api/docs/live-api/tools). Gemini 3.8 Live does
// this by default. gemini-3.1-flash-live-preview only calls functions
// synchronously ("the model will not start responding until you've sent the
// tool response"), so a call there would put a pause into what it says.
const ASYNC_LIVE_TOOLS = /^(gemini-3\.8-live|gemini-2\.5-flash-native-audio|gemini-live-2\.5-flash|gemini-2\.5-flash-live)/;
const liveAsyncTools = (model) => ASYNC_LIVE_TOOLS.test(String(model || ""));

// The Live model that worked last is tried first next time
function preferLiveModel(key, model) {
  const cached = liveCache.get(key);
  if (cached) cached.models = [model, ...cached.models.filter((m) => m !== model)];
}

// Read a streamed reply ("data: {json}" lines). Returns every part the model
// sent, in order, so they can be sent back unchanged when it calls a tool.
async function readStream(res, onText) {
  const decoder = new TextDecoder();
  const parts = [];
  let buffer = "";
  let blocked = false;

  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    let chunk;
    try {
      chunk = JSON.parse(line.slice(5));
    } catch {
      return; // a damaged event shouldn't throw away the rest of the reply
    }
    const candidate = chunk.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      parts.push(part);
      if (part.text && !part.thought) onText(part.text);
    }
    if (chunk.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") blocked = true;
  };

  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handle);
  }
  // The last event may arrive without a final newline
  buffer += decoder.decode();
  if (buffer) handle(buffer);
  if (blocked) throw new GeminiError("Gemini stopped this reply because of its safety filters.");
  return parts;
}

// Streams a reply. `contents` are Gemini messages ({ role, parts }).
// When the model calls a tool, runTool(name, args) is awaited and its result
// sent back, until the model answers with text (at most 8 rounds). Rounds in
// which it only called isFreeTool() tools (the robot's) don't count; up to 4
// of those are allowed on top, so it can't go round in circles.
async function streamChat({ key, model, contents, system, temperature, fast = false, tools = [], runTool, isFreeTool = () => false, signal, onText }) {
  return withFallback(key, model, async (currentModel) => {
    const url = `${API}/models/${encodeURIComponent(currentModel)}:streamGenerateContent?alt=sse`;
    const history = [...contents];
    let streamedAnyText = false;
    let ranTool = false;

    try {
      let rounds = 0;
      let freeRounds = 0;
      let free = false; // the last round only had free tools
      for (;;) {
        if (free ? ++freeRounds > 4 : ++rounds > 8) return;
        const body = { contents: history };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        const config = generationConfig(currentModel, { temperature, fast });
        if (config) body.generationConfig = config;
        if (tools.length) body.tools = [{ functionDeclarations: tools }];

        const parts = await readStream(await post(url, key, body, signal), (piece) => {
          streamedAnyText = true;
          onText(piece);
        });
        const calls = parts.filter((p) => p.functionCall);
        if (!calls.length) return;

        history.push({ role: "model", parts });
        const responses = [];
        for (const { functionCall } of calls) {
          ranTool = true;
          const result = await runTool(functionCall.name, functionCall.args || {});
          const response = { name: functionCall.name, response: result };
          if (functionCall.id) response.id = functionCall.id;
          responses.push({ functionResponse: response });
        }
        history.push({ role: "user", parts: responses });
        free = calls.every(({ functionCall }) => isFreeTool(functionCall.name));
      }
    } catch (err) {
      // Part of the reply is already on screen, or a tool already ran (an email
      // sent, a file changed): another model must not start over and repeat it
      if (streamedAnyText || ranTool) err.final = true;
      throw err;
    }
  });
}

// Speech to text: the words in a short recording (WAV, base64)
async function transcribe({ key, model, audio }) {
  return withFallback(key, model, async (current) => {
    const res = await post(`${API}/models/${encodeURIComponent(current)}:generateContent`, key, {
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: "audio/wav", data: audio } },
          { text: "Transcribe this recording exactly as spoken, in the language spoken. Reply with only the transcript. If nothing intelligible is said, reply with nothing." },
        ],
      }],
      generationConfig: generationConfig(current, { temperature: 0, fast: true }),
    });
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => (p.thought ? "" : p.text || "")).join("").trim();
  });
}

// Prioritized TTS models with fallbacks when one model hits rate limits
const TTS_FALLBACKS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-3.8-flash-lite-tts",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-tts",
];

// Voice mode speaks sentence by sentence, so the model list is looked up once
// (per key, for 30 minutes) instead of before every sentence, and the model
// that worked last is tried first.
const ttsCache = new Map(); // key → { models, at }
const TTS_CACHE_MS = 30 * 60 * 1000;
let lastTtsModel = null;

async function getTtsCandidates(key) {
  const cached = ttsCache.get(key);
  let models = cached && Date.now() - cached.at < TTS_CACHE_MS ? cached.models : null;
  if (!models) {
    try {
      const all = (await listAllModels(key)).filter((m) => m.includes("tts"));
      const set = new Set(all);
      models = TTS_FALLBACKS.filter((m) => set.has(m));
      all.forEach((m) => { if (!models.includes(m)) models.push(m); });
      if (!models.length) models = TTS_FALLBACKS;
      ttsCache.set(key, { models, at: Date.now() });
    } catch {
      return TTS_FALLBACKS;
    }
  }
  return lastTtsModel && models.includes(lastTtsModel) ? [lastTtsModel, ...models.filter((m) => m !== lastTtsModel)] : models;
}

// 16-bit mono PCM → a playable WAV file
function pcmToWav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Text to speech with one of Gemini's voices. Returns a WAV Buffer.
async function speak({ key, text, voice }) {
  const candidates = await getTtsCandidates(key);
  if (!candidates.length) throw new GeminiError("NO_TTS");

  let lastErr = null;
  for (const model of candidates) {
    if (isExhausted(key, model)) continue;
    try {
      const res = await post(`${API}/models/${encodeURIComponent(model)}:generateContent`, key, {
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });
      const data = await res.json();
      const audio = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!audio) throw new GeminiError("Gemini didn't return any audio.");
      lastTtsModel = model;
      const bytes = Buffer.from(audio.data, "base64");
      if (/wav/i.test(audio.mimeType)) return bytes;
      const rate = Number(audio.mimeType.match(/rate=(\d+)/)?.[1]) || 24000;
      return pcmToWav(bytes, rate);
    } catch (err) {
      lastErr = err;
      if (err.status === 429 || err.status === 404 || /quota|rate limit|not found/i.test(err.message)) {
        if (err.status === 429) markExhausted(key, model, err.retryDelay);
        logger.warn(`Gemini TTS model ${model} returned ${err.status || err.message}, trying the next one`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new GeminiError("Voice speech unavailable right now.");
}

// A web search through Google Search grounding: an answer written from the
// results, with the pages it used (web_search, for chats that aren't Live)
async function searchWeb({ key, model, query, signal }) {
  return withFallback(key, model, async (current) => {
    const config = generationConfig(current, { temperature: 0.2, fast: true });
    const body = {
      contents: [{ role: "user", parts: [{ text: `Search the web and answer with the facts, dates and numbers that matter, briefly: ${query}` }] }],
      tools: [{ google_search: {} }],
      ...(config ? { generationConfig: config } : {}),
    };
    const res = await post(`${API}/models/${encodeURIComponent(current)}:generateContent`, key, body, signal);
    const data = await res.json();
    const candidate = data.candidates?.[0];
    const answer = (candidate?.content?.parts || []).map((p) => (p.thought ? "" : p.text || "")).join("").trim();
    const sources = (candidate?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean).slice(0, 8).map((w) => ({ title: w.title, url: w.uri }));
    return { answer, sources };
  });
}

module.exports = { GeminiError, TASK_MODEL, markExhausted, isExhausted, searchWeb, listModels, checkModel, streamChat, transcribe, speak, generateText, liveModels, preferLiveModel, liveAsyncTools, LIVE_MODELS };
