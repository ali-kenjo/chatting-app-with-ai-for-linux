// Telegram Bot companion: enables remote interaction with Friends from anywhere
// (phone, laptop, tablet) via your own private Telegram bot.
// Uses long polling (no open ports or public IP needed).
// All messages and voice notes are handled locally and kept private.
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const keys = require("./keys");
const logger = require("./logger");
const life = require("./life");
const localNotes = require("./local-notes");

const configFile = path.join(dataDir, "telegram.json");
const TOKEN_KEY = "telegram-bot-token";

function loadConfig() {
  try {
    const raw = fs.readFileSync(configFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return { enabled: false, allowedUsers: "", notifyReminders: true };
  }
}

function saveConfig(cfg) {
  const current = loadConfig();
  const next = { ...current, ...cfg };
  if (typeof cfg.token === "string" && cfg.token.trim()) {
    keys.setSecret(TOKEN_KEY, cfg.token.trim());
  } else if (cfg.token === null) {
    keys.deleteSecret(TOKEN_KEY);
  }
  delete next.token; // token kept in secure keyring / secrets.json
  writeJson(configFile, next);
  restart();
  return status();
}

function getToken() {
  return keys.getSecret(TOKEN_KEY) || process.env.FRIENDS_TELEGRAM_BOT_TOKEN || "";
}

function status() {
  const cfg = loadConfig();
  const hasToken = Boolean(getToken());
  return {
    enabled: cfg.enabled === true,
    hasToken,
    allowedUsers: cfg.allowedUsers || "",
    notifyReminders: cfg.notifyReminders !== false,
    running: isPolling,
  };
}

let isPolling = false;
let pollAbort = null;
let offset = 0;
let chatHandler = null; // injected by server.js

function setChatHandler(fn) {
  chatHandler = fn;
}

function apiCall(method, params = {}, token = getToken()) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error("No Telegram bot token configured."));
    const postData = JSON.stringify(params);
    const req = https.request(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 35000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.ok) resolve(data.result);
            else reject(new Error(data.description || `Telegram error ${res.statusCode}`));
          } catch (e) {
            reject(new Error(`Failed to parse Telegram response: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Telegram API timeout")));
    req.write(postData);
    req.end();
  });
}

function sendMessage(chatId, text, opts = {}) {
  return apiCall("sendMessage", {
    chat_id: chatId,
    text: String(text || "").slice(0, 4000),
    parse_mode: opts.markdown ? "Markdown" : undefined,
  }).catch((err) => logger.warn(`Telegram sendMessage to ${chatId} failed:`, err.message));
}

// Push notification when a reminder or briefing fires
function onLifeEvent(event) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.notifyReminders) return;
  const users = (cfg.allowedUsers || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!users.length) return;

  let message = "";
  if (event.type === "focus-ended") {
    message = `🎯 Focus Session Complete: ${event.text || ""}`;
  } else if (event.type === "reminder" || event.text) {
    message = `⏰ Reminder: ${event.text || ""}`;
  } else if (event.title) {
    message = `☀️ ${event.title}`;
  }

  if (message) {
    for (const user of users) {
      sendMessage(user, message);
    }
  }
}

async function handleMessage(msg) {
  const cfg = loadConfig();
  const fromId = String(msg.from?.id || "");
  const allowed = (cfg.allowedUsers || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Security: only allowed user IDs can interact with your private AI
  if (allowed.length && !allowed.includes(fromId)) {
    logger.warn(`Rejected unauthorized Telegram message from ${fromId}`);
    return;
  }

  const chatId = msg.chat?.id;
  const text = (msg.text || "").trim();

  // Basic commands
  if (text === "/start") {
    return sendMessage(
      chatId,
      "👋 Hello! I am your Friends personal AI companion.\n\n" +
        "You can chat with me, manage tasks, set reminders, or dictate notes.\n" +
        "Commands:\n" +
        "• /today - Summary of tasks, events & habits\n" +
        "• /tasks - List open tasks\n" +
        "• /remind <text> in <mins> - Set a reminder\n" +
        "• /note <text> - Append to local notes\n" +
        "Or simply send any message or voice note!"
    );
  }

  if (text === "/today" || text === "/briefing") {
    const t = life.today();
    const agendaLines = life.agenda();
    const reply = [`📅 Today (${t.date}):`, ...agendaLines].join("\n");
    return sendMessage(chatId, reply);
  }

  if (text === "/tasks") {
    const tasks = life.listTasks().filter((t) => !t.done);
    if (!tasks.length) return sendMessage(chatId, "No open tasks! 🎉");
    const lines = tasks.slice(0, 15).map((t) => `• ${t.title}${t.due ? ` (due ${t.due})` : ""}`);
    return sendMessage(chatId, `📋 Open Tasks:\n${lines.join("\n")}`);
  }

  if (text.startsWith("/remind ")) {
    const match = text.slice(8).match(/^(.*?)\s+in\s+(\d+)\s*(?:m|min|mins|minutes)?$/i);
    if (match) {
      const what = match[1].trim();
      const mins = Number(match[2]);
      const r = life.addReminder({ text: what, in_minutes: mins });
      return sendMessage(chatId, `⏰ Reminder set for "${what}" in ${mins} minute(s).`);
    }
  }

  if (text.startsWith("/note ")) {
    const noteContent = text.slice(6).trim();
    if (noteContent) {
      await localNotes.appendToNote(null, "today", noteContent);
      return sendMessage(chatId, `📝 Note appended to today's daily notes.`);
    }
  }

  // Handle conversational response via chatHandler
  if (chatHandler && text) {
    try {
      const reply = await chatHandler(text, { user: fromId, platform: "telegram" });
      if (reply) sendMessage(chatId, reply);
    } catch (err) {
      sendMessage(chatId, `⚠️ Sorry, couldn't answer: ${err.message}`);
    }
  }
}

async function poll() {
  const token = getToken();
  if (!token || !loadConfig().enabled) {
    isPolling = false;
    return;
  }
  isPolling = true;

  try {
    const updates = await apiCall("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      offset = update.update_id + 1;
      if (update.message) {
        handleMessage(update.message).catch((err) => logger.warn("Telegram handleMessage error:", err.message));
      }
    }
  } catch (err) {
    if (err.message && !err.message.includes("timeout")) {
      logger.debug("Telegram polling notice:", err.message);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  if (isPolling) {
    setImmediate(poll);
  }
}

function start() {
  const cfg = loadConfig();
  if (!cfg.enabled || !getToken() || isPolling) return;
  logger.info("Starting Telegram Bot listener...");
  offset = 0;
  life.onReminder(onLifeEvent);
  poll();
}

function stop() {
  isPolling = false;
  logger.info("Stopped Telegram Bot listener.");
}

function restart() {
  stop();
  const cfg = loadConfig();
  if (cfg.enabled && getToken()) {
    setTimeout(start, 500);
  }
}

async function testConnection(token = getToken()) {
  if (!token) throw new Error("No token provided.");
  const me = await apiCall("getMe", {}, token);
  return { ok: true, bot: me };
}

module.exports = {
  status,
  saveConfig,
  start,
  stop,
  restart,
  testConnection,
  sendMessage,
  setChatHandler,
};
