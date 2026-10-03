# Friends

A personal AI chat app that runs in your browser, with Gemini as its brain.

---

## Quick Start

### 1. Local Desktop (Node.js)

```bash
npm install   # first time only
npm start
```

Open **http://localhost:3000**, then go to **Settings → AI control → Add brain** and paste a Gemini API key (free at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)).

- Stop it with `Ctrl+C`.
- Run on another port: `PORT=3001 npm start`.
- Run with hot-reloading (development): `npm run dev`.

### Linux desktop app (Electron)

The same app in its own window, with a launcher entry and icon. It runs the helper inside the app on a fixed local port (`127.0.0.1:38417`, nothing outside this computer can reach it) and uses the same `~/.config/friends` as the browser version, so your chats, settings and keys carry over.

```bash
npm install
node node_modules/electron/install.js   # once: npm doesn't run Electron's download step
npm run desktop                         # try it from the project folder (runs with --no-sandbox)
npm run dist                            # builds dist/friends_<version>_amd64.deb
sudo apt install ./dist/friends_0.1.0_amd64.deb
```

- The `.deb` sets up Chromium's sandbox properly (a setuid helper), which is why it needs `sudo`; `npm run desktop` has no root, so it runs without the sandbox. Use the installed app for everyday use.
- On a Wayland session it runs natively (X11 otherwise). The window remembers its size and position; a second launch focuses the first window.
- The window only shows the app itself. The microphone and camera are granted to that page only, links open in your browser, and Google sign-in gets its own popup.
- Google sign-in is optional. Copy `firebase-applet-config.example.json` to `firebase-applet-config.json`, fill in your own Firebase project's web config, and add `127.0.0.1` (and `localhost`) under Firebase console → Authentication → Settings → Authorized domains.

### 2. Containerized (Docker & Docker Compose)

Run with Docker Compose:

```bash
docker compose up -d
```

Or run with standard Docker:

```bash
docker build -t friends .
docker run -d -p 3000:3000 -v friends_data:/home/node/.config/friends --name friends-app friends
```

Access the application at `http://localhost:3000`. Data is safely persisted across container restarts in the `friends_data` Docker volume.

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
  "version": "0.1.0",
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

Friends includes a complete, zero-dependency automated test suite leveraging Node.js's built-in `node:test` and `node:assert`:

```bash
# Run full unit and HTTP integration test suite
npm test

# Run syntax and file integrity checks
npm run check

# Check dependencies for security vulnerabilities
npm audit
```

Continuous Integration is automated via GitHub Actions (`.github/workflows/ci.yml`), testing on multiple Node.js LTS versions and validating Docker builds.

---

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
- `server/` — Local Node.js service providing Gemini API integration, file sandboxing, and data persistence. `live.js` bridges voice mode to Gemini Live over a WebSocket (`/api/live`), so the API key stays on your computer. `robot.js` checks and keeps your own robot model and asks Gemini for Smarter moods; the robot tools live in `tools.js`.
- Data lives in `~/.config/friends/` (or `FRIENDS_DATA_DIR`):
  - `chats/` — JSON storage for conversations (including voice turns, drafts, and a summary of the older part of long chats).
  - `memory/` — AI long-term memory notes.
  - `attachments/` — Attached files and metadata.
  - `settings.json` — Preferences and configuration.
  - `robot/model.glb` — your own robot model, if you uploaded one (with `model.json`).
  - `brains.json` — AI model definitions.
  - API Keys: Stored securely in your desktop keyring (GNOME Keyring / KWallet) on Linux desktop, falling back to `~/.config/friends/secrets.json` (plain text, readable only by you) or `GEMINI_API_KEY` when no keyring is available (e.g. Docker or Google AI Studio).
