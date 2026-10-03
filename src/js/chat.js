// ---------- Chat ----------
// The open conversation. Chats are saved by the helper; this module shows
// them and sends new messages. Other modules hear about changes through
// "friends:chat-opened", "friends:chats-changed" and "friends:confirm" events.
import { api } from "./api.js";
import { openSettings } from "./settings.js";
import { getSettings } from "./store.js";
import { getSelectedBrainId, attachmentsBusy, hasAttachments, takeAttachments } from "./composer.js";
import { getAccessToken } from "./auth.js";
import { promptConfirmation } from "./workspace.js";
import { draftCard } from "./drafts.js";
import { renderMarkdown, finishRender } from "./render.js";
import { openFind, closeFind } from "./find.js";
import { robot } from "./robot/index.js";
import { dockShowing } from "./robot/dock.js";

const main = document.getElementById("main");
const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("composer-input");
const sendBtn = document.getElementById("send-btn");
const jumpBtn = document.getElementById("jump-latest");

let currentChatId = null; // null until the first message of a new chat is saved
let session = {}; // replaced whenever another chat opens; late events from the old one are ignored
let active = null; // { requestId } while a reply is streaming
let lastDay = null; // the day of the last message shown, for "Today" / "Yesterday" dividers

const ICONS = {
  // The robot's face screen: its eyes in the accent color (style.css .face-mini)
  face: '<svg class="face-mini" viewBox="0 0 24 24"><rect class="face-shell" x="1" y="3" width="22" height="18" rx="7"/><rect class="face-screen" x="3.6" y="5.6" width="16.8" height="12.8" rx="5"/><rect class="face-eye" x="7.6" y="8.6" width="2.8" height="5.4" rx="1.4"/><rect class="face-eye" x="13.6" y="8.6" width="2.8" height="5.4" rx="1.4"/><path class="face-mouth" d="M10.2 15.4q1.8 1.2 3.6 0"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  regenerate: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><polyline points="20 4 20 11 13 11"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-9.2-9.3C1.7 7.3 4 4 7.4 4c2 0 3.5 1.1 4.6 2.7C13.1 5.1 14.6 4 16.6 4 20 4 22.3 7.3 21.2 10.7 19.5 15.4 12 20 12 20z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 4 4H6l4-4z"/><line x1="12" y1="13" x2="12" y2="20"/></svg>',
};

// What each kind of tool step looks like in the activity list
const ACTIVITY_ICONS = [
  [/declin/i, "✋"],
  [/couldn't/i, "⚠️"],
  [/gmail|email/i, "✉️"],
  [/calendar|event/i, "📅"],
  [/drive/i, "📂"],
  [/github/i, "🐙"],
  [/news/i, "📰"],
  [/memory note/i, "🧠"],
  [/file|folder|trash/i, "📁"],
];
const activityIcon = (text) => ACTIVITY_ICONS.find(([re]) => re.test(text))?.[1] || "⚙️";

export function getCurrentChatId() {
  return currentChatId;
}

function notify(name, detail) {
  document.dispatchEvent(new CustomEvent(`friends:${name}`, { detail }));
}

// Remember the open chat in the address (#chat/<id>) so a reload keeps it
function setChatId(id) {
  currentChatId = id;
  history.replaceState(null, "", id ? `#chat/${id}` : location.pathname);
  notify("chat-opened", { id });
}

function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  updateJump();
}

// ----- Times and day dividers -----
const dayKey = (at) => new Date(at).toDateString();

function dayLabel(at) {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}

function addDayDivider(at) {
  if (dayKey(at) === lastDay) return;
  lastDay = dayKey(at);
  const divider = document.createElement("div");
  divider.className = "day-divider";
  divider.innerHTML = "<span></span>";
  divider.querySelector("span").textContent = dayLabel(at);
  messagesEl.append(divider);
}

function timeEl(at) {
  const time = document.createElement("time");
  time.className = "msg-time";
  time.dateTime = new Date(at).toISOString();
  time.textContent = new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  time.title = new Date(at).toLocaleString();
  return time;
}

