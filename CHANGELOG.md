# Changelog

## 0.3.0

### Added
- **Backups**: your chats, memory, settings and everything else you keep in Friends are backed up once a day by themselves (the last 10 are kept), and before every restore. Settings → Data & backups lists them, backs up now, restores, and exports or imports a backup (optionally with attachments) to take your data to another computer. `npm run backup` does it from the terminal. API keys are never in a backup.
- **Characters**: two built-in characters you can switch between with one tap (at the top of the chat and in voice mode). **Atlas**: calm, sharp, dry-witted and always a step ahead. **Mira**: bright, playful, fearless, your hype-woman and most honest friend. Each has a full character sheet (who they are, personality, humor, opinions, interests, quirks, catchphrases, how they relate to you, how they act on camera, what they never do), their own Gemini voice (30 to choose from) and their own look (robot shell, eyes, accent color). Edit them or make your own in Settings → Characters. They share one memory of you and know each other.
- **They remember your conversations**: when a chat or voice conversation goes quiet, a short memory of it is written (what you talked about, how you seemed, what's still open). New conversations start with the latest ones, `recall_conversations` looks further back, and things worth asking about later ("how did the interview go?") become follow-ups. See and remove them in Settings → Memory.
- **Never boring**: 16 things to do together (debate, would you rather, story building, quiz, hot takes, 20 questions, role-play, German or English practice, content ideas…) on the start screen and in voice mode's 🎲 menu; the AI suggests one when a conversation runs dry, brings its own opinions and stories, and brings up topics you love (Settings → Characters → What you love talking about).
- **ON AIR, co-host mode**: in voice mode (and by itself in filming mode and while recording) the AI knows it's on camera: it co-hosts in a format you pick (podcast, reaction, Q&A, debate, explainer, storytime), plays to the audience, and keeps everything private out of it (memories, notes, emails, calendar, files). Live switches without dropping the conversation.
- **It speaks first**: voice mode opens with a greeting that picks up from last time, in Studio and Instant voice too.
- **`npm run update`**: tests, backs up, builds and installs the desktop app in one step.
- **Releases**: tagging a version builds the `.deb` on GitHub and publishes it with a checksum; Dependabot proposes dependency updates.

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
