// Local AI models, and anything else that speaks the OpenAI-compatible API:
// Ollama, LM Studio, llama.cpp (llama-server), vLLM, Jan, LocalAI, KoboldCpp,
// text-generation-webui... (open or closed source, on this computer, on your
// network, or anywhere you point it at). It offers the same functions as
// gemini.js, so the rest of the helper doesn't care which one answers.
//
// create({ baseUrl, speechUrl, speechModel }) → { listModels, checkModel,
//   streamChat, generateText, transcribe, speak }
// The API key is optional (most local servers have none) and is only ever
// sent to this brain's own address.
const logger = require("./logger");
const voice = require("./voice");

class LocalAiError extends Error {}

// Models in the list that can't chat
const NOT_CHAT = /embed|rerank|whisper|tts|stt|bge-|nomic-bert/i;

// ---------- Messages ----------
// Gemini-shaped contents ({ role, parts }) → OpenAI messages. Same-role
// neighbours are merged, since some chat templates insist on alternation.
function toMessages(contents, system) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  for (const { role, parts = [] } of contents) {
    const content = [];
    for (const part of parts) {
      if (part.text) content.push({ type: "text", text: part.text });
      else if (part.inlineData?.mimeType?.startsWith("image/")) {
        content.push({ type: "image_url", image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } });
      } else if (part.inlineData) {
        content.push({ type: "text", text: `[An attached ${part.inlineData.mimeType} file that this model can't read]` });
      }
    }
    if (!content.length) continue;
    const mapped = role === "model" ? "assistant" : "user";
    const last = messages.at(-1);
    if (last && last.role === mapped && mapped !== "system") {
      last.content = [...asParts(last.content), ...content];
    } else {
      messages.push({ role: mapped, content });
    }
  }
  // Plain text stays a string: every server takes that, not every one takes parts
  for (const m of messages) {
    if (Array.isArray(m.content) && m.content.every((c) => c.type === "text")) m.content = m.content.map((c) => c.text).join("\n\n");
  }
  return messages;
}

const asParts = (content) => (Array.isArray(content) ? content : [{ type: "text", text: content }]);

// Gemini tool declarations ("type": "STRING") → OpenAI tools
function lowerTypes(schema) {
  if (Array.isArray(schema)) return schema.map(lowerTypes);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) out[key] = key === "type" && typeof value === "string" ? value.toLowerCase() : lowerTypes(value);
  return out;
}

const toTools = (declarations) =>
  declarations.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: lowerTypes(d.parameters) } }));

// ---------- Reasoning models ----------
// Some models write their thinking as <think>…</think> inside the reply. It
// isn't part of the answer, so it's dropped as it streams.
class ThinkFilter {
  constructor() {
    this.buffer = "";
    this.thinking = false;
    this.emitted = false; // some text was already shown
  }

  // The longest ending of `text` that could still become `tag`
  static partial(text, tag) {
    for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) if (tag.startsWith(text.slice(-n))) return n;
    return 0;
  }

  push(piece) {
    this.buffer += piece;
    let out = "";
    for (;;) {
      if (this.thinking) {
        const end = this.buffer.indexOf("</think>");
        if (end < 0) {
          this.buffer = this.buffer.slice(this.buffer.length - ThinkFilter.partial(this.buffer, "</think>"));
          return this.show(out);
        }
        this.buffer = this.buffer.slice(end + 8);
        if (!this.emitted && !out) this.buffer = this.buffer.replace(/^\s+/, ""); // the blank line after leading thoughts
        this.thinking = false;
      } else {
        const start = this.buffer.indexOf("<think>");
        if (start >= 0) {
          out += this.buffer.slice(0, start);
          this.buffer = this.buffer.slice(start + 7);
          this.thinking = true;
          continue;
        }
        const keep = ThinkFilter.partial(this.buffer, "<think>");
        out += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return this.show(out);
      }
    }
  }

  show(text) {
    if (text) this.emitted = true;
    return text;
  }

  flush() {
    const rest = this.thinking ? "" : this.buffer;
    this.buffer = "";
    return this.show(rest);
  }
}

const stripThinking = (text) => {
  const filter = new ThinkFilter();
  return (filter.push(text) + filter.flush()).trim();
};

