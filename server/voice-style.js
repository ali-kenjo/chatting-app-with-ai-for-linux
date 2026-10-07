// How a voice conversation takes turns, by Settings → Voice → Conversation style:
// how long Gemini Live waits after you stop talking before it may answer, and how
// sure it must be that you're done. (What the AI is told about when to talk and
// when to listen is in prompt.js; how easily your voice cuts it off is in the page.)
const settings = require("./settings");

const STYLES = settings.VOICE.styles;

// Seconds of quiet that end your turn. A pause to think is longer than you'd guess.
const SILENCE_MS = { listener: 2500, balanced: 1300, chatty: 700 };

// The sensitivity settings are documented for the native-audio models (Gemini 3.8 Live);
// the older Live models only get the pause lengths.
const NATIVE = /^gemini-3\.8-live|native-audio/;

const styleOf = (value) => (STYLES.includes(value) ? value : settings.DEFAULTS.voice.style);

// realtimeInputConfig.automaticActivityDetection for a style and a Live model
function detection(style, model) {
  const s = styleOf(style);
  const config = { prefixPaddingMs: 100, silenceDurationMs: SILENCE_MS[s] };
  if (NATIVE.test(String(model || ""))) {
    config.endOfSpeechSensitivity = s === "chatty" ? "END_SENSITIVITY_HIGH" : "END_SENSITIVITY_LOW";
    if (s === "listener") config.startOfSpeechSensitivity = "START_SENSITIVITY_LOW"; // a cough or a rustle doesn't start a turn
  }
  return config;
}

// Gemini 3.8 Live can decide by itself not to answer speech that isn't meant for it
// (https://ai.google.dev/gemini-api/docs/live-api/capabilities). Only the listener style asks for it.
const proactive = (style, model) => styleOf(style) === "listener" && /^gemini-3\.8-live/.test(String(model || ""));

module.exports = { STYLES, SILENCE_MS, styleOf, detection, proactive };
