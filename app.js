/* ================= INJ PORTFOLIO • app.js =================
   - Per-address persistence (stake / rewards / net worth / events)
   - Net Worth: LIVE (2 min scrolling window) + fixed TF (1D/1W/1M/1Y/ALL) unlock as data grows
   - Horizontal pan/zoom on all charts (when plugin available)
   - Expand button inside each chart card -> fullscreen interactive view
   - Pull-to-refresh on mobile (top spinner)
   - Event page (not “coming soon”): table of detected events (stake/reward/price)
   - Validator mini-card under Net Worth: shows validator + status dot (green/amber/red)
============================================================= */

/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;

/* persistence versions */
const STAKE_LOCAL_VER = 2;
const REWARD_WD_LOCAL_VER = 2;
const NW_LOCAL_VER = 2;       // bumped (added LIVE + unlock + scale pref)
const EVENTS_LOCAL_VER = 1;

/* NET WORTH density + live window */
const NW_MAX_POINTS = 8000;
const NW_POINT_MIN_MS = 5_000;
const NW_POINT_MIN_USD_DELTA = 0.25;
const NW_LIVE_WINDOW_MS = 2 * 60 * 1000; // ✅ LIVE window = 2 minutes

/* REFRESH mode staging */
const REFRESH_RED_MS = 220;

/* External assets */
const INJ_LOGO_PNG =
  "https://upload.wikimedia.org/wikipedia/commons/3/3d/Injective_l.png";

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtDateShort(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}
function nowLabel() { return new Date().toLocaleTimeString(); }

function shortAddr(a) {
  const s = String(a || "").trim();
  return s.length > 18 ? (s.slice(0, 10) + "…" + s.slice(-6)) : s;
}
function normalizeAddr(a) {
  const s = String(a || "").trim();
  if (!/^inj[a-z0-9]{20,80}$/i.test(s)) return "";
  return s;
}
function setText(idOrEl, txt) {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (el) el.textContent = txt;
}
function setHTML(idOrEl, html) {
  const el = typeof idOrEl === "string" ? $(idOrEl) : idOrEl;
  if (el) el.innerHTML = html;
}

function fmtSmart(v) {
  v = safe(v);
  const av = Math.abs(v);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 100) return v.toFixed(1);
  if (av >= 10) return v.toFixed(2);
  if (av >= 1) return v.toFixed(3);
  if (av >= 0.1) return v.toFixed(4);
  return v.toFixed(6);
}

/* ================= DIGIT COLOR ANIMATION ================= */
function baseDigitColor() {
  return (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
}
function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  const baseCol = baseDigitColor();
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i]
      ? (n > o ? "#22c55e" : "#ef4444")
      : baseCol;
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

function colorMoney(el, n, o, decimals = 2) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(decimals);
  const os = o.toFixed(decimals);
  if (ns === os) { el.textContent = `$${ns}`; return; }

  const baseCol = baseDigitColor();
  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dir = (n > o) ? "up" : "down";

  const out = [`<span style="color:${baseCol}">$</span>`];
  for (let i = 0; i < ns.length; i++) {
    const c = ns[i];
    const oc = os[i];
    const col = (c !== oc) ? (dir === "up" ? upCol : dnCol) : baseCol;
    out.push(`<span style="color:${col}">${c}</span>`);
  }
  el.innerHTML = out.join("");
}

/* ================= GLOBAL ERROR GUARDS ================= */
function statusEls() {
  const dot =
    $("statusDot") ||
    q(".status-dot") ||
    q(".status-pill .dot") ||
    q("#connectionStatus .status-dot") ||
    null;

  const txt =
    $("statusText") ||
    q(".status-text") ||
    q(".status-pill .txt") ||
    q("#connectionStatus .status-text") ||
    null;

  return { dot, txt };
}

function setStatusError(msg) {
  const { dot, txt } = statusEls();
  if (txt) txt.textContent = msg || "Error";
  if (dot) dot.style.background = "#ef4444";
}

window.addEventListener("error", (e) => {
  setStatusError("JS Error");
  console.error("JS Error:", e?.error || e);
});

window.addEventListener("unhandledrejection", (e) => {
  setStatusError("Promise Error");
  console.error("Promise Error:", e?.reason || e);
});

/* ================= THEME / MODE (storage) ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY = "inj_mode"; // live | refresh

let theme = localStorage.getItem(THEME_KEY) || "dark";
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";

/* axis colors for charts */
function axisGridColor() {
  return (document.body.dataset.theme === "light")
    ? "rgba(15,23,42,.14)"
    : "rgba(249,250,251,.10)";
}
function axisTickColor() {
  return (document.body.dataset.theme === "light")
    ? "rgba(15,23,42,.65)"
    : "rgba(249,250,251,.60)";
}

function applyTheme(t) {
  theme = (t === "light") ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const themeIcon = $("themeIcon") || q("#themeToggle span");
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";

  refreshChartsTheme();
}
applyTheme(theme);

/* ================= Chart.js Zoom register (safe) ================= */
let ZOOM_OK = false;
function tryRegisterZoom() {
  try {
    if (!window.Chart) return false;
    const plug = window.ChartZoom || window["chartjs-plugin-zoom"];
    if (plug) Chart.register(plug);
    const has = !!(Chart?.registry?.plugins?.get && Chart.registry.plugins.get("zoom"));
    return has;
  } catch (e) {
    console.warn("Zoom plugin not available:", e);
    return false;
  }
}
ZOOM_OK = tryRegisterZoom();

/* ================= CLOUD (local-only counter) ================= */
const CLOUD_VER = 1;
const CLOUD_KEY = `inj_cloud_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;

function cloudLoad() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    cloudPts = safe(obj?.pts);
    cloudLastSync = safe(obj?.lastSync);
  } catch {}
}
function cloudSave() {
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({
      v: CLOUD_VER,
      pts: cloudPts,
      lastSync: cloudLastSync
    }));
    return true;
  } catch {
    return false;
  }
}
function cloudRender() {
  const cloudStatus = $("cloudStatus");
  const cloudHistory = $("cloudHistory");
  const drawerCloud = $("drawerCloud") || q("[data-drawer-cloud]");
  if (cloudHistory) cloudHistory.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;
  if (drawerCloud) drawerCloud.textContent = `Cloud Sync · ${Math.max(0, Math.floor(cloudPts))} pts`;
  if (cloudStatus) cloudStatus.textContent = hasInternet() ? "Cloud: Synced" : "Cloud: Offline cache";
}
function cloudBump(points = 1) {
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();
  cloudSave();
  cloudRender();
}

/* ================= CONNECTION UI ================= */
let settleStart = Date.now();
let refreshLoaded = false;
let refreshLoading = false;
let modeLoading = false;

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

function hasInternet() { return navigator.onLine === true; }

function liveReady() {
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline;
  return socketsOk && accountOk;
}

function refreshConnUI() {
  const { dot, txt } = statusEls();
  if (!dot || !txt) return;

  if (!hasInternet()) {
    txt.textContent = "Offline";
    dot.style.background = "#ef4444";
    return;
  }

  const loadingNow =
    modeLoading ||
    refreshLoading ||
    (!liveMode && !refreshLoaded) ||
    (liveMode && !liveReady());

  if (loadingNow) {
    txt.textContent = "Loading...";
    dot.style.background = "#f59e0b";
    return;
  }

  txt.textContent = "Online";
  dot.style.background = "#22c55e";
}

function setUIReady(force = false) {
  const root = $("appRoot");
  if (!root) return;
  if (root.classList.contains("ready")) return;
  if (!force && !tfReady.d) return;
  root.classList.remove("loading");
  root.classList.add("ready");
}

/* ================= SAFE FETCH ================= */
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

/* ================= SMOOTH DISPLAY ================= */
function scrollSpeed() {
  const t = Math.min((Date.now() - settleStart) / INITIAL_SETTLE_TIME, 1);
  const base = 0.08;
  const maxExtra = 0.80;
  return base + (t * t) * maxExtra;
}
function tick(cur, tgt) {
  if (!Number.isFinite(tgt)) return cur;
  return cur + (tgt - cur) * scrollSpeed();
}

/* ================= PERF ================= */
function pctChange(price, open) {
  const p = safe(price), o = safe(open);
  if (!o) return 0;
  const v = ((p - o) / o) * 100;
  return Number.isFinite(v) ? v : 0;
}
function updatePerf(arrowId, pctId, v) {
  const arrow = $(arrowId) || q(`#${arrowId}`) || null;
  const pct = $(pctId) || q(`#${pctId}`) || null;
  if (!arrow || !pct) return;

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= BAR RENDER (INJ price bars) ================= */
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
  if (!bar || !line) return;

  open = safe(open); low = safe(low); high = safe(high); val = safe(val);

  if (!open || !Number.isFinite(low) || !Number.isFinite(high) || high === low) {
    line.style.left = "50%";
    bar.style.left = "50%";
    bar.style.width = "0%";
    bar.style.background = "rgba(255,255,255,0.10)";
    return;
  }

  const range = Math.max(Math.abs(high - open), Math.abs(open - low));
  const min = open - range;
  const max = open + range;

  const pos = clamp(((val - min) / (max - min)) * 100, 0, 100);
  const center = 50;

  line.style.left = pos + "%";

  if (val >= open) {
    bar.style.left = center + "%";
    bar.style.width = Math.max(0, pos - center) + "%";
    bar.style.background = gradUp;
  } else {
    bar.style.left = pos + "%";
    bar.style.width = Math.max(0, center - pos) + "%";
    bar.style.background = gradDown;
  }
}

/* ================= HEADER SEARCH UI ================= */
const searchWrap = $("searchWrap") || q(".search-wrap");
const searchBtn = $("searchBtn") || q("#searchBtn") || q(".search-wrap .icon-btn");
const addressInput = $("addressInput") || q("#addressInput");
const addressDisplay = $("addressDisplay") || q("#addressDisplay") || q(".address-display");
const menuBtn = $("menuBtn") || q("#menuBtn");
const modeHint = $("modeHint") || q("#modeHint");
const liveIcon = $("liveIcon") || q("#liveIcon");

let address = localStorage.getItem("inj_address") || "";
address = normalizeAddr(address) || "";
let pendingAddress = "";

function setAddressDisplay(addr) {
  if (!addressDisplay) return;
  if (!addr) { addressDisplay.innerHTML = ""; return; }
  addressDisplay.innerHTML = `<span class="tag"><strong>Wallet:</strong> ${shortAddr(addr)}</span>`;
}
setAddressDisplay(address);

