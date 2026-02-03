/* ============================================================
   Injective • Portfolio (app.js) — FULL FILE (plug&play)
   - Works with your HTML/CSS IDs (safe if some nodes missing)
   - LIVE Net Worth window: 5 minutes (rolling)
   - Other TF: 1D/1W/1M/1Y/ALL accumulate + unlock over time (no auto-scroll)
   - Persistent per-address data (stake/reward/networth/events) + optional cloud sync
   - Expand-in-card -> full-screen chart modal (pan/zoom + value overlay)
   - Pull-to-refresh only in REFRESH mode
   - Event page dedicated + toast notifications
   ============================================================ */

/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;

/* persistence */
const STAKE_LOCAL_VER = 3;
const RESET_STAKE_FROM_NOW_ON_BOOT = false;

const REWARD_WD_LOCAL_VER = 3;
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* NET WORTH persistence */
const NW_LOCAL_VER = 3;
const NW_MAX_POINTS = 48000; // bigger, since you want permanent series

/* EVENTS persistence */
const EVT_LOCAL_VER = 1;
const EVT_MAX_ITEMS = 4000;

/* LIVE NW window */
const NW_LIVE_WINDOW_MS = 5 * 60 * 1000; // 5 min rolling
const NW_LIVE_MAX_POINTS = 2200;         // safe cap (~5min @ ~150ms would be huge; we record slower)

/* NW record density */
const NW_MIN_DT_MS = 2500; // record at most every 2.5s unless meaningful change
const NW_MIN_DUSD  = 0.25;

/* REFRESH mode staging */
const REFRESH_RED_MS = 220;
let refreshLoaded = false;
let refreshLoading = false;

/* Status dot loading (switch / data loading) */
let modeLoading = false;

/* Cloud (optional) */
const CLOUD_VER = 2;
const CLOUD_ENDPOINT = "/api/point"; // optional; if missing -> graceful fallback
const CLOUD_PUSH_MS = 9000;
const CLOUD_PULL_MS = 12000;
const CLOUD_MIN_MERGE_MS = 1500;

/* Logo (high-res png) */
const INJ_LOGO_URL = "https://assets.crypto.ro/logos/injective-inj-logo.png";

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtHHMMSS(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function nowLabel() { return new Date().toLocaleTimeString(); }
function shortAddr(a) { return a && a.length > 18 ? (a.slice(0, 10) + "…" + a.slice(-6)) : (a || ""); }
function setText(id, txt){ const el = $(id); if (el) el.textContent = txt; }
function hasInternet() { return navigator.onLine === true; }

function fmtSmart(v){
  v = safe(v);
  const av = Math.abs(v);
  if (av >= 1000) return v.toFixed(0);
  if (av >= 100) return v.toFixed(1);
  if (av >= 10) return v.toFixed(2);
  if (av >= 1) return v.toFixed(3);
  if (av >= 0.1) return v.toFixed(4);
  return v.toFixed(6);
}

/* ================= DIGIT COLORING (price-like animation) ================= */
function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  const base = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i]
      ? (n > o ? "#22c55e" : "#ef4444")
      : base;
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

function colorMoney(el, n, o, decimals = 2){
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
  for (let i = 0; i < ns.length; i++){
    const c = ns[i];
    const oc = os[i];
    const col = (c !== oc) ? (dir === "up" ? upCol : dnCol) : baseCol;
    out.push(`<span style="color:${col}">${c}</span>`);
  }
  el.innerHTML = out.join("");
}

function colorApproxMoney(el, n, o){
  if (!el) return;
  n = safe(n); o = safe(o);
  // keep "≈ $" prefix
  const ns = n.toFixed(2);
  const os = o.toFixed(2);
  if (ns === os) { el.textContent = `≈ $${ns}`; return; }
  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dir = (n > o) ? "up" : "down";
  const out = [`<span style="color:${baseCol}">≈ $</span>`];
  for (let i = 0; i < ns.length; i++){
    const c = ns[i];
    const oc = os[i];
    const col = (c !== oc) ? (dir === "up" ? upCol : dnCol) : baseCol;
    out.push(`<span style="color:${col}">${c}</span>`);
  }
  el.innerHTML = out.join("");
}

/* ================= GLOBAL ERROR GUARDS ================= */
function setStatusError(msg){
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
const MODE_KEY  = "inj_mode"; // live | refresh

let theme    = localStorage.getItem(THEME_KEY) || "dark";
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";

function axisGridColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)";
}
function axisTickColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)";
}

function applyTheme(t){
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
function tryRegisterZoom(){
  try{
    if (!window.Chart) return false;
    const plug = window.ChartZoom || window["chartjs-plugin-zoom"];
    if (plug) Chart.register(plug);
    const has = !!(Chart?.registry?.plugins?.get && Chart.registry.plugins.get("zoom"));
    return has;
  } catch (e){
    console.warn("Zoom plugin not available:", e);
    return false;
  }
}
ZOOM_OK = tryRegisterZoom();

/* ================= SAFE FETCH ================= */
async function fetchJSON(url, opts = undefined) {
  try {
    const res = await fetch(url, { cache: "no-store", ...(opts || {}) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

/* ================= CONNECTION UI ================= */
const statusDot  = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

let address = localStorage.getItem("inj_address") || "";
let pendingAddress = address || "";

function liveReady(){
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline; // if no wallet set, don't block green
  return socketsOk && accountOk;
}

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
const tfReady = { d: false, w: false, m: false };
function setUIReady(force=false){
  const root = $("appRoot");
  if (!root) return;
  if (root.classList.contains("ready")) return;
  if (!force && !tfReady.d) return;
  root.classList.remove("loading");
  root.classList.add("ready");
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
  const arrow = $(arrowId), pct = $(pctId);
  if (!arrow || !pct) return;

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= BAR RENDER ================= */
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

/* ================= FLASH EXTREMES ================= */
const lastExtremes = { d:{low:null,high:null}, w:{low:null,high:null}, m:{low:null,high:null} };
function flash(el) {
  if (!el) return;
  el.classList.remove("flash-yellow");
  void el.offsetWidth;
  el.classList.add("flash-yellow");
}

/* ================= HEADER SEARCH UI ================= */
const searchWrap = $("searchWrap");
const searchBtn = $("searchBtn");
const addressInput = $("addressInput");
const addressDisplay = $("addressDisplay");
const menuBtn = $("menuBtn");

function setAddressDisplay(addr) {
  if (!addressDisplay) return;
  if (!addr) { addressDisplay.innerHTML = ""; return; }
  addressDisplay.innerHTML = `<span class="tag"><strong>Wallet</strong>: ${shortAddr(addr)}</span>`;
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

if (addressInput) addressInput.value = ""; // keep empty by default

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
      addressInput.value = "";     // ✅ after search, clear bar
      pendingAddress = "";
      closeSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      addressInput.value = "";
      pendingAddress = "";
      closeSearch();
    }
  });
}

/* close only on true outside click */
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

function openDrawer(){
  isDrawerOpen = true;
  document.body.classList.add("drawer-open");
  drawer?.setAttribute("aria-hidden", "false");
  backdrop?.setAttribute("aria-hidden", "false");
}
function closeDrawer(){
  isDrawerOpen = false;
  document.body.classList.remove("drawer-open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.setAttribute("aria-hidden", "true");
}
function toggleDrawer(){ isDrawerOpen ? closeDrawer() : openDrawer(); }

menuBtn?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  toggleDrawer();
}, { passive: false });

backdrop?.addEventListener("click", () => closeDrawer(), { passive:true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    closeComingSoon();
    closeChartModal();
  }
});

themeToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive:false });

/* ================= COMING SOON overlay (fixed: always closable) ================= */
const comingSoon = $("comingSoon");
const comingTitle = $("comingTitle");
const comingSub = $("comingSub");
const comingClose = $("comingClose");

function pageLabel(key){
  if (key === "home") return "HOME";
  if (key === "market") return "MARKET";
  if (key === "event") return "EVENT";
  if (key === "settings") return "SETTINGS";
  return "PAGE";
}
function openComingSoon(pageKey){
  if (!comingSoon) return;
  if (comingTitle) comingTitle.textContent = `COMING SOON 🚀`;
  if (comingSub) comingSub.textContent = `${pageLabel(pageKey)} is coming soon.`;
  comingSoon.classList.add("show");
  comingSoon.setAttribute("aria-hidden", "false");
}
function closeComingSoon(){
  if (!comingSoon) return;
  comingSoon.classList.remove("show");
  comingSoon.setAttribute("aria-hidden", "true");
}
comingClose?.addEventListener("click", (e) => { e?.preventDefault?.(); closeComingSoon(); }, { passive:false });
comingSoon?.addEventListener("click", (e) => { if (e.target === comingSoon) closeComingSoon(); }, { passive:true });