function actionBtn(action, icon, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "msg-action";
  button.dataset.action = action;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = ICONS[icon];
  return button;
}

// ----- Messages -----
// meta: { id, at, isNew } — isNew animates it in
function addMessage(role, { id = null, at = Date.now(), isNew = false } = {}) {
  addDayDivider(at);
  const msg = document.createElement("div");
  msg.className = `msg ${role}` + (isNew ? " msg-new" : "");
  if (id) msg.dataset.id = id;
  msg.innerHTML =
    role === "user"
      ? '<div class="msg-files"></div><div class="bubble"></div><div class="msg-actions"></div>'
      : `<div class="msg-avatar" aria-hidden="true">${ICONS.face}</div>
         <div class="msg-main"><div class="activity"></div><div class="msg-body markdown"></div><div class="msg-actions"></div></div>`;
  const actions = msg.querySelector(".msg-actions");
  if (role === "user") {
    actions.append(timeEl(at), actionBtn("copy", "copy", "Copy"), actionBtn("edit", "edit", "Edit"));
  } else {
    actions.append(
      actionBtn("copy", "copy", "Copy"),
      actionBtn("regenerate", "regenerate", "Answer again"),
      actionBtn("speak", "speak", "Read aloud"),
      actionBtn("like", "heart", "Like (or double-click the reply)"),
      actionBtn("pin", "pin", "Pin to the AI's memory"),
      timeEl(at)
    );
  }
  messagesEl.append(msg);
  return msg;
}

function addUserMessage(text, files = [], meta = {}) {
  const msg = addMessage("user", meta);
  msg._text = text;
  msg._files = files;
  const bubble = msg.querySelector(".bubble");
  if (text) bubble.textContent = text;
  else bubble.hidden = true;

  const list = msg.querySelector(".msg-files");
  for (const file of files) {
    if (file.mime.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.alt = file.name;
      img.title = "Click to enlarge";
      img.src = api.attachments.url(file.id);
      list.append(img);
    } else {
      const link = document.createElement("a");
      link.className = "msg-file";
      link.href = api.attachments.url(file.id);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = file.name;
      list.append(link);
    }
  }
  return msg;
}

function setReplyText(msg, text) {
  msg._text = text;
  renderMarkdown(msg.querySelector(".msg-body"), text);
}

function addActivity(msg, text) {
  const line = document.createElement("div");
  line.className = "activity-item";
  line.innerHTML = '<span class="activity-icon" aria-hidden="true"></span><span></span>';
  line.firstChild.textContent = activityIcon(text);
  line.lastChild.textContent = text;
  msg.querySelector(".activity").append(line);
}

// Once a reply is done, several tool steps fold into one line you can open
function foldActivity(msg) {
  const list = msg.querySelector(".activity");
  const items = [...list.querySelectorAll(".activity-item")];
  if (items.length < 2 || list.querySelector(".activity-fold")) return;
  const fold = document.createElement("details");
  fold.className = "activity-fold";
  fold.innerHTML = '<summary><span class="activity-icons"></span><span></span></summary><div class="activity-steps"></div>';
  fold.querySelector(".activity-icons").textContent = [...new Set(items.map((i) => i.firstChild.textContent))].join(" ");
  fold.querySelector("summary span:last-child").textContent = `${items.length} steps`;
  fold.querySelector(".activity-steps").append(...items);
  list.append(fold);
}

// Drafts from voice conversations go under the reply, as cards
function addDrafts(msg, drafts) {
  if (!drafts.length) return;
  let list = msg.querySelector(".msg-drafts");
  if (!list) {
    list = document.createElement("div");
    list.className = "msg-drafts";
    msg.querySelector(".msg-actions").before(list);
  }
  drafts.forEach((d) => list.append(draftCard(d)));
}

function setMarks(msg, { liked = false, pinned = false } = {}) {
  msg.querySelector('[data-action="like"]').classList.toggle("on", liked);
  const pin = msg.querySelector('[data-action="pin"]');
  pin.classList.toggle("on", pinned);
  pin.title = pinned ? "Pinned to the AI's memory (click to unpin)" : "Pin to the AI's memory";
}

