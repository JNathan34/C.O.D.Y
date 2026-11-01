# C.O.D.Y. original interface with the HeyClicky engine

Run `Start-Development.bat` here, or `Start-CODY-Testing.bat` in the parent C.O.D.Y folder. No reinstall or build is needed for normal testing. The launcher opens the original Electron C.O.D.Y. interface and starts the rebuilt HeyClicky working copy as its background engine.

The old native replacement panel is no longer the default GUI. The actual original C.O.D.Y. HTML, CSS, icons, animations, prompt cards, chat composer, media controls and settings layout are reused under `frontend/original-cody`. Provider descriptions and speech wiring were updated for HeyClicky. The original CODY-Integrated project files were not edited.

Click the mascot to open the panel, or use Ctrl+Alt+C. The microphone control and Ctrl+Alt start native HeyClicky capture; release to submit. The speaker icon controls spoken typed replies. New conversation starts a fresh native session. Settings retains the original C.O.D.Y. layout.

## Connection

`CodyEngineBridge.cs` runs inside the rebuilt Windows app. It calls the original native companion session directly, including its microphone capture, recognition, spoken output, drawing and 3D tools. Electron communicates through a named pipe restricted to the current Windows user. No HeyClicky GUI automation, extracted credentials, Windows speech fallback, replacement AI or local bicycle renderer is used for assistant turns.

The native notch, taskbar button, tray and cursor presentation are suppressed in engine mode. Native drawing/model overlays remain visible when requested. The engine retains normal account, subscription and permission enforcement. It uses the existing HeyClicky profile normally; account credentials were not copied into this project. C.O.D.Y. retains its existing appearance preferences and local chat store.

## Verification

- `reports/original-interface-integrity.json`: original styles, animation code, icons, media helpers and standalone settings markup match byte for byte.
- `reports/original-cody-native-engine.json`: a request submitted through the original composer produced a rendered reply and native spoken output. The native 3D engine built the bicycle. `original-cody-native-engine.png` is the C.O.D.Y. rendering from that test.
- `reports/original-cody-microphone.json`: the original mic control started native Listening and cancellation returned it to Idle. This check did not submit a recording; recognition accuracy is not asserted by it.
- `reports/backend-integrity.json`: all six backend assemblies still match the pristine installed payload.
- `reports/build-cody-frontend.log`: rebuilt frontend compiles with zero errors. Recovered/generated source still emits compiler warnings on a full build.
- `reports/installed-snapshot-manifest.json`: the original 741-file installation snapshot matched installed files at copy time.

## Editing and folders

| Folder | Purpose |
| --- | --- |
| `frontend/original-cody` | Actual original C.O.D.Y. Electron GUI, with native IPC adapters |
| `frontend/cody` | Earlier frozen renderer/branding references |
| `work/HeyClicky.App` | Recovered Windows frontend and the direct engine bridge |
| `work/Cody.*` | Other recovered source projects for inspection |
| `pristine/windows-1.1.3` | Unedited installation snapshot |
| `run/current` | Native engine runtime; rebuilt frontend, original backend libraries |
| `reference` | Frozen recovered source, older macOS source, drawing references and archives |
| `tools` | Build/recovery tools and explicit integration checks |
| `reports` | Build, integrity and test evidence |

Edit the original GUI under `frontend/original-cody/src/island/renderer`. Native transport is in `frontend/original-cody/src/native-engine.js`, `native-ipc.js` and `ui/native-voice-ui.js`. The native endpoint is `work/Cody.Engine/Cody/App/Cody/CodyEngineBridge.cs`. Quit C.O.D.Y. before `Build-Engine.bat` when editing C#; JavaScript/HTML/CSS changes need only an app restart.

The launcher reuses the already installed development Electron runtime under the neighboring CODY-Integrated project. This is a local testing setup, not a new packaged installer.

Native speech supports voice selection and speed. Pitch and app-specific speech volume are not exposed by this bridge. Native recognition uses the HeyClicky input device configuration. Older manual Windows-tool and memory controls retain their C.O.D.Y. implementations; they are separate from HeyClicky's own tool permissions. Saved C.O.D.Y. chats remain viewable; selecting a different saved chat currently starts a fresh native session rather than reconstructing its old engine context.

