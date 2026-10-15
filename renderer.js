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
let cfg = { favorites: [], hidden: [], cache: [], launches: {}, lastLaunched: {} };
let mode = 'installed';           // 'installed' | 'all'
let activePlatform = 'All';
let selected = null;              // selected game id, or null for Home dashboard
let steamPrivate = false;
let steamNoKey = false;

const statusEl = document.getElementById('status');
const searchEl = document.getElementById('search');
const favOnlyEl = document.getElementById('favOnly');
const showHiddenEl = document.getElementById('showHidden');
const sideFiltersEl = document.getElementById('sideFilters');
const gameListEl = document.getElementById('gameList');
const contentEl = document.getElementById('content');
const hintEl = document.getElementById('hint');
const homeBtn = document.getElementById('homeBtn');

/* ---------- helpers ---------- */
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
  const h = hashHue(name || '');
  return `linear-gradient(145deg, hsl(${h} 55% 32%), hsl(${(h + 40) % 360} 60% 20%))`;
}
const isFav = (id) => cfg.favorites.includes(id);
const isHidden = (id) => cfg.hidden.includes(id);
const isInstalled = (g) => g.installed !== false;
const launchCount = (id) => (cfg.launches && cfg.launches[id]) || 0;

async function persist() {
  await window.panda.setConfig({ favorites: cfg.favorites, hidden: cfg.hidden });
}

