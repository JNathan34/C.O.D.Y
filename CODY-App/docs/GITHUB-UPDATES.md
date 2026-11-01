# GitHub updates

C.O.D.Y. checks public GitHub Releases at https://github.com/JNathan34/C.O.D.Y.
Installed Windows apps check 15 seconds after startup and every six hours. Users
can turn this off under Settings → Updates or check manually. Download and
installation each require a button click. A pending update never installs merely
because the app exits. Active tasks, voice sessions and recordings block restart.
The development copy never downloads or installs application updates.

## First installation

Install a version containing this updater once using the setup executable. Older
installations without this updater need that one manual installation. Subsequent
versions can update in the app. Conversations, account state and preferences stay
in the existing CODY-Integrated user profile.

The old engine's HeyClicky/Velopack updater remains disabled. The C.O.D.Y. updater
replaces the complete packaged app, including its bundled engine.

## Release a version

1. Increase `version` in `frontend/original-cody/package.json`. Use a stable
   version greater than the published release, for example `0.15.3`.
2. Quit the development app and run `Build-CODY-Standalone.bat`. This builds the
   native engine and both Windows architectures, then produces the NSIS setup
   and update manifest in `dist/standalone-VERSION`. This command never publishes.
3. Run `npm run release:check`. It verifies manifest versions, installer sizes
   and SHA-512 checksums. Do not rename the installer after building.
4. Sign in using `gh auth login`, or set `GH_TOKEN` or `GITHUB_TOKEN` privately
   for an account with repository Contents write access. Run `npm run release:draft`.
   This uploads the installer, manifests, optional blockmaps and verified build inputs to a new
   draft release. Profiles and tokens are not uploaded as release assets. A failed
   upload leaves a draft; delete that incomplete draft before retrying.
5. Review release notes and assets on GitHub and publish the draft as a normal
   release. Do not mark it as a prerelease. Drafts are invisible to the updater.

Always upload `latest.yml` alongside both architecture-specific executables.
The publisher verifies that both installers are listed and includes them
automatically. Each installer contains one application architecture; the updater
selects the matching file from the shared manifest. Keep assets on older releases
available, including the pinned native build-input archive.
Users need no GitHub login or token to receive public releases.

## Verification

Run `node --test tests/updates.test.cjs` from `frontend/original-cody` for state,
retry, installation, development isolation and IPC checks. Packaging runs the
existing engine integrity audit and checks the updater module is included.

For a full update test, install the baseline release on a test Windows profile,
publish a higher version with its matching manifest, then check, download and
restart from Settings → Updates. Confirm the version changes and history stays.
That end-to-end test requires two real published versions; a development launch
does not exercise installation.

The updater validates downloads against the release manifest's SHA-512 hash.
The existing Windows build is unsigned. If adding a signing certificate later,
configure it in electron-builder so signature verification is enabled as well.

Implementation follows electron-builder v26's NSIS/GitHub workflow:
https://www.electron.build/v26/docs/features/auto-update/.