On this ARM64 PC the bundled drawing sound-effects mixer crashed in XAudio2.CreateSourceVoice. Optional drawing/UI effects remain suppressed in the working frontend; native spoken replies and drawing/model rendering continue to work. The original drawing-sounds preference is not overwritten.

The installed HeyClicky binaries remain untouched. `Start-CODY-Legacy-Testing.bat` in the parent folder preserves the previous CODY-Integrated launcher. Licenses accompanying older macOS source do not establish licensing for the newer Windows binaries.

## Restored Island utilities

Clock, date, live weather, calculator, timers, music playback and volume requests again feed the original compact Island cards. Typed exact utility commands use the existing deterministic handlers. Their spoken replies use the native HeyClicky voice. Broader requests and voice requests stay with HeyClicky; after completion the Island mirrors the actual clock/weather/media/volume state without repeating media or volume actions. Music transport buttons continue to control the player shown in the Island.

Examples: “What’s the time?”, “Weather in London”, “What’s playing?”, “Pause my music”, “Set volume to 30 percent”, “Turn the volume down”, “Set a timer for 10 minutes”.

`reports/island-utilities-live.json` records the live card and countdown checks; `reports/island-time-card.png` shows the restored clock card. `reports/island-utilities-tests.log` records 11 passing routing, cancellation, failure and action-deduplication checks. No media player was active during the live check; playback control routing was checked with a test player.

## Faster controls and cached confirmations

Volume actions now use direct Core Audio calls in the native engine instead of launching and compiling PowerShell for each read/write. The existing C.O.D.Y. audio permissions still govern those actions. Utility results unlock the interface immediately; speech plays in the background and can be interrupted. Common spoken utility requests are classified after native speech recognition and cancelled before the AI request, then executed by the same deterministic local utility handlers. Other requests retain normal HeyClicky processing.

Short acknowledgements such as “Volume up”, “Volume down”, “Paused” and “Timer set” use the real selected HeyClicky voice. The first successful playback records only that fixed phrase. Repeats play local PCM from run/voice-cache, keyed by phrase, voice, speed and sample rate. Quiet padding is trimmed. Changing the voice or speed produces a fresh recording. Arbitrary conversation, weather answers and microphone recordings are not cached by this feature.

Final benchmark: volume reads previously took 1,076–1,488 ms each through PowerShell; native reads took 2–22 ms. A warm UI volume action completed in about 148 ms in the measured run. Its cached acknowledgement, including the spoken phrase itself, completed in about 1.3 seconds. These are local measurements, not a guarantee for speech-recognition or AI/network latency. See reports/performance-live.json and reports/performance-tests.log (15 passing tests). Benchmark volume changes were restored afterwards.

## App-open cards and natural weather replies

Successful local app launches show the original “Opened” Island card with a friendly app name. Wrapped requests such as “Could you open the Calculator app for me?” use the same path. For other apps handled by HeyClicky, the card is shown after a matching running app/window is verified; the observer does not launch it again.

Weather replies use a short natural sentence, for example “It’s 10 degrees and cloudy in Derby.” The compact Celsius temperature, place and condition icon are retained. Approximate locations use “near”, and negative/singular temperatures are worded naturally.

`reports/app-weather-live.json` records the Calculator card and live weather wording checks. `reports/app-weather-tests.log` records 21 passing tests, including failed-launch, duplicate-launch, wrapped-app request and weather phrasing cases.

## Rock, paper, scissors in the compact Island

Say or type “Let's play rock paper scissors”. The game lives entirely in the normal compact Island, at the same size as the Spotify controls. The expanded game screen has been removed. Starting a game collapses the chat panel.

The Island displays 3, 2, 1 in time with the selected native HeyClicky voice. The microphone opens before C.O.D.Y. announces and reveals his committed move, so the player can answer at the same time. The compact status then shows listening, result, both hand symbols and the score. Hover the status to reveal three rock/paper/scissors buttons, like Spotify's previous/play/next buttons. Clicking a move after a result plays another button round. Click the result or mascot to start another spoken countdown. Right-click for Play again and End game, or press Escape to end. Ending stops the microphone and restores the normal Island cards.

C.O.D.Y. picks using the operating system's cryptographic random generator before receiving the player's move. Fixed game cues are prepared silently using the original RealtimeMouth.RenderLineAsync and cached by voice/speed. Native game-play queues PCM without changing the Companion listening state; playback events drive the countdown. Responses during the announcement are retained until that cue finishes. Unclear speech retries the same announced move. Normal conversations still use the original HeyClicky AI and push-to-talk flow.

