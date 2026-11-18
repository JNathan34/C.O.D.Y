# C.O.D.Y. 0.15.27

This release brings together the improvements merged in [PR #44](https://github.com/JNathan34/C.O.D.Y/pull/44), [PR #45](https://github.com/JNathan34/C.O.D.Y/pull/45), and [PR #46](https://github.com/JNathan34/C.O.D.Y/pull/46), since version 0.15.26.

## Dynamic Island, drawing and media

- **Clear button only when appropriate:** drawing controls no longer appear just because C.O.D.Y is typing or using computer control. They show when actual annotations are available to clear. [#43](https://github.com/JNathan34/C.O.D.Y/issues/43)
- **Brightness feedback:** supported Windows brightness changes show a short-lived brightness icon, percentage and level bar in the island. Availability depends on the display and Windows brightness events. [#42](https://github.com/JNathan34/C.O.D.Y/issues/42)
- **Drawing shortcut:** improved the global **Ctrl+Alt+X** clear action and overlay cleanup across displays. [#1](https://github.com/JNathan34/C.O.D.Y/issues/1)
- **More persistent drawing:** new Electron annotations remain until explicitly cleared by default; explicitly temporary annotations retain their own expiry. Drawings associated with hidden/minimised windows are hidden without discarding their saved state. Full native content-anchoring and scroll-flicker verification remain open. [#8](https://github.com/JNathan34/C.O.D.Y/issues/8) · [#37](https://github.com/JNathan34/C.O.D.Y/issues/37)
- **Spotify / Windows media mini-player:** album artwork, playback controls and a setting to turn the mini-player on or off. [#17](https://github.com/JNathan34/C.O.D.Y/issues/17)
- **Cleaner island motion:** reduced-motion refinements and removal of an unwanted music glow. [#9](https://github.com/JNathan34/C.O.D.Y/issues/9)

## Voice, assistant controls and everyday utilities

- **Weather:** hourly and seven-day forecasts, a preferred city, temperature units and clearer lookup failures. [#18](https://github.com/JNathan34/C.O.D.Y/issues/18)
- **Network diagnostics:** inspect Wi-Fi signal, negotiated link speed and current traffic without silently launching a speed test. [#24](https://github.com/JNathan34/C.O.D.Y/issues/24)
- **Assistant modes:** Normal, Focus, Work, Gaming and saved custom presets with Settings controls; Focus and Gaming can restrict some local quick-action tools. Agent-scoped permission settings remain future work. [#26](https://github.com/JNathan34/C.O.D.Y/issues/26)
- **Background tasks:** clearer task-card status, progress and failure messages. [#10](https://github.com/JNathan34/C.O.D.Y/issues/10)

## Computer control, files and productivity

- **Reuse applications:** approved app commands can focus/restore a running window before launching another instance; additional window-layout options remain to be implemented. [#40](https://github.com/JNathan34/C.O.D.Y/issues/40)
- **Safer action verification:** more reliable checks after opening applications and proofreading selected text, reducing false success reports. Rich rewriting and undo flows remain open. [#6](https://github.com/JNathan34/C.O.D.Y/issues/6) · [#7](https://github.com/JNathan34/C.O.D.Y/issues/7)
- **Microsoft Word:** permission-gated editing of the active Word document for headings, bold, italic, page breaks and saving. Image positioning and advanced layouts are not yet included. [#41](https://github.com/JNathan34/C.O.D.Y/issues/41)
- **Save an annotated screenshot:** explicit command saves the visible annotations without clearing their state; native multi-monitor and crop behaviour still needs testing. [#39](https://github.com/JNathan34/C.O.D.Y/issues/39)
- **Context assistance:** optional detection of editable fields with non-invasive suggestions; protected fields are excluded. [#29](https://github.com/JNathan34/C.O.D.Y/issues/29)

## Connections, privacy and reliability

- **Plex:** opt-in connection to your own server with encrypted local credential storage, active viewers and recently added media. Playback controls remain planned. [#15](https://github.com/JNathan34/C.O.D.Y/issues/15)
- **Overseerr:** opt-in server connection, title search and read-only request status. Creating requests is not included yet. [#16](https://github.com/JNathan34/C.O.D.Y/issues/16)
- **Action history:** bounded action log viewer in Settings with more comprehensive redaction of sensitive information. [#11](https://github.com/JNathan34/C.O.D.Y/issues/11) · [#14](https://github.com/JNathan34/C.O.D.Y/issues/14)
- **Plugins and skills:** safer handling of capability @-mention catalog entries, including validation and deduplication. [#27](https://github.com/JNathan34/C.O.D.Y/issues/27)
- **Memory import:** stronger validation of ChatGPT/Codex memory exports; importing does not inherit permissions to share information. [#28](https://github.com/JNathan34/C.O.D.Y/issues/28)

## Install or update

- **Windows x64 (Intel/AMD):** download `C.O.D.Y-Setup-0.15.27-x64.exe`.
- **Windows ARM64 (Snapdragon):** download `C.O.D.Y-Setup-0.15.27-arm64.exe`.
- Existing installations with the C.O.D.Y updater can use **Settings → Updates** after publication. Conversations and settings remain in the existing Windows profile.
- The release also includes update manifest(s), installer blockmaps and SHA-256 checksums for update and integrity verification.

**Testing note:** source-level automated checks run before publication. Full real-world validation of native overlays, Word, media servers and window management on a Windows PC remains necessary. The installers are currently unsigned and Windows may warn about an unknown publisher. The remaining umbrella roadmap issues are not being described as completely finished.
