const PLATFORM_COLORS = {
  'Steam': '#1b9fe0',
  'Epic Games': '#2a2a2a',
  'GOG': '#9b4dff',
  'Ubisoft': '#0f8fe0',
  'EA': '#ff4747',
  'Battle.net': '#148eff',
  'Riot': '#d13639'
};

let allGames = [];
let cfg = { favorites: [], hidden: [], cache: [] };
let activePlatform = 'All';

const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const searchEl = document.getElementById('search');
const favOnlyEl = document.getElementById('favOnly');
const showHiddenEl = document.getElementById('showHidden');
const filtersEl = document.getElementById('filters');

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

function buildFilters() {
  const platforms = ['All', ...Array.from(new Set(allGames.map(g => g.platform))).sort()];
  filtersEl.innerHTML = '';
  for (const p of platforms) {
    const count = p === 'All' ? allGames.length : allGames.filter(g => g.platform === p).length;
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
  return allGames.filter(g => {
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
  const card = document.createElement('div');
  card.className = 'card' + (isHidden(g.id) ? ' is-hidden' : '');

  const badge = `<span class="badge" style="background:${PLATFORM_COLORS[g.platform] || '#444'}">${esc(g.platform)}</span>`;

  card.innerHTML = `
    ${badge}
    <div class="star${isFav(g.id) ? ' on' : ''}">${isFav(g.id) ? '★' : '☆'}</div>
    <div class="hidebtn">${isHidden(g.id) ? 'unhide' : 'hide'}</div>
    <div class="meta">
      <div class="title">${esc(g.name)}</div>
      <div class="plat">${esc(g.platform)}</div>
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
    statusEl.textContent = `Launching ${g.name}…`;
    const r = await window.omni.launch(g);
    statusEl.textContent = r.ok ? `Launched ${g.name}` : `Failed: ${r.error}`;
  };

  // right-click opens the install folder when known
  card.oncontextmenu = (e) => {
    e.preventDefault();
    if (g.installDir) window.omni.openDir(g.installDir);
  };

  return card;
}

function render() {
  const games = visibleGames();
  grid.innerHTML = '';
  for (const g of games) grid.appendChild(makeCard(g));
  const total = allGames.length;
  const hiddenCount = allGames.filter(g => isHidden(g.id)).length;
  statusEl.textContent = `${games.length} shown · ${total} total across ${new Set(allGames.map(g => g.platform)).size} launchers · ${hiddenCount} hidden`;
}

async function doScan() {
  statusEl.textContent = 'Scanning your launchers…';
  allGames = await window.omni.scan();
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

  // settings / cover-art panel
  const modal = document.getElementById('settings');
  const keyInput = document.getElementById('sgdbKey');
  document.getElementById('settingsBtn').onclick = async () => {
    keyInput.value = await window.omni.getArtKey();
    modal.classList.remove('hidden');
    keyInput.focus();
  };
  document.getElementById('closeSettings').onclick = () => modal.classList.add('hidden');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  document.getElementById('getKey').onclick = () =>
    window.omni.openUrl('https://www.steamgriddb.com/profile/preferences/api');
  document.getElementById('refetch').onclick = async () => {
    await window.omni.clearArtCache();
    render();
  };
  document.getElementById('saveKey').onclick = async () => {
    await window.omni.setArtKey(keyInput.value);
    modal.classList.add('hidden');
    render(); // missing covers now resolve through SteamGridDB
  };
}

init();
