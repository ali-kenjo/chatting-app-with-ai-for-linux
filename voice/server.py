#!/usr/bin/env python3
"""Friends' local voice server: listening (Whisper) and speaking (Piper) on this
computer, with the OpenAI-style endpoints Friends already speaks:

  POST /v1/audio/transcriptions   multipart: file, model, [language]  ->  {"text": "..."}
  POST /v1/audio/speech           json: input, [voice: female|male|<piper voice>]  ->  audio/wav
  GET  /health, GET /v1/models

Nothing leaves this computer: it only listens on 127.0.0.1 and answers requests
whose Host is localhost. The helper (server/voice.js) installs and starts it.

  python server.py --prepare                 download the models, then exit
  python server.py [--port 8178] [--whisper small] [--idle-exit 900]
"""
import argparse
import io
import json
import os
import re
import sys
import threading
import time
import wave
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 40 * 1024 * 1024
APP = "friends-voice"

# female / male Piper voices per language (the first two are downloaded by --prepare)
VOICES = {
    "en": {"female": "en_US-lessac-medium", "male": "en_US-ryan-medium"},
    "de": {"female": "de_DE-ramona-low", "male": "de_DE-thorsten-medium"},
    "ar": {"female": "ar_JO-kareem-medium", "male": "ar_JO-kareem-medium"},
}
PREPARED = ["en", "de"]
GERMAN_WORDS = set("der die das und ist nicht ich du wir ein eine mit für auf zu den dem es sie aber auch wie was wenn hallo danke bitte ja nein noch schon sehr nur oder wird kann habe bin".split())


def language_of(text):
    """'ar', 'de' or 'en': enough to pick a voice, not a language detector."""
    if re.search(r"[؀-ۿ]", text):
        return "ar"
    words = re.findall(r"[a-zäöüß]+", text.lower())
    if re.search(r"[äöüß]", text) or sum(w in GERMAN_WORDS for w in words) >= 2:
        return "de"
    return "en"


def decode_wav(data):
    """16-bit PCM WAV bytes -> mono float32 samples at 16 kHz (what Whisper wants),
    or None when it isn't a plain WAV (then Whisper's own decoder is used)."""
    import numpy as np

    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if wav.getsampwidth() != 2:
                return None
            channels, rate = wav.getnchannels(), wav.getframerate()
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    except (wave.Error, EOFError):
        return None
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if rate != 16000 and len(samples):
        target = int(len(samples) * 16000 / rate)
        samples = np.interp(np.linspace(0, len(samples) - 1, target), np.arange(len(samples)), samples).astype(np.float32)
    return samples


class Engines:
    """The two models, loaded when first needed (they take memory)."""

    def __init__(self, data_dir, whisper_name, threads):
        self.data_dir = Path(data_dir)
        self.whisper_name = whisper_name
        self.threads = threads
        self.lock = threading.Lock()  # the models aren't thread-safe
        self._whisper = None
        self._voices = {}

    def whisper(self):
        if self._whisper is None:
            from faster_whisper import WhisperModel

            self._whisper = WhisperModel(
                self.whisper_name,
                device="cpu",
                compute_type="int8",
                cpu_threads=self.threads,
                download_root=str(self.data_dir / "whisper"),
            )
        return self._whisper

    def voice(self, name):
        if name not in self._voices:
            from piper import PiperVoice

            folder = self.data_dir / "voices"
            model = folder / f"{name}.onnx"
            if not model.exists():
                from piper.download_voices import download_voice

                folder.mkdir(parents=True, exist_ok=True)
                download_voice(name, folder)
            self._voices[name] = PiperVoice.load(str(model))
        return self._voices[name]

    def transcribe(self, audio, language=None):
        with self.lock:
            samples = decode_wav(audio)
            segments, _info = self.whisper().transcribe(
                samples if samples is not None else io.BytesIO(audio),
                language=language or None,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.7).strip()

    def speak(self, text, voice="female"):
        lang = language_of(text)
        name = voice if re.match(r"^[a-z]{2}_[A-Z]{2}-[\w]+-\w+$", voice or "") else VOICES[lang]["male" if voice == "male" else "female"]
        with self.lock:
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav:
                self.voice(name).synthesize_wav(text, wav)
            return buffer.getvalue()

    def prepare(self):
        print("Downloading the speech recognition model…", flush=True)
        self.whisper()
        for lang in PREPARED:
            for name in sorted(set(VOICES[lang].values())):
                print(f"Downloading the voice {name}…", flush=True)
                self.voice(name)
        print("Ready.", flush=True)


