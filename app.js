/* =========================================================
   Injective Portfolio • v2.0.2
   app.js — FULL FILE (robust + bars restored + no-crash)
   ========================================================= */

/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const ONE_MIN_MS = 60_000;

const STAKE_TARGET_DEFAULT_MAX = 1000;           // default (user can override via range)
const REWARD_TARGET_DEFAULT_MAX = 0.10;          // default (user can override via range)
const REWARD_WITHDRAW_THRESHOLD = 0.0002;        // INJ

/* persistence versions */
const STAKE_LOCAL_VER = 3;
const REWARD_WD_LOCAL_VER = 2;
const NW_LOCAL_VER = 2;
const EV_LOCAL_VER = 1;

/* series limits */
const NW_MAX_POINTS = 4800;
const SERIES_MAX_POINTS = 2400;

/* Net Worth live window */
const NW_LIVE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/* cloud */
const CLOUD_API = "/api/point";
const CLOUD_PUSH_DEBOUNCE_MS = 1200;
const CLOUD_PULL_INTERVAL_MS = 45_000;

/* refresh mode staging */
const REFRESH_RED_MS = 220;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);
const hasInternet = () => navigator.onLine === true;

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtHHMMSS(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function tsLabel(ms = Date.now()) { return String(Math.floor(ms)); }
function labelToTs(lbl) {
  if (lbl == null) return 0;
  const s = String(lbl).trim();
  if (/^\d{10,13}$/.test(s)) return safe(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}
function shortAddr(a) { return a && a.length > 18 ? (a.slice(0, 10) + "…" + a.slice(-6)) : (a || ""); }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

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

/* ================= SAFE FETCH ================= */
async function fetchJSON(url, opts = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
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

/* ================= THEME / MODE ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY  = "inj_mode"; // live | refresh

let theme = localStorage.getItem(THEME_KEY) || "dark";
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

/* ================= CONNECTION UI ================= */
let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

let refreshLoaded = false;
let refreshLoading = false;
let modeLoading = false;

function liveReady(){
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline;
  return socketsOk && accountOk;
}

function refreshConnUI() {
  const statusDot  = $("statusDot");
  const statusText = $("statusText");
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
function setUIReady(force=false){
  const root = $("appRoot");
  if (!root) return;
  if (root.classList.contains("ready")) return;
  root.classList.remove("loading");
  root.classList.add("ready");
}

/* ================= SMOOTH DISPLAY ================= */
let settleStart = Date.now();
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

/* ================= BAR RENDER (open-centered) ================= */
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

/* ================= ADDRESS / SEARCH + COPY ================= */
let address = localStorage.getItem("inj_address") || "";
let pendingAddress = "";

function setAddressDisplay(addr) {
  const addressDisplay = $("addressDisplay");
  if (!addressDisplay) return;
  if (!addr) { addressDisplay.innerHTML = ""; return; }
  addressDisplay.innerHTML = `<span class="tag"><strong>Wallet:</strong> ${shortAddr(addr)}</span>`;
}

async function doCopyAddress(){
  if (!address) return;
  const copyAddressBtn = $("copyAddressBtn");
  try{
    await navigator.clipboard.writeText(address);
    if (copyAddressBtn){
      const prev = copyAddressBtn.textContent;
      copyAddressBtn.textContent = "✓";
      setTimeout(()=>{ copyAddressBtn.textContent = prev || "⧉"; }, 900);
    }
  } catch {}
}

function openSearch() {
  const searchWrap = $("searchWrap");
  const addressInput = $("addressInput");
  if (!searchWrap) return;
  searchWrap.classList.add("open");
  document.body.classList.add("search-open");
  setTimeout(() => addressInput?.focus(), 20);
}
function closeSearch() {
  const searchWrap = $("searchWrap");
  const addressInput = $("addressInput");
  if (!searchWrap) return;
  searchWrap.classList.remove("open");
  document.body.classList.remove("search-open");
  addressInput?.blur();
}

/* ================= DRAWER MENU ================= */
let isDrawerOpen = false;
function openDrawer(){
  isDrawerOpen = true;
  document.body.classList.add("drawer-open");
  $("drawer")?.setAttribute("aria-hidden", "false");
  $("backdrop")?.setAttribute("aria-hidden", "false");
}
function closeDrawer(){
  isDrawerOpen = false;
  document.body.classList.remove("drawer-open");
  $("drawer")?.setAttribute("aria-hidden", "true");
  $("backdrop")?.setAttribute("aria-hidden", "true");
}
function toggleDrawer(){ isDrawerOpen ? closeDrawer() : openDrawer(); }

/* ================= COMING SOON overlay ================= */
function pageLabel(key){
  if (key === "home") return "HOME";
  if (key === "market") return "MARKET";
  if (key === "tools") return "TOOL’S";
  if (key === "settings") return "SETTINGS";
  return "PAGE";
}
function openComingSoon(pageKey){
  const comingSoon = $("comingSoon");
  if (!comingSoon) return;
  const comingTitle = $("comingTitle");
  const comingSub = $("comingSub");
  if (comingTitle) comingTitle.textContent = `COMING SOON 🚀`;
  if (comingSub) comingSub.textContent = `${pageLabel(pageKey)} is coming soon.`;
  comingSoon.classList.add("show");
  comingSoon.setAttribute("aria-hidden", "false");
}
function closeComingSoon(){
  const comingSoon = $("comingSoon");
  if (!comingSoon) return;
  comingSoon.classList.remove("show");
  comingSoon.setAttribute("aria-hidden", "true");
}

/* ================= PAGES ================= */
function hideAllPages(){
  const list = ["pageDashboard","pageEvents","pageTools","pageSettings","pageHome","pageMarket"];
  list.forEach(id => $(id)?.classList.remove("active"));
  list.forEach(id => $(id)?.setAttribute("aria-hidden","true"));
}
function showPage(key){
  hideAllPages();
  closeComingSoon();

  const map = {
    dashboard: $("pageDashboard"),
    event: $("pageEvents"),
    events: $("pageEvents"),
    tools: $("pageTools"),
    settings: $("pageSettings"),
    home: $("pageHome"),
    market: $("pageMarket")
  };
  const p = map[key] || $("pageDashboard");
  p?.classList.add("active");
  p?.setAttribute("aria-hidden","false");

  if (p?.id === "pageEvents") renderEvents(true);
  if (p?.id === "pageSettings") syncSettingsUI();
}
function setActivePage(pageKey){
  const items = $("drawerNav")?.querySelectorAll(".nav-item") || [];
  items.forEach(btn => btn.classList.toggle("active", btn.dataset.page === pageKey));
}

/* ================= FULLSCREEN CARD ================= */
let expandedCard = null;
let expandedBackdrop = null;
const expandedHiddenMap = new Map();

function buildExpandedBackdrop(){
  if (expandedBackdrop) return;
  const bd = document.createElement("div");
  bd.style.position = "fixed";
  bd.style.inset = "0";
  bd.style.background = "rgba(0,0,0,0.50)";
  bd.style.backdropFilter = "blur(10px)";
  bd.style.zIndex = "190";
  bd.addEventListener("click", () => exitFullscreenCard(), { passive:true });
  document.body.appendChild(bd);
  expandedBackdrop = bd;
}
function hideNonChartContent(card){
  const hidden = [];
  const keepSet = new Set();
  const tools = card.querySelector(".card-tools") || card.querySelector(".networth-top");
  if (tools) keepSet.add(tools);

  const canvases = card.querySelectorAll("canvas");
  canvases.forEach(cv => {
    keepSet.add(cv);
    let p = cv.parentElement;
    while (p && p !== card) { keepSet.add(p); p = p.parentElement; }
  });

  [...card.children].forEach(ch => {
    if (keepSet.has(ch)) return;
    let ok = false;
    for (const k of keepSet) {
      if (k && k !== ch && k.contains && k.contains(ch)) { ok = true; break; }
    }
    if (ok) return;

    hidden.push([ch, ch.style.display]);
    ch.style.display = "none";
  });

  expandedHiddenMap.set(card, hidden);
}
function restoreNonChartContent(card){
  const hidden = expandedHiddenMap.get(card) || [];
  hidden.forEach(([el, disp]) => { el.style.display = disp || ""; });
  expandedHiddenMap.delete(card);
}
function resizeAllCharts(){
  try { priceChart?.resize?.(); } catch {}
  try { stakeChart?.resize?.(); } catch {}
  try { rewardChart?.resize?.(); } catch {}
  try { netWorthChart?.resize?.(); } catch {}
  try { aprChart?.resize?.(); } catch {}
}
function enterFullscreenCard(card){
  if (!card) return;
  if (expandedCard) exitFullscreenCard();
  expandedCard = card;

  buildExpandedBackdrop();
  expandedBackdrop.style.display = "block";

  document.body.classList.add("card-expanded");
  card.classList.add("fullscreen");
  hideNonChartContent(card);

  setTimeout(resizeAllCharts, 180);
}
function exitFullscreenCard(){
  if (!expandedCard) return;
  restoreNonChartContent(expandedCard);
  expandedCard.classList.remove("fullscreen");
  document.body.classList.remove("card-expanded");
  expandedBackdrop && (expandedBackdrop.style.display = "none");
  expandedCard = null;
  setTimeout(resizeAllCharts, 180);
}
function bindExpandButtons(){
  document.querySelectorAll(".card-expand").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const card = btn.closest(".card");
      if (!card) return;
      if (card === expandedCard) exitFullscreenCard();
      else enterFullscreenCard(card);
    }, { passive:false });
  });
}

