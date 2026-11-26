# C.O.D.Y. 0.15.40

- **Drawings stay with their app.** Complete drawings, paper cards, diagrams, and their controls hide when you switch to another app and return with their original window. Scrolling does not move drawings. Say “Keep this drawing visible across apps” for an exception, or “Only show this drawing on its original app” to bind it again.
- **Editable sticky notes.** Say “Give me a blank sticky note.” Type directly into it, drag its top bar, and resize it. Sticky notes stay visible across apps and automatically save their text and position. Close a note with its × button to delete it. Notes respect your monitor access settings. Assistant requests for sticky notes also default to visibility across apps.
- **Answers and artwork in Word.** After an answer, say “Put it in the Word doc” to insert the previous answer and its drawings. You can also ask for text only or drawings only. Artwork is inserted as images, with transparent margins trimmed. Document checks and undo support remain in place.
- **Corsair iCUE lighting.** When iCUE is running, RGB Lighting uses its SDK integration. Compatible devices are included automatically, and switching the plugin on scans for devices again. The “React to Cody’s activity” option lives inside RGB Control.
- **Smoother Island rendering.** Improved rendering while another app is in fullscreen, reduced idle animation work, and hardware acceleration on Windows x64. Windows ARM64 retains its graphics compatibility fallback.
- **Quieter task updates.** Ordinary completed replies no longer show a “Reply ready” notification in the Island. Background task results, approvals, and errors still appear when needed.
- **Smaller installation.** Removed the optional ChatGPT and Codex clients, their settings, and the bundled Codex runtime. Existing conversation history is preserved, and Cody continues using its integrated assistant engine.

## Install or update

Open **Settings → Updates**, or download the x64 installer for Intel and AMD PCs or the ARM64 installer for ARM and Snapdragon PCs. Conversations and preferences stay in your existing profile.

For iCUE lighting, allow C.O.D.Y. in **iCUE Settings → SDK → iCUE SDK**. Cody retrieves and verifies the Corsair SDK library on first use. Device support depends on what iCUE exposes.

## Bundled lighting source

The installers also include the upstream OpenRGB 1.1 portable helper for supported devices when iCUE is closed. [OpenRGB 1.1 source archive](https://gitlab.com/CalcProgrammer1/OpenRGB/-/archive/8e16de27858cf2be6af54a33ce003df74cb9fd3e/OpenRGB-8e16de27858cf2be6af54a33ce003df74cb9fd3e.tar.gz) · [Third-party notices and library sources](https://github.com/JNathan34/C.O.D.Y/blob/v0.15.40/CODY-App/docs/OPENRGB.md)
