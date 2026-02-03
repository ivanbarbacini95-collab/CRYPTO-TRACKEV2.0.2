/* ================= APP =================
   Injective • Portfolio (v2.0.2)
   - Per-address permanent persistence (stake, rewards, net worth)
   - Net Worth: LIVE (5m scrolling window) + TF unlock (1D/1W/1M/1Y/ALL)
   - Expand icon for any chart card (zoom/pan/orizzontale)
   - Same digit-animation for all changing numbers (like INJ price)
   - Safe: no crashes if elements missing
======================================== */

/* ================= CONFIG ================= */
const APP_VERSION = "2.0.2";

const INITIAL_SETTLE_TIME = 4200;
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;

const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* persistence versions */
const STAKE_LOCAL_VER = 3;
const REWARD_WD_LOCAL_VER = 3;
const NW_LOCAL_VER = 2;
const ACC_SNAP_VER = 1;

/* max points */
const STAKE_MAX_POINTS = 6000;
const WD_MAX_POINTS = 6000;
const NW_MAX_POINTS = 12000;

/* NET WORTH LIVE window */
const NW_LIVE_WINDOW_MS = 5 * 60 * 1000;
const NW_LIVE_SAMPLE_MS = 1000;

/* REFRESH mode staging */
const REFRESH_RED_MS = 220;
let refreshLoaded = false;
let refreshLoading = false;

/* Status dot "mode loading" */
let modeLoading = false;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtFullTime(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function nowLabel() { return new Date().toLocaleTimeString(); }
function shortAddr(a) { return a && a.length > 18 ? (a.slice(0, 10) + "…" + a.slice(-6)) : (a || ""); }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

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

/* address validation (Injective bech32 “inj…”) */
function isValidInjAddr(a) {
  const s = String(a || "").trim();
  return /^inj[a-z0-9]{20,80}$/i.test(s);
}

/* ================= Smooth display ================= */
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

/* ================= Digit coloring (price-style) ================= */
function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dirUp = n > o;

  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i] ? (dirUp ? upCol : dnCol) : baseCol;
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

function colorNumberSuffix(el, n, o, d, suffix) {
  if (!el) return;
  const wrap = document.createElement("span");
  wrap.style.whiteSpace = "nowrap";
  wrap.style.fontVariantNumeric = "tabular-nums";
  colorNumber(wrap, n, o, d);
  wrap.innerHTML = wrap.innerHTML + `<span style="opacity:.9"> ${suffix}</span>`;
  el.innerHTML = wrap.innerHTML;
}

/* money with digit coloring */
function colorMoney(el, n, o, decimals = 2) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(decimals);
  const os = o.toFixed(decimals);
  if (ns === os) { el.textContent = `$${ns}`; return; }

  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
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
function setStatusError(msg) {
  const statusText = $("statusText");
  const statusDot = $("statusDot");
  if (statusText) statusText.textContent = msg || "Error";
  if (statusDot) statusDot.style.background = "#ef4444";
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

function axisGridColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)";
}
function axisTickColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)";
}

function applyTheme(t) {
  theme = (t === "light") ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const themeIcon = $("themeIcon");
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";

  refreshChartsTheme();
}
applyTheme(theme);

/* ================= CHARTJS ZOOM REGISTER (NO CRASH) ================= */
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

