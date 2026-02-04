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

/* =======================================================================
   INJ PORTFOLIO PATCH v2.1.0
   Incolla in fondo a app.js (dopo animate();)
   ======================================================================= */
(() => {
  "use strict";

  const PATCH_FLAG = "__INJ_PATCH_V210__";
  if (window[PATCH_FLAG]) return;
  window[PATCH_FLAG] = true;

  const PATCH_VER = "2.1.0";
  const $id = (id) => document.getElementById(id);

  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
  const safe = (n) => (Number.isFinite(+n) ? +n : 0);

  const onReady = (fn) => {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  };

  function getAddr() {
    try {
      const a = (typeof address === "string" ? address : localStorage.getItem("inj_address") || "").trim();
      return a;
    } catch {
      return "";
    }
  }

  function keyFor(suffix) {
    const a = getAddr();
    return a ? `inj_patch_${suffix}_${a}` : `inj_patch_${suffix}`;
  }

  function loadJSON(k, fallback) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  function fmtCompactUsd(v) {
    v = safe(v);
    const av = Math.abs(v);
    if (av >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (av >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (av >= 1e3) return `$${(v / 1e3).toFixed(2)}k`;
    return `$${v.toFixed(2)}`;
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

  function themeIsLight() {
    return document.body?.dataset?.theme === "light";
  }

  function makeMiniBtn(text, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title || "";
    b.className = "patch-mini-btn";
    b.style.cssText = `
      height:30px; padding:0 10px; border-radius:12px;
      border:1px solid ${themeIsLight() ? "rgba(15,23,42,.14)" : "rgba(255,255,255,.14)"};
      background:${themeIsLight() ? "rgba(15,23,42,.06)" : "rgba(255,255,255,.06)"};
      color:${themeIsLight() ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)"};
      font-weight:900; letter-spacing:.02em; cursor:pointer;
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      user-select:none;
    `;
    return b;
  }

  function makeIconBtn(icon, title) {
    const b = makeMiniBtn(icon, title);
    b.style.width = "34px";
    b.style.padding = "0";
    b.style.display = "grid";
    b.style.placeItems = "center";
    return b;
  }

  function ensureCardRelative(card) {
    if (!card) return;
    const cs = getComputedStyle(card);
    if (cs.position === "static") card.style.position = "relative";
  }

  function findCardByChildId(childId) {
    const el = $id(childId);
    if (!el) return null;
    return el.closest(".card") || el.closest("[data-card]") || el.parentElement;
  }

  /* ===================== SCALE: linear/log ===================== */
  function computePositiveMin(data) {
    let m = Infinity;
    for (const x of data || []) {
      const v = safe(x);
      if (v > 0 && v < m) m = v;
    }
    return Number.isFinite(m) ? m : 1;
  }

  function applyTightRightAxis(chart, axisKey, kind) {
    try {
      if (!chart?.options?.scales?.[axisKey]) return;
      const ax = chart.options.scales[axisKey];

      ax.position = "right";
      ax.ticks = ax.ticks || {};
      ax.grid = ax.grid || {};

      ax.ticks.mirror = true;
      ax.ticks.padding = 4;
      ax.ticks.maxTicksLimit = 4;
      ax.ticks.color = (typeof axisTickColor === "function") ? axisTickColor() : (themeIsLight() ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)");
      ax.grid.color = (typeof axisGridColor === "function") ? axisGridColor() : (themeIsLight() ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)");
      ax.border = ax.border || {};
      ax.border.display = false;

      // shorten labels
      if (kind === "usd") ax.ticks.callback = (v) => fmtCompactUsd(v);
      else ax.ticks.callback = (v) => fmtSmart(v);

      chart.options.layout = chart.options.layout || {};
      chart.options.layout.padding = chart.options.layout.padding || {};
      chart.options.layout.padding.right = Math.min(18, safe(chart.options.layout.padding.right || 18));

      chart.update("none");
    } catch {}
  }

  function setYAxisScale(chart, axisKey, type /* linear|logarithmic */) {
    try {
      if (!chart?.options?.scales?.[axisKey]) return;
      const ax = chart.options.scales[axisKey];
      ax.type = type;

      // for log axis, force positive suggestedMin
      if (type === "logarithmic") {
        const ds = chart.data?.datasets?.[0]?.data || [];
        const minPos = computePositiveMin(ds);
        ax.suggestedMin = Math.max(minPos * 0.95, minPos / 1.8, 1e-8);
      } else {
        ax.suggestedMin = undefined;
      }
      chart.update("none");
    } catch {}
  }

  function getScaleState(name) {
    const st = loadJSON(keyFor(`scale_${name}`), { y: "linear" });
    const y = (st?.y === "logarithmic") ? "logarithmic" : "linear";
    return { y };
  }

  function setScaleState(name, yType) {
    saveJSON(keyFor(`scale_${name}`), { y: yType });
  }

  function ensureScaleToggleOnCard(card, name, getChart, axisKey = "y") {
    if (!card) return;

    ensureCardRelative(card);
    if (card.querySelector(`.patch-scale-toggle[data-name="${name}"]`)) return;

    const btn = makeMiniBtn("LIN", "Switch Y scale: Linear / Log");
    btn.classList.add("patch-scale-toggle");
    btn.dataset.name = name;

    // place top-right with small offset (avoid collisions)
    btn.style.position = "absolute";
    btn.style.top = "12px";
    btn.style.right = "12px";
    btn.style.zIndex = "5";

    function syncLabel() {
      const st = getScaleState(name);
      btn.textContent = (st.y === "logarithmic") ? "LOG" : "LIN";
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ch = getChart();
      if (!ch) return;

      const cur = getScaleState(name).y;
      const next = (cur === "linear") ? "logarithmic" : "linear";
      setScaleState(name, next);

      // apply
      applyTightRightAxis(ch, axisKey, name.includes("nw") || name.includes("price") || name.includes("apr") ? "usd" : "num");
      setYAxisScale(ch, axisKey, next);

      // also force autoscale once
      autoscaleYToVisible(ch, axisKey);
      syncLabel();
    });

    card.appendChild(btn);
    syncLabel();
  }

  /* ===================== AUTOSCALE Y to visible slice ===================== */
  function autoscaleYToVisible(chart, axisKey = "y") {
    try {
      if (!chart?.data?.datasets?.[0]) return;

      const data = chart.data.datasets[0].data || [];
      if (!data.length) return;

      // Determine visible indices on category scale (same logic as reward timeline usage)
      let minIdx = 0;
      let maxIdx = data.length - 1;

      // prefer options range if present (category scale min/max are indices)
      const xOpt = chart.options?.scales?.x;
      if (xOpt && Number.isFinite(+xOpt.min)) minIdx = clamp(Math.floor(+xOpt.min), 0, data.length - 1);
      if (xOpt && Number.isFinite(+xOpt.max)) maxIdx = clamp(Math.ceil(+xOpt.max), 0, data.length - 1);

      if (maxIdx < minIdx) [minIdx, maxIdx] = [maxIdx, minIdx];

      const slice = data.slice(minIdx, maxIdx + 1).map(safe).filter((v) => Number.isFinite(v));
      if (!slice.length) return;

      let mn = Math.min(...slice);
      let mx = Math.max(...slice);

      // padding
      const span = Math.max(1e-12, mx - mn);
      mn = mn - span * 0.08;
      mx = mx + span * 0.12;

      const ax = chart.options?.scales?.[axisKey];
      if (!ax) return;

      if (ax.type === "logarithmic") {
        // keep >0
        const minPos = computePositiveMin(slice);
        ax.suggestedMin = Math.max(minPos * 0.92, minPos / 2, 1e-8);
        ax.suggestedMax = Math.max(mx, minPos * 3);
      } else {
        ax.suggestedMin = mn;
        ax.suggestedMax = mx;
      }

      chart.update("none");
    } catch {}
  }

  /* ===================== COPY ADDRESS (📋) ===================== */
  function ensureCopyAddressBtn() {
    const host = $id("addressDisplay");
    if (!host) return;
    if (host.querySelector(".patch-copy-addr")) return;

    const btn = makeIconBtn("📋", "Copy full address");
    btn.classList.add("patch-copy-addr");
    btn.style.marginLeft = "10px";
    btn.style.height = "28px";
    btn.style.width = "34px";
    btn.style.borderRadius = "12px";

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const a = getAddr();
      if (!a) return;

      try {
        await navigator.clipboard.writeText(a);
        if (typeof showToastEvent === "function") {
          showToastEvent({ title: "Copied", t: Date.now(), value: a, status: "ok" });
        }
      } catch {
        // fallback
        try {
          const ta = document.createElement("textarea");
          ta.value = a;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          if (typeof showToastEvent === "function") {
            showToastEvent({ title: "Copied", t: Date.now(), value: a, status: "ok" });
          }
        } catch {}
      }
    });

    // try place next to tag, otherwise append
    const tag = host.querySelector(".tag") || host.firstElementChild;
    if (tag && tag.parentElement) {
      tag.insertAdjacentElement("afterend", btn);
    } else {
      host.appendChild(btn);
    }
  }

  /* ===================== MENU labels near icons ===================== */
  function ensureMenuLabels() {
    const themeBtn = $id("themeToggle");
    if (themeBtn && !themeBtn.querySelector(".patch-label")) {
      const s = document.createElement("span");
      s.className = "patch-label";
      s.textContent = "Theme";
      s.style.cssText = "margin-left:10px;font-weight:900;opacity:.82;font-size:.82rem;";
      themeBtn.appendChild(s);
    }

    const modeBtn = $id("liveToggle");
    if (modeBtn && !modeBtn.querySelector(".patch-label")) {
      const s = document.createElement("span");
      s.className = "patch-label";
      s.textContent = "Mode";
      s.style.cssText = "margin-left:10px;font-weight:900;opacity:.82;font-size:.82rem;";
      modeBtn.appendChild(s);
    }
  }

  /* ===================== TARGET gear (Stake/Reward) ===================== */
  function ensureModalCSS() {
    if (document.getElementById("patchModalCSS")) return;
    const st = document.createElement("style");
    st.id = "patchModalCSS";
    st.textContent = `
      .patch-modal-backdrop{position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
      .patch-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000;width:min(520px,92vw);
        border-radius:18px;border:1px solid rgba(255,255,255,.14);background:rgba(11,18,32,.92);color:rgba(249,250,251,.92);
        box-shadow:0 30px 110px rgba(0,0,0,.55);padding:14px;}
      body[data-theme="light"] .patch-modal{background:rgba(240,242,246,.96);color:rgba(15,23,42,.92);border-color:rgba(15,23,42,.14);}
      .patch-modal h3{margin:0 0 6px 0;font-size:1.02rem;letter-spacing:.02em;}
      .patch-modal p{margin:0 0 12px 0;opacity:.75;font-weight:800;font-size:.86rem;}
      .patch-modal .row{display:flex;gap:10px;align-items:center;}
      .patch-modal input{flex:1;height:40px;border-radius:14px;padding:0 12px;font-weight:900;outline:none;
        border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;}
      body[data-theme="light"] .patch-modal input{border-color:rgba(15,23,42,.14);background:rgba(15,23,42,.06);}
    `;
    document.head.appendChild(st);
  }

  function openTargetModal(kind /* stake|reward */) {
    ensureModalCSS();

    const a = getAddr();
    if (!a) return;

    const key = keyFor(kind === "stake" ? "stake_target" : "reward_target");
    const cur = safe(loadJSON(key, null));

    const back = document.createElement("div");
    back.className = "patch-modal-backdrop";

    const box = document.createElement("div");
    box.className = "patch-modal";
    box.innerHTML = `
      <h3>${kind === "stake" ? "Stake target" : "Reward range"}</h3>
      <p>Imposta un valore massimo (da 0 a MAX). Viene salvato per questo wallet e non si resetta.</p>
      <div class="row">
        <input id="patchTargetInput" inputmode="decimal" placeholder="Es: 1200" value="${cur ? String(cur) : ""}"/>
        <button id="patchApplyBtn" type="button" style="height:40px;border-radius:14px;padding:0 14px;font-weight:950;cursor:pointer;
          border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;">Apply</button>
        <button id="patchCancelBtn" type="button" style="height:40px;border-radius:14px;padding:0 14px;font-weight:950;cursor:pointer;
          border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;">Cancel</button>
      </div>
      <div style="margin-top:10px;display:flex;justify-content:space-between;gap:10px;opacity:.8;font-weight:850;font-size:.82rem;">
        <span>Tip: lascia vuoto per tornare su Auto</span>
        <button id="patchClearBtn" type="button" style="height:32px;border-radius:12px;padding:0 12px;font-weight:950;cursor:pointer;
          border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;">Clear</button>
      </div>
    `;

    function close() { try { back.remove(); box.remove(); } catch {} }

    back.addEventListener("click", close, { passive: true });
    box.querySelector("#patchCancelBtn")?.addEventListener("click", close, { passive: true });

    box.querySelector("#patchClearBtn")?.addEventListener("click", () => {
      try { localStorage.removeItem(key); } catch {}
      if (typeof showToastEvent === "function") showToastEvent({ title: "Saved", t: Date.now(), value: "Auto mode", status: "ok" });
      close();
    }, { passive: true });

    box.querySelector("#patchApplyBtn")?.addEventListener("click", () => {
      const v = box.querySelector("#patchTargetInput")?.value;
      const num = safe(v);
      if (!v || !Number.isFinite(num) || num <= 0) {
        try { localStorage.removeItem(key); } catch {}
        if (typeof showToastEvent === "function") showToastEvent({ title: "Saved", t: Date.now(), value: "Auto mode", status: "ok" });
        close();
        return;
      }
      saveJSON(key, num);
      if (typeof showToastEvent === "function") showToastEvent({ title: "Saved", t: Date.now(), value: `Max = ${num}`, status: "ok" });
      close();
    }, { passive: true });

    document.body.appendChild(back);
    document.body.appendChild(box);

    setTimeout(() => box.querySelector("#patchTargetInput")?.focus(), 30);
  }

  function ensureGearNearBar(barId, kind) {
    const bar = $id(barId);
    if (!bar) return;
    const host = bar.parentElement;
    if (!host) return;
    if (host.querySelector(`.patch-gear[data-kind="${kind}"]`)) return;

    const gear = makeIconBtn("⚙️", kind === "stake" ? "Set stake target" : "Set reward range");
    gear.classList.add("patch-gear");
    gear.dataset.kind = kind;
    gear.style.position = "absolute";
    gear.style.right = "8px";
    gear.style.top = "50%";
    gear.style.transform = "translateY(-50%)";
    gear.style.zIndex = "3";

    const hs = getComputedStyle(host);
    if (hs.position === "static") host.style.position = "relative";
    host.appendChild(gear);

    gear.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTargetModal(kind);
    }, { passive: false });
  }

  /* ===================== Reward estimates row ===================== */
  function ensureRewardEstimateRow() {
    const card = findCardByChildId("rewardBar") || findCardByChildId("rewards");
    if (!card) return;
    if (card.querySelector("#patchRewardEstRow")) return;

    const row = document.createElement("div");
    row.id = "patchRewardEstRow";
    row.style.cssText = `
      margin-top:10px; display:flex; flex-wrap:wrap; gap:10px;
      font-weight:900; opacity:.86; font-size:.86rem;
    `;
    row.innerHTML = `
      <span id="patchEstDay">Day: —</span>
      <span id="patchEstWeek">Week: —</span>
      <span id="patchEstMonth">Month: —</span>
    `;

    // insert under reward bar if possible
    const rb = $id("rewardBar");
    const anchor = rb?.closest(".bar-wrap") || rb?.parentElement || card;
    anchor.insertAdjacentElement("afterend", row);
  }

  function updateRewardEstimates() {
    const a = getAddr();
    if (!a) return;

    const estDay = $id("patchEstDay");
    const estWeek = $id("patchEstWeek");
    const estMonth = $id("patchEstMonth");
    if (!estDay || !estWeek || !estMonth) return;

    // Use staked * APR (simple estimate)
    const st = safe(typeof stakeInj !== "undefined" ? stakeInj : 0);
    const A = safe(typeof apr !== "undefined" ? apr : 0) / 100;
    const day = st * A / 365;
    const week = day * 7;
    const month = day * 30;

    estDay.textContent = `Day: ${day.toFixed(4)} INJ`;
    estWeek.textContent = `Week: ${week.toFixed(4)} INJ`;
    estMonth.textContent = `Month: ${month.toFixed(4)} INJ`;
  }

  /* ===================== Override bars to use user targets ===================== */
  function getUserTarget(kind) {
    const key = keyFor(kind === "stake" ? "stake_target" : "reward_target");
    const v = loadJSON(key, null);
    const n = safe(v);
    return (Number.isFinite(n) && n > 0) ? n : null;
  }

  function patchBarsLoop() {
    try {
      const a = getAddr();
      if (a) {
        // Stake override
        const stakeTarget = getUserTarget("stake");
        if (stakeTarget) {
          const st = safe(typeof displayed !== "undefined" ? displayed.stake : (typeof stakeInj !== "undefined" ? stakeInj : 0));
          const pct = clamp((st / stakeTarget) * 100, 0, 100);

          const stakeBar = $id("stakeBar");
          const stakeLine = $id("stakeLine");
          if (stakeBar) stakeBar.style.width = pct + "%";
          if (stakeLine) stakeLine.style.left = pct + "%";

          const sp = $id("stakePercent");
          const smx = $id("stakeMax");
          if (sp) sp.textContent = pct.toFixed(1) + "%";
          if (smx) smx.textContent = String(stakeTarget);
        }

        // Reward override
        const rewardTarget = getUserTarget("reward");
        if (rewardTarget) {
          const rw = safe(typeof displayed !== "undefined" ? displayed.rewards : (typeof rewardsInj !== "undefined" ? rewardsInj : 0));
          const pct = clamp((rw / rewardTarget) * 100, 0, 100);

          const rewardBar = $id("rewardBar");
          const rewardLine = $id("rewardLine");
          if (rewardBar) rewardBar.style.width = pct + "%";
          if (rewardLine) rewardLine.style.left = pct + "%";

          const rp = $id("rewardPercent");
          const rmx = $id("rewardMax");
          if (rp) rp.textContent = pct.toFixed(1) + "%";
          if (rmx) rmx.textContent = rewardTarget.toFixed(4).replace(/0+$/,"").replace(/\.$/,"");
        }

        updateRewardEstimates();
      }
    } catch {}
    requestAnimationFrame(patchBarsLoop);
  }

  /* ===================== Reward filter options (All / <0.05 / >=0.05 / >=0.1) ===================== */
  function ensureRewardFilterOptions() {
    const sel = $id("rewardFilter");
    if (!sel) return;

    const hasPatch = Array.from(sel.options || []).some(o => o.value === "lt005");
    if (hasPatch) return;

    // Replace options safely (keep existing as fallback)
    sel.innerHTML = "";
    const opts = [
      ["all", "All"],
      ["lt005", "< 0.05"],
      ["ge005", "≥ 0.05"],
      ["ge01",  "≥ 0.1"]
    ];
    for (const [v, t] of opts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    }

    // restore previous selection if possible
    const prev = loadJSON(keyFor("reward_filter"), "all");
    sel.value = prev && opts.some(x => x[0] === prev) ? prev : "all";
  }

  function getRewardFilterMode() {
    const sel = $id("rewardFilter");
    const v = (sel?.value || "all").trim();
    if (["all","lt005","ge005","ge01"].includes(v)) return v;
    return "all";
  }

  /* ===================== Patch rebuildWdView + syncRewardTimelineUI (autoscale Y visible) ===================== */
  function patchRewardFunctions() {
    try {
      if (typeof rebuildWdView === "function" && !rebuildWdView.__patched) {
        const orig = rebuildWdView;
        const patched = function() {
          // rebuild using current filter mode on wdValuesAll for this address
          try {
            const mode = getRewardFilterMode();

            // keep global arrays used by the app
            wdLabels = [];
            wdValues = [];
            wdTimes = [];

            for (let i = 0; i < (wdValuesAll?.length || 0); i++) {
              const v = safe(wdValuesAll[i]);
              const ok =
                mode === "all" ? true :
                mode === "lt005" ? (v > 0 && v < 0.05) :
                mode === "ge005" ? (v >= 0.05) :
                mode === "ge01" ? (v >= 0.1) :
                true;

              if (ok) {
                wdLabels.push(wdLabelsAll?.[i] || "");
                wdValues.push(v);
                wdTimes.push(wdTimesAll?.[i] || 0);
              }
            }

            if (typeof drawRewardWdChart === "function") drawRewardWdChart();
            if (typeof syncRewardTimelineUI === "function") syncRewardTimelineUI(true);
          } catch {
            // fallback to original if anything strange happens
            orig();
          }
        };
        patched.__patched = true;
        rebuildWdView = patched;
      }

      if (typeof syncRewardTimelineUI === "function" && !syncRewardTimelineUI.__patched) {
        const orig = syncRewardTimelineUI;
        const patched = function(forceToEnd = false) {
          orig(forceToEnd);
          // autoscale Y to visible window
          if (typeof rewardChart !== "undefined" && rewardChart) {
            applyTightRightAxis(rewardChart, "y", "num");
            autoscaleYToVisible(rewardChart, "y");
          }
        };
        patched.__patched = true;
        syncRewardTimelineUI = patched;
      }
    } catch {}
  }

  /* ===================== Patch Reward tooltip to show date/time ===================== */
  function patchRewardTooltip() {
    try {
      if (!rewardChart?.options?.plugins?.tooltip) return;

      rewardChart.options.plugins.tooltip.callbacks = rewardChart.options.plugins.tooltip.callbacks || {};
      rewardChart.options.plugins.tooltip.callbacks.title = (items) => {
        const i = items?.[0]?.dataIndex ?? 0;
        const t = safe(wdTimes?.[i] || 0);
        return t ? new Date(t).toLocaleString() : (wdLabels?.[i] || "");
      };
      rewardChart.options.plugins.tooltip.callbacks.label = (item) => {
        const i = item?.dataIndex ?? 0;
        const v = safe(item?.raw);
        return `Withdrawn • +${v.toFixed(6)} INJ`;
      };

      // click a point -> toast
      rewardChart.options.onClick = (evt) => {
        try {
          const pts = rewardChart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
          if (!pts?.length) return;
          const i = pts[0].index;
          const t = safe(wdTimes?.[i] || 0);
          const v = safe(wdValues?.[i] || 0);
          if (typeof showToastEvent === "function") {
            showToastEvent({
              title: "Reward withdrawal",
              t: t || Date.now(),
              value: `+${v.toFixed(6)} INJ`,
              status: "ok"
            });
          }
        } catch {}
      };

      rewardChart.update("none");
    } catch {}
  }

  /* ===================== Stake axis to the right + scale toggle ===================== */
  function patchStakeChartAxis() {
    try {
      if (!stakeChart) return;
      stakeChart.options.scales = stakeChart.options.scales || {};
      stakeChart.options.scales.y = stakeChart.options.scales.y || {};
      applyTightRightAxis(stakeChart, "y", "num");

      // improve readability
      stakeChart.options.scales.x = stakeChart.options.scales.x || {};
      stakeChart.options.scales.x.display = false;

      stakeChart.update("none");
    } catch {}
  }

  /* ===================== Net Worth live sampling (1 point/min, update last point inside minute) ===================== */
  function patchNetWorthSampling() {
    try {
      if (typeof recordNetWorthPoint !== "function") return;
      if (recordNetWorthPoint.__patched) return;

      const orig = recordNetWorthPoint;

      const patched = function() {
        try {
          const a = getAddr();
          if (!a) return;

          const px = safe(typeof targetPrice !== "undefined" ? targetPrice : 0);
          if (!px || px <= 0) return;

          const totalInj = safe(typeof availableInj !== "undefined" ? availableInj : 0)
            + safe(typeof stakeInj !== "undefined" ? stakeInj : 0)
            + safe(typeof rewardsInj !== "undefined" ? rewardsInj : 0);

          const totalUsd = totalInj * px;
          if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

          const now = Date.now();
          const lastT = nwTAll?.length ? safe(nwTAll[nwTAll.length - 1]) : 0;

          // within 60s -> update last point (no spam, no cloud push)
          if (lastT && (now - lastT) < 60_000 && nwUsdAll?.length && nwInjAll?.length) {
            nwTAll[nwTAll.length - 1] = now;
            nwUsdAll[nwUsdAll.length - 1] = totalUsd;
            nwInjAll[nwInjAll.length - 1] = totalInj;

            if (typeof clampNWArrays === "function") clampNWArrays();
            if (typeof saveNWLocalOnly === "function") saveNWLocalOnly();
            if (typeof drawNW === "function") drawNW();
            return;
          }

          // otherwise original logic (adds a point + cloud schedule)
          orig();
        } catch {
          try { orig(); } catch {}
        }
      };

      patched.__patched = true;
      recordNetWorthPoint = patched;
    } catch {}
  }

  /* ===================== Patch drawNW autoscale + tight axis + apply saved scale ===================== */
  function patchDrawNW() {
    try {
      if (typeof drawNW !== "function") return;
      if (drawNW.__patched) return;

      const orig = drawNW;
      const patched = function() {
        orig();
        try {
          if (!netWorthChart) return;

          applyTightRightAxis(netWorthChart, "y", "usd");

          // apply stored scale
          const st = getScaleState("nw").y;
          setYAxisScale(netWorthChart, "y", st);

          // autoscale visible
          autoscaleYToVisible(netWorthChart, "y");
        } catch {}
      };
      patched.__patched = true;
      drawNW = patched;
    } catch {}
  }

  /* ===================== Hide non-essential Net Worth sub-card (best-effort) ===================== */
  function hideNetWorthExtraCardBestEffort() {
    try {
      const nwCard = $id("netWorthCard") || findCardByChildId("netWorthChart");
      if (!nwCard) return;

      const keepEl = $id("netWorthInj");
      const keepBox = keepEl ? (keepEl.closest(".mini-card, .sub-card, .nw-mini, .card-mini, .asset-card") || keepEl.parentElement) : null;

      const qty = $id("nwAssetQty");
      const price = $id("nwAssetPrice");
      const usd = $id("nwAssetUsd");

      const cand = qty?.closest(".mini-card, .sub-card, .nw-mini, .card-mini, .asset-card") ||
                   price?.closest(".mini-card, .sub-card, .nw-mini, .card-mini, .asset-card") ||
                   usd?.closest(".mini-card, .sub-card, .nw-mini, .card-mini, .asset-card");

      if (cand && cand !== keepBox) {
        cand.style.display = "none";
      }
    } catch {}
  }

  /* ===================== Fullscreen per card (charts) ===================== */
  function ensureFullscreenButtons() {
    try {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      for (const c of canvases) {
        const card = c.closest(".card") || c.parentElement;
        if (!card) continue;
        if (card.querySelector(".patch-fs-btn")) continue;

        ensureCardRelative(card);

        const btn = makeIconBtn("⛶", "Fullscreen");
        btn.classList.add("patch-fs-btn");
        btn.style.position = "absolute";
        btn.style.left = "12px";
        btn.style.top = "12px";
        btn.style.zIndex = "6";

        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const isOn = card.dataset.patchFullscreen === "1";
          if (isOn) {
            card.dataset.patchFullscreen = "0";
            card.style.position = "";
            card.style.left = "";
            card.style.top = "";
            card.style.right = "";
            card.style.bottom = "";
            card.style.width = "";
            card.style.height = "";
            card.style.zIndex = "";
            card.style.borderRadius = "";
            card.style.margin = "";
            card.style.overflow = "";
            document.body.classList.remove("patch-fs-open");
            document.querySelector(".patch-fs-backdrop")?.remove();
            try {
              if (typeof netWorthChart !== "undefined" && netWorthChart) netWorthChart.resize();
              if (typeof stakeChart !== "undefined" && stakeChart) stakeChart.resize();
              if (typeof rewardChart !== "undefined" && rewardChart) rewardChart.resize();
              if (typeof chart !== "undefined" && chart) chart.resize();
              if (typeof aprChart !== "undefined" && aprChart) aprChart.resize();
            } catch {}
            return;
          }

          card.dataset.patchFullscreen = "1";

          // backdrop
          let back = document.querySelector(".patch-fs-backdrop");
          if (!back) {
            back = document.createElement("div");
            back.className = "patch-fs-backdrop";
            back.style.cssText = "position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.55);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);";
            back.addEventListener("click", () => btn.click(), { passive: true });
            document.body.appendChild(back);
          }

          card.style.position = "fixed";
          card.style.left = "10px";
          card.style.right = "10px";
          card.style.top = "10px";
          card.style.bottom = "10px";
          card.style.width = "auto";
          card.style.height = "auto";
          card.style.zIndex = "901";
          card.style.borderRadius = "18px";
          card.style.margin = "0";
          card.style.overflow = "hidden";
          document.body.classList.add("patch-fs-open");

          setTimeout(() => {
            try {
              if (typeof netWorthChart !== "undefined" && netWorthChart) netWorthChart.resize();
              if (typeof stakeChart !== "undefined" && stakeChart) stakeChart.resize();
              if (typeof rewardChart !== "undefined" && rewardChart) rewardChart.resize();
              if (typeof chart !== "undefined" && chart) chart.resize();
              if (typeof aprChart !== "undefined" && aprChart) aprChart.resize();
            } catch {}
          }, 60);
        }, { passive: false });

        card.appendChild(btn);
      }
    } catch {}
  }

  /* ===================== APR mini chart + events ===================== */
  let aprChart = null;
  let aprT = [];
  let aprV = [];
  let lastAprSeen = null;

  function aprStoreKey() { return keyFor("apr_series"); }

  function loadAprSeries() {
    const obj = loadJSON(aprStoreKey(), null);
    if (!obj?.t || !obj?.v) return;
    aprT = Array.isArray(obj.t) ? obj.t.map(Number) : [];
    aprV = Array.isArray(obj.v) ? obj.v.map(Number) : [];
    // clamp
    const n = Math.min(aprT.length, aprV.length);
    aprT = aprT.slice(-n).slice(-1200);
    aprV = aprV.slice(-n).slice(-1200);
  }

  function saveAprSeries() {
    saveJSON(aprStoreKey(), { t: aprT, v: aprV });
  }

  function ensureAprChart() {
    const aprEl = $id("apr");
    if (!aprEl) return;
    const card = aprEl.closest(".card") || aprEl.parentElement;
    if (!card) return;

    // inject canvas
    if (!card.querySelector("#patchAprCanvas")) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "height:140px;margin-top:10px;";
      wrap.innerHTML = `<canvas id="patchAprCanvas"></canvas>`;
      card.appendChild(wrap);
    }

    const canvas = card.querySelector("#patchAprCanvas");
    if (!canvas || !window.Chart) return;

    if (!aprChart) {
      aprChart = new Chart(canvas, {
        type: "line",
        data: {
          labels: [],
          datasets: [{
            data: [],
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,.12)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true, displayColors: false } },
          scales: {
            x: { display: true, ticks: { color: (typeof axisTickColor === "function") ? axisTickColor() : undefined, maxTicksLimit: 6 }, grid: { display: false }, border: { display: false } },
            y: { display: true, position: "right", ticks: { color: (typeof axisTickColor === "function") ? axisTickColor() : undefined, mirror: true, padding: 4, callback: (v)=>`${safe(v).toFixed(2)}%` },
                 grid: { color: (typeof axisGridColor === "function") ? axisGridColor() : undefined }, border: { display: false } }
          }
        }
      });
    }

    // toggle scale on apr card
    ensureScaleToggleOnCard(card, "apr", () => aprChart, "y");
    applyTightRightAxis(aprChart, "y", "num");
    setYAxisScale(aprChart, "y", getScaleState("apr").y);
  }

  function updateAprChart() {
    if (!aprChart) return;
    const labels = aprT.map(t => {
      const d = new Date(safe(t));
      return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    });
    aprChart.data.labels = labels;
    aprChart.data.datasets[0].data = aprV;

    applyTightRightAxis(aprChart, "y", "num");
    setYAxisScale(aprChart, "y", getScaleState("apr").y);
    autoscaleYToVisible(aprChart, "y");

    aprChart.update("none");
  }

  function maybeRecordAprPoint() {
    const a = getAddr();
    if (!a) return;

    const cur = safe(typeof apr !== "undefined" ? apr : 0);
    if (!Number.isFinite(cur) || cur <= 0) return;

    if (lastAprSeen == null) {
      lastAprSeen = cur;
      return;
    }

    // record only meaningful changes
    if (Math.abs(cur - lastAprSeen) >= 0.02) {
      const t = Date.now();
      aprT.push(t);
      aprV.push(cur);
      if (aprT.length > 1200) { aprT = aprT.slice(-1200); aprV = aprV.slice(-1200); }
      saveAprSeries();
      updateAprChart();

      // event
      if (typeof pushEvent === "function") {
        pushEvent({
          type: "apr",
          title: "APR changed",
          value: `${lastAprSeen.toFixed(2)}% → ${cur.toFixed(2)}%`,
          status: (navigator.onLine ? "ok" : "pending")
        });
      }

      lastAprSeen = cur;
    }
  }

  /* ===================== Market move events thresholds ===================== */
  function marketStoreKeyForDay() {
    const d = new Date();
    const tag = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    return keyFor(`market_bucket_${tag}`);
  }

  function maybeMarketMoveEvent() {
    const a = getAddr();
    if (!a) return;

    const open = safe(candle?.d?.open);
    const px = safe(typeof targetPrice !== "undefined" ? targetPrice : 0);
    if (!open || !px) return;

    const pct = ((px - open) / open) * 100;
    const ap = Math.abs(pct);

    const buckets = [5,10,15,20,25,30,40,50];
    let b = 0;
    for (const x of buckets) if (ap >= x) b = x;

    const prev = safe(loadJSON(marketStoreKeyForDay(), 0));
    if (b > prev) {
      saveJSON(marketStoreKeyForDay(), b);
      if (typeof pushEvent === "function") {
        pushEvent({
          type: "market",
          title: `Market move ${pct > 0 ? "up" : "down"}`,
          value: `${pct > 0 ? "+" : ""}${pct.toFixed(2)}% (≥ ${b}%)`,
          status: (navigator.onLine ? "ok" : "pending")
        });
      }
    }
  }

  /* ===================== Event Page: filters + reset + pagination ===================== */
  const EV_PAGE_SIZE = 25;
  const evState = { page: 1, filter: "all" };

  function ensureEventControls() {
    try {
      if (!window.eventPage || !eventPage) return;
      if (eventPage.querySelector("#patchEvControls")) return;

      // Insert controls in header near close
      const closeBtn = eventPage.querySelector("#eventCloseBtn");
      if (!closeBtn) return;

      const ctr = document.createElement("div");
      ctr.id = "patchEvControls";
      ctr.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;";

      const filter = document.createElement("select");
      filter.id = "patchEvFilter";
      filter.style.cssText = `
        height:40px;border-radius:14px;padding:0 10px;font-weight:900;cursor:pointer;
        border:1px solid ${themeIsLight() ? "rgba(15,23,42,.14)" : "rgba(255,255,255,.14)"};
        background:${themeIsLight() ? "rgba(15,23,42,.06)" : "rgba(255,255,255,.06)"};
        color:${themeIsLight() ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)"};
      `;
      const types = [
        ["all","All"],
        ["reward","Reward"],
        ["stake","Stake"],
        ["apr","APR"],
        ["market","Market"],
        ["ui","UI"]
      ];
      for (const [v,t] of types) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        filter.appendChild(o);
      }

      const reset = makeMiniBtn("Reset", "Clear events for this wallet");
      const pager = document.createElement("div");
      pager.id = "patchEvPager";
      pager.style.cssText = "width:100%;margin-top:10px;display:flex;gap:8px;align-items:center;justify-content:space-between;opacity:.9;font-weight:900;";

      ctr.appendChild(filter);
      ctr.appendChild(reset);

      closeBtn.insertAdjacentElement("beforebegin", ctr);
      closeBtn.closest("div")?.insertAdjacentElement("afterend", pager);

      filter.addEventListener("change", () => {
        evState.filter = filter.value || "all";
        evState.page = 1;
        if (typeof renderEventRows === "function") renderEventRows();
      }, { passive: true });

      reset.addEventListener("click", () => {
        try {
          if (Array.isArray(eventsAll)) eventsAll = [];
          if (typeof saveEventsLocalOnly === "function") saveEventsLocalOnly();
          if (typeof cloudSchedulePush === "function") cloudSchedulePush();
          if (typeof renderEventRows === "function") renderEventRows();
          if (typeof showToastEvent === "function") showToastEvent({ title: "Events reset", t: Date.now(), value: "Cleared", status: "ok" });
        } catch {}
      }, { passive: true });
    } catch {}
  }

  function patchRenderEventRows() {
    try {
      if (typeof renderEventRows !== "function") return;
      if (renderEventRows.__patched) return;

      const orig = renderEventRows;

      const patched = function() {
        try {
          if (!eventPage) return orig();

          ensureEventControls();

          const rows = eventPage.querySelector("#eventRows");
          if (!rows) return;

          const pager = eventPage.querySelector("#patchEvPager");

          let items = Array.isArray(eventsAll) ? eventsAll.slice() : [];
          // newest first display (keep original behavior)
          items = items.slice().reverse();

          // filter
          const fSel = eventPage.querySelector("#patchEvFilter");
          const f = (fSel?.value || evState.filter || "all");
          if (f && f !== "all") {
            items = items.filter(ev => String(ev?.type || "") === f);
          }

          const total = items.length;
          const pages = Math.max(1, Math.ceil(total / EV_PAGE_SIZE));
          evState.page = clamp(evState.page || 1, 1, pages);

          const start = (evState.page - 1) * EV_PAGE_SIZE;
          const pageItems = items.slice(start, start + EV_PAGE_SIZE);

          // reuse original renderer styles if possible
          const fg = themeIsLight() ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)";
          const muted = themeIsLight() ? "rgba(15,23,42,.62)" : "rgba(249,250,251,.62)";
          const border = themeIsLight() ? "rgba(15,23,42,.10)" : "rgba(255,255,255,.10)";
          const bgRow = themeIsLight() ? "rgba(15,23,42,.03)" : "rgba(255,255,255,.03)";

          if (!pageItems.length) {
            rows.innerHTML = `<div style="padding:14px;opacity:.75;font-weight:850;">No events.</div>`;
          } else {
            rows.innerHTML = pageItems.map((ev, idx) => {
              const dt = new Date(safe(ev?.t) || Date.now());
              const dtStr = dt.toLocaleDateString() + " " + dt.toLocaleTimeString();
              const v = String(ev?.value || "—");
              const title = String(ev?.title || "Event");
              const badge = (typeof statusBadgeHTML === "function") ? statusBadgeHTML(ev?.status) : "";
              return `
                <div style="display:grid;grid-template-columns: 1.2fr .9fr .9fr .55fr;gap:10px;
                  padding:12px 14px;border-top:1px solid ${border};background:${idx%2?bgRow:"transparent"};color:${fg};">
                  <div style="font-weight:950;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</div>
                  <div style="color:${muted};font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dtStr}</div>
                  <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v}</div>
                  <div style="text-align:right;">${badge}</div>
                </div>
              `;
            }).join("");
          }

          if (pager) {
            pager.innerHTML = "";

            const left = document.createElement("div");
            left.style.display = "flex";
            left.style.alignItems = "center";
            left.style.gap = "8px";

            const prev = makeMiniBtn("‹", "Prev");
            const next = makeMiniBtn("›", "Next");
            prev.style.width = next.style.width = "42px";

            const info = document.createElement("div");
            info.textContent = `Page ${evState.page}/${pages} · ${total} events`;
            info.style.opacity = ".85";

            prev.disabled = evState.page <= 1;
            next.disabled = evState.page >= pages;
            prev.style.opacity = prev.disabled ? ".4" : "1";
            next.style.opacity = next.disabled ? ".4" : "1";

            prev.addEventListener("click", () => { if (evState.page > 1) { evState.page--; patched(); } }, { passive: true });
            next.addEventListener("click", () => { if (evState.page < pages) { evState.page++; patched(); } }, { passive: true });

            left.appendChild(prev);
            left.appendChild(next);
            left.appendChild(info);

            pager.appendChild(left);

            const right = document.createElement("div");
            right.style.opacity = ".8";
            right.textContent = `Filter: ${f.toUpperCase()}`;
            pager.appendChild(right);
          }
        } catch {
          orig();
        }
      };

      patched.__patched = true;
      renderEventRows = patched;
    } catch {}
  }

  /* ===================== PRICE TF (5m/1d/1w/1m/1y/all) + scale ===================== */
  const priceState = {
    tf: loadJSON("inj_patch_price_tf_global", "1d"), // global, not per address (market data)
  };

  async function fetchBinanceKlines(interval, startTimeMs, limit = 1000) {
    try {
      const st = Number.isFinite(+startTimeMs) ? `&startTime=${Math.floor(startTimeMs)}` : "";
      const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=${limit}${st}`;
      const d = (typeof fetchJSON === "function") ? await fetchJSON(url) : null;
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }

  function priceTfToRequest(tf) {
    const now = Date.now();
    if (tf === "1w") return { interval: "15m", start: now - 7*24*60*60*1000, limit: 1000 };
    if (tf === "1m") return { interval: "1h",  start: now - 30*24*60*60*1000, limit: 1000 };
    if (tf === "1y") return { interval: "1d",  start: now - 365*24*60*60*1000, limit: 500 };
    if (tf === "all") return { interval: "1w", start: now - 3650*24*60*60*1000, limit: 1000 };
    return null;
  }

  function ensurePriceControls() {
    const cv = $id("priceChart");
    if (!cv) return;
    const card = cv.closest(".card") || cv.parentElement;
    if (!card) return;

    ensureCardRelative(card);

    if (!card.querySelector("#patchPriceControls")) {
      const wrap = document.createElement("div");
      wrap.id = "patchPriceControls";
      wrap.style.cssText = "position:absolute;right:12px;top:12px;display:flex;gap:8px;flex-wrap:wrap;z-index:7;";
      card.appendChild(wrap);

      const buttons = [
        ["5m", "5m"],
        ["1d", "1D"],
        ["1w", "1W"],
        ["1m", "1M"],
        ["1y", "1Y"],
        ["all","ALL"],
      ];

      for (const [tf, label] of buttons) {
        const b = makeMiniBtn(label, `Price timeframe ${label}`);
        b.dataset.tf = tf;
        if (tf === priceState.tf) b.style.outline = "2px solid rgba(250,204,21,.55)";
        b.addEventListener("click", async () => {
          priceState.tf = tf;
          saveJSON("inj_patch_price_tf_global", tf);
          // update UI selection
          wrap.querySelectorAll("button[data-tf]").forEach(x => x.style.outline = "");
          b.style.outline = "2px solid rgba(250,204,21,.55)";
          await applyPriceTimeframe(tf);
        }, { passive: true });
        wrap.appendChild(b);
      }

      // scale toggle (Y)
      const sc = makeMiniBtn("LIN", "Switch Y scale: Linear / Log");
      sc.dataset.scale = "1";
      sc.addEventListener("click", () => {
        const cur = getScaleState("price").y;
        const next = (cur === "linear") ? "logarithmic" : "linear";
        setScaleState("price", next);
        sc.textContent = (next === "logarithmic") ? "LOG" : "LIN";
        if (typeof chart !== "undefined" && chart) {
          applyTightRightAxis(chart, "y", "usd");
          setYAxisScale(chart, "y", next);
          autoscaleYToVisible(chart, "y");
        }
      }, { passive: true });
      wrap.appendChild(sc);

      // initial label
      sc.textContent = (getScaleState("price").y === "logarithmic") ? "LOG" : "LIN";
    }
  }

  async function applyPriceTimeframe(tf) {
    try {
      if (typeof chart === "undefined" || !chart) return;

      // always apply tight Y + scale
      applyTightRightAxis(chart, "y", "usd");
      setYAxisScale(chart, "y", getScaleState("price").y);

      // 5m = keep live 1m stream but show last 5 points
      if (tf === "5m") {
        chart.options.scales.x.display = false;
        const n = chart.data.datasets?.[0]?.data?.length || 0;
        if (n > 0) {
          const minIdx = Math.max(0, n - 5);
          chart.options.scales.x.min = minIdx;
          chart.options.scales.x.max = n - 1;
        }
        autoscaleYToVisible(chart, "y");
        chart.update("none");
        return;
      }

      // 1d: restore core behavior
      if (tf === "1d") {
        chart.options.scales.x.display = false;
        chart.options.scales.x.min = undefined;
        chart.options.scales.x.max = undefined;

        // allow core refresh to keep running
        autoscaleYToVisible(chart, "y");
        chart.update("none");
        return;
      }

      // other TF: fetch and freeze live updates
      const req = priceTfToRequest(tf);
      if (!req) return;

      const kl = await fetchBinanceKlines(req.interval, req.start, req.limit);
      if (!kl?.length) return;

      const labels = kl.map(k => {
        const t = safe(k?.[0]);
        const d = new Date(t);
        if (tf === "1y" || tf === "all") return d.toLocaleDateString();
        return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      });

      const data = kl.map(k => safe(k?.[4])).filter(v => Number.isFinite(v));

      chart.data.labels = labels;
      chart.data.datasets[0].data = data;

      // show x in long TF
      chart.options.scales.x.display = true;
      chart.options.scales.x.grid = chart.options.scales.x.grid || {};
      chart.options.scales.x.grid.display = false;
      chart.options.scales.x.ticks = chart.options.scales.x.ticks || {};
      chart.options.scales.x.ticks.color = (typeof axisTickColor === "function") ? axisTickColor() : undefined;
      chart.options.scales.x.ticks.maxTicksLimit = 6;
      chart.options.scales.x.min = undefined;
      chart.options.scales.x.max = undefined;

      autoscaleYToVisible(chart, "y");
      chart.update("none");
    } catch {}
  }

  function patchPriceUpdatersToRespectTF() {
    try {
      // block core loadChartToday when TF != 1d/5m
      if (typeof loadChartToday === "function" && !loadChartToday.__patched) {
        const orig = loadChartToday;
        const patched = async function(isRefresh = false) {
          const tf = loadJSON("inj_patch_price_tf_global", "1d");
          if (tf !== "1d" && tf !== "5m") return;
          return orig(isRefresh);
        };
        patched.__patched = true;
        loadChartToday = patched;
      }

      if (typeof ensureChartBootstrapped === "function" && !ensureChartBootstrapped.__patched) {
        const orig = ensureChartBootstrapped;
        const patched = async function() {
          const tf = loadJSON("inj_patch_price_tf_global", "1d");
          if (tf !== "1d" && tf !== "5m") return;
          return orig();
        };
        patched.__patched = true;
        ensureChartBootstrapped = patched;
      }

      if (typeof updateChartFrom1mKline === "function" && !updateChartFrom1mKline.__patched) {
        const orig = updateChartFrom1mKline;
        const patched = function(k) {
          const tf = loadJSON("inj_patch_price_tf_global", "1d");
          if (tf !== "1d" && tf !== "5m") return;
          orig(k);
          // keep 5m window moving
          if (tf === "5m" && typeof chart !== "undefined" && chart) {
            const n = chart.data.datasets?.[0]?.data?.length || 0;
            if (n > 0) {
              chart.options.scales.x.min = Math.max(0, n - 5);
              chart.options.scales.x.max = n - 1;
              autoscaleYToVisible(chart, "y");
              chart.update("none");
            }
          }
        };
        patched.__patched = true;
        updateChartFrom1mKline = patched;
      }
    } catch {}
  }

  /* ===================== Attach scale toggles to cards ===================== */
  function attachScaleToggles() {
    try {
      // Net Worth card toggle
      const nwCard = $id("netWorthCard") || findCardByChildId("netWorthChart");
      if (nwCard) ensureScaleToggleOnCard(nwCard, "nw", () => (typeof netWorthChart !== "undefined" ? netWorthChart : null), "y");

      // Stake card toggle
      const stCard = findCardByChildId("stakeChart") || findCardByChildId("stake");
      if (stCard) ensureScaleToggleOnCard(stCard, "stake", () => (typeof stakeChart !== "undefined" ? stakeChart : null), "y");

      // Reward card toggle
      const rwCard = findCardByChildId("rewardChart") || findCardByChildId("rewards");
      if (rwCard) ensureScaleToggleOnCard(rwCard, "reward", () => (typeof rewardChart !== "undefined" ? rewardChart : null), "y");

      // Price controls includes scale already
      ensurePriceControls();
    } catch {}
  }

  /* ===================== Apply saved scales when charts exist ===================== */
  function applyScalesOnceChartsReady() {
    try {
      // Net worth
      if (typeof netWorthChart !== "undefined" && netWorthChart) {
        applyTightRightAxis(netWorthChart, "y", "usd");
        setYAxisScale(netWorthChart, "y", getScaleState("nw").y);
        autoscaleYToVisible(netWorthChart, "y");
      }

      // Stake
      if (typeof stakeChart !== "undefined" && stakeChart) {
        patchStakeChartAxis();
        setYAxisScale(stakeChart, "y", getScaleState("stake").y);
        autoscaleYToVisible(stakeChart, "y");
      }

      // Reward
      if (typeof rewardChart !== "undefined" && rewardChart) {
        applyTightRightAxis(rewardChart, "y", "num");
        setYAxisScale(rewardChart, "y", getScaleState("reward").y);
        autoscaleYToVisible(rewardChart, "y");
        patchRewardTooltip();
      }

      // Price
      if (typeof chart !== "undefined" && chart) {
        applyTightRightAxis(chart, "y", "usd");
        setYAxisScale(chart, "y", getScaleState("price").y);
        autoscaleYToVisible(chart, "y");
      }

      // APR
      if (aprChart) {
        applyTightRightAxis(aprChart, "y", "num");
        setYAxisScale(aprChart, "y", getScaleState("apr").y);
        autoscaleYToVisible(aprChart, "y");
      }
    } catch {}
  }

  /* ===================== Hook setAddressDisplay to re-add copy button ===================== */
  function patchSetAddressDisplay() {
    try {
      if (typeof setAddressDisplay !== "function") return;
      if (setAddressDisplay.__patched) return;

      const orig = setAddressDisplay;
      const patched = function(addr) {
        orig(addr);
        ensureCopyAddressBtn();
      };
      patched.__patched = true;
      setAddressDisplay = patched;
    } catch {}
  }

  /* ===================== Boot patch ===================== */
  onReady(() => {
    try {
      // keep idempotent controls
      ensureCopyAddressBtn();
      ensureMenuLabels();

      // reward filter options + functions
      ensureRewardFilterOptions();
      patchRewardFunctions();

      // events page renderer
      patchRenderEventRows();

      // networth sampling + draw enhancements
      patchNetWorthSampling();
      patchDrawNW();

      // price TF safety wrappers
      patchPriceUpdatersToRespectTF();

      // gear buttons
      ensureGearNearBar("stakeBar", "stake");
      ensureGearNearBar("rewardBar", "reward");

      // reward estimates
      ensureRewardEstimateRow();

      // setAddressDisplay hook
      patchSetAddressDisplay();

      // hide net worth extra card if found
      hideNetWorthExtraCardBestEffort();

      // fullscreen buttons
      ensureFullscreenButtons();

      // APR chart
      loadAprSeries();
      ensureAprChart();
      updateAprChart();

      // Attach scale toggles on cards
      attachScaleToggles();

      // apply initial price TF (if chart exists)
      setTimeout(async () => {
        ensurePriceControls();
        await applyPriceTimeframe(loadJSON("inj_patch_price_tf_global", "1d"));
      }, 500);

      // periodic “late init” (charts might appear after)
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        ensureCopyAddressBtn();
        ensureMenuLabels();
        ensureRewardFilterOptions();
        ensureGearNearBar("stakeBar", "stake");
        ensureGearNearBar("rewardBar", "reward");
        ensureRewardEstimateRow();
        ensurePriceControls();
        attachScaleToggles();
        applyScalesOnceChartsReady();
        patchRewardTooltip();
        patchStakeChartAxis();
        hideNetWorthExtraCardBestEffort();
        ensureFullscreenButtons();
        ensureAprChart();
        updateAprChart();

        if (tries > 30) clearInterval(t);
      }, 650);

      // start bars loop override
      requestAnimationFrame(patchBarsLoop);

      // background “events detectors”
      setInterval(() => {
        try {
          maybeRecordAprPoint();
          maybeMarketMoveEvent();
        } catch {}
      }, 1200);

      // if price TF is 5m keep autoscale fresh
      setInterval(() => {
        try {
          const tf = loadJSON("inj_patch_price_tf_global", "1d");
          if (tf === "5m" && typeof chart !== "undefined" && chart) {
            autoscaleYToVisible(chart, "y");
          }
        } catch {}
      }, 1200);

      // log patch version in console
      console.log(`[INJ PATCH] v${PATCH_VER} loaded`);
    } catch (e) {
      console.warn("[INJ PATCH] failed to init:", e);
    }
  });

})();

/* =====================================================================
   PATCH v2.0.2x — Validator effettivo + Stake points ONLY on increase
   Incolla in fondo ad app.js
   ===================================================================== */
(function PATCH_VALIDATOR_AND_STAKE_ONLY_INCREASE(){
  "use strict";

  // ---------- guards ----------
  const has = (name) => typeof window[name] !== "undefined";
  const safeFn = (name) => (typeof window[name] === "function" ? window[name] : null);

  // reuse your helpers if present
  const _fetchJSON   = safeFn("fetchJSON");
  const _hasInternet = safeFn("hasInternet") || (() => navigator.onLine === true);
  const _shortAddr   = safeFn("shortAddr") || ((a)=>a);
  const _safe        = safeFn("safe") || ((n)=> (Number.isFinite(+n) ? +n : 0));

  // your validator UI functions (if present)
  const _ensureValidatorCard = safeFn("ensureValidatorCard");
  const _setValidatorDot     = safeFn("setValidatorDot");
  const _setValidatorLine    = safeFn("setValidatorLine");
  const _loadValidatorInfo   = safeFn("loadValidatorInfo"); // your existing loader

  // Injective LCD base (same as your code)
  const LCD_BASE = "https://lcd.injective.network";

  // cache validator lookup per address (avoid hammering LCD)
  const VAL_CACHE_MS = 10 * 60 * 1000;
  const VAL_CACHE_KEY = (addr) => `inj_valcache_v1_${(addr||"").trim()}`;

  function ensureValidatorTag(){
    // If user added HTML patch -> use it. Otherwise try to inject inside addressDisplay.
    let tag = document.getElementById("validatorTag");
    let txt = document.getElementById("validatorTagText");

    if (!tag || !txt){
      const addrDisp = document.getElementById("addressDisplay");
      if (!addrDisp) return { tag: null, txt: null };

      // create only once
      tag = document.createElement("div");
      tag.id = "validatorTag";
      tag.className = "validator-tag";
      tag.hidden = true;

      const k = document.createElement("span");
      k.className = "validator-tag__k";
      k.textContent = "Validator:";

      txt = document.createElement("span");
      txt.id = "validatorTagText";
      txt.className = "validator-tag__v";
      txt.textContent = "—";

      tag.appendChild(k);
      tag.appendChild(txt);
      addrDisp.appendChild(tag);
    }

    return { tag, txt };
  }

  function setValidatorTagText(label){
    const { tag, txt } = ensureValidatorTag();
    if (!tag || !txt) return;
    if (!label) {
      tag.hidden = true;
      txt.textContent = "—";
      return;
    }
    txt.textContent = label;
    tag.hidden = false;
  }

  function pickPrimaryValidatorFromDelegations(delgs){
    // Choose the validator with the largest delegated balance.amount
    let bestAddr = "";
    let bestAmt = 0;

    for (const d of (delgs || [])) {
      const va = d?.delegation?.validator_address || "";
      const amt = _safe(d?.balance?.amount) / 1e18; // inj denom uses 1e18
      if (va && amt > bestAmt) {
        bestAmt = amt;
        bestAddr = va;
      }
    }
    return { validator: bestAddr, amount: bestAmt };
  }

  async function fetchValidatorMoniker(validatorAddr){
    if (!_fetchJSON || !validatorAddr) return { moniker: "", bonded: null };

    const v = await _fetchJSON(`${LCD_BASE}/cosmos/staking/v1beta1/validators/${encodeURIComponent(validatorAddr)}`);
    const moniker = v?.validator?.description?.moniker || "";
    const st = String(v?.validator?.status || "");
    const bonded = (st.includes("BONDED") || st === "BOND_STATUS_BONDED");
    return { moniker, bonded };
  }

  async function resolveValidatorForAddress(addr){
    const a = (addr || "").trim();
    if (!a) return null;

    // cache
    try{
      const raw = localStorage.getItem(VAL_CACHE_KEY(a));
      if (raw){
        const obj = JSON.parse(raw);
        if (obj?.t && (Date.now() - obj.t) < VAL_CACHE_MS && obj?.validator){
          return obj;
        }
      }
    } catch {}

    if (!_hasInternet()) return null;
    if (!_fetchJSON) return null;

    const s = await _fetchJSON(`${LCD_BASE}/cosmos/staking/v1beta1/delegations/${encodeURIComponent(a)}`);
    const delgs = s?.delegation_responses || [];

    const { validator, amount } = pickPrimaryValidatorFromDelegations(delgs);
    if (!validator) {
      const out = { t: Date.now(), validator: "", moniker: "", amount: 0 };
      try { localStorage.setItem(VAL_CACHE_KEY(a), JSON.stringify(out)); } catch {}
      return out;
    }

    const info = await fetchValidatorMoniker(validator);
    const out = {
      t: Date.now(),
      validator,
      moniker: info.moniker || "",
      bonded: info.bonded,
      amount
    };

    try { localStorage.setItem(VAL_CACHE_KEY(a), JSON.stringify(out)); } catch {}
    return out;
  }

  async function refreshValidatorUI(){
    try{
      // uses your global "address" if present
      if (typeof address === "undefined") return;
      const a = (address || "").trim();

      // show loading
      if (_ensureValidatorCard) _ensureValidatorCard();
      if (_setValidatorDot) _setValidatorDot(_hasInternet() ? "loading" : "fail");
      if (_setValidatorLine) _setValidatorLine(a ? "Loading…" : "No wallet selected");
      setValidatorTagText(a ? "Loading…" : "");

      if (!a) return;
      if (!_hasInternet()) {
        setValidatorTagText("Offline");
        if (_setValidatorDot) _setValidatorDot("fail");
        if (_setValidatorLine) _setValidatorLine(`${_shortAddr(a)} · Offline`);
        return;
      }

      const r = await resolveValidatorForAddress(a);
      if (!r) return;

      if (!r.validator){
        setValidatorTagText("No delegation");
        if (_setValidatorDot) _setValidatorDot("fail");
        if (_setValidatorLine) _setValidatorLine("No validator found");
        return;
      }

      const label = r.moniker
        ? `${r.moniker} · ${_shortAddr(r.validator)}`
        : `${_shortAddr(r.validator)}`;

      setValidatorTagText(label);

      // Update your existing validator card too
      if (_loadValidatorInfo) {
        // your function already fetches moniker + bonded + dot styling
        _loadValidatorInfo(r.validator);
      } else {
        if (_setValidatorLine) _setValidatorLine(label);
        if (_setValidatorDot) _setValidatorDot(r.bonded ? "ok" : "loading");
      }
    } catch (e){
      console.warn("PATCH validator UI error:", e);
    }
  }

  // ---------- STAKE: only record on increase + prevent cross-address bleed ----------
  function hardResetStakeSeries(){
    try{
      if (typeof stakeLabels !== "undefined") stakeLabels = [];
      if (typeof stakeData   !== "undefined") stakeData   = [];
      if (typeof stakeMoves  !== "undefined") stakeMoves  = [];
      if (typeof stakeTypes  !== "undefined") stakeTypes  = [];
      if (typeof lastStakeRecordedRounded !== "undefined") lastStakeRecordedRounded = null;
      if (typeof stakeBaselineCaptured !== "undefined") stakeBaselineCaptured = false;
    } catch {}
  }

  // If loadStakeSeries fails, clear arrays (so you don't keep old address data)
  if (typeof loadStakeSeries === "function") {
    const _loadStakeSeries = loadStakeSeries;
    loadStakeSeries = function(){
      const ok = _loadStakeSeries.apply(this, arguments);
      if (!ok) {
        hardResetStakeSeries();
        try { if (typeof drawStakeChart === "function") drawStakeChart(); } catch {}
      }
      return ok;
    };
  }

  // Override stake point recorder: baseline once, then ONLY when it increases
  if (typeof maybeAddStakePoint === "function") {
    const EPS = 0.000001; // precision guard (INJ)
    maybeAddStakePoint = function(currentStake){
      try{
        const s = _safe(currentStake);
        if (!Number.isFinite(s)) return;

        const rounded = Number(s.toFixed(6));

        // baseline (first time only)
        if (typeof stakeBaselineCaptured !== "undefined" && !stakeBaselineCaptured) {
          if (typeof nowLabel === "function") stakeLabels.push(nowLabel());
          else stakeLabels.push(new Date().toLocaleTimeString());

          stakeData.push(rounded);
          stakeMoves.push(1);
          stakeTypes.push("Baseline (current)");
          lastStakeRecordedRounded = rounded;
          stakeBaselineCaptured = true;

          if (typeof saveStakeSeries === "function") saveStakeSeries();
          if (typeof drawStakeChart === "function") drawStakeChart();
          return;
        }

        // no baseline variable? fallback
        if (typeof lastStakeRecordedRounded === "undefined" || lastStakeRecordedRounded == null) {
          lastStakeRecordedRounded = rounded;
          return;
        }

        // ONLY record when it increases
        if (rounded > (lastStakeRecordedRounded + EPS)) {
          const delta = rounded - lastStakeRecordedRounded;
          lastStakeRecordedRounded = rounded;

          if (typeof nowLabel === "function") stakeLabels.push(nowLabel());
          else stakeLabels.push(new Date().toLocaleTimeString());

          stakeData.push(rounded);
          stakeMoves.push(1);
          stakeTypes.push("Stake increased");

          // optional: keep your event system if present
          if (typeof pushEvent === "function") {
            pushEvent({
              type: "stake",
              title: "Stake increased",
              value: `+${delta.toFixed(6)} INJ`,
              status: (_hasInternet() ? "ok" : "pending")
            });
          }

          if (typeof saveStakeSeries === "function") saveStakeSeries();
          if (typeof drawStakeChart === "function") drawStakeChart();
          return;
        }

        // If it decreases, update reference so future increases are measured correctly,
        // but DO NOT create a point.
        if (rounded < lastStakeRecordedRounded) {
          lastStakeRecordedRounded = rounded;
        }
      } catch (e){
        console.warn("PATCH maybeAddStakePoint error:", e);
      }
    };
  }

  // Wrap commitAddress to ensure no stake data bleed + refresh validator immediately
  if (typeof commitAddress === "function") {
    const _commitAddress = commitAddress;
    commitAddress = async function(newAddr){
      // pre-clear stake series to prevent old arrays being shown if load fails
      hardResetStakeSeries();
      try { if (typeof drawStakeChart === "function") drawStakeChart(); } catch {}
      const r = await _commitAddress.apply(this, arguments);
      // refresh validator UI after address is set
      refreshValidatorUI();
      return r;
    };
  }

  // periodic refresh (safe)
  setTimeout(refreshValidatorUI, 900);
  setInterval(() => {
    try{
      if (typeof address === "undefined") return;
      if (!(address || "").trim()) return;
      refreshValidatorUI();
    } catch {}
  }, 45_000);

})();

