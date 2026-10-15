// scanners.js — discovers installed games by reading each launcher's own metadata.
// Each scanner returns an array of:
//   { id, name, platform, installDir, cover, coverFallback, launch }
// launch is either:
//   { type:'uri', value:'steam://...' }               -> handed to shell.openExternal
//   { type:'exe', value:'C:\\...\\game.exe', args, cwd } -> spawned detached

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { parseVDF } = require('./vdf');

const execFileAsync = promisify(execFile);
const PROGRAMDATA = process.env.PROGRAMDATA || 'C:\\ProgramData';
const APPDATA = process.env.APPDATA || '';

// ---------- registry helpers (via reg.exe, no native modules) ----------
async function regQuery(key, args = []) {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, ...args], { windowsHide: true });
    return stdout;
  } catch {
    return '';
  }
}

function parseRegValues(stdout) {
  const vals = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/);
    if (m) vals[m[1]] = m[3];
  }
  return vals;
}

function parseRegSubkeys(stdout) {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('HKEY'));
  return lines.slice(1); // first HKEY line is the queried key header; the rest are subkeys
}

function walk(dir, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

// ---------- Steam ----------
async function scanSteam() {
  const games = [];
  let steamPath =
    parseRegValues(await regQuery('HKCU\\Software\\Valve\\Steam', ['/v', 'SteamPath'])).SteamPath ||
    parseRegValues(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', ['/v', 'InstallPath'])).InstallPath;
  if (!steamPath) return games;
  steamPath = steamPath.replace(/\//g, '\\');

  const libs = [];
  const libVdf = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (fs.existsSync(libVdf)) {
    try {
      const data = parseVDF(fs.readFileSync(libVdf, 'utf8'));
      const lf = data.libraryfolders || data.LibraryFolders || {};
      for (const k of Object.keys(lf)) {
        const entry = lf[k];
        if (entry && entry.path) libs.push(entry.path);
      }
    } catch {}
  }
  if (!libs.includes(steamPath)) libs.push(steamPath);

  const SKIP = new Set(['228980', '1070560', '1391110', '1628350']); // runtimes / redists
  for (const lib of libs) {
    const appsDir = path.join(lib, 'steamapps');
    let files;
    try { files = fs.readdirSync(appsDir); } catch { continue; }
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
      try {
        const acf = parseVDF(fs.readFileSync(path.join(appsDir, f), 'utf8'));
        const app = acf.AppState;
        if (!app || !app.appid || SKIP.has(app.appid)) continue;
        games.push({
          id: 'steam-' + app.appid,
          appid: app.appid,
          name: app.name || app.installdir || ('App ' + app.appid),
          platform: 'Steam',
          installDir: path.join(appsDir, 'common', app.installdir || ''),
          cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/library_600x900.jpg`,
          coverFallback: `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/header.jpg`,
          launch: { type: 'uri', value: `steam://rungameid/${app.appid}` }
        });
      } catch {}
    }
  }
  return games;
}

// ---------- Epic Games ----------
async function scanEpic() {
  const games = [];
  const dir = path.join(PROGRAMDATA, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files;
  try { files = fs.readdirSync(dir); } catch { return games; }
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.item')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue; // skip engine/plugins
      if (m.bIsIncompleteInstall) continue;
      const ns = m.CatalogNamespace;
      const ci = m.CatalogItemId;
      const an = m.AppName || m.MainGameAppName;
      if (!ns || !ci || !an) continue;
      games.push({
        id: 'epic-' + an,
        name: m.DisplayName || an,
        platform: 'Epic Games',
        installDir: m.InstallLocation || null,
        cover: null,
        launch: {
          type: 'uri',
          value: `com.epicgames.launcher://apps/${ns}%3A${ci}%3A${an}?action=launch&silent=true`
        }
      });
    } catch {}
  }
  return games;
}

// ---------- GOG Galaxy ----------
async function scanGOG() {
  const games = [];
  const base = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';
  const subkeys = parseRegSubkeys(await regQuery(base));
  for (const key of subkeys) {
    const v = parseRegValues(await regQuery(key));
    if (!v.gameID) continue;
    const exe = v.exe || (v.path && v.exeFile ? path.join(v.path, v.exeFile) : null);
    games.push({
      id: 'gog-' + v.gameID,
      name: v.gameName || (v.path ? path.basename(v.path) : v.gameID),
      platform: 'GOG',
      installDir: v.path || null,
      cover: null,
      launch: exe
        ? { type: 'exe', value: exe, cwd: v.workingDir || v.path || path.dirname(exe), args: (v.launchParam || '').split(' ').filter(Boolean) }
        : { type: 'uri', value: `goggalaxy://openGameView/${v.gameID}` }
    });
  }
  return games;
}

// ---------- Ubisoft Connect ----------
async function scanUbisoft() {
  const games = [];
  const base = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs';
  const subkeys = parseRegSubkeys(await regQuery(base));
  for (const key of subkeys) {
    const id = key.split('\\').pop();
    const v = parseRegValues(await regQuery(key));
    const dir = v.InstallDir;
    if (!dir) continue;
    games.push({
      id: 'uplay-' + id,
      name: path.basename(dir.replace(/[\\/]+$/, '')),
      platform: 'Ubisoft',
      installDir: dir,
      cover: null,
      launch: { type: 'uri', value: `uplay://launch/${id}/0` }
    });
  }
  return games;
}

// ---------- EA (Origin + EA app) ----------
async function scanEA() {
  const games = [];
  const seen = new Set();

  // Origin LocalContent *.mfst — launch id lives in a querystring inside the file
  const oc = path.join(PROGRAMDATA, 'Origin', 'LocalContent');
  if (fs.existsSync(oc)) {
    walk(oc, f => {
      if (!f.toLowerCase().endsWith('.mfst')) return;
      try {
        const txt = fs.readFileSync(f, 'utf8');
        const m = txt.match(/[?&]id=([0-9A-Za-z._@-]+)/);
        if (!m) return;
        const offer = m[1].split('@')[0];
        if (seen.has(offer)) return;
        seen.add(offer);
        games.push({
          id: 'ea-' + offer,
          name: path.basename(path.dirname(f)),
          platform: 'EA',
          installDir: path.dirname(f),
          cover: null,
          launch: { type: 'uri', value: `origin://launchgame/${offer}` }
        });
      } catch {}
    });
  }

  // EA Desktop InstallData\<game>\installerdata.xml
  const ed = path.join(PROGRAMDATA, 'EA Desktop', 'InstallData');
  let dirs;
  try { dirs = fs.readdirSync(ed); } catch { dirs = []; }
  for (const d of dirs) {
    const idata = path.join(ed, d, 'installerdata.xml');
    if (!fs.existsSync(idata)) continue;
    try {
      const xml = fs.readFileSync(idata, 'utf8');
      const cm = xml.match(/<contentID>([^<]+)<\/contentID>/);
      const nm = xml.match(/<gameTitle[^>]*>([^<]+)<\/gameTitle>/) || xml.match(/<name[^>]*>([^<]+)<\/name>/);
      const offer = cm ? cm[1].trim() : d;
      if (seen.has(offer)) continue;
      seen.add(offer);
      games.push({
        id: 'ea-' + offer,
        name: nm ? nm[1].trim() : d,
        platform: 'EA',
        installDir: path.join(ed, d),
        cover: null,
        launch: { type: 'uri', value: `origin://launchgame/${offer}` }
      });
    } catch {}
  }
  return games;
}

// ---------- Battle.net ----------
const BNET_NAMES = {
  prometheus: 'Overwatch 2', pro: 'Overwatch 2', s1: 'StarCraft Remastered', s2: 'StarCraft II',
  wow: 'World of Warcraft', wow_classic: 'WoW Classic', d3: 'Diablo III', osi: 'Diablo II: Resurrected',
  fen: 'Diablo IV', d4: 'Diablo IV', anbs: 'Diablo Immortal', hero: 'Heroes of the Storm',
  wtcg: 'Hearthstone', hs_beta: 'Hearthstone', w3: 'Warcraft III: Reforged', gryphon: 'Warcraft Rumble',
  zeus: 'Call of Duty', odin: 'Call of Duty: Modern Warfare', lazarus: 'Call of Duty: MW2',
  viper: 'Call of Duty: Black Ops 4', fore: 'Call of Duty: Vanguard', auks: 'Call of Duty: MWII',
  rtro: 'Blizzard Arcade Collection'
};

async function scanBattleNet() {
  const games = [];
  const cfg = path.join(APPDATA, 'Battle.net', 'Battle.net.config');
  if (!fs.existsSync(cfg)) return games;

  // locate the Battle.net launcher so we can use its exec-launch command
  let loc =
    parseRegValues(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Battle.net', ['/v', 'InstallLocation'])).InstallLocation ||
    'C:\\Program Files (x86)\\Battle.net';
  const exe = path.join(loc, 'Battle.net.exe');
  const haveExe = fs.existsSync(exe);

  try {
    const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    const gObj = j.Games || {};
    for (const code of Object.keys(gObj)) {
      if (code === 'battle_net' || code === 'bna') continue;
      games.push({
        id: 'bnet-' + code,
        name: BNET_NAMES[code] || code,
        platform: 'Battle.net',
        installDir: null,
        cover: null,
        launch: haveExe
          ? { type: 'exe', value: exe, args: [`--exec=launch ${code}`], cwd: loc }
          : { type: 'uri', value: `battlenet://${code}` }
      });
    }
  } catch {}
  return games;
}

// ---------- Riot Games ----------
const RIOT_NAMES = {
  valorant: 'VALORANT',
  league_of_legends: 'League of Legends',
  bacon: 'Legends of Runeterra',
  teamfighttactics: 'Teamfight Tactics'
};
// internal client components that live in Metadata but aren't launchable games
const RIOT_SKIP = new Set(['riot_client', 'lion', 'ryze', 'bull']);

async function scanRiot() {
  const games = [];
  const installsFile = path.join(PROGRAMDATA, 'Riot Games', 'RiotClientInstalls.json');
  if (!fs.existsSync(installsFile)) return games;

  let rc;
  try {
    const j = JSON.parse(fs.readFileSync(installsFile, 'utf8'));
    rc = j.rc_live || j.rc_default || j.rc_beta;
  } catch { return games; }
  if (!rc || !fs.existsSync(rc)) return games;

  const metaDir = path.join(PROGRAMDATA, 'Riot Games', 'Metadata');
  const products = new Set();
  try {
    for (const d of fs.readdirSync(metaDir)) products.add(d.split('.')[0]); // e.g. valorant.live -> valorant
  } catch {}

  for (const p of products) {
    const pl = p.toLowerCase();
    if (RIOT_SKIP.has(pl) || /client/.test(pl)) continue; // drop the Riot Client itself
    games.push({
      id: 'riot-' + p,
      name: RIOT_NAMES[p] || p,
      platform: 'Riot',
      installDir: null,
      cover: null,
      launch: { type: 'exe', value: rc, args: [`--launch-product=${p}`, '--launch-patchline=live'], cwd: path.dirname(rc) }
    });
  }
  return games;
}

// ---------- Rockstar Games Launcher ----------
const ROCKSTAR_SKIP = new Set([
  'launcher', 'rockstar games social club', 'social club', 'steam', 'sdk', 'rgl'
]);
// primary launch stub per known title; RGL names them Play*.exe
const ROCKSTAR_EXE = {
  'grand theft auto v': 'PlayGTAV.exe',
  'grand theft auto v enhanced': 'PlayGTAV.exe',
  'gta v enhanced': 'PlayGTAV.exe',
  'red dead redemption 2': 'PlayRDR2.exe',
  'red dead redemption': 'RDR.exe',
  'l.a. noire': 'LANoire.exe',
  'la noire': 'LANoire.exe',
  'max payne 3': 'MaxPayne3.exe',
  'bully: scholarship edition': 'Bully.exe',
  'grand theft auto iv': 'PlayGTAIV.exe',
  'grand theft auto iv complete edition': 'PlayGTAIV.exe',
  'grand theft auto iii': 'PlayGTA3.exe',
  'grand theft auto: vice city': 'PlayViceCity.exe',
  'grand theft auto: san andreas': 'PlaySanAndreas.exe'
};

function findRockstarExe(dir, name) {
  const mapped = ROCKSTAR_EXE[(name || '').toLowerCase()];
  if (mapped && fs.existsSync(path.join(dir, mapped))) return path.join(dir, mapped);

  let exes = [];
  try { exes = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.exe')); } catch {}

  const play = exes.find(f => /^play.*\.exe$/i.test(f)); // Rockstar launch stubs
  if (play) return path.join(dir, play);
  if (mapped) return path.join(dir, mapped);

  const bad = /(unins|setup|redist|vcredist|crashpad|dxsetup|service|helper|benchmark|config|report)/i;
  const candidate = exes.find(f => !bad.test(f));
  return candidate ? path.join(dir, candidate) : null;
}

async function scanRockstar() {
  const games = [];
  const base = 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games';
  const subkeys = parseRegSubkeys(await regQuery(base));
  for (const key of subkeys) {
    const name = key.split('\\').pop();
    if (ROCKSTAR_SKIP.has(name.toLowerCase())) continue;

    const v = parseRegValues(await regQuery(key));
    // a key with only InstallFolderSteam is a Steam-owned copy -> already listed by scanSteam
    if (!v.InstallFolder && v.InstallFolderSteam) continue;
    const dir = v.InstallFolder;
    if (!dir) continue;

    const exe = findRockstarExe(dir, name);
    games.push({
      id: 'rockstar-' + name.replace(/\s+/g, '_'),
      name,
      platform: 'Rockstar',
      installDir: dir,
      cover: null,
      launch: exe ? { type: 'exe', value: exe, cwd: dir } : { type: 'uri', value: 'rockstar://' }
    });
  }
  return games;
}

// ---------- aggregate ----------
async function scanAll() {
  const results = await Promise.allSettled([
    scanSteam(), scanEpic(), scanGOG(), scanUbisoft(), scanEA(), scanBattleNet(), scanRiot(), scanRockstar()
  ]);
  const all = [];
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);

  const map = new Map();
  for (const g of all) if (!map.has(g.id)) map.set(g.id, g);
  return [...map.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

module.exports = { scanAll };
