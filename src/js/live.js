// ---------- Gemini Live, the page's side ----------
// Streams the microphone to the helper (/api/live) and plays the AI's voice
// the moment it arrives. The helper keeps the API key and talks to Gemini
// (server/live.js). The AI hears you directly, so there's no separate
// speech-to-text step, and it can be interrupted like a person.
const HOLD = 10; // mic chunks (~0.4 s) held back while the AI talks
const ECHO_TAIL = 0.35; // s the mic stays held after the AI stops: the room's echo
const LEARN = 0.6; // s at the start of the AI's speech spent learning how loud its echo is
const BARGE = 0.25; // s you need to talk over it before it stops
const CUSHION = 0.08; // s of audio gathered before a new stretch of speech starts playing

const loadedWorklets = new WeakSet();

export class LiveVoice {
  // audioCtx: the page's AudioContext; micSource: a node carrying your mic (or null);
  // output: where the AI's voice goes (visualizer, speakers, recorder); handlers: see handle()
  constructor({ audioCtx, micSource, output, handlers }) {
    this.ctx = audioCtx;
    this.micSource = micSource;
    this.output = output;
    this.on = handlers;
    this.ws = null;
    this.node = null;
    this.sink = null;
    this.ready = false;
    this.closed = false;
    this.muted = false;
    this.rate = 24000;
    this.sources = new Set();
    this.playEnd = 0; // when the queued AI audio ends (AudioContext time)
    this.speakStart = 0;
    this.speaking = false;
    this.held = [];
    this.echoPeak = 0;
    this.bargeSince = 0;
    this.turnOpen = false; // an answer is on its way
    this.dropAudio = false; // the rest of an answer you cut off
    this.timer = null;
    this.queue = []; // its captions, robot moves and turn ends, waiting for its voice (see later())
    this.queueTimer = null;
  }