def make_handler(engines, state):
    class Handler(BaseHTTPRequestHandler):
        server_version = APP

        def log_message(self, *_):  # quiet: the helper keeps the log
            pass

        def reply(self, status, body, kind="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def trusted(self):
            # Only requests addressed to this computer (blocks DNS rebinding from websites)
            return re.match(r"^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", self.headers.get("Host", "")) is not None

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ValueError("The request is too large.")
            return self.rfile.read(length)

        def do_GET(self):
            if not self.trusted():
                return self.reply(403, {"error": "Forbidden"})
            state["last"] = time.time()
            if self.path == "/health":
                return self.reply(200, {"app": APP, "ok": True, "whisper": engines.whisper_name})
            if self.path == "/v1/models":
                return self.reply(200, {"data": [{"id": engines.whisper_name}, {"id": "piper"}]})
            self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if not self.trusted():
                return self.reply(403, {"error": "Forbidden"})
            state["last"] = time.time()
            try:
                if self.path == "/v1/audio/transcriptions":
                    message = BytesParser(policy=HTTP).parsebytes(
                        b"Content-Type: " + self.headers.get("Content-Type", "").encode() + b"\r\n\r\n" + self.body()
                    )
                    fields = {}
                    for part in message.iter_parts():
                        fields[part.get_param("name", header="content-disposition")] = part.get_payload(decode=True)
                    if not fields.get("file"):
                        return self.reply(400, {"error": "No audio file."})
                    language = (fields.get("language") or b"").decode() or None
                    return self.reply(200, {"text": engines.transcribe(fields["file"], language)})
                if self.path == "/v1/warm":
                    # Loads the models now, so the first answer isn't slow (the helper calls this when voice mode opens)
                    engines.whisper()
                    engines.voice(VOICES["en"]["female"])
                    return self.reply(200, {"ok": True})
                if self.path == "/v1/audio/speech":
                    request = json.loads(self.body() or b"{}")
                    text = str(request.get("input") or "").strip()
                    if not text:
                        return self.reply(400, {"error": "Nothing to say."})
                    return self.reply(200, engines.speak(text[:4000], str(request.get("voice") or "female")), "audio/wav")
                self.reply(404, {"error": "Not found"})
            except Exception as err:  # reported to the helper, which falls back to the browser's voice
                self.reply(500, {"error": f"{type(err).__name__}: {err}"})

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8178)
    parser.add_argument("--whisper", default=os.environ.get("FRIENDS_WHISPER_MODEL", "small"))
    parser.add_argument("--data-dir", default=str(Path(__file__).resolve().parent / "data"))
    parser.add_argument("--idle-exit", type=int, default=0, help="seconds without a request before it quits (0: never)")
    parser.add_argument("--prepare", action="store_true", help="download the models and exit")
    args = parser.parse_args()

    engines = Engines(args.data_dir, args.whisper, max(2, (os.cpu_count() or 4) // 2))
    if args.prepare:
        engines.prepare()
        return

    state = {"last": time.time()}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(engines, state))
    if args.idle_exit:
        def watch():
            while True:
                time.sleep(15)
                if time.time() - state["last"] > args.idle_exit:
                    print("Idle; quitting (it starts again when needed).", flush=True)
                    os._exit(0)

        threading.Thread(target=watch, daemon=True).start()
    print(f"{APP} listening on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