/* ================= PAGE SYSTEM (Dashboard + Event page) ================= */
let pageDashboard = $("pageDashboard");
let pageEvents = $("pageEvents");

function ensurePages(){
  const root = $("appRoot");
  const cardsWrap = root?.querySelector?.(".cards-wrapper") || $("cardsWrapper") || null;
  if (!root || !cardsWrap) return;

  if (!pageDashboard) {
    pageDashboard = document.createElement("div");
    pageDashboard.id = "pageDashboard";
    pageDashboard.className = "page page-dashboard";
    // move cards wrapper inside
    cardsWrap.parentNode.insertBefore(pageDashboard, cardsWrap);
    pageDashboard.appendChild(cardsWrap);
  }

  if (!pageEvents) {
    pageEvents = document.createElement("div");
    pageEvents.id = "pageEvents";
    pageEvents.className = "page page-events";
    pageEvents.style.display = "none";
    root.insertBefore(pageEvents, root.querySelector(".last-update") || null);

    pageEvents.innerHTML = `
      <div class="card" id="eventsCard">
        <div class="label">Events</div>
        <div class="sub-row" style="text-align:left;margin-top:6px;">
          On-chain + price notifications (saved per wallet)
        </div>
        <div style="margin-top:12px; overflow:auto;">
          <table class="evt-table" style="width:100%; border-collapse:separate; border-spacing:0 10px;">
            <thead>
              <tr style="opacity:.8; font-size:.78rem;">
                <th style="text-align:left; padding:0 6px;">Event</th>
                <th style="text-align:left; padding:0 6px;">Date</th>
                <th style="text-align:right; padding:0 6px;">Move</th>
                <th style="text-align:right; padding:0 6px;">Status</th>
              </tr>
            </thead>
            <tbody id="eventsTbody"></tbody>
          </table>
        </div>
        <div id="eventsEmpty" class="sub-row" style="text-align:left; margin-top:8px;">No events yet.</div>
      </div>
    `;
  }
}

function showPage(key){
  ensurePages();
  if (!pageDashboard || !pageEvents) return;

  if (key === "dashboard") {
    pageDashboard.style.display = "";
    pageEvents.style.display = "none";
  } else if (key === "event") {
    pageDashboard.style.display = "none";
    pageEvents.style.display = "";
    renderEventsTable();
  }
}

function setActivePage(pageKey){
  const items = drawerNav?.querySelectorAll(".nav-item") || [];
  items.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageKey));
}

drawerNav?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".nav-item");
  if (!btn) return;
  const page = btn.dataset.page || "dashboard";
  setActivePage(page);
  closeDrawer();

  if (page === "dashboard") {
    closeComingSoon();
    showPage("dashboard");
    return;
  }

  if (page === "event") {
    closeComingSoon();
    showPage("event");
    return;
  }

  // other pages => coming soon (and closable)
  showPage("dashboard");
  openComingSoon(page);
}, { passive:true });

/* ================= MODE SWITCH ================= */
let accountPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;
let cloudPushTimer = null;
let cloudPullTimer = null;

function stopAllTimers(){
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
  if (cloudPushTimer) { clearInterval(cloudPushTimer); cloudPushTimer = null; }
  if (cloudPullTimer) { clearInterval(cloudPullTimer); cloudPullTimer = null; }
}