function openSearch() {
  if (!searchWrap) return;
  searchWrap.classList.add("open");
  document.body.classList.add("search-open");
  setTimeout(() => addressInput?.focus(), 20);
}
function closeSearch() {
  if (!searchWrap) return;
  searchWrap.classList.remove("open");
  document.body.classList.remove("search-open");
  addressInput?.blur();
}

if (searchBtn) {
  searchBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!searchWrap?.classList.contains("open")) openSearch();
    else addressInput?.focus();
  }, { passive: false });
}

if (addressInput) {
  // ✅ after commit we keep displayed wallet, but input stays empty for next searches
  addressInput.value = "";

  addressInput.addEventListener("focus", () => openSearch(), { passive: true });

  addressInput.addEventListener("input", (e) => {
    pendingAddress = String(e.target.value || "").trim();
  }, { passive: true });

  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAddress(pendingAddress);
      closeSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      addressInput.value = "";
      pendingAddress = "";
      closeSearch();
    }
  });
}

document.addEventListener("click", (e) => {
  if (!searchWrap) return;
  if (searchWrap.contains(e.target)) return;
  closeSearch();
}, { passive: true });

/* ================= DRAWER MENU ================= */
const backdrop = $("backdrop");
const drawer = $("drawer");
const drawerNav = $("drawerNav");
const themeToggle = $("themeToggle");
const liveToggle = $("liveToggle");

let isDrawerOpen = false;

function openDrawer() {
  isDrawerOpen = true;
  document.body.classList.add("drawer-open");
  drawer?.setAttribute("aria-hidden", "false");
  backdrop?.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  isDrawerOpen = false;
  document.body.classList.remove("drawer-open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.setAttribute("aria-hidden", "true");
}
function toggleDrawer() { isDrawerOpen ? closeDrawer() : openDrawer(); }

menuBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleDrawer();
}, { passive: false });

backdrop?.addEventListener("click", () => closeDrawer(), { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

themeToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive: false });

/* ================= PAGES (Dashboard / Event) ================= */
const cardsWrapper = q(".cards-wrapper");
let eventView = $("eventView");

function ensureEventView() {
  if (eventView) return eventView;

  const root = $("appRoot") || q(".container");
  if (!root) return null;

  eventView = document.createElement("div");
  eventView.id = "eventView";
  eventView.style.display = "none";
  eventView.style.marginTop = "0.6rem";

  eventView.innerHTML = `
    <div class="card">
      <div class="label" style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;">
        <span>Events</span>
        <button id="eventClearBtn" class="mini-btn" type="button" style="height:28px;">CLEAR</button>
      </div>
      <div style="margin-top:.75rem; overflow:auto; -webkit-overflow-scrolling: touch;">
        <table id="eventTable" style="width:100%; border-collapse:collapse; min-width:520px;">
          <thead>
            <tr>
              <th style="text-align:left; font-size:.78rem; opacity:.75; padding:.45rem .35rem;">Event</th>
              <th style="text-align:left; font-size:.78rem; opacity:.75; padding:.45rem .35rem;">Date</th>
              <th style="text-align:right; font-size:.78rem; opacity:.75; padding:.45rem .35rem;">Move</th>
              <th style="text-align:right; font-size:.78rem; opacity:.75; padding:.45rem .35rem;">Status</th>
            </tr>
          </thead>
          <tbody id="eventTbody"></tbody>
        </table>
      </div>
      <div style="margin-top:.65rem; font-size:.78rem; opacity:.7;">
        Auto-detected from staking/rewards/price changes (per wallet).
      </div>
    </div>
  `;

  // place under header, above cards
  const header = q(".header", root);
  if (header && header.nextSibling) {
    header.parentNode.insertBefore(eventView, header.nextSibling);
  } else {
    root.appendChild(eventView);
  }

  $("eventClearBtn")?.addEventListener("click", () => {
    clearEvents();
    renderEventsTable();
  });

  return eventView;
}

function showPage(pageKey) {
  const ev = ensureEventView();

  // nav active
  const items = drawerNav?.querySelectorAll(".nav-item") || [];
  items.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageKey));

  if (pageKey === "event") {
    if (cardsWrapper) cardsWrapper.style.display = "none";
    if (ev) ev.style.display = "";
    closeDrawer();
    renderEventsTable();
    return;
  }

  // default dashboard
  if (ev) ev.style.display = "none";
  if (cardsWrapper) cardsWrapper.style.display = "";
  closeDrawer();
}

drawerNav?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".nav-item");
  if (!btn) return;
  const page = btn.dataset.page || "dashboard";

  // dashboard + event real pages, others fallback to coming soon overlay if exists
  if (page === "dashboard" || page === "event") {
    showPage(page);
    return;
  }

  // Coming soon overlay (if present)
  const comingSoon = $("comingSoon");
  const comingTitle = $("comingTitle");
  const comingSub = $("comingSub");

  if (comingSoon) {
    if (comingTitle) comingTitle.textContent = "COMING SOON 🚀";
    if (comingSub) comingSub.textContent = `${String(page).toUpperCase()} is coming soon.`;
    comingSoon.classList.add("show");
    comingSoon.setAttribute("aria-hidden", "false");
  }
  closeDrawer();
}, { passive: true });

/* ================= MODE SWITCH ================= */
let accountPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;

function stopAllTimers() {
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
}
function startAllTimers() {
  stopAllTimers();
  accountPollTimer = setInterval(loadAccount, ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(loadCandleSnapshot, REST_SYNC_MS);
  chartSyncTimer = setInterval(loadChartToday, CHART_SYNC_MS);
  ensureChartTimer = setInterval(ensureChartBootstrapped, 1500);
}

async function refreshLoadAllOnce() {
  if (refreshLoading) return;

  if (!hasInternet()) {
    refreshLoaded = false;
    refreshConnUI();
    return;
  }

  refreshLoading = true;
  refreshLoaded = false;
  modeLoading = true;
  refreshConnUI();

  try {
    await loadCandleSnapshot(true);
    await loadChartToday(true);
    if (address) await loadAccount(true);

    refreshLoaded = true;
    modeLoading = false;
    refreshConnUI();
    setUIReady(true);
  } finally {
    refreshLoading = false;
    refreshConnUI();
  }
}

function setMode(isLive) {
  liveMode = !!isLive;
  localStorage.setItem(MODE_KEY, liveMode ? "live" : "refresh");

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  modeLoading = true;
  refreshConnUI();

  if (!liveMode) {
    stopAllTimers();
    stopAllSockets();
    wsTradeOnline = false;
    wsKlineOnline = false;
    accountOnline = false;

    refreshLoaded = false;
    refreshLoading = false;

    setTimeout(() => {
      refreshConnUI();
      refreshLoadAllOnce();
    }, REFRESH_RED_MS);

  } else {
    refreshLoaded = false;
    refreshLoading = false;

    startTradeWS();
    startKlineWS();
    loadCandleSnapshot();
    loadChartToday();
    if (address) loadAccount();
    startAllTimers();
    refreshConnUI();
  }
}

liveToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  setMode(!liveMode);
}, { passive: false });

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = {
  price: 0,
  available: 0,
  stake: 0,
  rewards: 0,
  apr: 0,

  availableUsd: 0,
  stakeUsd: 0,
  rewardsUsd: 0,

  netWorthUsd: 0
};

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 },
  w: { t: 0, open: 0, high: 0, low: 0 },
  m: { t: 0, open: 0, high: 0, low: 0 },
};
const tfReady = { d: false, w: false, m: false };

/* ================= WS (price + klines) ================= */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

function stopAllSockets() {
  try { wsTrade?.close(); } catch {}
  try { wsKline?.close(); } catch {}
  wsTrade = null; wsKline = null;
  if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; }
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }
}

function scheduleTradeRetry() {
  if (tradeRetryTimer) clearTimeout(tradeRetryTimer);
  tradeRetryTimer = setTimeout(() => { if (liveMode) startTradeWS(); }, 1200);
}

function startTradeWS() {
  if (!liveMode) return;
  try { wsTrade?.close(); } catch {}

  wsTradeOnline = false;
  refreshConnUI();
  if (!hasInternet()) return;

  wsTrade = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  wsTrade.onopen = () => {
    wsTradeOnline = true;
    modeLoading = address ? !accountOnline : false;
    refreshConnUI();
  };
  wsTrade.onclose = () => { wsTradeOnline = false; refreshConnUI(); scheduleTradeRetry(); };
  wsTrade.onerror = () => { wsTradeOnline = false; refreshConnUI(); try { wsTrade.close(); } catch {} scheduleTradeRetry(); };

  wsTrade.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const p = safe(msg?.p);
    if (!p) return;

    targetPrice = p;

    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}

function scheduleKlineRetry() {
  if (klineRetryTimer) clearTimeout(klineRetryTimer);
  klineRetryTimer = setTimeout(() => { if (liveMode) startKlineWS(); }, 1200);
}

function applyKline(intervalKey, k) {
  const t = safe(k.t);
  const o = safe(k.o);
  const h = safe(k.h);
  const l = safe(k.l);
  if (o && h && l) {
    candle[intervalKey].t = t || candle[intervalKey].t;
    candle[intervalKey].open = o;
    candle[intervalKey].high = h;
    candle[intervalKey].low = l;
    if (!tfReady[intervalKey]) {
      tfReady[intervalKey] = true;
      settleStart = Date.now();
    }
  }
}

