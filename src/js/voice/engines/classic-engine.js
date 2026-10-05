// Studio and Instant voice: you speak, Gemini transcribes it, Gemini writes a
// reply, and the reply is read out a piece at a time. Studio reads it in a
// Gemini voice, Instant in the browser's own (robotic) voice.
//
// Engine interface (shared with live-engine.js):
//   name            "live" | "studio" | "instant"
//   recordable      its voice passes through the page, so a video can have it
//   start()         begin listening
//   stop()          stop everything; the engine isn't used again
//   ask(text, {greet, note})   something typed, or the AI speaking first / saying a note
//   say(text)       the app tells the AI something to say (a reminder went off)
//   interrupt()     you cut it off
//   setMuted(bool)  the mic was muted / unmuted
//   setRobot(bool), setOnAir(bool)   the AI's situation changed
//   earClosed()     its voice (or the room's echo of it) may still be in the mic
import { api } from "../../api.js";
import { askFromVoice, greetFromVoice, stopReply } from "../../chat.js";
import { voiceErrorText } from "../../personality.js";
import { robot } from "../../robot/index.js";
import { isOnAir } from "../../onair.js";
import { addTranscript, addDraft, endTurn } from "../../voice-drawer.js";
import { isEcho } from "../../echo.mjs";
import { characterName } from "../../characters.js";
import { t } from "../../i18n.js";
import { audio } from "../audio.js";
import { captions } from "../captions.js";
import { status } from "../status.js";
import { spoken } from "../spoken.js";
import { robotOnScreen } from "../stage.js";
import { Listener, ECHO_TAIL_MS } from "./listener.js";
import { speech, takeSpeakable } from "./speech.js";
import { toWav } from "./wav.js";

export class ClassicEngine {
  constructor(tts) {
    this.tts = tts === "instant" ? "instant" : "studio";
    this.turn = 0; // bumped on every new turn; stale async results are ignored
    this.queue = []; // reply pieces, played one after another
    this.draining = false;
    this.listener = new Listener({
      onUtterance: (chunks) => this.handleUtterance(chunks),
      onInterrupt: () => this.interrupt(),
    });
  }

  get name() {
    return this.tts;
  }

  get recordable() {
    return this.tts !== "instant";
  }

  start() {
    this.listener.start();
    this.listen();
  }

  // The browser's own voice plays outside the page, where it can't be recorded: Studio instead
  useStudio() {
    this.tts = "studio";
    this.start();
  }

  stop() {
    this.listener.stop();
    this.turn++;
    this.stopSpeaking();
    stopReply();
  }

  setMuted(muted) {
    if (muted) {
      this.listener.drop();
      status.set(status.state === "speaking" ? "speaking" : "listening");
    } else {
      this.listen();
    }
  }

  setRobot() {}
  setOnAir() {}

  earClosed() {
    return this.listener.earClosed();
  }

  say(text) {
    if (status.state !== "speaking") this.ask("", { note: text });
    else status.note(text, 6000);
  }

  // ---------- Listening ----------
  listen() {
    this.turn++;
    const wasSpeaking = status.state === "speaking";
    this.stopSpeaking();
    this.listener.reset();
    if (wasSpeaking) this.listener.closeEar(ECHO_TAIL_MS);
    status.set("listening");
    audio.resume();
  }

  // You cut the AI off: you're already talking, so listen again almost at once
  interrupt() {
    this.listen();
    this.listener.closeEar(120);
  }

  async handleUtterance(chunks) {
    const mine = ++this.turn;
    status.set("thinking", "Understanding…");
    try {
      const text = await api.voice.transcribe(toWav(chunks, audio.ctx.sampleRate));
      if (mine !== this.turn) return;
      if (!text || text.trim().length < 2) return this.listen();
      // The mic caught the AI's own voice (speakers): answering that would make it repeat itself
      if (isEcho(text, spoken.text())) return this.listen();
      this.ask(text);
    } catch (err) {
      if (mine !== this.turn) return;
      status.set("error", voiceErrorText(err.message));
      setTimeout(() => {
        if (mine === this.turn) this.listen();
      }, 2000);
    }
  }

