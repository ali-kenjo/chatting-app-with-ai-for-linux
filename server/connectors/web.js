// The web: search it, and read a page. Searching goes through Google Search
// (with a Gemini brain, which writes an answer with its sources), or through
// DuckDuckGo when there's no Gemini brain. Pages are opened by net.readPage,
// which never opens anything on this computer or your network.
const { getPublic, readPage, decode } = require("../net");
const { str, fn } = require("./schema");

// DuckDuckGo's plain HTML results: titles, links and snippets
async function duckDuckGo(query) {
  const res = await getPublic(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  return parseDuckDuckGo(res.body.toString("utf8"));
}

function parseDuckDuckGo(html) {
  const clean = (t) => decode(String(t || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const links = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const results = [];
  links.forEach((m, i) => {
    if (results.length >= 8) return;
    let url = decode(m[1]);
    const real = url.match(/[?&]uddg=([^&]+)/);
    if (real) url = decodeURIComponent(real[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) return; // ads
    // Its snippet is between this result and the next
    const rest = html.slice(m.index + m[0].length, links[i + 1]?.index ?? html.length);
    const snippet = rest.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/)?.[1];
    results.push({ title: clean(m[2]), url, snippet: clean(snippet) });
  });
  return results;
}

async function search(query, ctx) {
  const q = String(query || "").trim();
  if (!q) throw new Error("What should be searched for?");
  const brain = require("../brains").getByKind("cloud");
  if (brain?.provider === "gemini") {
    try {
      const { answer, sources } = await require("../gemini").searchWeb({ key: brain.key, model: brain.model, query: q, signal: ctx?.signal });
      if (answer) return { via: "Google Search", answer, sources };
    } catch {} // e.g. the quota: DuckDuckGo instead
  }
  const results = await duckDuckGo(q);
  return { via: "DuckDuckGo", results, tip: results.length ? "Open a result with read_webpage for the details." : "Nothing found." };
}

module.exports = {
  id: "web",
  name: "Web search & pages",
  icon: "🌐",
  description: "Search the web for anything current, and read web pages you share or it finds. Uses Google Search with a Gemini brain, DuckDuckGo otherwise.",
  online: true,
  defaultOn: true,
  fields: [],
  prompt: "`web_search` finds current information on the web (news, prices, facts, how-tos); `read_webpage` reads a page. Say where facts came from when it matters.",
  tools: [
    {
      decl: fn("web_search", "Search the web for current information: news, facts, prices, events, how-tos, reviews.", { query: str("What to search for") }),
      // Gemini Live searches by itself; and only when Settings → AI & privacy allows searching
      when: ({ settings, live }) => !live && settings.aiControl?.searchGrounding !== false,
      async run(args, { ctx }) {
        ctx.onActivity?.(`Searching the web for "${args.query}"`);
        return { ok: true, ...(await search(args.query, ctx)) };
      },
    },
    {
      decl: fn("read_webpage", "Read the text of a web page (an article, docs, a recipe…) from its address.", { url: str("The full address, starting with https://") }),
      async run(args, { ctx }) {
        const page = await readPage(args.url);
        ctx.onActivity?.(`Read ${page.title || new URL(page.url).hostname}`);
        return { ok: true, ...page };
      },
    },
  ],
  async test() {
    const page = await readPage("https://example.com");
    return `The web is reachable (${page.title || "example.com"}).`;
  },
  search,
  duckDuckGo,
  parseDuckDuckGo,
};