function startKlineWS() {
  if (!liveMode) return;
  try { wsKline?.close(); } catch {}

  wsKlineOnline = false;
  refreshConnUI();
  if (!hasInternet()) return;

  const url =
    "wss://stream.binance.com:9443/stream?streams=" +
    "injusdt@kline_1m/" +
    "injusdt@kline_1d/" +
    "injusdt@kline_1w/" +
    "injusdt@kline_1M";

  wsKline = new WebSocket(url);

  wsKline.onopen = () => {
    wsKlineOnline = true;
    modeLoading = address ? !accountOnline : false;
    refreshConnUI();
  };
  wsKline.onclose = () => { wsKlineOnline = false; refreshConnUI(); scheduleKlineRetry(); };
  wsKline.onerror = () => { wsKlineOnline = false; refreshConnUI(); try { wsKline.close(); } catch {} scheduleKlineRetry(); };

  wsKline.onmessage = (e) => {
    let payload;
    try { payload = JSON.parse(e.data); } catch { return; }
    const data = payload?.data;
    const stream = payload?.stream || "";
    const k = data?.k;
    if (!k) return;

    if (stream.includes("@kline_1m")) {
      updateChartFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    setUIReady(false);
  };
}

/* ================= ACCOUNT (Injective LCD) ================= */
let validatorAddress = "";
let validatorMoniker = "";
let validatorCache = new Map(); // addr -> moniker

async function fetchValidatorMoniker(valAddr) {
  const a = String(valAddr || "").trim();
  if (!a) return "";
  if (validatorCache.has(a)) return validatorCache.get(a) || "";
  const base = "https://lcd.injective.network";
  const v = await fetchJSON(`${base}/cosmos/staking/v1beta1/validators/${a}`);
  const mon = v?.validator?.description?.moniker || shortAddr(a);
  validatorCache.set(a, mon);
  return mon;
}

function ensureValidatorMiniCard() {
  const nwCard = $("netWorthCard") || q(".networth-card");
  if (!nwCard) return null;

  let wrap = q("#nwValidatorMini", nwCard);
  if (wrap) return wrap;

  // place under networth foot
  const foot = q(".networth-foot", nwCard) || nwCard;

  wrap = document.createElement("div");
  wrap.id = "nwValidatorMini";
  wrap.className = "nw-mini nw-mini-single";
  wrap.style.marginTop = "10px";

  wrap.innerHTML = `
    <div class="nw-mini-left">
      <span class="nw-coin-logo" style="background: rgba(245,158,11,.14);">⛓️</span>
      <div class="nw-mini-meta">
        <div class="nw-mini-title" id="nwValidatorName">Validator</div>
        <div class="nw-mini-sub" id="nwValidatorSub">—</div>
      </div>
    </div>
    <div class="nw-mini-right" style="display:flex;align-items:center;gap:.55rem;">
      <span id="nwValidatorDot" style="width:10px;height:10px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>
      <span id="nwValidatorState" style="font-weight:900; font-size:.85rem; opacity:.9;">Loading</span>
    </div>
  `;

  foot.appendChild(wrap);
  return wrap;
}

function setValidatorState(state) {
  ensureValidatorMiniCard();
  const dot = $("nwValidatorDot");
  const st = $("nwValidatorState");
  const sub = $("nwValidatorSub");

  if (!dot || !st) return;

  if (!hasInternet()) {
    dot.style.background = "#ef4444";
    st.textContent = "Offline";
    if (sub && validatorMoniker) sub.textContent = validatorMoniker;
    return;
  }

  if (state === "loading") {
    dot.style.background = "#f59e0b";
    st.textContent = "Loading";
    if (sub && validatorMoniker) sub.textContent = validatorMoniker;
    return;
  }

  if (state === "ok") {
    dot.style.background = "#22c55e";
    st.textContent = "Active";
    if (sub && validatorMoniker) sub.textContent = validatorMoniker;
    return;
  }

  dot.style.background = "#9ca3af";
  st.textContent = "—";
}

async function loadAccount(isRefresh = false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet()) {
    accountOnline = false;
    setValidatorState("loading");
    refreshConnUI();
    return;
  }

  const base = "https://lcd.injective.network";
  const [b, s, r, i] = await Promise.all([
    fetchJSON(`${base}/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`${base}/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`${base}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`${base}/cosmos/mint/v1beta1/inflation`)
  ]);

  if (!b || !s || !r || !i) {
    accountOnline = false;
    setValidatorState("loading");
    refreshConnUI();
    return;
  }

  accountOnline = true;
  modeLoading = false;
  refreshConnUI();

  const bal = b.balances?.find(x => x.denom === "inj");
  availableInj = safe(bal?.amount) / 1e18;

  const delegations = (s.delegation_responses || []);
  stakeInj = delegations.reduce((a, d) => a + safe(d?.balance?.amount), 0) / 1e18;

  // ✅ validator detection
  const vAddr = delegations?.[0]?.delegation?.validator_address || "";
  if (vAddr && vAddr !== validatorAddress) {
    validatorAddress = vAddr;
    setValidatorState("loading");
    validatorMoniker = await fetchValidatorMoniker(vAddr);
    setText("nwValidatorName", "Validator");
    setValidatorState("ok");
  } else {
    setValidatorState(liveMode ? (liveReady() ? "ok" : "loading") : (refreshLoaded ? "ok" : "loading"));
  }

  const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  rewardsInj = newRewards;

  apr = safe(i.inflation) * 100;

  maybeAddStakePoint(stakeInj);
  maybeRecordRewardWithdrawal(rewardsInj);

  // ✅ net worth point is per address and persistent
  recordNetWorthPoint();

  setUIReady(true);
}

/* ================= BINANCE REST: snapshot candele 1D/1W/1M ================= */
async function loadCandleSnapshot(isRefresh = false) {
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;

  const [d, w, m] = await Promise.all([
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1d&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1w&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1M&limit=1"),
  ]);

  if (Array.isArray(d) && d[0]) {
    candle.d.t = safe(d[0][0]);
    candle.d.open = safe(d[0][1]);
    candle.d.high = safe(d[0][2]);
    candle.d.low = safe(d[0][3]);
    if (candle.d.open && candle.d.high && candle.d.low) tfReady.d = true;
  }
  if (Array.isArray(w) && w[0]) {
    candle.w.t = safe(w[0][0]);
    candle.w.open = safe(w[0][1]);
    candle.w.high = safe(w[0][2]);
    candle.w.low = safe(w[0][3]);
    if (candle.w.open && candle.w.high && candle.w.low) tfReady.w = true;
  }
  if (Array.isArray(m) && m[0]) {
    candle.m.t = safe(m[0][0]);
    candle.m.open = safe(m[0][1]);
    candle.m.high = safe(m[0][2]);
    candle.m.low = safe(m[0][3]);
    if (candle.m.open && candle.m.high && candle.m.low) tfReady.m = true;
  }

  setUIReady(true);
}

/* ================= PRICE CHART (1D) ================= */
let chart = null;
let chartLabels = [];
let chartData = [];
let lastChartMinuteStart = 0;
let chartBootstrappedToday = false;

let hoverActive = false;
let hoverIndex = null;
let pinnedIndex = null;
let isPanning = false;

const verticalLinePlugin = {
  id: "verticalLinePlugin",
  afterDraw(ch) {
    if (!hoverActive || hoverIndex == null) return;
    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[hoverIndex];
    if (!el) return;
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(el.x, ch.chartArea.top);
    ctx.lineTo(el.x, ch.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.stroke();
    ctx.restore();
  }
};

function applyChartColorBySign(sign) {
  if (!chart) return;
  const ds = chart.data.datasets?.[0];
  if (!ds) return;

  if (sign === "up") {
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.20)";
  } else if (sign === "down") {
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.18)";
  } else {
    ds.borderColor = "#3b82f6";
    ds.backgroundColor = "rgba(59,130,246,.14)";
  }
  chart.update("none");
}

function updatePinnedOverlay() {
  const overlay = $("chartOverlay");
  const chartEl = $("chartPrice");
  if (!overlay || !chartEl || !chart) return;

  if (pinnedIndex == null) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  const ds = chart.data.datasets?.[0]?.data || [];
  const lbs = chart.data.labels || [];
  if (!ds.length || !lbs.length) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  let idx = Number.isFinite(+pinnedIndex) ? +pinnedIndex : null;
  if (idx == null) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  idx = clamp(Math.round(idx), 0, ds.length - 1);
  const price = safe(ds[idx]);
  const label = lbs[idx];
  if (!Number.isFinite(price) || !label) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  chartEl.textContent = `${label} • $${price.toFixed(4)}`;
  overlay.classList.add("show");
}

async function fetchKlines1mRange(startTime, endTime) {
  const out = [];
  let cursor = startTime;
  const end = endTime || Date.now();

  while (cursor < end && out.length < DAY_MINUTES) {
    const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1000&startTime=${cursor}&endTime=${end}`;
    const d = await fetchJSON(url);
    if (!Array.isArray(d) || !d.length) break;

    out.push(...d);

    const lastOpenTime = safe(d[d.length - 1][0]);
    cursor = lastOpenTime + ONE_MIN_MS;

    if (!lastOpenTime) break;
    if (d.length < 1000) break;
  }
  return out.slice(0, DAY_MINUTES);
}

function initChartToday() {
  const canvas = $("priceChart");
  if (!canvas || !window.Chart) return;

  const zoomBlock = ZOOM_OK ? {
    zoom: {
      pan: {
        enabled: true,
        mode: "x",
        threshold: 2,
        onPanStart: () => { isPanning = true; },
        onPanComplete: ({ chart }) => {
          isPanning = false;
          const xScale = chart.scales.x;
          const center = (chart.chartArea.left + chart.chartArea.right) / 2;
          pinnedIndex = xScale.getValueForPixel(center);
          updatePinnedOverlay();
        }
      },
      zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: "x",
        onZoomComplete: ({ chart }) => {
          const xScale = chart.scales.x;
          const center = (chart.chartArea.left + chart.chartArea.right) / 2;
          pinnedIndex = xScale.getValueForPixel(center);
          updatePinnedOverlay();
        }
      }
    }
  } : {};

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...zoomBlock
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: axisTickColor() },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [verticalLinePlugin]
  });

  setupChartInteractions();
}

async function loadChartToday(isRefresh = false) {
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;
  if (!tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  chartLabels = kl.map(k => fmtHHMM(safe(k[0])));
  chartData = kl.map(k => safe(k[4]));
  lastChartMinuteStart = safe(kl[kl.length - 1][0]) || 0;

  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!chart) initChartToday();
  if (chart) {
    chart.data.labels = chartLabels;
    chart.data.datasets[0].data = chartData;
    chart.update("none");
  }

  chartBootstrappedToday = true;
  setUIReady(true);
}

