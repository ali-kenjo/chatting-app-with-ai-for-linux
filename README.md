# Friends

A personal AI chat app that runs in your browser. Its brain can be Google Gemini (cloud) or any AI model running on your own computer, so chats can stay completely private.

---

## Install

**You need:** a Linux computer (the app and the helper also run on macOS and Windows from source) and [Node.js](https://nodejs.org) 20 or newer. For a private, offline AI also an AI model server such as [Ollama](https://ollama.com/download) (optional; Gemini needs only a free API key).

### 1. One command (recommended)

```bash
git clone <this repository> friends && cd friends
./scripts/install.sh
```

It installs the dependencies, adds a **Friends (browser)** entry to your application menu and a `friends-web` command (starts the helper in the background and opens your browser; `friends-web --stop` stops it), and then runs `npm run doctor`, which checks your setup and tells you how to fix anything missing. No `sudo`. `./scripts/install.sh --uninstall` removes the command and menu entry again; your chats stay in `~/.config/friends`.

### 2. By hand

```bash
npm ci          # first time only
npm start       # then open http://localhost:3000
```

- Stop it with `Ctrl+C`. Another port: `PORT=3001 npm start`. Development with reload: `npm run dev`.
- `npm run doctor` checks Node.js, the dependencies, your data folder, the port, API-key storage and any local AI server.
- Then open **Settings → AI control**: a local AI (Ollama, LM Studio…) shows up there by itself, or add a Gemini brain with a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 3. Linux desktop app (Electron)

The same app in its own window, with a launcher entry and icon. It runs the helper inside the app on a fixed local port (`127.0.0.1:38417`, nothing outside this computer can reach it) and uses the same `~/.config/friends` as the browser version, so your chats, settings and keys carry over.

```bash
./scripts/install.sh --desktop          # dependencies + the Electron download (~100 MB)
npm run desktop                         # try it from the project folder (runs with --no-sandbox)
npm run dist                            # builds dist/friends_<version>_amd64.deb
sudo apt install ./dist/friends_0.2.0_amd64.deb
```

- The `.deb` sets up Chromium's sandbox properly (a setuid helper), which is why it needs `sudo`; `npm run desktop` has no root, so it runs without the sandbox. Use the installed app for everyday use.
- **Updating the installed app means building and installing a new `.deb`** (`npm run dist`, then `sudo apt install ./dist/friends_*.deb`). An installed app doesn't change when you change the source.
- On a Wayland session it runs natively (X11 otherwise). The window remembers its size and position; a second launch focuses the first window.
- The window only shows the app itself. The microphone and camera are granted to that page only, links open in your browser, and Google sign-in gets its own popup.
- Google sign-in (Gmail, Calendar, Drive) is optional, needs a free Firebase project of your own, and is never loaded in Private mode. Set it up in **Settings → Connected Apps → Set up Google sign-in**: the steps are listed there, and you paste the web app's `firebaseConfig` from the Firebase console (it's kept in `~/.config/friends/firebase-applet-config.json`). Add `127.0.0.1` and `localhost` under Authentication → Settings → Authorized domains. (A `firebase-applet-config.json` next to the app, as in `firebase-applet-config.example.json`, still works.)

### 4. Docker

```bash
docker compose up -d
```

or

```bash
docker build -t friends .
docker run -d -p 127.0.0.1:3000:3000 -v friends_data:/home/node/.config/friends --name friends-app friends
```

Open `http://localhost:3000`. Chats persist in the `friends_data` volume. (If you publish it on another host port, e.g. `-p 127.0.0.1:8080:3000`, also set `ALLOWED_HOSTS=localhost:8080`.) The port is only published on this computer; to reach it from other devices, publish `3000:3000` and set `ALLOWED_HOSTS` to the address you use. To use Ollama running on the host: run Ollama with `OLLAMA_HOST=0.0.0.0` and add the brain with the address `http://host.docker.internal:11434` (the compose file already provides that name).

To also set up local voice during the install: `./scripts/install.sh --voice` (or later: `npm run voice:setup`).

### Troubleshooting