/* ================= CLOUD (footer + points) ================= */
const CLOUD_VER = 1;
const CLOUD_KEY = `inj_cloud_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;

function cloudLoad() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj) return;
    cloudPts = safe(obj.pts);
    cloudLastSync = safe(obj.lastSync);
  } catch {}
}
function cloudSave() {
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ v: CLOUD_VER, pts: cloudPts, lastSync: cloudLastSync }));
    return true;
  } catch {
    return false;
  }
}

function hasInternet() { return navigator.onLine === true; }

function cloudSetState(state) {
  const root = $("appRoot");
  const st = $("cloudStatus");
  if (!root || !st) return;

  root.classList.remove("cloud-synced", "cloud-saving", "cloud-error");

  if (state === "saving") {
    root.classList.add("cloud-saving");
    st.textContent = hasInternet() ? "Cloud: Saving" : "Cloud: Offline cache";
    return;
  }
  if (state === "error") {
    root.classList.add("cloud-error");
    st.textContent = "Cloud: Error";
    return;
  }
  root.classList.add("cloud-synced");
  st.textContent = hasInternet() ? "Cloud: Synced" : "Cloud: Offline cache";
}

function cloudRender() {
  const hist = $("cloudHistory");
  if (hist) hist.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;
}

function cloudBump(points = 1) {
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();

  cloudSetState("saving");
  const ok = cloudSave();
  cloudRender();

  if (!ok) {
    cloudSetState("error");
    return;
  }
  setTimeout(() => {
    cloudSetState("synced");
    cloudRender();
  }, 450);
}

/* ================= CONNECTION UI ================= */
const statusDot = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

/* LIVE is "ready" when sockets ok + account ok (if address set) */
function liveReady() {
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline;
  return socketsOk && accountOk;
}

/* Status dot:
   - offline => red
   - loading => orange
   - ready => green
*/
function refreshConnUI() {
  if (!statusDot || !statusText) return;

  if (!hasInternet()) {
    statusText.textContent = "Offline";
    statusDot.style.background = "#ef4444";
    return;
  }

  const loadingNow =
    modeLoading ||
    refreshLoading ||
    (!liveMode && !refreshLoaded) ||
    (liveMode && !liveReady());

  if (loadingNow) {
    statusText.textContent = "Loading...";
    statusDot.style.background = "#f59e0b";
    return;
  }

  statusText.textContent = "Online";
  statusDot.style.background = "#22c55e";
}

/* ================= UI READY FAILSAFE ================= */
function setUIReady(force = false) {
  const root = $("appRoot");
  if (!root) return;
  if (root.classList.contains("ready")) return;
  if (!force && !tfReady.d) return;
  root.classList.remove("loading");
  root.classList.add("ready");
}

/* ================= SAFE FETCH (with timeout) ================= */
async function fetchJSON(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/* ================= HEADER SEARCH UI ================= */
const searchWrap = $("searchWrap");
const searchBtn = $("searchBtn");
const addressInput = $("addressInput");
const addressDisplay = $("addressDisplay");
const menuBtn = $("menuBtn");

let address = localStorage.getItem("inj_address") || "";
let pendingAddress = address || "";

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

if (addressInput) addressInput.value = pendingAddress;

if (searchBtn) {
  searchBtn.addEventListener("click", (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!searchWrap.classList.contains("open")) openSearch();
    else addressInput?.focus();
  }, { passive: false });
}

if (addressInput) {
  addressInput.addEventListener("focus", () => openSearch(), { passive: true });
  addressInput.addEventListener("input", (e) => { pendingAddress = e.target.value.trim(); }, { passive: true });

  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAddress(pendingAddress);
      closeSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      addressInput.value = address || "";
      pendingAddress = address || "";
      closeSearch();
    }
  });
}

/* close only if click truly outside */
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
const liveIcon = $("liveIcon");
const modeHint = $("modeHint");

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
  e?.preventDefault?.();
  e?.stopPropagation?.();
  toggleDrawer();
}, { passive: false });

backdrop?.addEventListener("click", () => closeDrawer(), { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

themeToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive: false });

/* menu bottom meta (version + cloud) – injected if missing */
function ensureDrawerBottomMeta() {
  const foot = qs(".drawer-foot", drawer) || null;
  if (!foot) return;

  let meta = $("drawerBottomMeta");
  if (!meta) {
    meta = document.createElement("div");
    meta.id = "drawerBottomMeta";
    meta.style.marginTop = "10px";
    meta.style.fontSize = ".78rem";
    meta.style.opacity = ".75";
    meta.style.textAlign = "right";
    meta.style.lineHeight = "1.35";
    foot.appendChild(meta);
  }

  const cloud = $("cloudStatus")?.textContent || "Cloud: —";
  meta.textContent = `INJ Portfolio v${APP_VERSION} · ${cloud}`;
}

/* ================= COMING SOON overlay ================= */
const comingSoon = $("comingSoon");
const comingTitle = $("comingTitle");
const comingSub = $("comingSub");
const comingClose = $("comingClose");

function pageLabel(key) {
  if (key === "home") return "HOME";
  if (key === "market") return "MARKET";
  if (key === "event") return "EVENT";
  if (key === "settings") return "SETTINGS";
  return "PAGE";
}
function openComingSoon(pageKey) {
  if (!comingSoon) return;
  if (comingTitle) comingTitle.textContent = `COMING SOON 🚀`;
  if (comingSub) comingSub.textContent = `${pageLabel(pageKey)} is coming soon.`;
  comingSoon.classList.add("show");
  comingSoon.setAttribute("aria-hidden", "false");
}
function closeComingSoon() {
  if (!comingSoon) return;
  comingSoon.classList.remove("show");
  comingSoon.setAttribute("aria-hidden", "true");
}
comingClose?.addEventListener("click", (e) => { e?.preventDefault?.(); closeComingSoon(); }, { passive: false });
comingSoon?.addEventListener("click", (e) => { if (e.target === comingSoon) closeComingSoon(); }, { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeComingSoon(); });

function setActivePage(pageKey) {
  const items = drawerNav?.querySelectorAll(".nav-item") || [];
  items.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageKey));
}
drawerNav?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".nav-item");
  if (!btn) return;
  const page = btn.dataset.page || "dashboard";
  setActivePage(page);
  closeDrawer();
  if (page !== "dashboard") openComingSoon(page);
  else closeComingSoon();
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
  if (!hasInternet()) { refreshLoaded = false; refreshConnUI(); cloudSetState("synced"); return; }

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
    cloudSetState("synced");
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
  e?.preventDefault?.();
  setMode(!liveMode);
}, { passive: false });

/* ================= STATE ================= */
let targetPrice = safe(localStorage.getItem("inj_last_price")) || 0;

let displayed = {
  price: targetPrice || 0,
  available: 0,
  stake: 0,
  rewards: 0,
  netWorthUsd: 0,
  apr: 0,
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

function clearTradeRetry() { if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; } }
function scheduleTradeRetry() {
  clearTradeRetry();
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
    clearTradeRetry();
  };
  wsTrade.onclose = () => { wsTradeOnline = false; refreshConnUI(); scheduleTradeRetry(); };
  wsTrade.onerror = () => { wsTradeOnline = false; refreshConnUI(); try { wsTrade.close(); } catch {} scheduleTradeRetry(); };

  wsTrade.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const p = safe(msg?.p);
    if (!p) return;

    targetPrice = p;
    localStorage.setItem("inj_last_price", String(p));

    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}

function clearKlineRetry() { if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; } }
function scheduleKlineRetry() {
  clearKlineRetry();
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
    clearKlineRetry();
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

/* ================= ACCOUNT SNAPSHOT (restore on refresh) ================= */
function accSnapKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_accsnap_v${ACC_SNAP_VER}_${a}` : null;
}
function saveAccountSnapshot() {
  const key = accSnapKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: ACC_SNAP_VER, t: Date.now(),
      availableInj, stakeInj, rewardsInj, apr
    }));
  } catch {}
}
function loadAccountSnapshot() {
  const key = accSnapKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== ACC_SNAP_VER) return false;
    availableInj = safe(obj.availableInj);
    stakeInj = safe(obj.stakeInj);
    rewardsInj = safe(obj.rewardsInj);
    apr = safe(obj.apr);
    return true;
  } catch {
    return false;
  }
}

