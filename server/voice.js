// Local voice for a local AI: listening (Whisper) and speaking (Piper) on this
// computer, by voice/server.py. Settings → AI control installs it (about 1 GB,
// into <data folder>/voice, no root needed), the helper starts it when a
// spoken conversation needs it, and it quits by itself when idle.
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { dataDir } = require("./config");
const logger = require("./logger");

const dir = process.env.FRIENDS_VOICE_DIR || path.join(dataDir, "voice");
const port = Number(process.env.FRIENDS_VOICE_PORT) || 8178;
const script = path.join(__dirname, "..", "voice", "server.py");
const venvPython = path.join(dir, "venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
const readyFile = path.join(dir, "ready");
const logFile = path.join(dir, "voice.log");
const base = `http://127.0.0.1:${port}/v1`;
const IDLE_SECONDS = 900;
const SIZE_MB = 1000;

const state = { phase: "idle", step: "", error: "" }; // phase: idle | installing | error
let child = null;
let starting = null;

const installed = () => fs.existsSync(readyFile) && fs.existsSync(venvPython);

async function running() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(700) });
    return (await res.json()).app === "friends-voice";
  } catch {
    return false;
  }
}

async function status() {
  return { installed: installed(), running: await running(), installing: state.phase === "installing", step: state.step, error: state.error, sizeMb: SIZE_MB, base };
}

const run = (cmd, args, { onLine } = {}) =>
  new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const out = fs.openSync(logFile, "a");
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" } });
    let tail = "";
    const take = (chunk) => {
      try {
        fs.writeSync(out, chunk);
      } catch {} // a full disk must not crash the helper; the error shows up through the install itself
      tail = (tail + chunk.toString()).slice(-2000);
      if (onLine) for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) onLine(line.trim());
    };
    proc.stdout.on("data", take);
    proc.stderr.on("data", take);
    proc.on("error", (err) => {
      fs.closeSync(out);
      reject(err.code === "ENOENT" ? Object.assign(new Error(`${cmd} isn't installed.`), { code: "ENOENT" }) : err);
    });
    proc.on("close", (code) => {
      fs.closeSync(out);
      if (code === 0) resolve();
      else reject(new Error(tail.trim().split("\n").slice(-3).join(" ") || `${cmd} stopped with code ${code}`));
    });
  });

// A Python (3.9 or newer, with venv) to build the private environment from
async function findPython() {
  const check = "import sys, venv; sys.exit(0 if sys.version_info >= (3, 9) else 1)";
  for (const name of process.platform === "win32" ? ["python"] : ["python3", "python"]) {
    const ok = await new Promise((resolve) => execFile(name, ["-c", check], (err) => resolve(!err)));
    if (ok) return name;
  }
  throw new Error("Local voice needs Python 3.9 or newer with venv. On Ubuntu/Debian: sudo apt install python3 python3-venv");
}

// Starts the installation (once); progress is in status()
function install() {
  if (state.phase === "installing") return { started: false };
  state.phase = "installing";
  state.error = "";
  (async () => {
    try {
      fs.rmSync(readyFile, { force: true });
      state.step = "Preparing Python";
      const python = await findPython();
      if (!fs.existsSync(venvPython)) await run(python, ["-m", "venv", path.join(dir, "venv")]);
      state.step = "Installing the speech engines (about 500 MB)";
      await run(venvPython, ["-m", "pip", "install", "--quiet", "faster-whisper", "piper-tts", "numpy"]);
      state.step = "Downloading the speech models (about 700 MB)";
      await run(venvPython, [script, "--prepare", "--data-dir", path.join(dir, "data")], { onLine: (line) => /^(Downloading|Ready)/.test(line) && (state.step = line.replace(/…$/, "")) });
      fs.writeFileSync(readyFile, new Date().toISOString());
      state.phase = "idle";
      state.step = "";
    } catch (err) {
      logger.warn("Local voice setup failed:", err.message);
      state.phase = "error";
      state.error = /pip|No matching distribution|Could not find a version/i.test(err.message) ? `The speech engines couldn't be installed: ${err.message.slice(0, 200)}` : err.message.slice(0, 300);
    }
  })();
  return { started: true };
}

// The address of the running server (starting it if it's installed), or null
async function ensure() {
  if (await running()) return base;
  if (!installed()) return null;
  starting ||= (async () => {
    const out = fs.openSync(logFile, "a");
    child = spawn(venvPython, [script, "--port", String(port), "--data-dir", path.join(dir, "data"), "--idle-exit", String(IDLE_SECONDS)], { stdio: ["ignore", out, out] });
    fs.closeSync(out);
    child.on("exit", () => (child = null));
    child.unref(); // it doesn't keep the helper alive; the helper stops it on exit (below)
    for (let i = 0; i < 60; i++) {
      if (await running()) return base;
      if (!child) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  })().finally(() => (starting = null));
  return starting;
}

// Loads the speech models (when voice is installed), so a conversation starts at once
async function warm() {
  const address = await ensure();
  if (!address) return { warm: false };
  try {
    await fetch(`${address}/warm`, { method: "POST", signal: AbortSignal.timeout(120000) });
    return { warm: true };
  } catch {
    return { warm: false };
  }
}

process.on("exit", () => child?.kill());

module.exports = { status, install, ensure, warm, installed, base, port, dir };
