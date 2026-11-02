# Changelog

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
