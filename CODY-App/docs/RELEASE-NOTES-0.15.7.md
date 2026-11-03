# C.O.D.Y. 0.15.7

## 3D window and zoom fixes

- Keep 3D models inside the visible window content area, including at high zoom.
- Align the close button and its click target with the top-right of the visible title bar.
- Keep the model boundary and close button aligned when moving the window.
- Increase scroll zoom to 10× the original camera magnification.
- Remove the model as well as its background when closing a moved window.

## Install or update

Choose **C.O.D.Y-Setup-0.15.7-x64.exe** for Intel/AMD Windows PCs or **C.O.D.Y-Setup-0.15.7-arm64.exe** for ARM/Snapdragon Windows PCs. Existing installations can use **Settings → Updates** to download and restart. Conversations and settings are preserved. Both installers remain unsigned.

## Validation

Native checks cover window clipping, close-button alignment, 10× zoom, movement and closing. Both Windows installer payloads are audited, and release checks verify update-manifest sizes and checksums.
