# OmniLauncher

A single grid for every game you own across every launcher installed on your PC.
It reads each launcher's own metadata — no scraping, no accounts, no API keys —
and hands launching back to the native launcher via its registered protocol.

## Supported launchers

| Launcher       | How games are found                                              | How they launch |
|----------------|-----------------------------------------------------------------|-----------------|
| **Steam**      | `libraryfolders.vdf` + `appmanifest_*.acf` across all libraries | `steam://rungameid/<appid>` |
| **Epic Games** | `%ProgramData%\Epic\...\Manifests\*.item`                       | `com.epicgames.launcher://apps/...` |
| **GOG Galaxy** | `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games`                        | direct exe (or `goggalaxy://`) |
| **Ubisoft**    | `HKLM\...\Ubisoft\Launcher\Installs`                             | `uplay://launch/<id>/0` |
| **EA**         | Origin `*.mfst` + EA Desktop `installerdata.xml`                 | `origin://launchgame/<offer>` |
| **Battle.net** | `%AppData%\Battle.net\Battle.net.config`                         | `Battle.net.exe --exec="launch <code>"` |
| **Riot**       | `RiotClientInstalls.json` + `Metadata\`                          | `RiotClientServices.exe --launch-product=<p> --launch-patchline=live` |
| **Rockstar**   | `HKLM\...\Rockstar Games\<title>\InstallFolder`                   | game launch stub (`Play*.exe`) directly |

## Run

```powershell
git clone https://github.com/sheranton/OmniLauncher.git
cd OmniLauncher
npm install
npm start
```

## Build

**NSIS installer** (requires Windows Developer Mode or an elevated shell, since
electron-builder's signing bundle needs symlink permission):

```powershell
npm run dist
```

**Portable build** (no admin needed) — produces a run-anywhere folder with `OmniLauncher.exe`:

```powershell
npm run pack
```

Both land in `dist\`. Zip the portable folder to share it. Prebuilt releases are on the
[Releases page](https://github.com/sheranton/OmniLauncher/releases).

## Cover art (zero setup)

Art resolves automatically, no key required from the end user:

1. **Steam** games use the library capsule from the CDN (wide header art is letterboxed, never cropped).
2. **Non-Steam** games are looked up on the **Steam store by name** (public, keyless) and matched
   against their capsule — covers most multiplatform titles.
3. **SteamGridDB** is the universal catch-all for launcher exclusives (Fortnite, VALORANT, etc).
   The key is injected at build time and never lives in the repo — see *Building with art* below.
4. Anything still unresolved falls back to a generated title tile.

The **⚙** panel lets a power user supply their own SteamGridDB key to override the bundled one.
All resolved art is cached to disk, so each game is only fetched once.

## Building with art (the SteamGridDB key)

The key is kept out of source control. It lives in `sgdb-key.js` (git-ignored) locally, or in the
`OMNI_SGDB_KEY` env var in CI, and gets bundled into the built `.exe`.

**Local build:**
```powershell
copy sgdb-key.example.js sgdb-key.js   # then paste your key into it
# or: npm run set-key YOUR_KEY_HERE
npm run dist
```

**GitHub Actions release:** add your key as a repo secret named `OMNI_SGDB_KEY`
(Settings → Secrets and variables → Actions), then push a tag:
```bash
git tag v1.0.0 && git push --tags
```
`.github/workflows/build.yml` injects the secret, builds, and attaches the installer to the release.
The repo never contains the key.

> Get a free key: https://www.steamgriddb.com/profile/preferences/api

## Features

- Search, per-launcher filter chips, favorites (pinned to top), hide/unhide.
- Search, per-launcher filter chips, favorites (pinned to top), hide/unhide.
- Right-click a card to open its install folder.
- Results cached to `userData\omni-config.json` so startup paints instantly, then rescans.
