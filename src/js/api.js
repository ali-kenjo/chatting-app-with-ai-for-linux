// Talks to the Friends helper (server/server.js) that serves this page.
import { t } from "./i18n.js";

// The helper's messages are English; the ones with a fixed text have translations (i18n/elsewhere.js)
const said = (message) => (typeof message === "string" ? t(message) : message);
const OFFLINE = "Can't reach the Friends helper. Is `npm start` still running?";

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(t(OFFLINE));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(said(data.error) || t("Request failed ({status}).", { status: res.status }));
  return data;
}

// Read the helper's newline-separated JSON events as they arrive
async function streamChat(request, signal, handlers) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") return handlers.onDone({ stopped: true });
    return handlers.onError(t(OFFLINE));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return handlers.onError(said(data.error) || t("Request failed ({status}).", { status: res.status }));
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "chat") handlers.onChat({ id: event.id, title: event.title, userId: event.userId, replyId: event.replyId });
        else if (event.type === "text") handlers.onText(event.text);
        else if (event.type === "activity") handlers.onActivity?.(event.text);
        else if (event.type === "draft") handlers.onDraft?.(event.draft);
        else if (event.type === "route") handlers.onRoute?.(event);
        else if (event.type === "robot") handlers.onRobot?.({ mood: event.mood, gesture: event.gesture });
        else if (event.type === "confirm") handlers.onConfirm?.({ id: event.id, summary: event.summary, details: event.details });
        else if (event.type === "done") return handlers.onDone({ stopped: false });
        else if (event.type === "error") return handlers.onError(event.error);
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return handlers.onDone({ stopped: true });
    return handlers.onError(t(OFFLINE));
  }
  // The stream ended without "done": stopped, or the helper went away
  handlers.onDone({ stopped: true });
}

const running = new Map();
let nextRequestId = 1;