function startAllTimers(){
  stopAllTimers();
  accountPollTimer = setInterval(loadAccount, ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(loadCandleSnapshot, REST_SYNC_MS);
  chartSyncTimer = setInterval(loadChartToday, CHART_SYNC_MS);
  ensureChartTimer = setInterval(ensureChartBootstrapped, 1500);

  cloudPushTimer = setInterval(() => cloudMaybePush(false), CLOUD_PUSH_MS);
  cloudPullTimer = setInterval(() => cloudMaybePull(false), CLOUD_PULL_MS);
}

async function refreshLoadAllOnce(){
  if (refreshLoading) return;
  if (!hasInternet()) { refreshLoaded = false; refreshConnUI(); cloudSetState("synced"); return; }

  refreshLoading = true;
  refreshLoaded = false;
  modeLoading = true;
  refreshConnUI();

  try{
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

function setMode(isLive){
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
}, { passive:false });

/* ================= CLOUD UI + STORAGE ================= */
const CLOUD_KEY = `inj_cloud_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;
let cloudState = "synced";
let cloudLastPushAt = 0;
let cloudLastPullAt = 0;

function cloudLoad(){
  try{
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj) return;
    cloudPts = safe(obj.pts);
    cloudLastSync = safe(obj.lastSync);
  } catch {}
}

function cloudSaveLocal(){
  try{
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ v: CLOUD_VER, pts: cloudPts, lastSync: cloudLastSync }));
    return true;
  } catch {
    return false;
  }
}

function cloudSetState(state){
  cloudState = state || "synced";
  const root = $("appRoot");
  const st = $("cloudStatus");
  const st2 = $("drawerCloudStatus"); // optional
  const ptsEl = $("cloudHistory");
  const pts2 = $("drawerCloudPoints");

  if (root) root.classList.remove("cloud-synced","cloud-saving","cloud-error");

  const label = (() => {
    if (!hasInternet()) return "Cloud: Offline cache";
    if (cloudState === "saving") return "Cloud: Saving";
    if (cloudState === "error") return "Cloud: Error";
    return "Cloud: Synced";
  })();

  if (root) root.classList.add(cloudState === "saving" ? "cloud-saving" : cloudState === "error" ? "cloud-error" : "cloud-synced");
  if (st) st.textContent = label;
  if (st2) st2.textContent = label;

  if (ptsEl) ptsEl.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;
  if (pts2) pts2.textContent = `${Math.max(0, Math.floor(cloudPts))} pts`;
}

function cloudBump(points = 1){
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();
  cloudSaveLocal();
  cloudSetState("saving");
  setTimeout(() => cloudSetState("synced"), 520);
}

function cloudKeyForAddress(addr){
  const a = (addr || "").trim();
  return a ? `inj_state_v${CLOUD_VER}_${a}` : null;
}

function buildCloudPayload(){
  // compact state bundle per address
  return {
    v: CLOUD_VER,
    at: Date.now(),
    addr: address || "",
    stake: {
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    },
    wd: {
      labelsAll: wdLabelsAll, valuesAll: wdValuesAll, timesAll: wdTimesAll,
      minFilter: wdMinFilter
    },
    nw: {
      tAll: nwTAll, usdAll: nwUsdAll, injAll: nwInjAll,
      tf: nwTf, scale: nwScale, anchors: nwAnchors
    },
    ev: {
      items: eventsAll
    }
  };
}

function mergeArrayByIndex(a, b, maxLen){
  // simplistic fallback
  const out = Array.isArray(a) ? a.slice() : [];
  if (Array.isArray(b)) out.push(...b);
  if (maxLen && out.length > maxLen) return out.slice(-maxLen);
  return out;
}

function mergeNW(remoteNW){
  if (!remoteNW) return;

  const rt = Array.isArray(remoteNW.tAll) ? remoteNW.tAll.map(Number) : [];
  const ru = Array.isArray(remoteNW.usdAll) ? remoteNW.usdAll.map(Number) : [];
  const ri = Array.isArray(remoteNW.injAll) ? remoteNW.injAll.map(Number) : [];

  if (!rt.length || rt.length !== ru.length || rt.length !== ri.length) return;

  // merge by timestamp
  const map = new Map();
  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    if (!t) continue;
    map.set(t, { usd: safe(nwUsdAll[i]), inj: safe(nwInjAll[i]) });
  }
  for (let i = 0; i < rt.length; i++){
    const t = safe(rt[i]);
    if (!t) continue;
    // remote overwrites if exists (assume newer truth)
    map.set(t, { usd: safe(ru[i]), inj: safe(ri[i]) });
  }

  const keys = [...map.keys()].sort((a,b)=>a-b);
  nwTAll = [];
  nwUsdAll = [];
  nwInjAll = [];
  for (const t of keys){
    const v = map.get(t);
    nwTAll.push(t);
    nwUsdAll.push(safe(v?.usd));
    nwInjAll.push(safe(v?.inj));
  }
  clampNWArrays();

  // merge settings
  if (remoteNW.tf) nwTf = remoteNW.tf;
  if (remoteNW.scale) nwScale = remoteNW.scale;
  if (remoteNW.anchors && typeof remoteNW.anchors === "object") {
    nwAnchors = { ...nwAnchors, ...remoteNW.anchors };
  }

  nwNeedsRedraw = true;
}

function mergeStake(remoteStake){
  if (!remoteStake) return;
  const rl = Array.isArray(remoteStake.labels) ? remoteStake.labels : [];
  const rd = Array.isArray(remoteStake.data) ? remoteStake.data.map(Number) : [];
  const rm = Array.isArray(remoteStake.moves) ? remoteStake.moves.map(Number) : [];
  const rt = Array.isArray(remoteStake.types) ? remoteStake.types : [];

  if (!rd.length) return;

  // merge by label+value signature (best-effort)
  const keySet = new Set();
  const outL = [];
  const outD = [];
  const outM = [];
  const outT = [];

  function addOne(L,D,M,T){
    const sig = `${String(L)}|${Number(D).toFixed(6)}`;
    if (keySet.has(sig)) return;
    keySet.add(sig);
    outL.push(L);
    outD.push(D);
    outM.push(M);
    outT.push(T);
  }

  for (let i = 0; i < stakeData.length; i++) addOne(stakeLabels[i], safe(stakeData[i]), safe(stakeMoves[i]), stakeTypes[i] || "Stake update");
  for (let i = 0; i < rd.length; i++) addOne(rl[i] || nowLabel(), safe(rd[i]), safe(rm[i]), rt[i] || "Stake update");

  // keep most recent only
  const max = 5000;
  const n = outD.length;
  const start = n > max ? n - max : 0;

  stakeLabels = outL.slice(start);
  stakeData = outD.slice(start);
  stakeMoves = outM.slice(start);
  stakeTypes = outT.slice(start);

  stakeBaselineCaptured = stakeData.length > 0;
  lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;

  drawStakeChart();
}

function mergeWd(remoteWd){
  if (!remoteWd) return;
  const rl = Array.isArray(remoteWd.labelsAll) ? remoteWd.labelsAll : [];
  const rv = Array.isArray(remoteWd.valuesAll) ? remoteWd.valuesAll.map(Number) : [];
  const rt = Array.isArray(remoteWd.timesAll) ? remoteWd.timesAll.map(Number) : [];
  if (!rv.length || rv.length !== rl.length || rv.length !== rt.length) return;

  const map = new Map();
  for (let i = 0; i < wdTimesAll.length; i++){
    const t = safe(wdTimesAll[i]);
    if (!t) continue;
    map.set(t, { label: wdLabelsAll[i], val: safe(wdValuesAll[i]) });
  }
  for (let i = 0; i < rt.length; i++){
    const t = safe(rt[i]);
    if (!t) continue;
    map.set(t, { label: rl[i], val: safe(rv[i]) });
  }
  const keys = [...map.keys()].sort((a,b)=>a-b);
  wdTimesAll = [];
  wdLabelsAll = [];
  wdValuesAll = [];
  for (const t of keys){
    const v = map.get(t);
    wdTimesAll.push(t);
    wdLabelsAll.push(v?.label || fmtHHMMSS(t));
    wdValuesAll.push(safe(v?.val));
  }
  rebuildWdView();
}

function mergeEvents(remoteEv){
  if (!remoteEv) return;
  const ri = Array.isArray(remoteEv.items) ? remoteEv.items : [];
  if (!ri.length) return;

  const map = new Map();
  for (const e of eventsAll){
    const id = String(e?.id || "");
    if (id) map.set(id, e);
  }
  for (const e of ri){
    const id = String(e?.id || "");
    if (!id) continue;
    map.set(id, e);
  }
  const out = [...map.values()].sort((a,b)=>safe(b?.t)-safe(a?.t));
  eventsAll = out.slice(0, EVT_MAX_ITEMS);
  saveEvents();
  renderEventsTable();
}

async function cloudPut(key, payload){
  if (!key || !hasInternet()) return false;
  const body = JSON.stringify({ key, payload });
  const res = await fetchJSON(CLOUD_ENDPOINT, { method: "POST", headers: { "Content-Type":"application/json" }, body });
  return !!res?.ok;
}

async function cloudGet(key){
  if (!key || !hasInternet()) return null;
  const q = encodeURIComponent(key);
  const res = await fetchJSON(`${CLOUD_ENDPOINT}?key=${q}`);
  if (!res || !res.ok) return null;
  return res.payload || null;
}

async function cloudMaybePush(force){
  if (!address) return;
  const key = cloudKeyForAddress(address);
  if (!key) return;
  if (!hasInternet()) return;
  const now = Date.now();
  if (!force && (now - cloudLastPushAt) < CLOUD_PUSH_MS) return;

  cloudSetState("saving");
  const ok = await cloudPut(key, buildCloudPayload()).catch(() => false);
  cloudLastPushAt = now;
  if (ok) {
    cloudBump(1);
    cloudSetState("synced");
  } else {
    cloudSetState("synced"); // still show offline cache if needed
  }
}

async function cloudMaybePull(force){
  if (!address) return;
  const key = cloudKeyForAddress(address);
  if (!key) return;
  if (!hasInternet()) return;
  const now = Date.now();
  if (!force && (now - cloudLastPullAt) < CLOUD_PULL_MS) return;

  const payload = await cloudGet(key).catch(() => null);
  cloudLastPullAt = now;
  if (!payload || payload.addr !== address) return;

  // merge with local
  mergeNW(payload.nw);
  mergeStake(payload.stake);
  mergeWd(payload.wd);
  mergeEvents(payload.ev);

  // redraw after merge
  drawNW();
  drawStakeChart();
  drawRewardWdChart();

  cloudSetState("synced");
}

/* ================= PULL TO REFRESH (only REFRESH mode) ================= */
let ptr = { active:false, startY:0, dy:0, armed:false };
let ptrEl = null;

function ensurePullToRefreshUI(){
  if (ptrEl) return;
  const root = document.body;
  ptrEl = document.createElement("div");
  ptrEl.id = "ptrIndicator";
  ptrEl.style.position = "fixed";
  ptrEl.style.left = "0";
  ptrEl.style.right = "0";
  ptrEl.style.top = "0";
  ptrEl.style.height = "54px";
  ptrEl.style.transform = "translateY(-60px)";
  ptrEl.style.display = "grid";
  ptrEl.style.placeItems = "center";
  ptrEl.style.zIndex = "200";
  ptrEl.style.pointerEvents = "none";
  ptrEl.innerHTML = `
    <div style="
      display:flex;align-items:center;gap:10px;
      padding:10px 14px;border-radius:999px;
      background:rgba(0,0,0,0.35);backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,0.10);
      color:rgba(249,250,251,0.92);
      font-weight:900;font-size:.82rem;">
      <span id="ptrSpinner" style="
        width:16px;height:16px;border-radius:50%;
        border:2px solid rgba(249,250,251,0.35);
        border-top-color: rgba(250,204,21,0.95);
        display:inline-block;
        animation: ptrSpin .9s linear infinite;"></span>
      <span id="ptrText">Pull to refresh</span>
    </div>
    <style>
      @keyframes ptrSpin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
    </style>
  `;
  root.appendChild(ptrEl);
}

function ptrSet(y){
  if (!ptrEl) return;
  ptrEl.style.transform = `translateY(${y}px)`;
}
function ptrText(t){
  const el = $("ptrText");
  if (el) el.textContent = t;
}

function attachPullToRefresh(){
  ensurePullToRefreshUI();

  window.addEventListener("touchstart", (e) => {
    if (liveMode) return; // ✅ only in refresh mode
    if (!hasInternet()) return;
    if (window.scrollY > 0) return;

    ptr.active = true;
    ptr.armed = false;
    ptr.dy = 0;
    ptr.startY = e.touches?.[0]?.clientY ?? 0;
    ptrSet(-60);
    ptrText("Pull to refresh");
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!ptr.active) return;
    const y = e.touches?.[0]?.clientY ?? 0;
    const dy = Math.max(0, y - ptr.startY);
    ptr.dy = dy;
    const eased = Math.min(62, dy * 0.45);
    ptrSet(-60 + eased);

    ptr.armed = eased >= 34;
    ptrText(ptr.armed ? "Release to refresh" : "Pull to refresh");
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (!ptr.active) return;
    const armed = ptr.armed;
    ptr.active = false;
    ptr.armed = false;

    if (!armed) {
      ptrSet(-60);
      return;
    }

    ptrText("Refreshing…");
    ptrSet(-10);
    await refreshLoadAllOnce();
    setTimeout(() => ptrSet(-60), 450);
  }, { passive: true });

  window.addEventListener("touchcancel", () => {
    ptr.active = false;
    ptr.armed = false;
    ptrSet(-60);
  }, { passive: true });
}

/* ================= CHART MODAL (expand inside card) ================= */
let chartModal = null;
let modalChart = null;
let modalTitleEl = null;
let modalValueEl = null;
let modalCanvas = null;
let modalActiveChartId = null;

function ensureChartModal(){
  if (chartModal) return;

  chartModal = document.createElement("div");
  chartModal.id = "chartModal";
  chartModal.style.position = "fixed";
  chartModal.style.inset = "0";
  chartModal.style.zIndex = "250";
  chartModal.style.display = "none";
  chartModal.style.background = "rgba(0,0,0,.55)";
  chartModal.style.backdropFilter = "blur(12px)";
  chartModal.style.webkitBackdropFilter = "blur(12px)";
  chartModal.style.padding = "14px";

  chartModal.innerHTML = `
    <div id="chartModalCard" style="
      width: min(980px, 96vw);
      height: min(760px, 86vh);
      margin: 0 auto;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.10);
      background: linear-gradient(135deg, rgba(11,18,32,.96), rgba(17,28,47,.92));
      box-shadow: 0 30px 120px rgba(0,0,0,.65);
      display:flex; flex-direction:column; overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 12px 10px 12px;">
        <div>
          <div id="chartModalTitle" style="font-weight:950; letter-spacing:.02em;">Chart</div>
          <div id="chartModalValue" style="margin-top:4px; font-size:.85rem; opacity:.85;">—</div>
        </div>
        <button id="chartModalClose" style="
          width:40px;height:40px;border-radius:14px;
          border:1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.06);
          color: rgba(249,250,251,.92);
          font-weight:950; cursor:pointer;">✕</button>
      </div>
      <div style="flex:1; padding: 8px 12px 14px 12px;">
        <canvas id="chartModalCanvas" style="width:100%;height:100%;"></canvas>
      </div>
    </div>
  `;
  document.body.appendChild(chartModal);

  modalTitleEl = $("chartModalTitle");
  modalValueEl = $("chartModalValue");
  modalCanvas = $("chartModalCanvas");

  $("chartModalClose")?.addEventListener("click", () => closeChartModal(), { passive:true });
  chartModal.addEventListener("click", (e) => { if (e.target === chartModal) closeChartModal(); }, { passive:true });
}

function closeChartModal(){
  if (!chartModal) return;
  chartModal.style.display = "none";
  document.body.style.overflow = "";
  modalActiveChartId = null;
  try { modalChart?.destroy?.(); } catch {}
  modalChart = null;
}

function cloneOptionsForModal(baseOptions){
  const opt = JSON.parse(JSON.stringify(baseOptions || {}));
  opt.responsive = true;
  opt.maintainAspectRatio = false;
  opt.animation = false;

  // ensure zoom/pan
  if (ZOOM_OK) {
    opt.plugins = opt.plugins || {};
    opt.plugins.zoom = opt.plugins.zoom || {};
    opt.plugins.zoom.pan = { enabled: true, mode: "x", threshold: 2 };
    opt.plugins.zoom.zoom = { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" };
  }
  return opt;
}

function openChartModal(kind){
  ensureChartModal();

  let src = null;
  if (kind === "price") src = chart;
  else if (kind === "stake") src = stakeChart;
  else if (kind === "reward") src = rewardChart;
  else if (kind === "networth") src = netWorthChart;

  if (!src || !modalCanvas || !window.Chart) return;

  modalActiveChartId = kind;
  if (modalTitleEl) {
    modalTitleEl.textContent =
      kind === "price" ? "INJ • 1D Price" :
      kind === "stake" ? "Stake • History" :
      kind === "reward" ? "Rewards • Withdrawals" :
      "Net Worth • History";
  }
  if (modalValueEl) modalValueEl.textContent = "Drag / zoom to explore";

  document.body.style.overflow = "hidden";
  chartModal.style.display = "grid";
  chartModal.style.placeItems = "center";

  const data = JSON.parse(JSON.stringify(src.data || {}));
  const opt  = cloneOptionsForModal(src.options || {});

  // We want a value readout on move
  const valuePlugin = {
    id: "modalValuePlugin",
    afterEvent(ch, args){
      const evt = args?.event;
      if (!evt) return;
      if (evt.type !== "mousemove" && evt.type !== "touchmove" && evt.type !== "click") return;

      const points = ch.getElementsAtEventForMode(evt, "index", { intersect:false }, false);
      if (!points?.length) return;

      const i = points[0].index;
      const v = safe(ch.data.datasets?.[0]?.data?.[i]);
      const lab = ch.data.labels?.[i] ?? "";
      if (!Number.isFinite(v)) return;

      if (modalValueEl) {
        if (kind === "networth") modalValueEl.textContent = `${lab} • $${v.toFixed(2)}`;
        else if (kind === "price") modalValueEl.textContent = `${lab} • $${v.toFixed(4)}`;
        else if (kind === "stake") modalValueEl.textContent = `${lab} • ${v.toFixed(6)} INJ`;
        else modalValueEl.textContent = `${lab} • +${v.toFixed(6)} INJ`;
      }
    }
  };

  try { modalChart?.destroy?.(); } catch {}
  modalChart = new Chart(modalCanvas, {
    type: src.config?.type || "line",
    data,
    options: opt,
    plugins: [valuePlugin]
  });
}

function ensureExpandButtons(){
  // If your HTML already has buttons, we just bind them.
  // If not, we inject for cards that contain a canvas.
  const cards = document.querySelectorAll(".card");
  cards.forEach((card) => {
    const hasCanvas = !!card.querySelector("canvas");
    if (!hasCanvas) return;

    let btn = card.querySelector(".card-expand");
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "card-expand";
      btn.type = "button";
      btn.setAttribute("aria-label", "Expand");
      btn.textContent = "⤢";
      // minimal inline style fallback (your CSS should override)
      btn.style.position = "absolute";
      btn.style.top = "10px";
      btn.style.right = "10px";
      btn.style.width = "32px";
      btn.style.height = "32px";
      btn.style.borderRadius = "12px";
      btn.style.border = "1px solid rgba(255,255,255,.10)";
      btn.style.background = "rgba(255,255,255,.06)";
      btn.style.color = "rgba(249,250,251,.92)";
      btn.style.cursor = "pointer";
      card.style.position = "relative";
      card.appendChild(btn);
    }

    // bind once
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const c = btn.closest(".card");
      const canvas = c?.querySelector("canvas");
      const id = canvas?.id || "";

      if (id === "priceChart") openChartModal("price");
      else if (id === "stakeChart") openChartModal("stake");
      else if (id === "rewardChart") openChartModal("reward");
      else if (id === "netWorthChart") openChartModal("networth");
    }, { passive:false });
  });
}

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = {
  price: 0,
  available: 0,
  availableUsd: 0,
  stake: 0,
  stakeUsd: 0,
  rewards: 0,
  rewardsUsd: 0,
  apr: 0,
  netWorthUsd: 0
};

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 },
  w: { t: 0, open: 0, high: 0, low: 0 },
  m: { t: 0, open: 0, high: 0, low: 0 },
};

/* ================= WS (price + klines) ================= */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

function stopAllSockets(){
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
    candle[intervalKey].low  = l;
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
let validator = { addr:"", moniker:"", status:"idle" }; // status: idle|loading|ok|offline

async function resolveValidatorMoniker(valAddr){
  if (!valAddr || !hasInternet()) return "";
  const base = "https://lcd.injective.network";
  const v = await fetchJSON(`${base}/cosmos/staking/v1beta1/validators/${valAddr}`);
  const moniker = v?.validator?.description?.moniker || "";
  return String(moniker || "");
}

function setValidatorUI(state){
  // expects optional ids: validatorName, validatorDot
  const nameEl = $("validatorName");
  const dotEl = $("validatorDot");

  if (nameEl) nameEl.textContent = validator.moniker ? validator.moniker : (validator.addr ? shortAddr(validator.addr) : "—");

  const st = state || validator.status;
  if (!dotEl) return;

  if (!hasInternet()) {
    dotEl.style.background = "#ef4444";
    dotEl.style.animation = "pulse 1.7s infinite";
    return;
  }

  if (st === "loading") {
    dotEl.style.background = "#f59e0b";
    dotEl.style.animation = "pulse 1.2s infinite";
  } else if (st === "ok") {
    dotEl.style.background = "#22c55e";
    dotEl.style.animation = "none";
  } else {
    dotEl.style.background = "#9ca3af";
    dotEl.style.animation = "none";
  }
}

function ensureValidatorMiniBlock(){
  // If HTML already has it, do nothing.
  const nwFoot = document.querySelector(".networth-foot");
  if (!nwFoot) return;

  if ($("validatorName") && $("validatorDot")) return;

  const card = document.createElement("div");
  card.className = "nw-mini nw-mini-validator";
  card.style.marginTop = "10px";

  card.innerHTML = `
    <div class="nw-mini-left">
      <span class="nw-coin-logo" style="background: rgba(245,158,11,.14);">
        <span style="font-size:18px;">🛡️</span>
      </span>
      <div class="nw-mini-meta">
        <div class="nw-mini-title">Validator</div>
        <div class="nw-mini-sub" id="validatorName">—</div>
      </div>
    </div>
    <div class="nw-mini-right" style="display:flex;align-items:center;gap:10px;">
      <span id="validatorDot" style="
        width:10px;height:10px;border-radius:50%;
        background:#9ca3af; display:inline-block;"></span>
    </div>
  `;
  nwFoot.appendChild(card);
  setValidatorUI("idle");
}

async function loadAccount(isRefresh=false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet()) {
    accountOnline = false;
    validator.status = hasInternet() ? "idle" : "offline";
    setValidatorUI(validator.status);
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
    validator.status = hasInternet() ? "idle" : "offline";
    setValidatorUI(validator.status);
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

  const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  rewardsInj = newRewards;

  apr = safe(i.inflation) * 100;

  // Validator info from first delegation
  try{
    const valAddr = delegations?.[0]?.delegation?.validator_address || "";
    if (valAddr && valAddr !== validator.addr) {
      validator.addr = valAddr;
      validator.moniker = "";
      validator.status = "loading";
      setValidatorUI("loading");
      const mon = await resolveValidatorMoniker(valAddr);
      validator.moniker = mon || shortAddr(valAddr);
      validator.status = "ok";
      setValidatorUI("ok");
    } else if (valAddr && validator.status !== "ok") {
      validator.status = "ok";
      setValidatorUI("ok");
    }
  } catch {
    // ignore
  }

  // Persist charts/events
  const stakeDeltaEvt = maybeAddStakePoint(stakeInj);
  if (stakeDeltaEvt) pushEvent(stakeDeltaEvt);

  const wdEvt = maybeRecordRewardWithdrawal(rewardsInj);
  if (wdEvt) pushEvent(wdEvt);

  // Net worth record point
  const nwEvt = recordNetWorthPoint();
  if (nwEvt) pushEvent(nwEvt);

  setUIReady(true);
}

/* ================= BINANCE REST: snapshot candele 1D/1W/1M ================= */
async function loadCandleSnapshot(isRefresh=false) {
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
    candle.d.low  = safe(d[0][3]);
    if (candle.d.open && candle.d.high && candle.d.low) tfReady.d = true;
  }
  if (Array.isArray(w) && w[0]) {
    candle.w.t = safe(w[0][0]);
    candle.w.open = safe(w[0][1]);
    candle.w.high = safe(w[0][2]);
    candle.w.low  = safe(w[0][3]);
    if (candle.w.open && candle.w.high && candle.w.low) tfReady.w = true;
  }
  if (Array.isArray(m) && m[0]) {
    candle.m.t = safe(m[0][0]);
    candle.m.open = safe(m[0][1]);
    candle.m.high = safe(m[0][2]);
    candle.m.low  = safe(m[0][3]);
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

async function loadChartToday(isRefresh=false) {
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;
  if (!tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  chartLabels = kl.map(k => fmtHHMM(safe(k[0])));
  chartData   = kl.map(k => safe(k[4]));
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

/* ================= STAKE CHART (persist) ================= */
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
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    }));
    cloudBump(1);
  } catch {
    cloudSetState("error");
  }
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
    stakeData   = Array.isArray(obj.data)   ? obj.data   : [];
    stakeMoves  = Array.isArray(obj.moves)  ? obj.moves  : [];
    stakeTypes  = Array.isArray(obj.types)  ? obj.types  : [];

    const n = stakeData.length;
    stakeLabels = stakeLabels.slice(0, n);
    stakeMoves  = stakeMoves.slice(0, n);
    stakeTypes  = stakeTypes.slice(0, n);

    while (stakeMoves.length < n) stakeMoves.push(0);
    while (stakeTypes.length < n) stakeTypes.push("Stake update");

    stakeBaselineCaptured = stakeData.length > 0;
    lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;
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
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
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

/* returns event object if added */
function maybeAddStakePoint(currentStake) {
  const s = safe(currentStake);
  if (!Number.isFinite(s)) return null;
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
    return null;
  }

  if (lastStakeRecordedRounded == null) { lastStakeRecordedRounded = rounded; return null; }
  if (rounded === lastStakeRecordedRounded) return null;

  const delta = rounded - lastStakeRecordedRounded;
  lastStakeRecordedRounded = rounded;

  stakeLabels.push(nowLabel());
  stakeData.push(rounded);
  stakeMoves.push(delta > 0 ? 1 : -1);
  const type = delta > 0 ? "Delegate / Compound" : "Unstake";
  stakeTypes.push(type);

  saveStakeSeries();
  drawStakeChart();

  return {
    id: `stake_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    t: Date.now(),
    kind: delta > 0 ? "stake_up" : "stake_down",
    name: type,
    move: `${delta > 0 ? "+" : ""}${Math.abs(delta).toFixed(6)} INJ`,
    status: "ok"
  };
}

