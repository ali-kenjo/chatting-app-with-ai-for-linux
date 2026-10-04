// Notion with an internal integration token: search, read pages, and write
// (new pages and additions ask you first). Share the pages you want it to see
// with the integration in Notion (••• → Connections).
const { api } = require("../net");
const { str, fn } = require("./schema");

const BASE = process.env.FRIENDS_NOTION_API || "https://api.notion.com/v1";

function notion(cfg, path, options = {}) {
  return api(`${BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${cfg.token}`, "Notion-Version": "2022-06-28", ...(options.headers || {}) }, what: "Notion" });
}

const plain = (rich = []) => rich.map((r) => r.plain_text || "").join("");

function titleOf(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === "title");
  return plain(prop?.title) || plain(page.title) || "Untitled";
}

// A page id from an id or a notion.so link
function idOf(value) {
  const hex = String(value || "").replace(/-/g, "").match(/[0-9a-f]{32}(?=\W*$|\?)/i)?.[0] || String(value || "").replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0];
  if (!hex) throw new Error("That isn't a Notion page id or link.");
  return hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

// Blocks → text lines (one level deep)
function blockText(b) {
  const t = b[b.type];
  const text = plain(t?.rich_text);
  switch (b.type) {
    case "heading_1": return `# ${text}`;
    case "heading_2": return `## ${text}`;
    case "heading_3": return `### ${text}`;
    case "bulleted_list_item": return `- ${text}`;
    case "numbered_list_item": return `1. ${text}`;
    case "to_do": return `- [${t.checked ? "x" : " "}] ${text}`;
    case "quote": return `> ${text}`;
    case "code": return "```\n" + text + "\n```";
    case "child_page": return `[page: ${t.title}]`;
    case "divider": return "---";
    default: return text;
  }
}

// Markdown-ish text → Notion blocks (headings, lists, to-dos, paragraphs)
function toBlocks(text) {
  const rich = (content) => [{ type: "text", text: { content: content.slice(0, 1990) } }];
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 90)
    .map((line) => {
      const l = line.trimEnd();
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)/))) return { object: "block", type: `heading_${m[1].length}`, [`heading_${m[1].length}`]: { rich_text: rich(m[2]) } };
      if ((m = l.match(/^\s*- \[( |x)\]\s+(.*)/i))) return { object: "block", type: "to_do", to_do: { rich_text: rich(m[2]), checked: m[1].toLowerCase() === "x" } };
      if ((m = l.match(/^\s*[-*]\s+(.*)/))) return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(m[1]) } };
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) return { object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: rich(m[1]) } };
      return { object: "block", type: "paragraph", paragraph: { rich_text: rich(l) } };
    });
}

module.exports = {
  id: "notion",
  name: "Notion",
  icon: "🗒️",
  description: "Search and read your Notion pages, and write new ones or add to them (it asks first).",
  help: "Create an internal integration at notion.so/profile/integrations, copy its secret, then share the pages it may use with it (••• → Connections in Notion).",
  link: "https://www.notion.so/profile/integrations",
  online: true,
  private: true,
  fields: [{ key: "token", label: "Integration secret", placeholder: "ntn_…", secret: true, required: true }],
  prompt: "Notion (the user's pages): `notion_search`, `notion_read_page`, and `notion_create_page` / `notion_append` (both ask first).",
  tools: [
    {
      decl: fn("notion_search", "Search the user's Notion pages by title.", { query: str("Words to look for (empty for recent pages)") }, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.(`Searching Notion${args.query ? ` for "${args.query}"` : ""}`);
        const data = await notion(cfg, "/search", { method: "POST", body: { query: String(args.query || ""), page_size: 15, filter: { property: "object", value: "page" } } });
        return { ok: true, pages: (data.results || []).map((p) => ({ id: p.id, title: titleOf(p), url: p.url, edited: p.last_edited_time })) };
      },
    },
    {
      decl: fn("notion_read_page", "Read a Notion page's text.", { page: str("The page id or link") }),
      async run(args, { cfg, ctx }) {
        const id = idOf(args.page);
        const page = await notion(cfg, `/pages/${id}`);
        const blocks = await notion(cfg, `/blocks/${id}/children?page_size=100`);
        ctx.onActivity?.(`Read the Notion page ${titleOf(page)}`);
        const text = (blocks.results || []).map(blockText).join("\n");
        return { ok: true, title: titleOf(page), url: page.url, text: text.slice(0, 40000), more: blocks.has_more === true };
      },
    },
    {
      decl: fn("notion_create_page", "Create a new Notion page inside another page (the user confirms first).", { parent: str("Id or link of the page to put it in"), title: str("Title"), content: str("The content, in simple Markdown (headings, lists, to-dos, paragraphs)") }, ["parent", "title"]),
      confirm: (args) => `Create the Notion page "${args.title}"`,
      async run(args, { cfg, ctx }) {
        const page = await notion(cfg, "/pages", { method: "POST", body: { parent: { page_id: idOf(args.parent) }, properties: { title: { title: [{ type: "text", text: { content: String(args.title).slice(0, 200) } }] } }, children: toBlocks(args.content) } });
        ctx.onActivity?.(`Created the Notion page ${args.title}`);
        return { ok: true, id: page.id, url: page.url };
      },
    },
    {
      decl: fn("notion_append", "Add text to the end of a Notion page (the user confirms first).", { page: str("The page id or link"), content: str("What to add, in simple Markdown") }),
      confirm: (args) => "Add to a Notion page",
      async run(args, { cfg, ctx }) {
        await notion(cfg, `/blocks/${idOf(args.page)}/children`, { method: "PATCH", body: { children: toBlocks(args.content) } });
        ctx.onActivity?.("Added to a Notion page");
        return { ok: true };
      },
    },
  ],
  async test(cfg) {
    const me = await notion(cfg, "/users/me");
    return `Connected as ${me.name || me.bot?.owner?.user?.name || "your integration"}.`;
  },
  toBlocks,
  idOf,
};
