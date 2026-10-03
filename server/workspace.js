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
            const err = new Error(json.error?.message || json.message || `Request failed (${res.statusCode})`);
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
async function getCalendarEvents(token, maxResults = 10) {
  if (!token) throw new Error("Google account is not connected. Sign in with Google to view your calendar.");
  const now = new Date().toISOString();
  const count = Math.min(20, Math.max(1, Math.round(Number(maxResults)) || 10));
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime&maxResults=${count}`;
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

module.exports = {
  searchDrive,
  readDriveFile,
  getCalendarEvents,
  createCalendarEvent,
  searchGmail,
  sendGmail,
  searchGitHub,
};
