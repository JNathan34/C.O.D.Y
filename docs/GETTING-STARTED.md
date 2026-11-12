# Getting started

## Install and connect

Download the setup executable from [GitHub Releases](https://github.com/JNathan34/C.O.D.Y/releases/latest). Use the executable for a normal installation; the build-input archive is for developers.

Open the app from Start or its desktop shortcut. Open Settings → Agents to choose and connect an assistant. Claude uses the native account connection. ChatGPT Codex uses a ChatGPT account sign-in. The ChatGPT option uses a separate browser session. Background tasks use the native Claude connection.

Paste a picture into the chat composer, drop a file, or use the attachment button. Add a question or send the file by itself. Claude and ChatGPT Codex read text from Word documents, PowerPoint slides, PDFs with selectable text, spreadsheets and plain-text files. ChatGPT uploads the original files through its browser session.

Provider accounts, subscriptions and usage allowances are separate from C.O.D.Y. A successful app installation does not create those accounts.

## Voice and computer controls

Check Windows microphone permission before using voice input. Configure the microphone and voice shortcut in Settings. Wake-word support depends on the bundled detector and the engine being available.

Review Settings → Permissions before using computer actions. Choose the level of access you want, then enable individual capabilities as needed. Press Esc to stop a computer takeover. The app can also run local utility commands such as screenshots and timers.

### Mute C.O.D.Y. voice input

Press **Ctrl + Alt + M** to mute or unmute C.O.D.Y. The same switch is under **Settings → Shortcuts → Microphone muted**. Muting stops active C.O.D.Y. voice capture and blocks push-to-talk, wake phrases, voice games, microphone tests and C.O.D.Y. dictation. It does not mute the Windows microphone for other apps. Typed requests remain available, and the mute preference is saved across restarts.

While muted, the mascot shows a coral microphone with a line drawn across it. Unmuting briefly shows a blue microphone with sound waves for about 1.25 seconds before the normal mascot returns. Reduced-motion settings use a static indicator. The developer animation studio includes isolated previews of both states.

The shortcut works outside C.O.D.Y. when Windows can register it. If another application has reserved the shortcut, the focused C.O.D.Y. window provides a fallback; the Settings switch is also available. This feature is included in 0.15.6 with its updated native engine.

### Windows settings commands in the current source

In Custom permissions, enable **Windows settings** for radio, power-mode and brightness changes. Full access includes this permission. Status checks use **System information**, and opening a Settings page uses **Open applications**. The Ask profile requests approval before acting.

- “Turn on Bluetooth” or “turn Bluetooth off.”
- “Turn on Wi-Fi” or “turn Wi-Fi off.”
- “Check Bluetooth status” or “check Wi-Fi status.” “Show Wi-Fi” continues to show the island monitor.
- “Turn on power saver” selects **Best power efficiency** for the current power source. “Turn off power saver” selects **Balanced**; it does not restore a previous custom mode. You can also say “set power mode to best performance” or “show power mode.”
- “Set brightness to 50 percent” or “check brightness.” Brightness needs a display that exposes Windows brightness controls; external monitors may require their own controls.
- “Open Bluetooth settings,” “open Wi-Fi settings,” “open display settings” or “open energy saver settings.” Power, sound, notifications, storage, keyboard, mouse, network and Windows Update settings are also supported.

Windows Energy saver/Battery saver is separate from the performance power mode. Requests to turn Energy saver/Battery saver on or off open its Settings page and clearly state that the toggle still needs to be changed there. Radio access can be denied by Windows, hardware switches or device policy. Turning off a radio can disconnect devices or networking; C.O.D.Y. reports success only after Windows confirms the requested state.

These commands are included in 0.15.6.

## On-screen drawing controls

The drawing **Clear** button appears when there is rendered drawing content or a 3D model to remove. Starting a narration or allocating an empty drawing canvas does not show it. Cleared, faded and newly empty canvases hide the old button. Clear and model close controls remain available while actual drawings are being generated. This fix is included in 0.15.6.

## Keep clock and weather in the island

Say or type **“show clock”** to pin a live 24-hour local clock and date. **“Show weather”** pins current weather; use **“show weather in Derby”** for a named city or **“show weather here”** to use your approximate location. An existing named-city choice is retained when you just say “show weather”.

Pins stay selected until you remove them and return when C.O.D.Y. restarts. They do not expire like quick answers. Multiple pins, including RAM, clock and weather, rotate in the existing island display. Recording, voice interaction and temporary results can briefly take priority.

Weather refreshes every five minutes while pinned and retries failed lookups after one minute. It needs an internet connection; failed lookups show **Weather unavailable** rather than an old temperature as if it were current.

Use **“hide clock”**, **“hide weather”**, **“hide clock and weather”** or **“clear the island”** to remove pins. Ordinary questions such as “what’s the time?” and “what’s the weather?” still show temporary answers. These additions are included in 0.15.6.

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

## Island update status in the next version

This is an **unreleased local change**, not part of the 0.15.6 installer. The island shows update checks, new versions, download percentage and progress, ready-to-install status and installation. Tap the status, or focus it and press Enter or Space, to open **Settings → Updates**. Download and restart still use the existing buttons.

An up-to-date confirmation lasts eight seconds; errors last thirty seconds and remain in Updates for details and retry. Available and ready notices stay until the state changes. Listening, recording, games, quick responses and finished timer alerts keep priority. Ordinary monitors return when the notice clears.

![Example download progress in the island](screenshots/update-status.png)

## Legacy task panel fix in the next version

An unreleased fix keeps the old native task dock and its top-edge hover listener disabled while C.O.D.Y. owns the interface. Use C.O.D.Y.'s **Tasks** button to view background work. Task execution and saved tasks are preserved. This fix needs the rebuilt native engine and is not included in the published 0.15.6 installer.

## Expanded chat size in the next version

In the next version, pressing Expand keeps chat large for the current open session, including while replies arrive or after returning from Settings. Minimising the panel resets its size, so the next opening uses normal chat size. The conversation and draft message are preserved. This is an unreleased local change, separate from the published 0.15.6 installers.
