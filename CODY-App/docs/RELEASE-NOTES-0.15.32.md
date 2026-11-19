# C.O.D.Y. 0.15.32

- **Move 3D models with Ctrl-drag.** Model input now follows the canvas that owns each model. Dragging works across the model window, including transparent areas and backgrounds, for retained models and models generated in later responses. Placement continues to work after clearing and generating a replacement. Ordinary rotation and wheel zoom retain their existing controls.
- **Clear the whole drawing with Ctrl+Alt+X.** The global shortcut clears native 3D models, backgrounds, retained drawings, Electron scenes and annotations together. It invalidates pending Electron visual operations instead of only issuing a 2D clear.
- **Improve drawing placement and tracking.** Anchor acquisition uses the full intended outline instead of the small arc visible during pen reveal. Browser/Electron accessibility lookup, element identity, child enumeration, DPI conversion and owner-local hit testing have been repaired. Scroll updates preserve in-flight geometry reads, and changed documents cannot reuse stale drawing coordinates. [#37](https://github.com/JNathan34/C.O.D.Y/issues/37), [#53](https://github.com/JNathan34/C.O.D.Y/issues/53)

## Validation and remaining checks

Local validation passed: the complete JavaScript regression suite, syntax checks for 270 JavaScript files, native target-provider and drawing-control/geometry harnesses, and the native engine build. Native integration fixtures covered transparent and background models, dragging from every quadrant, independent retained/new model canvases, clear during dragging, whole-scene clear, replacement models, wheel zoom, clipping and close controls. Ctrl-drag routing was exercised through the native test harness; physical Left Ctrl input was not separately automated.

An owned Electron page was exercised with the real native drawing engine at 200% display scale: 102 continuous-scroll samples had no missing ink or Clear-button frames. Selective click dismissal, content/app changes, minimize/restore, out-of-view targets, resizing and drawing replacement passed in that fixture. These results do not establish pixel-perfect following in every application. Installed Firefox, Word/PDF and multi-monitor acceptance remain open, so #37 and #53 are not closed by this release.

The release workflow builds x64 and ARM64 installers and verifies their updater metadata, blockmaps and checksums before publication.

## Install or update

Use **Settings → Updates**, or download the x64 installer for Intel/AMD PCs or ARM64 for ARM/Snapdragon PCs.
