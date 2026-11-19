# C.O.D.Y. 0.15.34

- **Turn off drawing scroll tracking.** Screen drawings stay at their original screen positions when you scroll. Automatic target capture, accessibility polling and drawing repositioning are disabled.
- **Improve Word drafting replies.** Accept complete editing plans wrapped in speech or JSON Markdown blocks, retry an incomplete reply once, and show service errors directly. Requests to introduce C.O.D.Y. or write something now have an explicit drafting instruction. Invalid replies leave the document unchanged.
- **Update Island notifications.** Task and chat notifications use expressions and coloured rings for working, ready, attention and error states. Settings includes a Hide notification text option, which is also included in settings backups.

## Validation

The JavaScript regression suite, native Word reply/retry checks, drawing-control checks and engine build passed locally. Both Windows installers are checked for bundled engine integrity, updater checksums and blockmap coverage before publication. Live Word drafting with this build has not been verified.

## Install or update

Use **Settings → Updates**, or download the x64 installer for Intel/AMD PCs or ARM64 for ARM/Snapdragon PCs.