Validation: 39 tests pass, covering game outcomes, committed moves, simultaneous reveal, voice ordering, recognition, cancellation and prior utilities. The live check in `reports/rps-compact-live.json` verifies the normal compact dimensions, hover controls, scoring without expansion, voice capture, next-round click and stopping capture. `reports/island-rps-compact-controls.png` and `reports/island-rps-compact-result.png` show the final interface. `reports/rps-compact-tests.log` records the unit tests. Earlier expanded-panel screenshots and reports document previous iterations. Automated answer recognition tests used simulated transcripts; actual native capture and cue playback were checked live.

Game-start recognition also accepts the user-reported transcript “Leslie Rock scissors.” as the specific mishearing of “Let's play rock paper scissors”. Common “let us”, “let's do” and explicit “play rock scissors” variants route locally too. Unrelated requests about Leslie, rock music or the game rules retain normal AI routing. The voice IPC regression test checks that the reported transcript is claimed before the native AI request, starts hands-free capture and allows a move selection without any submit command. The compact live test now starts with that same reported transcript and verifies playable buttons.

Game-start matching now normalizes inserted articles, conjunctions and speech fillers inside the game name, rather than relying on exact title wording. “Let's play rock the paper scissors” and “Can we play rock and paper and scissors” route to the same local game. The complete request must still fit a game-start intent: explanations, negations, unrelated tasks and compound commands stay with normal AI routing. Voice IPC tests cover both reported transcripts and require local classification before AI submission, a playable round and no submit call. The running-app compact regression uses the latest exact transcript from the user's screenshot; its countdown, controls and move selection passed. See the 39-test log and compact live report.

## Screenshots and screen recording

Say or type “take a screenshot”, “capture my screen”, “start screen recording”, “pause screen recording”, “resume screen recording” or “stop recording”. Requests route locally before HeyClicky's AI, while spoken acknowledgements retain the selected native voice. The primary monitor is captured. Screenshots save full-size PNGs under Pictures/C.O.D.Y and copy to the clipboard. Recordings save video-only WebM files under Videos/C.O.D.Y, at up to 1080p/30 fps with the screen's aspect ratio retained.

The compact Island shows a blinking red dot, elapsed time and always-visible pause/resume and stop controls. Pausing freezes recorded time and changes the dot to amber. Recording status takes priority over other Island cards and stays visible while recording or paused. The chat panel collapses when recording starts. A saved-file card opens the file's folder when clicked. Closing the chat to background keeps the recording indicator visible. Quitting normally finalizes the recording before shutting down.

A hidden local Electron renderer captures and encodes video; one-second chunks are acknowledged after serial writes to disk. Pending encoded data is bounded, recorder IPC accepts only its own renderer, output filenames are generated locally, and a recording is reported saved only after file sync and rename. Encoder, capture and disk errors stop capture; incomplete nonempty files retain a partial.webm suffix. Screenshots and videos are not sent to the AI by these commands. Audio capture is disabled.

Validation: all 47 tests passed, including voice routing before AI, recording state/elapsed time, empty output failures and IPC isolation. `reports/screen-capture-live.json` records real PNG capture, compact indicator/control checks, pause/resume, WebM finalization and successful playback decoding. `reports/screen-recording-quit.json` records a recording successfully saved on app quit. `reports/island-screen-recording.png` and `reports/island-screen-recording-paused.png` show the final compact controls. `reports/screen-capture-tests.log` contains the tests. Capture tests saved example files in the normal output folders.

## Active-player controls and Plezy

App-opening acknowledgements are deliberately short in chat and speech: “Opening Spotify.”, “Opening Firefox.” and the equivalent app name. “Spotify” by itself opens Spotify, and the observed “open spot of” dictation is repaired only in app-name matching. These requests run locally before AI submission, without the longer AI launch explanation.

“Open Firefox and Plezy in split screen”, “open Firefox and Plex side by side” and equivalent supported app pairs run directly. The first app goes left and the second right on the screen under the pointer, within its work area. Existing windows are reused; missing apps are located through their installed app paths and launched. Window ownership and visible frame bounds are checked, and a placement failure restores the previous placements. Application and window permissions both apply. The chat collapses after success and shows a compact Split screen card. `reports/app-split-live.json` verifies the actual Firefox/Plezy placement into two 1440 × 1704 halves, including reuse and Island acknowledgement.