function addModelMessage(m) {
  const msg = addMessage("model", { id: m.id, at: m.at || Date.now() });
  (m.activity || []).forEach((line) => addActivity(msg, line));
  foldActivity(msg);
  setReplyText(msg, m.text || "");
  finishRender(msg);
  addDrafts(msg, m.drafts || []);
  setMarks(msg, m);
  return msg;
}

// Only the newest reply keeps its buttons showing and can be answered again
function markLast() {
  messagesEl.querySelectorAll(".msg.last").forEach((m) => m.classList.remove("last"));
  const replies = messagesEl.querySelectorAll(".msg.model");
  replies[replies.length - 1]?.classList.add("last");
}

function updateSendButton() {
  const streaming = !!active;
  main.classList.toggle("streaming", streaming);
  sendBtn.title = streaming ? "Stop" : "Send";
  sendBtn.disabled = !streaming && (attachmentsBusy() || (!input.value.trim() && !hasAttachments()));
}

function stopActive() {
  if (active) api.chat.stop(active.requestId);
  active = null;
}

// Error block in place of a reply, with a way forward
function showError(msg, message, retry) {
  msg.classList.remove("pending", "streaming");
  msg.classList.add("failed");
  const noBrain = message === "NO_BRAIN";
  const block = document.createElement("div");
  block.className = "msg-error";
  block.innerHTML = `
    <span></span>
    <div class="msg-error-actions">
      ${noBrain ? '<button class="btn" data-action="settings">Open settings</button>' : ""}
      <button class="btn" data-action="retry">Try again</button>
    </div>`;
  block.querySelector("span").textContent = noBrain ? "Add a Gemini brain first to start chatting." : message;
  block.querySelector(".msg-error-actions").addEventListener("click", (e) => {
    e.stopPropagation();
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "settings") openSettings("ai-control");
    if (action === "retry" && !active) {
      msg.remove();
      retry();
    }
  });
  msg.querySelector(".msg-body").replaceChildren(block);
}

// ----- Follow-up suggestions -----
function clearSuggestions() {
  messagesEl.querySelectorAll(".msg-suggestions").forEach((s) => s.remove());
}

async function showSuggestions(msg) {
  if (!getSettings()?.chat?.suggestions || !currentChatId) return;
  const mine = session;
  let list = [];
  try {
    ({ suggestions: list } = await api.chats.suggestions(currentChatId));
  } catch {
    return;
  }
  // Only if nothing changed meanwhile
  if (session !== mine || active || !list.length || !msg.isConnected || !msg.classList.contains("last")) return;
  clearSuggestions();
  const box = document.createElement("div");
  box.className = "msg-suggestions";
  for (const text of list) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "prompt-chip";
    chip.dataset.action = "suggestion";
    chip.textContent = text;
    box.append(chip);
  }
  const stick = isNearBottom();
  msg.querySelector(".msg-main").append(box);
  if (stick) scrollToBottom();
}