| Problem | Fix |
|---|---|
| Something doesn't work | `npm run doctor` says what's missing and how to fix it |
| `Port 3000 is already in use` | `PORT=3001 npm start` |
| "Can't reach the AI server" | Start it (`ollama serve`), then **Look again** in Settings → AI control |
| The first local reply takes a minute | The model is being loaded into memory; later replies are fast. *Keep the model loaded* in the brain's settings keeps it ready |
| Long chats forget the beginning | Raise the **Context size** of an Ollama brain (Settings → AI control → edit the brain) |
| A local AI can't listen | Set up **Local voice** (Settings → AI control, or `npm run voice:setup`) |

---

## Configuration & Environment Variables

Friends follows the 12-Factor App methodology and is fully configurable via environment variables:

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port the helper listens on | `3000` |
| `HOST` | Network interface to bind (`127.0.0.1` for local safety, `0.0.0.0` for containers/servers) | `127.0.0.1` (`0.0.0.0` in Docker) |
| `ALLOWED_HOSTS` | Comma-separated list of accepted `Host` headers, or `*` to allow all (useful behind proxies) | `localhost:3000, 127.0.0.1:3000` |
| `FRIENDS_DATA_DIR` | Custom directory path for persistent files (chats, settings, memory, attachments) | `~/.config/friends` |
| `LOG_LEVEL` | Log verbosity level (`debug`, `info`, `warn`, `error`) | `info` |
| `KEYRING_BACKEND` | Storage backend for API keys (`auto`, `system`, `file`) | `auto` (`file` in Docker) |
| `GEMINI_API_KEY` | Optional default API key fallback for automated/headless/container environments | _None_ |

A ready-to-use template is available in `.env.example`.

---

## Observability & Health Checks

For production orchestration (Docker, Kubernetes, AWS ECS, GCP Cloud Run), Friends provides dedicated healthcheck probes:

- **`GET /api/health`** (or **`GET /healthz`**)

Example JSON Response:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "uptime": 1420,
  "timestamp": "2026-09-27T01:21:00.000Z",
  "storage": {
    "ok": true,
    "path": "/home/node/.config/friends"
  }
}
```

The server also emits structured request logs with status codes and duration metrics in milliseconds.

---

## Testing & Quality Assurance

Friends' tests use Node.js's built-in `node:test` and `node:assert`:

```bash
npm test               # unit and HTTP integration tests (about 200, a few seconds, no network)
npm run check          # every script parses, JSON is valid, the page needs no internet to start
npm run test:e2e       # the real page in Chrome against the real helper and a fake Ollama
                       #   (needs Chrome; set CHROME_PATH if it isn't in the usual place)
npm audit              # dependencies with known vulnerabilities
```

Checks you run by hand on a computer with the real things installed:

```bash
npm run test:voice     # a spoken conversation with a local AI: fake microphone → Whisper → Ollama → Piper
                       #   (needs local voice, Ollama with a model, and Chrome; nothing leaves the computer)