/* ================= ACCOUNT (Injective LCD) ================= */
async function loadAccount(isRefresh = false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet() || !isValidInjAddr(address)) {
    accountOnline = false;
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
    refreshConnUI();
    return;
  }

  accountOnline = true;
  modeLoading = false;
  refreshConnUI();

  const bal = b.balances?.find(x => x.denom === "inj");
  availableInj = safe(bal?.amount) / 1e18;

  stakeInj = (s.delegation_responses || []).reduce((a, d) => a + safe(d?.balance?.amount), 0) / 1e18;

  const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  rewardsInj = newRewards;

  apr = safe(i.inflation) * 100;

  saveAccountSnapshot();

  maybeAddStakePoint(stakeInj);
  maybeRecordRewardWithdrawal(rewardsInj);

  /* record net worth (long TF series) on account update */
  recordNetWorthPoint();

  setUIReady(true);
}

/* ================= BINANCE REST: snapshot candles 1D/1W/1M ================= */
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

/* ================= PERF ================= */
function pctChange(price, open) {
  const p = safe(price), o = safe(open);
  if (!o) return 0;
  const v = ((p - o) / o) * 100;
  return Number.isFinite(v) ? v : 0;
}
function updatePerf(arrowId, pctId, v) {
  const arrow = $(arrowId), pct = $(pctId);
  if (!arrow || !pct) return;

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= BAR RENDER (price TF bars) ================= */
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

/* flash extremes */
const lastExtremes = { d: { low: null, high: null }, w: { low: null, high: null }, m: { low: null, high: null } };
function flash(el) {
  if (!el) return;
  el.classList.remove("flash-yellow");
  void el.offsetWidth;
  el.classList.add("flash-yellow");
}

/* ================= PRICE CHART (1D, 1m klines) ================= */
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

/* fallback pan if zoom plugin missing */
function attachSimplePan(ch) {
  if (!ch) return;
  const canvas = ch.canvas;
  if (!canvas) return;

  let down = false;
  let startX = 0;
  let startMin = null;
  let startMax = null;

  const getRange = () => {
    const x = ch.options.scales?.x || {};
    const min = Number.isFinite(x.min) ? x.min : 0;
    const max = Number.isFinite(x.max) ? x.max : (ch.data.labels.length - 1);
    return { min, max };
  };

  canvas.addEventListener("pointerdown", (e) => {
    down = true;
    startX = e.clientX;
    const r = getRange();
    startMin = r.min;
    startMax = r.max;
    canvas.setPointerCapture?.(e.pointerId);
  }, { passive: true });

  canvas.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    const len = Math.max(1, ch.data.labels.length);
    const r = getRange();
    const width = canvas.getBoundingClientRect().width || 1;
    const perPx = (r.max - r.min + 1) / width;
    const shift = Math.round(-dx * perPx);

    const span = startMax - startMin;
    let nmin = clamp(startMin + shift, 0, Math.max(0, len - 1 - span));
    let nmax = nmin + span;

    ch.options.scales.x.min = nmin;
    ch.options.scales.x.max = nmax;
    ch.update("none");
  }, { passive: true });

  const up = () => { down = false; };
  canvas.addEventListener("pointerup", up, { passive: true });
  canvas.addEventListener("pointercancel", up, { passive: true });
  canvas.addEventListener("pointerleave", up, { passive: true });
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

  if (!ZOOM_OK) attachSimplePan(chart);
  setupChartInteractions();

  installExpandForCanvas("priceChart", () => chart, "1D Price Chart");
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

