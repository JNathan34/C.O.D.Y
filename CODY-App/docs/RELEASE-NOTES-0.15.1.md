# C.O.D.Y. 0.15.1

C.O.D.Y. is a Windows desktop assistant with voice controls, an animated island,
background tasks and tools for working with your computer.

## In this release

- GitHub updates in **Settings → Updates**. Check automatically at startup and
  every six hours, download when ready, then choose **Restart to install**.
- Correct MP4 duration metadata for new screen recordings. Short clips now show
  their recorded length in Windows instead of an incorrect, very large duration.
- Consistent **C.O.D.Y Pro** branding in the account usage card.
- The current Electron interface, native engine and Windows prerequisites in one
  installer for x64 and ARM64 PCs.

## Install

Download **C.O.D.Y-Setup-0.15.1.exe** below and run it on Windows. Setup chooses
the right application architecture for your PC. The installer is currently
unsigned, so Windows may show its publisher as unknown.

Install this release once to enable the new updater. Later versions can be
installed from **Settings → Updates**. Your existing conversations and settings
stay in their current profile. C.O.D.Y. waits for active tasks, voice sessions
and screen recordings to finish before an update can restart it.

AI services require their own account connections. The app does not include paid
AI usage or provider subscriptions. Browser control also needs the browser
extension connection described in the app.

## For developers

The repository contains the current frontend, native project sources, tests and
build tools. **C.O.D.Y-Build-Inputs-0.15.1.zip** provides the versioned native
runtime and installer prerequisites needed by the build. Most users only need
the setup executable.

**latest.yml** is used by the updater. **SHA256SUMS.txt** contains checksums for
the downloadable files.

Validation: 258 JavaScript tests passed; update UI checks passed; both Windows
packages passed the bundled-engine integrity audit. A full update between two
published versions remains to be tested after a second version is available.
