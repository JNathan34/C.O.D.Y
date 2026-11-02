# C.O.D.Y. 0.15.4

This update includes the recent chat, attachment, 3D and screenshot fixes:

- **Readable chat:** structured answers no longer expose their internal tags and JSON. Markdown headings, bold text, lists, quotes, code and tables are formatted in new, streamed and saved replies.
- **Attachments:** sending clears the files from the input area. Their names remain on the sent message. Files added later stay ready for the next message, and rejected sends preserve staged files.
- **Expanded chat:** use the new button at the top right to open a larger view, then click again to return to compact size. The conversation and draft stay in place.
- **3D controls:** Clear and the model-window X are available during generation. Clicking elsewhere, switching apps and scrolling keep 3D models visible; X and Clear still remove them.
- **Screenshot colours:** screenshots now use decoded screen frames converted to sRGB before saving and clipboard copying, rather than exporting capture thumbnails directly.

Choose **C.O.D.Y-Setup-0.15.4-x64.exe** for Intel/AMD Windows PCs or **C.O.D.Y-Setup-0.15.4-arm64.exe** for ARM/Snapdragon Windows PCs. Some native tools run as x64 on ARM Windows. Both installers are currently unsigned.

Existing updater-enabled installations can use **Settings → Updates**. Installations older than 0.15.1 need a manual setup once to obtain the updater. Conversations and settings are preserved.

Validation: 283 JavaScript tests, source checks, native engine builds, chat formatting/expansion and drag-and-drop UI checks, exact screenshot colour-chart round trips, a real desktop capture, and native tests for generation controls and persistence through repeated screen-change events. Appearance with every HDR/display configuration has not been verified.

The Word guide remains available in the repository and the 0.15.2 release; it describes version 0.15.0. Native build prerequisites remain pinned to the verified 0.15.1 archive.
