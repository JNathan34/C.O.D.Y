<p align="center">
  <img src="CODY-App/frontend/original-cody/assets/brand/cody-256.png" width="112" alt="C.O.D.Y mascot">
</p>

<h1 align="center">C.O.D.Y.</h1>
<p align="center">A Windows desktop assistant for voice, conversation and getting things done.</p>
<p align="center">
  <a href="https://github.com/JNathan34/C.O.D.Y/releases/latest">Download for Windows</a> ·
  <a href="docs/GETTING-STARTED.md">Getting started</a> ·
  <a href="CODY-App/docs/GITHUB-UPDATES.md">Updates and releases</a> ·
  <a href="https://github.com/JNathan34/C.O.D.Y/issues">Report an issue</a>
</p>

C.O.D.Y. brings chat, voice controls and background tasks into an animated desktop island. It combines an Electron interface with a bundled Windows engine for computer controls, screen capture, browser connections and visual tools.

**Current release: 0.15.2 · Windows x64 and ARM64 · Early development**

## Install

1. Open the [latest release](https://github.com/JNathan34/C.O.D.Y/releases/latest).
2. Choose **C.O.D.Y-Setup-0.15.2-x64.exe** for Intel/AMD PCs or **C.O.D.Y-Setup-0.15.2-arm64.exe** for ARM/Snapdragon PCs. Each installer contains one application architecture.
3. Open C.O.D.Y., connect your preferred AI service and review the app permissions.

The installer is currently unsigned. Windows may show its publisher as unknown. AI providers require their own accounts; provider subscriptions and paid usage are not included.

Once this version is installed, **Settings → Updates** can check GitHub, download a newer release and restart to install it. Automatic checks run at startup and every six hours. You choose when to download and restart. Your conversations and settings stay in their existing profile.

## What you can do

- **Talk or type.** Use voice input, spoken responses and the desktop island, with local wake-word support.
- **Choose an assistant.** Connect Claude, ChatGPT Codex or ChatGPT. Some background tasks and attached-file requests still use the native Claude connection.
- **Work in the background.** Start tasks, inspect their progress and open their outputs.
- **Control Windows.** Use permission-controlled app, audio, window, clipboard, file and computer actions. Press **Esc** to stop computer control.
- **Capture your screen.** Take screenshots or record MP4 video, with pause and resume controls.
- **Connect a browser.** Set up the browser extension through the app. Browser actions require that connection.
- **Use visual tools.** Draw desktop annotations and work with interactive 3D scenes.
- **Keep everyday tools close.** Timers, media controls, weather and system monitors are available in the island.

Features depend on Windows permissions, account access and connected services. The [getting-started guide](docs/GETTING-STARTED.md) covers setup and current limits.

## Word guide

[Download the illustrated Word guide](https://github.com/JNathan34/C.O.D.Y/releases/download/v0.15.2/CODY-Complete-Capability-Guide.docx) · [Repository copy](docs/CODY-Complete-Capability-Guide.docx)

The handbook covers capabilities, voice commands, settings and setup, with screenshots and examples. It was prepared on 31 October 2026 for version 0.15.0. Follow the current release notes for the newer GitHub updater and separate Windows installers.

## What changed in 0.15.2

- Separate x64 and ARM64 installers, so each download contains only the version needed for your PC.
- GitHub updates select the installer matching the running app’s architecture.
- Correct duration metadata for newly saved screen recordings.
- C.O.D.Y Pro branding in the account usage card.
- Current source, tests, build tools and versioned native build inputs published together.

See [release notes](CODY-App/docs/RELEASE-NOTES-0.15.2.md) and the [changelog](CHANGELOG.md).

## Develop

Requirements: Windows, Git, Node.js 24, Python 3.11 or later, and the .NET 10 SDK. The native projects target Windows and .NET 9 with C# 14.

```powershell
git -c core.longpaths=true clone https://github.com/JNathan34/C.O.D.Y.git
cd C.O.D.Y\CODY-App
npm ci --ignore-scripts
node node_modules/electron/install.js
powershell -NoProfile -File tools/restore-build-inputs.ps1
.\Build-Engine.bat
.\Start-Development.bat
```

The restore command downloads the versioned native runtime and installer prerequisites from the pinned release and verifies their SHA-256 checksum before extraction. Large runtime files are release assets rather than Git history. The native build also downloads pinned wake-word dependencies and verifies their checksums.

Run the frontend checks with:

```powershell
cd frontend/original-cody
npm test
```

Return to `CODY-App` and run `Build-CODY-Standalone.bat` to build the native engine and package both Windows architectures. Close the development app before rebuilding its engine.

| Location | Contents |
| --- | --- |
| `CODY-App/frontend/original-cody/` | Current Electron app, interface, assets and tests |
| `CODY-App/work/Cody.*` | Native Windows project sources |
| `CODY-App/tools/` | Build, release and verification tools |
| `CODY-App/build/installer/standalone.nsh` | Windows installer integration |
| `docs/` | Setup, architecture and development guides |

[Developer details](CODY-App/README.md) · [Release workflow](CODY-App/docs/GITHUB-UPDATES.md) · [Security](SECURITY.md)

## Project status and credits

C.O.D.Y. is an independent project, not an official OpenAI, Anthropic or HeyClicky product. Its Windows engine includes recovered HeyClicky-derived components alongside C.O.D.Y. integrations. Third-party components, assets, models and services retain their respective rights and terms.

No blanket licence is granted by this repository's public visibility. Package-specific licence fields apply only within their stated scope; they do not relicense third-party or recovered components. Keep applicable notices when working with the source or packaged dependencies.