/* ================= EVENTS SYSTEM ================= */
let eventsAll = [];
let eventsUnread = 0;

function evStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_events_v${EV_LOCAL_VER}_${a}` : null;
}
function renderEventBadge(){
  const badge = $("eventBadge");
  if (!badge) return;
  const n = Math.max(0, Math.floor(eventsUnread));
  badge.hidden = n <= 0;
  badge.textContent = String(n);
}
function loadEvents(){
  const key = evStoreKey(address);
  if (!key) { eventsAll = []; eventsUnread = 0; renderEventBadge(); return; }
  try{
    const raw = localStorage.getItem(key);
    if (!raw) { eventsAll = []; eventsUnread = 0; renderEventBadge(); return; }
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj?.events)) { eventsAll = []; eventsUnread = 0; renderEventBadge(); return; }
    eventsAll = obj.events.slice(0, 1200);
    eventsUnread = safe(obj?.unread);
  } catch {
    eventsAll = [];
    eventsUnread = 0;
  }
  renderEventBadge();
}
function saveEvents(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: EV_LOCAL_VER,
      t: Date.now(),
      unread: eventsUnread,
      events: eventsAll.slice(0, 1200)
    }));
  } catch {}
  renderEventBadge();
}

function showToast(ev){
  const host = $("toastHost");
  if (!host) return;

  const el = document.createElement("div");
  el.className = "toast";

  const when = fmtHHMMSS(ev.ts || Date.now());
  const title = ev.title || "Event";
  const sub = ev.detail || "";

  el.innerHTML = `
    <div class="toast-row">
      <div class="toast-title">${title}</div>
      <div style="font-weight:900;opacity:.82;font-size:.82rem">${when}</div>
    </div>
    <div class="toast-sub">${sub}</div>
  `;

  host.appendChild(el);

  setTimeout(() => {
    try { host.removeChild(el); } catch {}
  }, 2600);
}

function pushEvent(ev){
  if (!address) return;

  const obj = {
    id: ev.id || (String(Date.now()) + "_" + Math.random().toString(16).slice(2)),
    ts: ev.ts || Date.now(),
    kind: ev.kind || "info",
    title: ev.title || "Event",
    detail: ev.detail || "",
    dir: ev.dir || null,
    status: ev.status || "ok"
  };

  eventsAll.unshift(obj);
  eventsAll = eventsAll.slice(0, 1200);
  eventsUnread += 1;

  saveEvents();
  renderEvents(false);
  showToast(obj);

  if (obj.status === "pending") {
    setTimeout(() => {
      const idx = eventsAll.findIndex(x => x.id === obj.id);
      if (idx >= 0) {
        eventsAll[idx].status = hasInternet() ? "ok" : "err";
        saveEvents();
        renderEvents(false);
      }
    }, 1400);
  }
}

let eventsPageIndex = 0;
const EVENTS_PER_PAGE = 18;

function getFilteredEvents(){
  const cat = ($("eventsCategory")?.value || "all").toLowerCase();
  if (cat === "all") return eventsAll;

  return eventsAll.filter(ev => {
    const k = (ev.kind || "").toLowerCase();
    const ttl = (ev.title || "").toLowerCase();
    if (cat === "rewards") return k.includes("reward") || ttl.includes("reward");
    if (cat === "apr") return k.includes("apr") || ttl.includes("apr");
    if (cat === "price") return k.includes("price") || ttl.includes("price");
    if (cat === "exchange") return k.includes("exchange");
    if (cat === "system") return k.includes("system") || k.includes("info");
    return true;
  });
}

function renderEvents(markRead){
  const tbody = $("eventsTbody");
  const empty = $("eventsEmpty");
  const pagesEl = $("eventsPages");
  if (!tbody) return;

  if (markRead) {
    eventsUnread = 0;
    saveEvents();
  }

  const list = getFilteredEvents();
  if (empty) empty.style.display = list.length ? "none" : "block";
  tbody.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(list.length / EVENTS_PER_PAGE));
  eventsPageIndex = clamp(eventsPageIndex, 0, totalPages - 1);

  const start = eventsPageIndex * EVENTS_PER_PAGE;
  const slice = list.slice(start, start + EVENTS_PER_PAGE);

  for (const ev of slice){
    const tr = document.createElement("tr");
    const dt = new Date(ev.ts || Date.now());
    const when = `${dt.toLocaleDateString()} ${fmtHHMMSS(ev.ts || Date.now())}`;

    const status = (ev.status || "ok");
    const statusTxt = status === "ok" ? "OK" : status === "err" ? "ERR" : "PENDING";
    const kind = (ev.kind || "info").toUpperCase();

    tr.innerHTML = `
      <td>${kind}</td>
      <td style="white-space:nowrap">${when}</td>
      <td>${ev.detail || ev.title || ""}</td>
      <td>${statusTxt}</td>
    `;
    tbody.appendChild(tr);
  }

  if (pagesEl){
    pagesEl.textContent = `${eventsPageIndex + 1} / ${totalPages}`;
  }

  $("eventsPrev")?.toggleAttribute("disabled", eventsPageIndex <= 0);
  $("eventsNext")?.toggleAttribute("disabled", eventsPageIndex >= totalPages - 1);
}

/* ================= MODE SWITCH + TIMERS ================= */
let accountPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;
let cloudPullTimer = null;

function stopAllTimers(){
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
  if (cloudPullTimer) { clearInterval(cloudPullTimer); cloudPullTimer = null; }
}
function startAllTimers(){
  stopAllTimers();
  accountPollTimer = setInterval(() => loadAccount(false), ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(() => loadCandleSnapshot(false), REST_SYNC_MS);
  chartSyncTimer = setInterval(() => loadPriceChartSelected(false), CHART_SYNC_MS);
  ensureChartTimer = setInterval(() => ensurePriceChartBootstrapped(), 1500);
  cloudPullTimer = setInterval(() => { if (address) cloudPull(); }, CLOUD_PULL_INTERVAL_MS);
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
    await loadPriceChartSelected(true);
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

  const liveIcon = $("liveIcon");
  const modeHint = $("modeHint");
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
    loadCandleSnapshot(true);
    loadPriceChartSelected(true);
    if (address) loadAccount(true);
    startAllTimers();
    refreshConnUI();
  }

  syncSettingsUI();
}

/* ================= PULL TO REFRESH (REFRESH mode only, mobile) ================= */
let ptr = { startY: 0, pulling: false, shown: false };
let ptrEl = null;

function ensurePullSpinner(){
  if (ptrEl) return ptrEl;
  const el = document.createElement("div");
  el.id = "pullSpinner";
  el.style.position = "fixed";
  el.style.top = "10px";
  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.zIndex = "160";
  el.style.width = "38px";
  el.style.height = "38px";
  el.style.borderRadius = "999px";
  el.style.border = "3px solid rgba(250,204,21,.25)";
  el.style.borderTopColor = "rgba(250,204,21,.95)";
  el.style.display = "none";
  el.style.boxShadow = "0 16px 70px rgba(0,0,0,.45)";
  el.style.background = "rgba(17,28,47,.65)";
  el.style.backdropFilter = "blur(8px)";
  el.style.animation = "spin 1s linear infinite";
  const st = document.createElement("style");
  st.textContent = `@keyframes spin{to{transform:translateX(-50%) rotate(360deg)}}`;
  document.head.appendChild(st);
  document.body.appendChild(el);
  ptrEl = el;
  return el;
}
function showPullSpinner(on){
  const el = ensurePullSpinner();
  el.style.display = on ? "block" : "none";
}
function initPullToRefresh(){
  let touchId = null;

  window.addEventListener("touchstart", (e) => {
    if (liveMode) return;
    if (!hasInternet()) return;
    if (document.body.classList.contains("drawer-open")) return;
    if (document.body.classList.contains("card-expanded")) return;

    const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 2;
    if (!atTop) return;

    const t = e.touches?.[0];
    if (!t) return;
    touchId = t.identifier;
    ptr.startY = t.clientY;
    ptr.pulling = true;
    ptr.shown = false;
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!ptr.pulling) return;
    const t = [...(e.touches || [])].find(x => x.identifier === touchId) || e.touches?.[0];
    if (!t) return;
    const dy = t.clientY - ptr.startY;
    if (dy > 85 && !ptr.shown) {
      ptr.shown = true;
      showPullSpinner(true);
    }
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (!ptr.pulling) return;
    const doRefresh = ptr.shown;
    ptr.pulling = false;
    ptr.shown = false;

    if (!doRefresh) return;
    showPullSpinner(true);
    try{
      await refreshLoadAllOnce();
      pushEvent({ kind:"system", title:"Refresh", detail:"Data refreshed (REFRESH mode).", status:"ok" });
    } finally {
      setTimeout(() => showPullSpinner(false), 550);
    }
  }, { passive: true });

  window.addEventListener("touchcancel", () => {
    ptr.pulling = false; ptr.shown = false;
    showPullSpinner(false);
  }, { passive: true });
}

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0, apr: 0 };

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
      updatePriceChartFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    setUIReady(false);
  };
}

/* ================= ACCOUNT (Injective LCD) + VALIDATOR ================= */
let validator = { addr: "", moniker: "", status: "unknown" };
let validatorLoading = false;

function setValidatorUI(state){
  const nameEl = $("validatorName");
  const dotEl  = $("validatorDot");

  if (nameEl) nameEl.textContent = validator.moniker || "—";
  if (!dotEl) return;

  dotEl.style.background = "#f59e0b";

  if (!hasInternet()) {
    dotEl.style.background = "#ef4444";
    return;
  }
  if (state === "loading" || validatorLoading) {
    dotEl.style.background = "#f59e0b";
    return;
  }
  if (validator.status === "bonded" || validator.status === "active") {
    dotEl.style.background = "#22c55e";
  } else if (validator.status === "unbonded" || validator.status === "jailed") {
    dotEl.style.background = "#ef4444";
  } else {
    dotEl.style.background = "#f59e0b";
  }
}

async function fetchValidatorInfo(valAddr){
  if (!valAddr) return;
  if (!hasInternet()) return;

  validatorLoading = true;
  setValidatorUI("loading");

  const base = "https://lcd.injective.network";
  const v = await fetchJSON(`${base}/cosmos/staking/v1beta1/validators/${valAddr}`);
  validatorLoading = false;

  if (!v?.validator) {
    validator.status = "unknown";
    setValidatorUI("ready");
    return;
  }

  const moniker = v.validator?.description?.moniker || "Validator";
  const jailed = !!v.validator?.jailed;
  const st = String(v.validator?.status || "").toLowerCase();

  validator.addr = valAddr;
  validator.moniker = moniker;

  if (jailed) validator.status = "jailed";
  else if (st.includes("bonded")) validator.status = "bonded";
  else if (st.includes("unbond")) validator.status = "unbonded";
  else validator.status = "unknown";

  setValidatorUI("ready");
}

async function loadAccount(isRefresh=false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet()) {
    accountOnline = false;
    refreshConnUI();
    setValidatorUI("ready");
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
    setValidatorUI("ready");
    return;
  }

  accountOnline = true;
  modeLoading = false;
  refreshConnUI();

  const bal = b.balances?.find(x => x.denom === "inj");
  availableInj = safe(bal?.amount) / 1e18;

  const del = (s.delegation_responses || []);
  stakeInj = del.reduce((a, d) => a + safe(d?.balance?.amount), 0) / 1e18;

  const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  rewardsInj = newRewards;

  apr = safe(i.inflation) * 100;

  const valAddr = del?.[0]?.delegation?.validator_address || "";
  if (valAddr && valAddr !== validator.addr) {
    validator.addr = valAddr;
    validator.moniker = "Loading…";
    validator.status = "unknown";
    setValidatorUI("loading");
    fetchValidatorInfo(valAddr);
  } else {
    setValidatorUI("ready");
  }

  maybeAddStakePoint(stakeInj);
  maybeRecordRewardWithdrawal(rewardsInj);

  recordNetWorthPoint();
  recordAprPoint(apr);
  updateRewardEstimates();

  setUIReady(true);
}

/* ================= BINANCE REST: snapshot 1D/1W/1M ================= */
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

/* ================= PRICE CHART (multi TF) ================= */
let priceChart = null;
let priceTf = "1d";          // 1d | 1w | 1m | 1y | all
let priceScale = "linear";   // linear | log
let priceLastOpenTime = 0;
let priceChartBoot = false;
let hoverActive = false;
let hoverIndex = null;
let pinnedIndex = null;
let isPanning = false;

const priceVerticalLinePlugin = {
  id: "priceVerticalLinePlugin",
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

const priceLastDotPlugin = {
  id: "priceLastDotPlugin",
  afterDatasetsDraw(ch){
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
    ctx.arc(el.x, el.y, 6.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.18 * pulse})`;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();

    ctx.restore();
  }
};

