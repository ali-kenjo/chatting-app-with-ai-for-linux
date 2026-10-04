// Google Workspace and Cloud integrations (Drive, Calendar, Gmail, Docs, Sheets, Slides, GitHub)
const https = require("https");

const TIMEOUT_MS = 20000;

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent": "Friends-App/1.0",
        ...(options.headers || {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      res.setEncoding("utf8"); // keeps characters that span two chunks intact
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            const err = new Error(explain(json.error?.message || json.message || `Request failed (${res.statusCode})`));
            err.statusCode = res.statusCode;
            reject(err);
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Failed with status ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("Google or GitHub took too long to answer.")));
    req.on("error", reject);
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

// Google's errors, in words that say what to do
function explain(message) {
  if (/insufficient authentication scopes|insufficientPermissions/i.test(message)) {
    return "Your Google sign-in doesn't include this yet. Sign out and in again in Settings → Connected Apps to allow it.";
  }
  const api = message.match(/(\S+ API)(?: v\d+)? has not been used in project|(\S+(?: \S+)? API)(?: v\d+)? .*is disabled/i);
  if (api) return `${(api[1] || api[2]).trim()} is off for your Google project. Turn it on at console.cloud.google.com/apis/library (the project of your Firebase app), then try again.`;
  return message;
}

// ----- Google Drive & Docs / Sheets / Slides -----
async function searchDrive(token, query = "") {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to access Google Drive.");
  let q = "trashed = false";
  if (query && query.trim()) {
    const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    q += ` and (name contains '${escaped}' or fullText contains '${escaped}')`;
  }
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=10&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&orderBy=modifiedTime desc`;
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  return data.files || [];
}

async function readDriveFile(token, fileId) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to read Drive files.");
  const metaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink`;
  const meta = await fetchJson(metaUrl, { headers: { Authorization: `Bearer ${token}` } });

  let textContent = "";
  // Google Docs
  if (meta.mimeType === "application/vnd.google-apps.document") {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
    textContent = await fetchJson(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
  } else if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`;
    textContent = await fetchJson(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
  } else if (meta.mimeType === "application/vnd.google-apps.presentation") {
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
    textContent = await fetchJson(exportUrl, { headers: { Authorization: `Bearer ${token}` } });
  } else {
    const contentUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    textContent = await fetchJson(contentUrl, { headers: { Authorization: `Bearer ${token}` } });
  }

  const snippet = typeof textContent === "string" ? textContent.slice(0, 8000) : JSON.stringify(textContent).slice(0, 8000);
  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    link: meta.webViewLink,
    content: snippet,
  };
}

// ----- Google Calendar -----
// Upcoming events, or the ones between two dates (from/to: YYYY-MM-DD or ISO times)
async function getCalendarEvents(token, maxResults = 10, { from, to } = {}) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to view your calendar.");
  const start = from ? new Date(/T/.test(from) ? from : `${from}T00:00`) : new Date();
  const end = to ? new Date(/T/.test(to) ? to : `${to}T23:59:59`) : null;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) throw new Error("Use dates like 2026-10-05.");
  const count = Math.min(50, Math.max(1, Math.round(Number(maxResults)) || 10));
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(start.toISOString())}${end ? `&timeMax=${encodeURIComponent(end.toISOString())}` : ""}&singleEvents=true&orderBy=startTime&maxResults=${count}`;
  const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  return (data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || "(No Title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || "",
    description: e.description ? e.description.slice(0, 200) : "",
    link: e.htmlLink,
  }));
}

async function createCalendarEvent(token, { summary, description = "", start, end, location = "" }) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to add calendar events.");
  const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  if (typeof start !== "string" || typeof end !== "string" || !start || !end) throw new Error("The event needs a start and an end time.");
  const body = {
    summary,
    description,
    location,
    start: start.includes("T") ? { dateTime: start } : { date: start },
    end: end.includes("T") ? { dateTime: end } : { date: end },
  };
  const event = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  return {
    id: event.id,
    summary: event.summary,
    start: event.start?.dateTime || event.start?.date,
    link: event.htmlLink,
  };
}