// Send a request and stream the answer into a new reply bubble. Resolves with
// { reply } when it's done, or { error } if it failed.
// request: { chatId, text, ... } for a new message, { chatId, retry: true } to answer again,
// plus from: <message id> to replace that message and everything after it.
function ask(request, userMsg = null) {
  clearSuggestions();
  const msg = addMessage("model", { isNew: true });
  const body = msg.querySelector(".msg-body");
  msg.classList.add("pending");
  body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  markLast();
  scrollToBottom();
  // The robot next to the chat thinks (voice mode has its own robot states)
  if (!request.voice) {
    robot.director.waiting();
    request.robot = dockShowing();
  }

  const mine = session;
  const stale = () => session !== mine;
  const pace = getSettings()?.personality.typingPace && !request.voice;
  let saved = false; // the helper confirmed the message is stored
  let reply = "";
  let shown = 0; // with "Human typing pace", how much of the reply is visible
  let frame = null;
  let paceTimer = null;
  let resolve;
  const result = new Promise((r) => (resolve = r));

  const draw = () => {
    frame = null;
    const stick = isNearBottom();
    setReplyText(msg, pace ? reply.slice(0, shown) : reply);
    msg._text = reply;
    if (stick) scrollToBottom();
    else updateJump();
  };
  // Reveal a few characters at a time, with a short pause after each sentence
  const typeMore = () => {
    paceTimer = null;
    if (shown >= reply.length) return finishTyping();
    shown = Math.min(reply.length, shown + (reply.length - shown > 400 ? 4 : 2));
    draw();
    paceTimer = setTimeout(typeMore, /[.!?]$/.test(reply.slice(0, shown)) ? 280 : 30);
  };
  let streamDone = false;
  // The reply is fully visible: diagrams, folded steps, suggestions
  const finishTyping = () => {
    if (!streamDone || (pace && shown < reply.length)) return;
    msg.classList.remove("streaming");
    finishRender(msg);
    foldActivity(msg);
    if (!request.voice && msg.dataset.id) showSuggestions(msg);
  };
  const finish = () => {
    active = null;
    cancelAnimationFrame(frame);
    updateSendButton();
    notify("chats-changed");
  };
  // Answer again: the saved message if it reached the helper, otherwise send it again.
  // Whatever part of the reply arrived before the error was saved too; it's replaced.
  const retry = () => {
    const partial = reply || msg.querySelector(".activity-item, .draft-card");
    return ask(
      saved
        ? { chatId: currentChatId, retry: true, from: partial ? msg.dataset.id : null, brainId: getSelectedBrainId() }
        : { ...request, chatId: currentChatId, from: null },
      userMsg
    );
  };

  // Attach Google OAuth token if signed in
  request.googleAccessToken = getAccessToken();

  const requestId = api.chat.send(request, {
    onChat({ id, userId, replyId }) {
      if (stale()) return;
      saved = true;
      if (userId && userMsg) userMsg.dataset.id = userId;
      msg.dataset.id = replyId;
      if (!currentChatId) setChatId(id);
      notify("chats-changed");
    },
    onText(text) {
      if (stale()) return;
      reply += text;
      if (request.onChunk) request.onChunk(text);
      else robot.director.text(text);
      msg.classList.remove("pending");
      msg.classList.add("streaming");
      if (pace) {
        if (!paceTimer) typeMore();
      } else if (!frame) frame = requestAnimationFrame(draw);
    },
    onActivity(text) {
      if (stale()) return;
      addActivity(msg, text);
      scrollToBottom();
      if (!request.voice) robot.director.busy();
    },
    onDraft(draft) {
      if (stale()) return;
      addDrafts(msg, [draft]);
      request.onDraft?.(draft);
    },
    // The AI moved its robot body (robot_mood / robot_gesture)
    onRobot(event) {
      if (!stale()) robot.director.toolEvent(event);
    },
    onConfirm({ id, summary, details }) {
      if (stale()) return;
      promptConfirmation(summary, details).then(async (allow) => {
        try {
          await api.confirm(id, allow);
        } catch (err) {
          console.error("Confirmation response failed:", err);
        }
      });
    },
    onDone() {
      if (stale()) return resolve({ reply });
      finish();
      streamDone = true;
      if (!request.voice) robot.director.done(reply);
      if (reply) {
        if (!pace) draw();
        finishTyping();
      } else if (!msg.querySelector(".activity").children.length && !msg.querySelector(".msg-drafts")) {
        msg.remove();
        markLast();
      } else {
        msg.classList.remove("pending", "streaming");
        body.innerHTML = "";
        foldActivity(msg);
      }
      resolve({ reply });
    },
    onError(message) {
      if (stale()) return resolve({ error: message });
      finish();
      clearTimeout(paceTimer);
      if (!request.voice) robot.director.error();
      showError(msg, message, retry);
      resolve({ error: message });
    },
  });

  active = { requestId };
  updateSendButton();
  return result;
}

