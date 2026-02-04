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
const STAKE_LOCAL_VER = 2;
/* ✅ non resettare più ad ogni refresh: mantieni punti anche se ricarichi pagina */
const RESET_STAKE_FROM_NOW_ON_BOOT = false;

const REWARD_WD_LOCAL_VER = 2;
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* NET WORTH persistence */
const NW_LOCAL_VER = 1;
const NW_MAX_POINTS = 4800;

/* EVENTS persistence */
const EVENTS_LOCAL_VER = 1;
const EVENTS_MAX = 1200;

/* Cloud API */
const CLOUD_API = "/api/point"; // GET/POST -> /api/point?address=inj...
const CLOUD_PUSH_DEBOUNCE_MS = 900;

/* NET WORTH live window */
const NW_LIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minuti LIVE

/* REFRESH mode staging */
const REFRESH_RED_MS = 220;
let refreshLoaded = false;
let refreshLoading = false;

/* ✅ Status dot "mode loading" (switch / data loading) */
let modeLoading = false;

/* Injective logo (stable PNG) */
const INJ_LOGO_PNG =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/nativeinjective/info/logo.png";

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function nowLabel() { return new Date().toLocaleTimeString(); }
function shortAddr(a) { return a && a.length > 18 ? (a.slice(0, 10) + "…" + a.slice(-6)) : (a || ""); }
function setText(id, txt){ const el = $(id); if (el) el.textContent = txt; }

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

function hasInternet() { return navigator.onLine === true; }

/* ================= MONEY + DIGIT COLORING ================= */
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

function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i]
      ? (n > o ? "#22c55e" : "#ef4444")
      : (document.body.dataset.theme === "light" ? "#0f172a" : "#f9fafb");
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
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
let theme   = localStorage.getItem(THEME_KEY) || "dark";
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

/* ================= CONNECTION UI ================= */
const statusDot  = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

/* ✅ Determine if LIVE is truly "ready" */
function liveReady(){
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline; // if no wallet set, don't block green
  return socketsOk && accountOk;
}

/* ✅ Status dot logic:
   - No internet => red
   - Loading (switching / fetching) => orange
   - Ready => green
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
    statusDot.style.background = "#f59e0b"; // orange
    return;
  }

  statusText.textContent = "Online";
  statusDot.style.background = "#22c55e"; // green
}

/* ================= UI READY FAILSAFE ================= */
function setUIReady(force=false){
  const root = $("appRoot");
  if (!root) return;
  if (root.classList.contains("ready")) return;
  if (!force && !tfReady.d) return;
  root.classList.remove("loading");
  root.classList.add("ready");
}

/* ================= SAFE FETCH ================= */
async function fetchJSON(url, opts={}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
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

let address = localStorage.getItem("inj_address") || "";
let pendingAddress = ""; // 👈 input rimane libero

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
    if (!searchWrap.classList.contains("open")) openSearch();
    else addressInput?.focus();
  }, { passive: false });
}

if (addressInput) {
  addressInput.value = ""; // ✅ sempre vuota per nuova ricerca

  addressInput.addEventListener("focus", () => openSearch(), { passive: true });

  addressInput.addEventListener("input", (e) => { pendingAddress = (e.target.value || "").trim(); }, { passive: true });

  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAddress(pendingAddress);
      addressInput.value = ""; // ✅ torna vuota
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

/* ✅ non rompere la lente: chiudi solo se clicchi davvero fuori */
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
  e.preventDefault();
  e.stopPropagation();
  toggleDrawer();
}, { passive: false });

backdrop?.addEventListener("click", () => closeDrawer(), { passive:true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

themeToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive:false });

/* ================= COMING SOON overlay (FIX CLOSE) ================= */
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

/* ✅ robust close handlers */
comingClose?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeComingSoon();
}, { passive:false });

comingSoon?.addEventListener("click", (e) => {
  if (e.target === comingSoon) closeComingSoon();
}, { passive:true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeComingSoon();
});

/* ================= EVENT PAGE (DYNAMIC) ================= */
let eventPage = null;

