// ---------- Recording voice mode as a video ----------
// The visualizer (the canvas) plus the voices, straight from the page, so the
// video has none of the buttons. MP4 where the browser can make it, else WebM.
import { t } from "./i18n.js";
const TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function videoType() {
  if (!window.MediaRecorder?.isTypeSupported) return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
}

export class VoiceRecorder {
  // sources: audio nodes to record (the AI's voice, and yours if wanted)
  constructor({ canvas, audioCtx, sources, fps = 30 }) {
    this.canvas = canvas;
    this.ctx = audioCtx;
    this.sources = sources;
    this.fps = fps;
  }

  start() {
    this.type = videoType();
    if (!this.type) throw new Error(t("This browser can't record video."));
    this.dest = this.ctx.createMediaStreamDestination();
    for (const node of this.sources) node.connect(this.dest);
    this.video = this.canvas.captureStream(this.fps);
    const stream = new MediaStream([...this.video.getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.type, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.startedAt = performance.now();
  }

  get seconds() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  // Resolves with { blob, extension, seconds }
  stop() {
    return new Promise((resolve) => {
      const seconds = this.seconds;
      this.recorder.onstop = () => {
        for (const node of this.sources) {
          try {
            node.disconnect(this.dest);
          } catch {}
        }
        this.video.getTracks().forEach((t) => t.stop());
        const type = this.type.split(";")[0];
        resolve({ blob: new Blob(this.chunks, { type }), extension: type === "video/mp4" ? "mp4" : "webm", seconds });
      };
      this.recorder.stop();
    });
  }
}

export function download(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