function fmtPlaytime(min) {
  if (!min) return '—';
  if (min < 60) return min + ' min';
  const h = min / 60;
  return (h < 100 ? h.toFixed(1) : Math.round(h)) + ' hours';
}
function fmtDate(sec) {
  if (!sec) return 'Never';
  const d = new Date(sec * 1000);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return days + ' days ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
// unified "last activity" ms: Steam last-played or local launch timestamp
function lastActivity(g) {
  const steam = g.lastPlayed ? g.lastPlayed * 1000 : 0;
  const local = (cfg.lastLaunched && cfg.lastLaunched[g.id]) || 0;
  return Math.max(steam, local);
}

/* ---------- art elements ---------- */
function thumbEl(g, cls) {
  const candidates = [];
  if (g.cover) candidates.push(g.cover);
  if (g.coverFallback) candidates.push(g.coverFallback);
  const img = document.createElement('img');
  img.className = cls;
  img.loading = 'lazy';
  let i = -1, triedSGDB = false;
  const next = async () => {
    i++;
    if (i < candidates.length) { img.src = candidates[i]; return; }
    if (!triedSGDB) {
      triedSGDB = true;
      const u = await window.panda.resolveCover(g);
      if (u) { img.src = u; return; }
    }
    const d = document.createElement('div');
    d.className = cls + ' fallback';
    d.style.background = gradientFor(g.name);
    d.textContent = (g.name || '?').trim().charAt(0).toUpperCase();
    img.replaceWith(d);
  };
  img.addEventListener('error', next);
  next();
  return img;
}

function heroEl(g) {
  const wrap = document.createElement('div');
  wrap.className = 'hero';

  const addTitle = () => {
    const t = document.createElement('div');
    t.className = 'hero-title';
    t.textContent = g.name;
    wrap.appendChild(t);
  };

  if (g.appid) {
    const srcs = [
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/library_hero.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`
    ];
    const bg = document.createElement('img');
    bg.className = 'hero-bg';
    let i = 0;
    bg.addEventListener('error', () => {
      if (i < srcs.length) { bg.src = srcs[i++]; }
      else { bg.remove(); wrap.style.background = gradientFor(g.name); }
    });
    bg.src = srcs[i++];
    wrap.appendChild(bg);

    const logo = document.createElement('img');
    logo.className = 'hero-logo';
    logo.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/logo.png`;
    logo.addEventListener('error', () => { logo.remove(); addTitle(); });
    wrap.appendChild(logo);
  } else {
    wrap.style.background = gradientFor(g.name);
    if (g.cover) {
      const bg = document.createElement('img');
      bg.className = 'hero-bg blur';
      bg.src = g.cover;
      bg.addEventListener('error', () => bg.remove());
      wrap.appendChild(bg);
    }
    addTitle();
  }
  return wrap;
}

/* ---------- list / filters ---------- */
function modeGames() {
  return mode === 'all' ? allGames : allGames.filter(isInstalled);
}
function filteredList() {
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

function buildSideFilters() {
  const base = modeGames();
  const platforms = ['All', ...Array.from(new Set(base.map(g => g.platform))).sort()];
  sideFiltersEl.innerHTML = '';
  for (const p of platforms) {
    const count = p === 'All' ? base.length : base.filter(g => g.platform === p).length;
    const chip = document.createElement('div');
    chip.className = 'chip' + (p === activePlatform ? ' active' : '');
    chip.textContent = p === 'All' ? `All ${count}` : `${p} ${count}`;
    if (p !== 'All' && p === activePlatform) chip.style.background = PLATFORM_COLORS[p] || '';
    chip.onclick = () => { activePlatform = p; buildSideFilters(); renderSidebar(); };
    sideFiltersEl.appendChild(chip);
  }
}

function renderSidebar() {
  const games = filteredList();
  gameListEl.innerHTML = '';
  for (const g of games) {
    const li = document.createElement('div');
    li.className = 'li' + (g.id === selected ? ' active' : '') + (isInstalled(g) ? '' : ' not-installed');
    li.appendChild(thumbEl(g, 'li-thumb'));
    const name = document.createElement('div');
    name.className = 'li-name';
    name.textContent = g.name;
    li.appendChild(name);
    if (isFav(g.id)) {
      const s = document.createElement('span');
      s.className = 'li-star';
      s.textContent = '★';
      li.appendChild(s);
    }
    li.onclick = () => select(g.id);
    gameListEl.appendChild(li);
  }
  homeBtn.classList.toggle('active', selected === null);
}

/* ---------- content: dashboard or detail ---------- */
function gameById(id) { return allGames.find(g => g.id === id); }

function select(id) {
  selected = id;
  renderSidebar();
  renderContent();
}

function renderContent() {
  if (selected && gameById(selected)) renderDetail(gameById(selected));
  else { selected = null; renderDashboard(); }
}

function statRow(label, value) {
  return `<div class="stat"><label>${label}</label><span>${esc(value)}</span></div>`;
}

async function launchGame(g) {
  const installing = !isInstalled(g);
  statusEl.textContent = installing ? `Opening install for ${g.name}…` : `Launching ${g.name}…`;
  const r = await window.panda.launch(g);
  if (r.ok && !installing) {
    cfg = await window.panda.getConfig();          // refresh launch counters
    if (selected === g.id) renderDetail(g);
  }
  statusEl.textContent = r.ok
    ? (installing ? `Install dialog opened for ${g.name}` : `Launched ${g.name}`)
    : `Failed: ${r.error}`;
}

function renderDetail(g) {
  const installed = isInstalled(g);
  contentEl.innerHTML = '';
  contentEl.scrollTop = 0;
  contentEl.appendChild(heroEl(g));

  const bar = document.createElement('div');
  bar.className = 'detail-bar';
  const playLabel = installed ? '▶  PLAY' : '⤓  INSTALL';
  bar.innerHTML = `
    <button class="play-btn${installed ? '' : ' install'}">${playLabel}</button>
    ${statRow('LAST PLAYED', installed ? fmtDate(Math.floor(lastActivity(g) / 1000)) : 'Not installed')}
    ${statRow('PLAY TIME', fmtPlaytime(g.playtimeForever))}
    ${statRow('LAUNCHES', String(launchCount(g.id)))}
    ${statRow('PLATFORM', g.platform)}
    <div class="detail-actions">
      <button class="icon-btn fav${isFav(g.id) ? ' on' : ''}" title="Favorite">${isFav(g.id) ? '★' : '☆'}</button>
      <button class="icon-btn hide" title="${isHidden(g.id) ? 'Unhide' : 'Hide'}">${isHidden(g.id) ? '◎' : '⦸'}</button>
      ${g.installDir ? '<button class="icon-btn folder" title="Open install folder">⌸</button>' : ''}
    </div>`;
  contentEl.appendChild(bar);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const rows = [];
  rows.push(['Platform', g.platform]);
  if (g.playtime2weeks) rows.push(['Past 2 weeks', fmtPlaytime(g.playtime2weeks)]);
  rows.push(['Launches via Panda', String(launchCount(g.id))]);
  if (g.appid) rows.push(['Steam AppID', g.appid]);
  if (g.installDir) rows.push(['Install folder', g.installDir]);
  if (!installed) rows.push(['Status', 'Owned — not installed']);
  body.innerHTML = rows.map(([k, v]) => `<div class="row"><label>${esc(k)}</label><span>${esc(v)}</span></div>`).join('');
  contentEl.appendChild(body);

  bar.querySelector('.play-btn').onclick = () => launchGame(g);
  bar.querySelector('.fav').onclick = async () => {
    if (isFav(g.id)) cfg.favorites = cfg.favorites.filter(x => x !== g.id);
    else cfg.favorites.push(g.id);
    await persist(); renderDetail(g); renderSidebar();
  };
  bar.querySelector('.hide').onclick = async () => {
    if (isHidden(g.id)) cfg.hidden = cfg.hidden.filter(x => x !== g.id);
    else cfg.hidden.push(g.id);
    await persist(); renderSidebar();
  };
  const folder = bar.querySelector('.folder');
  if (folder) folder.onclick = () => window.panda.openDir(g.installDir);
}

function renderDashboard() {
  contentEl.scrollTop = 0;
  const games = allGames;
  const totalPlaytime = games.reduce((s, g) => s + (g.playtimeForever || 0), 0);
  const mostPlayed = games.filter(g => g.playtimeForever > 0).sort((a, b) => b.playtimeForever - a.playtimeForever)[0];
  const totalLaunches = Object.values(cfg.launches || {}).reduce((s, n) => s + n, 0);
  const installedCount = games.filter(isInstalled).length;
  const launchers = new Set(games.map(g => g.platform)).size;

  const recent = games
    .map(g => ({ g, t: lastActivity(g) }))
    .filter(x => x.t > 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, 6);

  const topPlayed = games.filter(g => g.playtimeForever > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, 6);
  const maxPt = topPlayed.length ? topPlayed[0].playtimeForever : 1;

  const wrap = document.createElement('div');
  wrap.className = 'dash';
  wrap.innerHTML = `
    <h1>Your Library</h1>
    <div class="sub">${installedCount} installed · ${games.length} total across ${launchers} launchers</div>
    <div class="stat-cards">
      <div class="stat-card"><div class="k">Total playtime</div><div class="v">${esc(fmtPlaytime(totalPlaytime))}</div><div class="vsub">tracked across Steam</div></div>
      <div class="stat-card"><div class="k">Most played</div><div class="v" style="font-size:19px">${mostPlayed ? esc(mostPlayed.name) : '—'}</div><div class="vsub">${mostPlayed ? esc(fmtPlaytime(mostPlayed.playtimeForever)) : ''}</div></div>
      <div class="stat-card"><div class="k">Total launches</div><div class="v">${totalLaunches}</div><div class="vsub">via Panda</div></div>
      <div class="stat-card"><div class="k">Games</div><div class="v">${games.length}</div><div class="vsub">${installedCount} installed</div></div>
      <div class="stat-card"><div class="k">Launchers</div><div class="v">${launchers}</div><div class="vsub">connected</div></div>
    </div>
    <section id="recentSec"></section>
    <section id="topSec"></section>`;
  contentEl.innerHTML = '';
  contentEl.appendChild(wrap);

  const recentSec = wrap.querySelector('#recentSec');
  if (recent.length) {
    recentSec.innerHTML = '<h2>Recently played</h2>';
    const list = document.createElement('div');
    list.className = 'rowlist';
    for (const { g, t } of recent) {
      const it = document.createElement('div');
      it.className = 'rowitem';
      it.appendChild(thumbEl(g, 'rthumb'));
      const nm = document.createElement('div'); nm.className = 'rname'; nm.textContent = g.name;
      const mt = document.createElement('div'); mt.className = 'rmeta'; mt.textContent = fmtDate(Math.floor(t / 1000));
      it.appendChild(nm); it.appendChild(mt);
      it.onclick = () => select(g.id);
      list.appendChild(it);
    }
    recentSec.appendChild(list);
  }

  const topSec = wrap.querySelector('#topSec');
  if (topPlayed.length) {
    topSec.innerHTML = '<h2>Most played</h2>';
    const list = document.createElement('div');
    list.className = 'rowlist';
    for (const g of topPlayed) {
      const it = document.createElement('div');
      it.className = 'rowitem';
      it.appendChild(thumbEl(g, 'rthumb'));
      const nm = document.createElement('div'); nm.className = 'rname'; nm.textContent = g.name;
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.max(4, (g.playtimeForever / maxPt) * 100) + '%';
      bar.appendChild(fill);
      const mt = document.createElement('div'); mt.className = 'rmeta'; mt.textContent = fmtPlaytime(g.playtimeForever);
      it.appendChild(nm); it.appendChild(bar); it.appendChild(mt);
      it.onclick = () => select(g.id);
      list.appendChild(it);
    }
    topSec.appendChild(list);
  }

  if (!recent.length && !topPlayed.length) {
    const note = document.createElement('div');
    note.className = 'empty';
    note.textContent = steamNoKey
      ? 'Add a Steam Web API key in ⚙ Settings to see playtime stats.'
      : 'Launch a game to start building your stats.';
    wrap.appendChild(note);
  }
}

/* ---------- hints / status ---------- */
function updateHint() {
  if (mode === 'all' && steamNoKey) {
    hintEl.innerHTML = 'To list Steam games you own but haven\'t installed, add a free Steam Web API key in <a id="hintSettings">⚙ Settings</a>.';
    hintEl.classList.remove('hidden');
    const s = document.getElementById('hintSettings');
    if (s) s.onclick = openSettings;
  } else if (mode === 'all' && steamPrivate) {
    hintEl.innerHTML = 'Steam returned no library — set <b>Steam → Settings → Privacy → Game details</b> to <b>Public</b>, then <a id="hintRescan">rescan</a>.';
    hintEl.classList.remove('hidden');
    const r = document.getElementById('hintRescan');
    if (r) r.onclick = doScan;
  } else {
    hintEl.classList.add('hidden');
  }
}

function renderAll() {
  updateHint();
  buildSideFilters();
  renderSidebar();
  renderContent();
  const installedCount = allGames.filter(isInstalled).length;
  statusEl.textContent = mode === 'all'
    ? `${allGames.length} games · ${installedCount} installed · ${new Set(allGames.map(g => g.platform)).size} launchers`
    : `${installedCount} installed · ${new Set(allGames.map(g => g.platform)).size} launchers`;
}

async function doScan() {
  statusEl.textContent = 'Scanning your launchers…';
  const res = await window.panda.scan();
  allGames = res.games || [];
  steamPrivate = !!res.steamLibraryPrivate;
  steamNoKey = !!res.steamNoKey;
  if (selected && !gameById(selected)) selected = null;
  renderAll();
}

/* ---------- settings ---------- */
async function openSettings() {
  const modal = document.getElementById('settings');
  document.getElementById('sgdbKey').value = await window.panda.getArtKey();
  document.getElementById('steamKey').value = await window.panda.getSteamKey();
  modal.classList.remove('hidden');
  document.getElementById('sgdbKey').focus();
}

/* ---------- init ---------- */
async function init() {
  cfg = await window.panda.getConfig();
  cfg.favorites = cfg.favorites || [];
  cfg.hidden = cfg.hidden || [];
  cfg.launches = cfg.launches || {};
  cfg.lastLaunched = cfg.lastLaunched || {};

  if (Array.isArray(cfg.cache) && cfg.cache.length) {
    allGames = cfg.cache;
    renderAll();
  }
  doScan();

  searchEl.oninput = renderSidebar;
  favOnlyEl.onchange = () => { buildSideFilters(); renderSidebar(); };
  showHiddenEl.onchange = () => { buildSideFilters(); renderSidebar(); };
  document.getElementById('rescan').onclick = doScan;
  homeBtn.onclick = () => { selected = null; renderSidebar(); renderContent(); };

  document.querySelectorAll('#modeToggle .seg-btn').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      document.querySelectorAll('#modeToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      activePlatform = 'All';
      renderAll();
    };
  });

  const modal = document.getElementById('settings');
  const keyInput = document.getElementById('sgdbKey');
  const steamKeyInput = document.getElementById('steamKey');
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('closeSettings').onclick = () => modal.classList.add('hidden');
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
  document.getElementById('getKey').onclick = () => window.panda.openUrl('https://www.steamgriddb.com/profile/preferences/api');
  document.getElementById('getSteamKey').onclick = () => window.panda.openUrl('https://steamcommunity.com/dev/apikey');
  document.getElementById('refetch').onclick = async () => { await window.panda.clearArtCache(); renderAll(); };
  document.getElementById('saveKey').onclick = async () => {
    await window.panda.setArtKey(keyInput.value);
    await window.panda.setSteamKey(steamKeyInput.value);
    modal.classList.add('hidden');
    doScan();
  };
}

init();