// ----- Gmail -----
async function searchGmail(token, query = "in:inbox", maxResults = 8) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to check Gmail.");
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const list = await fetchJson(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!list.messages || !list.messages.length) return [];

  const results = [];
  for (const m of list.messages.slice(0, 6)) {
    try {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`;
      const msg = await fetchJson(msgUrl, { headers: { Authorization: `Bearer ${token}` } });
      const headers = msg.payload?.headers || [];
      const getHeader = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      results.push({
        id: msg.id,
        threadId: msg.threadId,
        snippet: msg.snippet,
        from: getHeader("From"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
      });
    } catch {}
  }
  return results;
}

async function sendGmail(token, { to, subject, body }) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to send emails.");
  // A line break in the address would let the AI add headers (e.g. a hidden Bcc)
  to = String(to ?? "").trim();
  if (!/^[^\s<>,;]+@[^\s<>,;]+$/.test(to) && !/^[^<>\r\n,;]*<[^\s<>,;]+@[^\s<>,;]+>$/.test(to)) throw new Error("That isn't a single valid email address.");
  const utf8Subject = `=?utf-8?B?${Buffer.from(String(subject ?? "")).toString("base64")}?=`;
  const messageParts = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${utf8Subject}`,
    "",
    String(body ?? ""),
  ];
  const message = messageParts.join("\r\n");
  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
  const res = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: { raw: encoded },
  });
  return { id: res.id, to, subject, status: "sent" };
}

// ----- GitHub -----
async function searchGitHub(query = "stars:>1000", sort = "stars") {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=6`;
  const data = await fetchJson(url);
  return (data.items || []).map((repo) => ({
    name: repo.full_name,
    description: repo.description || "",
    stars: repo.stargazers_count,
    language: repo.language || "",
    url: repo.html_url,
    updatedAt: repo.updated_at,
  }));
}

async function updateCalendarEvent(token, { eventId, summary, description, start, end, location }) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to change your calendar.");
  const body = {};
  if (summary !== undefined) body.summary = summary;
  if (description !== undefined) body.description = description;
  if (location !== undefined) body.location = location;
  if (start) body.start = start.includes("T") ? { dateTime: start } : { date: start };
  if (end) body.end = end.includes("T") ? { dateTime: end } : { date: end };
  const event = await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  return { id: event.id, summary: event.summary, start: event.start?.dateTime || event.start?.date, link: event.htmlLink };
}

async function deleteCalendarEvent(token, eventId) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to change your calendar.");
  await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  return { ok: true };
}

// ----- Gmail: one whole message, and drafts -----
const b64url = (s) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

// The text of a message: its text/plain part, else its HTML without tags
function messageText(payload) {
  const parts = [];
  const walk = (p) => {
    if (!p) return;
    if (p.parts) p.parts.forEach(walk);
    else if (p.body?.data) parts.push({ type: p.mimeType, text: b64url(p.body.data) });
  };
  walk(payload);
  const plain = parts.find((p) => p.type === "text/plain");
  if (plain) return plain.text;
  const html = parts.find((p) => p.type === "text/html");
  return html ? require("./net").htmlToText(html.text).text : "";
}

async function readGmail(token, id) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to read Gmail.");
  const msg = await fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  const headers = msg.payload?.headers || [];
  const header = (name) => headers.find((h) => h.name.toLowerCase() === name)?.value || "";
  return { id: msg.id, threadId: msg.threadId, from: header("from"), to: header("to"), subject: header("subject"), date: header("date"), body: messageText(msg.payload).slice(0, 20000) };
}

function rawMessage({ to, subject, body }) {
  to = String(to ?? "").trim();
  if (!/^[^\s<>,;]+@[^\s<>,;]+$/.test(to) && !/^[^<>\r\n,;]*<[^\s<>,;]+@[^\s<>,;]+>$/.test(to)) throw new Error("That isn't a single valid email address.");
  const message = [`To: ${to}`, "Content-Type: text/plain; charset=utf-8", "MIME-Version: 1.0", `Subject: =?utf-8?B?${Buffer.from(String(subject ?? "")).toString("base64")}?=`, "", String(body ?? "")].join("\r\n");
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function draftGmail(token, args) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to write drafts.");
  const draft = await fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: { message: { raw: rawMessage(args) } },
  });
  return { id: draft.id, to: args.to, subject: args.subject, status: "draft saved in Gmail" };
}

// ----- YouTube (your channel, and search) -----
const YT = "https://www.googleapis.com/youtube/v3";
const yt = (token, path) => {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to use YouTube.");
  return fetchJson(`${YT}${path}`, { headers: { Authorization: `Bearer ${token}` } });
};

const videoInfo = (v) => ({
  id: v.id,
  title: v.snippet?.title,
  published: v.snippet?.publishedAt,
  views: Number(v.statistics?.viewCount || 0),
  likes: Number(v.statistics?.likeCount || 0),
  comments: Number(v.statistics?.commentCount || 0),
  duration: v.contentDetails?.duration,
  url: `https://www.youtube.com/watch?v=${v.id}`,
});

// A video id from an id or a youtube.com / youtu.be link
function videoId(value) {
  const v = String(value || "").trim();
  const m = v.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || v.match(/^([\w-]{11})$/);
  if (!m) throw new Error("That isn't a YouTube video id or link.");
  return m[1];
}

