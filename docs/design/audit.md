# Friends: design audit and what was done about it

Audit date: 2026-10-05, on 0.3.2 (branch `design-overhaul`, from `main` at `b8de916`).

**How this was done.** Every surface was captured with `npm run design:shots` (a real Chrome, the real helper, a fake Ollama on a scratch data folder, so nothing of anyone's data) in dark and light at 1440, 1024, 768 and 390 px: [`screenshots/before/`](screenshots/before/). axe-core ran over the same surfaces ([`axe-baseline.json`](axe-baseline.json), `npm run test:a11y`). Code was read against what the screenshots showed. After the work, the same states were captured again, now also in German and Arabic: [`screenshots/after/`](screenshots/after/) (`de/` and `ar/` inside).

**Severity.** *Blocker*: stops a person from doing the main thing. *Major*: hurts many people or breaks a promise (privacy, accessibility). *Minor*: friction. *Polish*: finish.

Each finding ends with **Done** (what changed, and where) or **Deferred** (and why).

---

## 0. The starting observations, checked

| Observation from the brief | Verdict |
|---|---|
| No right-to-left support | **Confirmed.** `lang="en"` fixed, no `dir` anywhere in `src/js`, 65 physical declarations (`margin-left`, `padding-right`, `left:`, `text-align: left`, `border-left`…) and no logical ones. An Arabic reply rendered with its words in the wrong order and the wrong alignment ([`before/05-chat-dark-1440.png`](screenshots/before/05-chat-dark-1440.png), last paragraph). |
| UI is English-only | **Confirmed.** About 1,100 texts in the page and its scripts. |
| Type scale is ad hoc | **Confirmed.** 19 different `font-size` values from 10 px to 36 px, five of them half pixels (10.5, 11.5, 12.5, 13.5, 14.5), 98 declarations at 12 to 13.5 px. |
| Tokens are partial | **Confirmed.** Colours were variables; spacing, radius, shadow, motion and z-index were not: 27 `z-index` declarations, breakpoints at 520, 580, 640 and 760 px. |
| Touch and keyboard targets are small | **Confirmed.** `.icon-btn` was 36 px, the small ones 26 to 30 px. Ten `:focus-visible` rules, and six `outline: none` on inputs that showed no other focus (the message box, find, rename). |
| Settings IA looks fragmented | **Partly.** Appearance was split (Chat look, Theme) and the AI pane held nine topics in one 700-line column. But the "personality" pane is already called **Characters** in the UI (only its internal id differs from the README), so no rename was needed there. |
| index.html and style.css are monolithic | **Confirmed.** 115 KB each; the stylesheet's "Small screens" block (750 lines) held rules for a dozen unrelated components. |

---

## 1. First-run experience

**F1 · Blocker · A new person gets an error, not a conversation.** With no AI set up, the start screen was identical to a working one (including a "Cloud Ready" chip). Typing a message produced "Add an AI brain first to start chatting" and an "Open settings" button. Then: find Settings → "AI control" (the tab for it was third in a list of ten), understand "brain", notice the local-AI card, press Add. ([`before/01-start-no-ai-dark-1440.png`](screenshots/before/01-start-no-ai-dark-1440.png), [`02-error-no-ai`](screenshots/before/02-error-no-ai-dark-1440.png)).
**Done.** A first-run guide (`src/js/onboarding.js`) replaces the voice card until an AI exists: it looks for a local AI by itself (and again every few seconds, in case they're starting Ollama), offers "Use llama3.2" as one click, or takes a free Gemini key, explains local vs cloud in one sentence each, and has the Private-mode switch. "Not now" hides it; the status line under the start screen brings it back. After one click the cursor is in the message box. The same state gives a useful error in chat ("No AI is set up yet… [Set up an AI]") and a first-class "Set up an AI…" entry in the model menu. [`after/00-first-run-guide-dark-1440.png`](screenshots/after/00-first-run-guide-dark-1440.png). Tested: `test/e2e/design.test.js` "first run".

**F2 · Major · "Cloud Ready" was shown whatever the state.** A green chip said the cloud was ready even with no AI, in Private mode (it was hidden there), or when offline. A statement that can be false erodes trust.
**Done.** The chip now says who will answer, from the real state: "No AI set up yet", "Private mode: answers stay on this computer", "Answers come from this computer", "Answers come from Gemini (cloud)", "Local first, cloud when needed". With no AI it is the way back to the guide.

**F3 · Major · Jargon on the first screen.** "Voice Conversation · Hero Experience", "audio-reactive soundwaves, instant barge-in intelligence", a "HERO" badge in the sidebar, "Open in Standalone Browser Tab (Direct Mic Prompt)" with inline styles.
**Done.** "Talk instead of typing: Speak naturally. It answers out loud, and you can interrupt it any time." One primary button and a quiet "Open in its own tab". The decorative wave bars, badge and live dot were removed (and their dead CSS).

## 2. Information architecture

**I1 · Major · Ten flat settings tabs without grouping.** ([`before/11-settings-*`](screenshots/before/)).
**Done.** Four labelled groups: *Look & language* (Appearance), *Your companion* (Characters, Memory, Daily life, Robot), *AI & apps* (AI & privacy, Connected apps, Builder), *Your data* (Data & backups). Font and Theme merged into **Appearance**, which also holds the new Language setting. "AI control" became **AI & privacy**, which is what people look for when they worry about where their words go; the README and every message that pointed to "AI control" were updated.

**I2 · Major · The AI pane mixed nine topics and showed all the advanced ones.** Status, privacy, local servers, routing, per-rule routing toggles, reasoning, context window, local tools, confirmations, brains, permissions.
**Done.** Progressive disclosure: the rule-by-rule routing, the memory window and local-tool count, and an Ollama brain's context size and keep-alive are folded in "Advanced" sections (the routing rules only appear for the modes that use them). A plain-language "Local AI / Cloud AI" explanation sits at the top. "Brain" is now "AI" everywhere in the interface; "Reasoning effort" is "Thinking effort"; "Context memory window" is "How much of the chat it sees".

**I3 · Major · No way to find a setting.**
**Done.** A search box at the top of Settings (a labelled combobox): it matches titles and descriptions in the current language, arrow keys and Enter pick, the result opens its section, unfolds what's folded, scrolls there and flashes it. `src/js/settings.js`; tested.

**I4 · Minor · Tabs were `<button>`s with no tab semantics.**
**Done.** `role="tablist"`/`tab`/`tabpanel`, `aria-selected`, roving tabindex, arrow keys, Home and End. Same for the Today panel.

**I5 · Minor · The sidebar's destinations were `<a href="#">`.**
**Done.** Real buttons (the Today address `#today` still works from the tray).

## 3. Chat

**C1 · Major · The whole conversation was a live region.** `#messages aria-live="polite"` made screen readers announce the transcript as a streaming reply was re-rendered, again and again.
**Done.** The log is `role="log"` with `aria-live="off"` and is reachable by keyboard; a finished reply is announced once, in a separate polite region, with who spoke; errors use `role="alert"`. Tested.

**C2 · Major · Mixed-direction text was wrong** (see §0). Arabic with English names inside it, in a left-to-right box.
**Done.** Every paragraph, list, heading, quote and table cell of a reply takes its own direction (`dir="auto"`, `src/js/render.js`); your messages, the message box, find and search too. Code blocks and formulas stay left to right. [`after/ar/05-chat-dark-1440.png`](screenshots/after/ar/05-chat-dark-1440.png).

**C3 · Major · The follow-up chips were clipped under a long reply.** A diagram drawn after the text grew the page; "stick to the bottom" had been decided before.
**Done.** The conversation follows the bottom while you're at it, whatever grows (a diagram, chips), and leaves you alone as soon as you scroll up.

**C4 · Major · The message box was a single line**, and its placeholder was cut off by the model picker ("Ask anything, or tap Voice Conversation abc").
**Done.** A text area that grows to about eight lines: Enter sends, Shift+Enter breaks the line (and IME composition isn't cut). On a phone it takes the whole first line and the buttons the second.

**C5 · Minor · Reading comfort.** Line height 1.65, text 15 px, a column fixed in pixels.
**Done.** 1.7 line height, 16 px default (the setting still scales everything), a 46 rem column (about 70 characters).

**C6 · Major · Who answered was visible only on hover** for all but the newest reply, and its reason was a native tooltip no keyboard could reach.
**Done.** The badge ("🔒 Local · llama3.2" / "☁️ Cloud · Gemini") is always shown, focusable, with its reason in an on-screen tooltip and in its accessible name. Contrast fixed (see A4).

**C7 · Minor · Errors had one fixed shape** ("Try again" and, for no AI, "Open settings").
**Done.** What happened in bold, the detail, and the way forward: Try again; Try the other AI (when both kinds exist); Check AI settings; Set up an AI.

**C8 · Minor · Dropping files gave no feedback.**
**Done.** The box lights up and a "Drop files to attach them" target appears; attachment chips are announced and removable by keyboard.

**C9 · Polish · The message's own actions** (copy, again, other AI, read aloud, like, pin) were reachable by keyboard but looked absent until hover. **Done.** They also show when anything in the message has focus; names and pressed states (`aria-pressed`) for like and pin; 44 px on touch.

## 4. Voice, filming and the robot

**V1 · Major · The voice top bar broke below about 1100 px.** Six look-buttons, character switch, ON AIR, engine pill, three icon buttons in one non-wrapping row: status text cut to "The 3D robot can't be sh…", themes cut to "Cosm…" ([`before/12-voice-dark-1024.png`](screenshots/before/12-voice-dark-1024.png)); at 390 px the buttons squeezed into slivers and the microphone banner ran off the side ([`…-390`](screenshots/before/12-voice-dark-390.png)).
**Done.** One definition of the top bar that wraps: status and buttons on the first line, the six looks (scrollable) below on narrower windows; the banner stacks on phones; the "hide everything" button no longer sits over the End button. [`after/12-voice-dark-390.png`](screenshots/after/12-voice-dark-390.png).

**V2 · Major · State was colour and a short text.** Listening, hearing, thinking, speaking and error differed by dot colour.
**Done.** Different shapes too (round, quick, square turning, long bar, triangle) and a polite live region for the text; the mute and record buttons announce their state; ON AIR has a red ring as well as its label. Controls are 44 px on touch.

**V3 · Minor · Filming setup.** Fine at 390 px; the key list is now also in the shortcuts list.

## 5. Settings usability

**S1 · Major · Destructive actions had four different safeguards.** Memory and notes: click twice within 3 seconds. Backups: "Sure?" within 4 seconds. Characters: "Sure? Your changes are lost". And **Import with "Replace what's here" replaced everything at once, with no question.**
**Done.** One accessible dialog for everything that can't be undone (`src/js/dialogs.js`): the page behind is inert, the safe answer has the focus, Esc cancels. Used for clearing memory, notes and conversations, deleting or restoring a backup, importing in replace mode, resetting or deleting a character, disconnecting an app, removing an MCP app. Tested.

**S2 · Minor · Saving was silent.** Changes save after 400 ms with no word.
**Done.** "Saving…", "All changes saved", or "Couldn't save your changes. Try again".

**S3 · Minor · The plain-language explanation of local vs cloud lived in the README.**
**Done.** Two sentences at the top of AI & privacy and in the first-run guide.

## 6. Visual design

**D1 · Major · The type scale** (see §0). **Done.** Nine tokens in `rem` (12 px is the smallest text anywhere), line heights as tokens. `docs/design/design-system.md`.

**D2 · Minor · Spacing, radius, shadow, motion and layers were literals.** **Done.** A 4 px grid with half steps, five radii, three elevations, three durations and one easing, a 15-step layer ladder, two breakpoints. All migrated by script and reviewed.

**D3 · Minor · The hero title was a white-to-orange gradient clipped to its text**, invisible on the light theme ([`before/03-start-light-390.png`](screenshots/before/03-start-light-390.png)). **Done.** Plain text colour.

**D4 · Polish · Components lacked states.** Buttons had hover only. **Done.** Hover, pressed, focus-visible, disabled and loading for buttons; hover, disabled and invalid for fields; skeleton rows while the chat list loads.

**D5 · Minor · The sidebar's profile row and Settings button scrolled away** when there were many chats (at 1440×900 with a dozen chats they were off-screen). **Done.** Header and menu stay, the list scrolls, the footer is pinned.

**D6 · Minor · The start screen's top was cut off on small windows** (content taller than the window, centred). **Done.** It centres when it fits and scrolls from the top when it doesn't.

## 7. Accessibility (WCAG 2.2 AA)

Baseline axe result: **52 serious or critical violations** across the 26 surfaces × 2 themes (English only). Rules: `color-contrast` (serious), `aria-required-children` (critical: the model menu was a `role=menu` holding loose headings), `aria-allowed-attr` (critical: `aria-checked` on buttons with no radio role), `scrollable-region-focusable` (serious: the search results), plus moderate `page-has-heading-one` and `region`.

**A1 · Major · No dialog managed focus.** Settings, Today, Search, Voice, the confirmation prompts and the picture viewer left the page behind them focusable and the focus where it was.
**Done.** `src/js/a11y.js`: while a dialog is open the page behind is `inert`, focus moves in (to what the dialog asks for, else the first control), Tab stays inside, Esc closes, and the focus returns to where it came from. Dialogs in the page are watched; ones made on the fly call `trapModal`. Tested with 12 Tabs in Settings.

**A2 · Major · Focus visibility.** See §0. **Done.** One ring (`--focus`, 2 px, offset 2 px, in both themes; white with a dark halo on the voice screen), set last so it wins over every component rule; the message box shows its focus on the box.

**A3 · Major · Touch targets.** **Done.** On coarse pointers every control is at least 44 × 44 px (`min-width`/`min-height`, so no component's own size shrinks it; switches and tick boxes get the area as hit area). Tested on an emulated touch screen (`test/e2e/touch.test.js`).

**A4 · Major · Contrast.** axe: the sidebar badge 2.7:1, the active voice label 2.2:1 in light, the green "Added" 3.1:1. And, found by calculation: the five accent colours are 1.9 to 2.7:1 against white, so accent-coloured text and thin icons failed on the light theme.
**Done.** A new `--accent-text` (the accent on dark, 50% darker on light, at least 5.2:1 for all five); muted text, success and warning colours darkened on light. `npm run test:a11y --accent <colour>` ran clean for all five.

**A5 · Minor · `prefers-reduced-motion`** was handled per component in five places and missed new ones; **`prefers-contrast` and forced colours** weren't handled. **Done.** A global reduced-motion rule, a `prefers-contrast: more` palette and a forced-colours pass (`a11y.css`).

**A6 · Minor · Zoom.** At 200% (a 640 px window) everything reflowed; one 28 px overflow (the Google sign-in button) was found by the new tests and fixed, also for German and Arabic.

**A7 · Minor · Landmarks and names.** **Done.** A skip link, `aside`/`nav`/`main` labels, one `h1`, names for every icon-only button (an e2e test fails if one lacks a name), `aria-pressed`/`aria-expanded`/`aria-current` where they apply.

Result now: **no violations of any impact** (also minor and moderate) on all surfaces in dark and light, English and Arabic; a manual walk by keyboard of first run, sending, switching character, changing a setting and opening and closing every dialog (see `design.test.js`). A screen reader was not available here (see the summary).

## 8. Internationalisation

**N1 · Major · English only; German is 30% longer; Arabic needs mirroring.** **Done.**
- `src/js/i18n-core.mjs` (pure, tested in node) and `src/js/i18n.js` (the page): English is the source text, catalogs in `src/js/i18n/de.js` and `ar.js`, `t()`, `tp()` (plurals by `Intl.PluralRules`, six forms for Arabic), numbers and dates by `Intl`. Language is set from the browser, or in Settings → Appearance; `lang` and `dir` are set on `<html>`.
- 1,275 texts in each language, including the helper's activities, voices, character fields and app cards. Tests: every text has a translation, none is left over, placeholders and plural forms are right, translated HTML keeps its links.
- Layout: logical properties everywhere, sliding things use `--dir`, directional icons mirror, code stays left to right.
- Text expansion: an e2e test opens every settings section in German at 1024 and 390 px and fails on any sideways overflow.
- Not translated: the helper's long, variable error messages (they carry model names, addresses and numbers) and the characters' own text, which belongs to you. See "Deferred".

## 9. Performance

Measured on a 400-message chat (a seeded file with lists, code and long paragraphs), median of five loads, same Chrome:

| | 0.3.2 | now |
|---|---|---|
| CSS | 115,074 B (21,230 gzip) | 151,569 B (28,663 gzip), 16 files |
| index.html | 114,453 B | 130,122 B |
| scripts in `src/js` | 487,664 B | 748,416 B (of which 235 KB are the two translation catalogs, loaded only when needed) |
| DOM nodes, long chat | 16,408 | 16,609 |
| Layouts / style recalcs | 8 / 17 | 8 / 21 |
| Time to show 400 messages | 3.5 s | 2.8 s (noise is about ±0.7 s: no regression) |

**P1 · Major (deferred) · A long chat renders all of its messages at once** (16,000 nodes for 400 messages; mermaid, KaTeX and highlight.js dominate). Windowing the list is a change to how messages are kept and found (find in chat, scroll to a search hit, "last" reply logic) and is the next thing to do for people who talk for hours; it is out of proportion for this change and was left alone.

**P2 · Minor · CSS got bigger, not smaller.** The brief asked for flat or smaller. 5 KB of dead and duplicate rules went (about 60 rules: voice cards, wave bars, confirm cards…), but onboarding, the shortcuts list, dialogs, RTL, accessibility, the voice top bar, tokens and touch rules added about 40 KB. Gzipped, +7 KB (+35%). The cost of the new features; no animation was added that isn't `transform`/`opacity`, no asset was added. Merging the 22 selectors that are still defined in two places is the next saving (about 6 KB), left alone because moving rules changes the cascade.

## 10. Microcopy

Tone: calm, warm, direct; "you" and "your"; "brain" → "AI"; no internal terms in front of people ("Hero Experience", "barge-in", "Pinging…", "Verify Key & Connection", "Test Ping", "Reasoning & intelligence"). "Settings → AI control" is "Settings → AI & privacy" everywhere, also in the helper's error messages. Empty states say what to do next ("No reminders. Add one above, or say “remind me in 20 minutes to…”.").

---

## Before and after

| | before | after |
|---|---|---|
| First run, nothing set up | [01-start-no-ai](screenshots/before/01-start-no-ai-dark-1440.png) | [00-first-run-guide](screenshots/after/00-first-run-guide-dark-1440.png) |
| Start screen, phone | [03-start 390](screenshots/before/03-start-dark-390.png) | [03-start 390](screenshots/after/03-start-dark-390.png) |
| Chat with code, math, diagram | [05-chat](screenshots/before/05-chat-dark-1440.png) | [05-chat](screenshots/after/05-chat-dark-1440.png) |
| The same, Arabic | (not possible) | [ar/05-chat](screenshots/after/ar/05-chat-dark-1440.png) |
| Settings, AI | [11-settings-ai-control](screenshots/before/11-settings-ai-control-dark-1440.png) | [11-settings-ai-control](screenshots/after/11-settings-ai-control-dark-1440.png) |
| Settings on a phone | [11-settings-font 390](screenshots/before/11-settings-font-dark-390.png) | [11-settings-appearance 390](screenshots/after/11-settings-appearance-dark-390.png) |
| Voice, narrow | [12-voice 390](screenshots/before/12-voice-dark-390.png) | [12-voice 390](screenshots/after/12-voice-dark-390.png) |
| Light theme, start | [03-start light](screenshots/before/03-start-light-1440.png) | [03-start light](screenshots/after/03-start-light-1440.png) |
| Keyboard shortcuts | (none) | [08b-shortcuts](screenshots/after/08b-shortcuts-dark-1440.png) |

## Deferred, with reasons

1. **Virtualising long chats** (P1): needs a message store the page doesn't have yet.
2. **Translating the helper's variable error messages and the connectors' error texts.** They are built from model names, URLs and counts in 20+ places in `server/`. Fixed ones are in the catalogs (`i18n/elsewhere.js`); the rest show in English.
3. **Merging the 22 duplicated selectors and the `responsive.css` catch-all** into their components: pure risk for little gain now.
4. **A screen reader pass.** None was available on the machine (no NVDA, Orca not installed). The structure was checked with axe, the accessibility tree and keyboard-only tests.
5. **Right-to-left in the 3D robot's overlays and in recordings.** The robot's rendering was out of scope, and the recorded video's captions are drawn on a canvas (left to right by design).
6. **More languages.** The machinery takes a new file in `src/js/i18n/`; the tests will tell what's missing.