Plex is an alias for Plezy in local media commands. “Play Iron Man on Plex”, “resume The Mentalist on Plex”, “pause on Plex”, “skip 2 minutes on Plex” and “open Plex” all target Plezy. Resume/continue title requests use the existing Plezy title adapter before AI submission. Names inside movie titles are preserved. Opening either name uses the installed Programs/Plezy/plezy.exe path.

Plain “pause”, “play” and “resume” control the current real Windows media session. Selection happens when the command executes: playing media is preferred, and C.O.D.Y./speech/notification sessions are excluded. Explicit Spotify commands retain Spotify targeting. “Pause on Plezy” targets Plezy specifically. “Skip 2 mins”, “go back 30 seconds” and “rewind two minutes on Plezy” perform a relative timeline seek, clamped to the available timeline.

“Play Iron Man on Plezy” searches the installed Plezy app for the exact title and presses its Play/Resume control. The adapter is restricted to the known installed Plezy executable and its accessible window controls. It resolves fresh bounds after Plezy's expanding sidebar moves Search, checks foreground ownership before keyboard input and verifies the exact movie's Windows media session is playing before reporting success. Missing or ambiguous titles fail clearly rather than selecting a sequel or unrelated result. Its Windows build does not implement plezy:// links; the official 2.25.0 sources used to establish this are under reference/plezy-2.25.0. No Plezy credentials were read or copied.

Live validation in `reports/media-controls-live.json` confirms Iron Man playback, plain pause/play targeting Plezy, a two-minute seek from 2.461s to 122.461s and the reverse seek. The tested movie was left paused. `reports/current-tests.log` records all 56 passing tests, including voice media commands being routed locally before AI submission.

## Update protection and recording alignment

The rebuilt working frontend disables automatic binary updates in both engine and direct-launch modes, uses NullUpdateService and never constructs an updater or installs a pending update on quit. This protects the C.O.D.Y. working copy; installed original HeyClicky binaries remain unchanged. Plezy's auto_check_updates_on_startup preference is false and its native WinSparkle CheckForUpdates registry setting is 0. Manual update paths are not used by C.O.D.Y. `reports/update-protection.json` records the settings; the native engine status exposes automaticUpdatesEnabled=false.

The recording dot and timer/label are translated six pixels right; pause and stop controls retain their layout positions. The recording regression again saved and decoded a playable video after this change.

## Persistent Island monitors

Examples: “show my CPU usage”, “show CPU and RAM”, “show GPU”, “show CPU temp”, “show GPU temp”, “show FPS”, “show Wi-Fi”, “show Wi-Fi details”, “show Wi-Fi speed”, and “run a Wi-Fi speed test”. “Stop showing CPU” removes just that monitor; “clear the Island” removes all pinned monitors. Selections persist across restarts, and results do not expire after the ordinary ten-second card interval. Several selected readings rotate in the compact Island; hovering exposes their full details. Recording and game controls take priority without deleting monitor selections.

CPU and RAM use live OS measurements. GPU usage uses Windows performance counters; Wi-Fi shows the active adapter, SSID/signal/radio/link rates when exposed, and measured traffic from byte-counter deltas. “Wi-Fi speed” means live network traffic, not maximum Internet speed. The speed test transfers generated bytes to Cloudflare (20 MB down, 4 MB up), measures approximate Internet download/upload rates and latency, and pins the result until cleared. No user files or Wi-Fi credentials are sent. Last measured results can be shown after restarting.

Temperature readings require an exposed LibreHardwareMonitor/OpenHardwareMonitor sensor provider. CPU/GPU temperatures and app FPS are not available from the providers on this PC and show N/A with an explanation; display refresh rate or capture frame rate is never substituted for application FPS. CPU, RAM, Wi-Fi and Qualcomm Adreno GPU usage were checked here. The live speed test measured approximately 393.5 Mbps down and 28.0 Mbps up. `reports/monitors-live.json` records pinning, individual clearing, adapter readings, the actual speed test and update protection. `reports/island-live-monitors.png` shows an earlier compact display.

## Reliable monitor hiding and English recognition

