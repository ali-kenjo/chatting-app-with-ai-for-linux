// Live: Gemini Live hears you directly and answers in real time (the page's
// side of it is ../../live.js). This turns what Live reports into what the
// screen shows: status, captions, transcript, the robot's moves.
// The engine interface is described in classic-engine.js.
import { adoptChat, getCurrentChatId } from "../../chat.js";
import { getSelectedBrainId } from "../../composer.js";
import { getAccessToken } from "../../auth.js";
import { promptConfirmation } from "../../workspace.js";
import { LiveVoice } from "../../live.js";
import { robot } from "../../robot/index.js";
import { isOnAir } from "../../onair.js";
import { addTranscript, addDraft, endTurn, discardLine } from "../../voice-drawer.js";
import { isEcho } from "../../echo.mjs";
import { characterName } from "../../characters.js";
import { t } from "../../i18n.js";
import { audio } from "../audio.js";
import { captions } from "../captions.js";
import { isMuted } from "../dom.js";
import { status } from "../status.js";
import { spoken } from "../spoken.js";
import { robotOnScreen } from "../stage.js";

export class LiveEngine {
  // unavailable(message): Live can't be used (any more); the session carries on with Studio voice
  constructor({ unavailable }) {
    this.unavailable = unavailable;
    this.voice = null;
    this.stopped = false;
    this.userLine = ""; // what you said this turn
    this.aiLine = ""; // what it said this turn
    this.echoTurn = false; // what the mic heard this turn was the AI's own voice
    this.thinkingTimer = null;
  }

  get name() {
    return "live";
  }

  get recordable() {
    return true;
  }

  // Resolves once Gemini is ready to talk; rejects with a readable message
  async start() {
    const voice = new LiveVoice({ audioCtx: audio.ctx, micSource: audio.micSource, output: audio.bus, handlers: this.handlers() });
    this.voice = voice;
    await voice.start({ chatId: getCurrentChatId(), brainId: getSelectedBrainId(), googleAccessToken: getAccessToken(), robot: robotOnScreen(), onAir: isOnAir(), doc: this.doc });
    if (!this.stopped) voice.setMuted(isMuted());
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.thinkingTimer);
    this.voice?.stop();
  }

  setDoc(doc) {
    this.doc = doc;
    this.voice?.send({ type: "doc", doc });
  }

  setMuted(muted) {
    this.voice?.setMuted(muted);
    status.set(muted && status.state !== "speaking" ? "listening" : status.state);
  }

  setRobot(on) {
    this.voice?.setRobot(on);
  }

  setOnAir(on) {
    this.voice?.send({ type: "on-air", on });
  }

  earClosed() {
    return Boolean(this.voice?.aiAudible());
  }

  interrupt() {
    this.voice?.silence();
    status.set("listening");
  }

  say(text) {
    this.voice?.send({ type: "note", text });
  }

  // Typed in voice mode. (Live greets on its own, and takes reminders through say().)
  ask(text, { greet = false, note = "" } = {}) {
    const said = String(text || "").trim();
    if (greet || note || !said) return;
    addTranscript("user", said);
    endTurn();
    captions.show("You", said, true);
    robot.director.userSaid(said);
    this.voice.sendText(said);
    status.set("thinking");
  }

  // What Live reports (see LiveVoice.handle in live.js)
  handlers() {
    return {
      onSpeaking: (speaking) => {
        if (speaking) {
          clearTimeout(this.thinkingTimer);
          status.set("speaking");
        } else if (status.state === "speaking") {
          status.set("listening");
        }
      },
      onTranscript: (role, text) => {
        if (role === "user") {
          if (this.echoTurn) return;
          // Its own voice, heard through the mic: not you, so it gets no answer
          if (isEcho(this.userLine + text, spoken.text(this.aiLine))) {
            this.echoTurn = true;
            this.userLine = "";
            discardLine("user");
            captions.clear();
            clearTimeout(this.thinkingTimer);
            this.voice?.dropEcho();
            if (status.state === "hearing" || status.state === "thinking") status.set("listening");
            return;
          }
        }
        addTranscript(role, text);
        robot.director.caption(role, text);
        if (role === "user") {
          this.userLine += text;
          captions.show("You", this.userLine.trim(), true);
          if (status.state !== "speaking") {
            status.set("hearing");
            clearTimeout(this.thinkingTimer);
            this.thinkingTimer = setTimeout(() => status.state === "hearing" && status.set("thinking"), 900);
          }
        } else {
          this.aiLine += text;
          captions.show(characterName(), this.aiLine.trim(), false);
        }
      },
      onInterrupted: () => {
        spoken.add(this.aiLine); // what it got to say is still what the mic may hear
        this.aiLine = "";
        this.echoTurn = false;
      },
      onTurnComplete: () => {
        spoken.add(this.aiLine);
        this.echoTurn = false;
        endTurn();
        robot.director.turnDone();
        this.userLine = "";
        this.aiLine = "";
        clearTimeout(this.thinkingTimer);
        if (status.state === "hearing" || status.state === "thinking") status.set("listening");
      },
      onChat: ({ id }) => adoptChat(id),
      onActivity: (text) => status.note(text, 2500),
      onRobot: (event) => robot.director.toolEvent(event),
      onDraft: (draft) => {
        addDraft(draft);
        status.note(t("Draft ready: {title}", { title: draft.title }), 3000);
      },
      onConfirm: ({ summary, details }) => promptConfirmation(summary, details),
      onReconnecting: () => status.note(t("Reconnecting…"), 10000),
      onResumed: () => status.note("", 0),
      onError: (message) => this.unavailable(message),
      onClosed: () => this.unavailable(t("The live connection closed.")),
    };
  }
}
