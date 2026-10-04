// `npm run backup`: saves a backup of your Friends data (chats, memory, settings…)
// in <data folder>/backups and prints where. API keys are never included.
//   npm run backup                  a backup without attachments
//   npm run backup -- --files       with attachments and your own robot model
//   npm run backup -- --list        the backups there are
//   npm run backup -- --restore <file> [--merge]
//                                   puts a backup back (close Friends first);
//                                   the current state is backed up before
const fs = require("fs");
const backup = require("../server/backup");

const args = process.argv.slice(2);
const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

if (args.includes("--list")) {
  const all = backup.list();
  if (!all.length) console.log(`No backups yet in ${backup.dir}`);
  for (const b of all) console.log(`${new Date(b.createdAt).toLocaleString()}  ${b.kind.padEnd(14)} ${kb(b.size).padStart(9)}  ${b.name}`);
} else if (args.includes("--restore")) {
  const file = args[args.indexOf("--restore") + 1];
  if (!file) {
    console.error("Which backup? npm run backup -- --restore <file>");
    process.exit(1);
  }
  const source = fs.existsSync(file) ? fs.readFileSync(file) : backup.read(file);
  const result = backup.restore(source, { mode: args.includes("--merge") ? "merge" : "replace" });
  console.log(`Restored ${result.files} files from ${result.from} (${result.mode}).\nThe state before is in ${backup.dir}/${result.safety}`);
} else {
  const made = backup.create("manual", { files: args.includes("--files") });
  console.log(`Saved ${backup.dir}/${made.name} (${kb(made.size)})`);
}
