// Saying a reply out loud, a piece at a time (Studio and Instant voice)
import { api } from "../../api.js";
import { getSettings } from "../../store.js";
import { playbackRate } from "../../personality.js";
import { activeCharacter } from "../../characters.js";
import { audio } from "../audio.js";

// The next piece of a reply to speak: the first sentence on its own (so it
// starts talking soon), then about two sentences at a time, which sounds
// more natural and needs fewer voice requests. Right away when nothing is
// playing, so there's no silence while it waits.
export function takeSpeakable(text, { first, idle, all }) {
  if (all) return text.trim() ? text : null;
  const ends = /[.!?…]+["'”’)\]]*(?=\s)|\n+/g;
  let cut = -1;
  for (let m; (m = ends.exec(text)); ) {
    const end = m.index + m[0].length;
    if (end < 12) continue;
    cut = end;
    if (first || idle || end >= 180) break;
  }
  if (cut < 0 || (!first && !idle && cut < 180)) return null;
  return text.slice(0, cut);
}

// A system voice in the browser's language, preferring the natural-sounding ones
let systemVoice;
function pickSystemVoice() {
  if (systemVoice !== undefined) return systemVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet; try again next sentence
  const good = (v) => /Natural|Google|Siri|Samantha/.test(v.name);
  // The character's gender, when the voice's name says it (e.g. "Google UK English Male")
  const male = activeCharacter()?.gender === "male";
  const fits = (v) => (male ? /\bmale\b|daniel|thomas|david|alex|fred|ryan|guy/i : /female|samantha|karen|victoria|zira|anna|helena|moira|tessa/i).test(v.name);
  const lang = (navigator.language || "en").slice(0, 2);
  const inLang = voices.filter((v) => v.lang.startsWith(lang));
  const english = voices.filter((v) => v.lang.startsWith("en"));
  systemVoice = inLang.find((v) => fits(v) && good(v)) || inLang.find(fits) || inLang.find(good) || inLang[0] || english.find(fits) || english.find(good) || english[0] || null;
  return systemVoice;
}

let abortCurrent = null; // cuts off the piece that is playing

export const speech = {
  // Another character: another system voice
  resetVoice() {
    systemVoice = undefined;
  },

  // Studio voice: a Gemini voice, in the active character's voice. Resolves a Blob, or null.
  make: (text) => api.voice.speak(text).catch(() => null),

  // The piece that is playing ends now (its promise resolves)
  cut() {
    if (abortCurrent) {
      abortCurrent();
      abortCurrent = null;
    }
  },

  // Nothing plays any more (queues are the engine's)
  stopPlayback() {
    const { player } = audio;
    if (player) {
      player.pause();
      player.onended = null;
      player.onerror = null;
    }
    window.speechSynthesis?.cancel();
  },

  // Native SpeechSynthesis (Instant voice: no network, starts speaking in < 150ms).
  // isCurrent(): false once the turn this piece belongs to is over.
  system(sentence, isCurrent) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !isCurrent()) return resolve();

      const utterance = new SpeechSynthesisUtterance(sentence);
      const s = getSettings();
      utterance.rate = s ? playbackRate(s) : 1;
      utterance.pitch = 1.0;

      const naturalVoice = pickSystemVoice();
      if (naturalVoice) utterance.voice = naturalVoice;

      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };

      utterance.onend = done;
      utterance.onerror = done;
      abortCurrent = () => {
        window.speechSynthesis.cancel();
        done();
      };

      const words = sentence.split(/\s+/).length;
      setTimeout(done, Math.max(1500, words * 700));

      window.speechSynthesis.speak(utterance);
    });
  },

  // Studio voice: a Gemini voice, made for this piece while the one before played
  async blob(sentence, isCurrent, made) {
    if (!isCurrent()) return;
    const s = getSettings();
    try {
      const blob = await made;
      if (!blob) throw new Error("No audio");
      if (!isCurrent()) return;

      await new Promise((resolve) => {
        const { player } = audio;
        if (!player) return resolve();
        if (player.src) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(blob);
        player.playbackRate = s ? playbackRate(s) : 1;
        player.onended = resolve;
        player.onerror = resolve;
        abortCurrent = () => {
          player.pause();
          resolve();
        };
        player.play().catch(resolve);
      });
    } catch {
      // No Gemini voice for this piece (e.g. its quota ran out): the browser's voice says it
      await speech.system(sentence, isCurrent);
    }
  },
};
