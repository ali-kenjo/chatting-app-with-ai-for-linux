// Manual end-to-end check of a spoken conversation with a local AI, in real
// Chrome with a fake microphone: it "says" a question, the helper transcribes it
// (local Whisper), the local AI answers (Ollama), and the answer is spoken
// (local Piper). Needs: local voice set up (npm run voice:setup), Ollama with a
// model, and Chrome. Nothing leaves this computer.
//   node scripts/e2e-voice.js [model]        (default: the first Ollama model)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "friends-voice-e2e-"));
process.env.FRIENDS_DATA_DIR = work;
process.env.KEYRING_BACKEND = "file";
process.env.LOG_LEVEL = "warn";
delete process.env.GEMINI_API_KEY;

const voice = require("../server/voice");
const step = (text) => console.log(`• ${text}`);
const fail = (text) => {
  console.error(`✗ ${text}`);
  process.exitCode = 1;
};

async function main() {
  if (!CHROME) return fail("No Chrome found (set CHROME_PATH).");
  if (!voice.installed()) return fail("Local voice isn't set up: npm run voice:setup");
  const servers = await require("../server/local").detect();
  const ollama = servers.find((s) => s.protocol === "ollama" && s.running && s.models.length);
  if (!ollama) return fail("No Ollama with a model is running.");
  const model = process.argv[2] || ollama.models[0];

  // The question, spoken by the local voice, with silence around it for the voice detector
  const base = await voice.ensure();
  const spoken = await (await fetch(`${base}/audio/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "What is the capital of Germany?", voice: "female" }) })).arrayBuffer();
  fs.writeFileSync(path.join(work, "question.wav"), Buffer.from(spoken));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=48000:cl=mono", "-i", path.join(work, "question.wav"), "-f", "lavfi", "-t", "40", "-i", "anullsrc=r=48000:cl=mono", "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1,aresample=48000[a]", "-map", "[a]", path.join(work, "mic.wav")]);
  step(`question recorded; testing with ${model}`);

  const { start } = require("../server/server");
  const brains = require("../server/brains");
  await brains.saveBrain({ provider: "local", protocol: "ollama", name: model, baseUrl: ollama.url, model, contextSize: 8192 });
  const server = start(0, "127.0.0.1");
  await new Promise((resolve) => (server.listening ? resolve() : server.on("listening", resolve)));
  const urlBase = `http://127.0.0.1:${server.address().port}`;

  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(work, "mic.wav")}%noloop`, "--autoplay-policy=no-user-gesture-required", "--disable-gpu", "--use-gl=swiftshader"],
  });
  const calls = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on("response", (res) => {
      const u = new URL(res.url());
      if (u.hostname === "127.0.0.1" && u.pathname.startsWith("/api/voice/") || u.pathname === "/api/chat") calls.push(`${res.request().method()} ${u.pathname} ${res.status()}`);
      else if (!["127.0.0.1", "localhost"].includes(u.hostname) && !/^(data|blob):/.test(res.url())) calls.push(`EXTERNAL ${res.url()}`);
    });
    await page.goto(urlBase, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.getElementById("voice-open").click());
    step("voice mode opened; listening to the fake microphone…");

    const deadline = Date.now() + 90000;
    let chat = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const list = await (await fetch(`${urlBase}/api/chats`)).json();
      if (list.length) {
        chat = await (await fetch(`${urlBase}/api/chats/${list[0].id}`)).json();
        if (chat.messages.some((m) => m.role === "model" && m.text) && calls.filter((c) => c.includes("/api/voice/speak")).length) break;
      }
    }
    if (!chat) return fail(`Nothing was heard. Calls: ${calls.join(", ")}`);
    const heard = chat.messages.find((m) => m.role === "user")?.text;
    const answer = chat.messages.find((m) => m.role === "model")?.text;
    step(`heard:    ${heard}`);
    step(`answered: ${answer}`);
    step(`calls:    ${calls.join(", ")}`);
    if (!/capital of germany/i.test(heard || "")) fail("The question wasn't understood.");
    else if (!/berlin/i.test(answer || "")) fail("The answer doesn't mention Berlin (model quality?).");
    else if (!calls.some((c) => /voice\/speak 200/.test(c))) fail("The answer wasn't spoken by the local voice.");
    else if (calls.some((c) => c.startsWith("EXTERNAL"))) fail("Something contacted another website.");
    else console.log("✓ A spoken conversation with a local AI works, all on this computer.");
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
