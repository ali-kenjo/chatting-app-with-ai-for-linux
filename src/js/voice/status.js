// What voice mode is doing right now, and the status line that says so.
// States: "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "standby" | "error"
import { robot } from "../robot/index.js";
import { t } from "../i18n.js";
import { voiceMode, voiceStatus, isMuted } from "./dom.js";

const STATUS = {
  connecting: t("Connecting…"),
  listening: t("Listening…"),
  hearing: t("Hearing you…"),
  thinking: t("Thinking…"),
  speaking: t("Speaking · tap to interrupt"),
  standby: t("Microphone standby · Click to enable"),
  error: t("Microphone unavailable"),
};

let state = "listening";
let noteUntil = 0;
let noteTimer = null;

export const status = {
  get state() {
    return state;
  },

  set(next, text) {
    state = next;
    voiceMode.dataset.state = next;
    robot.director.voiceState(next, { muted: isMuted() });
    if (performance.now() < noteUntil) return;
    if (isMuted() && (next === "listening" || next === "hearing")) {
      voiceStatus.textContent = t("Microphone muted");
    } else {
      voiceStatus.textContent = text || STATUS[next] || "";
    }
  },

  // A short message in the status pill that wins over the normal status for a while
  note(text, ms = 3000) {
    clearTimeout(noteTimer);
    noteUntil = text ? performance.now() + ms : 0;
    if (text) voiceStatus.textContent = text;
    noteTimer = setTimeout(() => {
      noteUntil = 0;
      status.set(state);
    }, text ? ms : 0);
  },
};