function setupChartInteractions() {
  const canvas = $("priceChart");
  if (!canvas || !chart) return;

  const getIndexFromEvent = (evt) => {
    const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
    if (!points || !points.length) return null;
    return points[0].index;
  };

  const handleMove = (evt) => {
    if (!chart) return;
    if (isPanning) return;

    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverActive = true;
    hoverIndex = idx;
    pinnedIndex = idx;

    updatePinnedOverlay();
    chart.update("none");
  };

  const handleLeave = () => {
    hoverActive = false;
    hoverIndex = null;
    pinnedIndex = null;
    updatePinnedOverlay();
    if (chart) chart.update("none");
  };

  canvas.addEventListener("mousemove", handleMove, { passive: true });
  canvas.addEventListener("mouseleave", handleLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchend", handleLeave, { passive: true });
  canvas.addEventListener("touchcancel", handleLeave, { passive: true });
}

async function ensureChartBootstrapped() {
  if (!liveMode) return;
  if (chartBootstrappedToday) return;
  if (!tfReady.d || !candle.d.t) await loadCandleSnapshot();
  if (tfReady.d && candle.d.t) await loadChartToday();
}

function updateChartFrom1mKline(k) {
  if (!liveMode) return;
  if (!chart || !chartBootstrappedToday || !tfReady.d || !candle.d.t) return;

  const openTime = safe(k.t);
  const close = safe(k.c);
  if (!openTime || !close) return;
  if (openTime < candle.d.t) return;

  if (lastChartMinuteStart === openTime) {
    const idx = chart.data.datasets[0].data.length - 1;
    if (idx >= 0) {
      chart.data.datasets[0].data[idx] = close;
      chart.update("none");
    }
    return;
  }

  lastChartMinuteStart = openTime;
  chart.data.labels.push(fmtHHMM(openTime));
  chart.data.datasets[0].data.push(close);

  while (chart.data.labels.length > DAY_MINUTES) chart.data.labels.shift();
  while (chart.data.datasets[0].data.length > DAY_MINUTES) chart.data.datasets[0].data.shift();

  chart.update("none");
}

/* ================= STAKE CHART (persist, per address) ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;

function stakeStoreKey(addr) {
  const a = normalizeAddr(addr);
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function saveStakeSeries() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    }));
    cloudBump(1);
  } catch {}
}
function loadStakeSeries() {
  const key = stakeStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== STAKE_LOCAL_VER) return false;

    stakeLabels = Array.isArray(obj.labels) ? obj.labels : [];
    stakeData = Array.isArray(obj.data) ? obj.data : [];
    stakeMoves = Array.isArray(obj.moves) ? obj.moves : [];
    stakeTypes = Array.isArray(obj.types) ? obj.types : [];

    const n = stakeData.length;
    stakeLabels = stakeLabels.slice(0, n);
    stakeMoves = stakeMoves.slice(0, n);
    stakeTypes = stakeTypes.slice(0, n);

    while (stakeMoves.length < n) stakeMoves.push(0);
    while (stakeTypes.length < n) stakeTypes.push("Stake update");

    stakeBaselineCaptured = stakeData.length > 0;
    lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;

    // initialize displayed value from last
    if (stakeData.length) displayed.stake = safe(stakeData[stakeData.length - 1]);

    return true;
  } catch {
    return false;
  }
}
function resetStakeSeriesFromNow() {
  stakeLabels = [nowLabel()];
  stakeData = [0];
  stakeMoves = [0];
  stakeTypes = ["Reset start"];
  lastStakeRecordedRounded = 0;
  stakeBaselineCaptured = false;
  saveStakeSeries();
  drawStakeChart();
}

function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: stakeLabels,
      datasets: [{
        data: stakeData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: (ctx) => (stakeMoves[ctx.dataIndex] || 0) < 0 ? "#ef4444" : "#22c55e",
        pointBorderColor: (ctx) => (stakeMoves[ctx.dataIndex] || 0) < 0 ? "rgba(239,68,68,.95)" : "rgba(34,197,94,.90)",
        pointBorderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            title: (items) => stakeLabels[items?.[0]?.dataIndex ?? 0] || "",
            label: (item) => {
              const i = item.dataIndex;
              const v = safe(stakeData[i]);
              const t = stakeTypes[i] || "Stake update";
              return `${t} • ${v.toFixed(6)} INJ`;
            }
          }
        },
        ...(ZOOM_OK ? {
          zoom: {
            pan: { enabled: true, mode: "x", threshold: 2 },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        } : {})
      },
      scales: {
        x: { display: false },
        y: { ticks: { color: axisTickColor() }, grid: { color: axisGridColor() } }
      }
    }
  });
}
function drawStakeChart() {
  if (!stakeChart) initStakeChart();
  if (stakeChart) {
    stakeChart.data.labels = stakeLabels;
    stakeChart.data.datasets[0].data = stakeData;
    stakeChart.update("none");
  }
}

function maybeAddStakePoint(currentStake) {
  const s = safe(currentStake);
  if (!Number.isFinite(s)) return;

  const rounded = Number(s.toFixed(6));

  if (!stakeBaselineCaptured) {
    stakeLabels.push(nowLabel());
    stakeData.push(rounded);
    stakeMoves.push(1);
    stakeTypes.push("Baseline (current)");
    lastStakeRecordedRounded = rounded;
    stakeBaselineCaptured = true;
    saveStakeSeries();
    drawStakeChart();
    return;
  }

  if (lastStakeRecordedRounded == null) { lastStakeRecordedRounded = rounded; return; }
  if (rounded === lastStakeRecordedRounded) return;

  const delta = rounded - lastStakeRecordedRounded;
  lastStakeRecordedRounded = rounded;

  stakeLabels.push(nowLabel());
  stakeData.push(rounded);
  stakeMoves.push(delta > 0 ? 1 : -1);
  stakeTypes.push(delta > 0 ? "Delegate / Compound" : "Undelegate");

  saveStakeSeries();
  drawStakeChart();

  // ✅ event log
  addEvent({
    type: delta > 0 ? "STAKE / COMPOUND" : "UNSTAKE",
    ts: Date.now(),
    move: `${delta > 0 ? "+" : ""}${delta.toFixed(6)} INJ`,
    status: "ok",
    kind: delta > 0 ? "up" : "down"
  });
}

/* ================= REWARD WITHDRAWALS (persist, per address) ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll = [];

let wdLabels = [];
let wdValues = [];
let wdTimes = [];

let wdLastRewardsSeen = null;
let wdMinFilter = 0;

function wdStoreKey(addr) {
  const a = normalizeAddr(addr);
  return a ? `inj_reward_withdrawals_v${REWARD_WD_LOCAL_VER}_${a}` : null;
}
function saveWdAll() {
  const key = wdStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
    cloudBump(1);
  } catch {}
}
function loadWdAll() {
  const key = wdStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== REWARD_WD_LOCAL_VER) return false;

    wdLabelsAll = Array.isArray(obj.labels) ? obj.labels : [];
    wdValuesAll = Array.isArray(obj.values) ? obj.values : [];
    wdTimesAll = Array.isArray(obj.times) ? obj.times : [];

    rebuildWdView();

    // initialize displayed rewards from last known (if any)
    return true;
  } catch {
    return false;
  }
}

function rebuildWdView() {
  wdLabels = [];
  wdValues = [];
  wdTimes = [];

  for (let i = 0; i < wdValuesAll.length; i++) {
    const v = safe(wdValuesAll[i]);
    if (v >= wdMinFilter) {
      wdLabels.push(wdLabelsAll[i]);
      wdValues.push(v);
      wdTimes.push(wdTimesAll[i] || 0);
    }
  }

  drawRewardWdChart();
  syncRewardTimelineUI(true);
}

/* labels over reward points */
const rewardPointLabelPlugin = {
  id: "rewardPointLabelPlugin",
  afterDatasetsDraw(ch) {
    const ds = ch.data.datasets?.[0];
    if (!ds) return;

    const meta = ch.getDatasetMeta(0);
    const dataEls = meta?.data || [];
    if (!dataEls.length) return;

    const xScale = ch.scales?.x;
    const n = ds.data.length;

    let min = xScale?.min;
    let max = xScale?.max;
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = n - 1;

    const visibleCount = Math.max(0, Math.floor(max - min + 1));
    if (visibleCount > 200) return;

    const ctx = ch.ctx;
    ctx.save();
    ctx.font = "800 11px Inter, sans-serif";
    ctx.fillStyle = (document.body.dataset.theme === "light")
      ? "rgba(15,23,42,0.88)"
      : "rgba(249,250,251,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const leftBound = ch.chartArea.left + 6;
    const rightBound = ch.chartArea.right - 6;

    let drawn = 0;
    const maxDraw = 60;

    for (let i = Math.max(0, Math.floor(min)); i <= Math.min(n - 1, Math.ceil(max)); i++) {
      const el = dataEls[i];
      if (!el) continue;
      if (drawn >= maxDraw) break;

      const v = safe(ds.data[i]);
      const text = `+${v.toFixed(6)} INJ`;

      const halfW = ctx.measureText(text).width / 2;
      let x = el.x;
      x = Math.max(leftBound + halfW, Math.min(rightBound - halfW, x));

      let y = el.y - 10;
      y = Math.max(ch.chartArea.top + 12, y);

      ctx.fillText(text, x, y);
      drawn++;
    }
    ctx.restore();
  }
};

let rewardChart = null;

function initRewardWdChart() {
  const canvas = $("rewardChart");
  if (!canvas || !window.Chart) return;

  rewardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: wdLabels,
      datasets: [{
        data: wdValues,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#3b82f6",
        pointBorderColor: "rgba(249,250,251,.6)",
        pointBorderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { left: 18, right: 18, top: 6, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            title: (items) => wdLabels[items?.[0]?.dataIndex ?? 0] || "",
            label: (item) => `Withdrawn • +${safe(item.raw).toFixed(6)} INJ`
          }
        },
        ...(ZOOM_OK ? {
          zoom: {
            pan: { enabled: true, mode: "x", threshold: 2 },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        } : {})
      },
      scales: {
        x: { ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: axisGridColor() } },
        y: {
          position: "right",
          ticks: { color: axisTickColor(), mirror: true, padding: 6, callback: (val) => fmtSmart(val) },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [rewardPointLabelPlugin]
  });
}

function drawRewardWdChart() {
  if (!rewardChart) initRewardWdChart();
  if (rewardChart) {
    rewardChart.data.labels = wdLabels;
    rewardChart.data.datasets[0].data = wdValues;
    rewardChart.update("none");
  }
}

function syncRewardTimelineUI(forceToEnd = false) {
  const slider = $("rewardTimeline");
  const meta = $("rewardTimelineMeta");
  if (!slider || !meta) return;

  const n = wdValues.length;
  if (!n) {
    slider.min = 0; slider.max = 0; slider.value = 0;
    meta.textContent = "—";
    if (rewardChart) {
      rewardChart.options.scales.x.min = undefined;
      rewardChart.options.scales.x.max = undefined;
      rewardChart.update("none");
    }
    return;
  }

  slider.min = 0;
  slider.max = String(n - 1);
  if (forceToEnd) slider.value = String(n - 1);

  const idx = clamp(parseInt(slider.value || "0", 10), 0, n - 1);
  const win = Math.min(60, n);
  const minIdx = Math.max(0, idx - win + 1);
  const maxIdx = idx;

  if (rewardChart) {
    rewardChart.options.scales.x.min = minIdx;
    rewardChart.options.scales.x.max = maxIdx;
    rewardChart.update("none");
  }

  const from = wdLabels[minIdx] || "";
  const to = wdLabels[maxIdx] || "";
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;
}

function attachRewardTimelineHandlers() {
  const slider = $("rewardTimeline");
  slider?.addEventListener("input", () => syncRewardTimelineUI(false), { passive: true });
}
function goRewardLive() {
  const slider = $("rewardTimeline");
  if (slider) slider.value = String(Math.max(0, wdValues.length - 1));
  if (rewardChart?.resetZoom) rewardChart.resetZoom();
  syncRewardTimelineUI(true);
}
function attachRewardLiveHandler() {
  $("rewardLiveBtn")?.addEventListener("click", () => goRewardLive(), { passive: true });
}
function attachRewardFilterHandler() {
  const sel = $("rewardFilter");
  if (!sel) return;
  sel.addEventListener("change", () => {
    wdMinFilter = safe(sel.value);
    rebuildWdView();
    goRewardLive();
  }, { passive: true });
}

function maybeRecordRewardWithdrawal(newRewards) {
  const r = safe(newRewards);
  if (wdLastRewardsSeen == null) { wdLastRewardsSeen = r; return; }

  const diff = wdLastRewardsSeen - r;
  if (diff > 0.0002) {
    const ts = Date.now();
    wdTimesAll.push(ts);
    wdLabelsAll.push(nowLabel());
    wdValuesAll.push(diff);
    saveWdAll();
    rebuildWdView();
    goRewardLive();

    addEvent({
      type: "REWARD WITHDRAW",
      ts,
      move: `+${diff.toFixed(6)} INJ`,
      status: "ok",
      kind: "up"
    });
  }
  wdLastRewardsSeen = r;
}

/* ================= EVENTS (per address) ================= */
let events = [];

function eventsKey(addr) {
  const a = normalizeAddr(addr);
  return a ? `inj_events_v${EVENTS_LOCAL_VER}_${a}` : null;
}
function loadEvents() {
  const key = eventsKey(address);
  events = [];
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== EVENTS_LOCAL_VER) return;
    events = Array.isArray(obj.items) ? obj.items : [];
  } catch {}
}
function saveEvents() {
  const key = eventsKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ v: EVENTS_LOCAL_VER, t: Date.now(), items: events }));
    cloudBump(1);
  } catch {}
}
function clearEvents() {
  events = [];
  saveEvents();
}
function eventDedupeKey(e) {
  return `${e.type}|${Math.floor(safe(e.ts) / 60000)}|${e.move}`;
}
function addEvent(e) {
  if (!address) return;

  const item = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: String(e?.type || "EVENT"),
    ts: safe(e?.ts) || Date.now(),
    move: String(e?.move || "—"),
    status: String(e?.status || "ok"), // ok | pending | err
    kind: String(e?.kind || "flat")    // up | down | flat
  };

  // dedupe last 150
  const dk = eventDedupeKey(item);
  const last = events.slice(-150);
  if (last.some(x => eventDedupeKey(x) === dk)) return;

  events.push(item);
  // keep max 2000
  if (events.length > 2000) events = events.slice(-2000);

  saveEvents();
}

