# C.O.D.Y. 0.15.3

Settings → Agents now includes:

- **Claude Code Usage** as the allowance card title.
- **Sign in** and **Sign out** controls for the existing account connection, labelled Claude Code.
- A matching **Codex Usage** card showing the signed-in ChatGPT account's available allowance windows, percentages remaining and reset times. Missing usage is shown as unavailable.

A left click on the sleeping island now opens it immediately, including when hover has just woken the mascot.

Choose **C.O.D.Y-Setup-0.15.3-x64.exe** for Intel/AMD Windows PCs or **C.O.D.Y-Setup-0.15.3-arm64.exe** for ARM/Snapdragon Windows PCs. Some native tools run as x64 on ARM Windows. Both installers are currently unsigned.

Existing updater-enabled installations can use **Settings → Updates**. Installations older than 0.15.1 need a manual setup once to obtain the updater. Conversations and settings are preserved.

Validation: 270 JavaScript tests, source checks, a native engine build, mocked account UI sign-in/out checks and a successful read of two real Codex usage windows. The live browser sign-in/sign-out flow was not exercised to avoid changing the current account session.

The illustrated Word guide remains available in the repository and the 0.15.2 release; it describes version 0.15.0. Native build prerequisites remain pinned to the verified 0.15.1 archive.
