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
const { VOICES } = require("./voices");

const PORT = defaultPort;
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
function toContents(messages, start = 0) {
  const windowed = messages.slice(start);
  const userIndexes = windowed.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const recent = new Set(userIndexes.slice(-10));
  return windowed.map((m, i) => {
    const parts = [];
    for (const file of m.attachments || []) {
      const part = recent.has(i) ? attachments.toPart(file.id) : null;
      parts.push(part || { text: `[Earlier attachment: ${file.name}]` });
    }
    if (m.text) parts.push({ text: m.text });
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
  const { chatId = null, text = "", retry = false, from = null, force = null, brainId = null, voice = false, robot: robotOnScreen = false, attachments: files = [], googleAccessToken } = await readJson(req);
  const activeToken = googleAccessToken || headerToken;
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
  if (!retry && (typeof text !== "string" || (!text.trim() && !attached.length))) return sendJson(res, 400, { error: "The message is empty." });

  let conversation;
  try {
    conversation = chatId ? chats.get(chatId) : chats.create(text.trim() || attached[0].name);
    if (chatId && from) chats.truncate(conversation, from);
  } catch (err) {
    return sendJson(res, 404, { error: err.message });
  }
  let userId = null;
  if (retry) {
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
  const send = (event) => !res.writableEnded && res.write(JSON.stringify(event) + "\n");
  send({ type: "chat", id: conversation.id, title: conversation.title, userId, replyId });

  // Pressing stop closes the request; stop asking the provider too
  const controller = new AbortController();
  const closeHandlers = [];
  res.on("close", () => {
    controller.abort();
    closeHandlers.forEach((fn) => fn());
  });

  const current = settings.get();
  const window = current.aiControl?.contextWindow || 20;
  const lastUser = conversation.messages.at(-1);

  // Which AI answers: see router.js (the routing mode in Settings → AI control)
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
    const offered = tools.declarations(current, { voice, robot: robotOnScreen === true, workspace: brain.provider !== "local" || Boolean(activeToken) });
    await brain.api.streamChat({
      key: brain.key,
      model: brain.model,
      contents: toContents(conversation.messages, summary.windowStart(conversation, window)),
      system: prompt.build(current, { voice, toolsOffered: offered, summary: conversation.summary?.text }),
      temperature: prompt.temperature(current),
      fast: voice || current.aiControl?.reasoningEffort === "fast",
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
      const message = { id: replyId, role: "model", text: reply, at: Date.now() };
      if (activity.length) message.activity = activity;
      if (drafts.length) message.drafts = drafts;
      if (answeredBy && routePlan.mode !== "fixed") message.via = { kind: answeredBy.kind, name: answeredBy.brain.name, model: answeredBy.brain.model, reason: answeredBy.reason, mode: routePlan.mode };
      conversation.messages.push(message);
    }
    if (reply || activity.length || drafts.length || conversation.cloudOk) chats.save(conversation);
  }
  res.end();
  // Long chats: summarize what dropped out of the window, in the background. With a choice
  // of AIs a local one does it (private and free).
  const summarizer = answeredBy && (routePlan.mode === "fixed" || routePlan.mode === "force") ? answeredBy.brain : brains.forTask() || answeredBy?.brain;
  if (summarizer) summary.update(conversation.id, { api: summarizer.api, key: summarizer.key, model: summarizer.model, window }).catch((err) => logger.debug("Summary skipped:", err.message));
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
    const wav = await brain.api.speak({ key: brain.key, text: text.slice(0, 4000), voice: VOICES[voice] || VOICES[settings.get().personality.voice] });
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
  ["DELETE", /^\/api\/chats\/([\w-]+)$/, (req, id) => chats.remove(id)],
  ["PATCH", /^\/api\/chats\/([\w-]+\/messages\/[\w-]+)$/, (req, ids) => markMessage(req, ...ids.split("/messages/"))],
  ["POST", /^\/api\/chats\/([\w-]+)\/suggestions$/, (req, id) => suggestions(id)],

  ["GET", /^\/api\/settings$/, () => settings.get()],
  ["PUT", /^\/api\/settings$/, async (req) => settings.set(await readJson(req))],

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
    if (settings.get().privacy.localOnly) return {}; // Private mode: no Google sign-in
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "firebase-applet-config.json"), "utf8"));
    } catch {
      return {};
    }
  }],

  ["GET", /^\/api\/news$/, async (req, id, url) => {
    if (settings.get().privacy.localOnly) throw new Error("Private mode is on, so the news is off.");
    const news = require("./news");
    return news.getNews(url.searchParams.get("q") || "");
  }],

  ["POST", /^\/api\/attachments$/, (req) => upload(req)],
  ["POST", /^\/api\/voice\/transcribe$/, (req) => transcribe(req)],

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
  if (pathname === "/api/voice/speak" && req.method === "POST") return speak(req, res);
  const file = pathname.match(/^\/api\/attachments\/([\w-]+)$/);
  if (file && req.method === "GET") return download(req, res, file[1]);
  if (pathname === "/api/robot/model" && (req.method === "GET" || req.method === "HEAD")) return sendModel(req, res);

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

module.exports = { start, handle, computeAllowedHosts };