function statusBadgeHTML(status, kind) {
  const isPending = status === "pending";
  const isErr = status === "err";
  const bg = isErr ? "rgba(239,68,68,.18)" : (isPending ? "rgba(245,158,11,.18)" : "rgba(34,197,94,.16)");
  const col = isErr ? "#ef4444" : (isPending ? "#f59e0b" : "#22c55e");

  const arrow = kind === "up" ? "▲" : (kind === "down" ? "▼" : "•");
  const anim = isPending ? "animation: pulse 1.2s infinite;" : "";
  return `
    <span style="
      display:inline-flex; align-items:center; justify-content:flex-end;
      gap:.35rem; padding:.18rem .55rem; border-radius:999px;
      border:1px solid rgba(255,255,255,.10);
      background:${bg}; color:${col};
      font-weight:900; font-size:.75rem; ${anim}
    ">
      <span>${arrow}</span>
      <span>${isErr ? "ERROR" : (isPending ? "PENDING" : "OK")}</span>
    </span>
  `;
}

function renderEventsTable() {
  ensureEventView();
  const tbody = $("eventTbody");
  if (!tbody) return;

  const list = (events || []).slice().sort((a, b) => safe(b.ts) - safe(a.ts)).slice(0, 400);
  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="padding:.7rem .35rem; opacity:.75;">
          No events yet for this wallet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(ev => {
    const dt = new Date(safe(ev.ts) || 0);
    const dtLabel = `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
    const moveCol = ev.kind === "up" ? "#22c55e" : (ev.kind === "down" ? "#ef4444" : "rgba(249,250,251,.75)");
    const moveStyle = `color:${moveCol}; font-weight:900;`;
    return `
      <tr style="border-top:1px solid rgba(255,255,255,.06);">
        <td style="padding:.55rem .35rem; font-weight:900;">${ev.type}</td>
        <td style="padding:.55rem .35rem; opacity:.85;">${dtLabel}</td>
        <td style="padding:.55rem .35rem; text-align:right; ${moveStyle}">${ev.move}</td>
        <td style="padding:.55rem .35rem; text-align:right;">${statusBadgeHTML(ev.status, ev.kind)}</td>
      </tr>
    `;
  }).join("");
}

/* ================= NET WORTH (persist + chart + LIVE) ================= */
let nwTf = "live"; // live | 1d | 1w | 1m | 1y | all
let nwScale = "lin"; // lin | log

let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];

let netWorthChart = null;
let nwHoverActive = false;
let nwHoverIndex = null;

function nwStoreKey(addr) {
  const a = normalizeAddr(addr);
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}
function nwPrefsKey() {
  const a = normalizeAddr(address);
  return a ? `inj_networth_prefs_v${NW_LOCAL_VER}_${a}` : null;
}

function saveNW() {
  const key = nwStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll,
      usdAll: nwUsdAll,
      injAll: nwInjAll
    }));
    cloudBump(1);
  } catch {}
}
function saveNWPrefs() {
  const key = nwPrefsKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER,
      tf: nwTf,
      scale: nwScale
    }));
  } catch {}
}

function loadNW() {
  const key = nwStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTAll = Array.isArray(obj.tAll) ? obj.tAll.map(Number) : [];
    nwUsdAll = Array.isArray(obj.usdAll) ? obj.usdAll.map(Number) : [];
    nwInjAll = Array.isArray(obj.injAll) ? obj.injAll.map(Number) : [];

    clampNWArrays();

    // displayed net worth init from last
    if (nwUsdAll.length) displayed.netWorthUsd = safe(nwUsdAll[nwUsdAll.length - 1]);

    // prefs
    const pRaw = localStorage.getItem(nwPrefsKey());
    if (pRaw) {
      const p = JSON.parse(pRaw);
      const tf = String(p?.tf || "live");
      const sc = String(p?.scale || "lin");
      nwTf = ["live", "1d", "1w", "1m", "1y", "all"].includes(tf) ? tf : "live";
      nwScale = sc === "log" ? "log" : "lin";
    }

    return true;
  } catch {
    return false;
  }
}

function clampNWArrays() {
  const n = Math.min(nwTAll.length, nwUsdAll.length, nwInjAll.length);
  nwTAll = nwTAll.slice(-n);
  nwUsdAll = nwUsdAll.slice(-n);
  nwInjAll = nwInjAll.slice(-n);
  if (nwTAll.length > NW_MAX_POINTS) {
    nwTAll = nwTAll.slice(-NW_MAX_POINTS);
    nwUsdAll = nwUsdAll.slice(-NW_MAX_POINTS);
    nwInjAll = nwInjAll.slice(-NW_MAX_POINTS);
  }
}

function nwWindowMs(tf) {
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "1d") return 24 * 60 * 60 * 1000;
  return Infinity;
}

function nwSpanMs() {
  if (nwTAll.length < 2) return 0;
  return safe(nwTAll[nwTAll.length - 1]) - safe(nwTAll[0]);
}

function ensureNwTfButtons() {
  const wrap = $("nwTfSwitch") || q("#nwTfSwitch") || q(".tf-switch");
  if (!wrap) return null;

  // inject LIVE if missing
  if (!q('.tf-btn[data-tf="live"]', wrap)) {
    const liveBtn = document.createElement("button");
    liveBtn.className = "tf-btn";
    liveBtn.type = "button";
    liveBtn.dataset.tf = "live";
    liveBtn.textContent = "LIVE";
    wrap.insertBefore(liveBtn, wrap.firstChild);
  }

  // ensure ALL exists
  if (!q('.tf-btn[data-tf="all"]', wrap)) {
    const allBtn = document.createElement("button");
    allBtn.className = "tf-btn";
    allBtn.type = "button";
    allBtn.dataset.tf = "all";
    allBtn.textContent = "ALL";
    wrap.appendChild(allBtn);
  }

  return wrap;
}

function updateTfUnlockUI() {
  const wrap = ensureNwTfButtons();
  if (!wrap) return;

  const span = nwSpanMs();
  const can1d = nwTAll.length >= 2;
  const can1w = span >= (7 * 24 * 60 * 60 * 1000);
  const can1m = span >= (30 * 24 * 60 * 60 * 1000);
  const can1y = span >= (365 * 24 * 60 * 60 * 1000);
  const canAll = nwTAll.length >= 2;

  const rules = {
    live: true,
    "1d": can1d,
    "1w": can1w,
    "1m": can1m,
    "1y": can1y,
    all: canAll
  };

  const btns = qa(".tf-btn", wrap);
  btns.forEach(b => {
    const tf = b.dataset.tf || "";
    const ok = !!rules[tf];
    b.disabled = !ok;
    b.style.opacity = ok ? "1" : "0.35";
    b.style.pointerEvents = ok ? "" : "none";
    b.classList.toggle("active", tf === nwTf);
  });

  // if current selection becomes unavailable, fallback
  if (!rules[nwTf]) {
    nwTf = "live";
    saveNWPrefs();
    btns.forEach(b => b.classList.toggle("active", (b.dataset.tf || "") === nwTf));
  }
}

/* Build view for NW chart based on tf.
   - LIVE: last 2 minutes sliding (scrolling)
   - Fixed TF: last window points (no auto-scroll behavior beyond window) */
function nwBuildView(tf) {
  const labels = [];
  const data = [];
  const times = [];

  if (nwTAll.length < 2) return { labels, data, times };

  const now = Date.now();

  if (tf === "live") {
    const minT = now - NW_LIVE_WINDOW_MS;

    for (let i = 0; i < nwTAll.length; i++) {
      const t = safe(nwTAll[i]);
      const u = safe(nwUsdAll[i]);
      if (t >= minT && Number.isFinite(u) && u > 0) {
        times.push(t);
        labels.push(fmtHHMM(t));
        data.push(u);
      }
    }

    return { labels, data, times };
  }

  if (tf === "all") {
    for (let i = 0; i < nwTAll.length; i++) {
      const t = safe(nwTAll[i]);
      const u = safe(nwUsdAll[i]);
      if (Number.isFinite(u) && u > 0) {
        times.push(t);
        labels.push(nwSpanMs() >= (24 * 60 * 60 * 1000) ? fmtDateShort(t) : fmtHHMM(t));
        data.push(u);
      }
    }
    return { labels, data, times };
  }

  const w = nwWindowMs(tf);
  const minT = now - w;

  for (let i = 0; i < nwTAll.length; i++) {
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(u) && u > 0) {
      times.push(t);
      labels.push(w >= (24 * 60 * 60 * 1000) ? fmtDateShort(t) : fmtHHMM(t));
      data.push(u);
    }
  }

  return { labels, data, times };
}

/* NW chart plugins: vertical line on hover + blinking last dot */
const nwVerticalLinePlugin = {
  id: "nwVerticalLinePlugin",
  afterDraw(ch) {
    if (!nwHoverActive || nwHoverIndex == null) return;
    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[nwHoverIndex];
    if (!el) return;
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(el.x, ch.chartArea.top);
    ctx.lineTo(el.x, ch.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.65)";
    ctx.stroke();
    ctx.restore();
  }
};

const nwLastDotPlugin = {
  id: "nwLastDotPlugin",
  afterDatasetsDraw(ch) {
    const ds = ch.data.datasets?.[0];
    if (!ds) return;

    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;

    const el = pts[pts.length - 1];
    if (!el) return;

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));

    const ctx = ch.ctx;
    ctx.save();

    ctx.shadowColor = `rgba(250,204,21,${0.35 * pulse})`;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.arc(el.x, el.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.22 * pulse})`;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();

    ctx.restore();
  }
};

function nwSetScale(scale) {
  nwScale = (scale === "log") ? "log" : "lin";
  saveNWPrefs();
  if (!netWorthChart) return;
  const y = netWorthChart.options?.scales?.y;
  if (!y) return;

  // log can't show <=0
  y.type = (nwScale === "log") ? "logarithmic" : "linear";
  netWorthChart.update("none");

  const btn = $("nwScaleToggle");
  if (btn) btn.textContent = (nwScale === "log") ? "LOG" : "LIN";
}

function initNWChart() {
  const canvas = $("netWorthChart");
  if (!canvas || !window.Chart) return;

  updateTfUnlockUI();

  const view = nwBuildView(nwTf);

  netWorthChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: view.labels,
      datasets: [{
        data: view.data,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.12)",
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        pointHitRadius: 18,
        clip: { left: 0, top: 0, right: 22, bottom: 0 },
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      layout: { padding: { left: 8, right: 34, top: 8, bottom: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...(ZOOM_OK ? {
          zoom: {
            pan: { enabled: true, mode: "x", threshold: 2 },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
          }
        } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display: true,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            padding: 8
          },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          type: (nwScale === "log") ? "logarithmic" : "linear",
          position: "right",
          ticks: {
            mirror: false,
            color: axisTickColor(),
            padding: 10,
            maxTicksLimit: 5,
            callback: (v) => `$${fmtSmart(v)}`
          },
          grid: { color: axisGridColor() },
          border: { display: false }
        }
      }
    },
    plugins: [nwVerticalLinePlugin, nwLastDotPlugin]
  });

  attachNWInteractions();
  attachNWTFHandlers();

  const btn = $("nwScaleToggle");
  if (btn) {
    btn.textContent = (nwScale === "log") ? "LOG" : "LIN";
    btn.addEventListener("click", () => {
      nwSetScale(nwScale === "lin" ? "log" : "lin");
    }, { passive: true });
  }

  // inject logo if there is an <img> placeholder
  const img =
    $("nwLogoImg") ||
    q("#netWorthCard img[data-inj-logo]") ||
    q("#netWorthCard img") ||
    null;

  if (img && !img.dataset._injSet) {
    img.src = INJ_LOGO_PNG;
    img.loading = "lazy";
    img.decoding = "async";
    img.dataset._injSet = "1";
  }
}

