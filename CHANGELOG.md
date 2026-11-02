# Changelog

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
