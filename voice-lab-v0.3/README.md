# C.O.D.Y. Voice Lab 0.3

Standalone Windows Electron app for comparing **Edge Neural** and **installed Windows voices**, and testing a live microphone-to-speech loop. No Kokoro or Pocket TTS.

## Run

1. Download the `voice-lab-v0.3` branch ZIP from GitHub and extract it.
2. Open its `voice-lab-v0.3` subfolder and run `start.bat`.
3. Install Node.js (LTS) if needed; `start.bat` will install Electron on first launch.
4. Windows **Classic/SAPI** voices work without Python.
5. For **Edge Neural** or **Windows Modern (WinRT)** voices, install Python 3.11+ (64-bit), choose that engine, and click **Install support**. Each engine uses a local Python virtual environment in `.venv`.
6. For microphone speech recognition, click **Install microphone recognition** once. This installs Vosk and downloads a roughly 40 MB English model; afterwards recognition works offline.

## What the microphone test does

Press **Start listening**, speak, then press **Stop & transcribe**. The app captures from your selected default microphone, transcribes offline using Vosk, and can speak the recognised text back using the selected voice.

This is a **speech input/output laboratory**, not yet a real ChatGPT conversational interface. It does not call ChatGPT, control Windows, or send recorded microphone audio to a server. Once the C.O.D.Y. core exposes a supported local chat API, the transcript can be routed to it.

## Narrator voices

- **Windows Classic** lists SAPI5 voices available to legacy desktop applications.
- **Windows Modern** calls `Windows.Media.SpeechSynthesis.SpeechSynthesizer.AllVoices`, which may expose additional installed Microsoft voices.
- Some downloaded **Narrator Natural Voices** are used by Narrator but **not exposed to third-party synthesis APIs**. If a natural voice does not appear or cannot synthesise, C.O.D.Y. cannot safely force it without unofficial, brittle adapters.
- No registry edits, package decryption or Narrator workarounds are used.

## Notes

- Edge Neural uses an unofficial online service via `edge-tts`; it needs Internet, can change or become unavailable, and is not a guaranteed production API.
- The model download and `.venv` can be large. Do not commit them to GitHub.
- Microphone capture requires Windows microphone permissions for desktop apps.
- If a voice fails, the app reports the error rather than pretending it spoke successfully.
- Stop cancels current generation where possible and stops current playback.
- The app may need Windows Media Feature Pack on some Windows N editions.

## Licence

This test project is provided for use in the C.O.D.Y. repository. Dependencies retain their own licences. No proprietary HeyClicky files are included.