async function youtubeSearch(token, query, type = "video") {
  const t = ["video", "channel", "playlist"].includes(type) ? type : "video";
  const data = await yt(token, `/search?part=snippet&maxResults=10&type=${t}&q=${encodeURIComponent(query)}`);
  return (data.items || []).map((i) => ({ id: i.id.videoId || i.id.channelId || i.id.playlistId, title: i.snippet?.title, channel: i.snippet?.channelTitle, published: i.snippet?.publishedAt, description: (i.snippet?.description || "").slice(0, 200) }));
}

async function youtubeMyChannel(token) {
  const data = await yt(token, "/channels?part=snippet,statistics,contentDetails&mine=true");
  const c = data.items?.[0];
  if (!c) return { channel: null, note: "This Google account has no YouTube channel." };
  const uploads = c.contentDetails?.relatedPlaylists?.uploads;
  let recent = [];
  if (uploads) {
    const items = await yt(token, `/playlistItems?part=contentDetails&maxResults=10&playlistId=${uploads}`);
    const ids = (items.items || []).map((i) => i.contentDetails.videoId).join(",");
    if (ids) recent = ((await yt(token, `/videos?part=snippet,statistics,contentDetails&id=${ids}`)).items || []).map(videoInfo);
  }
  return {
    channel: { name: c.snippet?.title, subscribers: Number(c.statistics?.subscriberCount || 0), views: Number(c.statistics?.viewCount || 0), videos: Number(c.statistics?.videoCount || 0), url: `https://www.youtube.com/channel/${c.id}` },
    recentVideos: recent,
  };
}

async function youtubeVideo(token, video) {
  const data = await yt(token, `/videos?part=snippet,statistics,contentDetails&id=${videoId(video)}`);
  const v = data.items?.[0];
  if (!v) throw new Error("That video wasn't found.");
  return { ...videoInfo(v), channel: v.snippet?.channelTitle, description: (v.snippet?.description || "").slice(0, 2000), tags: v.snippet?.tags?.slice(0, 20) };
}

async function youtubeComments(token, video, max = 20) {
  const n = Math.min(50, Math.max(1, Math.round(Number(max)) || 20));
  const data = await yt(token, `/commentThreads?part=snippet&order=relevance&maxResults=${n}&videoId=${videoId(video)}`);
  return (data.items || []).map((t) => {
    const c = t.snippet?.topLevelComment?.snippet || {};
    return { author: c.authorDisplayName, text: String(c.textOriginal || "").slice(0, 500), likes: c.likeCount, replies: t.snippet?.totalReplyCount, published: c.publishedAt };
  });
}

// ----- Google Tasks -----
const TASKS = "https://tasks.googleapis.com/tasks/v1";

async function googleTasks(token, { showCompleted = false } = {}) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to use Google Tasks.");
  const lists = await fetchJson(`${TASKS}/users/@me/lists?maxResults=20`, { headers: { Authorization: `Bearer ${token}` } });
  const out = [];
  for (const l of (lists.items || []).slice(0, 5)) {
    const items = await fetchJson(`${TASKS}/lists/${encodeURIComponent(l.id)}/tasks?maxResults=50&showCompleted=${showCompleted}&showHidden=${showCompleted}`, { headers: { Authorization: `Bearer ${token}` } });
    out.push({ list: l.title, listId: l.id, tasks: (items.items || []).map((t) => ({ id: t.id, title: t.title, notes: t.notes || undefined, due: t.due?.slice(0, 10), status: t.status })) });
  }
  return out;
}

async function googleAddTask(token, { title, notes, due, listId = "@default" }) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to use Google Tasks.");
  const body = { title: String(title || "").slice(0, 500) };
  if (notes) body.notes = String(notes);
  if (due) body.due = `${String(due).slice(0, 10)}T00:00:00.000Z`;
  const t = await fetchJson(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });
  return { id: t.id, title: t.title, due: t.due?.slice(0, 10) };
}

async function googleCompleteTask(token, { id, listId = "@default" }) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to use Google Tasks.");
  const t = await fetchJson(`${TASKS}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: { status: "completed" } });
  return { id: t.id, title: t.title, status: t.status };
}

module.exports = {
  explain,
  updateCalendarEvent,
  deleteCalendarEvent,
  readGmail,
  draftGmail,
  messageText,
  videoId,
  youtubeSearch,
  youtubeMyChannel,
  youtubeVideo,
  youtubeComments,
  googleTasks,
  googleAddTask,
  googleCompleteTask,
  searchDrive,
  readDriveFile,
  getCalendarEvents,
  createCalendarEvent,
  searchGmail,
  sendGmail,
  searchGitHub,
};
