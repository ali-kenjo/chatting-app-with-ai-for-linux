// Talks to the Friends helper (server/server.js) that serves this page.
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
    throw new Error(OFFLINE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
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
    return handlers.onError(OFFLINE);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return handlers.onError(data.error || `Request failed (${res.status}).`);
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
        else if (event.type === "robot") handlers.onRobot?.({ mood: event.mood, gesture: event.gesture });
        else if (event.type === "confirm") handlers.onConfirm?.({ id: event.id, summary: event.summary, details: event.details });
        else if (event.type === "done") return handlers.onDone({ stopped: false });
        else if (event.type === "error") return handlers.onError(event.error);
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return handlers.onDone({ stopped: true });
    return handlers.onError(OFFLINE);
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
        throw new Error(OFFLINE);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
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
        throw new Error(OFFLINE);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't understand the recording.");
      return data.text;
    },
    // Returns a WAV Blob
    speak: async (text, voice) => {
      let res;
      try {
        res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
      } catch {
        throw new Error(OFFLINE);
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't create speech.");
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