  // ---------- Speaking ----------
  stopSpeaking() {
    this.clearQueue();
    speech.stopPlayback();
  }

  clearQueue() {
    this.queue = [];
    this.draining = false;
    speech.cut();
  }

  // Something you said (or typed): the AI answers, and its reply is spoken.
  // greet: nothing was said; the AI opens the conversation. note: the app tells
  // the AI something to say (a reminder went off); it isn't yours either.
  async ask(text, { greet = false, note: appNote = "" } = {}) {
    if (appNote) greet = true;
    if (!greet && (!text || !text.trim())) return;
    const said = String(text || "").trim();
    const mine = ++this.turn;
    const current = () => mine === this.turn;
    this.stopSpeaking();
    this.listener.drop();
    if (!greet) {
      captions.show("You", said, true);
      addTranscript("user", said);
    }
    robot.director.resetTurn();
    if (!greet) robot.director.userSaid(said);
    status.set("thinking", greet ? "" : "Thinking…");

    await audio.ensureOutput();

    let fullReply = "";
    let buffer = "";
    let pieces = 0;
    let streamFinished = false;

    // The whole reply has been said: the turn is over (Smarter moods reads it now)
    const finishTurn = () => {
      robot.director.turnDone();
      this.listen();
    };

    const playNext = async () => {
      if (this.draining) return;
      this.draining = true;

      while (this.queue.length > 0 && current()) {
        const item = this.queue.shift();
        try {
          if (status.state !== "speaking") this.listener.beginSpeaking();
          status.set("speaking");
          captions.show(characterName(), item.cumulativeText, false);
          // This piece's mood shows as it starts to be heard
          robot.director.pieceStarts(item.reading, item.text);
          await item.play();
        } catch (err) {
          console.warn("Sentence playback error:", err);
        }
      }

      this.draining = false;
      if (!current()) return;
      if (streamFinished && this.queue.length === 0) finishTurn();
      else speakMore(); // it finished before the next piece was ready
    };

    const queuePiece = (pieceText) => {
      const clean = pieceText.replace(/[*_#`~]/g, "").trim();
      if (!clean || clean.length < 2) return;

      // Studio voice: start making the audio now, so it's ready when its turn comes
      const studio = this.tts !== "instant";
      const made = studio ? speech.make(clean) : null;
      const cumulativeText = fullReply;
      // Read now; its mood shows when the piece starts playing (see playNext)
      const reading = robot.director.readPiece(clean, { turnStart: pieces === 1 });

      const play = async () => {
        if (!current()) return;
        if (studio) await speech.blob(clean, current, made);
        else await speech.system(clean, current);
      };

      this.queue.push({ cumulativeText, play, reading, text: `${clean} ` });
      playNext();
    };

    const speakMore = (all = false) => {
      for (;;) {
        const piece = takeSpeakable(buffer, { first: pieces === 0, idle: !this.draining && !this.queue.length, all });
        if (!piece) return;
        buffer = buffer.slice(piece.length);
        pieces++;
        queuePiece(piece);
        if (all) return;
      }
    };

    try {
      const { error } = await (greet ? greetFromVoice : askFromVoice)(said, {
        robot: robotOnScreen(),
        onAir: isOnAir(),
        note: appNote,
        onChunk(chunk) {
          if (!current()) return;
          fullReply += chunk;
          buffer += chunk;
          addTranscript("model", chunk);
          speakMore();
        },
        onDraft(draft) {
          if (!current()) return;
          addDraft(draft);
          status.note(t("Draft ready: {title}", { title: draft.title }), 3000);
        },
      });

      if (!current()) return;
      if (error) throw new Error(error);

      endTurn();
      spoken.add(fullReply);
      streamFinished = true;
      speakMore(true);
      if (this.queue.length === 0 && !this.draining) finishTurn();
    } catch (err) {
      if (!current()) return;
      endTurn();
      status.set("error", voiceErrorText(err.message));
      setTimeout(() => {
        if (current()) this.listen();
      }, 2500);
    }
  }
}