function updatePinnedOverlay() {
  const overlay = $("chartOverlay");
  const chartEl = $("chartPrice");
  if (!overlay || !chartEl || !priceChart) return;

  if (pinnedIndex == null) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  const ds = priceChart.data.datasets?.[0]?.data || [];
  const lbs = priceChart.data.labels || [];
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

function applyPriceChartScale(){
  if (!priceChart) return;
  priceChart.options.scales.y.type = (priceScale === "log") ? "logarithmic" : "linear";
  priceChart.update("none");
}

function initPriceChart() {
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

  priceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        borderWidth: 2,
        clip: { left: 0, top: 0, right: 18, bottom: 0 }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        ...zoomBlock
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { display: false },
        y: {
          type: (priceScale === "log") ? "logarithmic" : "linear",
          ticks: { color: axisTickColor() },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [priceVerticalLinePlugin, priceLastDotPlugin]
  });

  setupPriceChartInteractions();
}

function setupPriceChartInteractions() {
  const canvas = $("priceChart");
  if (!canvas || !priceChart) return;

  const getIndexFromEvent = (evt) => {
    const points = priceChart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
    if (!points || !points.length) return null;
    return points[0].index;
  };

  const handleMove = (evt) => {
    if (!priceChart) return;
    if (isPanning) return;

    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverActive = true;
    hoverIndex = idx;
    pinnedIndex = idx;

    updatePinnedOverlay();
    priceChart.update("none");
  };

  const handleLeave = () => {
    hoverActive = false;
    hoverIndex = null;
    pinnedIndex = null;
    updatePinnedOverlay();
    if (priceChart) priceChart.update("none");
  };

  canvas.addEventListener("mousemove", handleMove, { passive: true });
  canvas.addEventListener("mouseleave", handleLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchend", handleLeave, { passive: true });
  canvas.addEventListener("touchcancel", handleLeave, { passive: true });
}

function binanceIntervalForTf(tf){
  if (tf === "1d") return "1m";
  if (tf === "1w") return "15m";
  if (tf === "1m") return "1h";
  if (tf === "1y") return "4h";
  return "1d"; // all
}
function rangeStartForTf(tf){
  const now = Date.now();
  if (tf === "1d") return now - 1 * 24 * 60 * 60 * 1000;
  if (tf === "1w") return now - 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return now - 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return now - 365 * 24 * 60 * 60 * 1000;
  if (tf === "all") return now - 2000 * 24 * 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
}
async function fetchKlinesRange(tf){
  const interval = binanceIntervalForTf(tf);
  const startTime = rangeStartForTf(tf);
  const endTime = Date.now();

  const out = [];
  let cursor = startTime;

  while (cursor < endTime && out.length < 6000) {
    const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=1000&startTime=${cursor}&endTime=${endTime}`;
    const d = await fetchJSON(url);
    if (!Array.isArray(d) || !d.length) break;

    out.push(...d);

    const lastOpenTime = safe(d[d.length - 1][0]);
    if (!lastOpenTime) break;
    cursor = lastOpenTime + 1;

    if (d.length < 1000) break;
  }

  return out;
}
function setPriceTfButtons(){
  const wrap = $("priceTfSwitch");
  if (!wrap) return;
  wrap.querySelectorAll(".tf-btn").forEach(b => {
    b.classList.toggle("active", (b.dataset.tf === priceTf));
  });
}
async function loadPriceChartSelected(isRefresh=false){
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;

  if (!priceChart) initPriceChart();
  if (!priceChart) return;

  const kl = await fetchKlinesRange(priceTf);
  if (!kl.length) return;

  const labels = kl.map(k => fmtHHMM(safe(k[0])));
  const data   = kl.map(k => safe(k[4]));

  priceChart.data.labels = labels;
  priceChart.data.datasets[0].data = data;

  priceLastOpenTime = safe(kl[kl.length - 1][0]) || 0;

  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  applyPriceChartScale();
  priceChart.update("none");

  priceChartBoot = true;
  setPriceTfButtons();
  setUIReady(true);
}
async function ensurePriceChartBootstrapped(){
  if (!liveMode) return;
  if (priceChartBoot) return;
  await loadPriceChartSelected(true);
}
function updatePriceChartFrom1mKline(k){
  if (!liveMode) return;
  if (!priceChart || !priceChartBoot) return;
  if (priceTf !== "1d") return;

  const openTime = safe(k.t);
  const close = safe(k.c);
  if (!openTime || !close) return;

  if (priceLastOpenTime === openTime) {
    const idx = priceChart.data.datasets[0].data.length - 1;
    if (idx >= 0) {
      priceChart.data.datasets[0].data[idx] = close;
      priceChart.update("none");
    }
    return;
  }

  priceLastOpenTime = openTime;
  priceChart.data.labels.push(fmtHHMM(openTime));
  priceChart.data.datasets[0].data.push(close);

  while (priceChart.data.labels.length > 1600) priceChart.data.labels.shift();
  while (priceChart.data.datasets[0].data.length > 1600) priceChart.data.datasets[0].data.shift();

  priceChart.update("none");
}

/* ================= STAKE SERIES (persist) ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;

let stakeTf = "all";
let stakeScale = "linear";

function stakeStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function clampArray(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}
function saveStakeSeriesLocal() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty();
}
function loadStakeSeriesLocal() {
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
function stakeViewByTf(){
  const now = Date.now();
  const ms = stakeTf === "1d" ? 86400000 : stakeTf === "1w" ? 7*86400000 : stakeTf === "1m" ? 30*86400000 : 1e18;
  const minT = (stakeTf === "all") ? 0 : (now - ms);

  const labels = [];
  const data = [];
  const types = [];
  for (let i=0;i<stakeData.length;i++){
    const t = labelToTs(stakeLabels[i]);
    if (!t || t < minT) continue;
    labels.push(stakeLabels[i]);
    data.push(safe(stakeData[i]));
    types.push(stakeTypes[i] || "Stake update");
  }
  return { labels, data, types };
}
const stakeLastDotPlugin = {
  id: "stakeLastDotPlugin",
  afterDatasetsDraw(ch){
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;
    const el = pts[pts.length - 1];
    if (!el) return;

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();
    ctx.restore();
  }
};
function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  const view = stakeViewByTf();

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: view.labels,
      datasets: [{
        data: view.data,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 2,
        clip: { left: 0, top: 0, right: 18, bottom: 0 }
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
            title: (items) => {
              const lbl = stakeChart?.data?.labels?.[items?.[0]?.dataIndex ?? 0] || "";
              const ts = labelToTs(lbl);
              return ts ? `${new Date(ts).toLocaleDateString()} ${fmtHHMMSS(ts)}` : String(lbl);
            },
            label: (item) => {
              const i = item.dataIndex;
              const v = safe(stakeChart?.data?.datasets?.[0]?.data?.[i]);
              const t = stakeTypes?.[i] || "Stake update";
              return `${t} • ${v.toFixed(6)} INJ`;
            }
          }
        },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      scales: {
        x: {
          ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
          grid: { color: axisGridColor() }
        },
        y: {
          type: (stakeScale === "log") ? "logarithmic" : "linear",
          ticks: { color: axisTickColor() },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [stakeLastDotPlugin]
  });

  applyStakeRangeToChart();
}
function drawStakeChart() {
  if (!stakeChart) initStakeChart();
  if (!stakeChart) return;

  const view = stakeViewByTf();
  stakeChart.data.labels = view.labels;
  stakeChart.data.datasets[0].data = view.data;
  stakeChart.options.scales.y.type = (stakeScale === "log") ? "logarithmic" : "linear";

  applyStakeRangeToChart();
  stakeChart.update("none");
}
function maybeAddStakePoint(currentStake) {
  const s = safe(currentStake);
  if (!Number.isFinite(s)) return;
  const rounded = Number(s.toFixed(6));

  if (!stakeBaselineCaptured) {
    stakeLabels.push(tsLabel());
    stakeData.push(rounded);
    stakeMoves.push(1);
    stakeTypes.push("Baseline (current)");
    lastStakeRecordedRounded = rounded;
    stakeBaselineCaptured = true;
    saveStakeSeriesLocal();
    drawStakeChart();
    return;
  }

  if (lastStakeRecordedRounded == null) { lastStakeRecordedRounded = rounded; return; }
  if (rounded === lastStakeRecordedRounded) return;

  const delta = rounded - lastStakeRecordedRounded;
  lastStakeRecordedRounded = rounded;

  stakeLabels.push(tsLabel());
  stakeData.push(rounded);
  stakeMoves.push(delta > 0 ? 1 : -1);
  stakeTypes.push(delta > 0 ? "Delegate / Compound" : "Undelegate");

  stakeLabels = clampArray(stakeLabels, SERIES_MAX_POINTS);
  stakeData   = clampArray(stakeData,   SERIES_MAX_POINTS);
  stakeMoves  = clampArray(stakeMoves,  SERIES_MAX_POINTS);
  stakeTypes  = clampArray(stakeTypes,  SERIES_MAX_POINTS);

  saveStakeSeriesLocal();
  drawStakeChart();

  pushEvent({
    kind: "tx",
    title: delta > 0 ? "Stake increased" : "Stake decreased",
    detail: `${delta > 0 ? "+" : ""}${delta.toFixed(6)} INJ`,
    status: "pending"
  });
}

/* ================= REWARD WITHDRAWALS (persist) ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll  = [];
let wdLastRewardsSeen = null;
let wdMinFilter = 0;

let rewardTf = "all";
let rewardScale = "linear";

function wdStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_reward_withdrawals_v${REWARD_WD_LOCAL_VER}_${a}` : null;
}
function saveWdAllLocal() {
  const key = wdStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty();
}
function loadWdAllLocal() {
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
function rewardViewByTf(){
  const now = Date.now();
  const ms = rewardTf === "1d" ? 86400000 : rewardTf === "1w" ? 7*86400000 : rewardTf === "1m" ? 30*86400000 : 1e18;
  const minT = (rewardTf === "all") ? 0 : (now - ms);

  const labels = [];
  const values = [];
  const times = [];

  for (let i=0;i<wdValuesAll.length;i++){
    const t = safe(wdTimesAll[i]) || labelToTs(wdLabelsAll[i]);
    const v = safe(wdValuesAll[i]);
    if (!t || t < minT) continue;
    if (v < wdMinFilter) continue;
    times.push(t);
    labels.push(wdLabelsAll[i] || tsLabel(t));
    values.push(v);
  }

  return { labels, values, times };
}

let rewardChart = null;
const rewardLastDotPlugin = {
  id: "rewardLastDotPlugin",
  afterDatasetsDraw(ch){
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;
    const el = pts[pts.length - 1];
    if (!el) return;

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();
    ctx.restore();
  }
};
function initRewardChart() {
  const canvas = $("rewardChart");
  if (!canvas || !window.Chart) return;

  const view = rewardViewByTf();

  rewardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: view.labels,
      datasets: [{
        data: view.values,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 2,
        clip: { left: 0, top: 0, right: 18, bottom: 0 }
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
            title: (items) => {
              const i = items?.[0]?.dataIndex ?? 0;
              const ts = rewardViewByTf().times[i] || labelToTs(rewardViewByTf().labels[i]);
              return ts ? `${new Date(ts).toLocaleDateString()} ${fmtHHMMSS(ts)}` : "";
            },
            label: (item) => `Withdrawn • +${safe(item.raw).toFixed(6)} INJ`
          }
        },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      scales: {
        x: { ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: axisGridColor() } },
        y: {
          type: (rewardScale === "log") ? "logarithmic" : "linear",
          position: "right",
          ticks: { color: axisTickColor(), padding: 6, callback: (val) => fmtSmart(val) },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [rewardLastDotPlugin]
  });

  applyRewardRangeToChart();
}
function drawRewardChart(){
  if (!rewardChart) initRewardChart();
  if (!rewardChart) return;

  const view = rewardViewByTf();
  rewardChart.data.labels = view.labels;
  rewardChart.data.datasets[0].data = view.values;
  rewardChart.options.scales.y.type = (rewardScale === "log") ? "logarithmic" : "linear";

  applyRewardRangeToChart();
  rewardChart.update("none");
  syncRewardTimelineUI(true);
}
function rebuildWdView(){
  drawRewardChart();
}
function syncRewardTimelineUI(forceToEnd=false) {
  const slider = $("rewardTimeline");
  const meta = $("rewardTimelineMeta");
  if (!slider || !meta || !rewardChart) return;

  const view = rewardViewByTf();
  const n = view.values.length;

  if (!n) {
    slider.min = 0; slider.max = 0; slider.value = 0;
    meta.textContent = "—";
    rewardChart.options.scales.x.min = undefined;
    rewardChart.options.scales.x.max = undefined;
    rewardChart.update("none");
    return;
  }

  slider.min = 0;
  slider.max = String(n - 1);
  if (forceToEnd) slider.value = String(n - 1);

  const idx = clamp(parseInt(slider.value || "0", 10), 0, n - 1);
  const win = Math.min(60, n);
  const minIdx = Math.max(0, idx - win + 1);
  const maxIdx = idx;

  rewardChart.options.scales.x.min = minIdx;
  rewardChart.options.scales.x.max = maxIdx;
  rewardChart.update("none");

  const fromTs = view.times[minIdx] || labelToTs(view.labels[minIdx]);
  const toTs   = view.times[maxIdx] || labelToTs(view.labels[maxIdx]);
  const from = fromTs ? fmtHHMM(fromTs) : (view.labels[minIdx] || "");
  const to   = toTs ? fmtHHMM(toTs) : (view.labels[maxIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;
}
function maybeRecordRewardWithdrawal(newRewards) {
  const r = safe(newRewards);
  if (wdLastRewardsSeen == null) { wdLastRewardsSeen = r; return; }

  const diff = wdLastRewardsSeen - r;
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    const ts = Date.now();
    wdTimesAll.push(ts);
    wdLabelsAll.push(tsLabel(ts));
    wdValuesAll.push(diff);

    wdTimesAll  = clampArray(wdTimesAll,  SERIES_MAX_POINTS);
    wdLabelsAll = clampArray(wdLabelsAll, SERIES_MAX_POINTS);
    wdValuesAll = clampArray(wdValuesAll, SERIES_MAX_POINTS);

    saveWdAllLocal();
    rebuildWdView();
    syncRewardTimelineUI(true);

    pushEvent({
      kind: "rewards",
      title: "Rewards withdrawn",
      detail: `+${diff.toFixed(6)} INJ`,
      status: "pending"
    });
  }
  wdLastRewardsSeen = r;
}

/* ================= NET WORTH (persist + chart) ================= */
let nwTf = "live";
let nwScale = "linear";
let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];
let netWorthChart = null;
let nwHoverActive = false;
let nwHoverIndex = null;

function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
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
function saveNWLocal(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll, usdAll: nwUsdAll, injAll: nwInjAll,
      tf: nwTf, scale: nwScale
    }));
    cloudBumpLocal(1);
  } catch {}
  cloudMarkDirty();
}
function loadNWLocal(){
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
    nwTf = typeof obj.tf === "string" ? obj.tf : "live";
    nwScale = (obj.scale === "log") ? "log" : "linear";

    clampNWArrays();
    return true;
  } catch {
    return false;
  }
}
function nwWindowMs(tf){
  if (tf === "live") return NW_LIVE_WINDOW_MS;
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "all") return 10 * 365 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
function nwBuildView(tf){
  const now = Date.now();
  const w = nwWindowMs(tf);
  const minT = (tf === "all") ? 0 : (now - w);

  const labels = [];
  const data = [];
  const times = [];

  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(u) && u > 0) {
      times.push(t);
      labels.push(tsLabel(t));
      data.push(u);
    }
  }

  if (tf === "live") {
    const liveMin = now - NW_LIVE_WINDOW_MS;
    const outL = [], outD = [], outT = [];
    for (let i = 0; i < times.length; i++){
      if (times[i] >= liveMin) { outT.push(times[i]); outL.push(labels[i]); outD.push(data[i]); }
    }
    return { labels: outL, data: outD, times: outT };
  }

  return { labels, data, times };
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
        clip: { left: 0, top: 0, right: 18, bottom: 0 },
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
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
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
            padding: 8,
            callback: (val, idx) => {
              const ts = labelToTs(netWorthChart?.data?.labels?.[idx]);
              return ts ? fmtHHMM(ts) : "";
            }
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
}
function drawNW(){
  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  const view = nwBuildView(nwTf);

  netWorthChart.data.labels = view.labels;
  netWorthChart.data.datasets[0].data = view.data;
  netWorthChart.options.scales.y.type = (nwScale === "log") ? "logarithmic" : "linear";
  netWorthChart.update("none");

  const pnlEl = $("netWorthPnl");
  if (view.data.length >= 2){
    const first = safe(view.data[0]);
    const last  = safe(view.data[view.data.length - 1]);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    if (pnlEl){
      pnlEl.classList.remove("good","bad","flat");
      const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
      pnlEl.classList.add(cls);
      const sign = pnl > 0 ? "+" : "";
      pnlEl.textContent = `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
    }
  } else {
    if (pnlEl){
      pnlEl.classList.remove("good","bad");
      pnlEl.classList.add("flat");
      pnlEl.textContent = "PnL: —";
    }
  }

  updateNWTFButtons();
}
function updateNWTFButtons(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;
  wrap.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", (b.dataset.tf === nwTf)));
}
function nwGetIndexFromEvent(evt){
  if (!netWorthChart) return null;
  const pts = netWorthChart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
  if (!pts || !pts.length) return null;
  return pts[0].index;
}
function nwShowHoverValue(idx){
  if (!netWorthChart) return;
  const data = netWorthChart.data.datasets?.[0]?.data || [];
  const labels = netWorthChart.data.labels || [];
  idx = clamp(idx, 0, data.length - 1);
  const v = safe(data[idx]);
  const ts = labelToTs(labels[idx]);
  if (!v) return;

  const el = $("netWorthUsd");
  if (el) el.textContent = `$${v.toFixed(2)}`;

  const pnlEl = $("netWorthPnl");
  if (pnlEl){
    pnlEl.classList.remove("good","bad","flat");
    pnlEl.classList.add("flat");
    pnlEl.textContent = `Point: ${ts ? fmtHHMMSS(ts) : ""} • $${v.toFixed(2)}`;
  }
}
function attachNWInteractions(){
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
    nwHoverActive = false;
    nwHoverIndex = null;
    netWorthChart.update("none");
  };

  canvas.addEventListener("mousemove", onMove, { passive: true });
  canvas.addEventListener("mouseleave", onLeave, { passive: true });
  canvas.addEventListener("touchstart", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchend", onLeave, { passive: true });
  canvas.addEventListener("touchcancel", onLeave, { passive: true });
}
function recordNetWorthPoint(){
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

  if (lastT && dt < 5_000 && dUsd < 0.25) return;

  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);

  clampNWArrays();
  saveNWLocal();
  drawNW();
}

/* ================= APR CHART (simple persist) ================= */
const APR_LOCAL_KEY = "inj_apr_series_v1";
let aprLabels = [];
let aprData = [];
let aprScale = "linear";
let aprChart = null;

function loadAprLocal(){
  try{
    const raw = localStorage.getItem(APR_LOCAL_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    aprLabels = Array.isArray(obj?.labels) ? obj.labels : [];
    aprData = Array.isArray(obj?.data) ? obj.data : [];
  } catch {}
}
function saveAprLocal(){
  try{
    localStorage.setItem(APR_LOCAL_KEY, JSON.stringify({ t: Date.now(), labels: aprLabels, data: aprData }));
  } catch {}
}
function recordAprPoint(v){
  v = safe(v);
  if (!Number.isFinite(v)) return;
  const ts = Date.now();

  const lastTs = aprLabels.length ? labelToTs(aprLabels[aprLabels.length - 1]) : 0;
  if (lastTs && (ts - lastTs) < 30_000) return;

  aprLabels.push(tsLabel(ts));
  aprData.push(v);

  aprLabels = clampArray(aprLabels, 1800);
  aprData = clampArray(aprData, 1800);

  saveAprLocal();
  drawAprChart();
}
const aprLastDotPlugin = {
  id: "aprLastDotPlugin",
  afterDatasetsDraw(ch){
    const meta = ch.getDatasetMeta(0);
    const pts = meta?.data || [];
    if (!pts.length) return;
    const el = pts[pts.length - 1];
    if (!el) return;

    const t = Date.now();
    const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));
    const ctx = ch.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(el.x, el.y, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(250,204,21,${0.95 * pulse})`;
    ctx.fill();
    ctx.restore();
  }
};
function initAprChart(){
  const canvas = $("aprChart");
  if (!canvas || !window.Chart) return;

  aprChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: aprLabels,
      datasets: [{
        data: aprData,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.12)",
        fill: true,
        tension: 0.25,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        borderWidth: 2,
        clip: { left: 0, top: 0, right: 18, bottom: 0 }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display:false }, tooltip: { enabled:true } },
      scales: {
        x: { ticks: { display:false }, grid: { display:false } },
        y: {
          type: (aprScale === "log") ? "logarithmic" : "linear",
          ticks: { color: axisTickColor(), callback: v => `${fmtSmart(v)}%` },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [aprLastDotPlugin]
  });
}
function drawAprChart(){
  if (!aprChart) initAprChart();
  if (!aprChart) return;
  aprChart.data.labels = aprLabels;
  aprChart.data.datasets[0].data = aprData;
  aprChart.options.scales.y.type = (aprScale === "log") ? "logarithmic" : "linear";
  aprChart.update("none");
}

