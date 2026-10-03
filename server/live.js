// Gemini Live: real-time voice conversations (https://ai.google.dev/gemini-api/docs/live).
// The page streams your microphone to /api/live over a WebSocket. This helper
// keeps the API key, talks to Gemini Live, runs the AI's tools, saves every
// turn to the chat, and sends the AI's voice back as it arrives.
//
// Page → helper: {type:"start", chatId, brainId, googleAccessToken, robot} first
//   (robot: true when the robot body is on screen); then binary 16 kHz 16-bit
//   mono PCM (your voice), {type:"text", text}, {type:"audio-end"} (mic
//   paused), {type:"confirm", id, allow}, {type:"robot", on} (the robot body
//   appeared or went away: the AI gets or loses its robot tools)
// Helper → page: {type:"ready", model, robotTools}; binary 16-bit mono PCM (the AI's voice,
//   24 kHz unless {type:"audio-format", rate} says otherwise);
//   {type:"transcript", role:"user"|"model", text} (pieces as they come),
//   {type:"interrupted"}, {type:"turn-complete"}, {type:"chat", id, title},
//   {type:"activity", text}, {type:"draft", draft}, {type:"confirm", id, summary, details},
//   {type:"robot", mood} or {type:"robot", gesture} (the AI moved its robot body),
//   {type:"reconnecting"}, {type:"resumed"}, {type:"error", error}
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const logger = require("./logger");
const brains = require("./brains");
const chats = require("./chats");
const settings = require("./settings");
const tools = require("./tools");
const prompt = require("./prompt");
const gemini = require("./gemini");
const summary = require("./summary");
const { VOICES } = require("./voices");

const UPSTREAM = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MIC_TYPE = "audio/pcm;rate=16000";
const HISTORY = 30; // latest messages a new session gets as text
const EARLY_AUDIO = 50; // mic chunks (~2 s) kept while Gemini is still connecting
const RECONNECTS = 3; // tries in a row before giving up
const NEW_CHAT_TITLE = "Voice conversation";

// Tests point this at a fake Gemini
const upstreamUrl = () => process.env.FRIENDS_LIVE_UPSTREAM || UPSTREAM;

const toBuffer = (data) => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data));
const newTurn = () => ({ user: "", model: "", activity: [], drafts: [] });

// Why a Live connection failed, in words a person can act on
function liveError(reason) {
  if (reason === "NO_BRAIN") return reason;
  if (reason === "PRIVATE_MODE") return "Private mode is on, so Gemini Live is off. Studio voice is used.";
  if (reason === "LIVE_NEEDS_GEMINI") return "Live voice needs a Gemini brain. With a local AI, Studio voice is used.";
  if (/api key|api_key|permission|unauthori[sz]ed|401|403/i.test(reason)) return "Gemini Live didn't accept your API key.";
  if (/quota|exhausted|rate limit|429/i.test(reason)) return "Gemini Live's quota is used up for now.";
  if (/model|not found|not supported|unsupported|404/i.test(reason)) return "Your key can't use a Gemini Live model.";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network/i.test(reason)) return "Couldn't reach Gemini Live. Check your internet connection.";
  return `Gemini Live stopped (${reason.slice(0, 160)}).`;
}

class LiveSession {
  constructor(client) {
    this.client = client;
    this.upstream = null;
    this.ready = false; // the current Gemini connection finished its setup
    this.everReady = false;
    this.started = false;
    this.closed = false;
    this.brain = null;
    this.chatId = null;
    this.models = [];
    this.modelIndex = 0;
    this.system = null; // kept for reconnects, so a resumed session sees the same instructions
    this.handle = null; // Gemini's session resumption handle
    this.reconnects = 0;
    this.goingAway = false;
    this.lastError = "";
    this.rate = 24000;
    this.earlyAudio = [];
    this.earlyText = []; // typed before Gemini was ready
    this.turn = newTurn();
    this.turns = 0;
    this.toolsRunning = 0;
    this.confirmations = new Map(); // id → answer(allowed)
    this.cancelled = new Set(); // tool call ids Gemini gave up on
    this.toolChain = Promise.resolve();

    client.on("message", (data, isBinary) => this.fromPage(data, isBinary));
    client.on("close", () => this.close());
    client.on("error", () => this.close());
  }

