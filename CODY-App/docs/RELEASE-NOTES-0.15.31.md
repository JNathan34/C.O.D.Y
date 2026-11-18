# C.O.D.Y. 0.15.31

- **Repair the installed Word plugin.** PowerShell now loads Word's helper from the extracted application files. Errors display readable messages. New blank documents no longer invalidate their own editing guard, and changing Word session IDs are excluded from document-change checks. [#41](https://github.com/JNathan34/C.O.D.Y/issues/41)
- **Sign in with Plex.** Connect through Plex's website and choose your server. The compact plugin card has one sign-in path, a refreshed icon, Test connection and Disconnect. Manual token fields and the settings buttons for sessions/recent media have been removed. Credentials remain encrypted on your Windows account. [#15](https://github.com/JNathan34/C.O.D.Y/issues/15)
- **Keep Overseerr connected.** The API key shows as saved, survives reopening and can be retained when saving the same server. Connections are verified before saving. Search results appear inside the plugin card, and request rows show titles and approval status. [#16](https://github.com/JNathan34/C.O.D.Y/issues/16)
- **Request movies and TV shows.** Review a search result, choose TV seasons where applicable, and confirm the request. Availability is rechecked, duplicate submissions are blocked, and uncertain network results are never automatically resent. Requests use your Overseerr server's default standard-quality setup. [#16](https://github.com/JNathan34/C.O.D.Y/issues/16)
- **Distinguish the Word integrations.** Plugin cards and the @ picker now label Word (Desktop) and Microsoft Word (Cloud), with corrected descriptions. Existing connections and routing IDs are preserved. [#27](https://github.com/JNathan34/C.O.D.Y/issues/27)

## Drawing changes and known limitation

This build includes partial drawing repairs: direct image anchoring, owner-local hit-testing, MSAA provider support, acquisition retries, rejection of stale tracking results and retention of mark identity across missing render frames.

**The reported drawing problem is still open.** The live native fixture still fails to acquire a document anchor, and real Firefox scrolling/tab-switching acceptance has not passed. Circles may still fail to follow content, remain stale or disappear. This release does not claim those symptoms are resolved. [#37](https://github.com/JNathan34/C.O.D.Y/issues/37) and [#53](https://github.com/JNathan34/C.O.D.Y/issues/53) remain open.

## Validation

Local validation: 489 Node tests, 12 target-provider regression checks, the native drawing-control/geometry harness, JavaScript syntax checks and a native engine build passed. Word's extracted helper was exercised through Electron against a disposable installed Word document. Plex and Overseerr UI flows were checked in Electron, including connection persistence and request confirmation. Existing Overseerr authentication, search and request reads were also verified against the configured server.

Plex account approval and new media submissions were tested with fixtures rather than creating live account/server changes. Signed-in AI drafting and the live drawing acceptance checks remain unverified. Both Windows installers and updater metadata are checked by the release workflow before publication.

## Install or update

Use **Settings → Updates**, or download the x64 installer for Intel/AMD PCs or ARM64 for ARM/Snapdragon PCs.
