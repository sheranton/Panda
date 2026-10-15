const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const scanners = require('./scanners');

// SteamGridDB key is injected at build time — from the OMNI_SGDB_KEY env var, or
// from sgdb-key.js (git-ignored). It never lives in committed source. No key just
// means keyless Steam-store art only; the app still runs fine.
let DEFAULT_SGDB_KEY = process.env.OMNI_SGDB_KEY || '';
if (!DEFAULT_SGDB_KEY) {
  try { DEFAULT_SGDB_KEY = require('./sgdb-key').key || ''; } catch {}
}

let win;
let cfgPath;

function loadCfg() {
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch { return { favorites: [], hidden: [], cache: [] }; }
}
function saveCfg(c) {
  try { fs.writeFileSync(cfgPath, JSON.stringify(c)); } catch {}
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#0d0e12',
    title: 'OmniLauncher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  cfgPath = path.join(app.getPath('userData'), 'omni-config.json');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// scan all launchers; append owned-but-uninstalled Steam titles; cache for instant repaint
ipcMain.handle('scan', async () => {
  const installed = await scanners.scanAll();
  installed.forEach(g => { g.installed = true; });

  let steamLibraryPrivate = false;
  const extra = [];
  try {
    const lib = await scanners.steamLibrary();
    steamLibraryPrivate = !!lib.private;
    const have = new Set(installed.filter(g => g.platform === 'Steam').map(g => g.appid));
    for (const o of lib.games) {
      if (have.has(o.appid) || scanners.STEAM_SKIP.has(o.appid)) continue;
      extra.push({
        id: 'steam-' + o.appid,
        appid: o.appid,
        name: o.name,
        platform: 'Steam',
        installed: false,
        installDir: null,
        cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${o.appid}/library_600x900.jpg`,
        coverFallback: `https://cdn.cloudflare.steamstatic.com/steam/apps/${o.appid}/header.jpg`,
        launch: { type: 'uri', value: `steam://install/${o.appid}`, install: true }
      });
    }
  } catch {}

  const games = [...installed, ...extra].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const cfg = loadCfg();
  cfg.cache = games;
  saveCfg(cfg);
  return { games, steamLibraryPrivate };
});

ipcMain.handle('launch', async (_e, game) => {
  try {
    if (!game || !game.launch) return { ok: false, error: 'no launch target' };
    if (game.launch.type === 'uri') {
      await shell.openExternal(game.launch.value);
      return { ok: true };
    }
    if (!fs.existsSync(game.launch.value)) return { ok: false, error: 'executable not found: ' + game.launch.value };
    const child = spawn(game.launch.value, game.launch.args || [], {
      detached: true,
      stdio: 'ignore',
      cwd: game.launch.cwd || path.dirname(game.launch.value)
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('openDir', async (_e, dir) => {
  if (dir && fs.existsSync(dir)) { shell.openPath(dir); return { ok: true }; }
  return { ok: false };
});

ipcMain.handle('openUrl', async (_e, url) => {
  if (url) { await shell.openExternal(url); return { ok: true }; }
  return { ok: false };
});

// ---------- cover-art resolver (disk-cached, keyless-first) ----------
function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

async function urlOk(u) {
  try {
    const r = await fetch(u, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

// Keyless: find the game on the Steam store by name and use its portrait capsule.
// Covers most multiplatform titles with no API key at all.
async function steamSearchArt(name) {
  const clean = (name || '').replace(/[™®©]/g, '').trim();
  if (clean.length < 3) return null;
  try {
    const res = await fetch(
      'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(clean) + '&cc=us&l=en',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const items = (j && j.items) || [];
    const b = normName(clean);

    // scan the top results for a real name match, skipping DLC/bundle mis-hits
    for (const item of items.slice(0, 6)) {
      if (!item || !item.id) continue;
      const a = normName(item.name);
      if (!(a === b || a.includes(b) || b.includes(a))) continue;
      const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`;
      if (await urlOk(url)) return url;
    }
    return null;
  } catch { return null; }
}

async function sgdbFetch(pathUrl, key) {
  const res = await fetch('https://www.steamgriddb.com/api/v2' + pathUrl, {
    headers: { Authorization: 'Bearer ' + key }
  });
  if (!res.ok) throw new Error('sgdb ' + res.status);
  return res.json();
}

async function sgdbArt(game, key) {
  try {
    let gameId = null;
    if (game.platform === 'Steam' && game.appid) {
      try { const j = await sgdbFetch('/games/steam/' + game.appid, key); gameId = j && j.data && j.data.id; } catch {}
    }
    if (!gameId) {
      const term = encodeURIComponent((game.name || '').replace(/[™®©]/g, '').trim());
      if (!term) return null;
      const j = await sgdbFetch('/search/autocomplete/' + term, key);
      gameId = j && j.data && j.data[0] && j.data[0].id;
    }
    if (!gameId) return null;
    const grids = await sgdbFetch(
      '/grids/game/' + gameId + '?dimensions=600x900,342x482,660x930&types=static&nsfw=any&limit=1', key
    );
    return grids && grids.data && grids.data[0] && (grids.data[0].url || grids.data[0].thumb) || null;
  } catch { return null; }
}

ipcMain.handle('art:getKey', () => loadCfg().sgdbKey || '');
ipcMain.handle('art:setKey', (_e, k) => { const c = loadCfg(); c.sgdbKey = (k || '').trim(); saveCfg(c); return true; });
ipcMain.handle('art:clearCache', () => { const c = loadCfg(); c.artCache = {}; saveCfg(c); return true; });

ipcMain.handle('art:resolve', async (_e, game) => {
  const cfg = loadCfg();
  cfg.artCache = cfg.artCache || {};
  if (cfg.artCache[game.id]) return cfg.artCache[game.id];
  const save = (url) => { cfg.artCache[game.id] = url; saveCfg(cfg); return url; };

  // 1. keyless Steam-store lookup (skip for Steam games — their capsule already failed)
  if (game.platform !== 'Steam') {
    const u = await steamSearchArt(game.name);
    if (u) return save(u);
  }

  // 2. SteamGridDB — bundled default key, or the user's own override
  const key = (cfg.sgdbKey || '').trim() || DEFAULT_SGDB_KEY;
  if (key) {
    const u = await sgdbArt(game, key);
    if (u) return save(u);
  }

  return null;
});

ipcMain.handle('getConfig', () => loadCfg());
ipcMain.handle('setConfig', (_e, c) => { saveCfg(c); return true; });