npm run test:desktop   # starts the real Electron window briefly and checks the page in it
FRIENDS_TEST_VOICE=1 FRIENDS_VOICE_DIR=~/.config/friends/voice npm test   # adds the real-voice test
```

Continuous Integration is automated via GitHub Actions (`.github/workflows/ci.yml`), testing on multiple Node.js LTS versions and validating Docker builds.

---

## Private: AI models on your own computer

Open **Settings → AI control**. Under **Privacy & local AI**, Friends lists the model servers it finds running on this computer and adds a model with one click. (Or **Add brain → Local AI** to give an address yourself.) Nothing is sent to Google or anyone else; chats, notes and files stay here.

- **Private mode** (the switch there) makes it strict: only a local AI answers, and Gemini, Gemini Live, Google sign-in, Google tools, GitHub search and news are all off. Nothing is sent to the internet, and the page loads nothing from other websites.
- **Ollama** is used through its own API, so each brain has a **context size** (default 8192 tokens; Ollama's own default of 4096 cuts long chats off) and **keep the model loaded** (how long it stays in memory). Other servers use their own settings.

It works with every server that offers the OpenAI-compatible API, open source or closed source: **Ollama**, **LM Studio**, **llama.cpp** (`llama-server`), **Jan**, **vLLM**, **LocalAI**, **KoboldCpp**, text-generation-webui and more. Pick one of the presets (or "Other…" and type an address). Friends lists the models the server has, checks that the chosen one answers, and saves it like any other brain. An API key is optional; it is only ever sent to that server.

```bash
ollama pull llama3.1      # example; any model works
npm start                 # then: Settings → AI control → Add brain → Local AI
```

What works with a local brain: chat with streaming replies, memory and notes, file tools, drafts, chat summaries, follow-up suggestions, edit/regenerate, images (with a vision model), and tool use (models that can't use tools still chat). Reasoning models' `<think>` text is hidden. What's different:

- **Voice** — Gemini Live is Google's, so a local brain uses *Studio* voice. Click **Set up** under **Local voice** (same card; or run `npm run voice:setup`) to install Whisper (listening) and Piper (speaking): one download of about 1 GB into `~/.config/friends/voice`, no root needed, needs Python 3.9+ with `venv` (`sudo apt install python3 python3-venv`). Then you can talk to a local AI and hear it answer, in English, German and Arabic, with the two voices from *AI personality* (female/male), fully offline. It starts when you talk and quits when idle. Without it the AI speaks with your browser's own voice (also local) but can't listen, unless you give the brain your own speech-to-text server under **Voice (optional)** (OpenAI-style `/audio/transcriptions`). Whisper runs on the CPU: expect a second or two per sentence you say. Setup is refused in Private mode, because it downloads.
- **Google tools** (Drive, Calendar, Gmail) are offered to a local AI only after you sign in with Google. PDFs can't be read by most local models.
- **Memory and speed** — a larger context needs more (video) memory; on a small graphics card lower it, or the model runs partly on the CPU and slows down. Bigger models are slower on weak hardware; the first request loads the model, which can take a minute. For servers other than Ollama, set the context size in the server itself.
- **Fast first reply** — when a local model becomes the one that answers, Friends loads it into memory right away (and the speech models when voice mode opens), so the first message doesn't wait for it.
- Local voice isn't part of the Docker image (it needs Python); use the browser version or the desktop app for it. In Docker, reach a server on the host through `http://host.docker.internal:11434/v1`.

## Choosing the AI: local, cloud, or both

The model menu next to the message box (and **Settings → AI control → Which AI answers**) has these modes:

| Mode | What it does |
|---|---|
| **One AI** | Every message goes to the one brain you pick (the old behaviour). |
| **✨ Auto** | Short and ordinary messages go to a local AI. The cloud AI takes what a local model can't: a PDF (or a picture a local model can't see), a chat too long for the local model's memory, a hard question (long, detailed, code, multi-step). Each of these rules can be switched off. If one AI fails or sends nothing, the other answers. |
| **🔄 Dynamic** | Auto, and it reacts to how things are going. A local AI that stays silent for too long (you set the patience), fails or sends an empty reply is replaced by the cloud, and left alone for 10 minutes; a cloud AI that had trouble is skipped for a while. |
| **⚡ Fastest** | Asks the local and the cloud AI at once; whichever starts answering first wins and the other is cancelled. |
| **🔒 Local only** | Only an AI on this computer. |
| **☁️ Cloud only** | Only Gemini. |

- **You stay in control of what goes online.** In Auto, Dynamic and Fastest your message only goes to the cloud after you agree (*once per chat*, *every time*, or *never ask*). Declining keeps it local. **Private mode** overrides every mode: it is always local, and the cloud is never called.
- **You can see who answered.** Each reply in these modes shows `🔒 Local · name` or `☁️ Cloud · name`; hover for the reason ("report.pdf is a PDF, which local models can't read"). With both kinds of AI, a button under each reply answers again with the *other* AI.
- An answer that has started is never taken over by another AI, and a tool (sending an email, changing a file) never runs twice.
- The small jobs (follow-up suggestions, summaries of long chats) use a local AI when there is one. Spoken answers stay local for speed (a setting), so Auto and Dynamic use Studio voice with a local AI; Gemini Live is used where the cloud answers.
- The default mode is *One AI*; switch to Auto in the model menu.

## Features & Capabilities