/* ================= RANGE (Stake / Reward) ================= */
const RANGE_KEY_STAKE = "inj_range_stake_max";
const RANGE_KEY_REWARD = "inj_range_reward_max";
let stakeRangeMax = safe(localStorage.getItem(RANGE_KEY_STAKE)) || STAKE_TARGET_DEFAULT_MAX;
let rewardRangeMax = safe(localStorage.getItem(RANGE_KEY_REWARD)) || REWARD_TARGET_DEFAULT_MAX;

function applyStakeRangeToChart(){
  if (!stakeChart) return;
  stakeChart.options.scales.y.min = 0;
  stakeChart.options.scales.y.max = stakeRangeMax > 0 ? stakeRangeMax : undefined;
}
function applyRewardRangeToChart(){
  if (!rewardChart) return;
  rewardChart.options.scales.y.min = 0;
  rewardChart.options.scales.y.max = rewardRangeMax > 0 ? rewardRangeMax : undefined;
}

/* ================= REWARD ESTIMATES ================= */
function updateRewardEstimates(){
  const dayEl = $("rewardEstDay");
  const weekEl = $("rewardEstWeek");
  const monthEl = $("rewardEstMonth");
  if (!dayEl || !weekEl || !monthEl) return;

  const st = safe(stakeInj);
  const a = safe(apr) / 100;
  if (!st || !a){
    dayEl.textContent = "Day: —";
    weekEl.textContent = "Week: —";
    monthEl.textContent = "Month: —";
    return;
  }

  const perDay = st * a / 365;
  const perWeek = perDay * 7;
  const perMonth = perDay * 30;

  dayEl.textContent = `Day: ~${perDay.toFixed(6)} INJ`;
  weekEl.textContent = `Week: ~${perWeek.toFixed(6)} INJ`;
  monthEl.textContent = `Month: ~${perMonth.toFixed(6)} INJ`;
}