/* ================= STAKE CHART (per-address persistent) ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;

function stakeStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function saveStakeSeries() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try {
    const n = stakeData.length;
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels.slice(-n),
      data: stakeData.slice(-n),
      moves: stakeMoves.slice(-n),
      types: stakeTypes.slice(-n)
    }));
    cloudBump(1);
  } catch { cloudSetState("error"); }
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

    const n = Math.min(stakeLabels.length, stakeData.length);
    stakeLabels = stakeLabels.slice(-n);
    stakeData = stakeData.slice(-n);
    stakeMoves = stakeMoves.slice(-n);
    stakeTypes = stakeTypes.slice(-n);

    while (stakeMoves.length < n) stakeMoves.push(0);
    while (stakeTypes.length < n) stakeTypes.push("Stake update");

    stakeBaselineCaptured = stakeData.length > 0;
    lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;

    // clamp size
    if (stakeData.length > STAKE_MAX_POINTS) {
      const cut = stakeData.length - STAKE_MAX_POINTS;
      stakeLabels.splice(0, cut);
      stakeData.splice(0, cut);
      stakeMoves.splice(0, cut);
      stakeTypes.splice(0, cut);
    }

    return true;
  } catch {
    return false;
  }
}
function clearStakeSeriesStorage() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
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
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      scales: {
        x: { display: false, grid: { display: false }, ticks: { color: axisTickColor() } },
        y: { ticks: { color: axisTickColor(), callback: (v) => fmtSmart(v) }, grid: { color: axisGridColor() } }
      }
    }
  });

  if (!ZOOM_OK) attachSimplePan(stakeChart);
  installExpandForCanvas("stakeChart", () => stakeChart, "Staked");
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

  // clamp
  if (stakeData.length > STAKE_MAX_POINTS) {
    stakeLabels.shift(); stakeData.shift(); stakeMoves.shift(); stakeTypes.shift();
  }

  saveStakeSeries();
  drawStakeChart();
}

/* ================= REWARD WITHDRAWALS (per-address persistent) ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll = [];

let wdLabels = [];
let wdValues = [];
let wdTimes = [];

let wdLastRewardsSeen = null;
let wdMinFilter = 0;

function wdStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_reward_withdrawals_v${REWARD_WD_LOCAL_VER}_${a}` : null;
}
function saveWdAll() {
  const key = wdStoreKey(address);
  if (!key) return;
  try {
    // clamp
    if (wdValuesAll.length > WD_MAX_POINTS) {
      const cut = wdValuesAll.length - WD_MAX_POINTS;
      wdLabelsAll.splice(0, cut);
      wdValuesAll.splice(0, cut);
      wdTimesAll.splice(0, cut);
    }
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
    cloudBump(1);
  } catch { cloudSetState("error"); }
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
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
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

  if (!ZOOM_OK) attachSimplePan(rewardChart);
  installExpandForCanvas("rewardChart", () => rewardChart, "Rewards");
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
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    wdTimesAll.push(Date.now());
    wdLabelsAll.push(nowLabel());
    wdValuesAll.push(diff);
    saveWdAll();
    rebuildWdView();
    goRewardLive();
  }
  wdLastRewardsSeen = r;
}

/* ================= NET WORTH (per-address persistent + LIVE 5m) ================= */
let nwTf = "1d";       // "live" | "1d" | "1w" | "1m" | "1y" | "all"
let nwScale = "lin";   // lin | log

let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];

let nwLiveT = [];
let nwLiveUsd = [];

let netWorthChart = null;

let nwHoverActive = false;
let nwHoverIndex = null;
let nwPinnedIndex = null;

let lastNWRecordedT = 0;
let lastNWRecordedUsd = 0;

let lastLiveSampleT = 0;

function nwStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}

function clampNWArrays() {
  const n = Math.min(nwTAll.length, nwUsdAll.length, nwInjAll.length);
  nwTAll = nwTAll.slice(-n);
  nwUsdAll = nwUsdAll.slice(-n);
  nwInjAll = nwInjAll.slice(-n);

  const n2 = Math.min(nwLiveT.length, nwLiveUsd.length);
  nwLiveT = nwLiveT.slice(-n2);
  nwLiveUsd = nwLiveUsd.slice(-n2);

  if (nwTAll.length > NW_MAX_POINTS) {
    const cut = nwTAll.length - NW_MAX_POINTS;
    nwTAll.splice(0, cut);
    nwUsdAll.splice(0, cut);
    nwInjAll.splice(0, cut);
  }
  if (nwLiveT.length > NW_MAX_POINTS) {
    const cut = nwLiveT.length - NW_MAX_POINTS;
    nwLiveT.splice(0, cut);
    nwLiveUsd.splice(0, cut);
  }
}

function saveNW() {
  const key = nwStoreKey(address);
  if (!key) return;
  try {
    clampNWArrays();
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tf: nwTf,
      scale: nwScale,
      tAll: nwTAll, usdAll: nwUsdAll, injAll: nwInjAll,
      liveT: nwLiveT, liveUsd: nwLiveUsd
    }));
    cloudBump(1);
  } catch { cloudSetState("error"); }
}

function loadNW() {
  const key = nwStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTf = (["live", "1d", "1w", "1m", "1y", "all"].includes(obj.tf)) ? obj.tf : "1d";
    nwScale = (obj.scale === "log") ? "log" : "lin";

    nwTAll = Array.isArray(obj.tAll) ? obj.tAll.map(Number) : [];
    nwUsdAll = Array.isArray(obj.usdAll) ? obj.usdAll.map(Number) : [];
    nwInjAll = Array.isArray(obj.injAll) ? obj.injAll.map(Number) : [];

    nwLiveT = Array.isArray(obj.liveT) ? obj.liveT.map(Number) : [];
    nwLiveUsd = Array.isArray(obj.liveUsd) ? obj.liveUsd.map(Number) : [];

    clampNWArrays();

    // restore last record guards
    lastNWRecordedT = nwTAll.length ? safe(nwTAll[nwTAll.length - 1]) : 0;
    lastNWRecordedUsd = nwUsdAll.length ? safe(nwUsdAll[nwUsdAll.length - 1]) : 0;

    return true;
  } catch {
    return false;
  }
}

function windowMs(tf) {
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "1d") return 24 * 60 * 60 * 1000;
  return Infinity;
}

