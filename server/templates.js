// Project starters for builder mode (create_project). Each is a small,
// modern, working project the AI then shapes with you. The bigger frameworks
// come from their own official creators (a command, run with your approval).

const gitignore = "node_modules/\ndist/\n.env\n.env.*\n!.env.example\n.DS_Store\n*.log\n";

const css = `:root {
  --bg: #0f1115;
  --surface: #171a21;
  --text: #e8eaf0;
  --muted: #9aa3b2;
  --accent: #6f9cf5;
  --radius: 14px;
  color-scheme: dark;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #ffffff;
    --surface: #f4f6fa;
    --text: #15171c;
    --muted: #5d6675;
    color-scheme: light;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

a {
  color: var(--accent);
}

.wrap {
  width: min(1100px, 100% - 32px);
  margin-inline: auto;
}
`;

const STARTERS = {
  website: {
    description: "A simple, responsive website (HTML, CSS, JavaScript), no build step",
    next: "Open it with preview_site, then shape the content and style together.",
    files: ({ title }) => ({
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${title}">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="wrap site-head">
    <strong>${title}</strong>
    <nav><a href="#about">About</a> <a href="#contact">Contact</a></nav>
  </header>
  <main class="wrap">
    <section class="hero">
      <h1>${title}</h1>
      <p>A short sentence about what this is and who it's for.</p>
      <a class="button" href="#contact">Get in touch</a>
    </section>
    <section id="about"><h2>About</h2><p>Tell the story here.</p></section>
    <section id="contact"><h2>Contact</h2><p><a href="mailto:hello@example.com">hello@example.com</a></p></section>
  </main>
  <footer class="wrap"><small>© <span id="year"></span> ${title}</small></footer>
  <script src="script.js"></script>
</body>
</html>
`,
      "style.css": `${css}
.site-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
}

.site-head nav a {
  margin-left: 16px;
  color: var(--muted);
  text-decoration: none;
}

.hero {
  padding: 12vh 0 8vh;
}

.hero h1 {
  font-size: clamp(2.2rem, 6vw, 4rem);
  line-height: 1.1;
}

.hero p {
  color: var(--muted);
  font-size: 1.2rem;
  margin: 16px 0 28px;
}

.button {
  display: inline-block;
  padding: 12px 22px;
  border-radius: 999px;
  background: var(--accent);
  color: #0b1020;
  font-weight: 600;
  text-decoration: none;
}

section {
  padding: 48px 0;
}

footer {
  padding: 40px 0;
  color: var(--muted);
}
`,
      "script.js": `document.getElementById("year").textContent = new Date().getFullYear();\n`,
      "README.md": `# ${title}\n\nOpen \`index.html\` in a browser, or serve the folder with any static host.\n`,
    }),
  },

  landing: {
    description: "A SaaS landing page: hero, features, pricing, FAQ and a call to action",
    next: "Preview it, then write the real copy (hook, benefits, pricing) together.",
    files: ({ title }) => ({
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}: the one-line promise</title>
  <meta name="description" content="What ${title} does, for whom, in one sentence.">
  <meta property="og:title" content="${title}">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="wrap site-head"><strong>${title}</strong><a class="button small" href="#pricing">Start free</a></header>
  <main>
    <section class="wrap hero">
      <p class="eyebrow">New</p>
      <h1>The result your customer wants, without the pain.</h1>
      <p class="lead">${title} helps [who] do [what] in [how much less time].</p>
      <div class="actions"><a class="button" href="#pricing">Start free</a><a class="ghost" href="#features">See how it works</a></div>
    </section>
    <section class="wrap" id="features">
      <h2>Why ${title}</h2>
      <div class="grid">
        <article class="card"><h3>Fast</h3><p>One benefit, said plainly.</p></article>
        <article class="card"><h3>Simple</h3><p>Another benefit, with a number if you have one.</p></article>
        <article class="card"><h3>Safe</h3><p>The worry it takes away.</p></article>
      </div>
    </section>
    <section class="wrap" id="pricing">
      <h2>Pricing</h2>
      <div class="grid">
        <article class="card"><h3>Free</h3><p class="price">€0</p><p>To try it out.</p><a class="button" href="#">Start</a></article>
        <article class="card featured"><h3>Pro</h3><p class="price">€9<span>/month</span></p><p>For people who use it every day.</p><a class="button" href="#">Go Pro</a></article>
        <article class="card"><h3>Team</h3><p class="price">€29<span>/month</span></p><p>For small teams.</p><a class="button" href="#">Contact us</a></article>
      </div>
    </section>
    <section class="wrap" id="faq">
      <h2>Questions</h2>
      <details><summary>Is there a free trial?</summary><p>Yes, the Free plan is free forever.</p></details>
      <details><summary>Can I cancel any time?</summary><p>Yes, in one click.</p></details>
    </section>
    <section class="wrap cta"><h2>Ready to try it?</h2><a class="button" href="#pricing">Start free</a></section>
  </main>
  <footer class="wrap"><small>© <span id="year"></span> ${title}</small></footer>
  <script src="script.js"></script>
</body>
</html>
`,
      "style.css": `${css}
.site-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 0;
}

.hero {
  padding: 14vh 0 10vh;
  text-align: center;
}

.eyebrow {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--accent);
  font-size: 0.85rem;
}

.hero h1 {
  font-size: clamp(2.4rem, 6vw, 4.4rem);
  line-height: 1.08;
  margin: 18px auto;
  max-width: 14ch;
}