- **Chat**: Streaming replies, attachments (+ button, drag-and-drop, paste: images, PDFs, text/code files), and model selector.
  - Under each reply: **Copy**, **Answer again**, **Read aloud** (Gemini voice), **Like** (or double-click the reply) and **Pin** (keeps the reply in the AI's memory notes). Your own messages can be **edited** and sent again.
  - Code blocks with syntax colors and a Copy button, math with KaTeX (`$…$`, `$$…$$`), and ```` ```mermaid ```` blocks drawn as diagrams.
  - Tool steps (Gmail, Calendar, …) fold into one line, follow-up suggestions appear under the last reply, times show on hover with "Today" / "Yesterday" dividers, pictures open full size, and a button jumps back to the latest message.
  - **Find in this chat** with **Ctrl+F**; results from the search panel stay marked when you open the chat.
- **Saved Chats**: Grouped in the sidebar with date categorization, renaming, deletion, and full-text search (**Ctrl+K**).
- **Voice Conversation**: A spoken conversation with a personal, JARVIS-like companion, in whatever language you speak (English and German can be mixed). Pick the engine with the pill at the top:
  - **Live** (default): [Gemini Live](https://ai.google.dev/gemini-api/docs/live) hears you directly and answers in real time; cut in any time. Long sessions keep going across Gemini's reconnects. Falls back to Studio when Live isn't available for your key.
  - **Studio**: your words are transcribed, Gemini writes the reply, and a Gemini voice reads it, a few sentences at a time.
  - **Instant**: the same, read by the browser's own voice.
  - **Drafts**: scripts, posts, captions and ideas it writes appear as cards you can copy or download (📄 button), instead of being read out.
  - **Record a video** (● button): the visualizer plus both voices as MP4/WebM, in screen size, 16:9 or 9:16, optionally with captions. The buttons are never in the video. Headphones keep the AI's voice out of your mic.
  - The visualizers follow only the AI's voice. "Hide everything" (👁) leaves just the visualizer on screen.
  - **🤖 Robot** style: the AI's 3D robot body instead of a visualizer (see [The robot](#the-robot)).
  - **🎬 Filming mode** (or press **F**): for filming the screen with a camera or phone (see [Filming mode](#filming-mode)).
- **Persistent Memory**: Explicit user memories and AI-maintained long-term memory notes.
- **Customizable AI Personality**: Custom names, styles (Friendly, Professional, Funny, Calm), response lengths, speaking speed, and custom instructions.
- **Secure File Access**: Sandboxed file interactions restricted strictly to allowed directories, respecting permission grids and confirmation prompts.
- **Theme & Appearance**: Dark, light, and system themes; accent colors; chat font and size; message style (Minimal or Bubbles) and spacing (Comfortable or Compact).

---

## The robot

A small, friendly hovering robot is the AI's body: a rounded head with a glossy face screen (two expressive eyes and a mouth), glowing fins, two paddle arms, and a hover ring. It glows in your accent color (Settings → Theme). While *you* talk, its fins switch to a second color, so viewers can see who's speaking.

- **In voice mode**, pick **🤖 Robot** in the style bar. It boots up while connecting, listens with its fins perked, leans in and turns to you while you talk (with little "mm-hm" nods when you pause), looks up and aside while thinking, and talks with its mouth, eyes, head and fins following the AI's voice. It waves at its first words and again when you press End. It works with all three engines (Live, Studio, Instant). The 🎥 button opens its scene: background, camera shot, its place in the picture, where you sit, the cinematic camera and Follow my face. It also **roams its room**: it drifts closer and turns to you while you talk, backs away while it thinks and wanders about while it speaks (banking into turns). **Tap it** and it reacts (more taps escalate to a victory spin), **hold it** and it gets affectionate, **drag the empty room** to look around. The room has a glossy floor with its reflection, drifting light at different depths, a light shaft and floor rings that swell with its voice (and close in on it while you talk). Buttons fade away after a few quiet seconds; **M** mutes. Roaming and room effects can be switched off in Settings → Robot, and both stay off while filming.
- **Next to your text chats**, a small robot sits in the bottom right corner, in the free space beside the conversation, so it never covers anything. It hides on narrow windows. Fold it away with its arrow button, bring it back with the little face; that's remembered. It watches you type, thinks while a reply is on its way, "talks" as the text comes in, shows the reply's mood, bounces when you like a reply, nods when you pin one, and talks along with Read aloud. Click it to say hi.
- **Its moods** come from, strongest first: the AI itself (the `robot_mood` and `robot_gesture` tools, when allowed), then **Smarter moods** (one small Gemini request per turn, off by default), then the words (a local classifier for English, German and Arabic that reads the captions as they stream), then the state it's in. There are 14 moods (neutral, happy, excited, laughing, curious, thinking, focused, surprised, confused, skeptical, sad, affectionate, proud, sleepy) and 13 gestures (nod, head shake, tilt, wave, shrug, bounce, celebrate spin, look around, lean in, point left, point right, double-take, shy). *Point left* and *point right* point at the left or right side of the video picture, for text you add while editing.
- **Recording** (● in voice mode) records the robot with the captions, in screen size, 16:9 or 9:16 (the robot is reframed for vertical video).
- Message avatars in the chat are a tiny version of its face screen.
- It respects *reduce motion* (the face stays expressive; body moves and camera drift get small or stop). Without WebGL it's simply unavailable: voice mode uses Sunset instead and says why.

### Settings → Robot

| Setting | What it does |
|---|---|
| Robot in text chat | The small robot next to your chats |
| Shell color, Eyes, Mouth | Warm white, cloud, graphite, peach or mint; classic, round or wide eyes; the mouth on or off |
| Background | Studio (dark, soft vignette), Accent glow, Desk, **Chroma green** or **Chroma blue** (exactly #00B140 / #0047BB, flat, with no shadow or glow spilling onto it, for keying out in Kdenlive; don't pick an accent color close to the key color) |
| Camera shot, Place in the picture | Close-up, medium or wide; the robot on the left third, centered or on the right third |
| Cinematic camera | A gentle drift, and a small push-in when it stresses a word |
| Where do you sit? | Left, in front or right of the screen (as you look at it): it turns to you when you talk and looks out of the screen when it talks |
| Follow my face | Its eyes follow you through the webcam. Face detection runs in the browser (MediaPipe, served by the helper, nothing is sent anywhere). The camera is used only while this is on and a robot is showing; an indicator in voice mode shows it (click it to switch off) |
| The AI moves it: in voice mode / in text chat | Offers the AI the robot tools. On for voice by default; off for text chat, because every tool round adds a moment before the reply appears |
| Smarter moods | One small extra Gemini request per turn to read the mood (uses quota) |
| Quality | Auto, Low, Medium, High: pixel ratio, antialiasing, bloom, shadows and face texture size. Auto starts high and steps down one level if it stays under about 50 frames a second for a few seconds |
| Filming mode | Start delay (off, 3, 5, 10 s), camera-friendly look, large captions, bigger face |
| Your own model | Upload a `.glb` from Blender, or reset to the built-in robot |

The panel has a live preview, and "Try a mood" / "Try a move" to see every expression.

**Tip for laptops with two GPUs (integrated + NVIDIA):** Chrome on Linux usually runs on the built-in Intel graphics. To use the NVIDIA GPU, start it with `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome` and check `chrome://gpu`.

### Filming mode

For filming the laptop screen with a camera or phone. Press **F** in voice mode (or 🎬). The screen goes fullscreen with no controls, the mouse hides after 2 seconds without moving, and the screen is kept awake (Wake Lock; if the browser doesn't allow it, the setup card says so). The camera-friendly look switches on: no flicker, no fine lines or glaring white, softer bloom, slightly brighter mid-tones, and a steady quality.

A setup card shows **16:9 and 9:16 frames** (with title-safe areas) to line your phone up with. The conversation waits: press Start and, after the countdown, it begins with its greeting.

| Action | Keys (keyboard and presentation clickers) |
|---|---|
| Start / pause the conversation | Space, Enter, S, F5, Shift+F5 |
| Mic on / off | M, Page Up, ← , ↑ |
| Cut the AI off | I, Page Down, →, ↓ |
| Captions on / off | C, B, . (period) |
| Leave filming mode | Esc |

Before it starts, the clicker's "next" also starts it. Each press shows a small confirmation in the corner that fades quickly. **Large captions** are big enough to read across a room and stay inside the 9:16 frame.

### Your own robot from Blender

Upload a `.glb` (glTF 2.0 binary, up to 30 MB) in Settings → Robot. Friends finds the parts by their **object names** and animates them; a missing part just stays still. It's stored as `robot/model.glb` in the data folder and served to the page at `/api/robot/model`.

```
Root                  the whole robot, standing on the ground (optional)
└─ Hover              floats up and down; everything that hovers is inside it
   ├─ Body            leans, turns, sways and squashes; its origin is its middle
   │  ├─ Neck         origin at the top of the body
   │  │  └─ Head      nods, turns and tilts; origin where it sits on the neck
   │  │     ├─ FaceScreen   the eyes and mouth are shown on it as light
   │  │     ├─ Fin_L        perks up and glows; origin at its base
   │  │     └─ Fin_R
   │  ├─ Arm_L        origin at the shoulder joint; the arm hangs down (−Y)
   │  └─ Arm_R
   └─ HoverRing       glows in the accent color
```

- **Orientation:** in Blender, the robot faces the **front view (Numpad 1)**, that is, it looks toward **−Y**, with **Z up**. The glTF exporter (with its default *+Y Up*) turns this into glTF's +Z forward, which is what Friends expects. Its left side (Arm_L, Fin_L) is on the viewer's right.
- **Scale:** meters, about 1.3 m from the ground to the tips of the fins, standing on the origin (the built-in robot floats about 15 cm above it). A model much smaller or larger than that is scaled to about 1.35 m.
- **Pivots:** rotations happen around each object's origin, so put the origins where the joints are (shoulders, neck, fin bases). Rotations are applied on top of the pose you export.
- **FaceScreen** needs a UV map from 0 to 1 across the screen (left to right as the viewer sees it, bottom to top); its material gets the eyes as an emission texture, so give it a dark base color. The screen's width-to-height shape is taken from the mesh.
- **Glow:** meshes inside Fin_L, Fin_R and HoverRing glow in the accent color; if a fin has a mesh named with "Light" or "Glow" (like `Fin_L_Light`), only that part glows.
- **Export** as *glTF Binary (.glb)* with everything embedded, **without** Draco or meshopt compression (the page doesn't load decoders). Files that point to other files are refused.

---

## Architecture & Data Storage

- `src/` — Static browser application (`index.html`, `style.css`, ES modules).
  - `src/js/robot/` — the robot. Pure logic in `.mjs` modules that `node:test` checks (springs and the layer mixer, moods and gestures as poses, the mood classifier, the animator, the director that turns app events into moods, clicker keys, voice bands). The browser side: `engine.js` (one shared three.js renderer that draws only where the robot is visible), `model.js` (the robot and custom models), `face.js` (eyes and mouth drawn with signed distance functions into a texture), `scene.js`, `dock.js`, `facetrack.js`, `settings-pane.js`, and `index.js`, which loads three.js only when a robot is first shown.
  - `src/js/filming.js` — filming mode. `src/models/face/` — the face detector model for Follow my face.
  - three.js and MediaPipe are served from `node_modules` under `/vendor/`; an import map (allowed by its hash in the page's security policy) names `three` and `three/addons/`.
- `server/` — Local Node.js service providing Gemini API integration (`gemini.js`) and local/OpenAI-compatible AI servers (`openai.js`), file sandboxing, and data persistence. `live.js` bridges voice mode to Gemini Live over a WebSocket (`/api/live`), so the API key stays on your computer. `robot.js` checks and keeps your own robot model and asks Gemini for Smarter moods; the robot tools live in `tools.js`.
- Data lives in `~/.config/friends/` (or `FRIENDS_DATA_DIR`):
  - `chats/` — JSON storage for conversations (including voice turns, drafts, and a summary of the older part of long chats).
  - `memory/` — AI long-term memory notes.
  - `attachments/` — Attached files and metadata.
  - `settings.json` — Preferences and configuration.
  - `robot/model.glb` — your own robot model, if you uploaded one (with `model.json`).
  - `brains.json` — AI model definitions.
  - API Keys: Stored securely in your desktop keyring (GNOME Keyring / KWallet) on Linux desktop, falling back to `~/.config/friends/secrets.json` (plain text, readable only by you) or `GEMINI_API_KEY` when no keyring is available (e.g. Docker or Google AI Studio).