A failed “hide CPU usage” request was recorded as mixed-language text containing CPV rather than CPU. The working engine now defaults native recognition to English and adds CPU/GPU/RAM/Wi-Fi/Plezy/C.O.D.Y. keyterms. Recognition settings expose English and Automatic (multilingual); an explicit language choice persists in run/recognition-language.txt. These configure the existing native HeyClicky recogniser and its normal settings store; voice output is unchanged.

Monitor removal accepts hide, remove, stop showing/displaying/monitoring, don't show/display, clear and turn off, including an optional Island suffix and spoken/spelled CPU variants. The observed mixed-language hide transcript is also repaired locally. Removal clears the pinned selection on disk. reports/monitor-hide-live.json verifies both that transcript and ordinary English removal, repeated sample updates, saved hidden state, the live English setting and the Automatic option. All 59 tests pass, including voice hide routing before AI submission while preserving other pinned monitors. CPU is left hidden; the demonstration pins are no longer restored.

## Combined usage and temperature cards

CPU and GPU each have one compact Island card: usage is the larger top line, and temperature is the smaller line below. Asking for usage, temperature, or both selects that same card; asking to hide either removes the group. Existing separate temperature selections migrate automatically. Hardware model names appear only in the hover explanation. Missing or stale temperature readings hide the subtitle completely; valid readings appear underneath usage automatically.

RAM shows usage above used/total GB from one memory snapshot. Wi-Fi details show signal above receive/transmit link rates; Wi-Fi traffic and Internet speed-test results show download above upload. Each rotating card keeps its own details below it. Wi-Fi traffic waits for a valid baseline and resets after a disconnection, adapter change or counter reset. Unknown adapter readings are distinguished from offline status. Only sensors needed by selected cards are queried; RAM and FPS require no Windows sensor subprocess.

`reports/monitor-groups-live.json` records passing live CPU/GPU/RAM/Wi-Fi/FPS layout, sensor and hiding checks. Screenshots `reports/island-cpu-combined.png`, `reports/island-gpu-combined.png`, `reports/island-ram-reviewed.png` and `reports/island-wifi-details-reviewed.png` show the final cards. `reports/current-tests.log` records 70 passing tests, including group migration, unavailable/stale data, reconnect baselines, late query completion after hiding, and voice removal of the other monitors before AI submission. Verification restores the previous pinned selections.

New Chat now occupies the far-right header position beside Settings, replacing the collapse arrow. The composer engine button is removed. The mascot and Escape still collapse the panel. `reports/chat-layout-live.json` verifies layout and New Chat behavior; `reports/chat-layout.png` shows the updated panel. Unavailable temperatures now leave no subtitle at all; valid temperatures still appear beneath usage.

## Computer-use approval in the Island

HeyClicky agent computer-use requests and direct takeover offers now reach the C.O.D.Y. Island through the same-user engine pipe. The Island expands to an approval card showing the task/step, Deny and Allow once. Multiple requests queue; the UI initially focuses Deny and disables both buttons while a decision is being sent. One answer applies to one request. Native callbacks retain the original approve/decline behavior; no standing permission is granted. Native request state is fetched when the renderer loads, so an existing waiting job is visible after restarting the GUI. The direct takeover card retains its original 45-second timeout without opening the old HeyClicky consent window.

The engine invalidates stale requests and rejects reused IDs. Completed or disconnected requests disappear from the card. C.O.D.Y.'s local controller confirmations and existing Codex approval events use the same card; cancelling a local turn resolves its pending confirmation as denied. While a card is open, keyboard focus stays on its decision buttons, and Escape does not silently dismiss it. Once driving has started, native Escape behavior still takes control back.

`reports/island-approvals-live.json` verifies that the real pending Mentalist computer-use request is visible inside the Island with both decision buttons. That real request was deliberately left unanswered; fixture clicks were skipped. `reports/island-computer-approval.png` shows the card. `reports/native-consent-tests.log` records ten native lifecycle checks, including one-shot decisions, expiry, duplicate polling and stale IDs; `reports/current-tests.log` records 86 passing JavaScript tests, including native approval routing and frame validation. The frontend build succeeds and original backend libraries remain unchanged.

## Computer-control glow and AI cursor

