// Finds AI model servers running on this computer, so Settings can offer them
// with one click. Only 127.0.0.1 is asked, with a short timeout.
const KNOWN = [
  { label: "Ollama", url: "http://127.0.0.1:11434", protocol: "ollama" },
  { label: "LM Studio", url: "http://127.0.0.1:1234/v1", protocol: "openai" },
  { label: "llama.cpp or LocalAI", url: "http://127.0.0.1:8080/v1", protocol: "openai" },
  { label: "Jan", url: "http://127.0.0.1:1337/v1", protocol: "openai" },
  { label: "vLLM", url: "http://127.0.0.1:8000/v1", protocol: "openai" },
  { label: "KoboldCpp", url: "http://127.0.0.1:5001/v1", protocol: "openai" },
];

// Tests (and unusual setups) can name other servers: FRIENDS_LOCAL_SERVERS='[{"label":"X","url":"http://127.0.0.1:9/v1","protocol":"openai"}]'
let SERVERS = KNOWN;
try {
  if (process.env.FRIENDS_LOCAL_SERVERS) SERVERS = JSON.parse(process.env.FRIENDS_LOCAL_SERVERS);
} catch {}

const NOT_CHAT = /embed|rerank|whisper|tts|bge-|nomic-bert/i;

async function probe(server, timeoutMs) {
  try {
    const res = await fetch(`${server.url}${server.protocol === "ollama" ? "/api/tags" : "/models"}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ...server, running: false, models: [] };
    const data = await res.json();
    const items = data.models || data.data || (Array.isArray(data) ? data : []);
    const models = items.map((m) => (typeof m === "string" ? m : m.name || m.id)).filter((n) => typeof n === "string" && n && !NOT_CHAT.test(n));
    return { ...server, running: true, models };
  } catch {
    return { ...server, running: false, models: [] };
  }
}

// [{ label, url, protocol, running, models }] for every known server
const detect = ({ timeoutMs = 700, servers = SERVERS } = {}) => Promise.all(servers.map((s) => probe(s, timeoutMs)));

module.exports = { SERVERS, detect };
