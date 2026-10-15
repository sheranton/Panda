<p align="center">
  <img src="assets/panda.png" width="120" alt="Panda" />
</p>

<h1 align="center">Panda</h1>

A Steam-style launcher that pulls every game you own across every launcher on your PC
into one library — with cover art, a detail page per game, and a stats dashboard.
It reads each launcher's own metadata and hands launching back to the native client.

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

## Features

- **Steam-style UI** — sidebar game list, per-game detail pages (hero banner, Play/Install, stats), and a home dashboard.
- **Dashboard stats** — total playtime, most played, total launches, recently played, most-played chart. Playtime comes from the Steam Web API; launches are tracked locally.
- **Installed / All toggle** — see Steam games you own but haven't installed, and install them in place.
- Cover art resolves automatically, favorites, hide/unhide, per-launcher filters, search.

## Run

```powershell
git clone https://github.com/sheranton/Panda.git
cd Panda
npm install
npm start
```

## Build

**Portable build** (no admin needed) — produces a run-anywhere folder with `Panda.exe`:

```powershell
npm run pack
```

**NSIS installer** (requires Windows Developer Mode or an elevated shell, since
electron-builder's signing bundle needs symlink permission):

```powershell
npm run dist
```

Both land in `dist\`. Prebuilt releases are on the
[Releases page](https://github.com/sheranton/Panda/releases).

## Cover art & owned games (zero setup for end users)

- **Steam** games use the library capsule / hero art from the CDN.
- **Non-Steam** games are matched on the Steam store by name (public, keyless).
- **SteamGridDB** is the catch-all for launcher exclusives.
- **Owned-but-uninstalled Steam games** come from the Steam Web API.

Both keys are injected at build time and never live in the repo. They sit in `sgdb-key.js`
(git-ignored) locally, or in `PANDA_SGDB_KEY` / `PANDA_STEAM_KEY` env vars in CI, and get bundled
into the built app.

**Local build:**
```powershell
copy sgdb-key.example.js sgdb-key.js
npm run set-key --sgdb=YOUR_SGDB_KEY --steam=YOUR_STEAM_KEY
npm run pack
```

**GitHub Actions release:** add repo secrets `PANDA_SGDB_KEY` and `PANDA_STEAM_KEY`
(Settings → Secrets and variables → Actions), then push a tag:
```bash
git tag v1.1.0 && git push --tags
```

> SteamGridDB key: https://www.steamgriddb.com/profile/preferences/api
> Steam Web API key: https://steamcommunity.com/dev/apikey

Resolved art is cached to disk, and the end user's runtime config lives in `userData\panda-config.json`.
