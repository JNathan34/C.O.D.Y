# C.O.D.Y. 0.15.2

Choose the smaller installer that matches your Windows PC:

| Installer | Use on |
| --- | --- |
| **C.O.D.Y-Setup-0.15.2-x64.exe** | Intel and AMD Windows PCs |
| **C.O.D.Y-Setup-0.15.2-arm64.exe** | ARM Windows PCs, including Snapdragon |

Each setup contains one application architecture instead of bundling both into
one download. The app's features and bundled native tools are retained. Some
native components continue to run as x64 on ARM Windows.

Existing updater-enabled installations select the matching installer from the
shared **latest.yml** update feed. Installations older than 0.15.1 need a manual
setup once to obtain the updater. Your conversations and settings are preserved.

Both installers are currently unsigned. **SHA256SUMS.txt** contains checksums.
Developers can restore the unchanged native build prerequisites from the pinned
0.15.1 build-input archive using `tools/restore-build-inputs.ps1`.

Validation: all 262 tests pass, including installer naming and updater file
selection for both architectures.
