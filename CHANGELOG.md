# Changelog

## 0.3.1

### Added
- **Stay signed in to Google**: with an OAuth client of your own (Settings → Connected Apps → Stay signed in), you sign in once and stay signed in; before, Google's sign-in ended when Friends closed. Voice mode and the morning briefing use it too.

### Fixed
- **Slow or missing answers on Gemini's free tier**: a model whose quota is used up, or that's busy, is now skipped until it's back, and more Gemini models are tried; when every one is out, the message says when they're back.
- **Silent voice mode**: Gemini Live now tries its other voice models when one's quota is used up.
- **Replies start sooner**: normal replies think only briefly (first words in about 2 seconds instead of over 10); Deep still thinks at length.
- Follow-up suggestions, memories, summaries and the briefing run on a light Gemini model, so they don't use up the main model's quota.

### Changed
- The Docker image runs on Node.js 26; KaTeX 0.19; Dependabot removed.

## 0.3.0

### Added
- **Backups**: your chats, memory, settings and everything else you keep in Friends are backed up once a day by themselves (the last 10 are kept), and before every restore. Settings → Data & backups lists them, backs up now, restores, and exports or imports a backup (optionally with attachments) to take your data to another computer. `npm run backup` does it from the terminal. API keys are never in a backup.
- **Characters**: two built-in characters you can switch between with one tap (at the top of the chat and in voice mode). **Atlas**: calm, sharp, dry-witted and always a step ahead. **Mira**: bright, playful, fearless, your hype-woman and most honest friend. Each has a full character sheet (who they are, personality, humor, opinions, interests, quirks, catchphrases, how they relate to you, how they act on camera, what they never do), their own Gemini voice (30 to choose from) and their own look (robot shell, eyes, accent color). Edit them or make your own in Settings → Characters. They share one memory of you and know each other.
- **They remember your conversations**: when a chat or voice conversation goes quiet, a short memory of it is written (what you talked about, how you seemed, what's still open). New conversations start with the latest ones, `recall_conversations` looks further back, and things worth asking about later ("how did the interview go?") become follow-ups. See and remove them in Settings → Memory.
- **Never boring**: 16 things to do together (debate, would you rather, story building, quiz, hot takes, 20 questions, role-play, German or English practice, content ideas…) on the start screen and in voice mode's 🎲 menu; the AI suggests one when a conversation runs dry, brings its own opinions and stories, and brings up topics you love (Settings → Characters → What you love talking about).
- **ON AIR, co-host mode**: in voice mode (and by itself in filming mode and while recording) the AI knows it's on camera: it co-hosts in a format you pick (podcast, reaction, Q&A, debate, explainer, storytime), plays to the audience, and keeps everything private out of it (memories, notes, emails, calendar, files). Live switches without dropping the conversation.
- **Daily life**: tasks (lists, due dates and times, priorities), reminders (once or repeating, with snooze), habits (streaks and the last 7 days) and a journal (with a mood), kept on this computer. Just tell your AI ("remind me in 20 minutes to stretch", "add buy milk to shopping", "I went to the gym") or use **Today** in the sidebar. Reminders pop up in the page, as desktop notifications, and are said out loud in voice mode.
- **Daily briefing**: your day in one message (calendar, reminders, tasks, habits, follow-ups, headlines), written by your character. Ask for it, press ☀️ in Today, or have it waiting every morning (Settings → Daily life).
- **The desktop app keeps running in the tray** when you close the window, so reminders still come; it can start when you log in (in the tray). Notifications open the right place when clicked.
- **Connected apps** (Settings → Connected Apps), each switched on and off and tested on its own card:
  - No account needed: **Weather** (Open-Meteo, with your town for the briefing), **Web search** in every chat (Google Search through your Gemini key, DuckDuckGo otherwise) and **reading web pages** (never anything on your computer or home network), **Wikipedia** (any language) and **Currency** conversion.
  - With a token (kept in the keyring, never in backups): **GitHub** (your repos, issues, pull requests, files, notifications; opening an issue asks first), **Notion** (search, read, write pages; writing asks first), **Todoist** and **Home Assistant** (lights, heating, blinds, media and scenes by voice; locks, alarms and covers always ask; works in Private mode on your own network).
  - With Google sign-in: **YouTube** (your channel's numbers, your videos' views and comments, YouTube search), **Google Tasks**, reading a whole email and saving **Gmail drafts**, and Calendar for any dates, with changing and deleting events (asks first). Sign out and in again once to allow them.
  - **Any other app through MCP**: add an MCP server (a program on this computer, or an address with a token) and its tools are offered to the AI; ready-made starts for a browser (Playwright), code docs (Context7), Git, files, a knowledge graph, fetch and GitHub's own MCP server. Every action asks first unless you trust the app (all its tools, or the read-only ones).
- **Builder mode** (Settings → Builder): build websites, apps and SaaS products together, inside the folders you allow.
  - Code tools: change part of a file (instead of rewriting it), search code, read lines, see a project's tree.
  - Project starters: a website, a SaaS landing page (hero, features, pricing, FAQ), a Node.js API with tests, a React app (Vite), and Next.js through its official creator.
  - Running commands (installs, tests, builds, git, dev servers in the background) in five modes: **Off**, **Suggest only**, **Ask every time**, **Smart** (safe everyday commands run by themselves, the rest ask) and **Auto** (everything except risky commands, which always ask: sudo, deleting outside the project, git push, ssh, piping downloads into a shell…). Your own "may also run" and "never without asking" lists, a time limit, and no API keys passed to commands. Private mode always asks.
  - **Live preview**: a website folder served on this computer, as a link; dev servers' addresses come back too. Settings → Builder shows what's running, with Stop.
- **Gemini overloaded?** Another Gemini model answers instead of an error.
- **Local AIs get the essential tools** (Settings → AI control → Tools for a local AI), so small models stay focused and keep room in their memory; or all of them.
- **It speaks first**: voice mode opens with a greeting that picks up from last time, in Studio and Instant voice too.
- **`npm run update`**: tests, backs up, builds and installs the desktop app in one step.
- **Releases**: tagging a version builds the `.deb` on GitHub and publishes it with a checksum.

### Changed
- Settings → AI personality is now Settings → Characters. A name you gave the AI before becomes your own character, with the voice you'd picked.
- Node.js 22 or newer is needed (Node 20 is no longer maintained).

## 0.2.0

### Added
- **Local AI**: use models on your own computer, with Ollama (through its own API: context size, keep-alive), LM Studio, llama.cpp, Jan, vLLM, LocalAI, KoboldCpp or any OpenAI-compatible server (Settings → AI control → Privacy & local AI). Running servers are found automatically and a model is added with one click.
- **Routing modes**: Auto, Dynamic, Fastest, Local only, Cloud only or one chosen AI, in the model menu and in Settings → AI control. Local first, the cloud for what a local model can't do, fallbacks both ways, a question before anything goes to the cloud, a "who answered" badge on each reply, and a button to answer again with the other AI.
- **Private mode**: only a local AI answers; Gemini, Gemini Live, Google sign-in and tools, GitHub and news are off, and nothing is sent to the internet.
- **Local voice**: listening (Whisper) and speaking (Piper) on this computer, in English, German and Arabic, set up with one button or `npm run voice:setup`.
- **Google sign-in setup in the app** (Settings → Connected Apps): paste your own Firebase web config instead of editing files; "Authentication is not ready" now says what to do.
- Local models are loaded into memory as soon as they're chosen, so the first reply is quick.
- `./scripts/install.sh` (no sudo), `npm run doctor`, `npm run check`, `npm run test:e2e`, `npm run test:voice`, `npm run test:desktop`.

### Fixed
- The app couldn't start without internet (it loaded Firebase from Google at start). Firebase is now loaded only when you sign in.
- A fallback model could repeat an action that already ran (an email sent twice) after a rate limit.
- Gemini streaming could lose the last event, and one damaged event discarded the whole reply.
- Gmail: a line break in an address could add hidden headers (e.g. Bcc).
- Network helpers could garble characters at chunk boundaries and had no timeouts.
- The `.deb` builder wrote `Maintainer: undefined`.
- The Docker image was reachable by every device on the network with host checks off; the port is now published on 127.0.0.1 only.
- Request logs no longer contain query strings (search terms).
- Settings controls now have names for screen readers; an empty bar under the AI status card is gone.

### Changed
- Removed the unused `firebase` package (about 170 MB) and the stale `bun.lock`.
- The AI is only told about tools it really has (Google tools need a signed-in account).