  // Resolves once Gemini is ready to talk; rejects with a readable message
  async start(startMessage) {
    if (this.micSource) await this.startCapture();
    this.timer = setInterval(() => this.checkSpeaking(), 80);
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live`);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "start", ...startMessage }));
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return this.play(e.data);
        const event = JSON.parse(e.data);
        if (event.type === "ready") {
          this.ready = true;
          settle(resolve, event);
        } else if (event.type === "error" && !settled) {
          return settle(reject, new Error(event.error));
        }
        this.handle(event);
      };
      ws.onclose = () => {
        const wasReady = this.ready;
        this.ready = false;
        settle(reject, new Error("Couldn't reach the Friends helper. Is `npm start` still running?"));
        if (wasReady && !this.closed) this.on.onClosed?.();
      };
    });
  }

  async startCapture() {
    if (!loadedWorklets.has(this.ctx)) {
      await this.ctx.audioWorklet.addModule("/js/mic-worklet.js");
      loadedWorklets.add(this.ctx);
    }
    this.node = new AudioWorkletNode(this.ctx, "mic-capture");
    this.node.port.onmessage = (e) => this.fromMic(e.data);
    // The worklet only runs while connected to the output; this keeps it silent
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.micSource.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);
  }

  send(event) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  // ---------- Your voice ----------
  // While the AI talks, the mic also hears it. Its voice is held back, unless
  // something clearly louder than its echo lasts a moment: that's you cutting in.
  fromMic({ pcm, level }) {
    if (!this.ready || this.muted || this.ws.readyState !== WebSocket.OPEN) return;
    const now = this.ctx.currentTime;
    if (now >= this.playEnd + ECHO_TAIL) {
      this.held.length = 0;
      this.ws.send(pcm);
      return;
    }
    this.held.push(pcm);
    if (this.held.length > HOLD) this.held.shift();
    if (now > this.playEnd || now - this.speakStart < LEARN) {
      this.echoPeak = Math.max(this.echoPeak, level);
      this.bargeSince = 0;
      return;
    }
    if (level > Math.max(0.03, this.echoPeak * 2.5)) {
      this.bargeSince ||= now;
      if (now - this.bargeSince >= BARGE) this.cutIn();
    } else {
      this.bargeSince = 0;
      this.echoPeak = Math.max(level, this.echoPeak * 0.995);
    }
  }

  // You talked over it: stop its voice now and send what you've said so far
  cutIn() {
    this.bargeSince = 0;
    this.silence();
    for (const chunk of this.held.splice(0)) this.ws.send(chunk);
    this.on.onInterrupted?.();
  }

  // Stops its voice; the rest of that answer isn't played when it arrives
  silence() {
    if (this.turnOpen) this.dropAudio = true;
    this.stopPlayback();
    this.playEnd = this.ctx.currentTime - ECHO_TAIL; // no echo left to wait for
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.send({ type: "audio-end" });
  }

  sendText(text) {
    this.silence();
    this.send({ type: "text", text });
  }

  // The robot body appeared or went away: the AI gets or loses its robot moves
  setRobot(on) {
    this.send({ type: "robot", on });
  }

  // ---------- Its voice ----------
  play(data) {
    if (this.dropAudio || this.closed) return;
    this.turnOpen = true;
    const pcm = new Int16Array(data.byteLength % 2 ? data.slice(0, -1) : data);
    if (!pcm.length) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, this.rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);
    const now = this.ctx.currentTime;
    if (this.playEnd < now) {
      // A new stretch of speech: a small cushion, so it plays without gaps
      this.playEnd = now + CUSHION;
      this.speakStart = this.playEnd;
      this.echoPeak = 0;
    }
    source.start(this.playEnd);
    this.playEnd += buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    this.checkSpeaking();
  }

  stopPlayback() {
    this.dropQueue();
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    this.playEnd = Math.min(this.playEnd, this.ctx.currentTime);
    this.checkSpeaking();
  }

  checkSpeaking() {
    const speaking = this.playEnd > this.ctx.currentTime;
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    this.on.onSpeaking?.(speaking);
  }

  // Its voice, or the room's echo of it, may still be in the mic
  aiAudible() {
    return this.ctx.currentTime < this.playEnd + ECHO_TAIL;
  }

  // Events from the helper → handlers: onTranscript(role, text), onInterrupted(),
  // onTurnComplete(), onChat({id, title}), onActivity(text), onDraft(draft),
  // onConfirm({summary, details}) → Promise<boolean>, onRobot({mood} | {gesture}),
  // onReconnecting(), onResumed(), onError(message), onClosed()
  handle(event) {
    switch (event.type) {
      case "audio-format":
        this.rate = event.rate;
        break;
      case "transcript":
        if (event.role === "user") return this.on.onTranscript?.("user", event.text);
        if (this.dropAudio) return; // the answer you cut off
        this.turnOpen = true;
        this.later("caption", () => this.on.onTranscript?.("model", event.text));
        break;
      case "interrupted":
        this.stopPlayback();
        this.dropAudio = false;
        this.turnOpen = false;
        this.on.onInterrupted?.();
        break;
      case "turn-complete":
        this.dropAudio = false;
        this.turnOpen = false;
        this.later("turn", () => this.on.onTurnComplete?.());
        break;
      case "chat":
        this.on.onChat?.(event);
        break;
      case "activity":
        this.on.onActivity?.(event.text);
        break;
      case "draft":
        this.on.onDraft?.(event.draft);
        break;
      case "robot":
        if (this.dropAudio) return; // part of the answer you cut off
        this.later("robot", () => this.on.onRobot?.({ mood: event.mood, gesture: event.gesture }));
        break;
      case "confirm":
        Promise.resolve(this.on.onConfirm?.(event)).then((allow) => this.send({ type: "confirm", id: event.id, allow: allow === true }));
        break;
      case "reconnecting":
        this.on.onReconnecting?.();
        break;
      case "resumed":
        this.on.onResumed?.();
        break;
      case "error":
        this.on.onError?.(event.error);
        break;
    }
  }

  // Gemini sends its voice faster than it's played, so its captions, robot
  // moves and the end of its turn arrive while the speech before them is still
  // queued. Each waits, in order, until the audio that came before it has been
  // heard: a move after the punchline happens after it, captions don't give it
  // away early. Cutting in drops what's waiting, except the end of the turn.
  later(kind, fn) {
    const due = this.playEnd;
    if (!this.queue.length && due - this.ctx.currentTime <= 0.05) return fn();
    this.queue.push({ due, kind, fn });
    this.pump();
  }

  pump() {
    clearTimeout(this.queueTimer);
    while (this.queue.length && this.queue[0].due - this.ctx.currentTime <= 0.02) this.queue.shift().fn();
    if (this.queue.length) this.queueTimer = setTimeout(() => this.pump(), (this.queue[0].due - this.ctx.currentTime) * 1000);
  }

  dropQueue() {
    clearTimeout(this.queueTimer);
    for (const item of this.queue.splice(0)) if (item.kind === "turn" && !this.closed) item.fn();
  }

  stop() {
    this.closed = true;
    clearInterval(this.timer);
    this.stopPlayback();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    try {
      this.micSource?.disconnect(this.node);
    } catch {}
    this.node?.disconnect();
    this.sink?.disconnect();
    if (this.node) this.node.port.onmessage = null;
  }
}