.lead {
  color: var(--muted);
  font-size: 1.25rem;
  max-width: 40ch;
  margin: 0 auto 32px;
}

.actions {
  display: flex;
  gap: 16px;
  justify-content: center;
  align-items: center;
}

.button {
  display: inline-block;
  padding: 12px 24px;
  border-radius: 999px;
  background: var(--accent);
  color: #0b1020;
  font-weight: 600;
  text-decoration: none;
}

.button.small {
  padding: 8px 16px;
}

.ghost {
  color: var(--text);
}

section {
  padding: 64px 0;
}

h2 {
  font-size: 2rem;
  margin-bottom: 24px;
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.card {
  padding: 24px;
  border-radius: var(--radius);
  background: var(--surface);
}

.card.featured {
  outline: 2px solid var(--accent);
}

.price {
  font-size: 2.2rem;
  font-weight: 700;
  margin: 8px 0;
}

.price span {
  font-size: 1rem;
  color: var(--muted);
}

details {
  max-width: 700px;
  margin: 0 auto 12px;
  padding: 16px 20px;
  border-radius: var(--radius);
  background: var(--surface);
}

summary {
  cursor: pointer;
  font-weight: 600;
}

.cta {
  text-align: center;
}

footer {
  padding: 40px 0;
  color: var(--muted);
}
`,
      "script.js": `document.getElementById("year").textContent = new Date().getFullYear();\n`,
      "README.md": `# ${title}\n\nA landing page. Open \`index.html\`, or put the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages).\n`,
    }),
  },

  "node-api": {
    description: "A small JSON API in Node.js with tests (no dependencies)",
    next: "Run it with run_command (npm start, in the background) and test it with npm test.",
    files: ({ name, title }) => ({
      "package.json": JSON.stringify({ name, version: "0.1.0", private: true, type: "commonjs", scripts: { start: "node server.js", dev: "node --watch server.js", test: "node --test" }, engines: { node: ">=22" } }, null, 2) + "\n",
      "server.js": `// ${title}: a small JSON API. Routes are in \`routes\`; add your own.
const http = require("node:http");

const items = [];

const routes = {
  "GET /health": () => ({ status: "ok" }),
  "GET /items": () => items,
  "POST /items": (body) => {
    if (!body?.name) throw Object.assign(new Error("name is required"), { status: 400 });
    const item = { id: items.length + 1, name: String(body.name) };
    items.push(item);
    return item;
  },
};

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
}

function createServer() {
  return http.createServer(async (req, res) => {
    const route = routes[\`\${req.method} \${new URL(req.url, "http://x").pathname}\`];
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (!route) return send(404, { error: "Not found" });
    try {
      send(200, await route(await readJson(req)));
    } catch (err) {
      send(err.status || 500, { error: err.message });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(\`${title} running at http://localhost:\${port}\`));
}

module.exports = { createServer };
`,
      "test/api.test.js": `const { test } = require("node:test");
const assert = require("node:assert");
const { createServer } = require("../server");

test("health and items", async () => {
  const server = createServer().listen(0);
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  assert.deepStrictEqual(await (await fetch(\`\${base}/health\`)).json(), { status: "ok" });
  const made = await (await fetch(\`\${base}/items\`, { method: "POST", body: JSON.stringify({ name: "First" }) })).json();
  assert.strictEqual(made.name, "First");
  server.close();
});
`,
      ".gitignore": gitignore,
      "README.md": `# ${title}\n\n\`\`\`bash\nnpm start      # http://localhost:3000\nnpm test\n\`\`\`\n`,
    }),
  },

  "react-app": {
    description: "A React app with Vite (run npm install, then npm run dev)",
    next: "Run npm install, then npm run dev in the background, and open the address it prints.",
    files: ({ name, title }) => ({
      "package.json": JSON.stringify({ name, version: "0.1.0", private: true, type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, dependencies: { react: "latest", "react-dom": "latest" }, devDependencies: { vite: "latest", "@vitejs/plugin-react": "latest" } }, null, 2) + "\n",
      "vite.config.js": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });\n`,
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
`,
      "src/main.jsx": `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\nimport "./style.css";\n\ncreateRoot(document.getElementById("root")).render(\n  <StrictMode>\n    <App />\n  </StrictMode>\n);\n`,
      "src/App.jsx": `import { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main className="wrap">\n      <h1>${title}</h1>\n      <p>Edit src/App.jsx and save to see it change.</p>\n      <button onClick={() => setCount((c) => c + 1)}>Clicked {count} times</button>\n    </main>\n  );\n}\n`,
      "src/style.css": `${css}
main {
  padding: 12vh 0;
}

h1 {
  font-size: 3rem;
}

button {
  margin-top: 24px;
  padding: 10px 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: #0b1020;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
`,
      ".gitignore": gitignore,
      "README.md": `# ${title}\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
    }),
  },

  nextjs: {
    description: "A Next.js app (the usual base for a SaaS), made by its official creator",
    note: "This downloads Next.js with npx; it takes a minute. Afterwards: npm run dev in the background.",
    command: (name) => `npx --yes create-next-app@latest ${name} --typescript --tailwind --eslint --app --src-dir --use-npm --import-alias "@/*" --yes`,
  },
};

const get = (name) => STARTERS[String(name || "").toLowerCase()] || null;
const names = () => Object.keys(STARTERS);
const describe = () => Object.entries(STARTERS).map(([k, v]) => `${k}: ${v.description}`).join("; ");

module.exports = { get, names, describe, STARTERS };
