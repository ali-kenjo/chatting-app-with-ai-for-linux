// Ollama through its own API (/api/chat), which unlike the OpenAI-style one
// lets Friends set the context size and how long a model stays loaded. (Ollama
// answers OpenAI-style requests with a 4096-token context whatever they say,
// which cuts long chats off.) Same functions as openai.js, so the rest of the
// helper doesn't care which one answers.
const logger = require("./logger");
const { toMessages, toTools, ThinkFilter, stripThinking, LocalAiError, create: createOpenAi } = require("./openai");

const NOT_CHAT = /embed|rerank|whisper|tts|bge-|nomic-bert/i;

// OpenAI-style messages → Ollama's: images move to an "images" list of base64 strings
function toOllamaMessages(contents, system) {
  return toMessages(contents, system).map((m) => {
    if (!Array.isArray(m.content)) return m;
    const images = m.content.filter((c) => c.type === "image_url").map((c) => c.image_url.url.replace(/^data:[^,]*,/, ""));
    const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("\n\n");
    return images.length ? { role: m.role, content: text, images } : { role: m.role, content: text };
  });
}

// options: contextSize (tokens, 0 = Ollama's own default), keepAlive (minutes, 0 = Ollama's default)
function create({ baseUrl, contextSize = 0, keepAlive = 0, speechUrl = "", speechModel = "" } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const where = base.replace(/^https?:\/\//, "");
  const noTools = new Set();
  const speech = createOpenAi({ baseUrl: "", speechUrl, speechModel });

  async function toError(res, model) {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        detail = typeof data.error === "string" ? data.error : data.error?.message || "";
      } catch {
        detail = text.slice(0, 300);
      }
    } catch {}
    logger.warn(`Ollama ${where} answered ${res.status}: ${detail || res.statusText}`);
    let err;
    if (res.status === 404 || /not found/i.test(detail)) err = new LocalAiError(`The model "${model || ""}" isn't installed in Ollama. Get it with: ollama pull ${model || "<model>"}`);
    else if (/out of memory|requires more (system )?memory|unable to allocate|cuda/i.test(detail)) err = new LocalAiError(`Ollama ran out of memory for this model${contextSize ? ` at a context of ${contextSize}` : ""}. Pick a smaller model or lower the context size in the brain's settings.`);
    else err = new LocalAiError(detail || `Ollama returned an error (${res.status}).`);
    err.status = res.status;
    err.detail = detail;
    return err;
  }

  async function request(path, options, model) {
    let res;
    try {
      res = await fetch(`${base}${path}`, options);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (err.name === "TimeoutError") throw new LocalAiError(`Ollama at ${where} didn't answer in time.`);
      throw new LocalAiError(`Couldn't reach Ollama at ${where}. Is it running? (Start it with: ollama serve)`);
    }
    if (!res.ok) throw await toError(res, model);
    return res;
  }

  const post = (path, body, signal, model) =>
    request(path, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, model);

  // The options every request carries
  function settingsFor(body, temperature) {
    const options = {};
    if (temperature !== undefined) options.temperature = temperature;
    if (contextSize > 0) options.num_ctx = contextSize;
    if (Object.keys(options).length) body.options = options;
    if (keepAlive > 0) body.keep_alive = `${keepAlive}m`;
    return body;
  }

  async function postChat(body, signal) {
    try {
      return await post("/api/chat", body, signal, body.model);
    } catch (err) {
      if (body.tools && err.status === 400 && /tool/i.test(err.detail || "")) {
        logger.warn(`${body.model} can't use tools; chatting without them`);
        noTools.add(body.model);
        const { tools, ...rest } = body;
        return post("/api/chat", rest, signal, body.model);
      }
      throw err;
    }
  }

  async function listModels() {
    const res = await request("/api/tags", { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    return (data.models || []).map((m) => m.name || m.model).filter((n) => typeof n === "string" && n && !NOT_CHAT.test(n));
  }

  // A tiny real request: loads the model, so a model that can't load is noticed now
  async function checkModel({ model }) {
    await postChat(settingsFor({ model, messages: [{ role: "user", content: "Hi" }], stream: false }), undefined);
  }

  async function generateText({ model, system, prompt, temperature = 0.3, signal }) {
    const messages = toOllamaMessages([{ role: "user", parts: [{ text: prompt }] }], system);
    const res = await postChat(settingsFor({ model, messages, stream: false }, temperature), signal);
    const data = await res.json();
    return stripThinking(String(data.message?.content || ""));
  }

  // One JSON object per line; the last has "done": true
  async function readStream(res, onText) {
    const decoder = new TextDecoder();
    const think = new ThinkFilter();
    const calls = [];
    let text = "";
    let buffer = "";

    const handle = (line) => {
      if (!line.trim()) return;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        return;
      }
      if (chunk.error) throw new LocalAiError(typeof chunk.error === "string" ? chunk.error : chunk.error.message || "Ollama stopped.");
      const message = chunk.message;
      if (!message) return;
      if (message.content) {
        text += message.content;
        const visible = think.push(message.content);
        if (visible) onText(visible);
      }
      for (const call of message.tool_calls || []) {
        if (call.function?.name) calls.push({ name: call.function.name, arguments: call.function.arguments || {} });
      }
    };

    for await (const bytes of res.body) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      lines.forEach(handle);
    }
    buffer += decoder.decode();
    handle(buffer);
    const rest = think.flush();
    if (rest) onText(rest);
    return { calls, text };
  }

  // Streams a reply and runs tool calls: at most 8 rounds, plus up to 4 in
  // which only free tools (the robot's) were called, like the other providers
  async function streamChat({ model, contents, system, temperature, tools = [], runTool, isFreeTool = () => false, signal, onText }) {
    const messages = toOllamaMessages(contents, system);
    let rounds = 0;
    let freeRounds = 0;
    let free = false;
    for (;;) {
      if (free ? ++freeRounds > 4 : ++rounds > 8) return;
      const body = settingsFor({ model, messages, stream: true }, temperature);
      if (tools.length && !noTools.has(model)) body.tools = toTools(tools);

      const { calls, text } = await readStream(await postChat(body, signal), onText);
      if (!calls.length) return;

      messages.push({ role: "assistant", content: stripThinking(text), tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) });
      for (const call of calls) {
        let args = call.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        args = { ...args };
        // Small models fill optional parameters with null or "null"; that means "not given"
        for (const [k, v] of Object.entries(args)) if (v === null || typeof v === "string" && /^(null|none|undefined|n\/a)$/i.test(v.trim())) delete args[k];
        const result = await runTool(call.name, args);
        messages.push({ role: "tool", tool_name: call.name, content: JSON.stringify(result) });
      }
      free = calls.every((c) => isFreeTool(c.name));
    }
  }

  // Loads the model into memory (with this brain's context size and keep-alive), unless it's
  // already there, so the first reply doesn't wait for it. Never throws.
  async function warm({ model }) {
    try {
      const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(3000) });
      const loaded = ((await res.json()).models || []).find((m) => m.name === model || m.model === model || m.name === `${model}:latest`);
      if (loaded && (!contextSize || loaded.context_length === contextSize)) return { warm: true, already: true };
      await post("/api/generate", settingsFor({ model, prompt: "", stream: false }), AbortSignal.timeout(180000), model);
      return { warm: true };
    } catch (err) {
      logger.debug("Couldn't warm up the model:", err.message);
      return { warm: false };
    }
  }

  return { name: "local", protocol: "ollama", warm, listModels, checkModel, generateText, streamChat, transcribe: speech.transcribe, speak: speech.speak };
}

module.exports = { create, toOllamaMessages };
