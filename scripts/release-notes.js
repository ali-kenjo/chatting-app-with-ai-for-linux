// Prints the CHANGELOG.md section of one version (for the GitHub Release text).
//   node scripts/release-notes.js 0.3.0
const fs = require("fs");
const path = require("path");

const version = process.argv[2] || require("../package.json").version;
const text = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8");
const start = text.indexOf(`## ${version}`);
if (start < 0) {
  console.log(`Friends ${version}`);
} else {
  const rest = text.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## /m);
  console.log((end < 0 ? rest : rest.slice(0, end)).trim());
}
console.log("\n**Install (Linux):** download the `.deb`, then `sudo apt install ./friends_*_amd64.deb`.");