function ensureEventPage(){
  if (eventPage) return eventPage;

  eventPage = document.getElementById("eventPage");
  if (eventPage) return eventPage;

  eventPage = document.createElement("div");
  eventPage.id = "eventPage";
  eventPage.style.position = "fixed";
  eventPage.style.inset = "0";
  eventPage.style.zIndex = "130";
  eventPage.style.display = "none";
  eventPage.style.overflow = "auto";
  eventPage.style.background = (document.body.dataset.theme === "light")
    ? "rgba(231,234,240,0.96)"
    : "rgba(0,0,0,0.82)";
  eventPage.style.backdropFilter = "blur(14px)";
  eventPage.style.webkitBackdropFilter = "blur(14px)";
  eventPage.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:16px 14px 22px 14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${INJ_LOGO_PNG}" alt="Injective" style="width:26px;height:26px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.25);"/>
          <div>
            <div style="font-weight:950;letter-spacing:.02em;font-size:1.05rem;">Events</div>
            <div id="eventPageSub" style="opacity:.75;font-weight:800;font-size:.82rem;">—</div>
          </div>
        </div>
        <button id="eventCloseBtn" type="button"
          style="height:40px;padding:0 14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);
          background:rgba(255,255,255,.06);font-weight:950;cursor:pointer;">
          Close
        </button>
      </div>

      <div id="eventTableWrap"
        style="border-radius:18px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);overflow:hidden;">
        <div style="display:grid;grid-template-columns: 1.2fr .9fr .9fr .55fr;gap:10px;
          padding:12px 14px;font-weight:950;letter-spacing:.04em;text-transform:uppercase;font-size:.74rem;opacity:.80;">
          <div>Event</div><div>Date</div><div>Value</div><div style="text-align:right;">Status</div>
        </div>
        <div id="eventRows"></div>
      </div>
    </div>
  `;
  document.body.appendChild(eventPage);

  // style theme switch for button
  const btn = eventPage.querySelector("#eventCloseBtn");
  if (btn) {
    btn.style.color = (document.body.dataset.theme === "light") ? "rgba(15,23,42,.88)" : "rgba(249,250,251,.92)";
    btn.style.borderColor = (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(255,255,255,.14)";
    btn.style.background = (document.body.dataset.theme === "light") ? "rgba(15,23,42,.06)" : "rgba(255,255,255,.06)";
  }

  eventPage.querySelector("#eventCloseBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    hideEventPage();
  }, { passive:false });

  // click outside not used (it's full page), but Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideEventPage();
  });

  return eventPage;
}

function showEventPage(){
  ensureEventPage();
  if (!eventPage) return;

  closeComingSoon();
  eventPage.style.display = "block";
  eventPage.setAttribute("aria-hidden","false");

  // update subtitle
  const sub = eventPage.querySelector("#eventPageSub");
  if (sub) sub.textContent = address ? `Wallet: ${shortAddr(address)}` : "No wallet selected";

  renderEventRows();
}

function hideEventPage(){
  if (!eventPage) return;
  eventPage.style.display = "none";
  eventPage.setAttribute("aria-hidden","true");
}

function isEventPageOpen(){
  return !!eventPage && eventPage.style.display === "block";
}

/* ================= MENU NAV ================= */
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
    hideEventPage();
    closeComingSoon();
    return;
  }

  if (page === "event") {
    showEventPage(); // ✅ dedicated page
    return;
  }

  hideEventPage();
  openComingSoon(page);
}, { passive:true });

/* ================= MODE SWITCH ================= */
let accountPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;

function stopAllTimers(){
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
}
function startAllTimers(){
  stopAllTimers();
  accountPollTimer = setInterval(loadAccount, ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(loadCandleSnapshot, REST_SYNC_MS);
  chartSyncTimer = setInterval(loadChartToday, CHART_SYNC_MS);
  ensureChartTimer = setInterval(ensureChartBootstrapped, 1500);
}

async function refreshLoadAllOnce(){
  if (refreshLoading) return;
  if (!hasInternet()) { refreshLoaded = false; refreshConnUI(); cloudSetState("offline"); return; }

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
  e.preventDefault();
  setMode(!liveMode);
}, { passive:false });

/* ================= CLOUD SYNC (REAL) ================= */
let cloudState = "synced"; // synced | saving | error | offline
let cloudInFlight = false;
let cloudPushTimer = null;
let cloudLastOk = 0;

function cloudSetState(state){
  cloudState = state || "synced";

  // footer
  const root = $("appRoot");
  const st = $("cloudStatus");
  if (root) root.classList.remove("cloud-synced","cloud-saving","cloud-error");
  if (root && cloudState === "saving") root.classList.add("cloud-saving");
  if (root && cloudState === "error") root.classList.add("cloud-error");
  if (root && (cloudState === "synced" || cloudState === "offline")) root.classList.add("cloud-synced");

  if (st) {
    if (!hasInternet()) st.textContent = "Cloud: Offline cache";
    else if (cloudState === "saving") st.textContent = "Cloud: Syncing…";
    else if (cloudState === "error") st.textContent = "Cloud: Error";
    else st.textContent = "Cloud: Synced";
  }

  // drawer (optional)
  const ds = $("drawerCloudStatus");
  if (ds) {
    if (!hasInternet()) ds.textContent = "Offline cache";
    else if (cloudState === "saving") ds.textContent = "Syncing…";
    else if (cloudState === "error") ds.textContent = "Error";
    else ds.textContent = "Synced";
  }
}

function cloudRenderCounts(){
  const hist = $("cloudHistory");
  if (!hist) return;
  const pts =
    (stakeData?.length || 0) +
    (wdValuesAll?.length || 0) +
    (nwUsdAll?.length || 0) +
    (eventsAll?.length || 0);
  hist.textContent = `· ${Math.max(0, Math.floor(pts))} pts`;
}

function makeCloudPayload(){
  return {
    v: 2,
    t: Date.now(),
    stake: { labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes },
    wd: { labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll },
    nw: { times: nwTAll, usd: nwUsdAll, inj: nwInjAll, tf: nwTf },
    ev: { items: eventsAll }
  };
}

async function cloudPull(){
  if (!address) return null;
  if (!hasInternet()) return null;
  const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
  const r = await fetchJSON(url);
  if (!r?.ok) return null;
  return r.data || null;
}

async function cloudPushNow(){
  if (!address) return false;
  if (!hasInternet()) { cloudSetState("offline"); return false; }
  if (cloudInFlight) return false;

  cloudInFlight = true;
  cloudSetState("saving");
  cloudRenderCounts();

  try{
    const url = `${CLOUD_API}?address=${encodeURIComponent(address)}`;
    const payload = makeCloudPayload();
    const res = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res?.ok) throw new Error("cloud push failed");
    cloudLastOk = Date.now();
    cloudSetState("synced");
    cloudRenderCounts();
    return true;
  } catch (e){
    console.warn("Cloud push error:", e);
    cloudSetState("error");
    return false;
  } finally {
    cloudInFlight = false;
  }
}

function cloudSchedulePush(){
  if (!address) return;
  if (cloudPushTimer) clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    cloudPushTimer = null;
    cloudPushNow();
  }, CLOUD_PUSH_DEBOUNCE_MS);
}

function uniqMergeByKey(items, keyFn){
  const seen = new Set();
  const out = [];
  for (const it of items || []){
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function mergeSeriesArrays(localArrs, remoteArrs, max){
  // merge by index alignment + clamp.
  // For stake/wd (string labels), we merge by label+value key.
  const { labelsL, dataL, extra1L, extra2L } = localArrs;
  const { labelsR, dataR, extra1R, extra2R } = remoteArrs;

  const merged = [];
  for (let i=0;i<(labelsR?.length||0);i++){
    merged.push({ l:String(labelsR[i]??""), v:+dataR[i]||0, e1: extra1R?.[i], e2: extra2R?.[i] });
  }
  for (let i=0;i<(labelsL?.length||0);i++){
    merged.push({ l:String(labelsL[i]??""), v:+dataL[i]||0, e1: extra1L?.[i], e2: extra2L?.[i] });
  }

  const uniq = uniqMergeByKey(merged, (x)=> `${x.l}|${Number(x.v).toFixed(8)}|${x.e1 ?? ""}|${x.e2 ?? ""}`);
  const tail = uniq.slice(-max);

  return {
    labels: tail.map(x=>x.l),
    data: tail.map(x=>x.v),
    extra1: tail.map(x=>x.e1 ?? 0),
    extra2: tail.map(x=>x.e2 ?? "Stake update"),
  };
}

function mergeNW(local, remote){
  const L = [];
  for (let i=0;i<nwTAll.length;i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    const inj = safe(nwInjAll[i]);
    if (t && u) L.push({t,u,inj});
  }
  const R = [];
  const rt = remote?.times || remote?.tAll || [];
  const ru = remote?.usd || remote?.usdAll || [];
  const ri = remote?.inj || remote?.injAll || [];
  for (let i=0;i<rt.length;i++){
    const t = safe(rt[i]);
    const u = safe(ru[i]);
    const inj = safe(ri[i]);
    if (t && u) R.push({t,u,inj});
  }
  const all = [...R, ...L];
  const uniq = uniqMergeByKey(all, (x)=> String(x.t));
  uniq.sort((a,b)=>a.t-b.t);
  const tail = uniq.slice(-NW_MAX_POINTS);
  nwTAll = tail.map(x=>x.t);
  nwUsdAll = tail.map(x=>x.u);
  nwInjAll = tail.map(x=>x.inj);
}

function mergeEvents(localItems, remoteItems){
  const L = Array.isArray(localItems) ? localItems : [];
  const R = Array.isArray(remoteItems) ? remoteItems : [];
  const all = [...R, ...L];
  const uniq = uniqMergeByKey(all, (x)=> x?.id ? String(x.id) : "");
  uniq.sort((a,b)=> safe(a?.t) - safe(b?.t));
  return uniq.slice(-EVENTS_MAX);
}

async function cloudHydrateAndMerge(){
  if (!address) return;

  // local already loaded by normal loaders; now pull remote and merge
  cloudSetState(hasInternet() ? "saving" : "offline");

  const remote = await cloudPull();
  if (!remote) {
    cloudSetState(hasInternet() ? "error" : "offline");
    cloudRenderCounts();
    return;
  }

  // stake
  if (remote.stake) {
    const m = mergeSeriesArrays(
      { labelsL: stakeLabels, dataL: stakeData, extra1L: stakeMoves, extra2L: stakeTypes },
      { labelsR: remote.stake.labels, dataR: remote.stake.data, extra1R: remote.stake.moves, extra2R: remote.stake.types },
      2400
    );
    stakeLabels = m.labels;
    stakeData = m.data;
    stakeMoves = m.extra1;
    stakeTypes = m.extra2;
    saveStakeSeriesLocalOnly();
    drawStakeChart();
  }

  // wd
  if (remote.wd) {
    // merge by time (best key)
    const LR = [];
    for (let i=0;i<wdTimesAll.length;i++) LR.push({t:safe(wdTimesAll[i]), l:String(wdLabelsAll[i]||""), v:safe(wdValuesAll[i])});
    const RR = [];
    for (let i=0;i<(remote.wd.times||[]).length;i++) RR.push({t:safe(remote.wd.times[i]), l:String(remote.wd.labels?.[i]||""), v:safe(remote.wd.values?.[i])});

    const all = [...RR, ...LR].filter(x=>x.t && x.v>0);
    const uniq = uniqMergeByKey(all, (x)=> String(x.t));
    uniq.sort((a,b)=>a.t-b.t);
    const tail = uniq.slice(-2400);

    wdTimesAll = tail.map(x=>x.t);
    wdLabelsAll = tail.map(x=>x.l || fmtHHMM(x.t));
    wdValuesAll = tail.map(x=>x.v);

    saveWdAllLocalOnly();
    rebuildWdView();
    goRewardLive();
  }

  // nw
  if (remote.nw) {
    mergeNW(null, remote.nw);
    saveNWLocalOnly();
    drawNW();
  }

  // events
  if (remote.ev?.items) {
    eventsAll = mergeEvents(eventsAll, remote.ev.items);
    saveEventsLocalOnly();
    renderEventRows();
  }

  cloudSetState("synced");
  cloudRenderCounts();

  // if local seems newer, push back (light)
  cloudSchedulePush();
}

/* ================= LOCAL STORAGE (SERIES) ================= */
function stakeStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function saveStakeSeriesLocalOnly() {
  const key = stakeStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: STAKE_LOCAL_VER, t: Date.now(),
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes
    }));
  } catch {}
}
function saveStakeSeries() {
  saveStakeSeriesLocalOnly();
  cloudRenderCounts();
  cloudSchedulePush();
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

/* WD */
function wdStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_reward_withdrawals_v${REWARD_WD_LOCAL_VER}_${a}` : null;
}
function saveWdAllLocalOnly() {
  const key = wdStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: REWARD_WD_LOCAL_VER, t: Date.now(),
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll
    }));
  } catch {}
}
function saveWdAll() {
  saveWdAllLocalOnly();
  cloudRenderCounts();
  cloudSchedulePush();
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

/* NW */
function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}
function saveNWLocalOnly(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll, usdAll: nwUsdAll, injAll: nwInjAll, tf: nwTf
    }));
  } catch {}
}
function saveNW(){
  saveNWLocalOnly();
  cloudRenderCounts();
  cloudSchedulePush();
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
    nwTf = (obj.tf === "1w" || obj.tf === "1m" || obj.tf === "1y" || obj.tf === "all" || obj.tf === "live") ? obj.tf : "1d";

    clampNWArrays();
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

/* EVENTS */
let eventsAll = [];
function evStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_events_v${EVENTS_LOCAL_VER}_${a}` : null;
}
function saveEventsLocalOnly(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EVENTS_LOCAL_VER, t: Date.now(), items: eventsAll }));
  } catch {}
}
function saveEvents(){
  saveEventsLocalOnly();
  cloudRenderCounts();
  cloudSchedulePush();
}
function loadEvents(){
  const key = evStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== EVENTS_LOCAL_VER) return false;
    eventsAll = Array.isArray(obj.items) ? obj.items : [];
    eventsAll = eventsAll.slice(-EVENTS_MAX);
    return true;
  } catch {
    return false;
  }
}

function makeEventId(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function pushEvent(ev){
  if (!address) return;
  const clean = {
    id: ev?.id || makeEventId("ev"),
    t: safe(ev?.t) || Date.now(),
    type: String(ev?.type || "event"),
    title: String(ev?.title || "Event"),
    value: String(ev?.value || ""),
    status: String(ev?.status || "ok") // ok | pending | fail
  };
  eventsAll.push(clean);
  if (eventsAll.length > EVENTS_MAX) eventsAll = eventsAll.slice(-EVENTS_MAX);

  saveEvents();
  renderEventRows();
  showToastEvent(clean);
}

function statusBadgeHTML(st){
  const s = String(st||"ok");
  if (s === "pending") {
    return `<span style="display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;">
      <span style="width:9px;height:9px;border-radius:50%;background:#f59e0b;box-shadow:0 0 14px rgba(245,158,11,.45);
        animation: evPulse 1.1s infinite;"></span>
    </span>`;
  }
  if (s === "fail") {
    return `<span style="display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;">
      <span style="width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 14px rgba(239,68,68,.35);"></span>
    </span>`;
  }
  return `<span style="display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;">
    <span style="width:9px;height:9px;border-radius:50%;background:#22c55e;box-shadow:0 0 14px rgba(34,197,94,.30);"></span>
  </span>`;
}

function ensureToastCSS(){
  if (document.getElementById("toastEventCSS")) return;
  const st = document.createElement("style");
  st.id = "toastEventCSS";
  st.textContent = `
    @keyframes toastSlideDown { 0% { transform: translateY(-18px); opacity: 0; } 12% { opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
    @keyframes toastFade { 0% { opacity: 1; } 100% { opacity: 0; transform: translateY(-8px); } }
    @keyframes evPulse { 0% { transform: scale(1); opacity: .7; } 50% { transform: scale(1.35); opacity: 1; } 100% { transform: scale(1); opacity: .7; } }
  `;
  document.head.appendChild(st);
}

function showToastEvent(ev){
  ensureToastCSS();

  const toast = document.createElement("div");
  toast.style.position = "fixed";
  toast.style.left = "50%";
  toast.style.top = "12px";
  toast.style.transform = "translateX(-50%)";
  toast.style.zIndex = "150";
  toast.style.width = "min(520px, 92vw)";
  toast.style.borderRadius = "16px";
  toast.style.border = (document.body.dataset.theme==="light") ? "1px solid rgba(15,23,42,.14)" : "1px solid rgba(255,255,255,.12)";
  toast.style.background = (document.body.dataset.theme==="light") ? "rgba(240,242,246,.96)" : "rgba(11,18,32,.92)";
  toast.style.boxShadow = "0 24px 80px rgba(0,0,0,.45)";
  toast.style.padding = "12px 12px";
  toast.style.animation = "toastSlideDown 220ms ease both";

  toast.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <img src="${INJ_LOGO_PNG}" style="width:22px;height:22px;border-radius:7px;" alt="INJ"/>
        <div style="min-width:0;">
          <div style="font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ev.title}</div>
          <div style="opacity:.75;font-weight:800;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${new Date(ev.t).toLocaleString()} · ${ev.value || ""}</div>
        </div>
      </div>
      <div>${statusBadgeHTML(ev.status)}</div>
    </div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastFade 260ms ease both";
    setTimeout(() => toast.remove(), 320);
  }, 2400);
}

function renderEventRows(){
  if (!eventPage) return;
  const rows = eventPage.querySelector("#eventRows");
  if (!rows) return;

  const items = (eventsAll || []).slice().reverse(); // newest first
  if (!items.length) {
    rows.innerHTML = `<div style="padding:14px;opacity:.75;font-weight:850;">No events yet.</div>`;
    return;
  }

  const fg = (document.body.dataset.theme==="light") ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)";
  const muted = (document.body.dataset.theme==="light") ? "rgba(15,23,42,.62)" : "rgba(249,250,251,.62)";
  const border = (document.body.dataset.theme==="light") ? "rgba(15,23,42,.10)" : "rgba(255,255,255,.10)";
  const bgRow = (document.body.dataset.theme==="light") ? "rgba(15,23,42,.03)" : "rgba(255,255,255,.03)";

  rows.innerHTML = items.map((ev, idx) => {
    const dt = new Date(safe(ev.t) || Date.now());
    const dtStr = dt.toLocaleDateString() + " " + dt.toLocaleTimeString();
    const v = String(ev.value || "—");
    return `
      <div style="display:grid;grid-template-columns: 1.2fr .9fr .9fr .55fr;gap:10px;
        padding:12px 14px;border-top:1px solid ${border};background:${idx%2?bgRow:"transparent"};color:${fg};">
        <div style="font-weight:950;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${String(ev.title||"Event")}</div>
        <div style="color:${muted};font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dtStr}</div>
        <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v}</div>
        <div style="text-align:right;">${statusBadgeHTML(ev.status)}</div>
      </div>
    `;
  }).join("");
}

/* ================= INJECTIVE LOGO SWAP ================= */
function swapInjectiveLogos(){
  // net worth asset icon
  const icons = document.querySelectorAll(".nw-asset-icon, .nw-coin-logo");
  icons.forEach((el) => {
    // if already an img, skip
    if (el.querySelector && el.querySelector("img")) return;

    // keep size if it's a square wrapper
    const img = document.createElement("img");
    img.src = INJ_LOGO_PNG;
    img.alt = "Injective";
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.borderRadius = "inherit";

    // if element is span with no dimensions, set a reasonable
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.width || "0");
    const h = parseFloat(cs.height || "0");
    if (w < 8 || h < 8) {
      el.style.display = "inline-block";
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "7px";
      el.style.overflow = "hidden";
      el.style.boxShadow = "0 12px 40px rgba(0,0,0,.22)";
    }
    el.textContent = "";
    el.appendChild(img);
  });
}

/* ================= VALIDATOR CARD (DEDUP + UI) ================= */
let validatorAddr = "";
let validatorMoniker = "";
let validatorBonded = false;
let validatorLoading = false;

function ensureSingleValidatorCard(){
  const cards = Array.from(document.querySelectorAll(".validator-card"));
  if (cards.length > 1) {
    for (let i=1;i<cards.length;i++) cards[i].remove();
  }
}

function ensureValidatorCard(){
  ensureSingleValidatorCard();

  let card = document.querySelector(".validator-card");
  if (card) return card;

  // if not present, create one (safe)
  const cardsWrap = document.querySelector(".cards-wrapper");
  if (!cardsWrap) return null;

  card = document.createElement("div");
  card.className = "card validator-card";
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div style="display:flex;align-items:center;gap:10px;min-width:0;">
        <div style="width:36px;height:36px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.05);">
          <img src="${INJ_LOGO_PNG}" alt="Injective" style="width:100%;height:100%;object-fit:cover;"/>
        </div>
        <div style="min-width:0;">
          <div style="font-weight:950;font-size:1.0rem;letter-spacing:.02em;">Validator</div>
          <div id="validatorLine" style="opacity:.75;font-weight:850;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="validatorDot" style="width:10px;height:10px;border-radius:50%;background:#f59e0b;box-shadow:0 0 14px rgba(245,158,11,.45);animation: evPulse 1.1s infinite;"></span>
      </div>
    </div>
  `;
  // put it under Net Worth card, if exists
  const nw = document.getElementById("netWorthCard");
  if (nw && nw.parentElement === cardsWrap) {
    nw.insertAdjacentElement("afterend", card);
  } else {
    cardsWrap.insertAdjacentElement("afterbegin", card);
  }

  ensureToastCSS(); // for pulse animation reuse
  return card;
}

function setValidatorDot(state){
  // state: loading | ok | fail
  const dot = document.getElementById("validatorDot") || document.querySelector(".validator-card #validatorDot");
  if (!dot) return;

  dot.style.animation = "";
  dot.style.boxShadow = "";

  if (!hasInternet()) state = "fail";

  if (state === "loading") {
    dot.style.background = "#f59e0b";
    dot.style.boxShadow = "0 0 16px rgba(245,158,11,.45)";
    dot.style.animation = "evPulse 1.1s infinite";
    return;
  }
  if (state === "fail") {
    dot.style.background = "#ef4444";
    dot.style.boxShadow = "0 0 16px rgba(239,68,68,.35)";
    return;
  }
  dot.style.background = "#22c55e";
  dot.style.boxShadow = "0 0 16px rgba(34,197,94,.30)";
}

function setValidatorLine(txt){
  const line = document.getElementById("validatorLine") || document.querySelector(".validator-card #validatorLine");
  if (line) line.textContent = txt || "—";
}

async function loadValidatorInfo(opAddr){
  ensureValidatorCard();
  if (!opAddr) {
    validatorAddr = "";
    validatorMoniker = "";
    validatorBonded = false;
    setValidatorLine("No validator found");
    setValidatorDot(hasInternet() ? "loading" : "fail");
    return;
  }

  if (!hasInternet()) {
    validatorAddr = opAddr;
    setValidatorLine(`${shortAddr(opAddr)} · Offline`);
    setValidatorDot("fail");
    return;
  }

  validatorLoading = true;
  setValidatorDot("loading");

  const base = "https://lcd.injective.network";
  const v = await fetchJSON(`${base}/cosmos/staking/v1beta1/validators/${encodeURIComponent(opAddr)}`);
  validatorLoading = false;

  if (!v?.validator) {
    validatorAddr = opAddr;
    setValidatorLine(`${shortAddr(opAddr)} · Unknown`);
    setValidatorDot("fail");
    return;
  }

  validatorAddr = opAddr;
  validatorMoniker = v.validator?.description?.moniker || "";
  const st = String(v.validator?.status || "");
  validatorBonded = (st.includes("BONDED") || st === "BOND_STATUS_BONDED");

  const label = validatorMoniker
    ? `${validatorMoniker} · ${shortAddr(opAddr)}`
    : `${shortAddr(opAddr)}`;

  setValidatorLine(label);
  setValidatorDot(validatorBonded ? "ok" : "loading");
}

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0, netWorthUsd: 0 };

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

