#!/usr/bin/env python3
"""Small, purpose-limited Edge Neural and Windows WinRT backend for C.O.D.Y. Voice Lab.

The Electron process invokes only known commands and passes JSON through a local
temporary file. There is no shell evaluation or arbitrary command execution.
"""
import asyncio
import json
from pathlib import Path
import sys


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
    else:
        raise ValueError("Unsupported speech operation.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
