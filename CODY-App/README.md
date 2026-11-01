# Current C.O.D.Y. project

Run `Start-Development.bat`, or use `Start-CODY.bat` in the parent folder.

| Folder | What it contains |
| --- | --- |
| `frontend/original-cody/src/` | Current Electron app and island interface. |
| `frontend/original-cody/assets/` | Current icons, mascot artwork and other app assets. |
| `frontend/original-cody/tests/` | Frontend checks. |
| `work/Cody.Engine/` | Native Windows app, speech and computer-control integration. |
| `work/Cody.Core/` | Native engine and browser integration. |
| `work/Cody.*` | Other recovered native projects. Keep these with the native sources. |
| `work/wake-dotnet/` | Native wake-word library dependencies. |
| `work/wake-lab/` | Wake-word experiment environment; separate from the running app. |
| `run/current/` | Native engine and resources used by the running app. Required. |
| `run/` | Additional native working data and caches. |
| `pristine/` | Base native runtime required for builds. Required. |
| `node_modules/` | Shared Electron, packaging and JavaScript dependencies. Required. |
| `tools/` | Build scripts, verification utilities and maintenance tools. |
| `build/installer/` | Installer configuration. |
| `reports/` | Diagnostic logs, screenshots and verification results. |
| `reference/` | Historical source and research references. |
| `frontend/cody/` | Historical renderer reference; not required for the current build. |
| `docs/` | Development notes and history. |

## Running and building

- `Start-Development.bat`: start the current app.
- `Build-Engine.bat`: rebuild the native engine after closing CODY.
- `Build-CODY-Standalone.bat`: rebuild and package installers; creates `build/standalone-app/` and `dist/` again.
- First restore the native build inputs with `powershell -NoProfile -File tools/restore-build-inputs.ps1`.
- Run `npm ci --ignore-scripts`, then `node node_modules/electron/install.js` to restore JavaScript and Electron dependencies.
- Install the .NET 10 SDK to build the native projects, which target Windows and .NET 9 with C# 14.
- Frontend checks: `node --test frontend/original-cody/tests/*.test.cjs`.

The current app no longer depends on the old `CODY-Integrated` project folder. Its dependencies now live here. Existing Windows profile names are retained so settings and chats continue to load.

[Earlier development notes](docs/DEVELOPMENT-NOTES.md) describe the history of this project. Paths in those notes reflect the earlier layout.

## Assistant AI selection

Settings → Agents → Claude Code Usage shows the signed-in account's used and remaining agent messages, conversation allowance, and reset date. It refreshes on opening the page and once a minute while visible, with a manual Refresh usage button. Failed refreshes identify cached account data or show an unavailable state.

Settings → Agents → Assistant AI selects Claude, ChatGPT Codex or ChatGPT for new typed and spoken requests. Claude keeps the existing connection. Both GPT routes request `gpt-6.1-sol` with `medium` reasoning and reject unavailable selections rather than choosing a different model. Codex uses ChatGPT account sign-in; the ChatGPT option uses the separate web session. Local utility commands retain their direct routes. Native background jobs and attached-file requests currently remain with Claude. See the repository README for installation and setup.

GitHub Releases updates are configured for installed Windows builds. See [GitHub update and release instructions](docs/GITHUB-UPDATES.md).