function clearTradeRetry() {
  if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; }
}
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

    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}

function clearKlineRetry() {
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }
}
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
    clearKlineRetry();
  };
  wsKline.onclose = () => { wsKlineOnline = false; refreshConnUI(); scheduleKlineRetry(); };
  wsKline.onerror = () => { wsKlineOnline = false; refreshConnUI(); try { wsKline.close(); } catch {} scheduleKlineRetry(); };

  wsKline.onmessage = async (e) => {
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
async function loadAccount(isRefresh=false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet()) {
    accountOnline = false;
    refreshConnUI();
    setValidatorDot("fail");
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
    setValidatorDot("fail");
    return;
  }

  accountOnline = true;
  modeLoading = false;
  refreshConnUI();

  const bal = b.balances?.find(x => x.denom === "inj");
  availableInj = safe(bal?.amount) / 1e18;

  const delgs = (s.delegation_responses || []);
  stakeInj = delgs.reduce((a, d) => a + safe(d?.balance?.amount), 0) / 1e18;

  // validator addr (first delegation)
  const firstVal = delgs?.[0]?.delegation?.validator_address || "";
  if (firstVal && firstVal !== validatorAddr) {
    loadValidatorInfo(firstVal);
  } else if (!firstVal) {
    loadValidatorInfo("");
  }

  const newRewards = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  const prevRewards = rewardsInj;
  rewardsInj = newRewards;

  apr = safe(i.inflation) * 100;

  maybeAddStakePoint(stakeInj);
  maybeRecordRewardWithdrawal(rewardsInj, prevRewards);

  /* ✅ NET WORTH: record point once account updates */
  recordNetWorthPoint();

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
  const typ = delta > 0 ? "Delegate / Compound" : "Undelegate";
  stakeTypes.push(typ);

  // ✅ event
  pushEvent({
    type: "stake",
    title: delta > 0 ? "Stake increased" : "Stake decreased",
    value: `${delta > 0 ? "+" : ""}${delta.toFixed(6)} INJ`,
    status: hasInternet() ? "ok" : "pending"
  });

  saveStakeSeries();
  drawStakeChart();
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
  }, { passive: true });
}

