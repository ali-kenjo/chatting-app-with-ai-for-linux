// The Friends server: serves the web application and handles AI interactions,
// model configuration, and persistent chat data.
const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { dataDir, host: defaultHost, port: defaultPort, checkStorage, version } = require("./config");
const logger = require("./logger");
const brains = require("./brains");
const chats = require("./chats");
const settings = require("./settings");
const notes = require("./notes");
const attachments = require("./attachments");
const tools = require("./tools");
const prompt = require("./prompt");
const summary = require("./summary");
const live = require("./live");
const robot = require("./robot");
const local = require("./local");
const router = require("./router");
const voiceLocal = require("./voice");
const firebase = require("./firebase");
const backup = require("./backup");
const characters = require("./characters");
const episodes = require("./episodes");
const { ACTIVITIES } = require("./activities");
const life = require("./life");
const briefing = require("./briefing");
const connectors = require("./connectors");
const mcp = require("./mcp");
const localNotes = require("./local-notes");
const telegram = require("./telegram");
const google = require("./google");
const { execFile } = require("child_process");

const PORT = defaultPort;
const VOICE_CHAT_TITLE = "Voice conversation"; // the same as live.js uses
const HOST = defaultHost;
const ROOT = path.join(__dirname, "..");

// URL prefix → folder. Only these are served; the rest of the project isn't.
const STATIC = {
  "/vendor/marked/": path.join(ROOT, "node_modules/marked/lib"),
  "/vendor/dompurify/": path.join(ROOT, "node_modules/dompurify/dist"),
  "/vendor/highlight/": path.join(ROOT, "node_modules/@highlightjs/cdn-assets/es"),
  "/vendor/katex/": path.join(ROOT, "node_modules/katex/dist"),
  "/vendor/mermaid/": path.join(ROOT, "node_modules/mermaid/dist"),
  // The 3D robot (see src/js/robot/); the page's import map names these
  "/vendor/three/build/": path.join(ROOT, "node_modules/three/build"),
  "/vendor/three/addons/": path.join(ROOT, "node_modules/three/examples/jsm"),
  // "Follow my face": the face detector and its WebAssembly, loaded only when it's on
  "/vendor/mediapipe/": path.join(ROOT, "node_modules/@mediapipe/tasks-vision"),
  "/": path.join(ROOT, "src"),
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
  ".glb": "model/gltf-binary",
};


// Set when the server starts: the host names this helper answers to
let allowedHosts = [];

// Only localhost by default. ALLOWED_HOSTS adds more (comma-separated);
// "*" turns the Host/Origin checks off, e.g. behind a cloud proxy or in Docker.
function computeAllowedHosts(port, host) {
  const base = [
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    "localhost",
    "127.0.0.1",
  ];

  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "0.0.0.0") {
    base.push(`${host}:${port}`, host);
  }

  const custom = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  return [...new Set([...base, ...custom])];
}

function securityHeaders(extra = {}) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The camera is only for the robot's "Follow my face" (Settings → Robot)
    "Permissions-Policy": allowedHosts.includes("*") ? "microphone=*, camera=*" : "microphone=(self), camera=(self)",
    ...extra,
  };
  if (!allowedHosts.includes("*")) {
    headers["X-Frame-Options"] = "DENY";
  }
  return headers;
}

function sendJson(res, status, data) {
  res.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
  }));
  res.end(JSON.stringify(data));
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readBody(req, 5 * 1024 * 1024);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

// Other websites open in your browser could try to call this helper.
// Only accept requests addressed to allowed hosts (blocks DNS rebinding), and
// changes only from pages this helper served (blocks cross-site requests).
function isTrusted(req) {
  if (allowedHosts.includes("*")) return true;
  const host = req.headers.host;
  if (!host || !allowedHosts.includes(host)) return false;
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return allowedHosts.some((h) => origin === `http://${h}` || origin === `https://${h}`);
}

// Voice mode's live connection (a WebSocket, see live.js): the same host rules,
// and it must come from our own page (browsers always say where from)
function isTrustedUpgrade(req) {
  if (allowedHosts.includes("*")) return true;
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (!host || !allowedHosts.includes(host) || !origin) return false;
  return allowedHosts.some((h) => origin === `http://${h}` || origin === `https://${h}`);
}

function serveStatic(req, res, pathname) {
  const prefix = Object.keys(STATIC).find((p) => pathname.startsWith(p));
  const base = STATIC[prefix];
  let file = path.resolve(base, "." + path.posix.normalize("/" + pathname.slice(prefix.length)));
  if (file !== base && !file.startsWith(base + path.sep)) return sendJson(res, 403, { error: "Forbidden" });
  if (file === base || pathname.endsWith("/")) file = path.join(file, "index.html");

  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: "Not found" });
    res.writeHead(200, securityHeaders({
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    }));
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

// ---------- Confirmations for Mutating / Destructive Operations ----------
const pendingConfirmations = new Map();

function waitForConfirmation(id, onClose) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
    const finish = (allowed) => {
      clearTimeout(timer);
      pendingConfirmations.delete(id);
      resolve(allowed);
    };
    pendingConfirmations.set(id, finish);
    onClose(() => pendingConfirmations.has(id) && finish(false));
  });
}

