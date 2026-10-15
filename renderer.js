const PLATFORM_COLORS = {
  'Steam': '#1b9fe0',
  'Epic Games': '#2a2a2a',
  'GOG': '#9b4dff',
  'Ubisoft': '#0f8fe0',
  'EA': '#ff4747',
  'Battle.net': '#148eff',
  'Riot': '#d13639',
  'Rockstar': '#fcaf17'
};

let allGames = [];
let cfg = { favorites: [], hidden: [], cache: [] };
let activePlatform = 'All';
let mode = 'installed';           // 'installed' | 'all'
let steamPrivate = false;
let steamNoKey = false;

const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const searchEl = document.getElementById('search');
const favOnlyEl = document.getElementById('favOnly');
const showHiddenEl = document.getElementById('showHidden');
const filtersEl = document.getElementById('filters');
const hintEl = document.getElementById('hint');

const isInstalled = (g) => g.installed !== false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}

function gradientFor(name) {
  const h = hashHue(name);
  return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 60% 20%))`;
}

function isFav(id) { return cfg.favorites.includes(id); }
function isHidden(id) { return cfg.hidden.includes(id); }

async function persist() { await window.omni.setConfig(cfg); }

// games visible in the current mode (before search/platform/fav filters)
function modeGames() {
  return mode === 'all' ? allGames : allGames.filter(isInstalled);
}

function buildFilters() {
  const base = modeGames();
  const platforms = ['All', ...Array.from(new Set(base.map(g => g.platform))).sort()];
  filtersEl.innerHTML = '';
  for (const p of platforms) {
    const count = p === 'All' ? base.length : base.filter(g => g.platform === p).length;
    const chip = document.createElement('div');
    chip.className = 'chip' + (p === activePlatform ? ' active' : '');
    chip.textContent = p === 'All' ? `All (${count})` : `${p} (${count})`;
    if (p !== 'All') chip.style.background = p === activePlatform ? PLATFORM_COLORS[p] : '';
    chip.onclick = () => { activePlatform = p; buildFilters(); render(); };
    filtersEl.appendChild(chip);
  }
}

function visibleGames() {
  const q = searchEl.value.trim().toLowerCase();
  return modeGames().filter(g => {
    if (activePlatform !== 'All' && g.platform !== activePlatform) return false;
    if (favOnlyEl.checked && !isFav(g.id)) return false;
    if (!showHiddenEl.checked && isHidden(g.id)) return false;
    if (q && !(g.name || '').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => {
    const fa = isFav(a.id), fb = isFav(b.id);
    if (fa !== fb) return fa ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function fallbackTile(name) {
  const div = document.createElement('div');
  div.className = 'cover-fallback';
  div.style.background = gradientFor(name || '');
  div.textContent = name || '';
  return div;
}

// Cover resolution order:
//   1. native portrait box-art (Steam library capsule) -> fills
//   2. wide header letterboxed-centered -> no crop
//   3. SteamGridDB portrait (any platform, if a key is set) -> fills
//   4. generated title tile
// Built in JS so no inline handlers (blocked by the CSP) are needed.
function coverElement(g) {
  const img = document.createElement('img');
  img.className = 'cover';
  img.loading = 'lazy';

  const candidates = [];
  if (g.cover) candidates.push([g.cover, 'cover']);
  if (g.coverFallback) candidates.push([g.coverFallback, 'contain']);

  let idx = -1;
  let triedSGDB = false;

  const setSrc = (url, mode) => {
    img.classList.toggle('contain', mode === 'contain');
    img.src = url;
  };

  const next = async () => {
    idx++;
    if (idx < candidates.length) { setSrc(candidates[idx][0], candidates[idx][1]); return; }
    if (!triedSGDB) {
      triedSGDB = true;
      const url = await window.omni.resolveCover(g);
      if (url) { setSrc(url, 'cover'); return; }
    }
    img.replaceWith(fallbackTile(g.name));
  };

  img.addEventListener('error', next);
  next();
  return img;
}

function makeCard(g) {
  const installed = isInstalled(g);
  const card = document.createElement('div');
  card.className = 'card' + (isHidden(g.id) ? ' is-hidden' : '') + (installed ? '' : ' not-installed');

  const badge = `<span class="badge" style="background:${PLATFORM_COLORS[g.platform] || '#444'}">${esc(g.platform)}</span>`;
  const installTag = installed ? '' : '<span class="install-tag">⤓ INSTALL</span>';

  card.innerHTML = `
    ${badge}
    ${installTag}
    <div class="star${isFav(g.id) ? ' on' : ''}">${isFav(g.id) ? '★' : '☆'}</div>
    <div class="hidebtn">${isHidden(g.id) ? 'unhide' : 'hide'}</div>
    <div class="meta">
      <div class="title">${esc(g.name)}</div>
      <div class="plat">${installed ? esc(g.platform) : 'Not installed · click to install'}</div>
    </div>`;

  card.insertBefore(coverElement(g), card.firstChild);

  card.querySelector('.star').onclick = async (e) => {
    e.stopPropagation();
    if (isFav(g.id)) cfg.favorites = cfg.favorites.filter(x => x !== g.id);
    else cfg.favorites.push(g.id);
    await persist();
    render();
  };

  card.querySelector('.hidebtn').onclick = async (e) => {
    e.stopPropagation();
    if (isHidden(g.id)) cfg.hidden = cfg.hidden.filter(x => x !== g.id);
    else cfg.hidden.push(g.id);
    await persist();
    render();
  };

  card.onclick = async () => {
    const installing = !isInstalled(g);
    statusEl.textContent = (installing ? `Opening install for ${g.name}…` : `Launching ${g.name}…`);
    const r = await window.omni.launch(g);
    statusEl.textContent = r.ok
      ? (installing ? `Install dialog opened for ${g.name}` : `Launched ${g.name}`)
      : `Failed: ${r.error}`;
  };

  // right-click opens the install folder when known
  card.oncontextmenu = (e) => {
    e.preventDefault();
    if (g.installDir) window.omni.openDir(g.installDir);
  };

  return card;
}

function updateHint() {
  if (mode === 'all' && steamNoKey) {
    hintEl.innerHTML =
      'To list Steam games you own but haven\'t installed, add a free Steam Web API key in ' +
      '<a id="hintSettings">⚙ Settings</a>.';
    hintEl.classList.remove('hidden');
    const s = document.getElementById('hintSettings');
    if (s) s.onclick = openSettings;
  } else if (mode === 'all' && steamPrivate) {
    hintEl.innerHTML =
      'Steam returned no library — set <b>Steam → Settings → Privacy → Game details</b> to ' +
      '<b>Public</b>, then <a id="hintRescan">rescan</a>.';
    hintEl.classList.remove('hidden');
    const r = document.getElementById('hintRescan');
    if (r) r.onclick = doScan;
  } else {
    hintEl.classList.add('hidden');
  }
}

function render() {
  updateHint();
  const games = visibleGames();
  grid.innerHTML = '';
  for (const g of games) grid.appendChild(makeCard(g));

  const installedCount = allGames.filter(isInstalled).length;
  const notInstalled = allGames.length - installedCount;
  const launchers = new Set(allGames.map(g => g.platform)).size;
  statusEl.textContent = mode === 'all'
    ? `${games.length} shown · ${installedCount} installed + ${notInstalled} not installed · ${launchers} launchers`
    : `${games.length} shown · ${installedCount} installed · ${launchers} launchers`;
}

async function doScan() {
  statusEl.textContent = 'Scanning your launchers…';
  const res = await window.omni.scan();
  allGames = res.games || [];
  steamPrivate = !!res.steamLibraryPrivate;
  steamNoKey = !!res.steamNoKey;
  buildFilters();
  render();
}

async function init() {
  cfg = await window.omni.getConfig();
  if (!cfg.favorites) cfg.favorites = [];
  if (!cfg.hidden) cfg.hidden = [];

  // paint cached games immediately, then rescan in the background
  if (Array.isArray(cfg.cache) && cfg.cache.length) {
    allGames = cfg.cache;
    buildFilters();
    render();
  }
  doScan();

  searchEl.oninput = render;
  favOnlyEl.onchange = render;
  showHiddenEl.onchange = render;
  document.getElementById('rescan').onclick = doScan;

  document.querySelectorAll('#modeToggle .seg-btn').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      document.querySelectorAll('#modeToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      activePlatform = 'All';
      buildFilters();
      render();
    };
  });

  // settings panel
  const modal = document.getElementById('settings');
  const keyInput = document.getElementById('sgdbKey');
  const steamKeyInput = document.getElementById('steamKey');
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('closeSettings').onclick = () => modal.classList.add('hidden');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  document.getElementById('getKey').onclick = () =>
    window.omni.openUrl('https://www.steamgriddb.com/profile/preferences/api');
  document.getElementById('getSteamKey').onclick = () =>
    window.omni.openUrl('https://steamcommunity.com/dev/apikey');
  document.getElementById('refetch').onclick = async () => {
    await window.omni.clearArtCache();
    render();
  };
  document.getElementById('saveKey').onclick = async () => {
    await window.omni.setArtKey(keyInput.value);
    await window.omni.setSteamKey(steamKeyInput.value);
    modal.classList.add('hidden');
    doScan(); // re-resolve art + refetch owned Steam library with the new keys
  };
}

async function openSettings() {
  const modal = document.getElementById('settings');
  document.getElementById('sgdbKey').value = await window.omni.getArtKey();
  document.getElementById('steamKey').value = await window.omni.getSteamKey();
  modal.classList.remove('hidden');
  document.getElementById('sgdbKey').focus();
}

init();