function nwBuildView() {
  // LIVE = last 5 minutes from nwLive
  if (nwTf === "live") {
    const now = Date.now();
    const minT = now - NW_LIVE_WINDOW_MS;

    const labels = [];
    const data = [];
    const times = [];

    for (let i = 0; i < nwLiveT.length; i++) {
      const t = safe(nwLiveT[i]);
      const u = safe(nwLiveUsd[i]);
      if (t >= minT && Number.isFinite(u) && u > 0) {
        times.push(t);
        labels.push(fmtHHMM(t));
        data.push(u);
      }
    }
    return { labels, data, times, isLive: true };
  }

  // ALL / 1D/1W/1M/1Y from nwAll
  const now = Date.now();
  const w = (nwTf === "all") ? Infinity : windowMs(nwTf);
  const minT = (w === Infinity) ? -Infinity : (now - w);

  const labels = [];
  const data = [];
  const times = [];

  const span = nwTAll.length ? (now - safe(nwTAll[0])) : 0;
  const labelAsDate = span > (48 * 60 * 60 * 1000); // > 2 days => dates are clearer

  for (let i = 0; i < nwTAll.length; i++) {
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(u) && u > 0) {
      times.push(t);
      labels.push(labelAsDate ? new Date(t).toLocaleDateString() : fmtHHMM(t));
      data.push(u);
    }
  }
  return { labels, data, times, isLive: false };
}

function updateNWButtonsVisibility() {
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  // ensure LIVE button exists
  let liveBtn = wrap.querySelector(`.tf-btn[data-tf="live"]`);
  if (!liveBtn) {
    liveBtn = document.createElement("button");
    liveBtn.type = "button";
    liveBtn.className = "tf-btn";
    liveBtn.dataset.tf = "live";
    liveBtn.textContent = "LIVE";
    wrap.prepend(liveBtn);
  }

  // ensure ALL exists
  let allBtn = wrap.querySelector(`.tf-btn[data-tf="all"]`);
  if (!allBtn) {
    allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "tf-btn";
    allBtn.dataset.tf = "all";
    allBtn.textContent = "ALL";
    wrap.appendChild(allBtn);
  }

  const btns = qsa(".tf-btn", wrap);

  const earliest = nwTAll.length ? safe(nwTAll[0]) : 0;
  const span = earliest ? (Date.now() - earliest) : 0;

  const unlock = {
    "1d": true,
    "1w": span >= windowMs("1w"),
    "1m": span >= windowMs("1m"),
    "1y": span >= windowMs("1y"),
    "all": nwTAll.length >= 6, // show ALL after a few points
    "live": true,
  };

  btns.forEach(b => {
    const tf = b.dataset.tf || "";
    const ok = !!unlock[tf];
    // requirement: initially not visible
    b.style.display = ok ? "" : "none";
  });

  // keep active coherent
  if (!unlock[nwTf]) nwTf = "1d";
  btns.forEach(b => b.classList.toggle("active", (b.dataset.tf || "") === nwTf));
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

/* Pro: vertical line while interacting */
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

/* Blinking yellow dot at last visible point */
const nwLastDotPlugin = {
  id: "nwLastDotPlugin",
  afterDatasetsDraw(ch) {
    const ds = ch.data.datasets?.[0];
    if (!ds) return;
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;

    const xScale = ch.scales?.x;
    let lastIdx = pts.length - 1;
    if (xScale && Number.isFinite(xScale.max)) {
      lastIdx = clamp(Math.floor(xScale.max), 0, pts.length - 1);
    }
    const el = pts[lastIdx];
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

function initNWChart() {
  const canvas = $("netWorthChart");
  if (!canvas || !window.Chart) return;

  const view = nwBuildView();

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
        spanGaps: true,
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
          type: "linear",
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

  if (!ZOOM_OK) attachSimplePan(netWorthChart);

  attachNWInteractions();
  attachNWTFHandlers();
  attachNWScaleHandler();

  installExpandForCanvas("netWorthChart", () => netWorthChart, "Net Worth");
}

function drawNW() {
  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  updateNWButtonsVisibility();

  const view = nwBuildView();
  netWorthChart.data.labels = view.labels;
  netWorthChart.data.datasets[0].data = view.data;

  // scale LIN/LOG (safe: log only if all data > 0)
  const y = netWorthChart.options.scales.y;
  if (y) {
    if (nwScale === "log" && view.data.every(v => safe(v) > 0)) y.type = "logarithmic";
    else y.type = "linear";
  }

  // LIVE: show last window (always follow latest)
  if (view.isLive) {
    const n = view.data.length;
    const span = Math.min(n, Math.max(60, Math.floor(NW_LIVE_WINDOW_MS / NW_LIVE_SAMPLE_MS))); // ~300
    netWorthChart.options.scales.x.min = Math.max(0, n - span);
    netWorthChart.options.scales.x.max = Math.max(0, n - 1);
  } else {
    // Non-LIVE: do NOT auto-scroll window (let user pan/zoom)
    // If user never panned, keep full view.
    // If zoom plugin exists, leave its internal min/max.
    if (!ZOOM_OK) {
      netWorthChart.options.scales.x.min = undefined;
      netWorthChart.options.scales.x.max = undefined;
    }
  }

  netWorthChart.update("none");

  // PnL display only for non-live TF (LIVE is “now”)
  const pnlEl = $("netWorthPnl");
  if (pnlEl) {
    if (!view.data.length || view.data.length < 2) {
      pnlEl.classList.remove("good", "bad");
      pnlEl.classList.add("flat");
      pnlEl.textContent = "PnL: —";
      nwApplySignStyling("flat");
    } else if (!view.isLive) {
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
      pnlEl.textContent = "LIVE • last 5m";
      nwApplySignStyling("flat");
    }
  }
}

/* Interaction: hover/touch shows point value in Net Worth USD temporarily */
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

  // override the top USD momentarily
  const el = $("netWorthUsd");
  if (el) el.textContent = `$${v.toFixed(2)}`;

  const pnlEl = $("netWorthPnl");
  if (pnlEl) {
    pnlEl.classList.remove("good", "bad", "flat");
    pnlEl.classList.add("flat");
    pnlEl.textContent = `Point: ${lab} • $${v.toFixed(2)}`;
  }
}

function nwRestoreRealtimeValue() {
  nwHoverActive = false;
  nwHoverIndex = null;
  nwPinnedIndex = null;
}

function attachNWInteractions() {
  const canvas = $("netWorthChart");
  if (!canvas || !netWorthChart) return;

  const onMove = (evt) => {
    const idx = nwGetIndexFromEvent(evt);
    if (idx == null) return;
    nwHoverActive = true;
    nwHoverIndex = idx;
    nwPinnedIndex = idx;
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
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["live", "1d", "1w", "1m", "1y", "all"].includes(tf)) return;

    // if hidden/locked, ignore
    if (btn.style.display === "none") return;

    nwTf = tf;
    qsa(".tf-btn", wrap).forEach(b => b.classList.toggle("active", (b.dataset.tf || "") === tf));
    saveNW();
    drawNW();
  }, { passive: true });

  // initial
  updateNWButtonsVisibility();
}

