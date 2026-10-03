// ---------- AI personality ----------
import { api } from "./api.js";
import { getSettings, onSettings, updateSettings } from "./store.js";

const voiceGrid = document.getElementById("voice-grid");
const voiceError = document.getElementById("voice-error");
const styleChips = document.getElementById("style-chips");

// Speaking speed 0–10 → playback rate 0.75–1.25 (the pitch stays the same)
export function playbackRate(settings) {
  return 0.75 + settings.personality.speed * 0.05;
}

// Messages for voice errors that need explaining
export function voiceErrorText(message) {
  if (message === "NO_BRAIN") return "Add an AI brain first (Settings → AI control).";
  if (message === "NO_TTS") return "Your Gemini key has no speech model, so the voices can't be played.";
  return message;
}

onSettings((s) => {
  voiceGrid.querySelectorAll(".voice-card").forEach((c) => {
    const selected = Number(c.dataset.voice) === s.personality.voice;
    c.classList.toggle("selected", selected);
    c.setAttribute("aria-checked", selected);
  });
  styleChips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("selected", c.textContent.trim() === s.personality.style));
});

function selectVoice(card) {
  updateSettings((s) => (s.personality.voice = Number(card.dataset.voice)));
}

// Play a short sample in the card's voice
let sample = null; // { card, audio }

function stopSample() {
  if (!sample) return;
  sample.audio?.pause();
  sample.card.classList.remove("playing");
  sample = null;
}

async function playSample(card) {
  const same = sample?.card === card;
  stopSample();
  if (same) return;

  const mine = (sample = { card, audio: null });
  card.classList.add("playing");
  voiceError.hidden = true;
  const s = getSettings();
  const name = s?.personality.name;
  try {
    const blob = await api.voice.speak(`Hi! I'm ${name || "your friend"}. This is how I sound when we talk.`, Number(card.dataset.voice));
    if (sample !== mine) return;
    const audio = new Audio(URL.createObjectURL(blob));
    audio.playbackRate = s ? playbackRate(s) : 1;
    mine.audio = audio;
    audio.addEventListener("ended", () => sample === mine && stopSample());
    await audio.play();
  } catch (err) {
    if (sample !== mine) return;
    stopSample();
    voiceError.textContent = voiceErrorText(err.message);
    voiceError.hidden = false;
  }
}

voiceGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".voice-card");
  if (!card) return;
  if (e.target.closest(".voice-play")) playSample(card);
  else selectVoice(card);
});

voiceGrid.addEventListener("keydown", (e) => {
  const card = e.target.closest(".voice-card");
  if (card && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    selectVoice(card);
  }
});

styleChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  updateSettings((s) => (s.personality.style = chip.textContent.trim()));
  if (chip.hasAttribute("data-custom")) document.getElementById("custom-instructions").focus();
});