/* ================= CLOUD SYNC ================= */
const CLOUD_VER = 2;
const CLOUD_KEY = `inj_cloudmeta_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;
let cloudDirty = false;
let cloudPushTimer = null;

function cloudLoadMeta(){
  try{
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    cloudPts = safe(obj?.pts);
    cloudLastSync = safe(obj?.lastSync);
  } catch {}
}
function cloudSaveMeta(){
  try{
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ v:CLOUD_VER, pts: cloudPts, lastSync: cloudLastSync }));
  } catch {}
}
function cloudRenderMeta(){
  const hist = $("cloudHistory");
  if (hist) hist.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;

  const cloudMenuLast = $("cloudMenuLast");
  if (cloudMenuLast){
    cloudMenuLast.textContent = cloudLastSync ? new Date(cloudLastSync).toLocaleString() : "—";
  }
}
function cloudBumpLocal(points = 1){
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();
  cloudSaveMeta();
  cloudRenderMeta();
}
function cloudSetState(state){
  const root = $("appRoot");
  const st = $("cloudStatus");
  if (!root || !st) return;

  root.classList.remove("cloud-synced","cloud-saving","cloud-error");

  if (state === "saving"){
    root.classList.add("cloud-saving");
    st.textContent = hasInternet() ? "Cloud: Saving" : "Cloud: Offline cache";
  } else if (state === "error"){
    root.classList.add("cloud-error");
    st.textContent = "Cloud: Error";
  } else {
    root.classList.add("cloud-synced");
    st.textContent = hasInternet() ? "Cloud: Synced" : "Cloud: Offline cache";
  }

  const cloudMenuDot = $("cloudMenuDot");
  const cloudMenuStatus = $("cloudMenuStatus");
  if (cloudMenuDot){
    cloudMenuDot.classList.remove("ok","saving","err");
    if (state === "saving") cloudMenuDot.classList.add("saving");
    else if (state === "error") cloudMenuDot.classList.add("err");
    else cloudMenuDot.classList.add("ok");
  }
  if (cloudMenuStatus){
    cloudMenuStatus.textContent = (state === "saving") ? "Saving"
      : (state === "error") ? "Error"
      : hasInternet() ? "Synced" : "Offline cache";
  }

  cloudRenderMeta();
}
function cloudMarkDirty(){
  if (!address) return;
  cloudDirty = true;
  if (!hasInternet()) return;
  scheduleCloudPush();
}
function scheduleCloudPush(){
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => cloudPush(), CLOUD_PUSH_DEBOUNCE_MS);
}
function buildCloudPayload(){
  return {
    v: 2,
    t: Date.now(),
    stake: { labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes },
    wd: { labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll },
    nw: { times: nwTAll, usd: nwUsdAll, inj: nwInjAll },
    apr: { labels: aprLabels, data: aprData }
  };
}
function mergeStakeByLabel(payloadStake){
  if (!payloadStake) return;
  const pl = Array.isArray(payloadStake.labels) ? payloadStake.labels : [];
  const pd = Array.isArray(payloadStake.data) ? payloadStake.data : [];
  const pt = Array.isArray(payloadStake.types) ? payloadStake.types : [];

  const map = new Map();
  for (let i=0;i<stakeLabels.length;i++){
    const k = String(stakeLabels[i]);
    map.set(k, { d: safe(stakeData[i]), t: String(stakeTypes[i] || "Stake update") });
  }
  for (let i=0;i<pl.length;i++){
    const k = String(pl[i]);
    if (!map.has(k)) map.set(k, { d: safe(pd[i]), t: String(pt[i] || "Stake update") });
  }

  const keys = [...map.keys()].sort((a,b)=>labelToTs(a)-labelToTs(b));
  stakeLabels = keys;
  stakeData = keys.map(k => map.get(k).d);
  stakeTypes = keys.map(k => map.get(k).t);

  stakeLabels = clampArray(stakeLabels, SERIES_MAX_POINTS);
  stakeData   = clampArray(stakeData,   SERIES_MAX_POINTS);

  stakeBaselineCaptured = stakeData.length > 0;
  lastStakeRecordedRounded = stakeData.length ? Number(safe(stakeData[stakeData.length - 1]).toFixed(6)) : null;
}
function mergeWd(payloadWd){
  if (!payloadWd) return;
  const pl = Array.isArray(payloadWd.labels) ? payloadWd.labels : [];
  const pv = Array.isArray(payloadWd.values) ? payloadWd.values : [];
  const pt = Array.isArray(payloadWd.times) ? payloadWd.times : [];

  const map = new Map();
  for (let i=0;i<wdTimesAll.length;i++){
    const t = safe(wdTimesAll[i]) || labelToTs(wdLabelsAll[i]);
    if (!t) continue;
    map.set(t, { v: safe(wdValuesAll[i]), l: String(wdLabelsAll[i] || tsLabel(t)) });
  }
  for (let i=0;i<pt.length;i++){
    const t = safe(pt[i]) || labelToTs(pl[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, { v: safe(pv[i]), l: String(pl[i] || tsLabel(t)) });
  }

  const times = [...map.keys()].sort((a,b)=>a-b);
  wdTimesAll  = clampArray(times, SERIES_MAX_POINTS);
  wdValuesAll = clampArray(times.map(t => map.get(t).v), SERIES_MAX_POINTS);
  wdLabelsAll = clampArray(times.map(t => map.get(t).l), SERIES_MAX_POINTS);
}
function mergeUniqueByTs(baseTimes, baseVals, addTimes, addVals){
  const map = new Map();
  for (let i=0;i<baseTimes.length;i++){
    const t = safe(baseTimes[i]);
    if (!t) continue;
    map.set(t, safe(baseVals[i]));
  }
  for (let i=0;i<addTimes.length;i++){
    const t = safe(addTimes[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, safe(addVals[i]));
  }
  const times = [...map.keys()].sort((a,b)=>a-b);
  const vals = times.map(t => map.get(t));
  return { times, vals };
}
function mergeNW(payloadNw){
  if (!payloadNw) return;
  const t = Array.isArray(payloadNw.times) ? payloadNw.times : [];
  const u = Array.isArray(payloadNw.usd) ? payloadNw.usd : [];
  const j = Array.isArray(payloadNw.inj) ? payloadNw.inj : [];

  const m1 = mergeUniqueByTs(nwTAll, nwUsdAll, t, u);
  const m2 = mergeUniqueByTs(nwTAll, nwInjAll, t, j);

  nwTAll = m1.times;
  nwUsdAll = m1.vals;
  nwInjAll = m2.vals;

  clampNWArrays();
}
function mergeApr(payloadApr){
  if (!payloadApr) return;
  const pl = Array.isArray(payloadApr.labels) ? payloadApr.labels : [];
  const pd = Array.isArray(payloadApr.data) ? payloadApr.data : [];

  const map = new Map();
  for (let i=0;i<aprLabels.length;i++){
    const t = labelToTs(aprLabels[i]);
    if (!t) continue;
    map.set(t, safe(aprData[i]));
  }
  for (let i=0;i<pl.length;i++){
    const t = labelToTs(pl[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, safe(pd[i]));
  }
  const times = [...map.keys()].sort((a,b)=>a-b);
  aprLabels = clampArray(times.map(t => tsLabel(t)), 1800);
  aprData = clampArray(times.map(t => map.get(t)), 1800);
  saveAprLocal();
}
async function cloudPull(){
  if (!address) return;
  if (!hasInternet()) { cloudSetState("synced"); return; }

  const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
  const res = await fetchJSON(url);
  if (!res?.ok) { cloudSetState("error"); return; }
  if (!res.data) { cloudSetState("synced"); return; }

  try{
    const data = res.data;
    mergeStakeByLabel(data.stake);
    mergeWd(data.wd);
    mergeNW(data.nw);
    mergeApr(data.apr);

    saveStakeSeriesLocal();
    saveWdAllLocal();
    saveNWLocal();
    drawStakeChart();
    rebuildWdView();
    drawNW();
    drawAprChart();

    cloudLastSync = Date.now();
    cloudSaveMeta();
    cloudSetState("synced");
  } catch {
    cloudSetState("error");
  }
}
async function cloudPush(){
  if (!address) return;
  if (!hasInternet()) return;
  if (!cloudDirty) return;

  cloudSetState("saving");

  const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
  const payload = buildCloudPayload();

  const res = await fetchJSON(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res?.ok) {
    cloudSetState("error");
    return;
  }

  cloudDirty = false;
  cloudLastSync = Date.now();
  cloudSaveMeta();
  cloudSetState("synced");
}

/* ================= MINI ROWS ================= */
function updateNetWorthMiniRows(){
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  setText("netWorthInj", `${totalInj.toFixed(4)} INJ`);
}

/* ================= IMPORTANT PRICE EVENTS ================= */
let lastPriceStepUp = 0;
let lastPriceStepDown = 0;
function maybePriceEvent(pct24h){
  const step = 5;
  const upSteps = Math.floor(Math.max(0, pct24h) / step);
  const dnSteps = Math.floor(Math.max(0, -pct24h) / step);

  if (upSteps > lastPriceStepUp) {
    lastPriceStepUp = upSteps;
    pushEvent({ kind:"price", title:"Price move", detail:`INJ +${(upSteps*step).toFixed(0)}% (24h)`, dir:"up", status:"ok" });
  }
  if (dnSteps > lastPriceStepDown) {
    lastPriceStepDown = dnSteps;
    pushEvent({ kind:"price", title:"Price move", detail:`INJ -${(dnSteps*step).toFixed(0)}% (24h)`, dir:"down", status:"ok" });
  }
}

/* ================= CHART THEME REFRESH ================= */
function refreshChartsTheme(){
  try{
    if (stakeChart) {
      stakeChart.options.scales.y.grid.color = axisGridColor();
      stakeChart.options.scales.y.ticks.color = axisTickColor();
      stakeChart.options.scales.x.grid.color = axisGridColor();
      stakeChart.options.scales.x.ticks.color = axisTickColor();
      stakeChart.update("none");
    }
    if (rewardChart) {
      rewardChart.options.scales.x.grid.color = axisGridColor();
      rewardChart.options.scales.y.grid.color = axisGridColor();
      rewardChart.options.scales.x.ticks.color = axisTickColor();
      rewardChart.options.scales.y.ticks.color = axisTickColor();
      rewardChart.update("none");
    }
    if (priceChart) {
      priceChart.options.scales.y.grid.color = axisGridColor();
      priceChart.options.scales.y.ticks.color = axisTickColor();
      priceChart.update("none");
    }
    if (netWorthChart) {
      netWorthChart.options.scales.y.grid.color = axisGridColor();
      netWorthChart.options.scales.y.ticks.color = axisTickColor();
      netWorthChart.options.scales.x.ticks.color = axisTickColor();
      netWorthChart.update("none");
    }
    if (aprChart) {
      aprChart.options.scales.y.grid.color = axisGridColor();
      aprChart.options.scales.y.ticks.color = axisTickColor();
      aprChart.update("none");
    }
  } catch {}
}

/* ================= SETTINGS + TOOLS ================= */
function syncSettingsUI(){
  setText("settingsModeNow", liveMode ? "LIVE" : "REFRESH");
  setText("settingsCloudNow", hasInternet() ? "Online" : "Offline cache");
}
function updateTools(){
  const eur = safe($("convEur")?.value);
  const px = safe(displayed.price);
  if (!eur || !px){
    setText("convUsd","—");
    setText("convInj","—");
    setText("convInjPrice", px ? `$${px.toFixed(2)}` : "—");
    setText("convFx","—");
    return;
  }
  const fx = 1.0;
  setText("convFx", "—");
  const usd = eur * fx;
  const inj = px ? usd / px : 0;
  setText("convUsd", usd.toFixed(2));
  setText("convInj", inj.toFixed(6));
  setText("convInjPrice", `$${px.toFixed(2)}`);
}

/* ================= BARS RESTORE (PRICE + STAKE + REWARD) ================= */
const GRAD_UP = "linear-gradient(90deg, rgba(34,197,94,.70), rgba(16,185,129,.55))";
const GRAD_DN = "linear-gradient(90deg, rgba(239,68,68,.70), rgba(245,158,11,.55))";

function renderProgress(fillId, lineId, pct){
  const fill = $(fillId);
  const line = $(lineId);
  if (!fill || !line) return;
  const p = clamp(pct, 0, 100);
  fill.style.left = "0%";
  fill.style.width = `${p}%`;
  line.style.left = `${p}%`;
}

function renderAllBars(){
  // Price bars (open-centered)
  renderBar($("priceBar"), $("priceLine"), displayed.price, candle.d.open, candle.d.low, candle.d.high, GRAD_UP, GRAD_DN);
  renderBar($("weekBar"), $("weekLine"), displayed.price, candle.w.open, candle.w.low, candle.w.high, GRAD_UP, GRAD_DN);
  renderBar($("monthBar"), $("monthLine"), displayed.price, candle.m.open, candle.m.low, candle.m.high, GRAD_UP, GRAD_DN);

  setText("priceMin", candle.d.low ? candle.d.low.toFixed(3) : "--");
  setText("priceOpen", candle.d.open ? candle.d.open.toFixed(3) : "--");
  setText("priceMax", candle.d.high ? candle.d.high.toFixed(3) : "--");

  setText("weekMin", candle.w.low ? candle.w.low.toFixed(3) : "--");
  setText("weekOpen", candle.w.open ? candle.w.open.toFixed(3) : "--");
  setText("weekMax", candle.w.high ? candle.w.high.toFixed(3) : "--");

  setText("monthMin", candle.m.low ? candle.m.low.toFixed(3) : "--");
  setText("monthOpen", candle.m.open ? candle.m.open.toFixed(3) : "--");
  setText("monthMax", candle.m.high ? candle.m.high.toFixed(3) : "--");

  const p24 = pctChange(displayed.price, candle.d.open);
  const pw  = pctChange(displayed.price, candle.w.open);
  const pm  = pctChange(displayed.price, candle.m.open);

  updatePerf("arrow24h", "pct24h", p24);
  updatePerf("arrowWeek", "pctWeek", pw);
  updatePerf("arrowMonth", "pctMonth", pm);

  maybePriceEvent(p24);

  // Stake/Reward progress vs user max
  const sMax = Math.max(1e-9, safe(stakeRangeMax) || STAKE_TARGET_DEFAULT_MAX);
  const rMax = Math.max(1e-9, safe(rewardRangeMax) || REWARD_TARGET_DEFAULT_MAX);

  const sPct = (safe(displayed.stake) / sMax) * 100;
  const rPct = (safe(displayed.rewards) / rMax) * 100;

  renderProgress("stakeBar", "stakeLine", sPct);
  renderProgress("rewardBar", "rewardLine", rPct);

  const sp = $("stakePercent"); if (sp) sp.textContent = `${Math.round(clamp(sPct, 0, 999))}%`;
  const rp = $("rewardPercent"); if (rp) rp.textContent = `${Math.round(clamp(rPct, 0, 999))}%`;

  setText("stakeMin", "0");
  setText("stakeMax", String(sMax));
  setText("rewardMin", "0");
  setText("rewardMax", String(rMax));
}

/* ================= MAIN UI RENDER ================= */
function renderNumbers(){
  displayed.price = tick(displayed.price, targetPrice || displayed.price);
  displayed.available = tick(displayed.available, availableInj);
  displayed.stake = tick(displayed.stake, stakeInj);
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  displayed.apr = tick(displayed.apr, apr);

  setText("price", displayed.price ? displayed.price.toFixed(4) : "0.0000");
  setText("available", displayed.available.toFixed(6));
  setText("stake", displayed.stake.toFixed(4));
  setText("rewards", displayed.rewards.toFixed(7));
  setText("apr", `${displayed.apr.toFixed(2)}%`);

  const px = safe(displayed.price);
  setText("availableUsd", px ? `≈ $${(displayed.available * px).toFixed(2)}` : "≈ $0.00");
  setText("stakeUsd", px ? `≈ $${(displayed.stake * px).toFixed(2)}` : "≈ $0.00");
  setText("rewardsUsd", px ? `≈ $${(displayed.rewards * px).toFixed(2)}` : "≈ $0.00");

  const totalInj = safe(displayed.available) + safe(displayed.stake) + safe(displayed.rewards);
  const nwUsd = totalInj * px;
  const nwEl = $("netWorthUsd");
  if (nwEl) nwEl.textContent = `$${(Number.isFinite(nwUsd) ? nwUsd : 0).toFixed(2)}`;

  updateNetWorthMiniRows();
  setText("updated", `Last update: ${fmtHHMMSS(Date.now())}`);

  updateTools();
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  localStorage.setItem("inj_address", address);

  setAddressDisplay(address);
  settleStart = Date.now();

  // reset runtime
  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  accountOnline = false;

  // reload per-wallet persisted series
  loadEvents();
  loadStakeSeriesLocal();
  loadWdAllLocal();
  loadNWLocal();

  // cloud pull
  cloudSetState("saving");
  if (hasInternet()) await cloudPull();

  // refresh mode reload once OR live mode immediate pull
  if (!liveMode) await refreshLoadAllOnce();
  else await loadAccount(true);

  pushEvent({ kind:"system", title:"Wallet set", detail:`${shortAddr(address)}`, status:"ok" });
}

/* ================= BIND UI EVENTS (NO CRASH) ================= */
function bindUI(){
  // header buttons
  $("copyAddressBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); doCopyAddress(); }, {passive:false});

  const searchBtn = $("searchBtn");
  const addressInput = $("addressInput");
  const searchWrap = $("searchWrap");

  searchBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!searchWrap?.classList.contains("open")) openSearch();
    else addressInput?.focus();
  }, { passive: false });

  addressInput?.addEventListener("focus", () => openSearch(), { passive: true });
  addressInput?.addEventListener("input", (e) => { pendingAddress = e.target.value.trim(); }, { passive: true });
  addressInput?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = pendingAddress;
      await commitAddress(v);
      addressInput.value = "";
      pendingAddress = "";
      closeSearch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      addressInput.value = "";
      pendingAddress = "";
      closeSearch();
    }
  });

  document.addEventListener("click", (e) => {
    if (!searchWrap) return;
    if (searchWrap.contains(e.target)) return;
    closeSearch();
  }, { passive: true });

  // drawer open/close
  $("menuBtn")?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleDrawer(); }, { passive:false });
  $("backdrop")?.addEventListener("click", () => closeDrawer(), { passive:true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      closeComingSoon();
      exitFullscreenCard();
      closeSearch();
    }
  });

  // theme toggle
  $("themeToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    applyTheme(theme === "dark" ? "light" : "dark");
  }, { passive:false });

  // live toggle
  $("liveToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    setMode(!liveMode);
  }, { passive:false });

  // drawer nav
  $("drawerNav")?.addEventListener("click", (e) => {
    const btn = e.target?.closest(".nav-item");
    if (!btn) return;
    const page = btn.dataset.page || "dashboard";
    setActivePage(page);
    closeDrawer();

    if (page === "dashboard") showPage("dashboard");
    else if (page === "event" || page === "events") showPage("events");
    else if (page === "tools") showPage("tools");
    else if (page === "settings") showPage("settings");
    else {
      showPage("dashboard");
      openComingSoon(page);
    }
  }, { passive:true });

  // events buttons
  $("eventsClearBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    eventsAll = [];
    eventsUnread = 0;
    eventsPageIndex = 0;
    saveEvents();
    renderEvents(true);
  }, { passive:false });
  $("eventsPrev")?.addEventListener("click", () => { eventsPageIndex--; renderEvents(false); }, { passive:true });
  $("eventsNext")?.addEventListener("click", () => { eventsPageIndex++; renderEvents(false); }, { passive:true });
  $("eventsFilterBtn")?.addEventListener("click", () => {
    const box = $("eventsFilters");
    if (!box) return;
    const hidden = box.getAttribute("aria-hidden") === "true";
    box.setAttribute("aria-hidden", hidden ? "false" : "true");
    box.style.display = hidden ? "block" : "none";
  }, { passive:true });
  $("eventsCategory")?.addEventListener("change", () => { eventsPageIndex = 0; renderEvents(false); }, { passive:true });

  // chart TF + scale
  $("priceTfSwitch")?.addEventListener("click", async (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["1d","1w","1m","1y","all"].includes(tf)) return;
    priceTf = tf;
    priceChartBoot = false;
    await loadPriceChartSelected(true);
  }, { passive:true });

  $("priceScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    priceScale = (priceScale === "log") ? "linear" : "log";
    const b = $("priceScaleToggle");
    if (b) b.textContent = (priceScale === "log") ? "LOG" : "LIN";
    applyPriceChartScale();
  }, { passive:false });

  $("stakeScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    stakeScale = (stakeScale === "log") ? "linear" : "log";
    const b = $("stakeScaleToggle");
    if (b) b.textContent = (stakeScale === "log") ? "LOG" : "LIN";
    drawStakeChart();
  }, { passive:false });

  $("rewardScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    rewardScale = (rewardScale === "log") ? "linear" : "log";
    const b = $("rewardScaleToggle");
    if (b) b.textContent = (rewardScale === "log") ? "LOG" : "LIN";
    drawRewardChart();
  }, { passive:false });

  $("stakeTfSwitch")?.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "all";
    if (!["all","1d","1w","1m"].includes(tf)) return;
    stakeTf = tf;
    $("stakeTfSwitch")?.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", b.dataset.tf === tf));
    drawStakeChart();
  }, { passive:true });

  $("rewardTfSwitch")?.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "all";
    if (!["all","1d","1w","1m"].includes(tf)) return;
    rewardTf = tf;
    $("rewardTfSwitch")?.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", b.dataset.tf === tf));
    drawRewardChart();
  }, { passive:true });

  $("nwTfSwitch")?.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "live";
    if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;
    nwTf = tf;
    saveNWLocal();
    drawNW();
  }, { passive:true });

  $("nwScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    nwScale = (nwScale === "log") ? "linear" : "log";
    const b = $("nwScaleToggle");
    if (b) b.textContent = (nwScale === "log") ? "LOG" : "LIN";
    saveNWLocal();
    drawNW();
  }, { passive:false });

  $("aprScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    aprScale = (aprScale === "log") ? "linear" : "log";
    const b = $("aprScaleToggle");
    if (b) b.textContent = (aprScale === "log") ? "LOG" : "LIN";
    drawAprChart();
  }, { passive:false });

  $("rewardTimeline")?.addEventListener("input", () => syncRewardTimelineUI(false), { passive: true });
  $("rewardFilter")?.addEventListener("change", () => { wdMinFilter = safe($("rewardFilter")?.value || 0); rebuildWdView(); syncRewardTimelineUI(true); }, { passive:true });

  // tools
  $("convEur")?.addEventListener("input", updateTools, { passive:true });
}

/* ================= BOOT LOOP ================= */
let uiRaf = 0;
function uiLoop(){
  renderNumbers();
  renderAllBars();
  refreshConnUI();
  uiRaf = requestAnimationFrame(uiLoop);
}

/* ================= FINAL BOOT ================= */
async function boot(){
  // theme + zoom
  applyTheme(theme);
  ZOOM_OK = tryRegisterZoom();

  // initial UI
  setAddressDisplay(address);
  loadAprLocal();
  cloudLoadMeta();
  cloudRenderMeta();
  cloudSetState("synced");

  if (address){
    loadStakeSeriesLocal();
    loadWdAllLocal();
    loadNWLocal();
    loadEvents();
  } else {
    loadEvents();
  }

  // init charts
  initPriceChart();
  initStakeChart();
  initRewardChart();
  initNWChart();
  initAprChart();

  // bind UI + expand + ptr
  bindUI();
  bindExpandButtons();
  initPullToRefresh();

  // show dashboard by default
  showPage("dashboard");
  setActivePage("dashboard");

  // start mode
  setMode(liveMode);

  // first loads
  await loadCandleSnapshot(true);
  await loadPriceChartSelected(true);
  if (address) await loadAccount(true);

  // timers (LIVE only needs, but safe to start and internal checks skip)
  startAllTimers();

  // cloud pull once
  if (address) cloudPull();

  // start render loop
  if (!uiRaf) uiLoop();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((e)=>{ console.error(e); setStatusError("Boot error"); });
});