function maybeRecordRewardWithdrawal(newRewards, prevRewardsForEvent=null) {
  const r = safe(newRewards);

  if (wdLastRewardsSeen == null) {
    wdLastRewardsSeen = r;
    return;
  }

  const diff = wdLastRewardsSeen - r;
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    const t = Date.now();
    wdTimesAll.push(t);
    wdLabelsAll.push(nowLabel());
    wdValuesAll.push(diff);
    saveWdAll();
    rebuildWdView();
    goRewardLive();

    // ✅ event (reward withdrawn)
    pushEvent({
      type: "reward",
      title: "Rewards withdrawn",
      value: `+${diff.toFixed(6)} INJ`,
      status: hasInternet() ? "ok" : "pending"
    });
  }

  // if rewards increased a lot (compound / accrual), optional
  const prev = safe(prevRewardsForEvent);
  if (prev && (r - prev) > 0.002) {
    pushEvent({
      type: "reward",
      title: "Rewards increased",
      value: `+${(r - prev).toFixed(6)} INJ`,
      status: "ok"
    });
  }

  wdLastRewardsSeen = r;
}

/* ================= NET WORTH (persist + chart) ================= */
let nwTf = "1d"; // live | 1d | 1w | 1m | 1y | all
let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];
let netWorthChart = null;

let nwHoverActive = false;
let nwHoverIndex = null;

/* window ms */
function nwWindowMs(tf){
  if (tf === "live") return NW_LIVE_WINDOW_MS;
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  if (tf === "all") return 3650 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/* ✅ view builder */
function nwBuildView(tf){
  const now = Date.now();
  const w = nwWindowMs(tf);
  const minT = now - w;

  const labels = [];
  const data = [];
  const times = [];

  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    const u = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(u) && u > 0) {
      times.push(t);
      labels.push((tf === "1y" || tf === "all") ? new Date(t).toLocaleDateString() : fmtHHMM(t));
      data.push(u);
    }
  }

  return { labels, data, times };
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
  netWorthChart.update("none");
}

/* ✅ Vertical line while interacting */
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