function attachNWScaleHandler() {
  const btn = $("nwScaleToggle");
  if (!btn) return;
  btn.textContent = (nwScale === "log") ? "LOG" : "LIN";

  btn.addEventListener("click", () => {
    nwScale = (nwScale === "lin") ? "log" : "lin";
    btn.textContent = (nwScale === "log") ? "LOG" : "LIN";
    saveNW();
    drawNW();
  }, { passive: true });
}

/* record long-series net worth (for 1D/1W/1M/1Y/ALL) */
function recordNetWorthPoint() {
  if (!address || !isValidInjAddr(address)) return;

  const px = safe(targetPrice);
  if (!Number.isFinite(px) || px <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;

  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

  const now = Date.now();
  const dt = now - safe(lastNWRecordedT);
  const dUsd = Math.abs(totalUsd - safe(lastNWRecordedUsd));

  // keep it permanent but not insane: every 15s OR if change >= $0.75
  if (lastNWRecordedT && dt < 15_000 && dUsd < 0.75) return;

  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);

  lastNWRecordedT = now;
  lastNWRecordedUsd = totalUsd;

  clampNWArrays();
  saveNW();

  // update chart only if not in hover mode
  if (!nwHoverActive) drawNW();
}

/* record LIVE series every 1s (permanent, capped) */
function recordNetWorthLiveSample(totalUsd) {
  if (!address || !isValidInjAddr(address)) return;
  const now = Date.now();
  if (now - lastLiveSampleT < NW_LIVE_SAMPLE_MS) return;
  lastLiveSampleT = now;

  const v = safe(totalUsd);
  if (!Number.isFinite(v) || v <= 0) return;

  nwLiveT.push(now);
  nwLiveUsd.push(v);

  clampNWArrays();
  saveNW();

  if (nwTf === "live") drawNW();
}

/* ================= EXPAND CHART OVERLAY (icon instead of drag text) ================= */
let expandOverlay = null;
let expandInner = null;
let expandBody = null;
let expandTitle = null;
let expandClose = null;

const expandState = {
  open: false,
  canvasId: null,
  placeholder: null,
  originalParent: null,
  originalNextSibling: null,
  chartGetter: null,
  title: "",
  prevBodyOverflow: "",
};

function ensureExpandOverlay() {
  if (expandOverlay) return;

  expandOverlay = document.createElement("div");
  expandOverlay.className = "expand";
  expandOverlay.id = "expandOverlay";
  expandOverlay.setAttribute("aria-hidden", "true");

  expandInner = document.createElement("div");
  expandInner.className = "expand-inner";

  const top = document.createElement("div");
  top.className = "expand-top";

  expandTitle = document.createElement("div");
  expandTitle.className = "expand-title";
  expandTitle.textContent = "Chart";

  const actions = document.createElement("div");
  actions.className = "expand-actions";

  expandClose = document.createElement("button");
  expandClose.type = "button";
  expandClose.className = "icon-btn";
  expandClose.textContent = "✕";
  expandClose.setAttribute("aria-label", "Close");

  actions.appendChild(expandClose);
  top.appendChild(expandTitle);
  top.appendChild(actions);

  expandBody = document.createElement("div");
  expandBody.className = "expand-body";

  expandInner.appendChild(top);
  expandInner.appendChild(expandBody);
  expandOverlay.appendChild(expandInner);
  document.body.appendChild(expandOverlay);

  expandClose.addEventListener("click", () => closeExpand(), { passive: true });
  expandOverlay.addEventListener("click", (e) => {
    if (e.target === expandOverlay) closeExpand();
  }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expandState.open) closeExpand();
  });
}

function openExpand(canvasId, chartGetter, title) {
  ensureExpandOverlay();

  if (expandState.open) closeExpand();

  const canvas = $(canvasId);
  if (!canvas) return;

  expandState.open = true;
  expandState.canvasId = canvasId;
  expandState.chartGetter = chartGetter;
  expandState.title = title || "Chart";

  expandState.originalParent = canvas.parentElement;
  expandState.originalNextSibling = canvas.nextSibling;

  // placeholder to keep layout
  expandState.placeholder = document.createElement("div");
  expandState.placeholder.style.height = `${canvas.getBoundingClientRect().height || 240}px`;
  expandState.placeholder.style.width = "100%";
  expandState.placeholder.style.borderRadius = "12px";
  expandState.placeholder.style.opacity = "0.15";
  expandState.placeholder.style.border = "1px dashed rgba(255,255,255,.12)";

  expandState.originalParent?.insertBefore(expandState.placeholder, expandState.originalNextSibling);

  expandTitle.textContent = expandState.title;

  // lock scroll
  expandState.prevBodyOverflow = document.body.style.overflow || "";
  document.body.style.overflow = "hidden";

  // move canvas
  expandBody.innerHTML = "";
  expandBody.appendChild(canvas);

  expandOverlay.classList.add("show");
  expandOverlay.setAttribute("aria-hidden", "false");

  const ch = chartGetter?.();
  if (ch) {
    // show x axis in expanded mode for better reading
    try {
      if (ch.options?.scales?.x) ch.options.scales.x.display = true;
      if (ch.options?.plugins?.legend) ch.options.plugins.legend.display = false;
      ch.resize();
      ch.update("none");
    } catch {}
  }
}

