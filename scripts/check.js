// `npm run check`: fast checks that need no network and no browser:
// every script parses, JSON files are valid, and the page starts offline
// (no script loads code from another website at start-up).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const problems = [];

function walk(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".git", "dist"].includes(entry.name)) walk(full, visit);
    } else visit(full);
  }
}

let scripts = 0;
walk(root, (file) => {
  const rel = path.relative(root, file);
  const text = () => fs.readFileSync(file, "utf8");
  try {
    if (/^(server|electron|scripts|test)\/.*\.js$/.test(rel)) {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
      scripts++;
    } else if (/^src\/js\/.*\.(js|mjs)$/.test(rel)) {
      // The page's scripts are ES modules
      execFileSync(process.execPath, ["--check", "--input-type=module"], { input: text(), stdio: ["pipe", "pipe", "pipe"] });
      scripts++;
      if (/^\s*(import|export)\b[^;]*\bfrom\s+["']https?:/m.test(text()) || /^\s*import\s+["']https?:/m.test(text())) {
        problems.push(`${rel}: imports code from another website at start-up (the app must start offline; use a dynamic import())`);
      }
    } else if (/\.json$/.test(rel) && !/package-lock/.test(rel)) {
      JSON.parse(text());
    }
  } catch (err) {
    problems.push(`${rel}: ${String(err.stderr || err.message).split("\n").find((l) => l.trim()) || "invalid"}`);
  }
});

// The local voice server (Python), when Python is around
try {
  execFileSync("python3", ["-c", "import ast,sys; ast.parse(open(sys.argv[1]).read())", path.join(root, "voice", "server.py")], { stdio: "pipe" });
} catch (err) {
  if (err.code !== "ENOENT") problems.push("voice/server.py: doesn't parse as Python");
}

const html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
for (const id of new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))) {
  if ((html.match(new RegExp(`\\bid="${id}"`, "g")) || []).length > 1) problems.push(`src/index.html: the id "${id}" is used twice`);
}
// Every id the page's scripts look up must exist in the page
for (const file of fs.readdirSync(path.join(root, "src", "js")).filter((f) => f.endsWith(".js"))) {
  const code = fs.readFileSync(path.join(root, "src", "js", file), "utf8");
  for (const [, id] of code.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)) {
    // (an element the script makes itself, like a toast, is fine)
    if (!html.includes(`id="${id}"`) && !code.includes(`.id = "${id}"`)) problems.push(`src/js/${file}: getElementById("${id}") isn't in index.html`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${scripts} scripts parse, JSON files are valid, the page needs no internet to start`);
