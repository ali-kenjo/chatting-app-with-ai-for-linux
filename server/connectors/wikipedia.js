// Wikipedia: the summary of an article, in any language. No account.
const { api } = require("../net");
const { str, fn } = require("./schema");

async function lookup(query, lang = "en") {
  const l = /^[a-z]{2,3}$/.test(String(lang || "")) ? lang : "en";
  const q = String(query || "").trim();
  if (!q) throw new Error("What should be looked up?");
  const found = await api(`https://${l}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=3`, { what: "Wikipedia" });
  const pages = found.pages || [];
  if (!pages.length) return { query: q, found: false };
  const top = pages[0];
  const summary = await api(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.key)}`, { what: "Wikipedia" });
  return {
    title: summary.title || top.title,
    description: summary.description || top.description || "",
    summary: summary.extract || "",
    url: summary.content_urls?.desktop?.page || `https://${l}.wikipedia.org/wiki/${encodeURIComponent(top.key)}`,
    otherMatches: pages.slice(1).map((p) => p.title),
  };
}

module.exports = {
  id: "wikipedia",
  name: "Wikipedia",
  icon: "📚",
  description: "Look up people, places and topics on Wikipedia, in any language. No account.",
  link: "https://www.wikipedia.org",
  online: true,
  defaultOn: true,
  fields: [],
  prompt: "`wikipedia` looks up facts about people, places and topics.",
  tools: [
    {
      decl: fn("wikipedia", "Look up a topic, person or place on Wikipedia and get the summary.", { query: str("What to look up"), language: str("Wikipedia language code, e.g. en, de, ar (default en)") }, ["query"]),
      async run(args, { ctx }) {
        ctx.onActivity?.(`Looking up "${args.query}" on Wikipedia`);
        return { ok: true, article: await lookup(args.query, args.language) };
      },
    },
  ],
  async test() {
    const a = await lookup("Linux");
    return `Found "${a.title}".`;
  },
  lookup,
};