function closeExpand() {
  if (!expandState.open) return;

  const canvas = $(expandState.canvasId);
  if (canvas && expandState.originalParent) {
    // move back
    if (expandState.originalNextSibling) {
      expandState.originalParent.insertBefore(canvas, expandState.originalNextSibling);
    } else {
      expandState.originalParent.appendChild(canvas);
    }
  }
  // remove placeholder
  try { expandState.placeholder?.remove(); } catch {}

  expandOverlay?.classList.remove("show");
  expandOverlay?.setAttribute("aria-hidden", "true");

  document.body.style.overflow = expandState.prevBodyOverflow;

  const ch = expandState.chartGetter?.();
  if (ch) {
    try {
      // compact mode (small cards) – many charts hide x
      if (expandState.canvasId === "stakeChart" || expandState.canvasId === "rewardChart") {
        if (ch.options?.scales?.x) ch.options.scales.x.display = false;
      }
      ch.resize();
      ch.update("none");
    } catch {}
  }

  expandState.open = false;
  expandState.canvasId = null;
  expandState.placeholder = null;
  expandState.originalParent = null;
  expandState.originalNextSibling = null;
  expandState.chartGetter = null;
  expandState.title = "";
}

/* install expand icon button near a canvas (top-right of its card) */
function installExpandForCanvas(canvasId, chartGetter, title) {
  const canvas = $(canvasId);
  if (!canvas) return;

  const card = canvas.closest(".card");
  if (!card) return;

  // avoid duplicates
  if (card.querySelector(`[data-expand-for="${canvasId}"]`)) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn expand-btn";
  btn.textContent = "⤢";
  btn.setAttribute("aria-label", "Expand chart");
  btn.dataset.expandFor = canvasId;

  // position (works even with old HTML)
  btn.style.position = "absolute";
  btn.style.top = "12px";
  btn.style.right = "12px";
  btn.style.zIndex = "6";
  btn.style.opacity = "0.92";
  btn.style.width = "36px";
  btn.style.height = "36px";

  // ensure card can position absolute children
  const pos = getComputedStyle(card).position;
  if (pos === "static") card.style.position = "relative";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openExpand(canvasId, chartGetter, title);
  }, { passive: false });

  card.appendChild(btn);
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
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  pendingAddress = a;
  localStorage.setItem("inj_address", address);

  setAddressDisplay(address);
  settleStart = Date.now();

  // Restore snapshots first (so UI never restarts from 0 on refresh)
  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  loadAccountSnapshot();

  // reset displayed smoothly to restored values
  displayed.available = safe(availableInj);
  displayed.stake = safe(stakeInj);
  displayed.rewards = safe(rewardsInj);
  displayed.apr = safe(apr);
  displayed.netWorthUsd = (safe(availableInj) + safe(stakeInj) + safe(rewardsInj)) * safe(displayed.price);

  // stake series per address
  stakeLabels = []; stakeData = []; stakeMoves = []; stakeTypes = [];
  stakeBaselineCaptured = false; lastStakeRecordedRounded = null;
  loadStakeSeries();
  drawStakeChart();

  // reward withdrawals per address
  wdLabelsAll = []; wdValuesAll = []; wdTimesAll = [];
  wdLastRewardsSeen = null;
  wdMinFilter = safe($("rewardFilter")?.value || 0);
  loadWdAll();
  rebuildWdView();
  goRewardLive();

  // net worth per address
  nwTAll = []; nwUsdAll = []; nwInjAll = [];
  nwLiveT = []; nwLiveUsd = [];
  loadNW();
  updateNWButtonsVisibility();
  drawNW();

  modeLoading = true;
  refreshConnUI();

  if (liveMode) await loadAccount();
  else {
    refreshLoaded = false;
    refreshConnUI();
    await refreshLoadAllOnce();
  }
}

/* ================= ONLINE / OFFLINE listeners ================= */
window.addEventListener("online", () => {
  refreshConnUI();
  cloudSetState("synced");
  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) loadAccount();
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
  cloudSetState("synced");
}, { passive: true });

/* ================= BOOT ================= */
(function boot() {
  cloudLoad();
  cloudRender();
  cloudSetState("synced");
  ensureDrawerBottomMeta();

  // remove Net Worth “qty px row” if present (requested)
  const nwAssetRow = qs(".networth-asset");
  if (nwAssetRow) nwAssetRow.style.display = "none";

  refreshConnUI();
  setTimeout(() => setUIReady(true), 2800);

  attachRewardTimelineHandlers();
  attachRewardLiveHandler();
  attachRewardFilterHandler();

  pendingAddress = address || "";
  if (addressInput) addressInput.value = pendingAddress;
  setAddressDisplay(address);

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  // restore account snapshot so values don't start at 0
  if (address) loadAccountSnapshot();

  // load per-address series (permanent)
  if (address) {
    loadStakeSeries();
    drawStakeChart();

    loadWdAll();
    rebuildWdView();
    goRewardLive();

    loadNW();
    updateNWButtonsVisibility();
    drawNW();
  } else {
    // init charts anyway (so expand buttons exist later)
    drawStakeChart();
    drawRewardWdChart();
    drawNW();
  }

  modeLoading = true;
  refreshConnUI();

  // start price plumbing
  (async () => {
    await loadCandleSnapshot(liveMode ? false : true);
    await loadChartToday(liveMode ? false : true);

    if (liveMode) {
      startTradeWS();
      startKlineWS();
      if (address) await loadAccount();
      startAllTimers();
    } else {
      stopAllTimers();
      stopAllSockets();
      accountOnline = false;
      refreshLoaded = false;
      refreshConnUI();
      await refreshLoadAllOnce();
    }
  })();
})();

