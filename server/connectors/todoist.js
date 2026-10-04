// Todoist with your API token: your tasks there, adding and completing them.
// (Friends has its own task list too; this is for people who live in Todoist.)
const { api } = require("../net");
const { str, num, fn } = require("./schema");

const BASE = process.env.FRIENDS_TODOIST_API || "https://api.todoist.com/api/v1";

function todo(cfg, path, options = {}) {
  return api(`${BASE}${path}`, { ...options, headers: { Authorization: `Bearer ${cfg.token}`, ...(options.headers || {}) }, what: "Todoist" });
}

const brief = (t) => ({ id: t.id, content: t.content, description: t.description || undefined, due: t.due?.string || t.due?.date || undefined, priority: t.priority, url: t.url });
const results = (data) => (Array.isArray(data) ? data : data.results || []);

module.exports = {
  id: "todoist",
  name: "Todoist",
  icon: "✔️",
  description: "Your Todoist tasks: see them, add new ones with natural dates (\"tomorrow at 5pm\"), and complete them.",
  help: "Find your API token in Todoist → Settings → Integrations → Developer.",
  link: "https://app.todoist.com/app/settings/integrations/developer",
  online: true,
  private: true,
  fields: [{ key: "token", label: "API token", placeholder: "a1b2c3…", secret: true, required: true }],
  prompt: "Todoist (the user's own task app): `todoist_tasks`, `todoist_add_task`, `todoist_complete`. Use it when they talk about Todoist; otherwise Friends' own task list.",
  tools: [
    {
      decl: fn("todoist_tasks", "List the user's Todoist tasks, optionally with a Todoist filter like 'today', 'overdue' or '#Work'.", { filter: str("Optional Todoist filter") }, []),
      async run(args, { cfg, ctx }) {
        ctx.onActivity?.("Checking Todoist");
        const filter = String(args.filter || "").trim();
        const data = await todo(cfg, filter ? `/tasks/filter?query=${encodeURIComponent(filter)}&limit=50` : "/tasks?limit=50");
        return { ok: true, tasks: results(data).map(brief) };
      },
    },
    {
      decl: fn("todoist_add_task", "Add a task to Todoist.", { content: str("The task"), due: str("Optional due date in words, e.g. 'tomorrow at 5pm', 'every monday'"), priority: num("Optional 1 (normal) to 4 (urgent)") }, ["content"]),
      async run(args, { cfg, ctx }) {
        const body = { content: String(args.content).slice(0, 500) };
        if (args.due) body.due_string = String(args.due);
        if ([1, 2, 3, 4].includes(Number(args.priority))) body.priority = Number(args.priority);
        const task = await todo(cfg, "/tasks", { method: "POST", body });
        ctx.onActivity?.(`Added to Todoist: ${task.content}`);
        return { ok: true, task: brief(task) };
      },
    },
    {
      decl: fn("todoist_complete", "Complete a Todoist task.", { id: str("The task's id") }),
      async run(args, { cfg, ctx }) {
        await todo(cfg, `/tasks/${encodeURIComponent(args.id)}/close`, { method: "POST" });
        ctx.onActivity?.("Completed a Todoist task");
        return { ok: true };
      },
    },
  ],
  async test(cfg) {
    const data = await todo(cfg, "/tasks?limit=1");
    return `Connected (${results(data).length ? "tasks found" : "no open tasks"}).`;
  },
};
