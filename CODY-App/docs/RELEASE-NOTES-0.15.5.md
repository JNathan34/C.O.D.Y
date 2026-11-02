# C.O.D.Y. 0.15.5

- **Ctrl-drag 3D models:** hold **Ctrl + left-click and drag** to move a model around the screen, including models with transparent backgrounds. Models with backgrounds move together with their window. Normal dragging still rotates the model, and scrolling still zooms.
- **Placement stays:** moving a model preserves its position after releasing the mouse and after zooming. Dragging beyond an edge keeps enough of the model visible to move it back. X and Clear still remove moved models.
- **Stable chat panel:** the chat panel stays above 3D models without the repeated window reordering that caused flicker. Models remain present behind the panel.

Choose **C.O.D.Y-Setup-0.15.5-x64.exe** for Intel/AMD Windows PCs or **C.O.D.Y-Setup-0.15.5-arm64.exe** for ARM/Snapdragon Windows PCs. Some native tools run as x64 on ARM Windows. Both installers are currently unsigned.

Existing updater-enabled installations can use **Settings → Updates**. Installations older than 0.15.1 need a manual setup once to obtain the updater. Conversations and settings are preserved.

Validation: native engine builds and tests covering transparent and background models, Ctrl-drag during generation, normal-drag pass-through, placement retention, zoom after movement, screen-edge limits, X after movement, Clear during a drag, chat reopening, stable stacking without repeated repairs, focus retention and computer-control overlay ordering. The source-check workflow also runs the existing 283 JavaScript tests.

The Word guide remains available in the repository and the 0.15.2 release; it describes version 0.15.0. Native build prerequisites remain pinned to the verified 0.15.1 archive.
