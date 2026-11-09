# Changelog

## 0.15.13 — 9 November 2026

- Add **Allow agent usage** under **Settings → Agents**. Turning it off stops active agent work and blocks new tasks, routines and screen takeovers.
- Add a persistent **Desktop FPS** reading when a measured application rate is unavailable. The FPS widget labels its measurement source.
- Add local typed and spoken Discord mute, deafen and screen-sharing commands for the Windows desktop client.
- Add **Settings → Memory** for encrypted local notes. **Local memory only** pauses Claude through HeyClicky to keep its account memory out of C.O.D.Y. sessions.
- Update the Word capability guide through 0.15.13.

## 0.15.12 — 9 November 2026

- Add a 50%–200% cursor size slider under **Settings → Cursor**.
- Add a playback device selector under **Settings → Microphone** for C.O.D.Y.'s voice and voice cues.
- Use Original Blue as the default accent on first launch and preserve saved accent choices.
- Add JSON export and import for portable preferences under **Settings → General → Settings Backup**.
- Label the signed-out Plugins prompt and button **Sign in to Claude Code**.
- Remove hover tooltips from compact island status displays and game and recording controls. Show recording errors in the interface.

## 0.15.11 — 6 November 2026

- Press **Ctrl+Alt+H** to hide the island or bring it back in compact mode.

## 0.15.10 — 5 November 2026

- Block physical keyboard and mouse input in both computer-use modes. Press Esc to stop and restore input. Trackpad and touchscreen events translated into mouse input are also blocked. Native touch and precision-trackpad gestures may still work where Windows does not grant UIAccess.

## 0.15.9 — 4 November 2026

- Keep live spoken replies visible as they grow, preserve the reader's position in chat history, and reconcile the final reply if a streaming update was missed.
- Add a configurable AltGr quick-message shortcut, defaulting to “done”, with a saved enable switch and phrase in Shortcuts settings. Preserve drafts and prevent duplicate sends.
- Replace every embedded engine icon group and its image resources with CODY branding so Task Manager no longer selects the original HeyClick icon. Use the CODY icon in future native builds.

## 0.15.8 — 3 November 2026

- Keep expanded chat large during the current open session, then restore its normal size and pointer bounds when the panel minimises. The next opening starts at normal size; conversation and draft content stay intact.

- Prevent the legacy native task dock from appearing on top-edge hover in C.O.D.Y. engine mode. Keep its pointer listener stopped, block native reopen attempts and disable old notch hover/text routing. Background tasks remain available through C.O.D.Y.'s Tasks page.

- Show updater status in the island: checking, a new version, download percentage and progress, ready to restart, installation, errors and a brief up-to-date confirmation. Tap or press Enter on the status to open Settings → Updates. Listening, recording, games and finished timer alerts retain priority; normal monitors return after transient notices expire. Downloads and restarts still require the existing buttons.

- Include all 0.15.7 3D window, close-button and 10× zoom fixes.

## 0.15.7 — 3 November 2026

- Keep 3D models and pointer input within the visible window content area.
- Align close controls with the rendered title bar and preserve alignment after moving.
- Increase scroll zoom to 10× and remove models when their window closes.

## 0.15.6 — 3 November 2026

- Add persistent clock and weather pins with “show clock”, “show weather” and named-city weather commands. Save selections across restarts, refresh the local 24-hour clock live and weather every five minutes, and support individual hide commands.

- Show the on-screen drawing Clear button only when rendered drawing content or a 3D model exists. Hide stale controls when a response has an empty canvas, including during narration.

- Add Ctrl + Alt + M to toggle C.O.D.Y.-only microphone mute, with saved state and an equivalent Shortcuts setting.
- Show a persistent coral crossed-out microphone while muted and a brief blue microphone animation on unmute, with reduced-motion support and isolated studio previews.
- Stop active C.O.D.Y. voice capture and block push-to-talk, wake detection, voice games, microphone tests and dictation while muted. Keep typed commands and other apps' microphone access available.

- Add permission-checked Bluetooth and Wi-Fi on/off commands, radio status, Windows power modes, display brightness and approved Settings-page shortcuts for typed and spoken requests.
- Keep Windows Energy saver separate from power mode: saver requests open its Settings page and report that the toggle still needs changing there.
- Add a Windows settings custom-permission switch and verify state before acknowledging successful changes.
- Recenter and resize expanded chat content, align conversation and composer widths, and stack suggestions on narrow displays.
- Capture Windows pointer presses for touchscreen outside-tap dismissal and first-tap opening of awake or sleeping islands.
- Update the Word capability guide with source changes, validation results and current limitations.

## 0.15.5 — 2 November 2026

- Hold Ctrl and left-drag to move 3D models, including transparent models and models with backgrounds. Normal dragging still rotates; scroll still zooms.
- Keep moved models reachable at the screen edges and retain their placement after release and zoom.
- Keep chat above 3D models without repeated window-order changes that cause flicker.
- Verify native model movement, zoom, close/clear behaviour and stable chat/model stacking, including computer-control overlays.

## 0.15.4 — 2 November 2026

- Render structured answers and Markdown as readable chat content, including saved and streamed replies.
- Clear sent attachments from the composer while retaining file names on the sent message; rejected sends keep files ready for retry.
- Add a top-right button to toggle between compact and expanded chat without losing the conversation or draft.
- Show Clear and model-window close controls during 3D generation.
- Keep 3D models visible when clicking elsewhere, switching apps or scrolling; explicit X and Clear controls still remove them.
- Capture screenshots through a decoded frame and sRGB canvas before saving and copying, avoiding direct thumbnail exports with incorrect colours.
- Verify 283 JavaScript tests, native builds, chat and attachment UI checks, screenshot colour samples and native 3D controls/persistence checks.

## 0.15.3 — 2 November 2026

- Rename the Agents allowance card to Claude Code Usage and add Claude Code sign-in and sign-out controls.
- Show Codex usage in matching cards, with actual usage percentages, allowance windows and reset times from the signed-in ChatGPT account.
- Use the bundled Codex runtime for account reads without requiring a separate CLI installation.
- Open the sleeping island on its first left click, including immediately after hover wakes the mascot.
- Verify 270 JavaScript tests, account UI states and the native engine build.

## 0.15.2 — 1 November 2026

- Separate Windows x64 and ARM64 setup executables replace the combined installer.
- Shared update metadata lists both installers; the updater selects the matching architecture.
- Existing native build prerequisites remain pinned to the verified 0.15.1 archive.

## 0.15.1 — 1 November 2026

### Added
- GitHub Releases updates in Settings, with automatic checks and explicit download and restart controls.
- Release manifest verification and draft-release upload tooling.
- Versioned native build inputs, checksum-verified restoration and source publication.

### Fixed
- Screen recordings showing an incorrect, extremely large duration in Windows.
- Hey Clicky branding in the account usage card, now displayed as C.O.D.Y Pro.
- The settings version label now reads the application version.

### Verified
- 258 JavaScript tests pass.
- Update UI check, download and restart states pass.
- Windows x64 and ARM64 package integrity audits pass.

A full installation update between two published versions remains to be tested after a second release exists.
