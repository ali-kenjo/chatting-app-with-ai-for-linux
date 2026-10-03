# Security

Friends is meant to run on your own computer.

- The helper listens on `127.0.0.1` only and refuses requests whose `Host` or `Origin` isn't one of its own addresses (this blocks other websites in your browser from using it). `ALLOWED_HOSTS` adds more, and `*` turns the checks off: only do that behind something you trust.
- API keys go to the system keyring, or a private file (mode 0600) in your data folder. A key is only sent to the service it belongs to; a local AI's key never falls back to your Gemini key.
- File tools work only inside the folders you allow, follow symbolic links before checking, and ask before acting.
- In Auto, Dynamic and Fastest mode, a message only goes to the cloud after you agree (configurable); declining keeps it local.
- **Private mode** (Settings → AI control) keeps everything on the computer: no Gemini, Google or GitHub, nothing from other websites.
- Local voice (`voice/server.py`) listens on `127.0.0.1` only and refuses other `Host` headers.

Found a problem? Please report it privately to the maintainers (a GitHub security advisory on the repository) before making it public.