/* ================= REWARD WITHDRAWALS (persist) ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll  = [];

let wdLabels = [];
let wdValues = [];
let wdTimes  = [];

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
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
    cloudBump(1);
  } catch {
    cloudSetState("error");
  }
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
    wdTimesAll  = Array.isArray(obj.times)  ? obj.times  : [];

    rebuildWdView();
    return true;
  } catch {
    return false;
  }
}

function rebuildWdView() {
  wdLabels = [];
  wdValues = [];
  wdTimes  = [];

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

    const leftBound  = ch.chartArea.left + 6;
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
}

function drawRewardWdChart() {
  if (!rewardChart) initRewardWdChart();
  if (rewardChart) {
    rewardChart.data.labels = wdLabels;
    rewardChart.data.datasets[0].data = wdValues;
    rewardChart.update("none");
  }
}

function syncRewardTimelineUI(forceToEnd=false) {
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
    saveWdAll();
  }, { passive: true });
}

/* returns event object if withdrawal detected */
function maybeRecordRewardWithdrawal(newRewards) {
  const r = safe(newRewards);
  if (wdLastRewardsSeen == null) { wdLastRewardsSeen = r; return null; }

  const diff = wdLastRewardsSeen - r;
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    const t = Date.now();
    wdTimesAll.push(t);
    wdLabelsAll.push(fmtHHMMSS(t));
    wdValuesAll.push(diff);
    saveWdAll();
    rebuildWdView();
    goRewardLive();
    wdLastRewardsSeen = r;

    return {
      id: `reward_${t}_${Math.random().toString(16).slice(2)}`,
      t,
      kind: "reward_withdraw",
      name: "Reward Withdraw",
      move: `+${diff.toFixed(6)} INJ`,
      status: "ok"
    };
  }
  wdLastRewardsSeen = r;
  return null;
}