Active native computer control uses the supplied `Computer Control Design` v5 design. The renderer preserves the reference's rounded edge-distance calculation, off-screen offset, Gaussian falloff and strength, and uses the supplied `Cursors/CODY_Blue_48.png` artwork with its six-pixel hotspot. Both the glow and separate AI cursor are tinted to the user's Island accent colour, including changes made during a session. The Windows cursor scheme is untouched; there are no click ripples or old HeyClicky drive pill/border in engine mode.

The native engine reports start, stop, current step and pointer positions while it actuates. Transparent, non-activating, click-through overlay windows cover the full bounds of each monitor, including the taskbar area. Windows physical pointer coordinates are converted to display-independent positions, while the reference geometry and cursor size retain their physical-pixel dimensions. Idle, stop, engine disconnection and application quit destroy the windows. Display changes rebuild their geometry. Native control input, consent and Escape take-back behavior are retained; visual previews do not initiate computer control.

In the C.O.D.Y. engine, voluntary take-back is Esc only. Mouse movement, clicks, scrolling and ordinary keys no longer end a drive. A dedicated global Esc listener is active only during computer control because the original HeyClicky shortcut monitor is disabled for the custom GUI. It ignores AI-generated Esc keystrokes, removes its hook when control ends, and stops the drive if the listener cannot be installed. Natural completion and tool/runtime failures still end a session normally. The original installed HeyClicky app retains its existing input policy. `reports/native-consent-tests.log` includes Esc filtering and native hook installation/disposal checks.

`reports/control-overlay-live.json` verifies the connected native state endpoint, full-monitor bounds, transparent screen centre, edge falloff, cursor positioning, accent changes and stop cleanup in a visual-only preview. The previous accent is restored afterwards. `reports/control-overlay-reference-view.png` provides a view on a dark test background; `reports/control-overlay-selected-colour.png` retains the actual transparent overlay. `reports/current-tests.log` records 89 passing JavaScript tests, including multiple-display placement, click-through/capture exclusion, accent changes, display changes and cleanup. The native frontend build succeeds.

## Files and photos in the Island

Drag files onto the compact top Island or the expanded chat. The Island highlights the drop, opens the chat, and shows removable file chips with image previews. The paperclip opens a file picker as an alternative. Attaching does not send an AI request or run a file; type a question or use the microphone when ready. Up to ten individual files are supported, matching HeyClicky's native attachment policy. The selections stay with their conversation and can be removed using each chip's × button. Files remain at their original paths; missing files are marked and cannot silently be submitted.

Real file paths reach the original CompanionSession attachment overload, preserving native image understanding and agent file work. Spoken attachment questions are transcribed first, then submitted with their selected files. Simple local commands still take the local utility route. User messages retain file names in history. Background agent results are linked back to the originating C.O.D.Y. conversation, with request IDs retained across GUI restarts, so document edits and longer file work appear in chat after completion. The original native voice choice is retained.

`reports/attachments-live.json` verifies a native file drag, staging without an AI submission, the actual HeyClicky image answer “Blue.”, removal, and a real edit of an isolated test document from CODY_OLD to CODY_NEW while retaining calibration number 48127. The completed document answer reached the chat. `reports/attachments-ui-live.json` verifies the final drop animation, preview and remove button; `reports/island-file-attachment.png` shows the final layout. `reports/current-tests.log` records 105 passing JavaScript tests, including attachment validation, limits, mutation ordering, typed/voice routing and background-result correlation. The native frontend builds successfully; the six original backend libraries remain unchanged.

## App pinning and spelling correction

Say “pin Firefox on top” or “keep Firefox always on top”; “unpin Firefox” removes it. Pinning opens a supported app if needed, checks the real Windows topmost flag, and leaves its size and location unchanged. Unpinning a closed app does not launch it. Both application and window permissions apply. The same app aliases as opening/split screen are supported, including Plex → Plezy.

In an editable text box, use the voice shortcut and say “proofread this”, “proof read this”, “spell check this”, or “fix my spelling”. Selected text is checked when the field exposes a selection; otherwise the entire current field is checked. C.O.D.Y. captures the field when listening begins, requests conservative word corrections from the signed-in HeyClicky engine, and replaces the text through the field's accessibility ValuePattern. Spacing, punctuation, line breaks, surrounding unselected text and wording are retained. It does not submit the text, press Enter, use the clipboard, or operate agent tools. The Island shows checking status and a short completion message. Typed commands can use the most recent external editable field when C.O.D.Y. has focus.

