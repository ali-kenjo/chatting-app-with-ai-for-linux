# Security

Friends is meant to run on your own computer.

- The helper listens on `127.0.0.1` only and refuses requests whose `Host` or `Origin` isn't one of its own addresses (this blocks other websites in your browser from using it). `ALLOWED_HOSTS` adds more, and `*` turns the checks off: only do that behind something you trust.
- API keys go to the system keyring, or a private file (mode 0600) in your data folder. A key is only sent to the service it belongs to; a local AI's key never falls back to your Gemini key.
- File tools work only inside the folders you allow, follow symbolic links before checking, and ask before acting.
- In Auto, Dynamic and Fastest mode, a message only goes to the cloud after you agree (configurable); declining keeps it local.
- **Private mode** (Settings → AI control) keeps everything on the computer: no Gemini, Google or GitHub, nothing from other websites.
- Local voice (`voice/server.py`) listens on `127.0.0.1` only and refuses other `Host` headers.
- **Connected apps** (GitHub, Notion, Todoist, Home Assistant) and **MCP servers**: their tokens go to the system keyring, never into backups or to the page. Actions that change something ask first (Home Assistant: locks, alarms and covers always ask; MCP: each action asks unless you trust that app). On camera (ON AIR) none of your accounts, files or memories are offered to the AI.
- **Reading web pages**: the AI can't open anything on this computer or your home network; the address is checked when connecting and on every redirect, with size and time limits.
- **Builder mode** runs commands only inside the allowed folders and only in the mode you pick (off, suggest, ask, smart, auto). Risky commands (sudo, deleting outside the project, git push, ssh, piping downloads into a shell, reading key files…) always ask, even in Auto; API keys aren't passed to commands; in Private mode every command asks. In Auto, a web page or file the AI reads could try to trick it: use Auto only for projects you trust.
- **Staying signed in to Google** uses an OAuth client of your own with PKCE; the refresh token is kept in the system keyring and only ever sent to Google. Sign out (Settings → Connected Apps) revokes it.
- **Backups** contain your data but never API keys or tokens.

Found a problem? Please report it privately to the maintainers (a GitHub security advisory on the repository) before making it public.