/* ✅ Blinking yellow dot at last point */
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
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          display: true,
          ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6, padding: 8 },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          position: "right",
          ticks: { color: axisTickColor(), padding: 10, maxTicksLimit: 5, callback: (v) => `$${fmtSmart(v)}` },
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
  netWorthChart.update("none");

  // PnL only for non-live
  const pnlEl = $("netWorthPnl");
  if (pnlEl && view.data.length >= 2 && nwTf !== "live") {
    const first = safe(view.data[0]);
    const last = safe(view.data[view.data.length - 1]);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    pnlEl.classList.remove("good","bad","flat");
    const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
    pnlEl.classList.add(cls);
    const sign = pnl > 0 ? "+" : "";
    pnlEl.textContent = `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
    nwApplySignStyling(pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat"));
  } else if (pnlEl && nwTf !== "live") {
    pnlEl.classList.remove("good","bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = "PnL: —";
    nwApplySignStyling("flat");
  }
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
  const lab = labels[idx] || "";
  if (!v) return;

  const el = $("netWorthUsd");
  if (el) el.textContent = `$${v.toFixed(2)}`;

  const pnlEl = $("netWorthPnl");
  if (pnlEl){
    pnlEl.classList.remove("good","bad","flat");
    pnlEl.classList.add("flat");
    pnlEl.textContent = `Point: ${lab} • $${v.toFixed(2)}`;
  }
}

function nwRestoreRealtimeValue(){
  nwHoverActive = false;
  nwHoverIndex = null;
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

function attachNWTFHandlers(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  // ensure LIVE button exists (without editing HTML)
  const existing = Array.from(wrap.querySelectorAll(".tf-btn")).map(b => b.dataset.tf);
  if (!existing.includes("live")) {
    const liveBtn = document.createElement("button");
    liveBtn.className = "tf-btn";
    liveBtn.type = "button";
    liveBtn.dataset.tf = "live";
    liveBtn.textContent = "LIVE";
    wrap.insertAdjacentElement("afterbegin", liveBtn);
  }

  const btns = wrap.querySelectorAll(".tf-btn");
  btns.forEach(b => b.classList.toggle("active", b.dataset.tf === nwTf));

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;

    // ✅ lock: if timeframe not enough data, block selection (except live/1d)
    if (tf !== "live" && tf !== "1d") {
      const oldest = nwTAll.length ? safe(nwTAll[0]) : 0;
      const span = Date.now() - oldest;
      const need = nwWindowMs(tf);
      if (span < need * 0.25) { // soft lock
        pushEvent({ type:"ui", title:"Timeframe locked", value:`Not enough data for ${tf.toUpperCase()}`, status:"pending" });
        return;
      }
    }

    nwTf = tf;
    btns.forEach(b => b.classList.toggle("active", b.dataset.tf === tf));
    saveNW();
    drawNW();
  }, { passive:true });
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
  saveNW();
  drawNW();
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

    // event page theme
    if (eventPage) {
      eventPage.style.background = (document.body.dataset.theme === "light")
        ? "rgba(231,234,240,0.96)"
        : "rgba(0,0,0,0.82)";
    }

    // validator line/dot uses inline + animation -> ok
  } catch {}
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  localStorage.setItem("inj_address", address);

  setAddressDisplay(address);
  settleStart = Date.now();

  // reset numeric targets
  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  displayed.available = 0; displayed.stake = 0; displayed.rewards = 0; displayed.netWorthUsd = 0;

  // series load local
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
  attachNWTFHandlers();
  drawNW();

  loadEvents();
  renderEventRows();

  ensureValidatorCard();
  setValidatorDot(hasInternet() ? "loading" : "fail");
  setValidatorLine("Loading…");

  // swap logos
  swapInjectiveLogos();

  // cloud hydrate from backend -> merge -> push
  await cloudHydrateAndMerge();

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
  setValidatorDot("loading");
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
  cloudSetState("offline");
  setValidatorDot("fail");
}, { passive: true });

/* ================= PULL TO REFRESH (ONLY REFRESH MODE) ================= */
let pullWrap = null;
let pullStartY = 0;
let pulling = false;
let pullDist = 0;

function ensurePullUI(){
  if (pullWrap) return pullWrap;
  pullWrap = document.getElementById("pullRefresh");
  if (pullWrap) return pullWrap;

  pullWrap = document.createElement("div");
  pullWrap.id = "pullRefresh";
  pullWrap.style.position = "fixed";
  pullWrap.style.left = "0";
  pullWrap.style.right = "0";
  pullWrap.style.top = "-64px";
  pullWrap.style.height = "64px";
  pullWrap.style.display = "grid";
  pullWrap.style.placeItems = "center";
  pullWrap.style.zIndex = "140";
  pullWrap.style.pointerEvents = "none";
  pullWrap.innerHTML = `
    <div id="pullSpinner" style="width:22px;height:22px;border-radius:50%;
      border:3px solid rgba(250,204,21,.28);border-top-color: rgba(250,204,21,.95);
      transform: rotate(0deg);"></div>
  `;
  document.body.appendChild(pullWrap);

  // animation
  const st = document.createElement("style");
  st.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(st);

  return pullWrap;
}

function pullSet(y){
  ensurePullUI();
  const t = clamp(y, -64, 0);
  pullWrap.style.top = `${t}px`;
}

function pullSpin(on){
  const sp = document.getElementById("pullSpinner");
  if (!sp) return;
  sp.style.animation = on ? "spin 700ms linear infinite" : "none";
}

function attachPullToRefresh(){
  // only mobile-like gestures
  window.addEventListener("touchstart", (e) => {
    if (liveMode) return; // ✅ only refresh mode
    if (isDrawerOpen || isEventPageOpen()) return;
    if (window.scrollY > 0) return;

    pulling = true;
    pullStartY = e.touches?.[0]?.clientY || 0;
    pullDist = 0;
    pullSpin(false);
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    if (liveMode) return;
    if (window.scrollY > 0) return;

    const y = e.touches?.[0]?.clientY || 0;
    pullDist = Math.max(0, y - pullStartY);
    const eased = Math.min(64, pullDist * 0.55);
    pullSet(-64 + eased);
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;

    if (liveMode) { pullSet(-64); return; }

    // threshold
    if (pullDist > 90) {
      pullSet(0);
      pullSpin(true);
      pushEvent({ type:"ui", title:"Manual refresh", value:"Refresh triggered", status:"pending" });

      await refreshLoadAllOnce();

      pullSpin(false);
      setTimeout(() => pullSet(-64), 220);
      return;
    }
    pullSet(-64);
  }, { passive: true });
}

/* ================= BOOT ================= */
(async function boot() {
  // menu drawer cloud status elements (optional) – create if missing
  const drawerFoot = drawer?.querySelector(".drawer-foot");
  if (drawerFoot && !document.getElementById("drawerCloudRow")) {
    const row = document.createElement("div");
    row.id = "drawerCloudRow";
    row.style.marginTop = "10px";
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.fontSize = ".78rem";
    row.style.opacity = ".86";
    row.innerHTML = `
      <div style="font-weight:900;">App v2.0.2</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="opacity:.8;font-weight:850;">Cloud</span>
        <span id="drawerCloudStatus" style="font-weight:950;">—</span>
      </div>
    `;
    drawerFoot.appendChild(row);
  }

  // initial states
  cloudSetState(hasInternet() ? "synced" : "offline");
  cloudRenderCounts();

  refreshConnUI();
  setTimeout(() => setUIReady(true), 2800);

  attachRewardTimelineHandlers();
  attachRewardLiveHandler();
  attachRewardFilterHandler();
  attachPullToRefresh();

  // ensure pages
  ensureEventPage(); // ready for rendering rows
  hideEventPage();

  // load current address
  setAddressDisplay(address);
  wdMinFilter = safe($("rewardFilter")?.value || 0);

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  // stake load
  if (address && RESET_STAKE_FROM_NOW_ON_BOOT) {
    clearStakeSeriesStorage();
    resetStakeSeriesFromNow();
  } else {
    loadStakeSeries();
    drawStakeChart();
  }

  // reward + nw + events
  if (address) {
    loadWdAll();
    rebuildWdView();
    goRewardLive();

    loadNW();
    attachNWTFHandlers();
    drawNW();

    loadEvents();
    renderEventRows();
  } else {
    attachNWTFHandlers();
    drawNW();
  }

  // validator + logos
  ensureValidatorCard();
  swapInjectiveLogos();
  if (address) setValidatorDot(hasInternet() ? "loading" : "fail");

  modeLoading = true;
  refreshConnUI();

  // hydrate cloud first (so charts don't reset across devices)
  if (address) await cloudHydrateAndMerge();

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

  cloudSetState(hasInternet() ? "synced" : "offline");
  cloudRenderCounts();
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

  // APR + time
  setText("apr", safe(apr).toFixed(2) + "%");
  setText("updated", "Last update: " + nowLabel());

  /* ================= NET WORTH UI ================= */
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);

    // only update pnl when not live
    if (nwTf !== "live") drawNW();
  }

  // networth mini (ids from your HTML: netWorthInj + nwAssetQty/Price/Usd)
  setText("netWorthInj", `${totalInj.toFixed(4)} INJ`);
  setText("nwAssetQty", totalInj.toFixed(4));
  setText("nwAssetPrice", `$${safe(displayed.price).toFixed(2)}`);
  setText("nwAssetUsd", `$${totalUsd.toFixed(2)}`);

  // record points often in live
  if (address && liveMode) recordNetWorthPoint();

  refreshConnUI();

  // keep blinking dot smooth
  if (netWorthChart) netWorthChart.draw();

  // keep event page updated
  if (isEventPageOpen()) renderEventRows();

  requestAnimationFrame(animate);
}
animate();

/* ================= PATCH.JS V2 (SAFE / NO OVERRIDES) ================= */
(function(){
  "use strict";

  // ---------- Helpers ----------
  function byId(id){ return document.getElementById(id); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function clamp(n, a, b){ n = Number(n); if (!isFinite(n)) return a; return Math.max(a, Math.min(b, n)); }
  function safeNum(x){
    var n = Number(String(x).replace(/[^\d.\-]/g, ""));
    return isFinite(n) ? n : 0;
  }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  async function fetchJSON(url){
    var r = await fetch(url, { cache:"no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }

  function getThemeIsLight(){
    // il tuo progetto usa data-theme o classi: proviamo entrambe
    return document.body && (document.body.dataset.theme === "light" || document.body.classList.contains("light"));
  }

  function toast(msg){
    try{
      var t = document.createElement("div");
      t.style.position="fixed";
      t.style.left="50%";
      t.style.bottom="18px";
      t.style.transform="translateX(-50%)";
      t.style.zIndex="10000";
      t.style.padding="10px 12px";
      t.style.borderRadius="14px";
      t.style.fontWeight="950";
      t.style.boxShadow="0 18px 70px rgba(0,0,0,.45)";
      if (getThemeIsLight()){
        t.style.background="rgba(15,23,42,.88)";
        t.style.color="rgba(249,250,251,.96)";
      } else {
        t.style.background="rgba(249,250,251,.92)";
        t.style.color="rgba(15,23,42,.96)";
      }
      t.textContent = msg || "Done";
      document.body.appendChild(t);
      setTimeout(function(){ t.style.opacity="0"; t.style.transition="opacity 220ms ease"; }, 900);
      setTimeout(function(){ try{ t.remove(); }catch(e){} }, 1200);
    }catch(e){}
  }

  async function copyText(txt){
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(txt);
        return true;
      }
    }catch(e){}
    try{
      var ta = document.createElement("textarea");
      ta.value = txt;
      ta.style.position="fixed";
      ta.style.left="-9999px";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return !!ok;
    }catch(e){}
    return false;
  }

  // Try to read current address from common places
  function getCurrentAddress(){
    // 1) global
    if (window.address && typeof window.address === "string" && window.address.startsWith("inj")) return window.address;

    // 2) addressDisplay
    var el = byId("addressDisplay");
    if (el){
      var t = (el.getAttribute("data-full") || el.textContent || "").trim();
      if (t.startsWith("inj")) return t;
    }

    // 3) any element with data-address-full
    var el2 = document.querySelector("[data-address-full]");
    if (el2){
      var t2 = (el2.getAttribute("data-address-full")||"").trim();
      if (t2.startsWith("inj")) return t2;
    }

    return "";
  }

  // Find card by title text
  function findCardByTitle(title){
    title = String(title||"").toLowerCase();
    var cards = $all(".card");
    for (var i=0;i<cards.length;i++){
      var c = cards[i];
      // common header selectors
      var h = c.querySelector(".card-title, .title, h2, h3, header, .cardHeader");
      var tx = (h ? h.textContent : c.textContent || "").toLowerCase();
      if (tx.indexOf(title) !== -1) return c;
    }
    return null;
  }

  // ---------- 1) Copy address button (with animation) ----------
  function mountCopyButton(){
    var addrEl = byId("addressDisplay");
    if (!addrEl) return;

    if (byId("addrCopyBtn")) return;

    var btn = document.createElement("button");
    btn.id = "addrCopyBtn";
    btn.type = "button";
    btn.className = "addr-copy-btn";
    btn.innerHTML = "📋 <span class='txt'>Copy</span>";
    btn.style.marginLeft="10px";

    btn.addEventListener("click", async function(ev){
      ev.preventDefault(); ev.stopPropagation();
      var a = getCurrentAddress();
      if (!a) return toast("No address");
      var ok = await copyText(a);
      if (!ok) return toast("Copy failed");

      btn.classList.remove("copied"); void btn.offsetWidth; btn.classList.add("copied");
      var txt = btn.querySelector(".txt");
      if (txt) txt.textContent = "Copied ✓";
      setTimeout(function(){ if (txt) txt.textContent = "Copy"; }, 900);
    });

    addrEl.parentElement.appendChild(btn);
  }

  // ---------- 2) Validator in Validator card ----------
  async function loadMainValidatorIntoCard(){
    var a = getCurrentAddress();
    if (!a) return;

    // find validator card or create label inside
    var card = findCardByTitle("validator") || byId("validatorCard");
    if (!card) return;

    var out = card.querySelector(".validator-name");
    if (!out){
      out = document.createElement("div");
      out.className = "validator-name";
      out.style.marginTop="8px";
      out.style.fontWeight="1000";
      out.style.letterSpacing=".02em";
      out.style.display="flex";
      out.style.alignItems="center";
      out.style.gap="10px";

      var dot = document.createElement("span");
      dot.className = "validator-dot";
      dot.style.width="10px";
      dot.style.height="10px";
      dot.style.borderRadius="999px";
      dot.style.background="rgba(250,204,21,.95)";
      dot.style.boxShadow="0 0 0 6px rgba(250,204,21,.12)";
      dot.style.animation="patchBlink 1.0s ease-in-out infinite";
      out.appendChild(dot);

      var name = document.createElement("span");
      name.className = "validator-name-text";
      name.textContent = "Loading validator…";
      out.appendChild(name);

      // add keyframes once
      if (!document.getElementById("patchBlinkKF")){
        var st = document.createElement("style");
        st.id = "patchBlinkKF";
        st.textContent = "@keyframes patchBlink{0%{opacity:.35}50%{opacity:1}100%{opacity:.35}}";
        document.head.appendChild(st);
      }

      card.appendChild(out);
    }

    var nameEl = out.querySelector(".validator-name-text");

    try{
      var lcd = "https://lcd.injective.network";
      var del = await fetchJSON(lcd + "/cosmos/staking/v1beta1/delegations/" + a);
      var arr = (del && del.delegation_responses) ? del.delegation_responses : [];
      if (!arr.length){
        if (nameEl) nameEl.textContent = "No delegations";
        return;
      }

      // biggest delegation
      var best = arr[0], bestAmt = safeNum(arr[0].balance && arr[0].balance.amount);
      for (var i=0;i<arr.length;i++){
        var amt = safeNum(arr[i].balance && arr[i].balance.amount);
        if (amt > bestAmt){ bestAmt = amt; best = arr[i]; }
      }
      var valoper = best && best.delegation ? best.delegation.validator_address : "";
      if (!valoper){
        if (nameEl) nameEl.textContent = "Validator not found";
        return;
      }

      var v = await fetchJSON(lcd + "/cosmos/staking/v1beta1/validators/" + valoper);
      var moniker = v && v.validator && v.validator.description ? v.validator.description.moniker : "";
      if (nameEl) nameEl.textContent = moniker || valoper;
    }catch(e){
      if (nameEl) nameEl.textContent = "Validator load failed";
    }
  }

  // ---------- Chart.js helpers ----------
  function hasChart(){ return !!window.Chart; }

  function getChartByCanvasId(id){
    var cv = byId(id);
    if (!cv || !hasChart()) return null;

    // Chart.js v3/v4
    if (typeof Chart.getChart === "function"){
      return Chart.getChart(cv) || null;
    }

    // fallback: try global common names
    if (id === "priceChart" && window.chart) return window.chart;
    return null;
  }

  function ensureLastDotPlugin(){
    if (!hasChart()) return;
    if (Chart.registry && Chart.registry.plugins && Chart.registry.plugins.get){
      if (Chart.registry.plugins.get("patchLastDot")) return;
    }

    // register once
    try{
      Chart.register({
        id: "patchLastDot",
        afterDatasetsDraw: function(ch){
          try{
            if (!ch || !ch.config || ch.config.type !== "line") return;
            var ds0 = ch.data && ch.data.datasets ? ch.data.datasets[0] : null;
            if (!ds0) return;

            // allow opt-out if chart.options.plugins.patchLastDotOff = true
            if (ch.options && ch.options.plugins && ch.options.plugins.patchLastDotOff) return;

            var meta = ch.getDatasetMeta(0);
            var pts = meta && meta.data ? meta.data : [];
            if (!pts.length) return;

            var p = pts[pts.length - 1];
            if (!p) return;

            var t = Date.now();
            var pulse = 0.35 + 0.65 * Math.abs(Math.sin(t / 320));

            var ctx = ch.ctx;
            ctx.save();
            ctx.shadowColor = "rgba(250,204,21," + (0.35*pulse) + ")";
            ctx.shadowBlur = 10;

            ctx.beginPath();
            ctx.arc(p.x, p.y, 6.2, 0, Math.PI*2);
            ctx.fillStyle = "rgba(250,204,21," + (0.20*pulse) + ")";
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.0, 0, Math.PI*2);
            ctx.fillStyle = "rgba(250,204,21," + (0.95*pulse) + ")";
            ctx.fill();

            ctx.restore();
          }catch(e){}
        }
      });
    }catch(e){}
  }

  function setYScale(chart, mode){
    if (!chart) return;
    mode = (mode === "log") ? "logarithmic" : "linear";

    // log needs positive values
    if (mode === "logarithmic"){
      var data = chart.data && chart.data.datasets && chart.data.datasets[0] ? chart.data.datasets[0].data : [];
      for (var i=0;i<data.length;i++){
        if (!(Number(data[i]) > 0)){
          toast("Log needs values > 0");
          mode = "linear";
          break;
        }
      }
    }

    chart.options = chart.options || {};
    chart.options.scales = chart.options.scales || {};
    chart.options.scales.y = chart.options.scales.y || {};
    chart.options.scales.y.type = mode;
    chart.update("none");
  }

  // ---------- 3) APR chart: point only when APR changes ----------
  var aprChart = null;
  var aprSeriesT = [];
  var aprSeriesV = [];
  var aprLast = null;

  function aprKey(addr){ return "inj_apr_series_patch_v1_" + (addr || "noaddr"); }

  function readAprValue(){
    var el = byId("apr") || document.querySelector("[data-apr]");
    if (!el) return 0;
    return safeNum(el.getAttribute("data-apr") || el.textContent || "");
  }

  function mountAprChart(){
    if (!hasChart()) return;

    var card = findCardByTitle("apr") || (byId("apr") ? byId("apr").closest(".card") : null);
    if (!card) return;

    if (byId("aprChartPatch")) return;

    var cv = document.createElement("canvas");
    cv.id = "aprChartPatch";
    cv.style.width="100%";
    cv.style.height="180px";
    cv.style.marginTop="10px";
    card.appendChild(cv);

    // under controls
    var controls = document.createElement("div");
    controls.className = "patch-under-controls";
    controls.innerHTML =
      "<div class='patch-pill-row'>" +
        "<button class='patch-pill active' data-apr-scale='lin' type='button'>LIN</button>" +
        "<button class='patch-pill' data-apr-scale='log' type='button'>LOG</button>" +
      "</div>" +
      "<div style='opacity:.78;font-weight:900;font-size:.78rem;'>APR history</div>";
    card.appendChild(controls);

    controls.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest("[data-apr-scale]") : null;
      if (!b) return;
      $all("[data-apr-scale]", controls).forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      var mode = b.getAttribute("data-apr-scale");
      setYScale(aprChart, mode);
      localStorage.setItem("inj_apr_scale_patch", mode);
    });

    // load series
    var addr = getCurrentAddress();
    try{
      var raw = localStorage.getItem(aprKey(addr));
      if (raw){
        var obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.t) && Array.isArray(obj.v)){
          aprSeriesT = obj.t;
          aprSeriesV = obj.v;
          if (aprSeriesV.length) aprLast = Number(aprSeriesV[aprSeriesV.length-1]) || null;
        }
      }
    }catch(e){}

    // init chart
    var ctx = cv.getContext("2d");
    aprChart = new Chart(ctx, {
      type:"line",
      data:{
        labels: aprSeriesT.map(function(ms){ return new Date(ms).toLocaleString(); }),
        datasets:[{
          data: aprSeriesV,
          tension:0.35,
          pointRadius:0,
          pointHitRadius:18,
          fill:true,
          borderColor:"#3b82f6",
          backgroundColor:"rgba(59,130,246,.12)"
        }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        animation:false,
        plugins:{ legend:{display:false}, tooltip:{enabled:false} },
        scales:{
          x:{ display:false },
          y:{ position:"right", ticks:{ callback:function(v){ return Number(v).toFixed(2)+"%"; } } }
        }
      }
    });

    // apply saved scale
    var saved = localStorage.getItem("inj_apr_scale_patch") || "lin";
    var btn = controls.querySelector("[data-apr-scale='"+saved+"']");
    if (btn){
      $all("[data-apr-scale]", controls).forEach(function(x){ x.classList.remove("active"); });
      btn.classList.add("active");
      setYScale(aprChart, saved);
    }
  }

  function recordAprIfChanged(){
    if (!aprChart) return;

    var addr = getCurrentAddress();
    if (!addr) return;

    var v = readAprValue();
    if (!v) return;

    if (aprLast == null){
      aprLast = v;
      aprSeriesT.push(Date.now());
      aprSeriesV.push(v);
    } else {
      if (Math.abs(v - aprLast) < 0.01) return;
      aprLast = v;
      aprSeriesT.push(Date.now());
      aprSeriesV.push(v);
    }

    // clamp
    if (aprSeriesT.length > 1200){
      aprSeriesT = aprSeriesT.slice(-1200);
      aprSeriesV = aprSeriesV.slice(-1200);
    }

    // save
    try{
      localStorage.setItem(aprKey(addr), JSON.stringify({ t: aprSeriesT, v: aprSeriesV }));
    }catch(e){}

    // update chart
    aprChart.data.labels = aprSeriesT.map(function(ms){ return new Date(ms).toLocaleString(); });
    aprChart.data.datasets[0].data = aprSeriesV;
    aprChart.update("none");
  }

  // ---------- 4) Price Chart timeframes + lin/log + color by performance ----------
  var PRICE_TFS = [
    { k:"5m",  label:"5min",  interval:"1m",  winMs: 5*60*1000 },
    { k:"15m", label:"15min", interval:"1m",  winMs: 15*60*1000 },
    { k:"1h",  label:"1h",    interval:"1m",  winMs: 60*60*1000 },
    { k:"6h",  label:"6h",    interval:"5m",  winMs: 6*60*60*1000 },
    { k:"12h", label:"12h",   interval:"5m",  winMs: 12*60*60*1000 },
    { k:"1d",  label:"1D",    interval:"15m", winMs: 24*60*60*1000 },
    { k:"7d",  label:"7D",    interval:"1h",  winMs: 7*24*60*60*1000 },
    { k:"1w",  label:"1W",    interval:"1h",  winMs: 7*24*60*60*1000 },
    { k:"1m",  label:"1M",    interval:"4h",  winMs: 30*24*60*60*1000 },
    { k:"1y",  label:"1Y",    interval:"1d",  winMs: 365*24*60*60*1000 },
    { k:"all", label:"ALL",   interval:"1d",  winMs: null }
  ];

  async function fetchKlines(interval, startTime, endTime, maxPoints){
    var out = [];
    var cursor = startTime;
    var end = endTime || Date.now();
    var cap = maxPoints || 2000;

    while (cursor < end && out.length < cap){
      var url = "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval="+interval+"&limit=1000&startTime="+cursor+"&endTime="+end;
      var d = await fetchJSON(url);
      if (!Array.isArray(d) || !d.length) break;
      out = out.concat(d);
      var lastOpen = Number(d[d.length-1][0]) || 0;
      if (!lastOpen) break;
      cursor = lastOpen + 1;
      if (d.length < 1000) break;
      await sleep(80);
    }
    return out.slice(0, cap);
  }

  function setPriceColors(chart, first, last){
    if (!chart) return;
    var ds = chart.data.datasets[0];
    if (!ds) return;

    var up = last > first;
    var down = last < first;

    if (up){
      ds.borderColor = "#22c55e";
      ds.backgroundColor = "rgba(34,197,94,.16)";
    } else if (down){
      ds.borderColor = "#ef4444";
      ds.backgroundColor = "rgba(239,68,68,.14)";
    } else {
      ds.borderColor = "#3b82f6";
      ds.backgroundColor = "rgba(59,130,246,.12)";
    }
  }

  function mountPriceControls(){
    var cv = byId("priceChart");
    if (!cv) return;

    var card = cv.closest(".card") || findCardByTitle("price");
    if (!card) return;

    if (card.querySelector(".patch-price-controls")) return;

    var controls = document.createElement("div");
    controls.className = "patch-under-controls patch-price-controls";

    var left = document.createElement("div");
    left.className = "patch-pill-row";
    left.innerHTML = PRICE_TFS.map(function(x){
      return "<button class='patch-pill' type='button' data-price-tf='"+x.k+"'>"+x.label+"</button>";
    }).join("");

    var right = document.createElement("div");
    right.className = "patch-pill-row";
    right.innerHTML =
      "<button class='patch-pill active' type='button' data-price-scale='lin'>LIN</button>" +
      "<button class='patch-pill' type='button' data-price-scale='log'>LOG</button>";

    controls.appendChild(left);
    controls.appendChild(right);
    card.appendChild(controls);

    // restore saved
    var savedTf = localStorage.getItem("inj_price_tf_patch") || "1d";
    $all("[data-price-tf]", left).forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-price-tf") === savedTf);
    });

    var savedScale = localStorage.getItem("inj_price_scale_patch") || "lin";
    $all("[data-price-scale]", right).forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-price-scale") === savedScale);
    });

    // handlers
    left.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest("[data-price-tf]") : null;
      if (!b) return;
      var tf = b.getAttribute("data-price-tf");
      localStorage.setItem("inj_price_tf_patch", tf);
      $all("[data-price-tf]", left).forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      loadPriceTF(tf);
    });

    right.addEventListener("click", function(e){
      var b = e.target && e.target.closest ? e.target.closest("[data-price-scale]") : null;
      if (!b) return;
      var sc = b.getAttribute("data-price-scale");
      localStorage.setItem("inj_price_scale_patch", sc);
      $all("[data-price-scale]", right).forEach(function(x){ x.classList.remove("active"); });
      b.classList.add("active");
      var ch = getChartByCanvasId("priceChart");
      if (ch) setYScale(ch, sc);
    });
  }

  async function loadPriceTF(tfKey){
    if (!hasChart()) return;

    var def = null;
    for (var i=0;i<PRICE_TFS.length;i++){
      if (PRICE_TFS[i].k === tfKey){ def = PRICE_TFS[i]; break; }
    }
    if (!def) def = PRICE_TFS[5]; // 1D

    var end = Date.now();
    var start = def.winMs ? (end - def.winMs) : (end - 3650*24*60*60*1000);
    var cap = (def.k === "all") ? 2500 : 1400;

    var kl = [];
    try{
      kl = await fetchKlines(def.interval, start, end, cap);
    }catch(e){
      toast("Price load failed");
      return;
    }
    if (!kl.length) return;

    var labels = [];
    var data = [];
    for (var j=0;j<kl.length;j++){
      var openTime = Number(kl[j][0]) || 0;
      var close = Number(kl[j][4]) || 0;
      labels.push(new Date(openTime).toLocaleString());
      data.push(close);
    }

    var ch = getChartByCanvasId("priceChart");
    if (!ch){
      // create only if your app didn't create it
      var cv = byId("priceChart");
      if (!cv) return;
      ch = new Chart(cv.getContext("2d"), {
        type:"line",
        data:{ labels: labels, datasets:[{ data:data, tension:0.35, pointRadius:0, fill:true }] },
        options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}} }
      });
    } else {
      ch.data.labels = labels;
      if (ch.data.datasets && ch.data.datasets[0]) ch.data.datasets[0].data = data;
    }

    // color by sign
    var first = data[0], last = data[data.length-1];
    setPriceColors(ch, first, last);

    // apply scale saved
    var sc = localStorage.getItem("inj_price_scale_patch") || "lin";
    setYScale(ch, sc);

    ch.update("none");
  }

  // ---------- 5) Gear for stake/reward bars + estimates ----------
  function openTargetPopover(title, cur, onApply){
    var pop = document.createElement("div");
    pop.className = "patch-pop";
    pop.innerHTML =
      "<div class='patch-pop-card'>" +
        "<div class='patch-pop-title'>"+title+"</div>" +
        "<div class='patch-pop-row'><input id='patchTargetInput' inputmode='decimal' value='"+String(cur||"")+"' placeholder='Enter max value'></div>" +
        "<div class='patch-pop-actions'>" +
          "<button type='button' id='patchCancel'>Cancel</button>" +
          "<button type='button' id='patchApply'>Apply</button>" +
        "</div>" +
        "<div style='margin-top:10px;opacity:.75;font-weight:850;font-size:.8rem;'>Saved per wallet address.</div>" +
      "</div>";

    document.body.appendChild(pop);
    pop.addEventListener("click", function(e){ if (e.target === pop) pop.remove(); });

    var input = pop.querySelector("#patchTargetInput");
    setTimeout(function(){ try{ input.focus(); }catch(e){} }, 20);

    pop.querySelector("#patchCancel").addEventListener("click", function(){ pop.remove(); });
    pop.querySelector("#patchApply").addEventListener("click", function(){
      var v = safeNum(input.value);
      if (!(v > 0)) return toast("Invalid value");
      onApply(v);
      pop.remove();
    });
  }

  function ensureGearButtons(){
    // These ids are common in your app; if not present, it will simply skip.
    var stakeBar = byId("stakeBar");
    var rewardBar = byId("rewardBar");

    if (stakeBar && !byId("stakeGearBtn")){
      var host = stakeBar.parentElement;
      if (host){
        var btn = document.createElement("button");
        btn.id = "stakeGearBtn";
        btn.type = "button";
        btn.className = "patch-gear";
        btn.textContent = "⚙️";
        btn.style.marginLeft="10px";
        btn.addEventListener("click", function(){
          var addr = getCurrentAddress();
          var key = "inj_stake_target_patch_" + (addr||"noaddr");
          var cur = safeNum(localStorage.getItem(key)) || 1000;
          openTargetPopover("Stake bar max", cur, function(val){
            localStorage.setItem(key, String(val));
            toast("Stake target saved");
          });
        });
        host.appendChild(btn);
      }
    }

    if (rewardBar && !byId("rewardGearBtn")){
      var host2 = rewardBar.parentElement;
      if (host2){
        var btn2 = document.createElement("button");
        btn2.id = "rewardGearBtn";
        btn2.type = "button";
        btn2.className = "patch-gear";
        btn2.textContent = "⚙️";
        btn2.style.marginLeft="10px";
        btn2.addEventListener("click", function(){
          var addr = getCurrentAddress();
          var key = "inj_reward_target_patch_" + (addr||"noaddr");
          var cur = safeNum(localStorage.getItem(key)) || 10;
          openTargetPopover("Reward bar max", cur, function(val){
            localStorage.setItem(key, String(val));
            toast("Reward target saved");
          });
        });
        host2.appendChild(btn2);
      }
    }
  }

  function readStakeValueFallback(){
    // try common ids / text blocks
    var candidates = ["stakeInj","staked","stakedValue","stakeValue","totalStaked"];
    for (var i=0;i<candidates.length;i++){
      var el = byId(candidates[i]);
      if (el){
        var v = safeNum(el.textContent);
        if (v > 0) return v;
      }
    }
    // try global
    if (window.displayed && window.displayed.stake) return Number(window.displayed.stake) || 0;
    return 0;
  }

  function readRewardValueFallback(){
    var candidates = ["rewards","rewardValue","rewardInj","availableRewards"];
    for (var i=0;i<candidates.length;i++){
      var el = byId(candidates[i]);
      if (el){
        var v = safeNum(el.textContent);
        if (v > 0) return v;
      }
    }
    if (window.displayed && window.displayed.rewards) return Number(window.displayed.rewards) || 0;
    return 0;
  }

  function applyBarTargets(){
    var addr = getCurrentAddress();
    if (!addr) return;

    // stake
    var stakeBar = byId("stakeBar");
    var stakeLine = byId("stakeLine");
    if (stakeBar){
      var maxK = "inj_stake_target_patch_" + addr;
      var max = safeNum(localStorage.getItem(maxK)) || 1000;
      var val = readStakeValueFallback();
      var pct = max > 0 ? clamp((val/max)*100, 0, 100) : 0;
      stakeBar.style.width = pct.toFixed(2) + "%";
      if (stakeLine) stakeLine.style.left = pct.toFixed(2) + "%";
      var pEl = byId("stakePercent"); if (pEl) pEl.textContent = pct.toFixed(1) + "%";
      var mEl = byId("stakeMax"); if (mEl) mEl.textContent = String(max);
    }

    // reward
    var rewardBar = byId("rewardBar");
    var rewardLine = byId("rewardLine");
    if (rewardBar){
      var maxK2 = "inj_reward_target_patch_" + addr;
      var max2 = safeNum(localStorage.getItem(maxK2)) || 10;
      var val2 = readRewardValueFallback();
      var pct2 = max2 > 0 ? clamp((val2/max2)*100, 0, 100) : 0;
      rewardBar.style.width = pct2.toFixed(2) + "%";
      if (rewardLine) rewardLine.style.left = pct2.toFixed(2) + "%";
      var pEl2 = byId("rewardPercent"); if (pEl2) pEl2.textContent = pct2.toFixed(1) + "%";
      var mEl2 = byId("rewardMax"); if (mEl2) mEl2.textContent = String(max2);
    }
  }

  function mountRewardEstimates(){
    var rewardCard = findCardByTitle("reward");
    if (!rewardCard) return;
    if (byId("rewardEstimatesPatch")) return;

    var wrap = document.createElement("div");
    wrap.id = "rewardEstimatesPatch";
    wrap.className = "patch-under-controls";
    wrap.innerHTML =
      "<div class='patch-pill-row' style='gap:10px;flex:1;'>" +
        "<div style='min-width:140px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);border-radius:16px;padding:10px 12px;'>" +
          "<div style='font-weight:950;opacity:.78;font-size:.78rem;'>1H est.</div><div id='re1h' style='margin-top:4px;font-weight:1000;'>—</div>" +
        "</div>" +
        "<div style='min-width:140px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);border-radius:16px;padding:10px 12px;'>" +
          "<div style='font-weight:950;opacity:.78;font-size:.78rem;'>1D est.</div><div id='re1d' style='margin-top:4px;font-weight:1000;'>—</div>" +
        "</div>" +
        "<div style='min-width:140px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);border-radius:16px;padding:10px 12px;'>" +
          "<div style='font-weight:950;opacity:.78;font-size:.78rem;'>1W est.</div><div id='re1w' style='margin-top:4px;font-weight:1000;'>—</div>" +
        "</div>" +
        "<div style='min-width:140px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);border-radius:16px;padding:10px 12px;'>" +
          "<div style='font-weight:950;opacity:.78;font-size:.78rem;'>1M est.</div><div id='re1m' style='margin-top:4px;font-weight:1000;'>—</div>" +
        "</div>" +
        "<div style='min-width:140px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);border-radius:16px;padding:10px 12px;'>" +
          "<div style='font-weight:950;opacity:.78;font-size:.78rem;'>1Y est.</div><div id='re1y' style='margin-top:4px;font-weight:1000;'>—</div>" +
        "</div>" +
      "</div>";

    rewardCard.appendChild(wrap);
  }

  function updateRewardEstimates(){
    var stake = readStakeValueFallback();
    var apr = readAprValue();
    if (!(stake > 0) || !(apr > 0)) return;

    var year = stake * (apr/100);
    var oneH = year / (365*24);
    var oneD = year / 365;
    var oneW = year / 52;
    var oneM = year / 12;

    function put(id, v){
      var el = byId(id);
      if (el) el.textContent = Number(v).toFixed(6) + " INJ";
    }

    put("re1h", oneH);
    put("re1d", oneD);
    put("re1w", oneW);
    put("re1m", oneM);
    put("re1y", year);
  }

  // ---------- 6) Events filtering (basic: by keyword + type buttons if exist) ----------
  function mountEventFilter(){
    var eventPage = byId("eventsPage") || findCardByTitle("event");
    if (!eventPage) return;

    if (byId("eventFilterPatch")) return;

    var host = eventPage.querySelector(".event-toolbar") || eventPage;
    var box = document.createElement("div");
    box.id = "eventFilterPatch";
    box.style.marginTop="10px";
    box.style.display="flex";
    box.style.gap="10px";
    box.style.flexWrap="wrap";
    box.innerHTML =
      "<input id='eventSearchPatch' placeholder='Filter events…' " +
      "style='flex:1;min-width:220px;height:40px;border-radius:14px;padding:0 12px;font-weight:900;" +
      "border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;outline:none;'/>" +
      "<button id='eventClearPatch' type='button' class='patch-pill'>Clear</button>";

    host.appendChild(box);

    function apply(){
      var q = (byId("eventSearchPatch").value || "").trim().toLowerCase();
      // try common row containers
      var rows = $all(".event-row, #eventsTable tr, .events-table tr, .eventItem");
      if (!rows.length) return;

      rows.forEach(function(r){
        var t = (r.textContent || "").toLowerCase();
        var ok = !q || t.indexOf(q) !== -1;
        r.style.display = ok ? "" : "none";
      });
    }

    byId("eventSearchPatch").addEventListener("input", apply);
    byId("eventClearPatch").addEventListener("click", function(){
      byId("eventSearchPatch").value = "";
      apply();
    });
  }

  // ---------- 7) Card expand button (fullscreen) ----------
  function mountExpandButtons(){
    // try common selectors
    var btns = []
      .concat($all("[data-action='expand']"))
      .concat($all(".expand-btn"))
      .concat($all(".card-expand"))
      .concat($all("[aria-label='Expand']"))
      .concat($all("[aria-label='Fullscreen']"));

    // de-dup
    var seen = new Set();
    btns = btns.filter(function(b){
      if (!b) return false;
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });

    btns.forEach(function(btn){
      if (btn.__patchBound) return;
      btn.__patchBound = true;

      btn.addEventListener("click", function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var card = btn.closest(".card");
        if (!card) return;
        var on = card.classList.toggle("is-fullscreen");
        document.body.classList.toggle("patch-lock", on);
      });
    });

    // close on ESC
    if (!window.__patchEscBound){
      window.__patchEscBound = true;
      window.addEventListener("keydown", function(e){
        if (e.key === "Escape"){
          var open = document.querySelector(".card.is-fullscreen");
          if (open){
            open.classList.remove("is-fullscreen");
            document.body.classList.remove("patch-lock");
          }
        }
      });
    }
  }

  // ---------- Boot ----------
  async function boot(){
    try{
      ensureLastDotPlugin();
      mountCopyButton();
      mountPriceControls();
      mountAprChart();
      ensureGearButtons();
      mountRewardEstimates();
      mountEventFilter();
      mountExpandButtons();

      // initial loads (non-blocking)
      try{
        await loadMainValidatorIntoCard();
      }catch(e){}

      // load saved price tf
      var tf = localStorage.getItem("inj_price_tf_patch") || "1d";
      loadPriceTF(tf);

      // keep updating APR + bars + estimates (safe polling)
      setInterval(function(){
        try{ recordAprIfChanged(); }catch(e){}
        try{ applyBarTargets(); }catch(e){}
        try{ updateRewardEstimates(); }catch(e){}
      }, 2500);

    }catch(e){}
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
