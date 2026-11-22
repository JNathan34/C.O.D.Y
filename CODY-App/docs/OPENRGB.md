# OpenRGB in C.O.D.Y.

C.O.D.Y. ships the unmodified OpenRGB 1.1 Windows x64 portable build as a separate program. It communicates with that program over the OpenRGB SDK on localhost. The installer includes OpenRGB and its runtime libraries. C.O.D.Y. starts it on demand with a separate configuration folder and without elevation.

- [OpenRGB 1.1 portable binary and release information](https://codeberg.org/OpenRGB/OpenRGB/releases/tag/release_1.1)
- [Corresponding OpenRGB source archive](https://gitlab.com/CalcProgrammer1/OpenRGB/-/archive/8e16de27858cf2be6af54a33ce003df74cb9fd3e/OpenRGB-8e16de27858cf2be6af54a33ce003df74cb9fd3e.tar.gz)
- [OpenRGB license](https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/release_1.1/LICENSE)
- [Qt 6.8.3 module sources](https://download.qt.io/archive/qt/6.8/6.8.3/submodules/) and [Qt licensing notices](https://doc.qt.io/qt-6.8/licensing.html)
- [libusb 1.0.27 source and license](https://github.com/libusb/libusb/tree/v1.0.27)
- [hidapi-hotplug source and license](https://gitlab.com/OpenRGBDevelopers/hidapi-hotplug)

Qt ships as separate shared libraries in the `resources/openrgb` directory. That directory also contains copies of the GNU GPL and LGPL license texts.

The built-in controller uses hardware that OpenRGB can manage with the current user’s device access. Select the devices in C.O.D.Y. before applying a color to multiple devices. The Windows ARM64 build uses Windows x64 emulation for the OpenRGB helper.
