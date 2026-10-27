# C.O.D.Y. Voice Lab v0.4

Experimental Windows **Electron** application for testing Edge Neural speech, installed Windows voices, and microphone dictation. This build fixes the Vosk installation error by removing Vosk entirely.

## Run

1. Download the `voice-lab-v0.4` branch ZIP and extract it.
2. Open the `voice-lab-v0.3` application subfolder (retained from the previous branch for compatibility) and run `start.bat`.
3. Node.js (LTS) is required. `start.bat` installs Electron automatically if needed.
4. Select **Windows · all discoverable voices**, **Edge Neural**, **Windows Modern** or **Windows Classic**.
5. Windows Classic works without Python; for Edge Neural and Windows Modern, install Python 3.11+ in an architecture-compatible environment and click **Install support**. If Python or WinRT is unavailable, the Windows combined list still displays Classic voices.

## Narrator natural voices

Windows Narrator's voice dropdown is **not** an API for third-party applications. This build combines actual voice lists from **System.Speech (SAPI)** and **Windows.Media.SpeechSynthesis (WinRT)** into one Windows selection list.

It also attempts to detect installed Narrator natural voice packages. Narrator-only packages are shown **as informational entries** and are marked **NOT playable**. They cannot be selected for speaking unless Windows exposes them through a working public speech interface. A missing Narrator-only entry does not mean it is not installed; package discovery can differ between Windows versions.

For a natural Ryan voice, the separate **Edge Neural** engine offers **en-GB-RyanNeural** when Microsoft's online service provides it. This is not the same thing as synthesising with the downloaded Narrator package offline.

Do not copy/edit Narrator registry keys, decrypt voice packages or install legacy natural voice adapters expecting current protected voices to work. Some such adapters are incompatible with recent voice package updates.

## Microphone: no Vosk or pip required

Voice Lab now uses Windows' own **voice typing (Win + H)**. Microsoft voice typing requires Internet connectivity.

1. Click the microphone button in Voice Lab; it focuses the editable transcript text box.
2. Press **Windows + H** and speak. Your words appear in the text field.
3. Stop dictation in the **Windows** voice typing toolbar.
4. Click the Voice Lab microphone button again to finish and optionally read the transcribed text aloud.
5. The checkbox controls whether C.O.D.Y. speaks back the transcript.

Voice Lab does **not** start, stop or impersonate the Windows voice-typing service itself. It lets you dictate directly into its text field. This tests the input/output workflow but isn't a connected ChatGPT assistant yet.

## Engine notes

- **Edge Neural**: Uses the unofficial `edge-tts` library; requires Internet and can change unexpectedly.
- **Windows Modern**: Requires PyWinRT components for the WinRT speech API.
- **Windows Classic**: Built-in SAPI voices without Python.
- **Windows catalogue**: Combines those two APIs and reports Narrator-only package entries if detected.
- `Win + H` dictation is a Microsoft service and may process speech online.

## Troubleshooting

**Narrator Ryan or Andrew are missing or unavailable:** Windows does not expose these voice packages to the standard public synthesis APIs. They may be listed as unavailable; use Edge Neural for a comparable online voice.

**No matching distribution found for vosk:** Vosk has a Windows x64 wheel but no native Windows ARM64 wheel. v0.4 avoids the unsupported Python installer entirely.

**Modern voices missing:** Install Windows Modern support, refresh, then inspect errors. If unavailable, use Windows Classic or Edge Neural.

**Microsoft Edge voices won't load:** Check Internet access, install Edge support, and retry. The unofficial service is subject to change.

## Scope

This is only a voice input/output test app; no login, Codex or ChatGPT connection is included. No proprietary HeyClicky assets or code are used.