Input and UI Automation permissions are required. Password/read-only/hidden fields, unavailable editable values, fields over 12,000 characters, expired targets, changed contents and changed target focus are refused. Model replies are parsed as data and constrained to small word substitutions; larger rewrites and malformed answers leave the text unchanged. Only an explicit proofreading command sends field text to HeyClicky. A constant blank JPEG meets the worker's image requirement without capturing the screen.

Verification: `reports/proofread-live.json`, `tools/proofread-tests` (11 preservation/refusal checks), and `reports/current-tests.log` (113 JavaScript tests, including voice routing, permission denial, missing target handling and app pin state validation).

## Standalone installer 0.13.0

Use `dist/standalone-0.13.0/C.O.D.Y-Setup-0.13.0.exe` on another PC. It contains the current original C.O.D.Y. Island UI and all 742 native engine files, including voice, drawing, 3D, agents, .NET and Windows App SDK dependencies. The universal setup selects the x64 or ARM64 GUI; the included native engine is x64 (emulated on Windows 11 ARM64). No separately installed HeyClicky app or development checkout is needed. Account sign-in remains necessary for HeyClicky's online services.

The packaged launcher resolves `resources/native-engine`, uses a profile-scoped same-user pipe and a C.O.D.Y. mutex, and keeps account/state files in the writable C.O.D.Y. profile. Browser callbacks for both `heyclicky:` and `clicky:` return through the C.O.D.Y. executable. Native registration no longer replaces that handler. Engine initialization runs directly without waiting for the old hidden notch's first rendered frame. Original app updates and Velopack startup remain disabled in engine mode.

`Build-CODY-Standalone.bat` builds the native wrapper, stages the current GUI, audits all native files and creates the combined installer. The installer includes the Microsoft Visual C++ prerequisite and a Microsoft-signed WebView2 bootstrapper for machines missing WebView2. The WebView2 bootstrap step needs Internet access, as do the online AI services. Runtime deployment follows Microsoft's guidance: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview and https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution .

`reports/standalone-smoke-x64.json` and `reports/standalone-smoke-arm64.json` each record eight passing fresh-profile checks. Native CLR and WinUI modules were confirmed to load from the package, with no saved authentication. `reports/standalone-installer-payloads.json` verifies CRC integrity of both embedded architecture payloads. `reports/standalone-release.json` records the installer SHA-256. All 117 focused JavaScript tests pass, and the six original engine backend libraries retain their pristine hashes. No personal profile, account tokens or chat history are bundled.

## Background tasks and closed media players — 0.13.1

The Tasks button beside Settings, or “show my tasks”, opens native background work inside C.O.D.Y. A compact Island card shows active progress and prioritises tasks needing input. The task list displays active and recent statuses, progress and full available response text. Selected tasks support Stop, follow-up messages and opening their originating saved C.O.D.Y. conversation when known. Reply cancellation remains separate from background-task cancellation. Tasks needing extra usage approval are shown without granting that permission. Connection loss clears the live count and disables task controls.

The native bridge publishes bounded task snapshots from the actual AgentService and reads details on demand. Task IDs are checked against the native task collection before actions. Only selected fields are serialised; runtime leases and credentials are not sent to the renderer. The UI renders titles, progress and results as text and preserves separate follow-up drafts. Existing completion reports continue returning to the originating chat.

Windows media sessions are filtered against their actual player process and window before selection or playback commands. Closed players cannot retain stale Playing or Paused cards. Paused tray-only players are hidden, while real background playback and open paused players remain available. Media worker shutdown also clears cached artwork and optimistic playback state.

Validation: `reports/background-tasks-live.json` checks the real native task endpoint and isolated UI fixtures for compact status, the expanded task view, selected follow-up/stop routing and clearing completed activity. `reports/island-background-tasks.png` shows the fixture preview. No real task was launched or stopped by these controls tests. Nine PowerShell ownership cases cover stale Spotify, real paused windows, tray playback, unrelated apps and browser sessions; the live media snapshot is `reports/media-owner-live.json`. All 124 focused JavaScript tests pass. Both standalone architectures pass nine fresh-profile checks, and both installer payloads pass CRC verification. Use `dist/standalone-0.13.1/C.O.D.Y-Setup-0.13.1.exe` for the other PC; `reports/standalone-release-0.13.1.json` records its SHA-256. The six original backend assemblies remain unchanged.