/* ================= NET WORTH (persist + chart + TF unlock) ================= */
let nwTf = "live"; // live | 1d | 1w | 1m | 1y | all
let nwScale = "linear"; // linear | logarithmic

let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];
let netWorthChart = null;

let nwHoverActive = false;
let nwHoverIndex = null;

let nwNeedsRedraw = true;

/* anchor start per timeframe (so TF does not auto-scroll) */
let nwAnchors = { "1d": 0, "1w": 0, "1m": 0, "1y": 0, "all": 0 };

function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}
function saveNW(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll,
      usdAll: nwUsdAll,
      injAll: nwInjAll,
      tf: nwTf,
      scale: nwScale,
      anchors: nwAnchors
    }));
    cloudBump(1);
  } catch {
    cloudSetState("error");
  }
}

function loadNW(){
  const key = nwStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTAll = Array.isArray(obj.tAll) ? obj.tAll.map(Number) : [];
    nwUsdAll = Array.isArray(obj.usdAll) ? obj.usdAll.map(Number) : [];
    nwInjAll = Array.isArray(obj.injAll) ? obj.injAll.map(Number) : [];

    const tf = String(obj.tf || "");
    nwTf = (["live","1d","1w","1m","1y","all"].includes(tf)) ? tf : "live";

    const sc = String(obj.scale || "");
    nwScale = (sc === "logarithmic") ? "logarithmic" : "linear";

    if (obj.anchors && typeof obj.anchors === "object") {
      nwAnchors = { ...nwAnchors, ...obj.anchors };
    }

    clampNWArrays();
    nwNeedsRedraw = true;
    return true;
  } catch {
    return false;
  }
}

