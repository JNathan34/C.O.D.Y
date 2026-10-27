#!/usr/bin/env python3
"""Small, purpose-limited speech backend for C.O.D.Y. Voice Lab.

The Electron process invokes only known commands and passes JSON through a local
temporary file. There is no shell evaluation or arbitrary command execution.
"""
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import urllib.request
import wave
import zipfile

MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"


def write_result(job, data):
    Path(job["resultPath"]).write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )


async def edge_voices(job):
    import edge_tts
    voices = await edge_tts.list_voices()
    filtered = [
        {
            "id": v["ShortName"],
            "name": f'{v["FriendlyName"]} · {v["Locale"]}',
            "language": v["Locale"]
        }
        for v in voices if v["Locale"].startswith("en-")
    ]
    filtered.sort(key=lambda v: (not v["language"].startswith("en-GB"), v["id"]))
    write_result(job, {"voices": filtered})


async def edge_speak(job):
    import edge_tts
    speed = max(0.6, min(1.5, float(job.get("speed", 1.0))))
    rate = f"{round((speed - 1) * 100):+d}%"
    reader = edge_tts.Communicate(
        text=job["text"], voice=job["voice"] or "en-GB-RyanNeural", rate=rate
    )
    await reader.save(job["audioPath"])


def modern_voices(job):
    from winrt.windows.media.speechsynthesis import SpeechSynthesizer
    voices = []
    for v in SpeechSynthesizer.all_voices:
        voices.append({
            "id": v.id,
            "name": f"{v.display_name} · {v.language}",
            "language": v.language,
        })
    write_result(job, {"voices": voices})


async def modern_speak(job):
    from winrt.windows.media.speechsynthesis import SpeechSynthesizer
    from winrt.windows.storage.streams import DataReader
    synth = SpeechSynthesizer()
    selected = job.get("voice", "")
    if selected:
        match = next(
            (v for v in SpeechSynthesizer.all_voices if v.id == selected), None
        )
        if match is None:
            raise ValueError("This Windows voice is not available via WinRT.")
        synth.voice = match
    synth.options.speaking_rate = max(0.6, min(1.5, float(job.get("speed", 1.0))))
    stream = await synth.synthesize_text_to_stream_async(job["text"])
    byte_count = int(stream.size)
    if byte_count <= 0 or byte_count > 25_000_000:
        raise RuntimeError("Windows returned an unexpected audio size.")
    reader = DataReader(stream.get_input_stream_at(0))
    loaded = await reader.load_async(byte_count)
    if loaded != byte_count:
        raise RuntimeError(f"Only {loaded}/{byte_count} bytes received from Windows.")
    data = bytearray(byte_count)
    reader.read_bytes(data)
    Path(job["audioPath"]).write_bytes(data)


def install_model(job):
    target = Path(job["modelDir"]).resolve()
    target.mkdir(parents=True, exist_ok=True)
    model = target / MODEL_NAME
    if (model / "am" / "final.mdl").exists():
        write_result(job, {"installed": True, "existing": True})
        return

    # Download only from the pinned model URL, never from model-generated text.
    with tempfile.TemporaryDirectory(prefix="cody-voskm-") as staging:
        zip_file = Path(staging) / "model.zip"
        with urllib.request.urlopen(MODEL_URL, timeout=75) as response:
            if not response.url.startswith("https://alphacephei.com/"):
                raise RuntimeError("Unexpected model download redirect.")
            total = 0
            with zip_file.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 90_000_000:
                        raise RuntimeError("Model download exceeds allowed size.")
                    out.write(chunk)

        # Limit uncompressed archive size and prohibit path traversal.
        with zipfile.ZipFile(zip_file) as archive:
            total_size = sum(i.file_size for i in archive.infolist())
            if total_size > 400_000_000:
                raise RuntimeError("Model archive is unexpectedly large.")
            for info in archive.infolist():
                name = info.filename.replace("\\", "/")
                if not name.startswith(MODEL_NAME + "/"):
                    raise RuntimeError("Unexpected file in voice-model archive.")
                if ".." in Path(name).parts:
                    raise RuntimeError("Unsafe path in voice-model archive.")
            archive.extractall(staging)

        unpacked = Path(staging) / MODEL_NAME
        if not (unpacked / "am" / "final.mdl").exists():
            raise RuntimeError("Incomplete Vosk model archive.")
        if model.exists():
            shutil.rmtree(model)
        shutil.move(str(unpacked), str(model))

    write_result(job, {"installed": True, "existing": False})


def transcribe(job):
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
    model_dir = Path(job["modelDir"]) / MODEL_NAME
    if not (model_dir / "am" / "final.mdl").exists():
        raise RuntimeError("Click 'Install microphone recognition' first.")
    raw = base64.b64decode(job["wavBase64"], validate=True)
    with wave.open(io.BytesIO(raw), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2:
            raise RuntimeError("Microphone recording must be 16-bit mono WAV.")
        rate = wav_file.getframerate()
        if rate < 8000 or rate > 48000:
            raise RuntimeError("Unsupported microphone sample rate.")
        if wav_file.getnframes() > rate * 50:
            raise RuntimeError("Recording is too long (50-second limit).")
        rec = KaldiRecognizer(Model(str(model_dir)), rate)
        parts = []
        while True:
            frames = wav_file.readframes(4096)
            if not frames:
                break
            if rec.AcceptWaveform(frames):
                parts.append(json.loads(rec.Result()).get("text", ""))
        parts.append(json.loads(rec.FinalResult()).get("text", ""))
        write_result(job, {"text": " ".join(t for t in parts if t).strip()})


async def main():
    if len(sys.argv) != 4:
        raise ValueError("Usage: speech.py <action> <engine> <json-job>")
    action, engine, file_path = sys.argv[1:4]
    job = json.loads(Path(file_path).read_text(encoding="utf-8"))
    if (action, engine) == ("voices", "edge"):
        await edge_voices(job)
    elif (action, engine) == ("speak", "edge"):
        await edge_speak(job)
    elif (action, engine) == ("voices", "modern"):
        modern_voices(job)
    elif (action, engine) == ("speak", "modern"):
        await modern_speak(job)
    elif (action, engine) == ("install-model", "vosk"):
        install_model(job)
    elif (action, engine) == ("transcribe", "vosk"):
        transcribe(job)
    else:
        raise ValueError("Unsupported speech operation.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
