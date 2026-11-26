# OpenRGB in C.O.D.Y.

C.O.D.Y. ships the unmodified OpenRGB 1.1 Windows x64 portable build as a separate program. It communicates with that program over the OpenRGB SDK on localhost. The installer includes OpenRGB and its runtime libraries. C.O.D.Y. starts it on demand with a separate configuration folder and without elevation.

- [OpenRGB 1.1 portable binary and release information](https://codeberg.org/OpenRGB/OpenRGB/releases/tag/release_1.1)
- [Corresponding OpenRGB source archive](https://gitlab.com/CalcProgrammer1/OpenRGB/-/archive/8e16de27858cf2be6af54a33ce003df74cb9fd3e/OpenRGB-8e16de27858cf2be6af54a33ce003df74cb9fd3e.tar.gz)
- [OpenRGB license](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/release_1.1/LICENSE)
- [Qt 6.8.3 module sources](https://download.qt.io/archive/qt/6.8/6.8.3/submodules/) and [Qt licensing notices](https://doc.qt.io/qt-6.8/licensing.html)
- [libusb 1.0.27 source and license](https://github.com/libusb/libusb/tree/v1.0.27)
- [hidapi-hotplug source and license](https://gitlab.com/OpenRGBDevelopers/hidapi-hotplug)

Qt ships as separate shared libraries in the `resources/openrgb` directory. That directory also contains copies of the GNU GPL and LGPL license texts.

When Corsair iCUE is running, RGB Lighting uses Corsair’s shared SDK lighting layer. C.O.D.Y. retrieves the SDK library from Corsair on first use and caches it locally. Allow software integrations in **iCUE Settings → SDK → iCUE SDK**. C.O.D.Y. can use the lights iCUE makes available. [Corsair SDK setup](https://help.corsair.com/hc/en-us/articles/4406125301005-iCUE-How-to-Set-up-software-and-game-integrations-in-iCUE)

When iCUE is closed, RGB Lighting uses the included OpenRGB helper for devices that support Direct mode with the current user’s device access. The Windows ARM64 build uses Windows x64 emulation for the lighting runtimes.

C.O.D.Y. scans every time RGB Lighting is turned on and automatically includes all compatible devices. Open **RGB Control** from the plugin card or say “Open RGB control” to use the color wheel, run another scan, or turn on **React to Cody’s activity**.