// ---------- Chat ----------
// Gemini messages for a saved chat, from `start` on (older ones are in the
// chat's summary). Attachments of the last 10 of your messages are included;
// older ones are only mentioned, to keep requests small.
// others: { id → name } of the characters that aren't the one answering now;
// their replies are marked, so it doesn't carry on as them
function toContents(messages, start = 0, others = {}) {
  const windowed = messages.slice(start);
  const userIndexes = windowed.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const recent = new Set(userIndexes.slice(-10));
  return windowed.map((m, i) => {
    const parts = [];
    for (const file of m.attachments || []) {
      const part = recent.has(i) ? attachments.toPart(file.id) : null;
      parts.push(part || { text: `[Earlier attachment: ${file.name}]` });
    }
    if (m.text) parts.push({ text: m.role === "model" && others[m.by] ? `[${others[m.by]}, another of the user's AI characters, said:] ${m.text}` : m.text });
    else if (m.activity?.length) parts.push({ text: `[${m.activity.join("; ")}]` });
    for (const d of m.drafts || []) parts.push({ text: `[Draft "${d.title}"]\n${d.content}` });
    if (!parts.length) parts.push({ text: "(empty)" });
    return { role: m.role, parts };
  });
}

// Adds your message to a chat (a new one if chatId is null), then streams the
// AI's reply as newline-separated JSON events:
//   {"type":"chat",id,title,userId,replyId}  the chat it was saved in, and the ids
//                            of your message (when one was added) and of the reply
//   {"type":"text",text}      a piece of the reply
//   {"type":"activity",text}  something the AI did (saved a note…)
//   {"type":"robot",mood} or {"type":"robot",gesture}  the AI moved its robot body
//   {"type":"done"} or {"type":"error",error}
// With retry: true, no new message is added; the last one is answered again.
// With from: <message id>, that message and everything after it are removed
// first (editing your message, or asking for another answer).
// robot: true says the robot body is on screen (it may then be offered its tools).
async function chat(req, res) {
  const authHeader = req.headers.authorization || "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const { chatId = null, text = "", retry = false, from = null, force = null, brainId = null, voice = false, robot: robotOnScreen = false, attachments: files = [], googleAccessToken, onAir: onAirFlag = false, greet = false, note = "", doc = null } = await readJson(req);
  const onAir = onAirFlag === true;
  // greet: voice mode just opened; the AI speaks first (nothing of yours is added).
  // note: the same for something the app tells it (a reminder went off), in voice mode.
  const appNote = voice === true && typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : "";
  const greeting = (greet === true && voice === true) || Boolean(appNote);
  // The page's Google token, else the one Friends keeps itself (Stay signed in)
  const activeToken = googleAccessToken || headerToken || (await googleToken());
  const attached = [];
  for (const id of Array.isArray(files) ? files.slice(0, 10) : []) {
    try {
      const { meta } = attachments.get(id);
      attached.push({ id: meta.id, name: meta.name, mime: meta.mime, size: meta.size });
    } catch {
      return sendJson(res, 400, { error: "An attached file is missing. Attach it again." });
    }
  }
  if (retry && !chatId) return sendJson(res, 400, { error: "Nothing to answer." });
  if (!retry && !greeting && (typeof text !== "string" || (!text.trim() && !attached.length))) return sendJson(res, 400, { error: "The message is empty." });

  let conversation;
  try {
    conversation = chatId ? chats.get(chatId) : chats.create(greeting ? VOICE_CHAT_TITLE : text.trim() || attached[0].name);
    if (chatId && from) chats.truncate(conversation, from);
  } catch (err) {
    return sendJson(res, 404, { error: err.message });
  }
  // A voice chat that started with the AI's greeting is named after the first thing you say
  if (!greeting && !retry && conversation.title === VOICE_CHAT_TITLE && text.trim()) conversation.title = chats.titleFrom(text.trim());
  let userId = null;
  if (greeting) {
    // Nothing to add
  } else if (retry) {
    if (conversation.messages.at(-1)?.role !== "user") return sendJson(res, 400, { error: "Nothing to answer." });
  } else {
    userId = crypto.randomUUID();
    const message = { id: userId, role: "user", text: text.trim(), at: Date.now() };
    if (attached.length) message.attachments = attached;
    conversation.messages.push(message);
    chats.save(conversation);
  }
  const replyId = crypto.randomUUID();

  res.writeHead(200, securityHeaders({
    "Content-Type": "application/x-ndjson; charset=utf-8",
  }));
  const write = (event) => !res.writableEnded && res.write(JSON.stringify(event) + "\n");
  // Which chat it's saved in. A greeting in a new voice chat says so only once
  // something arrives, so a greeting that fails leaves no empty chat behind.
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    if (greeting) chats.save(conversation);
    write({ type: "chat", id: conversation.id, title: conversation.title, userId, replyId });
  };
  const send = (event) => {
    if (!["error", "done", "route", "confirm"].includes(event.type)) announce();
    return write(event);
  };
  if (!greeting || chatId) announce();

  // Pressing stop closes the request; stop asking the provider too
  const controller = new AbortController();
  const closeHandlers = [];
  res.on("close", () => {
    controller.abort();
    closeHandlers.forEach((fn) => fn());
  });

  const current = settings.get();
  const window = current.aiControl?.contextWindow || 20;
  const lastUser = greeting ? { role: "user", text: "" } : conversation.messages.at(-1);

  // Which AI answers: see router.js (the routing mode in Settings → AI & privacy)
  let routePlan;
  try {
    routePlan = router.plan({
      settings: current,
      text: lastUser.text || "",
      attachments: lastUser.attachments || [],
      messages: conversation.messages.slice(0, -1),
      voice: voice === true,
      force: force === "local" || force === "cloud" ? force : null,
      preferId: Number(brainId) || null,
      deps: { has: brains.has, byKind: brains.getByKind, chosen: (id) => brains.getForChat(id), privateMode: current.privacy.localOnly === true },
    });
    if (!routePlan.steps.length) throw new Error("NO_BRAIN");
  } catch (err) {
    send({ type: "error", error: err.message });
    return res.end();
  }

  const activity = [];
  const drafts = [];
  let reply = "";
  let answeredBy = null;
  const lost = () => Object.assign(new Error("Another AI answered first."), { name: "AbortError" });

  // One AI call. started() must come before anything the page or your files can notice.
  const run = async (step, { signal, started }) => {
    const brain = step.brain;
    // Google tools are left out for a local AI until you're signed in with Google
    const all = tools.declarations(current, { voice, robot: robotOnScreen === true, workspace: brain.provider !== "local" || Boolean(activeToken), onAir });
    const offered = brain.provider === "local" ? tools.forLocal(all, current) : all;
    const contents = toContents(conversation.messages, summary.windowStart(conversation, window), characters.others(current));
    // The greeting's note from the app goes last, as if said, but it's never saved
    if (greeting) contents.push({ role: "user", parts: [{ text: appNote ? prompt.appNote(current, appNote) : prompt.greeting(current, { chatId: conversation.messages.length ? conversation.id : null, onAir }) }] });
    await brain.api.streamChat({
      key: brain.key,
      model: brain.model,
      contents,
      system: prompt.build(current, { voice, toolsOffered: offered, summary: conversation.summary?.text, onAir, chatId: conversation.id, doc }),
      temperature: prompt.temperature(current),
      // Thinking at length makes a reply start 10+ seconds later; only "Deep" does
      fast: voice || current.aiControl?.reasoningEffort !== "deep",
      tools: offered,
      isFreeTool: tools.isRobotTool,
      signal,
      onText: (piece) => {
        if (!started()) throw lost();
        reply += piece;
        send({ type: "text", text: piece });
      },
      runTool: (name, args) => {
        if (!started()) throw lost();
        return tools.run(name, args, {
          settings: current,
          googleAccessToken: activeToken,
          onRobot: (event) => send({ type: "robot", ...event }),
          // tools.js decides which actions need asking (see its settings checks)
          confirm: (summary, details) => {
            const id = crypto.randomUUID();
            send({ type: "confirm", id, summary, details });
            return waitForConfirmation(id, (fn) => closeHandlers.push(fn));
          },
          onActivity: (textLine) => {
            activity.push(textLine);
            send({ type: "activity", text: textLine });
          },
          onDraft: (draft) => {
            drafts.push(draft);
            send({ type: "draft", draft });
          },
        });
      },
    });
  };

  try {
    const { step } = await router.execute(routePlan, {
      run,
      emit: (event) => routePlan.mode !== "fixed" && send(event), // one fixed brain needs no explaining
      signal: controller.signal,
      slowMs: Number(process.env.FRIENDS_ROUTER_SLOW_MS) || current.routing.dynamic.slowSeconds * 1000,
      cloudAllowed: () => conversation.cloudOk === true,
      allowCloud: () => (conversation.cloudOk = true),
      // Before the cloud gets your message (Settings → "Ask before using the cloud")
      confirmCloud: (step) => {
        const id = crypto.randomUUID();
        send({ type: "confirm", id, summary: `Send this message to ${step.brain.name}, a cloud AI?`, details: { type: "cloud", reason: step.reason, name: step.brain.name } });
        return waitForConfirmation(id, (fn) => closeHandlers.push(fn));
      },
    });
    answeredBy = step;
    send({ type: "done" });
  } catch (err) {
    if (err.name !== "AbortError" && !controller.signal.aborted) send({ type: "error", error: err.message });
  } finally {
    // Keep whatever arrived, even if the reply was stopped halfway
    if (reply || activity.length || drafts.length) {
      const message = { id: replyId, role: "model", text: reply, at: Date.now(), by: current.characters.active };
      if (activity.length) message.activity = activity;
      if (drafts.length) message.drafts = drafts;
      if (answeredBy && routePlan.mode !== "fixed") message.via = { kind: answeredBy.kind, name: answeredBy.brain.name, model: answeredBy.brain.model, reason: answeredBy.reason, mode: routePlan.mode };
      conversation.messages.push(message);
    }
    if (announced && (reply || activity.length || drafts.length || conversation.cloudOk)) chats.save(conversation);
  }
  res.end();
  // Long chats: summarize what dropped out of the window, in the background. With a choice
  // of AIs a local one does it (private and free).
  const summarizer = answeredBy && (routePlan.mode === "fixed" || routePlan.mode === "force") ? answeredBy.brain : brains.forTask() || answeredBy?.brain;
  // On Gemini a light model does it, so the main model's free quota is kept for replies
  if (summarizer) summary.update(conversation.id, { api: summarizer.api, key: summarizer.key, model: summarizer.provider === "gemini" ? require("./gemini").TASK_MODEL : summarizer.model, window }).catch((err) => logger.debug("Summary skipped:", err.message));
}