/* ================= MAIN LOOP ================= */
function animate() {
  // PRICE
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  // PERF arrows (colors are handled by CSS classes)
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  // Chart sign color
  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "flat");
  applyChartColorBySign(sign);

  const dUp = "linear-gradient(90deg, rgba(34,197,94,.55), rgba(16,185,129,.32))";
  const dDown = "linear-gradient(270deg, rgba(239,68,68,.55), rgba(248,113,113,.30))";

  const wUp = "linear-gradient(90deg, rgba(59,130,246,.55), rgba(99,102,241,.30))";
  const wDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(59,130,246,.26))";

  const mUp = "linear-gradient(90deg, rgba(249,115,22,.50), rgba(236,72,153,.28))";
  const mDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(236,72,153,.25))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"), $("weekLine"), targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);

  // Values + flash extremes
  const pMinEl = $("priceMin"), pMaxEl = $("priceMax");
  const wMinEl = $("weekMin"), wMaxEl = $("weekMax");
  const mMinEl = $("monthMin"), mMaxEl = $("monthMax");

  if (tfReady.d) {
    const low = safe(candle.d.low), high = safe(candle.d.high);
    setText("priceMin", low.toFixed(3));
    setText("priceOpen", safe(candle.d.open).toFixed(3));
    setText("priceMax", high.toFixed(3));
    if (lastExtremes.d.low !== null && low !== lastExtremes.d.low) flash(pMinEl);
    if (lastExtremes.d.high !== null && high !== lastExtremes.d.high) flash(pMaxEl);
    lastExtremes.d.low = low; lastExtremes.d.high = high;
  } else {
    setText("priceMin", "--"); setText("priceOpen", "--"); setText("priceMax", "--");
  }

  if (tfReady.w) {
    const low = safe(candle.w.low), high = safe(candle.w.high);
    setText("weekMin", low.toFixed(3));
    setText("weekOpen", safe(candle.w.open).toFixed(3));
    setText("weekMax", high.toFixed(3));
    if (lastExtremes.w.low !== null && low !== lastExtremes.w.low) flash(wMinEl);
    if (lastExtremes.w.high !== null && high !== lastExtremes.w.high) flash(wMaxEl);
    lastExtremes.w.low = low; lastExtremes.w.high = high;
  } else {
    setText("weekMin", "--"); setText("weekOpen", "--"); setText("weekMax", "--");
  }

  if (tfReady.m) {
    const low = safe(candle.m.low), high = safe(candle.m.high);
    setText("monthMin", low.toFixed(3));
    setText("monthOpen", safe(candle.m.open).toFixed(3));
    setText("monthMax", high.toFixed(3));
    if (lastExtremes.m.low !== null && low !== lastExtremes.m.low) flash(mMinEl);
    if (lastExtremes.m.high !== null && high !== lastExtremes.m.high) flash(mMaxEl);
    lastExtremes.m.low = low; lastExtremes.m.high = high;
  } else {
    setText("monthMin", "--"); setText("monthOpen", "--"); setText("monthMax", "--");
  }

  // AVAILABLE
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  setText("availableUsd", `≈ $${(displayed.available * displayed.price).toFixed(2)}`);

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  setText("stakeUsd", `≈ $${(displayed.stake * displayed.price).toFixed(2)}`);

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
  setText("rewardsUsd", `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`);

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
  const aprEl = $("apr");
  if (aprEl) {
    // keep percent sign
    colorNumberSuffix(aprEl, displayed.apr, oapr, 2, "%");
  }

  // Last update (keep at bottom in your HTML; JS just updates the text)
  const upd = $("updated");
  if (upd) upd.textContent = "Last update: " + fmtFullTime(Date.now());

  /* ================= NET WORTH UI ================= */
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  // don’t overwrite while hovering
  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);

    // keep PnL updated only when not hovering (drawNW is heavier, so don’t call every frame)
    // (LIVE samples will call drawNW when needed)
  }

  // Total INJ owned (single line)
  const injEl = $("netWorthInj");
  if (injEl) injEl.textContent = `${totalInj.toFixed(4)} INJ`;

  // LIVE samples always recorded (permanent) when address exists
  if (address && liveMode && isValidInjAddr(address)) {
    recordNetWorthLiveSample(displayed.netWorthUsd);

    // long TF series: still record, but throttled inside recordNetWorthPoint()
    recordNetWorthPoint();
  }

  refreshConnUI();
  ensureDrawerBottomMeta();

  // keep blinking dot fluid even without data updates
  if (netWorthChart) netWorthChart.draw();

  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/* ================= INIT UI & DATA ON ADDRESS ================= */
if (address) {
  // immediate load for stored address
  // (don’t block boot)
  commitAddress(address);
}

/* ================== END ================== */