export const api = {
  brains: {
    list: () => call("GET", "/api/brains"),
    save: (brain) => call("POST", "/api/brains", brain),
    remove: (id) => call("DELETE", `/api/brains/${id}`),
    setDefault: (id) => call("POST", `/api/brains/${id}/default`),
    setEnabled: (id, enabled) => call("POST", `/api/brains/${id}/enabled`, { enabled }),
    models: (query) => call("POST", "/api/models", query),
    test: (id) => call("POST", `/api/brains/${id}/test`),
    testConfig: (data) => call("POST", "/api/brains/test", data),
  },
  chats: {
    list: () => call("GET", "/api/chats"),
    get: (id) => call("GET", `/api/chats/${encodeURIComponent(id)}`),
    rename: (id, title) => call("PATCH", `/api/chats/${encodeURIComponent(id)}`, { title }),
    remove: (id) => call("DELETE", `/api/chats/${encodeURIComponent(id)}`),
    search: (q) => call("GET", `/api/chats/search?q=${encodeURIComponent(q)}`),
    // changes: { liked } or { pinned }
    mark: (id, messageId, changes) =>
      call("PATCH", `/api/chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, changes),
    suggestions: (id) => call("POST", `/api/chats/${encodeURIComponent(id)}/suggestions`),
  },
  google: {
    config: () => call("GET", "/api/firebase-config"),
    saveConfig: (config) => call("PUT", "/api/firebase-config", { config }),
    removeConfig: () => call("DELETE", "/api/firebase-config"),
  },
  local: {
    servers: () => call("GET", "/api/local/servers"),
    voice: () => call("GET", "/api/voice/local"),
    // Gets a local model (and, for voice mode, the speech models) ready before the first message
    warm: (brainId, voice = false) => call("POST", "/api/local/warm", { brainId, voice }).catch(() => ({})),
    installVoice: () => call("POST", "/api/voice/local/install"),
  },
  settings: {
    get: () => call("GET", "/api/settings"),
    save: (settings) => call("PUT", "/api/settings", settings),
  },
  notes: {
    list: () => call("GET", "/api/notes"),
    save: (id, note) => call("PUT", `/api/notes/${id}`, note),
    remove: (id) => call("DELETE", `/api/notes/${id}`),
    clear: () => call("DELETE", "/api/notes"),
  },
  characters: {
    meta: () => call("GET", "/api/characters/meta"),
  },
  activities: () => call("GET", "/api/activities"),
  episodes: {
    list: () => call("GET", "/api/episodes"),
    remove: (chatId) => call("DELETE", `/api/episodes/${encodeURIComponent(chatId)}`),
    clear: () => call("DELETE", "/api/episodes"),
    resolve: (id) => call("DELETE", `/api/follow-ups/${encodeURIComponent(id)}`),
  },
  connectors: {
    list: () => call("GET", "/api/connectors"),
    save: (id, body) => call("PUT", `/api/connectors/${encodeURIComponent(id)}`, body),
    remove: (id) => call("DELETE", `/api/connectors/${encodeURIComponent(id)}`),
    test: (id) => call("POST", `/api/connectors/${encodeURIComponent(id)}/test`),
  },
  mcp: {
    save: (server) => call("POST", "/api/mcp", server),
    remove: (id) => call("DELETE", `/api/mcp/${encodeURIComponent(id)}`),
    restart: (id) => call("POST", `/api/mcp/${encodeURIComponent(id)}/restart`),
  },
  builder: {
    running: () => call("GET", "/api/builder/running"),
    stop: (id) => call("POST", `/api/builder/${encodeURIComponent(id)}/stop`),
  },
  life: {
    today: () => call("GET", "/api/life/today"),
    tasks: (done = false) => call("GET", `/api/life/tasks${done ? "?done=1" : ""}`),
    addTask: (task) => call("POST", "/api/life/tasks", task),
    updateTask: (id, changes) => call("PATCH", `/api/life/tasks/${encodeURIComponent(id)}`, changes),
    removeTask: (id) => call("DELETE", `/api/life/tasks/${encodeURIComponent(id)}`),
    reminders: () => call("GET", "/api/life/reminders"),
    addReminder: (r) => call("POST", "/api/life/reminders", r),
    snooze: (id, minutes) => call("POST", `/api/life/reminders/${encodeURIComponent(id)}/snooze`, { minutes }),
    removeReminder: (id) => call("DELETE", `/api/life/reminders/${encodeURIComponent(id)}`),
    habits: () => call("GET", "/api/life/habits"),
    addHabit: (h) => call("POST", "/api/life/habits", h),
    logHabit: (id, body) => call("POST", `/api/life/habits/${encodeURIComponent(id)}/log`, body),
    removeHabit: (id) => call("DELETE", `/api/life/habits/${encodeURIComponent(id)}`),
    journal: (days = 30) => call("GET", `/api/life/journal?days=${days}`),
    addEntry: (e) => call("POST", "/api/life/journal", e),
    removeEntry: (id) => call("DELETE", `/api/life/journal/${encodeURIComponent(id)}`),
    briefing: (googleAccessToken) => call("POST", "/api/life/briefing", { googleAccessToken }),
  },
  backups: {
    list: () => call("GET", "/api/backups"),
    create: () => call("POST", "/api/backups"),
    remove: (name) => call("DELETE", `/api/backups/${encodeURIComponent(name)}`),
    restore: (name, mode) => call("POST", `/api/backups/${encodeURIComponent(name)}/restore?mode=${mode}`),
    async import(file, mode) {
      let res;
      try {
        res = await fetch(`/api/backups/import?mode=${mode}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
      } catch {
        throw new Error(t(OFFLINE));
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(said(data.error) || t("Import failed."));
      return data;
    },
  },
  confirm: (id, allow) => call("POST", `/api/confirm/${id}`, { allow }),
  news: (q) => call("GET", `/api/news?q=${encodeURIComponent(q || "")}`),
  attachments: {
    async upload(file) {
      let res;
      try {
        res = await fetch("/api/attachments", {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
      } catch {
        throw new Error(t(OFFLINE));
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(said(data.error) || t("Upload failed."));
      return data;
    },
    url: (id) => `/api/attachments/${id}`,
  },
  voice: {
    transcribe: async (wav) => {
      let res;
      try {
        res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
      } catch {
        throw new Error(t(OFFLINE));
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(said(data.error) || t("Couldn't understand the recording."));
      return data.text;
    },
    // Returns a WAV Blob
    speak: async (text, voice) => {
      let res;
      try {
        res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
      } catch {
        throw new Error(t(OFFLINE));
      }
      if (!res.ok) throw new Error(said((await res.json().catch(() => ({}))).error) || t("Couldn't create speech."));
      return res.blob();
    },
  },
  chat: {
    // request: { chatId, text, attachments, brainId, voice, robot } or { chatId, retry: true },
    //          plus from: <message id> to replace that message and what follows
    // handlers: { onChat({ id, title, userId, replyId }), onText(text), onActivity(text), onConfirm({ id, summary }),
    //             onRobot({ mood } | { gesture }), onDone({ stopped }), onError(message) }
    send(request, handlers) {
      const requestId = nextRequestId++;
      const controller = new AbortController();
      running.set(requestId, controller);
      streamChat(request, controller.signal, handlers).finally(() => running.delete(requestId));
      return requestId;
    },
    stop: (requestId) => running.get(requestId)?.abort(),
  },
};