function nwApplySignStyling(sign) {
  if (!netWorthChart) return;
  const ds = netWorthChart.data.datasets?.[0];
  if (!ds) return;

  if (sign === "up") {
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.16)";
  } else if (sign === "down") {
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.14)";
  } else {
    ds.borderColor = "#3b82f6";
    ds.backgroundColor = "rgba(59,130,246,.12)";
  }
  netWorthChart.update("none");
}

function drawNW() {
  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  updateTfUnlockUI();

  const view = nwBuildView(nwTf);

  netWorthChart.data.labels = view.labels;
  netWorthChart.data.datasets[0].data = view.data;
  netWorthChart.update("none");

  // PnL (only for fixed TF / all). For LIVE show "LIVE"
  const pnlEl = $("netWorthPnl");
  if (!pnlEl) return;

  if (nwTf === "live") {
    pnlEl.classList.remove("good", "bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = "LIVE";
    nwApplySignStyling("flat");
    return;
  }

  if (view.data.length >= 2) {
    const first = safe(view.data[0]);
    const last = safe(view.data[view.data.length - 1]);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    pnlEl.classList.remove("good", "bad", "flat");
    const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
    pnlEl.classList.add(cls);

    const sign = pnl > 0 ? "+" : "";
    pnlEl.textContent = `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
    nwApplySignStyling(pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat"));
  } else {
    pnlEl.classList.remove("good", "bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = "PnL: —";
    nwApplySignStyling("flat");
  }
}

function nwGetIndexFromEvent(evt) {
  if (!netWorthChart) return null;
  const pts = netWorthChart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
  if (!pts || !pts.length) return null;
  return pts[0].index;
}

function nwShowHoverValue(idx) {
  if (!netWorthChart) return;
  const data = netWorthChart.data.datasets?.[0]?.data || [];
  const labels = netWorthChart.data.labels || [];
  idx = clamp(idx, 0, data.length - 1);
  const v = safe(data[idx]);
  const lab = labels[idx] || "";
  if (!v) return;

  const el = $("netWorthUsd");
  if (el) el.textContent = `$${v.toFixed(2)}`;

  const pnlEl = $("netWorthPnl");
  if (pnlEl) {
    pnlEl.classList.remove("good", "bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = `${lab} • $${v.toFixed(2)}`;
  }
}

function nwRestoreRealtimeValue() {
  nwHoverActive = false;
  nwHoverIndex = null;
}

function attachNWInteractions() {
  const canvas = $("netWorthChart");
  if (!canvas || !netWorthChart) return;

  const onMove = (evt) => {
    const idx = nwGetIndexFromEvent(evt);
    if (idx == null) return;
    nwHoverActive = true;
    nwHoverIndex = idx;
    nwShowHoverValue(idx);
    netWorthChart.update("none");
  };

  const onLeave = () => {
    nwRestoreRealtimeValue();
    netWorthChart.update("none");
  };

  canvas.addEventListener("mousemove", onMove, { passive: true });
  canvas.addEventListener("mouseleave", onLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchend", onLeave, { passive: true });
  canvas.addEventListener("touchcancel", onLeave, { passive: true });
}

function attachNWTFHandlers() {
  const wrap = ensureNwTfButtons();
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "live";
    if (!["live", "1d", "1w", "1m", "1y", "all"].includes(tf)) return;

    // if disabled, ignore
    if (btn.disabled) return;

    nwTf = tf;
    saveNWPrefs();
    updateTfUnlockUI();

    // reset zoom when switching TF for easier navigation
    if (netWorthChart?.resetZoom) netWorthChart.resetZoom();

    drawNW();
  }, { passive: true });
}

function recordNetWorthPoint() {
  if (!address) return;
  const px = safe(targetPrice);
  if (!Number.isFinite(px) || px <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;

  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

  const now = Date.now();

  const lastT = nwTAll.length ? safe(nwTAll[nwTAll.length - 1]) : 0;
  const lastUsd = nwUsdAll.length ? safe(nwUsdAll[nwUsdAll.length - 1]) : 0;

  const dt = now - lastT;
  const dUsd = Math.abs(totalUsd - lastUsd);

  if (lastT && dt < NW_POINT_MIN_MS && dUsd < NW_POINT_MIN_USD_DELTA) return;

  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);
  clampNWArrays();
  saveNW();

  // initialize displayed net worth as soon as we have data
  if (displayed.netWorthUsd <= 0) displayed.netWorthUsd = totalUsd;

  drawNW();
}

/* ================= EXPAND CHART MODAL (inside card, no overlap) ================= */
let modal = null;
let modalInner = null;
let modalTitle = null;
let modalClose = null;

let movedCanvas = null;
let movedFrom = null;
let movedPlaceholder = null;

function ensureChartModal() {
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "chartModal";
  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "999";
  modal.style.display = "none";
  modal.style.background = "rgba(0,0,0,.55)";
  modal.style.backdropFilter = "blur(14px)";
  modal.style.webkitBackdropFilter = "blur(14px)";
  modal.style.padding = "14px";

  modalInner = document.createElement("div");
  modalInner.style.width = "min(980px, 96vw)";
  modalInner.style.height = "min(740px, 92vh)";
  modalInner.style.margin = "0 auto";
  modalInner.style.borderRadius = "18px";
  modalInner.style.border = "1px solid rgba(255,255,255,.10)";
  modalInner.style.background =
    (document.body.dataset.theme === "light")
      ? "linear-gradient(135deg, rgba(240,242,246,.98), rgba(230,234,242,.96))"
      : "linear-gradient(135deg, rgba(11,18,32,.95), rgba(17,28,47,.92))";
  modalInner.style.boxShadow = "0 26px 90px rgba(0,0,0,.55)";
  modalInner.style.display = "flex";
  modalInner.style.flexDirection = "column";
  modalInner.style.overflow = "hidden";

  const top = document.createElement("div");
  top.style.display = "flex";
  top.style.alignItems = "center";
  top.style.justifyContent = "space-between";
  top.style.gap = "10px";
  top.style.padding = "10px 12px";
  top.style.borderBottom = "1px solid rgba(255,255,255,.08)";

  modalTitle = document.createElement("div");
  modalTitle.style.fontWeight = "950";
  modalTitle.style.letterSpacing = ".02em";
  modalTitle.textContent = "Chart";

  modalClose = document.createElement("button");
  modalClose.type = "button";
  modalClose.textContent = "✕";
  modalClose.style.width = "40px";
  modalClose.style.height = "36px";
  modalClose.style.borderRadius = "12px";
  modalClose.style.border = "1px solid rgba(255,255,255,.12)";
  modalClose.style.background = "rgba(255,255,255,.06)";
  modalClose.style.cursor = "pointer";
  modalClose.style.fontWeight = "900";

  modalClose.addEventListener("click", closeChartModal);

  top.appendChild(modalTitle);
  top.appendChild(modalClose);

  const body = document.createElement("div");
  body.id = "chartModalBody";
  body.style.flex = "1 1 auto";
  body.style.position = "relative";
  body.style.padding = "10px";
  body.style.overflow = "hidden";

  modalInner.appendChild(top);
  modalInner.appendChild(body);
  modal.appendChild(modalInner);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeChartModal();
  });

  document.body.appendChild(modal);
  return modal;
}

function openChartModal(canvasId, title = "Chart") {
  const canvas = $(canvasId);
  if (!canvas) return;

  ensureChartModal();
  const body = $("chartModalBody");
  if (!body) return;

  // move canvas into modal
  movedCanvas = canvas;
  movedFrom = canvas.parentNode;

  movedPlaceholder = document.createElement("div");
  movedPlaceholder.style.height = movedFrom?.offsetHeight ? `${movedFrom.offsetHeight}px` : "240px";
  movedPlaceholder.dataset._placeholder = "1";

  movedFrom.insertBefore(movedPlaceholder, movedCanvas);
  body.appendChild(movedCanvas);

  // make canvas fill modal area
  movedCanvas.style.width = "100%";
  movedCanvas.style.height = "100%";

  if (modalTitle) modalTitle.textContent = title;

  modal.style.display = "block";

  // force resize
  setTimeout(() => {
    try {
      if (canvasId === "netWorthChart" && netWorthChart) netWorthChart.resize();
      if (canvasId === "priceChart" && chart) chart.resize();
      if (canvasId === "stakeChart" && stakeChart) stakeChart.resize();
      if (canvasId === "rewardChart" && rewardChart) rewardChart.resize();
    } catch {}
  }, 60);
}

function closeChartModal() {
  if (!modal || !movedCanvas || !movedFrom || !movedPlaceholder) {
    if (modal) modal.style.display = "none";
    return;
  }

  // move canvas back where it was
  movedFrom.insertBefore(movedCanvas, movedPlaceholder);
  movedPlaceholder.remove();

  movedCanvas = null;
  movedFrom = null;
  movedPlaceholder = null;

  modal.style.display = "none";

  // force resize
  setTimeout(() => {
    try {
      if (netWorthChart) netWorthChart.resize();
      if (chart) chart.resize();
      if (stakeChart) stakeChart.resize();
      if (rewardChart) rewardChart.resize();
    } catch {}
  }, 60);
}

function ensureExpandButtons() {
  const map = [
    { canvasId: "netWorthChart", title: "Net Worth" },
    { canvasId: "stakeChart", title: "Staked" },
    { canvasId: "rewardChart", title: "Rewards" },
    { canvasId: "priceChart", title: "1D Price Chart" }
  ];

  map.forEach(({ canvasId, title }) => {
    const canvas = $(canvasId);
    if (!canvas) return;
    const card = canvas.closest(".card");
    if (!card) return;

    card.style.position = card.style.position || "relative";

    // if already present, don't recreate
    if (q(`button[data-expand="${canvasId}"]`, card)) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.expand = canvasId;
    btn.setAttribute("aria-label", "Expand chart");
    btn.textContent = "⤢";

    // ✅ small & non-invasive
    btn.style.position = "absolute";
    btn.style.top = "12px";
    btn.style.right = "12px";
    btn.style.width = "34px";
    btn.style.height = "34px";
    btn.style.borderRadius = "12px";
    btn.style.border = "1px solid rgba(255,255,255,.12)";
    btn.style.background = "rgba(255,255,255,.06)";
    btn.style.color = (document.body.dataset.theme === "light") ? "rgba(15,23,42,.86)" : "rgba(249,250,251,.92)";
    btn.style.fontWeight = "900";
    btn.style.cursor = "pointer";
    btn.style.zIndex = "6";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openChartModal(canvasId, title);
    });

    card.appendChild(btn);
  });
}

/* ================= PULL TO REFRESH (mobile) ================= */
let ptr = null;
let ptrSpinner = null;
let ptrText = null;

let ptrStartY = 0;
let ptrPull = 0;
let ptrArmed = false;
let ptrBusy = false;

function ensurePTR() {
  if (ptr) return ptr;

  ptr = document.createElement("div");
  ptr.id = "ptr";
  ptr.style.position = "fixed";
  ptr.style.top = "10px";
  ptr.style.left = "50%";
  ptr.style.transform = "translateX(-50%) translateY(-40px)";
  ptr.style.transition = "transform 220ms ease, opacity 220ms ease";
  ptr.style.opacity = "0";
  ptr.style.zIndex = "998";
  ptr.style.display = "inline-flex";
  ptr.style.alignItems = "center";
  ptr.style.gap = "10px";
  ptr.style.padding = "10px 14px";
  ptr.style.borderRadius = "999px";
  ptr.style.border = "1px solid rgba(255,255,255,.12)";
  ptr.style.background = "rgba(0,0,0,.35)";
  ptr.style.backdropFilter = "blur(10px)";
  ptr.style.webkitBackdropFilter = "blur(10px)";

  ptrSpinner = document.createElement("div");
  ptrSpinner.style.width = "16px";
  ptrSpinner.style.height = "16px";
  ptrSpinner.style.borderRadius = "50%";
  ptrSpinner.style.border = "2px solid rgba(255,255,255,.35)";
  ptrSpinner.style.borderTopColor = "rgba(250,204,21,.95)";
  ptrSpinner.style.animation = "spin 0.9s linear infinite";

  ptrText = document.createElement("div");
  ptrText.style.fontWeight = "900";
  ptrText.style.fontSize = ".8rem";
  ptrText.style.color = "rgba(249,250,251,.92)";
  ptrText.textContent = "Pull to refresh";

  // inject keyframes
  if (!q("#_ptrStyle")) {
    const st = document.createElement("style");
    st.id = "_ptrStyle";
    st.textContent = `@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`;
    document.head.appendChild(st);
  }

  ptr.appendChild(ptrSpinner);
  ptr.appendChild(ptrText);
  document.body.appendChild(ptr);

  return ptr;
}

function ptrShow(pull, armed, busy) {
  ensurePTR();
  const y = busy ? 0 : (armed ? 0 : (-40 + Math.min(40, pull)));
  ptr.style.transform = `translateX(-50%) translateY(${y}px)`;
  ptr.style.opacity = busy ? "1" : (pull > 10 ? "1" : "0");

  if (ptrText) {
    if (busy) ptrText.textContent = "Refreshing…";
    else ptrText.textContent = armed ? "Release to refresh" : "Pull to refresh";
  }
}

async function ptrTrigger() {
  if (ptrBusy) return;
  ptrBusy = true;
  ptrShow(ptrPull, true, true);

  try {
    modeLoading = true;
    refreshConnUI();

    if (liveMode) {
      await loadCandleSnapshot(true);
      await loadChartToday(true);
      if (address) await loadAccount(true);
      setUIReady(true);
    } else {
      await refreshLoadAllOnce();
    }

    addEvent({
      type: "REFRESH",
      ts: Date.now(),
      move: "Manual refresh",
      status: "ok",
      kind: "flat"
    });
  } finally {
    modeLoading = false;
    refreshConnUI();
    ptrBusy = false;
    ptrPull = 0;
    ptrArmed = false;
    ptrShow(0, false, false);
  }
}

function attachPullToRefresh() {
  const root = $("appRoot") || q(".container");
  if (!root) return;

  ensurePTR();

  window.addEventListener("touchstart", (e) => {
    if (ptrBusy) return;
    if (document.body.classList.contains("drawer-open")) return;
    if (modal && modal.style.display === "block") return;

    if (window.scrollY > 0) return;
    ptrStartY = e.touches?.[0]?.clientY || 0;
    ptrPull = 0;
    ptrArmed = false;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (ptrBusy) return;
    if (document.body.classList.contains("drawer-open")) return;
    if (modal && modal.style.display === "block") return;

    if (window.scrollY > 0) return;

    const y = e.touches?.[0]?.clientY || 0;
    const dy = y - ptrStartY;
    if (dy <= 0) return;

    ptrPull = dy * 0.45;
    ptrArmed = ptrPull > 42;
    ptrShow(ptrPull, ptrArmed, false);
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (ptrBusy) return;
    if (ptrArmed) {
      await ptrTrigger();
      return;
    }
    ptrPull = 0;
    ptrArmed = false;
    ptrShow(0, false, false);
  }, { passive: true });
}

/* ================= CHART THEME REFRESH ================= */
function refreshChartsTheme() {
  try {
    if (stakeChart) {
      stakeChart.options.scales.y.grid.color = axisGridColor();
      stakeChart.options.scales.y.ticks.color = axisTickColor();
      stakeChart.update("none");
    }
    if (rewardChart) {
      rewardChart.options.scales.x.grid.color = axisGridColor();
      rewardChart.options.scales.y.grid.color = axisGridColor();
      rewardChart.options.scales.x.ticks.color = axisTickColor();
      rewardChart.options.scales.y.ticks.color = axisTickColor();
      rewardChart.update("none");
    }
    if (chart) {
      chart.options.scales.y.grid.color = axisGridColor();
      chart.options.scales.y.ticks.color = axisTickColor();
      chart.update("none");
    }
    if (netWorthChart) {
      netWorthChart.options.scales.y.grid.color = axisGridColor();
      netWorthChart.options.scales.y.ticks.color = axisTickColor();
      netWorthChart.options.scales.x.ticks.color = axisTickColor();
      netWorthChart.update("none");
    }
  } catch {}
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = normalizeAddr(newAddr);
  if (!a) return;

  address = a;
  localStorage.setItem("inj_address", address);

  // ✅ show wallet under header, but keep input empty for next searches
  setAddressDisplay(address);
  if (addressInput) addressInput.value = "";
  pendingAddress = "";
  closeSearch();

  // reset per-address state
  settleStart = Date.now();

  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;

  displayed.available = 0;
  displayed.stake = 0;
  displayed.rewards = 0;
  displayed.apr = 0;

  displayed.availableUsd = 0;
  displayed.stakeUsd = 0;
  displayed.rewardsUsd = 0;
  displayed.netWorthUsd = 0;

  validatorAddress = "";
  validatorMoniker = "";
  setValidatorState("loading");

  // Load per-address persisted data
  loadStakeSeries();
  drawStakeChart();

  wdLastRewardsSeen = null;
  wdMinFilter = safe($("rewardFilter")?.value || 0);
  loadWdAll();
  rebuildWdView();
  goRewardLive();

  loadNW();
  updateTfUnlockUI();
  drawNW();

  loadEvents();
  renderEventsTable();

  modeLoading = true;
  refreshConnUI();

  if (liveMode) await loadAccount(true);
  else {
    refreshLoaded = false;
    refreshConnUI();
    await refreshLoadAllOnce();
  }
}

/* ================= ONLINE / OFFLINE listeners ================= */
window.addEventListener("online", () => {
  refreshConnUI();
  cloudRender();

  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) loadAccount(true);
  } else {
    refreshLoadAllOnce();
  }
}, { passive: true });

window.addEventListener("offline", () => {
  wsTradeOnline = false;
  wsKlineOnline = false;
  accountOnline = false;
  refreshLoaded = false;
  refreshLoading = false;
  modeLoading = false;

  refreshConnUI();
  cloudRender();

  setValidatorState("loading");
}, { passive: true });

/* ================= BOOT ================= */
(async function boot() {
  cloudLoad();
  cloudRender();

  // Move "Last update" to bottom (below cards/footer) if needed
  const updated = $("updated");
  const root = $("appRoot") || q(".container");
  const footer = q(".pro-footer", root);
  if (updated && root) {
    // ensure it is near bottom
    if (footer && updated.nextSibling !== footer) {
      root.insertBefore(footer, null);
      root.insertBefore(updated, footer);
    } else {
      root.appendChild(updated);
    }
  }

  refreshConnUI();
  setTimeout(() => setUIReady(true), 2800);

  attachRewardTimelineHandlers();
  attachRewardLiveHandler();
  attachRewardFilterHandler();

  attachPullToRefresh();

  // mode UI
  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  // load persisted per-address series
  if (address) {
    setAddressDisplay(address);
    loadStakeSeries();
    drawStakeChart();

    loadWdAll();
    rebuildWdView();
    goRewardLive();

    loadNW();
    updateTfUnlockUI();
    drawNW();

    loadEvents();
    renderEventsTable();
  } else {
    // no wallet set yet, still init charts if needed
    drawStakeChart();
    drawRewardWdChart();
    drawNW();
  }

  // ensure buttons for charts exist inside cards
  setTimeout(ensureExpandButtons, 50);

  // init validator mini card
  ensureValidatorMiniCard();
  setValidatorState("loading");

  modeLoading = true;
  refreshConnUI();

  // initial snapshots
  await loadCandleSnapshot(liveMode ? false : true);
  await loadChartToday(liveMode ? false : true);

  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) await loadAccount(true);
    startAllTimers();
  } else {
    stopAllTimers();
    stopAllSockets();
    accountOnline = false;
    refreshLoaded = false;
    refreshConnUI();
    await refreshLoadAllOnce();
  }

  modeLoading = false;
  refreshConnUI();
})();

/* ================= LOOP ================= */
let lastPriceEventTs = 0;

function maybePriceEvent(pct24h) {
  // price event if abs 24h change crosses 5% and not too frequent
  const now = Date.now();
  if (now - lastPriceEventTs < 15 * 60 * 1000) return; // 15 min cooldown
  const v = safe(pct24h);
  if (Math.abs(v) < 5) return;

  lastPriceEventTs = now;
  addEvent({
    type: "PRICE MOVE (24H)",
    ts: now,
    move: `${v > 0 ? "+" : ""}${v.toFixed(2)}%`,
    status: "ok",
    kind: v > 0 ? "up" : "down"
  });
}

function animate() {
  // PRICE
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  // PERF
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  // ✅ arrow colors correct (by CSS classes)
  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  maybePriceEvent(pD);

  // Chart sign color
  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "flat");
  applyChartColorBySign(sign);

  // Bars
  const dUp = "linear-gradient(90deg, rgba(34,197,94,.55), rgba(16,185,129,.32))";
  const dDown = "linear-gradient(270deg, rgba(239,68,68,.55), rgba(248,113,113,.30))";

  const wUp = "linear-gradient(90deg, rgba(59,130,246,.55), rgba(99,102,241,.30))";
  const wDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(59,130,246,.26))";

  const mUp = "linear-gradient(90deg, rgba(249,115,22,.50), rgba(236,72,153,.28))";
  const mDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(236,72,153,.25))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"), $("weekLine"), targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);

  // Values
  if (tfReady.d) {
    setText("priceMin", safe(candle.d.low).toFixed(3));
    setText("priceOpen", safe(candle.d.open).toFixed(3));
    setText("priceMax", safe(candle.d.high).toFixed(3));
  } else {
    setText("priceMin", "--"); setText("priceOpen", "--"); setText("priceMax", "--");
  }
  if (tfReady.w) {
    setText("weekMin", safe(candle.w.low).toFixed(3));
    setText("weekOpen", safe(candle.w.open).toFixed(3));
    setText("weekMax", safe(candle.w.high).toFixed(3));
  } else {
    setText("weekMin", "--"); setText("weekOpen", "--"); setText("weekMax", "--");
  }
  if (tfReady.m) {
    setText("monthMin", safe(candle.m.low).toFixed(3));
    setText("monthOpen", safe(candle.m.open).toFixed(3));
    setText("monthMax", safe(candle.m.high).toFixed(3));
  } else {
    setText("monthMin", "--"); setText("monthOpen", "--"); setText("monthMax", "--");
  }

  // AVAILABLE
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);

  const oau = displayed.availableUsd;
  displayed.availableUsd = tick(displayed.availableUsd, displayed.available * displayed.price);
  colorMoney($("availableUsd"), displayed.availableUsd, oau, 2);

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);

  const osu = displayed.stakeUsd;
  displayed.stakeUsd = tick(displayed.stakeUsd, displayed.stake * displayed.price);
  colorMoney($("stakeUsd"), displayed.stakeUsd, osu, 2);

  const stakePct = clamp((displayed.stake / STAKE_TARGET_MAX) * 100, 0, 100);
  const stakeBar = $("stakeBar");
  const stakeLine = $("stakeLine");
  if (stakeBar) {
    stakeBar.style.width = stakePct + "%";
    stakeBar.style.backgroundPosition = `${(100 - stakePct) * 0.6}% 0`;
  }
  if (stakeLine) stakeLine.style.left = stakePct + "%";
  setText("stakePercent", stakePct.toFixed(1) + "%");
  setText("stakeMin", "0");
  setText("stakeMax", String(STAKE_TARGET_MAX));

  // REWARDS
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);

  const oru = displayed.rewardsUsd;
  displayed.rewardsUsd = tick(displayed.rewardsUsd, displayed.rewards * displayed.price);
  colorMoney($("rewardsUsd"), displayed.rewardsUsd, oru, 2);

  const maxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  const rewardBar = $("rewardBar");
  const rewardLine = $("rewardLine");
  if (rewardBar) {
    rewardBar.style.width = rp + "%";
    rewardBar.style.backgroundPosition = `${(100 - rp)}% 0`;
  }
  if (rewardLine) rewardLine.style.left = rp + "%";
  setText("rewardPercent", rp.toFixed(1) + "%");
  setText("rewardMin", "0");
  setText("rewardMax", maxR.toFixed(1));

  // APR (animated digits too)
  const oapr = displayed.apr;
  displayed.apr = tick(displayed.apr, apr);
  colorNumber($("apr"), displayed.apr, oapr, 2);

  // time
  setText("updated", "Last update: " + nowLabel());

  /* ================= NET WORTH UI ================= */
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);

    // keep PnL / LIVE label consistent
    drawNW();
  }

  // total owned box (if exists)
  const netWorthInjEl = $("netWorthInj");
  if (netWorthInjEl) netWorthInjEl.textContent = `${totalInj.toFixed(4)} INJ`;

  // record points: in LIVE we keep collecting; in refresh mode only on account updates
  if (address && liveMode) recordNetWorthPoint();

  // keep blinking dot smooth
  if (netWorthChart) netWorthChart.draw();

  // update validator dot state (live)
  if (address) {
    if (!hasInternet()) setValidatorState("loading");
    else if (liveMode) setValidatorState(liveReady() ? "ok" : "loading");
    else setValidatorState(refreshLoaded ? "ok" : "loading");
  }

  refreshConnUI();

  requestAnimationFrame(animate);
}
animate();

/* ================= FINAL TOUCHES (layout + buttons) ================= */
function moveMenuFooterInfo() {
  // If your HTML has placeholders, we’ll update them; otherwise safe no-op
  const drawerFoot = q(".drawer-foot");
  const ver = $("drawerVersion") || q("[data-drawer-version]");
  const cl = $("drawerCloud") || q("[data-drawer-cloud]");
  if (drawerFoot && (ver || cl)) {
    if (ver) ver.textContent = "App v2.0.2";
    if (cl) cl.textContent = `Cloud Sync · ${Math.max(0, Math.floor(cloudPts))} pts`;
  }
}

setTimeout(() => {
  ensureExpandButtons();
  moveMenuFooterInfo();
}, 200);

/* ================= WHAT THIS JS ADDS (quick notes) =================
1) Net Worth:
   - LIVE TF (2 minutes, scrolling window) + fixed TF (1D/1W/1M/1Y/ALL) unlocked only when enough history exists.
   - LIN/LOG toggle preserved per wallet.
   - Persistent points per wallet, never resets after refresh.

2) Expand chart icon:
   - Small ⤢ button injected inside each chart card (Net Worth / Staked / Rewards / 1D Chart).
   - Fullscreen modal keeps pan/zoom/hover data.

3) Validator mini-card:
   - Auto-detected from first delegation validator.
   - Dot: green active, amber loading, red offline.

4) Events page:
   - Real page (not “coming soon”) with table stored per wallet.
   - Logs stake/unstake, reward withdraw, price events, refresh events.

5) Pull-to-refresh:
   - Mobile pull down at top triggers refresh load (works in LIVE and REFRESH modes).
===================================================== */
