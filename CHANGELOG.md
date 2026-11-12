# Changelog

## 0.15.22 — 12 November 2026

- Add **Settings → Accessibility** with click-through subtitles for spoken replies and a switch for visual task updates in the Island.
- Show live progress, approval requests and task results in the Island. Select an update to open the relevant chat, task or approval.
- Paste pictures into chat and ask about attached documents, slides, text files and images directly in the conversation.
- Show images inline and give supported files a preview in sent messages and conversation history.
- Add new showcase screenshots and link to GitHub release notes from the README.

## 0.15.21 — 11 November 2026

- Keep the microphone open after **“Hey Cody”** and buffer the start of your request while speech recognition starts.
- Recognize more ways to leave a Discord call. Route clear speech variants through the built-in Discord command and ask about ambiguous transcriptions.
- Respond faster to play, pause, skip and seek commands. Recognize more playback and volume phrases locally and reduce repeated work for local commands.

## 0.15.20 — 10 November 2026

- Say **“Stop screen share”** or **“Discord stop streaming”** to end your Discord stream and stay in the call.
- Open the call you’re connected to before starting or stopping a Discord share, even if Discord is displaying a different channel.
- Collapse the expanded Island when a click lands in the transparent area around it.

## 0.15.19 — 10 November 2026

- Shorten Discord voice replies and animate the Island microphone turning red and drawing a slash when mute is confirmed. Unmuting reverses the animation.
- Say **“Share screen”** to use Screen 1 or name a different screen number. Recognize Discord’s current picker and select the **Entire Screen** tab before looking up the requested display.
- Say **“Leave Discord,” “Disconnect from Discord,”** or **“Hang up on Discord”** to leave the current call or voice channel.

## 0.15.18 — 10 November 2026

- Show progress and results in the Island for typed and spoken Discord mute, deafen and screen-sharing commands.
- Run Discord controls in the background without taking focus. If Discord starts minimized, briefly restore it behind the active window and minimize it again.
- Open Discord’s source picker with **“Discord screenshare”**. Name a screen or app to request that specific source.

## 0.15.17 — 9 November 2026

- Show FPS in the shared status widget used by weather, clock and RAM. FPS uses the normal island width and rotates through the same slot when several monitors are pinned.

## 0.15.16 — 9 November 2026

- Export local memories as readable JSON and restore them from **Settings → Memory → Memory Backup**. Import skips duplicates and credential-like notes and restores eligible notes to private local storage.
- Improve recognition of quieter multi-word wake phrases and preserve buffered speech through microphone handoff. Re-arm the detector after a wake arrives while C.O.D.Y. is busy.

## 0.15.15 — 9 November 2026

- Smooth island concealment through Ctrl+Alt+H, On hover and Activity only. Let the fold finish before hiding the Windows overlay and reverse from the current shape when reopened.
- Fade panel controls before returning to the compact island.
- Move Island visibility to **Settings → Appearance → Island**.
- Keep pinned FPS inside the island, alongside other status cards.

## 0.15.14 — 9 November 2026

- Unfold the compact island from a centered slit at the top edge. The shoulders dip and rebound before the mascot and any active media or status details fade in.
- Replay the reveal and hide sequence from **Test all animations → Unfold / hide**. The reveal follows the selected animation speed and reduced-motion settings.

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