function clampNWArrays(){
  const n = Math.min(nwTAll.length, nwUsdAll.length, nwInjAll.length);
  nwTAll = nwTAll.slice(-n);
  nwUsdAll = nwUsdAll.slice(-n);
  nwInjAll = nwInjAll.slice(-n);
  if (nwTAll.length > NW_MAX_POINTS){
    nwTAll = nwTAll.slice(-NW_MAX_POINTS);
    nwUsdAll = nwUsdAll.slice(-NW_MAX_POINTS);
    nwInjAll = nwInjAll.slice(-NW_MAX_POINTS);
  }
}

function nwWindowMs(tf){
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "1d") return 24 * 60 * 60 * 1000;
  if (tf === "live") return NW_LIVE_WINDOW_MS;
  return 0;
}

function nwCoverageMs(){
  if (nwTAll.length < 2) return 0;
  return safe(nwTAll[nwTAll.length - 1]) - safe(nwTAll[0]);
}

function nwIsUnlocked(tf){
  if (tf === "live") return true;
  if (tf === "all") return nwTAll.length >= 2;
  const need = nwWindowMs(tf);
  const have = nwCoverageMs();
  return have >= need; // strict unlock
}

function nwEnsureAnchors(){
  // If no anchor set, set to first available point time
  const first = nwTAll.length ? safe(nwTAll[0]) : 0;
  ["1d","1w","1m","1y","all"].forEach((k) => {
    if (!nwAnchors[k]) nwAnchors[k] = first;
  });
}

function downsampleXY(labels, data, maxPoints){
  const n = data.length;
  if (!maxPoints || n <= maxPoints) return { labels, data };
  const step = Math.ceil(n / maxPoints);
  const outL = [];
  const outD = [];
  for (let i = 0; i < n; i += step){
    outL.push(labels[i]);
    outD.push(data[i]);
  }
  return { labels: outL, data: outD };
}

function nwBuildView(tf){
  if (nwTAll.length < 2) return { labels: [], data: [], idxMin: undefined, idxMax: undefined };

  nwEnsureAnchors();

  const now = Date.now();
  const w = nwWindowMs(tf);

  // LIVE: rolling last 5 min (auto-scroll)
  if (tf === "live") {
    const minT = now - w;
    const labels = [];
    const data = [];
    for (let i = 0; i < nwTAll.length; i++){
      const t = safe(nwTAll[i]);
      const u = safe(nwUsdAll[i]);
      if (t >= minT && Number.isFinite(u) && u > 0) {
        labels.push(fmtHHMMSS(t));
        data.push(u);
      }
    }
    const ds = downsampleXY(labels, data, NW_LIVE_MAX_POINTS);
    return { labels: ds.labels, data: ds.data, idxMin: undefined, idxMax: undefined };
  }

  // Fixed TF: anchored window (no auto-scroll)
  const startT = safe(nwAnchors[tf] || nwTAll[0]);
  const endT = (tf === "all") ? safe(nwTAll[nwTAll.length - 1]) : (startT + w);

  const labelsAll = [];
  const dataAll = [];
  const times = [];

  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (!Number.isFinite(u) || u <= 0) continue;
    if (t < startT) continue;
    if (tf !== "all" && t > endT) continue;

    times.push(t);
    labelsAll.push(tf === "1y" || tf === "all" ? new Date(t).toLocaleDateString() : fmtHHMM(t));
    dataAll.push(u);
  }

  const ds = downsampleXY(labelsAll, dataAll, 2200);
  return { labels: ds.labels, data: ds.data, idxMin: undefined, idxMax: undefined };
}

function nwApplySignStyling(sign){
  if (!netWorthChart) return;
  const ds = netWorthChart.data.datasets?.[0];
  if (!ds) return;

  if (sign === "up"){
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.16)";
  } else if (sign === "down"){
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.14)";
  } else {
    ds.borderColor = "#3b82f6";
    ds.backgroundColor = "rgba(59,130,246,.12)";
  }
}

