// ---------- "Follow my face" ----------
// The webcam and a small face detector (MediaPipe's BlazeFace), both running
// in this browser: nothing is sent anywhere. About ten times a second it finds
// the biggest face and tells the robot where it is, so its eyes follow you.
// The detector's code, WebAssembly and model are served by the helper
// (/vendor/mediapipe/, /models/face/), and load only when this is switched on.
const WASM = "/vendor/mediapipe/wasm";
const MODEL = "/models/face/blaze_face_short_range.tflite";

let detector = null;
let loadingDetector = null;

async function loadDetector() {
  if (detector) return detector;
  loadingDetector ||= (async () => {
    const vision = await import("/vendor/mediapipe/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
    detector = await vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    return detector;
  })().catch((err) => {
    loadingDetector = null;
    throw err;
  });
  return loadingDetector;
}

// Why the camera can't be used, in words a person can act on
function cameraProblem(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return { state: "blocked", message: "The camera is blocked for this page. Allow it in the browser's site settings, then switch this off and on." };
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return { state: "busy", message: "The camera is busy in another app." };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { state: "none", message: "No camera was found." };
  return { state: "error", message: `Face tracking stopped: ${err?.message || "unknown error"}` };
}

export class FaceTracker {
  // onFace({ x, y } | null): -1..1, the viewer's right and up; onStatus({ state, message })
  constructor({ onFace, onStatus }) {
    this.onFace = onFace;
    this.onStatus = onStatus;
    this.stream = null;
    this.video = null;
    this.timer = null;
    this.running = false;
    this.smoothed = null;
    this.lastSeen = 0;
    this.status = "off";
  }

  setStatus(state, message = "") {
    this.status = state;
    this.onStatus?.({ state, message });
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.setStatus("starting", "Starting the camera…");
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("This browser can't use a camera."), { name: "NotFoundError" });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 30 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      this.running = false;
      const { state, message } = cameraProblem(err);
      return this.setStatus(state, message);
    }
    if (!this.running) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;
    try {
      await video.play();
      await loadDetector();
    } catch (err) {
      this.stop();
      return this.setStatus("error", `Face tracking couldn't start: ${err.message}`);
    }
    if (!this.running) return;
    this.setStatus("looking", "Looking for your face…");
    this.loop();
  }

  loop() {
    if (!this.running) return;
    this.timer = setTimeout(() => this.loop(), 100);
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    let result;
    try {
      result = detector.detectForVideo(video, performance.now());
    } catch {
      return;
    }
    // The biggest face is the one closest to the camera: you
    let best = null;
    for (const d of result?.detections || []) {
      const b = d.boundingBox;
      if (b && (!best || b.width * b.height > best.width * best.height)) best = b;
    }
    const now = performance.now();
    if (!best) {
      if (this.smoothed && now - this.lastSeen > 1500) {
        this.smoothed = null;
        this.onFace(null);
        this.setStatus("looking", "Looking for your face…");
      }
      return;
    }
    // The camera sees you mirrored: your left is its right
    const x = -(((best.originX + best.width / 2) / video.videoWidth) * 2 - 1);
    const y = -(((best.originY + best.height / 2) / video.videoHeight) * 2 - 1);
    const target = { x: Math.max(-1, Math.min(1, x * 1.3)), y: Math.max(-1, Math.min(1, y * 1.1 + 0.1)) };
    if (!this.smoothed) this.smoothed = target;
    else {
      this.smoothed.x += (target.x - this.smoothed.x) * 0.35;
      this.smoothed.y += (target.y - this.smoothed.y) * 0.35;
    }
    this.lastSeen = now;
    this.onFace({ ...this.smoothed });
    if (this.status !== "on") this.setStatus("on", "Following your face");
  }

  // Lets go of the camera (its light goes off)
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.smoothed = null;
    this.onFace(null);
    if (this.status !== "off" && !["blocked", "busy", "none", "error"].includes(this.status)) this.setStatus("off", "");
  }
}
