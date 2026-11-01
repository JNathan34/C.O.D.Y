# Getting started

## Install and connect

Download the setup executable from [GitHub Releases](https://github.com/JNathan34/C.O.D.Y/releases/latest). Use the executable for a normal installation; the build-input archive is for developers.

Open the app from Start or its desktop shortcut. Open Settings → Agents to choose and connect an assistant. Claude uses the native account connection. ChatGPT Codex uses a ChatGPT account sign-in. The ChatGPT option uses a separate browser session. Background tasks and attached-file requests currently use the native Claude connection.

Provider accounts, subscriptions and usage allowances are separate from C.O.D.Y. A successful app installation does not create those accounts.

## Voice and computer controls

Check Windows microphone permission before using voice input. Configure the microphone and voice shortcut in Settings. Wake-word support depends on the bundled detector and the engine being available.

Review Settings → Permissions before using computer actions. Choose the level of access you want, then enable individual capabilities as needed. Press Esc to stop a computer takeover. The app can also run local utility commands such as screenshots and timers.

## Browser connection

Use the browser setup card in the app to connect its extension. Browser actions require a working extension/native-host connection. If a browser is not connected, reconnect it in the app before retrying.

## Screen capture

Ask for a screenshot or start a screen recording. Pause, resume and stop controls appear in the island. Recordings are saved as MP4 files. The 0.15.1 duration fix applies to new recordings; older recordings with incorrect metadata are not automatically rewritten.

## Updates

Settings → Updates shows the installed version and checks the public GitHub release feed. Automatic checking is enabled by default. Downloads and installation wait for your button clicks. Finish active tasks, voice sessions and screen recordings before restarting to install.

Older installations without the updater need one manual installation of 0.15.1 or later. The development copy does not install application updates. Existing conversations and settings remain under the CODY-Integrated Windows profile.

## Current limits

- Windows desktop is the supported platform. Choose the x64 installer for Intel/AMD or the ARM64 installer for ARM/Snapdragon; some native components run as x64 on ARM Windows.
- The installer is unsigned. Windows can display an unknown publisher.
- AI, browser and network features need their respective accounts or connections.
- Computer actions and sensor data depend on Windows access and available providers.
- End-to-end updates need two published versions; the first release establishes the baseline.

For a reproducible bug report, include the app version, Windows architecture, steps taken and the observed result. Remove personal data and credentials from screenshots and logs.
