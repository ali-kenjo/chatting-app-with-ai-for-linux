// `npm run voice:setup`: installs local voice (listening with Whisper, speaking
// with Piper) into your data folder: about 1 GB, no root. The same setup is a
// button in Settings → AI control. `npm run voice:setup -- --status` just shows
// whether it's ready.
const voice = require("../server/voice");

async function main() {
  if (process.argv.includes("--status")) {
    const s = await voice.status();
    console.log(s.installed ? `Local voice is ready (${voice.dir}).` : "Local voice isn't set up. Run: npm run voice:setup");
    process.exit(s.installed ? 0 : 1);
  }
  if ((await voice.status()).installed) console.log("Local voice is already set up; checking it again.");
  voice.install();
  let last = "";
  for (;;) {
    const s = await voice.status();
    if (s.step && s.step !== last) console.log(`… ${s.step}`);
    last = s.step;
    if (!s.installing) {
      if (s.error) {
        console.error(`✗ ${s.error}\n  (log: ${voice.dir}/voice.log)`);
        process.exit(1);
      }
      console.log(`✓ Local voice is ready. It starts by itself when you talk to a local AI.`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

main();
