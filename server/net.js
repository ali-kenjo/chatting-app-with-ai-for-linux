// Fetching from the internet on the AI's behalf, safely. readPage() opens a web
// page the AI asks for, but never one on this computer or your home network
// (the address is checked after the name is looked up, and again on every
// redirect), with a size and time limit; its HTML becomes plain text.
const dns = require("dns");
const http = require("http");
const https = require("https");
const net = require("net");

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;
const AGENT = "Mozilla/5.0 (X11; Linux x86_64) Friends/1.0 (personal AI app)";

// Loopback, private, link-local, carrier-grade NAT, multicast and other
// addresses that aren't the public internet
function isPrivateAddress(address) {
  let ip = String(address || "").toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7); // IPv4 written as IPv6
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || ip.startsWith("64:ff9b:") || ip.startsWith("2001:db8:");
  }
  return true; // not an address at all: refuse
}

// A DNS lookup that refuses private addresses (used for every connection, so a
// name can't point somewhere else between the check and the connection)
function publicLookup(hostname, options, callback) {
  if (typeof options === "function") [callback, options] = [options, {}];
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} is on this computer or a private network, which the AI can't open.`), { code: "PRIVATE_ADDRESS" }));
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

// GET a public http(s) URL. Returns { url, status, type, body (Buffer) }.
function getPublic(url, { redirects = 0, accept = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error("That isn't a web address."));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("Only http and https pages can be opened."));
    if (u.username || u.password) return reject(new Error("Addresses with a password in them can't be opened."));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new Error("That address is on this computer or a private network, which the AI can't open."));
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(u, { headers: { "User-Agent": AGENT, Accept: accept, "Accept-Language": "en,de;q=0.8,*;q=0.5" }, lookup: publicLookup, timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error("The page redirects too many times."));
        return getPublic(new URL(res.headers.location, u).href, { redirects: redirects + 1, accept }).then(resolve, reject);
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy();
          resolve({ url: u.href, status: res.statusCode, type: String(res.headers["content-type"] || ""), body: Buffer.concat(chunks), truncated: true });
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ url: u.href, status: res.statusCode, type: String(res.headers["content-type"] || ""), body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The page took too long to answer.")));
    req.on("error", reject);
  });
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", euro: "€", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß" };

function decode(text) {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

// HTML → { title, text }: the article or main part when there is one, as readable lines
function htmlToText(html) {
  let h = String(html);
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim());
  h = h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || h.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  if (main && main.length > 500) h = main;
  h = h
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/(p|div|section|h[1-6]|tr|blockquote|pre|table|ul|ol|header)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(h)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter((l, i, all) => l || (all[i - 1] && all[i - 1].trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

// read_webpage: the page's readable text, up to `max` characters
async function readPage(url, { max = 20000 } = {}) {
  const res = await getPublic(url);
  if (res.status >= 400) throw new Error(`The page answered with an error (${res.status}).`);
  const type = res.type.toLowerCase();
  const raw = res.body.toString("utf8");
  let title = "";
  let text;
  if (type.includes("html") || /^\s*<(!doctype|html)/i.test(raw)) ({ title, text } = htmlToText(raw));
  else if (type.startsWith("text/") || type.includes("json") || type.includes("xml")) text = raw;
  else throw new Error(`That's not a web page the AI can read (${type || "unknown type"}).`);
  return { url: res.url, title, text: text.slice(0, max), truncated: text.length > max || res.truncated === true };
}

// fetch() with a time limit and a clear error, for the connectors' APIs
async function api(url, { method = "GET", headers = {}, body, timeout = 20000, what = "The service" } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { "User-Agent": AGENT, Accept: "application/json", ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new Error(err.name === "TimeoutError" ? `${what} took too long to answer.` : `Couldn't reach ${what.toLowerCase()} (${err.cause?.code || err.message}).`);
  }
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) {
    const message = data?.error?.message || data?.message || data?.error_description || (typeof data?.error === "string" ? data.error : "") || (typeof data === "string" ? data.slice(0, 200) : "");
    throw Object.assign(new Error(`${what} said no (${res.status})${message ? `: ${message}` : ""}.`), { status: res.status });
  }
  return data;
}

module.exports = { isPrivateAddress, publicLookup, getPublic, htmlToText, readPage, decode, api };
