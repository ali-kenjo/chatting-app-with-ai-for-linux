// GitHub with your personal access token: your repositories, issues, pull
// requests, notifications and files. (Searching public repositories works
// without a token: search_github.) Creating an issue asks you first.
const { api } = require("../net");
const { str, oneOf, fn } = require("./schema");

const BASE = process.env.FRIENDS_GITHUB_API || "https://api.github.com";

function gh(cfg, path, options = {}) {
  return api(`${BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(options.headers || {}) }, what: "GitHub" });
}

// "owner/name" (or a github.com link)
function repoOf(value) {
  const v = String(value || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(v)) throw new Error('Name the repository as "owner/name".');
  return v;
}

const brief = (i) => ({ number: i.number, title: i.title, state: i.state, author: i.user?.login, labels: (i.labels || []).map((l) => l.name), comments: i.comments, updated: i.updated_at, url: i.html_url });

module.exports = {
  id: "github",
  name: "GitHub",
  icon: "🐙",
  description: "Your repositories, issues, pull requests, notifications and files, for building apps and websites together.",
  help: "Create a fine-grained token at github.com → Settings → Developer settings → Personal access tokens, with read access to your repositories (and Issues: read and write, to create issues).",
  link: "https://github.com/settings/personal-access-tokens/new",
  online: true,
  private: true,
  fields: [{ key: "token", label: "Personal access token", placeholder: "github_pat_…", secret: true, required: true }],
  prompt: "GitHub (the user's own account): `github_my_repos`, `github_issues`, `github_pull_requests`, `github_read_file`, `github_notifications`, and `github_create_issue` (asks first).",
  tools: [
    {
      decl: fn("github_my_repos", "List the user's own GitHub repositories, most recently updated first.", {}, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.("Looking at your GitHub repositories");
        const repos = await gh(cfg, "/user/repos?sort=updated&per_page=30");
        return { ok: true, repositories: repos.map((r) => ({ name: r.full_name, private: r.private, description: r.description || "", language: r.language || "", stars: r.stargazers_count, openIssues: r.open_issues_count, updated: r.updated_at, url: r.html_url })) };
      },
    },
    {
      decl: fn("github_issues", "List issues of a repository.", { repo: str("owner/name"), state: oneOf(["open", "closed", "all"], "Default open") }, ["repo"]),
      async run(args, { cfg, ctx }) {
        const repo = repoOf(args.repo);
        ctx.onActivity?.(`Reading the issues of ${repo}`);
        const items = await gh(cfg, `/repos/${repo}/issues?state=${["open", "closed", "all"].includes(args.state) ? args.state : "open"}&per_page=30`);
        return { ok: true, issues: items.filter((i) => !i.pull_request).map(brief) };
      },
    },
    {
      decl: fn("github_pull_requests", "List pull requests of a repository.", { repo: str("owner/name"), state: oneOf(["open", "closed", "all"], "Default open") }, ["repo"]),
      async run(args, { cfg, ctx }) {
        const repo = repoOf(args.repo);
        ctx.onActivity?.(`Reading the pull requests of ${repo}`);
        const items = await gh(cfg, `/repos/${repo}/pulls?state=${["open", "closed", "all"].includes(args.state) ? args.state : "open"}&per_page=30`);
        return { ok: true, pullRequests: items.map((p) => ({ ...brief(p), draft: p.draft, branch: p.head?.ref })) };
      },
    },
    {
      decl: fn("github_read_file", "Read a file (or list a folder) in a repository.", { repo: str("owner/name"), path: str("Path in the repository, e.g. README.md or src (empty for the top)"), ref: str("Optional branch, tag or commit") }, ["repo"]),
      async run(args, { cfg, ctx }) {
        const repo = repoOf(args.repo);
        const p = String(args.path || "").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
        ctx.onActivity?.(`Reading ${repo}/${args.path || ""}`);
        const data = await gh(cfg, `/repos/${repo}/contents/${p}${args.ref ? `?ref=${encodeURIComponent(args.ref)}` : ""}`);
        if (Array.isArray(data)) return { ok: true, folder: data.map((f) => ({ name: f.name, type: f.type, size: f.size })) };
        const text = data.encoding === "base64" ? Buffer.from(data.content || "", "base64").toString("utf8") : String(data.content || "");
        return { ok: true, path: data.path, size: data.size, content: text.slice(0, 60000), truncated: text.length > 60000 };
      },
    },
    {
      decl: fn("github_notifications", "The user's unread GitHub notifications.", {}, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.("Checking your GitHub notifications");
        const items = await gh(cfg, "/notifications?per_page=30");
        return { ok: true, notifications: items.map((n) => ({ repo: n.repository?.full_name, title: n.subject?.title, type: n.subject?.type, reason: n.reason, updated: n.updated_at })) };
      },
    },
    {
      decl: fn("github_create_issue", "Open a new issue in a repository (the user confirms first).", { repo: str("owner/name"), title: str("Issue title"), body: str("Issue text in Markdown") }, ["repo", "title"]),
      confirm: (args) => `Open the issue "${args.title}" in ${args.repo} on GitHub`,
      async run(args, { cfg, ctx }) {
        const repo = repoOf(args.repo);
        const issue = await gh(cfg, `/repos/${repo}/issues`, { method: "POST", body: { title: String(args.title).slice(0, 250), body: String(args.body || "") } });
        ctx.onActivity?.(`Opened issue #${issue.number} in ${repo}`);
        return { ok: true, number: issue.number, url: issue.html_url };
      },
    },
  ],
  async test(cfg) {
    const me = await gh(cfg, "/user");
    return `Connected as ${me.login}.`;
  },
  repoOf,
};