  // ---------- The page ----------
  toPage(event) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(event));
  }

  fromPage(data, isBinary) {
    if (isBinary) {
      if (!this.started) return;
      const chunk = toBuffer(data);
      if (this.ready) this.toGemini({ realtimeInput: { audio: { data: chunk.toString("base64"), mimeType: MIC_TYPE } } });
      else if (this.earlyAudio.length < EARLY_AUDIO) this.earlyAudio.push(chunk);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(toBuffer(data).toString("utf8"));
    } catch {
      return;
    }
    if (msg.type === "start" && !this.started) this.start(msg);
    else if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) this.sendText(msg.text.trim().slice(0, 8000));
    else if (msg.type === "audio-end") this.toGemini({ realtimeInput: { audioStreamEnd: true } });
    else if (msg.type === "confirm") this.confirmations.get(msg.id)?.(msg.allow === true);
    else if (msg.type === "robot") this.setRobot(msg.on === true);
  }

  // The robot body appeared or went away (e.g. the Robot style was picked after
  // voice mode opened). Its tools are part of the session's setup, so the
  // session is resumed with a new setup, between turns so nothing is cut off.
  setRobot(on) {
    if (!this.started || on === this.robot) return;
    this.robot = on;
    const model = this.models[this.modelIndex];
    if (!this.everReady || !gemini.liveAsyncTools(model) || on === this.robotTools) return;
    this.switchSetup = true;
    if (this.ready && !this.turn.model && !this.toolsRunning) this.reconnect({ quiet: true });
  }

  async start({ chatId, brainId, googleAccessToken, robot }) {
    this.started = true;
    this.robot = robot === true;
    this.googleAccessToken = typeof googleAccessToken === "string" ? googleAccessToken : null;
    try {
      // Gemini Live is the cloud: in the routing modes the cloud brain is used (the page only starts Live when that's wanted)
      this.brain = settings.get().routing.mode === "fixed" ? brains.getForChat(Number(brainId) || null) : brains.getByKind("cloud", Number(brainId) || null);
    } catch (err) {
      return this.fail(err.message);
    }
    if (!this.brain) return this.fail(brains.has("local") ? "LIVE_NEEDS_GEMINI" : "NO_BRAIN");
    if (settings.get().privacy.localOnly) return this.fail("PRIVATE_MODE");
    if (this.brain.provider !== "gemini") return this.fail("LIVE_NEEDS_GEMINI");
    if (chatId) {
      try {
        chats.get(chatId);
        this.chatId = chatId;
      } catch {} // deleted meanwhile: a new chat starts with the first turn
    }
    this.models = await gemini.liveModels(this.brain.key);
    if (!this.closed) this.connect();
  }

  // Typed in voice mode: Gemini answers it like something you said
  sendText(text) {
    if (!this.ready) {
      if (this.earlyText.length < 5) this.earlyText.push(text);
      return;
    }
    this.turn.user += (this.turn.user ? " " : "") + text;
    this.toGemini({ realtimeInput: { text } });
  }

  fail(reason) {
    this.toPage({ type: "error", error: liveError(reason) });
    this.client.close();
  }

  // ---------- Gemini ----------
  toGemini(msg) {
    if (this.ready && this.upstream?.readyState === WebSocket.OPEN) this.upstream.send(JSON.stringify(msg));
  }

  connect() {
    const model = this.models[this.modelIndex];
    const upstream = new WebSocket(upstreamUrl(), { headers: { "x-goog-api-key": this.brain.key } });
    this.upstream = upstream;
    this.ready = false;
    this.lastError = "";
    upstream.on("open", () => upstream.send(JSON.stringify({ setup: this.setup(model) })));
    upstream.on("message", (data) => this.upstream === upstream && this.fromGemini(data, model));
    upstream.on("error", (err) => {
      this.lastError = err.message;
      logger.debug("Gemini Live connection error:", err.message);
    });
    upstream.on("close", (code, reason) => this.upstream === upstream && this.upstreamClosed(code, String(reason || "")));
  }

  setup(model) {
    const current = settings.get();
    this.settings = current;
    // The robot's tools only on models that keep talking while they're
    // answered; the others would pause mid-sentence (see gemini.liveAsyncTools).
    // There, the robot follows the captions instead.
    const robotTools = this.robot && gemini.liveAsyncTools(model);
    this.offered = tools.declarations(current, { voice: true, robot: robotTools, nonBlocking: true });
    this.robotTools = this.offered.some((t) => tools.isRobotTool(t.name));
    if (!this.system || this.systemRobot !== this.robotTools) {
      this.systemRobot = this.robotTools;
      let chat = null;
      if (this.chatId) {
        try {
          chat = chats.get(this.chatId);
        } catch {}
      }
      this.system = prompt.build(current, {
        voice: true,
        live: true,
        toolsOffered: this.offered,
        summary: chat?.summary?.text,
        history: chat ? chat.messages.slice(summary.windowStart(chat, HISTORY)) : [],
      });
    }
    const toolList = [];
    if (current.aiControl?.searchGrounding !== false) toolList.push({ googleSearch: {} });
    if (this.offered.length) toolList.push({ functionDeclarations: this.offered });
    return {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        temperature: prompt.temperature(current),
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES[current.personality.voice] || VOICES[1] } } },
      },
      systemInstruction: { parts: [{ text: this.system }] },
      tools: toolList,
      // A little patience before answering, so a pause to think doesn't end your turn
      realtimeInputConfig: { automaticActivityDetection: { prefixPaddingMs: 200, silenceDurationMs: 800 } },
      // Long conversations: older context is compressed instead of the session ending
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this.handle ? { handle: this.handle } : {},
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
  }

  fromGemini(data, model) {
    let msg;
    try {
      msg = JSON.parse(toBuffer(data).toString("utf8"));
    } catch {
      return;
    }
    if (msg.setupComplete) this.onReady(model);
    if (msg.serverContent) this.onContent(msg.serverContent);
    if (msg.toolCall?.functionCalls?.length) this.onToolCall(msg.toolCall.functionCalls);
    for (const id of msg.toolCallCancellation?.ids || []) this.cancelled.add(id);
    const update = msg.sessionResumptionUpdate;
    if (update?.newHandle && update.resumable !== false) this.handle = update.newHandle;
    if (msg.goAway) this.onGoAway();
  }

  onReady(model) {
    const first = !this.everReady;
    this.ready = true;
    this.everReady = true;
    this.reconnects = 0;
    this.goingAway = false;
    gemini.preferLiveModel(this.brain.key, model);
    if (first) {
      this.toPage({ type: "ready", model, robotTools: this.robotTools });
      this.greet();
    } else {
      this.toPage({ type: "resumed" });
    }
    for (const chunk of this.earlyAudio.splice(0)) this.toGemini({ realtimeInput: { audio: { data: chunk.toString("base64"), mimeType: MIC_TYPE } } });
    for (const text of this.earlyText.splice(0)) this.sendText(text);
  }

  // It speaks first, like someone picking up. The note is from the app, and
  // isn't saved: only what you say (transcribed) or type counts as yours.
  greet() {
    const user = prompt.userName(this.settings || settings.get());
    const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const situation = this.chatId
      ? "You talked earlier in this conversation; welcome them back, and if you were in the middle of something, offer to pick it up."
      : "Greet them.";
    this.toGemini({ realtimeInput: { text: `(App note, not from ${user}: they just opened voice mode; it's ${time}. ${situation} One short, natural sentence, the way a friend would. Don't list what you can do.)` } });
  }

  onContent(content) {
    if (content.inputTranscription?.text) {
      this.turn.user += content.inputTranscription.text;
      this.toPage({ type: "transcript", role: "user", text: content.inputTranscription.text });
    }
    for (const part of content.modelTurn?.parts || []) {
      const audio = part.inlineData;
      if (!audio?.data || (audio.mimeType && !audio.mimeType.startsWith("audio/"))) continue;
      const rate = Number(/rate=(\d+)/.exec(audio.mimeType || "")?.[1]) || 24000;
      if (rate !== this.rate) {
        this.rate = rate;
        this.toPage({ type: "audio-format", rate });
      }
      if (this.client.readyState === WebSocket.OPEN) this.client.send(Buffer.from(audio.data, "base64"), { binary: true });
    }
    if (content.outputTranscription?.text) {
      this.turn.model += content.outputTranscription.text;
      this.toPage({ type: "transcript", role: "model", text: content.outputTranscription.text });
    }
    if (content.interrupted) {
      this.toPage({ type: "interrupted" });
      this.finishTurn();
    }
    if (content.turnComplete) {
      this.finishTurn();
      this.toPage({ type: "turn-complete" });
      if (this.goingAway) this.reconnect();
      else if (this.switchSetup && !this.toolsRunning) this.reconnect({ quiet: true });
    }
  }

  // Saves the turn (what you said, what it said, what it did) to the chat
  finishTurn() {
    const turn = this.turn;
    this.turn = newTurn();
    const user = turn.user.replace(/\s+/g, " ").trim();
    const model = turn.model.replace(/\s+/g, " ").trim();
    if (!user && !model && !turn.activity.length && !turn.drafts.length) return;

    let chat = null;
    if (this.chatId) {
      try {
        chat = chats.get(this.chatId);
      } catch {}
    }
    if (!chat) {
      chat = chats.create(user || turn.drafts[0]?.title || NEW_CHAT_TITLE);
      this.chatId = chat.id;
      this.toPage({ type: "chat", id: chat.id, title: chat.title });
    } else if (chat.title === NEW_CHAT_TITLE && user) {
      // Started with its greeting: name the chat after the first thing you said
      chat.title = chats.titleFrom(user);
      this.toPage({ type: "chat", id: chat.id, title: chat.title });
    }
    const at = Date.now();
    if (user) chat.messages.push({ role: "user", text: user, at, voice: true });
    if (model || turn.activity.length || turn.drafts.length) {
      const message = { role: "model", text: model, at, voice: true };
      if (turn.activity.length) message.activity = turn.activity;
      if (turn.drafts.length) message.drafts = turn.drafts;
      chat.messages.push(message);
    }
    chats.save(chat);
    if (++this.turns % 10 === 0) this.summarize();
  }

  summarize() {
    if (!this.chatId || !this.brain) return;
    summary.update(this.chatId, { key: this.brain.key, model: this.brain.model, window: HISTORY }).catch((err) => logger.debug("Summary skipped:", err.message));
  }

  // ---------- Tools ----------
  // Robot moves are answered at once, never behind a slower tool (a file
  // waiting for your OK); everything else runs in order.
  onToolCall(calls) {
    const robotCalls = calls.filter((c) => tools.isRobotTool(c.name));
    const rest = calls.filter((c) => !tools.isRobotTool(c.name));
    if (robotCalls.length) this.answerRobot(robotCalls);
    if (rest.length) this.toolChain = this.toolChain.then(() => this.runTools(rest)).catch((err) => logger.warn("Live tool error:", err.message));
  }

  // Shows the move on the page and answers "SILENT": Gemini takes note and
  // carries on talking, without a new turn about it
  answerRobot(calls) {
    const functionResponses = calls.map((call) => {
      let response;
      try {
        this.toPage({ type: "robot", ...tools.robotEvent(call.name, call.args || {}) });
        response = { ok: true, scheduling: "SILENT" };
      } catch (err) {
        response = { error: err.message, scheduling: "SILENT" };
      }
      return call.id ? { id: call.id, name: call.name, response } : { name: call.name, response };
    });
    this.toGemini({ toolResponse: { functionResponses } });
  }

  async runTools(calls) {
    this.toolsRunning++;
    const functionResponses = [];
    try {
      for (const call of calls) {
        if (this.cancelled.has(call.id)) continue;
        const result = await tools.run(call.name, call.args || {}, this.toolContext());
        if (this.cancelled.has(call.id) || this.closed) continue;
        const response = { name: call.name, response: result };
        if (call.id) response.id = call.id;
        functionResponses.push(response);
      }
    } finally {
      this.toolsRunning--;
    }
    if (functionResponses.length) this.toGemini({ toolResponse: { functionResponses } });
  }

  toolContext() {
    return {
      settings: this.settings || settings.get(),
      googleAccessToken: this.googleAccessToken,
      confirm: (summaryText, details) => this.confirm(summaryText, details),
      onActivity: (line) => {
        this.turn.activity.push(line);
        this.toPage({ type: "activity", text: line });
      },
      onDraft: (draft) => {
        this.turn.drafts.push(draft);
        this.toPage({ type: "draft", draft });
      },
    };
  }

  // Asks you on the page (Allow / Deny); no answer in 5 minutes counts as no
  confirm(summaryText, details) {
    const id = crypto.randomUUID();
    this.toPage({ type: "confirm", id, summary: summaryText, details });
    return new Promise((resolve) => {
      const finish = (allowed) => {
        clearTimeout(timer);
        this.confirmations.delete(id);
        resolve(allowed);
      };
      const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
      this.confirmations.set(id, finish);
    });
  }

  // ---------- Staying connected ----------
  // Gemini ends each connection after about 10 minutes and warns first.
  // Switch between turns, so nothing is cut off; the session continues.
  onGoAway() {
    this.goingAway = true;
    if (!this.turn.model && !this.toolsRunning) this.reconnect();
  }

  // quiet: a planned switch (see setRobot), not worth a "Reconnecting…" note
  reconnect({ quiet = false } = {}) {
    if (this.closed) return;
    const old = this.upstream;
    this.upstream = null; // its close event is ignored from here on
    this.ready = false;
    this.goingAway = false;
    this.switchSetup = false;
    if (old) {
      old.removeAllListeners();
      old.on("error", () => {});
      old.close();
    }
    if (!quiet) this.toPage({ type: "reconnecting" });
    this.connect();
  }

  upstreamClosed(code, reason) {
    const wasReady = this.ready;
    this.upstream = null;
    this.ready = false;
    if (this.closed) return;
    const why = reason || this.lastError || `code ${code}`;
    logger.warn(`Gemini Live connection closed (${this.models[this.modelIndex]}): ${why}`);

    if (!this.everReady) {
      // The first setup failed: try the next model when it was about the model
      if (/model|not found|not supported|unsupported/i.test(why) && this.modelIndex < this.models.length - 1) {
        this.modelIndex++;
        return this.connect();
      }
      return this.fail(why);
    }
    if (this.reconnects++ >= RECONNECTS) return this.fail(why);
    if (!wasReady && this.handle) {
      // Resuming didn't work: a fresh session that gets the chat so far as text
      this.handle = null;
      this.system = null;
    }
    this.toPage({ type: "reconnecting" });
    this.connect();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.finishTurn();
    for (const answer of [...this.confirmations.values()]) answer(false);
    const upstream = this.upstream;
    this.upstream = null;
    if (upstream) {
      upstream.removeAllListeners();
      upstream.on("error", () => {});
      upstream.close();
    }
    if (this.turns) this.summarize();
  }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

// Takes over an HTTP upgrade request for /api/live (already checked by server.js)
function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (client) => new LiveSession(client));
}

module.exports = { handleUpgrade, liveError };