const nwVerticalLinePlugin = {
  id: "nwVerticalLinePlugin",
  afterDraw(ch){
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

    const lastIdx = pts.length - 1;
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

function initNWChart(){
  const canvas = $("netWorthChart");
  if (!canvas || !window.Chart) return;

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
          type: nwScale,
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
  updateNWTFButtons();
}

function updateNWTFButtons(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;
  const btns = wrap.querySelectorAll(".tf-btn");

  btns.forEach((b) => {
    const tf = b.dataset.tf;
    const unlocked = nwIsUnlocked(tf);
    const active = (tf === nwTf);
    b.classList.toggle("active", active);
    // disable if locked
    b.disabled = !unlocked;
    b.style.opacity = unlocked ? "1" : "0.38";
    b.style.pointerEvents = unlocked ? "" : "none";
  });
}

function drawNW(force=false){
  if (!force && !nwNeedsRedraw) return;

  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  updateNWTFButtons();

  const view = nwBuildView(nwTf);

  netWorthChart.data.labels = view.labels;
  netWorthChart.data.datasets[0].data = view.data;

  // y scale type update
  if (netWorthChart.options?.scales?.y) {
    netWorthChart.options.scales.y.type = nwScale;
  }

  // PnL for current view (except live: show short pnl)
  const pnlEl = $("netWorthPnl");
  if (pnlEl && view.data.length >= 2){
    const first = safe(view.data[0]);
    const last = safe(view.data[view.data.length - 1]);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    pnlEl.classList.remove("good","bad","flat");
    const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
    pnlEl.classList.add(cls);

    const sign = pnl > 0 ? "+" : "";
    pnlEl.textContent =
      nwTf === "live"
        ? `PnL (LIVE): ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`
        : `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;

    nwApplySignStyling(pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat"));
  } else if (pnlEl) {
    pnlEl.classList.remove("good","bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = "PnL: —";
    nwApplySignStyling("flat");
  }

  netWorthChart.update("none");
  nwNeedsRedraw = false;
}

function attachNWInteractions(){
  const canvas = $("netWorthChart");
  if (!canvas || !netWorthChart) return;

  const getIndex = (evt) => {
    const pts = netWorthChart.getElementsAtEventForMode(evt, "index", { intersect:false }, false);
    if (!pts?.length) return null;
    return pts[0].index;
  };

  const onMove = (evt) => {
    const idx = getIndex(evt);
    if (idx == null) return;
    nwHoverActive = true;
    nwHoverIndex = idx;

    const data = netWorthChart.data.datasets?.[0]?.data || [];
    const labels = netWorthChart.data.labels || [];
    const v = safe(data[idx]);
    const lab = labels[idx] || "";

    // show value as top number temporarily
    const el = $("netWorthUsd");
    if (el && v > 0) el.textContent = `$${v.toFixed(2)}`;

    const pnlEl = $("netWorthPnl");
    if (pnlEl && v > 0) {
      pnlEl.classList.remove("good","bad","flat");
      pnlEl.classList.add("flat");
      pnlEl.textContent = `Point: ${lab} • $${v.toFixed(2)}`;
    }

    netWorthChart.update("none");
  };

  const onLeave = () => {
    nwHoverActive = false;
    nwHoverIndex = null;
    // restore happens naturally in animate loop
    netWorthChart.update("none");
  };

  canvas.addEventListener("mousemove", onMove, { passive:true });
  canvas.addEventListener("mouseleave", onLeave, { passive:true });

  canvas.addEventListener("touchstart", (e) => onMove(e), { passive:true });
  canvas.addEventListener("touchmove", (e) => onMove(e), { passive:true });
  canvas.addEventListener("touchend", onLeave, { passive:true });
  canvas.addEventListener("touchcancel", onLeave, { passive:true });
}

function attachNWTFHandlers(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  updateNWTFButtons();

  if (wrap.dataset.bound === "1") return;
  wrap.dataset.bound = "1";

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "live";
    if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;
    if (!nwIsUnlocked(tf)) return;

    // if selecting fixed TF for first time, anchor it (no auto-scroll)
    if (tf !== "live" && !nwAnchors[tf]) {
      nwAnchors[tf] = nwTAll.length ? safe(nwTAll[0]) : Date.now();
    }

    nwTf = tf;
    saveNW();
    nwNeedsRedraw = true;
    drawNW(true);
  }, { passive:true });
}

function attachNWScaleHandler(){
  const btn = $("nwScaleToggle");
  if (!btn) return;

  const setBtnText = () => {
    btn.textContent = nwScale === "logarithmic" ? "LOG" : "LIN";
  };
  setBtnText();

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    nwScale = (nwScale === "logarithmic") ? "linear" : "logarithmic";
    setBtnText();
    saveNW();
    nwNeedsRedraw = true;
    drawNW(true);
  }, { passive:false });
}

/* returns event object if point recorded (for event feed) */
function recordNetWorthPoint(){
  if (!address) return null;
  const px = safe(targetPrice);
  if (!Number.isFinite(px) || px <= 0) return null;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return null;

  const now = Date.now();
  const lastT = nwTAll.length ? safe(nwTAll[nwTAll.length - 1]) : 0;
  const lastUsd = nwUsdAll.length ? safe(nwUsdAll[nwUsdAll.length - 1]) : 0;
  const dt = now - lastT;
  const dUsd = Math.abs(totalUsd - lastUsd);

  if (lastT && dt < NW_MIN_DT_MS && dUsd < NW_MIN_DUSD) return null;

  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);
  clampNWArrays();
  nwEnsureAnchors();
  saveNW();
  nwNeedsRedraw = true;
  drawNW();

  // price swing detection (24h)
  const evt = maybePriceEvent24h();
  if (evt) pushEvent(evt);

  return {
    id: `nw_${now}_${Math.random().toString(16).slice(2)}`,
    t: now,
    kind: "networth",
    name: "Net Worth Update",
    move: `$${totalUsd.toFixed(2)}`,
    status: "ok"
  };
}

/* ================= PRICE EVENTS (24h) ================= */
let priceEvtLastLevel = 0;
let priceEvtLastAt = 0;

function maybePriceEvent24h(){
  if (!tfReady.d || !candle.d.open || !targetPrice) return null;

  const pct = pctChange(targetPrice, candle.d.open);
  const abs = Math.abs(pct);

  // levels
  const levels = [3, 5, 8, 10, 15, 20];
  let level = 0;
  for (const L of levels) if (abs >= L) level = L;

  const now = Date.now();
  if (!level) return null;

  // avoid spam
  if (level <= priceEvtLastLevel && (now - priceEvtLastAt) < 30 * 60 * 1000) return null;

  priceEvtLastLevel = level;
  priceEvtLastAt = now;

  return {
    id: `px_${now}_${Math.random().toString(16).slice(2)}`,
    t: now,
    kind: pct >= 0 ? "price_up" : "price_down",
    name: "Price Move (24h)",
    move: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
    status: "ok"
  };
}

/* ================= EVENTS (toast + table) ================= */
let eventsAll = [];

function evtStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_events_v${EVT_LOCAL_VER}_${a}` : null;
}
function loadEvents(){
  const key = evtStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== EVT_LOCAL_VER) return false;
    eventsAll = Array.isArray(obj.items) ? obj.items : [];
    return true;
  } catch {
    return false;
  }
}
function saveEvents(){
  const key = evtStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EVT_LOCAL_VER, t: Date.now(), items: eventsAll.slice(0, EVT_MAX_ITEMS) }));
    cloudBump(1);
  } catch {
    cloudSetState("error");
  }
}

let toastHost = null;
function ensureToastHost(){
  if (toastHost) return;
  toastHost = document.createElement("div");
  toastHost.id = "toastHost";
  toastHost.style.position = "fixed";
  toastHost.style.left = "0";
  toastHost.style.right = "0";
  toastHost.style.top = "12px";
  toastHost.style.zIndex = "260";
  toastHost.style.display = "grid";
  toastHost.style.placeItems = "center";
  toastHost.style.pointerEvents = "none";
  document.body.appendChild(toastHost);
}