function sendText(text, files = []) {
  main.classList.add("has-chat");
  const userMsg = addUserMessage(text, files, { isNew: true });
  ask({ chatId: currentChatId, text, attachments: files.map((f) => f.id), brainId: getSelectedBrainId() }, userMsg);
}

function send() {
  const text = input.value.trim();
  if (active || attachmentsBusy() || (!text && !hasAttachments())) return;
  const files = takeAttachments();
  input.value = "";
  sendText(text, files);
}

// Removes a message and everything shown after it
function removeFrom(msg) {
  let el = msg;
  while (el) {
    const next = el.nextElementSibling;
    el.remove();
    el = next;
  }
  // A day divider left with nothing under it goes too
  while (messagesEl.lastElementChild?.classList.contains("day-divider")) messagesEl.lastElementChild.remove();
  const last = [...messagesEl.querySelectorAll(".msg")].at(-1);
  lastDay = last ? dayKey(Date.parse(last.querySelector(".msg-time")?.dateTime) || Date.now()) : null;
}

// ----- Editing your message -----
function startEdit(msg) {
  if (active || msg.classList.contains("editing")) return;
  msg.classList.add("editing");
  const form = document.createElement("form");
  form.className = "msg-edit";
  form.innerHTML = `
    <textarea class="field" rows="1" aria-label="Edit your message"></textarea>
    <div class="msg-edit-actions">
      <span class="msg-edit-hint">Later messages will be replaced</span>
      <button type="button" class="btn" data-edit="cancel">Cancel</button>
      <button type="submit" class="btn btn-primary">Send</button>
    </div>`;
  const area = form.querySelector("textarea");
  area.value = msg._text || "";
  const fit = () => {
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 320)}px`;
  };
  area.addEventListener("input", fit);
  area.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  });
  const cancel = () => {
    form.remove();
    msg.classList.remove("editing");
  };
  form.querySelector('[data-edit="cancel"]').addEventListener("click", cancel);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text && !msg._files.length) return;
    if (text === (msg._text || "")) return cancel();
    const { id } = msg.dataset;
    const files = msg._files;
    removeFrom(msg);
    const userMsg = addUserMessage(text, files, { isNew: true });
    ask({ chatId: currentChatId, text, from: id, attachments: files.map((f) => f.id), brainId: getSelectedBrainId() }, userMsg);
  });
  msg.querySelector(".bubble").after(form);
  fit();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

// ----- Reading a reply aloud -----
let speaking = null; // { msg, audio }

// The voice goes through an analyser, so the robot next to the chat talks along.
// The audio context starts on the click itself (browsers only allow sound then);
// if it isn't running, the reply simply plays without the robot talking along.
let readCtx = null;
function prepareListening() {
  try {
    readCtx ||= new AudioContext();
    readCtx.resume().catch(() => {});
  } catch {}
}

function robotListensTo(audio) {
  if (readCtx?.state !== "running") return;
  try {
    const analyser = readCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    readCtx.createMediaElementSource(audio).connect(analyser);
    analyser.connect(readCtx.destination);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const hzPerBin = readCtx.sampleRate / analyser.fftSize;
    robot.director.readAloud(() => {
      analyser.getByteFrequencyData(bins);
      return { bins, hzPerBin };
    });
  } catch (err) {
    console.warn("The robot can't hear this reply:", err);
  }
}

function stopSpeaking() {
  if (!speaking) return;
  robot.director.readAloud(null);
  speaking.audio?.pause();
  speaking.msg.querySelector('[data-action="speak"]')?.classList.remove("on", "busy");
  const button = speaking.msg.querySelector('[data-action="speak"]');
  if (button) button.innerHTML = ICONS.speak;
  speaking = null;
}

// Markdown → words worth saying (no code, no link addresses)
function speakable(el) {
  const copy = el.querySelector(".msg-body").cloneNode(true);
  copy.querySelectorAll(".code-block, .katex-mathml").forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
}

async function speak(msg) {
  const same = speaking?.msg === msg;
  stopSpeaking();
  if (same) return;
  prepareListening();
  const text = speakable(msg);
  if (!text) return;
  const button = msg.querySelector('[data-action="speak"]');
  const mine = (speaking = { msg, audio: null });
  button.classList.add("on", "busy");
  button.innerHTML = ICONS.stop;
  try {
    const wav = await api.voice.speak(text);
    if (speaking !== mine) return;
    const audio = new Audio(URL.createObjectURL(wav));
    mine.audio = audio;
    button.classList.remove("busy");
    audio.addEventListener("ended", () => speaking === mine && stopSpeaking());
    robotListensTo(audio);
    await audio.play();
  } catch (err) {
    if (speaking === mine) stopSpeaking();
    toast(err.message === "NO_BRAIN" ? "Add a Gemini brain first." : err.message);
  }
}

// ----- Liked and pinned -----
async function toggleMark(msg, key) {
  const { id } = msg.dataset;
  if (!id || !currentChatId) return;
  const button = msg.querySelector(`[data-action="${key === "liked" ? "like" : "pin"}"]`);
  const on = !button.classList.contains("on");
  button.classList.toggle("on", on); // show it right away
  if (key === "liked" && on) {
    heartPop(msg);
    robot.director.liked();
  }
  if (key === "pinned" && on) robot.director.pinned();
  try {
    const saved = await api.chats.mark(currentChatId, id, { [key]: on });
    setMarks(msg, saved);
    if (key === "pinned") {
      toast(on ? "Pinned. The AI will remember this in every chat." : "Unpinned and removed from the AI's memory.");
      notify("chats-changed");
    }
  } catch (err) {
    button.classList.toggle("on", !on);
    toast(err.message);
  }
}

function heartPop(msg) {
  const heart = document.createElement("span");
  heart.className = "heart-pop";
  heart.innerHTML = ICONS.heart;
  msg.querySelector(".msg-main").append(heart);
  heart.addEventListener("animationend", () => heart.remove());
}

// ----- Small messages at the bottom -----
let toastTimer = null;
function toast(text) {
  let el = document.getElementById("chat-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "chat-toast";
    el.className = "chat-toast";
    el.setAttribute("role", "status");
    document.querySelector(".center").append(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

async function copyText(button, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return toast("Couldn't copy.");
  }
  const label = button.querySelector("span");
  const before = label ? label.textContent : button.innerHTML;
  if (label) label.textContent = "Copied";
  else button.innerHTML = ICONS.check;
  button.classList.add("done");
  setTimeout(() => {
    if (label) label.textContent = before;
    else button.innerHTML = before;
    button.classList.remove("done");
  }, 1500);
}

// ----- Pictures, full size -----
function openLightbox(src, alt) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", alt || "Picture");
  box.innerHTML = '<img alt=""><button type="button" class="icon-btn lightbox-close" title="Close"><svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>';
  box.querySelector("img").src = src;
  box.querySelector("img").alt = alt || "";
  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  box.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(box);
}

// ----- Jump to the latest message -----
function updateJump() {
  jumpBtn.hidden = !main.classList.contains("has-chat") || isNearBottom();
}

messagesEl.addEventListener("scroll", updateJump, { passive: true });
jumpBtn.addEventListener("click", () => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" }));

// ----- Clicks on anything in the conversation -----
messagesEl.addEventListener("click", (e) => {
  const image = e.target.closest(".msg-image");
  if (image) return openLightbox(image.src, image.alt);

  const button = e.target.closest("[data-action]");
  if (!button) return;
  const msg = button.closest(".msg");
  switch (button.dataset.action) {
    case "copy-code":
      return copyText(button, button.closest(".code-block").querySelector("pre code").textContent);
    case "toggle-diagram": {
      const block = button.closest(".code-block");
      block.classList.toggle("show-code");
      button.textContent = block.classList.contains("show-code") ? "Diagram" : "Code";
      return;
    }
    case "copy":
      return copyText(button, msg._text || "");
    case "edit":
      return startEdit(msg);
    case "regenerate":
      if (active || !msg.dataset.id || !msg.classList.contains("last")) return;
      stopSpeaking();
      removeFrom(msg);
      return ask({ chatId: currentChatId, retry: true, from: msg.dataset.id, brainId: getSelectedBrainId() });
    case "speak":
      return speak(msg);
    case "like":
      return toggleMark(msg, "liked");
    case "pin":
      return toggleMark(msg, "pinned");
    case "suggestion":
      if (active) return;
      clearSuggestions();
      return sendText(button.textContent);
  }
});

// Double-click a reply to like it
messagesEl.addEventListener("dblclick", (e) => {
  const msg = e.target.closest(".msg.model");
  if (!msg || !msg.dataset.id || msg.classList.contains("streaming") || e.target.closest("pre, button, a, .draft-card")) return;
  window.getSelection()?.removeAllRanges();
  if (!msg.querySelector('[data-action="like"]').classList.contains("on")) toggleMark(msg, "liked");
  else heartPop(msg);
});

// Used by voice mode (Studio / Instant voice): send what you said; the reply
// streams to onChunk(text), drafts to onDraft(draft). robot: the robot is on screen.
export function askFromVoice(text, { onChunk = null, onDraft = null, robot: robotShown = false } = {}) {
  if (active) stopActive();
  main.classList.add("has-chat");
  const userMsg = addUserMessage(text, [], { isNew: true });
  return ask({ chatId: currentChatId, text, voice: true, robot: robotShown, brainId: getSelectedBrainId(), onChunk, onDraft }, userMsg);
}

// Voice mode's Live voice saved turns to this chat on the helper: it's the open one now
export function adoptChat(id) {
  if (id !== currentChatId) {
    stopActive();
    session = {};
    setChatId(id);
  }
  notify("chats-changed");
}

// Shows the open chat again as saved, e.g. after a voice conversation
export function reloadChat() {
  if (currentChatId) openChat(currentChatId, { force: true });
}

export function stopReply() {
  stopActive();
  updateSendButton();
}

function clearMessages() {
  stopSpeaking();
  closeFind();
  messagesEl.innerHTML = "";
  lastDay = null;
}

export function newChat() {
  stopActive();
  session = {};
  clearMessages();
  main.classList.remove("has-chat");
  setChatId(null);
  updateSendButton();
  updateJump();
  input.focus();
}

// find: words to look for once it's open (from the search panel)
export async function openChat(id, { force = false, find = "" } = {}) {
  if (id === currentChatId && !force) {
    if (find) openFind(find);
    return;
  }
  stopActive();
  const mine = (session = {});

  let chat;
  try {
    chat = await api.chats.get(id);
  } catch {
    if (session === mine) newChat();
    return;
  }
  if (session !== mine) return;

  clearMessages();
  main.classList.add("has-chat");
  for (const m of chat.messages) {
    if (m.role === "user") addUserMessage(m.text, m.attachments, { id: m.id, at: m.at || chat.createdAt });
    else addModelMessage({ ...m, at: m.at || chat.updatedAt });
  }
  setChatId(chat.id);
  updateSendButton();

  // The last message never got an answer (an error, or the page closed)
  if (chat.messages.at(-1)?.role === "user") {
    const msg = addMessage("model");
    showError(msg, "This message didn't get a reply.", () => ask({ chatId: chat.id, retry: true, brainId: getSelectedBrainId() }));
  }
  markLast();
  scrollToBottom();
  if (find) openFind(find);
  else input.focus();
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (active) api.chat.stop(active.requestId);
  else send();
});

input.addEventListener("input", () => {
  updateSendButton();
  if (input.value.trim()) robot.director.typing();
});
document.addEventListener("friends:attachments-changed", updateSendButton);

document.getElementById("new-chat").addEventListener("click", (e) => {
  e.preventDefault();
  newChat();
});

// Reopen the chat from the address after a reload
const fromAddress = location.hash.match(/^#chat\/([\w-]+)$/);
if (fromAddress) openChat(fromAddress[1]);