// ---------- The connection ----------
function create({ baseUrl, speechUrl = "", speechModel = "" } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const speechBase = String(speechUrl || "").replace(/\/+$/, "");
  const where = base.replace(/^https?:\/\//, "").replace(/\/v1$/, "");
  const noTools = new Set(); // models that said they can't take tools: not asked again

  const headers = (key, extra = {}) => ({ ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra });

  async function toError(res, model) {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        detail = data.error?.message || data.error || data.message || "";
        if (typeof detail !== "string") detail = JSON.stringify(detail);
      } catch {
        detail = text.slice(0, 300);
      }
    } catch {}
    logger.warn(`Local AI ${where} answered ${res.status}: ${detail || res.statusText}`);
    let err;
    if (res.status === 401 || res.status === 403) err = new LocalAiError("This AI server wants an API key, or didn't accept yours. Check it in Settings → AI control.");
    else if (res.status === 404 || /model .*(not found|does not exist)|not found, try pulling/i.test(detail)) {
      err = new LocalAiError(`The model "${model || ""}" isn't available on this AI server. ${/ollama|11434/i.test(where + detail) ? `Get it with: ollama pull ${model || "<model>"}` : "Load it in the server, or pick another model in Settings → AI control."}`);
    } else if (/context|too long|too many tokens|exceeds/i.test(detail)) err = new LocalAiError("The conversation doesn't fit into the model's context window. Start a new chat, lower the context window in Settings → AI control, or raise the context size in your AI server.");
    else if (res.status >= 500) err = new LocalAiError(`The AI server had a problem: ${detail || res.status}`);
    else err = new LocalAiError(detail || `The AI server returned an error (${res.status}).`);
    err.status = res.status;
    err.detail = detail;
    return err;
  }

  async function request(url, options, model) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (err.name === "TimeoutError") throw new LocalAiError(`The AI server at ${where} didn't answer in time.`);
      throw new LocalAiError(`Couldn't reach the AI server at ${where}. Is it running?`);
    }
    if (!res.ok) throw await toError(res, model);
    return res;
  }

  const post = (path, key, body, signal, model) =>
    request(`${base}${path}`, { method: "POST", signal, headers: headers(key, { "Content-Type": "application/json" }), body: JSON.stringify(body) }, model);

  // A server that can't take tools (the model says so) gets the request again without them
  async function postChat(key, body, signal) {
    try {
      return await post("/chat/completions", key, body, signal, body.model);
    } catch (err) {
      if (body.tools && err.status === 400 && /tool|function/i.test(err.detail || "")) {
        logger.warn(`${body.model} can't use tools; chatting without them`);
        noTools.add(body.model);
        const { tools, ...rest } = body;
        return post("/chat/completions", key, rest, signal, body.model);
      }
      throw err;
    }
  }

  async function listModels(key) {
    const res = await request(`${base}/models`, { headers: headers(key), signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.data || data.models || [];
    return items.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter((id) => typeof id === "string" && id && !NOT_CHAT.test(id));
  }

  // A tiny real request, so a model that's listed but can't load is noticed
  async function checkModel({ key, model }) {
    await postChat(key, { model, messages: [{ role: "user", content: "Hi" }], max_tokens: 8, stream: false });
  }

  async function generateText({ key, model, system, prompt, temperature = 0.3, signal }) {
    const messages = toMessages([{ role: "user", parts: [{ text: prompt }] }], system);
    const res = await postChat(key, { model, messages, temperature, stream: false }, signal);
    const data = await res.json();
    return stripThinking(String(data.choices?.[0]?.message?.content || ""));
  }

  // Server-sent events: "data: {json}" lines, ended by "data: [DONE]". Returns
  // the tool calls the model made (if any) after streaming its text to onText.
  async function readStream(res, onText) {
    const decoder = new TextDecoder();
    const think = new ThinkFilter();
    const calls = [];
    let buffer = "";

    const handle = (line) => {
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        return;
      }
      if (chunk.error) throw new LocalAiError(chunk.error.message || String(chunk.error));
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.content === "string" && delta.content) {
        const visible = think.push(delta.content);
        if (visible) onText(visible);
      }
      for (const call of delta.tool_calls || []) {
        const at = call.index ?? calls.length;
        const slot = (calls[at] ||= { id: "", name: "", arguments: "" });
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.arguments += call.function.arguments;
      }
    };

    for await (const bytes of res.body) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      lines.forEach(handle);
    }
    buffer += decoder.decode();
    if (buffer) handle(buffer);
    const rest = think.flush();
    if (rest) onText(rest);
    return calls.filter((c) => c && c.name);
  }

  // Streams a reply and runs tool calls, like gemini.streamChat: at most 8
  // rounds, plus up to 4 in which only free tools (the robot's) were called.
  async function streamChat({ key, model, contents, system, temperature, tools = [], runTool, isFreeTool = () => false, signal, onText }) {
    const messages = toMessages(contents, system);
    let rounds = 0;
    let freeRounds = 0;
    let free = false;
    for (;;) {
      if (free ? ++freeRounds > 4 : ++rounds > 8) return;
      const body = { model, messages, stream: true };
      if (temperature !== undefined) body.temperature = temperature;
      if (tools.length && !noTools.has(model)) body.tools = toTools(tools);

      const calls = await readStream(await postChat(key, body, signal), onText);
      if (!calls.length) return;

      const withIds = calls.map((c, i) => ({ ...c, id: c.id || `call_${rounds}_${freeRounds}_${i}` }));
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: withIds.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
      });
      for (const call of withIds) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}") || {};
          // Small models fill optional parameters with null or "null"; that means "not given"
          for (const [k, v] of Object.entries(args)) if (v === null || typeof v === "string" && /^(null|none|undefined|n\/a)$/i.test(v.trim())) delete args[k];
        } catch {}
        const result = await runTool(call.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      free = withIds.every((c) => isFreeTool(c.name));
    }
  }

  // Where speech goes: a speech server set for this brain (Voice in its settings),
  // else Friends' own local voice (see voice.js) when it's installed
  async function speechTarget() {
    if (speechBase) return { base: speechBase, own: false };
    const own = await voice.ensure();
    return own ? { base: own, own: true } : null;
  }

  const NO_VOICE = "Listening needs local voice. Set it up in Settings → AI control (Local voice), or fill in a speech server under Voice in this brain's settings. You can also use a Gemini brain for voice.";

  // Speech to text: POST /audio/transcriptions, as OpenAI, LocalAI, speaches and Whisper servers offer it
  async function transcribe({ key, audio }) {
    const target = await speechTarget();
    if (!target) throw new LocalAiError(NO_VOICE);
    const form = new FormData();
    form.append("file", new Blob([Buffer.from(audio, "base64")], { type: "audio/wav" }), "speech.wav");
    form.append("model", speechModel || (target.own ? "whisper" : "whisper-1"));
    form.append("response_format", "json");
    const res = await request(`${target.base}/audio/transcriptions`, { method: "POST", headers: headers(key), body: form }, speechModel);
    const data = await res.json().catch(() => ({}));
    return String(data.text || "").trim();
  }

  // Text to speech, with Friends' own local voice. Without it the page uses
  // your browser's own voice, which is local too.
  async function speak({ text, voice: wanted } = {}) {
    const own = speechBase ? null : await voice.ensure();
    if (!own) throw new LocalAiError("NO_TTS");
    const res = await request(`${own}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice: wanted === "Charon" ? "male" : "female" }),
    });
    return Buffer.from(await res.arrayBuffer());
  }

  return { name: "local", listModels, checkModel, generateText, streamChat, transcribe, speak };
}

// "http://localhost:11434" → "http://localhost:11434/v1" (what most servers expect)
// For Ollama's own API (protocol "ollama") the address has no /v1: "http://localhost:11434"
function normalizeUrl(value, { required = true, protocol = "openai" } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) throw new Error("Enter the address of your AI server, e.g. http://127.0.0.1:11434/v1");
    return "";
  }
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new Error(`"${text}" isn't a valid address.`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The address must start with http:// or https://");
  if (url.username || url.password) throw new Error("Put the API key in the key field, not in the address.");
  let pathname = url.pathname.replace(/\/+$/, "");
  if (protocol === "ollama") return `${url.origin}${pathname.replace(/\/(v1|api)$/, "")}`;
  if (!pathname) pathname = "/v1";
  return `${url.origin}${pathname}`;
}

module.exports = { create, normalizeUrl, toMessages, toTools, ThinkFilter, stripThinking, LocalAiError };