function showToast(evt){
  ensureToastHost();
  if (!toastHost || !evt) return;

  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.style.width = "min(720px, 92vw)";
  el.style.borderRadius = "16px";
  el.style.border = "1px solid rgba(255,255,255,0.10)";
  el.style.background = "rgba(0,0,0,0.35)";
  el.style.backdropFilter = "blur(12px)";
  el.style.webkitBackdropFilter = "blur(12px)";
  el.style.boxShadow = "0 18px 70px rgba(0,0,0,.45)";
  el.style.padding = "10px 12px";
  el.style.color = "rgba(249,250,251,.92)";
  el.style.fontWeight = "900";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "space-between";
  el.style.gap = "10px";
  el.style.transform = "translateY(-20px)";
  el.style.opacity = "0";
  el.style.transition = "transform 220ms ease, opacity 220ms ease";

  const icon = evt.kind === "price_up" ? "📈" :
               evt.kind === "price_down" ? "📉" :
               evt.kind === "reward_withdraw" ? "💧" :
               evt.kind === "stake_down" ? "🧯" :
               evt.kind === "stake_up" ? "🧱" :
               "✨";

  const dotColor = (!hasInternet()) ? "#ef4444" : (evt.status === "ok" ? "#22c55e" : "#f59e0b");

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:18px;">${icon}</span>
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="letter-spacing:.02em;">${evt.name}</div>
        <div style="font-size:.78rem; font-weight:800; opacity:.85;">
          ${fmtHHMMSS(evt.t)} • ${evt.move}
        </div>
      </div>
    </div>
    <span style="width:10px;height:10px;border-radius:50%;background:${dotColor}; display:inline-block;"></span>
  `;
  toastHost.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-18px)";
    setTimeout(() => el.remove(), 220);
  }, 2200);
}

function pushEvent(evt){
  if (!evt || !address) return;

  // prepend newest
  eventsAll.unshift(evt);
  if (eventsAll.length > EVT_MAX_ITEMS) eventsAll = eventsAll.slice(0, EVT_MAX_ITEMS);
  saveEvents();

  // toast + update event page table (if visible)
  showToast(evt);
  renderEventsTable();
}

function renderEventsTable(){
  ensurePages();
  const tbody = $("eventsTbody");
  const empty = $("eventsEmpty");
  if (!tbody) return;

  tbody.innerHTML = "";
  const items = Array.isArray(eventsAll) ? eventsAll : [];
  if (!items.length) {
    if (empty) empty.style.display = "";
    return;
  }
  if (empty) empty.style.display = "none";

  const maxShow = 250;
  for (const e of items.slice(0, maxShow)){
    const tr = document.createElement("tr");
    tr.style.background = "rgba(255,255,255,0.04)";
    tr.style.border = "1px solid rgba(255,255,255,0.08)";
    tr.style.borderRadius = "14px";
    tr.style.overflow = "hidden";

    const statusDot = (!hasInternet()) ? "#ef4444" : (e.status === "ok" ? "#22c55e" : "#f59e0b");
    const moveColor = e.kind === "price_up" ? "#22c55e" : e.kind === "price_down" ? "#ef4444" : "rgba(249,250,251,0.92)";

    tr.innerHTML = `
      <td style="padding:10px 6px; font-weight:950;">${e.name}</td>
      <td style="padding:10px 6px; opacity:.85;">${new Date(e.t).toLocaleString()}</td>
      <td style="padding:10px 6px; text-align:right; color:${moveColor}; font-variant-numeric: tabular-nums;">${e.move}</td>
      <td style="padding:10px 6px; text-align:right;">
        <span style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;">
          <span style="width:10px;height:10px;border-radius:50%;background:${statusDot};"></span>
          <span style="opacity:.85;">${e.status === "ok" ? "Success" : "Pending"}</span>
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

/* ================= NET WORTH UI (logo + fields) ================= */
function injectInjLogos(){
  const icons = document.querySelectorAll(".nw-asset-icon, .nw-coin-logo");
  icons.forEach((node) => {
    // replace emoji with image (only once)
    if (node.querySelector?.("img")) return;
    node.innerHTML = `<img src="${INJ_LOGO_URL}" alt="Injective" style="width:18px;height:18px;border-radius:6px;display:block;" />`;
  });
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  localStorage.setItem("inj_address", address);

  setAddressDisplay(address);
  settleStart = Date.now();

  // reset runtime values, but KEEP loaded historical series
  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;

  displayed.available = 0;
  displayed.stake = 0;
  displayed.rewards = 0;
  displayed.apr = 0;

  // load per-address persistent series
  if (RESET_STAKE_FROM_NOW_ON_BOOT) {
    clearStakeSeriesStorage();
    resetStakeSeriesFromNow();
  } else {
    loadStakeSeries();
    drawStakeChart();
  }

  wdLastRewardsSeen = null;
  wdMinFilter = safe($("rewardFilter")?.value || 0);
  loadWdAll();
  rebuildWdView();
  goRewardLive();

  loadNW();
  nwEnsureAnchors();
  attachNWTFHandlers();
  attachNWScaleHandler();
  nwNeedsRedraw = true;
  drawNW(true);

  loadEvents();
  renderEventsTable();

  // ensure validator block exists (inside net worth)
  ensureValidatorMiniBlock();

  // cloud: immediate pull then push to align devices
  await cloudMaybePull(true);
  await cloudMaybePush(true);

  modeLoading = true;
  refreshConnUI();

  if (liveMode) await loadAccount();
  else {
    refreshLoaded = false;
    refreshConnUI();
    await refreshLoadAllOnce();
  }
}

/* ================= CHART THEME REFRESH ================= */
function refreshChartsTheme(){
  try{
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

/* ================= ONLINE / OFFLINE listeners ================= */
window.addEventListener("online", async () => {
  refreshConnUI();
  cloudSetState("synced");

  if (liveMode) {
    startTradeWS();
    startKlineWS();
    if (address) loadAccount();
  } else {
    refreshLoadAllOnce();
  }

  // resync cloud when back online
  await cloudMaybePull(true);
  await cloudMaybePush(true);
}, { passive: true });

window.addEventListener("offline", () => {
  wsTradeOnline = false;
  wsKlineOnline = false;
  accountOnline = false;
  refreshLoaded = false;
  refreshLoading = false;
  modeLoading = false;

  validator.status = "offline";
  setValidatorUI("offline");

  refreshConnUI();
  cloudSetState("synced");
}, { passive: true });

/* ================= BOOT ================= */
(async function boot() {
  cloudLoad();
  cloudSaveLocal();
  cloudSetState("synced");

  ensurePages();
  ensureToastHost();
  ensurePullToRefreshUI();
  ensureChartModal();

  injectInjLogos();
  ensureValidatorMiniBlock();
  setValidatorUI("idle");

  refreshConnUI();
  setTimeout(() => setUIReady(true), 2800);

  attachPullToRefresh();
  attachRewardTimelineHandlers();
  attachRewardLiveHandler();
  attachRewardFilterHandler();

  // mode UI
  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  // per-address load (if present)
  if (address) {
    loadStakeSeries();
    drawStakeChart();

    loadWdAll();
    rebuildWdView();
    goRewardLive();

    loadNW();
    nwEnsureAnchors();
    attachNWTFHandlers();
    attachNWScaleHandler();
    drawNW(true);

    loadEvents();
    renderEventsTable();

    // initial cloud pull to match devices
    await cloudMaybePull(true);
  }

  modeLoading = true;
  refreshConnUI();

  await loadCandleSnapshot(liveMode ? false : true);
  await loadChartToday(liveMode ? false : true);

  ensureExpandButtons();

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
    startAllTimers(); // still for cloud sync + safety timers (will not WS)
  }

  // first push after boot
  await cloudMaybePush(true);
})();

/* ================= LOOP ================= */
function animate() {
  // PRICE
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  // PERF
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  // Chart sign color
  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "flat");
  applyChartColorBySign(sign);

  const dUp   = "linear-gradient(90deg, rgba(34,197,94,.55), rgba(16,185,129,.32))";
  const dDown = "linear-gradient(270deg, rgba(239,68,68,.55), rgba(248,113,113,.30))";

  const wUp   = "linear-gradient(90deg, rgba(59,130,246,.55), rgba(99,102,241,.30))";
  const wDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(59,130,246,.26))";

  const mUp   = "linear-gradient(90deg, rgba(249,115,22,.50), rgba(236,72,153,.28))";
  const mDown = "linear-gradient(270deg, rgba(239,68,68,.40), rgba(236,72,153,.25))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"),  $("weekLine"),  targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);

  // Values + flash extremes
  const pMinEl = $("priceMin"), pMaxEl = $("priceMax");
  const wMinEl = $("weekMin"),  wMaxEl = $("weekMax");
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

  const avUsd = displayed.available * displayed.price;
  const oavUsd = displayed.availableUsd;
  displayed.availableUsd = tick(displayed.availableUsd, avUsd);
  colorApproxMoney($("availableUsd"), displayed.availableUsd, oavUsd);

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);

  const stUsd = displayed.stake * displayed.price;
  const ostUsd = displayed.stakeUsd;
  displayed.stakeUsd = tick(displayed.stakeUsd, stUsd);
  colorApproxMoney($("stakeUsd"), displayed.stakeUsd, ostUsd);

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

  const rwUsd = displayed.rewards * displayed.price;
  const orwUsd = displayed.rewardsUsd;
  displayed.rewardsUsd = tick(displayed.rewardsUsd, rwUsd);
  colorApproxMoney($("rewardsUsd"), displayed.rewardsUsd, orwUsd);

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

  // APR (animated like price)
  const oapr = displayed.apr;
  displayed.apr = tick(displayed.apr, apr);
  colorNumber($("apr"), displayed.apr, oapr, 2);

  // time (Last update at bottom)
  setText("updated", "Last update: " + nowLabel());

  /* ================= NET WORTH UI ================= */
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  // do not overwrite while interacting
  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);

    // keep PnL in sync only when redraw needed
    drawNW(false);
  }

  // total owned text (if present)
  const netWorthInj = $("netWorthInj");
  if (netWorthInj) netWorthInj.textContent = `${totalInj.toFixed(4)} INJ`;

  // validator dot state
  setValidatorUI(validator.status);

  // record net worth in LIVE mode only (keeps LIVE window fresh)
  if (address && liveMode) {
    // record is throttled internally
    recordNetWorthPoint();
  }

  refreshConnUI();

  // keep blinking dot fluid
  if (netWorthChart) netWorthChart.draw();

  requestAnimationFrame(animate);
}
animate();

/* ================= REFRESH Mode: first load once (safety) ================= */
(async function initOnce(){
  // Ensure proper expand buttons if DOM changed
  setTimeout(() => ensureExpandButtons(), 900);
})();

/* ================= WHAT WAS ADDED (summary) =================
1) Net Worth:
   - LIVE timeframe rolling 5 minutes (auto-updating)
   - Fixed TF: 1D/1W/1M/1Y/ALL unlock strictly when enough time is accumulated
   - Fixed TF are "anchored" (no auto-scroll). Explore newer points with pan/zoom.
   - LIN/LOG toggle supported and persisted per address
2) Expand icon:
   - Injected in-card expand button for every card that has a canvas
   - Full-screen chart modal with pan/zoom + live value readout
3) Events system:
   - Saved per wallet, toast notification on new event, dedicated Event page table
   - Events detected: stake +/- , reward withdrawals, price moves (24h thresholds)
4) Validator block (inside Net Worth):
   - Auto-created if missing, shows validator + dot state (green/amber/red)
5) Pull-to-refresh:
   - Works only in REFRESH mode (disabled in LIVE)
6) Persistence + cross-device:
   - Strong per-address local persistence for every chart + events
   - Optional cloud sync via /api/point (pull/merge/push) without breaking if endpoint is missing
7) Animation:
   - All changing numeric fields use the same “price-like” digit coloring animation
============================================================== */