// Your Google access token when you stay signed in (none in Private mode)
async function googleToken() {
  if (settings.get().privacy.localOnly) return null;
  return google.token().catch((err) => (logger.warn("Google token:", err.message), null));
}

// ---------- Voice ----------
async function transcribe(req) {
  const audio = await readBody(req, 15 * 1024 * 1024);
  const brain = brains.forVoice();
  if (!brain) throw new Error("NO_BRAIN");
  return { text: await brain.api.transcribe({ key: brain.key, model: brain.model, audio: audio.toString("base64") }) };
}

async function speak(req, res) {
  const { text, voice } = await readJson(req);
  const brain = brains.forVoice();
  if (!brain) return sendJson(res, 400, { error: "NO_BRAIN" });
  if (typeof text !== "string" || !text.trim()) return sendJson(res, 400, { error: "Nothing to say." });
  try {
    // A voice by name (trying one out in Settings), else the active character's
    const chosen = characters.GEMINI_VOICES.find((v) => v.name === voice) || characters.voiceOf(characters.active(settings.get()));
    const wav = await brain.api.speak({ key: brain.key, text: text.slice(0, 4000), voice: chosen.name, gender: chosen.gender });
    res.writeHead(200, securityHeaders({
      "Content-Type": "audio/wav",
    }));
    res.end(wav);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

// ---------- Liked and pinned replies ----------
// Pinning also keeps the reply in the AI's own notes, so it remembers it in
// every chat; unpinning removes that note again.
async function markMessage(req, chatId, messageId) {
  const { liked, pinned } = await readJson(req);
  const changes = {};
  if (liked !== undefined) changes.liked = liked === true;
  if (pinned !== undefined) {
    const message = chats.get(chatId).messages.find((m) => m.id === messageId);
    if (!message) throw new Error("That message isn't in this chat anymore.");
    if (pinned === true && !message.pinned) {
      const text = String(message.text || "").trim();
      const firstLine = text.split("\n").find((l) => l.trim()) || "Pinned reply";
      const note = notes.save({
        type: "reference",
        title: `Pinned: ${firstLine.replace(/[#*_`>]/g, "").trim().slice(0, 80)}`,
        description: "A reply the user pinned in a chat as worth remembering",
        content: text,
      });
      changes.pinned = true;
      changes.pinnedNote = note.id;
    } else if (pinned !== true && message.pinned) {
      if (message.pinnedNote) notes.remove(message.pinnedNote);
      changes.pinned = false;
      changes.pinnedNote = null;
    }
  }
  return chats.mark(chatId, messageId, changes);
}

// ---------- Follow-up suggestions ----------
// Three short things you might say next, shown as chips under the last reply
async function suggestions(chatId) {
  const brain = brains.forTask();
  if (!brain) return { suggestions: [] };
  const recent = chats.get(chatId).messages.slice(-6).filter((m) => m.text);
  if (recent.at(-1)?.role !== "model") return { suggestions: [] };
  const lines = recent.map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.text.replace(/\s+/g, " ").slice(0, 1500)}`);
  const text = await brain.api.generateText({
    key: brain.key,
    model: brain.model,
    prompt: [
      "Suggest 3 short follow-up messages the user might send next in this chat.",
      "Write them as the user, in the language the user writes in, each at most 6 words, no numbering.",
      'Reply with a JSON array of strings only, e.g. ["Tell me more", "Give an example", "Make it shorter"].',
      "",
      ...lines,
    ].join("\n"),
    temperature: 0.7,
  });
  let list = [];
  try {
    list = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {}
  return {
    suggestions: (Array.isArray(list) ? list : [])
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => s.trim().slice(0, 80))
      .slice(0, 3),
  };
}

// ---------- Attachments ----------
async function upload(req) {
  const body = await readBody(req, attachments.MAX_SIZE + 1);
  const name = decodeURIComponent(req.headers["x-file-name"] || "file");
  return attachments.save(body, name, req.headers["content-type"]);
}

function download(req, res, id) {
  try {
    const { meta, file } = attachments.get(id);
    res.writeHead(200, securityHeaders({
      "Content-Type": meta.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "Cache-Control": "private, max-age=86400",
    }));
    fs.createReadStream(file).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

// ---------- The robot ----------
// Your own model (Settings → Robot): a .glb, checked before it's kept
async function uploadModel(req) {
  let body;
  try {
    body = await readBody(req, robot.MAX_MODEL);
  } catch {
    throw new Error("The model can be up to 30 MB.");
  }
  let name = "model.glb";
  try {
    name = decodeURIComponent(req.headers["x-file-name"] || name);
  } catch {}
  return robot.saveModel(body, name);
}

function sendModel(req, res) {
  fs.stat(robot.modelFile, (err, stat) => {
    if (err) return sendJson(res, 404, { error: "No model uploaded." });
    res.writeHead(200, securityHeaders({ "Content-Type": "model/gltf-binary", "Content-Length": stat.size }));
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(robot.modelFile).pipe(res);
  });
}

// "Smarter moods": one small Gemini request per turn, only when it's switched on
async function smartMood({ text, heard }) {
  if (!settings.get().robot.smartMoods) return { mood: null };
  const brain = brains.forTask();
  if (!brain) return { mood: null };
  return { mood: await robot.readMood({ brain, text, heard }) };
}

// ---------- Things happening while you're away from the page ----------
// The page listens on /api/events (server-sent events): reminders going off and
// a briefing that's ready. The desktop app shows them as notifications itself;
// otherwise, with no page open, notify-send does (Linux).
const eventClients = new Set();
let nativeNotify = null; // set by the desktop app: fn({ title, body, action })

function events(req, res) {
  res.writeHead(200, securityHeaders({ "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" }));
  res.write(`event: hello\ndata: ${JSON.stringify({ native: Boolean(nativeNotify) })}\n\n`);
  eventClients.add(res);
  const beat = setInterval(() => res.write(": still here\n\n"), 25000);
  req.on("close", () => {
    clearInterval(beat);
    eventClients.delete(res);
  });
}

function broadcast(type, data, { title, body, action } = {}) {
  for (const res of eventClients) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!settings.get().life.notify) return;
  if (nativeNotify) return nativeNotify({ title, body, action });
  if (!eventClients.size && process.platform === "linux") {
    execFile("notify-send", ["--app-name=Friends", "-i", "friends", title, body], () => {});
  }
}

life.onReminder((r) => {
  broadcast("reminder", r, { title: `⏰ ${r.text}`, body: "Friends reminder", action: { type: "reminder", id: r.id } });
  telegram.sendAlert(`⏰ *Reminder:* ${r.text}`, settings.get());
});
life.onFocusComplete((f) => {
  broadcast("focus_complete", f, { title: "🎯 Focus Complete!", body: `Completed focus session on ${f.task}`, action: { type: "focus" } });
  telegram.sendAlert(`🎯 *Focus Complete!* You finished your session on: ${f.task}`, settings.get());
});
const briefingReady = (made) => broadcast("briefing", made, { title: "☀️ Your briefing is ready", body: made.title, action: { type: "open-chat", id: made.chatId } });

// The desktop app (electron/main.js) shows notifications itself
function setNativeNotify(fn) {
  nativeNotify = fn;
}

// ---------- Backups (Settings → Data) ----------
// A restore changes files that some modules keep in memory
backup.onRestore(() => {
  settings.reload();
  brains.reload();
  episodes.forget();
  mcp.stopAll();
  mcp.startAll();
});

function sendBackup(res, buffer, name) {
  res.writeHead(200, securityHeaders({
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${name}"`,
    "Content-Length": buffer.length,
  }));
  res.end(buffer);
}

const restoreMode = (url) => (url.searchParams.get("mode") === "merge" ? "merge" : "replace");

// [method, path pattern, handler(req, captured id, url)] → JSON response
const routes = [
  ["GET", /^\/api\/brains$/, () => brains.publicState()],
  ["POST", /^\/api\/brains$/, async (req) => brains.saveBrain(await readJson(req))],
  ["DELETE", /^\/api\/brains\/(\d+)$/, (req, id) => brains.deleteBrain(Number(id))],
  ["POST", /^\/api\/brains\/(\d+)\/default$/, (req, id) => brains.setDefault(Number(id))],
  ["POST", /^\/api\/brains\/(\d+)\/enabled$/, async (req, id) => brains.setEnabled(Number(id), (await readJson(req)).enabled)],
  ["POST", /^\/api\/brains\/(\d+)\/test$/, (req, id) => brains.testBrain(Number(id))],
  ["POST", /^\/api\/brains\/test$/, async (req) => brains.testConfig(await readJson(req))],
  ["POST", /^\/api\/models$/, async (req) => brains.listModels(await readJson(req))],

  ["GET", /^\/api\/chats$/, () => chats.list()],
  ["GET", /^\/api\/chats\/search$/, (req, id, url) => chats.search(url.searchParams.get("q"))],
  ["GET", /^\/api\/chats\/([\w-]+)$/, (req, id) => chats.get(id)],
  ["PATCH", /^\/api\/chats\/([\w-]+)$/, async (req, id) => chats.rename(id, (await readJson(req)).title)],
  ["DELETE", /^\/api\/chats\/([\w-]+)$/, (req, id) => (episodes.removeForChat(id), chats.remove(id))],
  ["PATCH", /^\/api\/chats\/([\w-]+\/messages\/[\w-]+)$/, (req, ids) => markMessage(req, ...ids.split("/messages/"))],
  ["POST", /^\/api\/chats\/([\w-]+)\/suggestions$/, (req, id) => suggestions(id)],

  ["GET", /^\/api\/settings$/, () => settings.get()],
  ["PUT", /^\/api\/settings$/, async (req) => {
    const res = settings.set(await readJson(req));
    telegram.start(res);
    return res;
  }],

  // Characters (Settings → Characters): the choices; the characters themselves are in the settings
  ["GET", /^\/api\/characters\/meta$/, () => ({ voices: characters.GEMINI_VOICES, fields: characters.FIELDS, builtin: characters.BUILTIN, templates: characters.TEMPLATES, looks: characters.LOOKS, formats: Object.keys(prompt.FORMATS), max: characters.MAX_CHARACTERS })],
  ["GET", /^\/api\/activities$/, () => ({ activities: ACTIVITIES })],
  // What the AI remembers of your conversations (Settings → Memory)
  ["GET", /^\/api\/episodes$/, () => ({ episodes: episodes.all(), followUps: episodes.followUps() })],
  ["DELETE", /^\/api\/episodes$/, () => episodes.clear()],
  ["DELETE", /^\/api\/episodes\/([\w-]+)$/, (req, id) => (episodes.removeForChat(id), { ok: true })],
  ["DELETE", /^\/api\/follow-ups\/([\w-]+)$/, (req, id) => episodes.resolve(id)],

  ["GET", /^\/api\/notes$/, () => ({ dir: notes.dir, notes: notes.list() })],
  ["PUT", /^\/api\/notes\/([\w-]+)$/, async (req, id) => notes.save({ ...(await readJson(req)), id })],
  ["DELETE", /^\/api\/notes\/([\w-]+)$/, (req, id) => notes.remove(id)],
  ["DELETE", /^\/api\/notes$/, () => notes.clear()],

  ["POST", /^\/api\/confirm\/([\w-]+)$/, async (req, id) => {
    const { allow } = await readJson(req);
    const answer = pendingConfirmations.get(id);
    if (!answer) throw new Error("This confirmation request has already expired or ended.");
    answer(allow === true);
    return { ok: true };
  }],

  ["GET", /^\/api\/voice\/local$/, () => voiceLocal.status()],
  ["POST", /^\/api\/voice\/local\/install$/, async () => {
    // The setup downloads from the internet (PyPI, Hugging Face)
    if (settings.get().privacy.localOnly) throw new Error("Private mode is on, so nothing can be downloaded. Turn it off for the setup, then back on.");
    voiceLocal.install();
    return voiceLocal.status();
  }],
  ["POST", /^\/api\/local\/warm$/, async (req) => brains.warm(await readJson(req))],
  ["GET", /^\/api\/local\/servers$/, async () => ({ servers: await local.detect() })],

  ["GET", /^\/api\/firebase-config$/, () => {
    if (settings.get().privacy.localOnly) return { private: true }; // Private mode: no Google sign-in
    return firebase.read() || { notConfigured: true };
  }],
  // Set up Google sign-in from the page: paste the Firebase web config (Settings → Connected Apps)
  ["PUT", /^\/api\/firebase-config$/, async (req) => {
    const config = firebase.save((await readJson(req)).config);
    return { ok: true, projectId: config.projectId };
  }],
  ["DELETE", /^\/api\/firebase-config$/, () => (firebase.remove(), { ok: true })],

  ["GET", /^\/api\/news$/, async (req, id, url) => {
    if (settings.get().privacy.localOnly) throw new Error("Private mode is on, so the news is off.");
    const news = require("./news");
    return news.getNews(url.searchParams.get("q") || "");
  }],

  ["POST", /^\/api\/attachments$/, (req) => upload(req)],
  ["POST", /^\/api\/voice\/transcribe$/, (req) => transcribe(req)],

  // Tasks, reminders, habits, journal (life.js) and the briefing
  ["GET", /^\/api\/life\/today$/, () => life.today()],
  ["GET", /^\/api\/life\/tasks$/, (req, id, url) => life.listTasks({ list: url.searchParams.get("list") || undefined, includeDone: url.searchParams.get("done") === "1" })],
  ["POST", /^\/api\/life\/tasks$/, async (req) => life.addTask(await readJson(req))],
  ["PATCH", /^\/api\/life\/tasks\/([\w-]+)$/, async (req, id) => life.updateTask(id, await readJson(req))],
  ["DELETE", /^\/api\/life\/tasks\/([\w-]+)$/, (req, id) => life.removeTask(id)],
  ["GET", /^\/api\/life\/reminders$/, () => life.listReminders()],
  ["POST", /^\/api\/life\/reminders$/, async (req) => life.addReminder(await readJson(req))],
  ["POST", /^\/api\/life\/reminders\/([\w-]+)\/snooze$/, async (req, id) => life.snooze(id, (await readJson(req)).minutes)],
  ["DELETE", /^\/api\/life\/reminders\/([\w-]+)$/, (req, id) => life.removeReminder(id)],
  ["GET", /^\/api\/life\/habits$/, () => life.listHabits()],
  ["POST", /^\/api\/life\/habits$/, async (req) => life.addHabit(await readJson(req))],
  ["POST", /^\/api\/life\/habits\/([\w-]+)\/log$/, async (req, id) => life.logHabit(id, await readJson(req))],
  ["DELETE", /^\/api\/life\/habits\/([\w-]+)$/, (req, id) => life.removeHabit(id)],
  ["GET", /^\/api\/life\/journal$/, (req, id, url) => life.listEntries({ days: Number(url.searchParams.get("days")) || 30 })],
  ["POST", /^\/api\/life\/journal$/, async (req) => life.addEntry(await readJson(req))],
  ["DELETE", /^\/api\/life\/journal\/([\w-]+)$/, (req, id) => life.removeEntry(id)],
  ["POST", /^\/api\/life\/briefing$/, async (req) => briefing.make({ googleAccessToken: (await readJson(req)).googleAccessToken || (await googleToken()) })],

  // Native offline local calendar
  ["GET", /^\/api\/life\/calendar$/, (req, id, url) => life.listCalendarEvents({ from: url.searchParams.get("from") || undefined, to: url.searchParams.get("to") || undefined })],
  ["POST", /^\/api\/life\/calendar$/, async (req) => life.addCalendarEvent(await readJson(req))],
  ["DELETE", /^\/api\/life\/calendar\/([\w-]+)$/, (req, id) => life.deleteCalendarEvent(id)],
  ["GET", /^\/api\/life\/calendar\/ics$/, () => ({ ics: life.exportCalendarIcs() })],
  ["POST", /^\/api\/life\/calendar\/ics$/, async (req) => life.importCalendarIcs((await readJson(req)).ics)],

  // Focus & Pomodoro session
  ["POST", /^\/api\/life\/focus\/start$/, async (req) => life.startFocus(await readJson(req))],
  ["GET", /^\/api\/life\/focus$/, () => life.checkFocus()],
  ["POST", /^\/api\/life\/focus\/stop$/, () => life.stopFocus()],

  // Telegram bot companion
  ["GET", /^\/api\/telegram\/status$/, () => telegram.status(settings.get())],
  ["POST", /^\/api\/telegram\/test$/, () => telegram.testConnection(settings.get())],

  // Local Markdown Notes Vault (Obsidian/Logseq compatible)
  ["GET", /^\/api\/notes-vault$/, (req, id, url) => localNotes.listNotes({ limit: Number(url.searchParams.get("limit")) || 50 })],
  ["GET", /^\/api\/notes-vault\/search$/, (req, id, url) => localNotes.searchNotes(url.searchParams.get("q") || "")],
  ["GET", /^\/api\/notes-vault\/note$/, (req, id, url) => localNotes.readNote(url.searchParams.get("title") || "")],
  ["POST", /^\/api\/notes-vault\/note$/, async (req) => { const b = await readJson(req); return localNotes.writeNote(b.title, b.content, { tags: b.tags }); }],
  ["POST", /^\/api\/notes-vault\/append$/, async (req) => { const b = await readJson(req); return localNotes.appendToNote(b.title, b.text); }],
  ["DELETE", /^\/api\/notes-vault\/note$/, (req, id, url) => localNotes.deleteNote(url.searchParams.get("title") || "")],

  // Staying signed in to Google (google.js)
  ["GET", /^\/api\/google\/status$/, () => (settings.get().privacy.localOnly ? { private: true } : google.status())],
  ["PUT", /^\/api\/google\/client$/, async (req) => google.setClient(await readJson(req))],
  ["DELETE", /^\/api\/google\/client$/, () => google.removeClient()],
  ["GET", /^\/api\/google\/token$/, async () => ({ accessToken: await googleToken() })],
  ["POST", /^\/api\/google\/disconnect$/, () => google.disconnect()],

  // Connected apps (Settings → Connected Apps) and MCP servers
  ["GET", /^\/api\/connectors$/, () => ({ apps: connectors.list(settings.get()), mcp: mcp.list() })],
  ["PUT", /^\/api\/connectors\/([\w-]+)$/, async (req, id) => connectors.save(id, await readJson(req))],
  ["DELETE", /^\/api\/connectors\/([\w-]+)$/, (req, id) => connectors.remove(id)],
  ["POST", /^\/api\/connectors\/([\w-]+)\/test$/, (req, id) => connectors.test(id)],
  ["POST", /^\/api\/mcp$/, async (req) => mcp.save(await readJson(req))],
  ["DELETE", /^\/api\/mcp\/([\w-]+)$/, (req, id) => mcp.remove(id)],
  ["POST", /^\/api\/mcp\/([\w-]+)\/restart$/, async (req, id) => (await mcp.restart(id), mcp.list().find((s) => s.id === id))],

  ["GET", /^\/api\/backups$/, () => ({ dir: backup.dir, backups: backup.list() })],
  ["POST", /^\/api\/backups$/, () => backup.create("manual", { keep: settings.get().backup.keep })],
  ["POST", /^\/api\/backups\/import$/, async (req, id, url) => backup.restore(await readBody(req, 1024 * 1024 * 1024), { mode: restoreMode(url) })],
  ["POST", /^\/api\/backups\/([\w.-]+)\/restore$/, (req, name, url) => backup.restoreSaved(name, { mode: restoreMode(url) })],
  ["DELETE", /^\/api\/backups\/([\w.-]+)$/, (req, name) => backup.remove(name)],

  ["GET", /^\/api\/robot\/model\/info$/, () => robot.info()],
  ["PUT", /^\/api\/robot\/model$/, (req) => uploadModel(req)],
  ["DELETE", /^\/api\/robot\/model$/, () => robot.removeModel()],
  ["POST", /^\/api\/robot\/mood$/, async (req) => smartMood(await readJson(req))],
];

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  // Liveness / readiness probe (accessible without strict host filtering)
  if (pathname === "/api/health" || pathname === "/healthz") {
    const storage = checkStorage();
    const ok = storage.ok;
    return sendJson(res, ok ? 200 : 503, {
      status: ok ? "ok" : "degraded",
      version,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      storage,
    });
  }

  if (!isTrusted(req)) return sendJson(res, 403, { error: "Forbidden" });

  if (pathname === "/api/chat" && req.method === "POST") return chat(req, res);
  if (pathname === "/api/events" && req.method === "GET") return events(req, res);
  // The sign-in popup opens here (this app's own address, so the desktop app allows it) and goes on to Google
  if (pathname === "/api/google/signin" && req.method === "GET") {
    try {
      if (settings.get().privacy.localOnly) throw new Error("Private mode is on, so Google sign-in is off.");
      const { url: to } = google.start(`http://${req.headers.host}`);
      res.writeHead(302, securityHeaders({ Location: to }));
      return res.end();
    } catch (err) {
      res.writeHead(200, securityHeaders({ "Content-Type": "text/html; charset=utf-8" }));
      return res.end(google.callbackPage(false, err.message));
    }
  }
  // Google's sign-in popup comes back here
  if (pathname === "/api/google/callback" && req.method === "GET") {
    let ok = true;
    let message = "";
    try {
      await google.finish(Object.fromEntries(url.searchParams));
      for (const client of eventClients) client.write(`event: google\ndata: ${JSON.stringify(google.status())}\n\n`);
    } catch (err) {
      ok = false;
      message = err.message;
    }
    res.writeHead(200, securityHeaders({ "Content-Type": "text/html; charset=utf-8" }));
    return res.end(google.callbackPage(ok, message));
  }
  if (pathname === "/api/voice/speak" && req.method === "POST") return speak(req, res);
  const file = pathname.match(/^\/api\/attachments\/([\w-]+)$/);
  if (file && req.method === "GET") return download(req, res, file[1]);
  if (pathname === "/api/robot/model" && (req.method === "GET" || req.method === "HEAD")) return sendModel(req, res);
  if (pathname === "/api/backups/export" && req.method === "GET") {
    const files = url.searchParams.get("files") === "1";
    return sendBackup(res, backup.exportBuffer({ files }), `friends-backup-${new Date().toISOString().slice(0, 10)}.json.gz`);
  }
  const saved = pathname.match(/^\/api\/backups\/([\w.-]+)\/download$/);
  if (saved && req.method === "GET") {
    try {
      return sendBackup(res, backup.read(saved[1]), saved[1]);
    } catch {
      return sendJson(res, 404, { error: "Backup not found." });
    }
  }

  if (pathname.startsWith("/api/")) {
    for (const [method, pattern, fn] of routes) {
      const match = pathname.match(pattern);
      if (match && req.method === method) {
        try {
          return sendJson(res, 200, await fn(req, match[1], url));
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
    }
    return sendJson(res, 404, { error: "Not found" });
  }

  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
  serveStatic(req, res, pathname);
}

function start(port = PORT, host = HOST) {
  allowedHosts = computeAllowedHosts(port, host);
  backup.schedule(settings.get);
  // Quiet conversations become memories, in the background (a local AI does it when there is one)
  episodes.schedule({ getBrain: () => brains.forTask(), getSettings: settings.get });
  // Reminders go off, and the morning briefing is made
  life.schedule();
  briefing.schedule(briefingReady);
  // Apps connected through MCP start in the background; they stop with Friends
  mcp.startAll();
  telegram.setChatHandler(async (text) => {
    const current = settings.get();
    const brain = brains.forTask();
    if (!brain) return "No AI model is configured or available right now.";
    const activeChar = characters.active(current);
    const system = prompt.build(current, { character: activeChar });
    let reply = "";
    try {
      await gemini.streamChat({
        brain,
        systemInstruction: system,
        temperature: prompt.temperature(current),
        history: [],
        message: text,
        onChunk: (c) => { reply += c; },
        tools: [],
      });
      return reply.trim() || "Received.";
    } catch (err) {
      return `Error generating response: ${err.message}`;
    }
  });
  telegram.start(settings.get());
  process.once("exit", () => (mcp.stopAll(), telegram.stop()));
  const connections = new Set();
  let isShuttingDown = false;

  const server = http.createServer((req, res) => {
    const startMs = performance.now();
    res.on("finish", () => {
      logger.request(req, res, performance.now() - startMs);
    });

    handle(req, res).catch((err) => {
      logger.error("Unhandled error:", err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname !== "/api/live" || !isTrustedUpgrade(req)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    live.handleUpgrade(req, socket, head);
  });

  server.on("connection", (conn) => {
    connections.add(conn);
    conn.on("close", () => connections.delete(conn));
  });

  server.listen(port, host, () => {
    const actualPort = server.address()?.port || port;
    allowedHosts = computeAllowedHosts(actualPort, host);
    logger.info(`Friends v${version} running at http://${host}:${actualPort}`);
    logger.info(`Data folder: ${dataDir}`);
    logger.info(`Allowed hosts: ${allowedHosts.join(", ")}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`Port ${port} is already in use. Try: PORT=3001 npm start`);
    } else {
      logger.error("Server startup error:", err.message);
    }
    process.exit(1);
  });

  function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    mcp.stopAll();
    telegram.stop();

    server.close(() => {
      logger.info("Closed HTTP server. Exiting process.");
      process.exit(0);
    });

    const timeout = setTimeout(() => {
      logger.warn("Forcing shutdown after timeout with lingering connections.");
      for (const conn of connections) {
        conn.destroy();
      }
      process.exit(1);
    }, 5000);
    timeout.unref();
  }

  if (require.main === module) {
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  }

  return server;
}

if (require.main === module) start();

module.exports = { start, handle, computeAllowedHosts, setNativeNotify };
