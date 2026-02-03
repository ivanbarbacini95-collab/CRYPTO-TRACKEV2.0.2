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

/* persistence */
const STAKE_LOCAL_VER = 2;
/* ✅ non resettare più ad ogni refresh: mantieni punti anche se ricarichi pagina */
const RESET_STAKE_FROM_NOW_ON_BOOT = false;

const REWARD_WD_LOCAL_VER = 2;
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* NET WORTH persistence */
const NW_LOCAL_VER = 2;
const NW_MAX_POINTS = 4800;

/* NET WORTH LIVE */
const NW_LIVE_WINDOW_MS = 120_000;     // ✅ 2 minuti
const NW_LIVE_MIN_DT_MS = 900;         // campionamento live
const NW_LIVE_MIN_DUSD  = 0.05;        // o se cambia almeno di 5 cent
const NW_FIXED_MIN_DT_MS = 5000;       // punti “storici”
const NW_FIXED_MIN_DUSD  = 0.25;

const NW_UNLOCK_W_MS = 24 * 60 * 60 * 1000;     // mostra 1W dopo 1 giorno
const NW_UNLOCK_M_MS = 7 * 24 * 60 * 60 * 1000; // mostra 1M dopo 1 settimana
const NW_UNLOCK_Y_MS = 30 * 24 * 60 * 60 * 1000;// mostra 1Y dopo 1 mese
const NW_UNLOCK_ALL_MS = 365 * 24 * 60 * 60 * 1000; // mostra ALL dopo 1 anno

/* PRICE CHART cache */
const PRICE_CACHE_VER = 1;

/* REFRESH mode staging */
const REFRESH_RED_MS = 220;
let refreshLoaded = false;
let refreshLoading = false;

/* ✅ Status dot "mode loading" */
let modeLoading = false;

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

function axisGridColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)";
}
function axisTickColor() {
  return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)";
}

/* ================= DIGIT ANIM (same as INJ price) ================= */
function colorNumber(el, n, o, d) {
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  const base = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i] ? (n > o ? "#22c55e" : "#ef4444") : base;
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}
function colorNumberSuffix(el, n, o, d, suffix){
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns + suffix; return; }
  const base = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  const out = [...ns].map((c, i) => {
    const col = c !== os[i] ? (n > o ? "#22c55e" : "#ef4444") : base;
    return `<span style="color:${col}">${c}</span>`;
  });
  out.push(`<span style="color:${base}">${suffix}</span>`);
  el.innerHTML = out.join("");
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
function colorApproxMoney(el, n, o, decimals = 2){
  if (!el) return;
  n = safe(n); o = safe(o);
  const ns = n.toFixed(decimals);
  const os = o.toFixed(decimals);

  const baseCol = (document.body.dataset.theme === "light") ? "#0f172a" : "#f9fafb";
  if (ns === os) { el.textContent = `≈ $${ns}`; return; }

  const upCol = "#22c55e";
  const dnCol = "#ef4444";
  const dir = (n > o) ? "up" : "down";

  const out = [
    `<span style="color:${baseCol}">≈ </span>`,
    `<span style="color:${baseCol}">$</span>`
  ];
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

/* ================= THEME / MODE ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY  = "inj_mode"; // live | refresh
const ADDR_KEY  = "inj_address";

let theme   = localStorage.getItem(THEME_KEY) || "dark";
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";

function applyTheme(t){
  theme = (t === "light") ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const themeIcon = $("themeIcon");
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
  refreshChartsTheme();
}
applyTheme(theme);

/* ================= Chart.js Zoom plugin (safe) ================= */
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

/* ================= EXTRA UI (expand overlay + HUD) ================= */
let expandedCard = null;
let expandedCanvasId = null;

function ensureExtraUI(){
  // small CSS fixes + expand btn positioning (even if CSS is older)
  if (!document.getElementById("injExtraStyle")){
    const st = document.createElement("style");
    st.id = "injExtraStyle";
    st.textContent = `
      .expand-btn{ position:absolute; top:12px; right:12px; }
      .stake-percent,.reward-percent{ background: rgba(0,0,0,0.22); }
      body[data-theme="light"] .stake-percent,
      body[data-theme="light"] .reward-percent{ background: rgba(255,255,255,0.55); }
    `;
    document.head.appendChild(st);
  }

  if (!$("cardExpandOverlay")){
    const ov = document.createElement("div");
    ov.id = "cardExpandOverlay";
    ov.className = "card-expand-overlay";
    ov.setAttribute("aria-hidden", "true");
    document.body.appendChild(ov);
  }
  if (!$("chartHud")){
    const hud = document.createElement("div");
    hud.id = "chartHud";
    hud.className = "chart-hud";
    hud.textContent = "";
    document.body.appendChild(hud);
  }
  if (!$("expandClose")){
    const btn = document.createElement("button");
    btn.id = "expandClose";
    btn.className = "expand-close";
    btn.type = "button";
    btn.setAttribute("aria-label", "Close");
    btn.textContent = "✕";
    document.body.appendChild(btn);
  }

  $("cardExpandOverlay")?.addEventListener("click", () => closeExpandedCard(), { passive:true });
  $("expandClose")?.addEventListener("click", (e) => { e?.preventDefault?.(); closeExpandedCard(); }, { passive:false });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("card-expanded")) closeExpandedCard();
  });

  // If user asked to remove “total qty px” row: hide it if present (safe)
  const maybeRow = document.querySelector(".networth-asset");
  if (maybeRow) maybeRow.style.display = "none";
}
ensureExtraUI();

function setChartHud(text){
  const hud = $("chartHud");
  if (!hud) return;
  hud.textContent = text || "";
}

function openExpandedCard(cardEl, canvasId){
  if (!cardEl) return;
  closeExpandedCard();

  expandedCard = cardEl;
  expandedCanvasId = canvasId || null;

  document.body.classList.add("card-expanded", "no-scroll");
  cardEl.classList.add("is-expanded");

  // Resize charts after layout change
  requestAnimationFrame(() => {
    try{
      if (canvasId === "netWorthChart" && netWorthChart) netWorthChart.resize();
      if (canvasId === "stakeChart" && stakeChart) stakeChart.resize();
      if (canvasId === "rewardChart" && rewardChart) rewardChart.resize();
      if (canvasId === "priceChart" && chart) chart.resize();
    } catch {}
  });
}

function closeExpandedCard(){
  document.body.classList.remove("card-expanded", "no-scroll");
  if (expandedCard) expandedCard.classList.remove("is-expanded");
  expandedCard = null;
  expandedCanvasId = null;
  setChartHud("");
}

/* Create expand buttons INSIDE cards */
function addExpandBtnToCard(cardEl, canvasId){
  if (!cardEl || !canvasId) return;
  if (cardEl.querySelector(`button.expand-btn[data-canvas="${canvasId}"]`)) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn expand-btn";
  btn.textContent = "⛶";
  btn.setAttribute("aria-label", "Expand chart");
  btn.dataset.canvas = canvasId;

  btn.addEventListener("click", (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    openExpandedCard(cardEl, canvasId);
  }, { passive:false });

  // Put button exactly inside the card (top-right)
  cardEl.appendChild(btn);
}

function wireExpandButtons(){
  addExpandBtnToCard($("netWorthCard"), "netWorthChart");
  addExpandBtnToCard(document.querySelector(".stake-card"), "stakeChart");
  addExpandBtnToCard(document.querySelector(".reward-card"), "rewardChart");
  addExpandBtnToCard(document.querySelector(".chart-card"), "priceChart");
}
wireExpandButtons();

/* ================= CLOUD (footer + menu meta) ================= */
const CLOUD_VER = 1;
const CLOUD_KEY = `inj_cloud_v${CLOUD_VER}`;
let cloudPts = 0;
let cloudLastSync = 0;

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
function cloudSave(){
  try{
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ v: CLOUD_VER, pts: cloudPts, lastSync: cloudLastSync }));
    return true;
  } catch {
    return false;
  }
}
function cloudEnsureDrawerMeta(){
  const foot = document.querySelector(".drawer-foot");
  if (!foot) return;

  if (foot.querySelector(".drawer-meta")) return;

  const meta = document.createElement("div");
  meta.className = "drawer-meta";
  meta.innerHTML = `
    <div class="drawer-meta-row">
      <span class="drawer-meta-app">INJ Portfolio</span>
      <span class="drawer-meta-dot">•</span>
      <span class="drawer-meta-ver">v${APP_VERSION}</span>
    </div>
    <div class="drawer-meta-row">
      <span class="drawer-meta-cloud" id="drawerCloudStatus">Cloud: —</span>
      <span class="drawer-meta-dot">•</span>
      <span class="drawer-meta-pts" id="drawerCloudPts">0 pts</span>
    </div>
  `;
  foot.appendChild(meta);
}
cloudEnsureDrawerMeta();

function cloudSetState(state){
  const root = $("appRoot");
  const st = $("cloudStatus");
  const dst = $("drawerCloudStatus");
  if (!root) return;

  root.classList.remove("cloud-synced","cloud-saving","cloud-error");

  const isOn = hasInternet();

  if (state === "saving"){
    root.classList.add("cloud-saving");
    if (st) st.textContent = isOn ? "Cloud: Saving" : "Cloud: Offline cache";
    if (dst) dst.textContent = isOn ? "Cloud: Saving" : "Cloud: Offline cache";
    return;
  }
  if (state === "error"){
    root.classList.add("cloud-error");
    if (st) st.textContent = "Cloud: Error";
    if (dst) dst.textContent = "Cloud: Error";
    return;
  }
  root.classList.add("cloud-synced");
  if (st) st.textContent = isOn ? "Cloud: Synced" : "Cloud: Offline cache";
  if (dst) dst.textContent = isOn ? "Cloud: Synced" : "Cloud: Offline cache";
}

function cloudRender(){
  const hist = $("cloudHistory");
  const dpts = $("drawerCloudPts");
  const txt = `${Math.max(0, Math.floor(cloudPts))} pts`;
  if (hist) hist.textContent = `· ${txt}`;
  if (dpts) dpts.textContent = txt;
}

function cloudBump(points = 1){
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
const statusDot  = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

function hasInternet() { return navigator.onLine === true; }

/* ✅ Determine if LIVE is truly "ready" */
function liveReady(){
  const socketsOk = wsTradeOnline && wsKlineOnline;
  const accountOk = !address || accountOnline;
  return socketsOk && accountOk;
}

/* ✅ Status dot logic */
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

let address = localStorage.getItem(ADDR_KEY) || "";
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

searchBtn?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (!searchWrap.classList.contains("open")) openSearch();
  else addressInput?.focus();
}, { passive: false });

addressInput?.addEventListener("focus", () => openSearch(), { passive: true });
addressInput?.addEventListener("input", (e) => { pendingAddress = e.target.value.trim(); }, { passive: true });

addressInput?.addEventListener("keydown", (e) => {
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

themeToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive:false });

/* ================= COMING SOON ================= */
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeComingSoon(); });

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
  if (page !== "dashboard") openComingSoon(page);
  else closeComingSoon();
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

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = {
  price: 0,
  available: 0, stake: 0, rewards: 0,
  apr: 0,
  availableUsd: 0, stakeUsd: 0, rewardsUsd: 0,
  netWorthUsd: 0,
  netWorthInj: 0
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
async function loadAccount(isRefresh=false) {
  if (!isRefresh && !liveMode) return;

  if (!address || !hasInternet()) {
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

  maybeAddStakePoint(stakeInj);
  maybeRecordRewardWithdrawal(rewardsInj);

  // ✅ NW (fixed point) once per account update
  recordNetWorthFixedPoint();

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

/* ================= PRICE CHART (1D) + CACHE ================= */
let chart = null;
let chartLabels = [];
let chartData = [];
let lastChartMinuteStart = 0;
let chartBootstrappedToday = false;

let hoverActive = false;
let hoverIndex = null;
let pinnedIndex = null;
let isPanning = false;

function priceCacheKeyForToday(){
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `inj_price_1m_v${PRICE_CACHE_VER}_${y}-${m}-${day}`;
}
let priceCacheSaveTimer = null;
function priceCacheSave(){
  try{
    const key = priceCacheKeyForToday();
    localStorage.setItem(key, JSON.stringify({
      v: PRICE_CACHE_VER,
      t: Date.now(),
      labels: chartLabels,
      data: chartData,
      lastMinute: lastChartMinuteStart
    }));
  } catch {}
}
function priceCacheSaveSoon(){
  if (priceCacheSaveTimer) return;
  priceCacheSaveTimer = setTimeout(() => {
    priceCacheSaveTimer = null;
    priceCacheSave();
  }, 1200);
}
function priceCacheLoad(){
  try{
    const key = priceCacheKeyForToday();
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== PRICE_CACHE_VER) return false;

    const lbs = Array.isArray(obj.labels) ? obj.labels : [];
    const dat = Array.isArray(obj.data) ? obj.data.map(Number) : [];
    const n = Math.min(lbs.length, dat.length);
    if (n < 5) return false;

    chartLabels = lbs.slice(-DAY_MINUTES);
    chartData = dat.slice(-DAY_MINUTES);
    lastChartMinuteStart = safe(obj.lastMinute) || 0;
    return true;
  } catch {
    return false;
  }
}

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

  const text = `${label} • $${price.toFixed(4)}`;
  chartEl.textContent = text;
  overlay.classList.add("show");

  // HUD when expanded
  if (document.body.classList.contains("card-expanded") && expandedCanvasId === "priceChart"){
    setChartHud(text);
  }
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
  priceCacheSaveSoon();
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
    if (document.body.classList.contains("card-expanded") && expandedCanvasId === "priceChart"){
      setChartHud("");
    }
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
      priceCacheSaveSoon();
    }
    return;
  }

  lastChartMinuteStart = openTime;
  chart.data.labels.push(fmtHHMM(openTime));
  chart.data.datasets[0].data.push(close);

  while (chart.data.labels.length > DAY_MINUTES) chart.data.labels.shift();
  while (chart.data.datasets[0].data.length > DAY_MINUTES) chart.data.datasets[0].data.shift();

  chart.update("none");
  priceCacheSaveSoon();
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

  attachHudForCanvas("stakeChart", () => {
    // show last point if nothing hovered
    const n = stakeData.length;
    if (!n) return "";
    return `Stake • ${safe(stakeData[n-1]).toFixed(6)} INJ`;
  }, (idx) => {
    idx = clamp(idx, 0, stakeData.length - 1);
    const v = safe(stakeData[idx]);
    const lab = stakeLabels[idx] || "";
    return `${lab} • ${v.toFixed(6)} INJ`;
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
      v: Orange = REWARD_WD_LOCAL_VER, t: Date.now(),
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

  attachHudForCanvas("rewardChart", () => {
    const n = wdValues.length;
    if (!n) return "";
    return `Rewards • last +${safe(wdValues[n-1]).toFixed(6)} INJ`;
  }, (idx) => {
    idx = clamp(idx, 0, wdValues.length - 1);
    const v = safe(wdValues[idx]);
    const lab = wdLabels[idx] || "";
    return `${lab} • +${v.toFixed(6)} INJ`;
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

/* ================= NET WORTH (LIVE + fixed calendar TF) ================= */
let nwTf = "live"; // live | 1d | 1w | 1m | 1y | all
let nwScale = "lin"; // lin | log

let nwFixedT = [];
let nwFixedUsd = [];
let nwFixedInj = [];

let nwLiveT = [];
let nwLiveUsd = [];
let nwLiveInj = [];

let netWorthChart = null;
let nwHoverActive = false;
let nwHoverIndex = null;

let nwSaveTimer = null;
function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}
function nwSaveSoon(bumpCloud=false){
  if (!address) return;
  if (nwSaveTimer) return;
  nwSaveTimer = setTimeout(() => {
    nwSaveTimer = null;
    nwSave(bumpCloud);
  }, 1200);
}
function nwSave(bumpCloud=false){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER,
      t: Date.now(),
      tf: nwTf,
      scale: nwScale,
      fixed: { t: nwFixedT, usd: nwFixedUsd, inj: nwFixedInj },
      live:  { t: nwLiveT,  usd: nwLiveUsd,  inj: nwLiveInj  }
    }));
    if (bumpCloud) cloudBump(1);
  } catch {
    cloudSetState("error");
  }
}
function nwLoad(){
  const key = nwStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTf = String(obj.tf || "live");
    if (!["live","1d","1w","1m","1y","all"].includes(nwTf)) nwTf = "live";

    nwScale = (obj.scale === "log") ? "log" : "lin";

    const f = obj.fixed || {};
    nwFixedT = Array.isArray(f.t) ? f.t.map(Number) : [];
    nwFixedUsd = Array.isArray(f.usd) ? f.usd.map(Number) : [];
    nwFixedInj = Array.isArray(f.inj) ? f.inj.map(Number) : [];

    const l = obj.live || {};
    nwLiveT = Array.isArray(l.t) ? l.t.map(Number) : [];
    nwLiveUsd = Array.isArray(l.usd) ? l.usd.map(Number) : [];
    nwLiveInj = Array.isArray(l.inj) ? l.inj.map(Number) : [];

    nwClampAll();
    nwTrimLiveWindow(); // keep only recent 2 min at load
    return true;
  } catch {
    return false;
  }
}
function nwClampAll(){
  const n = Math.min(nwFixedT.length, nwFixedUsd.length, nwFixedInj.length);
  nwFixedT = nwFixedT.slice(-n);
  nwFixedUsd = nwFixedUsd.slice(-n);
  nwFixedInj = nwFixedInj.slice(-n);
  if (nwFixedT.length > NW_MAX_POINTS){
    nwFixedT = nwFixedT.slice(-NW_MAX_POINTS);
    nwFixedUsd = nwFixedUsd.slice(-NW_MAX_POINTS);
    nwFixedInj = nwFixedInj.slice(-NW_MAX_POINTS);
  }

  const n2 = Math.min(nwLiveT.length, nwLiveUsd.length, nwLiveInj.length);
  nwLiveT = nwLiveT.slice(-n2);
  nwLiveUsd = nwLiveUsd.slice(-n2);
  nwLiveInj = nwLiveInj.slice(-n2);
}
function nwTrimLiveWindow(){
  const now = Date.now();
  const minT = now - NW_LIVE_WINDOW_MS - 10_000;
  while (nwLiveT.length && safe(nwLiveT[0]) < minT){
    nwLiveT.shift(); nwLiveUsd.shift(); nwLiveInj.shift();
  }
}
function nwSpanMs(){
  if (nwFixedT.length < 2) return 0;
  return safe(nwFixedT[nwFixedT.length - 1]) - safe(nwFixedT[0]);
}
function nwEnsureLiveButton(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;
  if (wrap.querySelector('.tf-btn[data-tf="live"]')) return;

  const b = document.createElement("button");
  b.className = "tf-btn";
  b.dataset.tf = "live";
  b.type = "button";
  b.textContent = "LIVE";
  wrap.insertBefore(b, wrap.firstChild);
}
function nwUpdateTFVisibility(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  nwEnsureLiveButton();

  const span = nwSpanMs();

  const mapShow = {
    live: true,
    "1d": true,
    "1w": span >= NW_UNLOCK_W_MS,
    "1m": span >= NW_UNLOCK_M_MS,
    "1y": span >= NW_UNLOCK_Y_MS,
    "all": span >= NW_UNLOCK_ALL_MS
  };

  wrap.querySelectorAll(".tf-btn").forEach(btn => {
    const tf = btn.dataset.tf || "";
    const show = !!mapShow[tf];
    btn.style.display = show ? "" : "none";
  });

  // if current is hidden, fallback
  const curBtn = wrap.querySelector(`.tf-btn[data-tf="${nwTf}"]`);
  if (!curBtn || curBtn.style.display === "none"){
    nwTf = "live";
  }

  // active state
  wrap.querySelectorAll(".tf-btn").forEach(btn => {
    btn.classList.toggle("active", (btn.dataset.tf || "") === nwTf);
  });
}
function nwSetScale(next){
  nwScale = (next === "log") ? "log" : "lin";
  const btn = $("nwScaleToggle");
  if (btn) btn.textContent = (nwScale === "log") ? "LOG" : "LIN";
  if (netWorthChart){
    netWorthChart.options.scales.y.type = (nwScale === "log") ? "logarithmic" : "linear";
    netWorthChart.update("none");
  }
  nwSaveSoon(false);
}
$("nwScaleToggle")?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  nwSetScale(nwScale === "lin" ? "log" : "lin");
}, { passive:false });

function startOfDayMs(now){
  const d = new Date(now);
  d.setHours(0,0,0,0);
  return d.getTime();
}
function startOfWeekMs(now){
  const d = new Date(now);
  d.setHours(0,0,0,0);
  // monday start
  const day = (d.getDay() + 6) % 7; // monday=0
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function startOfMonthMs(now){
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function startOfYearMs(now){
  const d = new Date(now);
  return new Date(d.getFullYear(), 0, 1).getTime();
}
function endOfMonthMs(now){
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}
function endOfYearMs(now){
  const d = new Date(now);
  return new Date(d.getFullYear() + 1, 0, 1).getTime();
}

function nwBounds(tf){
  const now = Date.now();
  if (tf === "live") return [now - NW_LIVE_WINDOW_MS, now];
  if (tf === "1d")  return [startOfDayMs(now), startOfDayMs(now) + 24*60*60*1000];
  if (tf === "1w")  return [startOfWeekMs(now), startOfWeekMs(now) + 7*24*60*60*1000];
  if (tf === "1m")  return [startOfMonthMs(now), endOfMonthMs(now)];
  if (tf === "1y")  return [startOfYearMs(now), endOfYearMs(now)];
  // all
  const a = nwFixedT.length ? safe(nwFixedT[0]) : now;
  const b = nwFixedT.length ? safe(nwFixedT[nwFixedT.length - 1]) : now;
  return [Math.min(a,b), Math.max(a,b)];
}

function nwFormatTick(v){
  const tf = nwTf;
  const ms = safe(v);
  if (!ms) return "";
  if (tf === "live") return fmtHHMMSS(ms);
  if (tf === "1d") return fmtHHMM(ms);
  if (tf === "1w") {
    const d = new Date(ms);
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${pad2(d.getHours())}:00`;
  }
  if (tf === "1m") {
    const d = new Date(ms);
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}`;
  }
  if (tf === "1y") {
    const d = new Date(ms);
    return `${pad2(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}`;
  }
  // all
  return fmtHHMM(ms);
}

function nwBuildView(){
  const [minX, maxX] = nwBounds(nwTf);
  const pts = [];

  if (nwTf === "live"){
    for (let i = 0; i < nwLiveT.length; i++){
      const t = safe(nwLiveT[i]);
      const u = safe(nwLiveUsd[i]);
      if (t >= minX && t <= maxX && u > 0) pts.push({ x: t, y: u });
    }
  } else {
    for (let i = 0; i < nwFixedT.length; i++){
      const t = safe(nwFixedT[i]);
      const u = safe(nwFixedUsd[i]);
      if (t >= minX && t <= maxX && u > 0) pts.push({ x: t, y: u });
    }
  }

  // always sorted by time
  pts.sort((a,b) => a.x - b.x);
  return { minX, maxX, pts };
}

/* ✅ Pro: vertical line while interacting */
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
    if (!ds || !Array.isArray(ds.data) || !ds.data.length) return;

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

  const view = nwBuildView();

  netWorthChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        data: view.pts,
        parsing: false,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.12)",
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        pointHitRadius: 18,
        spanGaps: true,
        clip: { left: 0, top: 0, right: 26, bottom: 0 }
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
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: view.minX,
          max: view.maxX,
          ticks: {
            color: axisTickColor(),
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            callback: (v) => nwFormatTick(v)
          },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          type: (nwScale === "log") ? "logarithmic" : "linear",
          position: "right",
          ticks: {
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
  nwUpdateTFVisibility();
  nwSetScale(nwScale);
  nwRedraw(true);
}

function nwUpdatePnlFromView(view){
  const pnlEl = $("netWorthPnl");
  if (!pnlEl) return;

  const pts = view?.pts || [];
  if (pts.length >= 2){
    const first = safe(pts[0].y);
    const last  = safe(pts[pts.length - 1].y);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    pnlEl.classList.remove("good","bad","flat");
    const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
    pnlEl.classList.add(cls);

    const sign = pnl > 0 ? "+" : "";
    const label = (nwTf === "live") ? "PnL (LIVE)" : `PnL (${nwTf.toUpperCase()})`;
    pnlEl.textContent = `${label}: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
  } else {
    pnlEl.classList.remove("good","bad");
    pnlEl.classList.add("flat");
    pnlEl.textContent = "PnL: —";
  }
}

function nwRedraw(force=false){
  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  const view = nwBuildView();

  netWorthChart.data.datasets[0].data = view.pts;
  netWorthChart.options.scales.x.min = view.minX;
  netWorthChart.options.scales.x.max = view.maxX;

  // more ticks in expanded mode
  const expanded = document.body.classList.contains("card-expanded") && expandedCanvasId === "netWorthChart";
  netWorthChart.options.scales.x.ticks.maxTicksLimit = expanded ? 10 : 6;

  netWorthChart.update("none");
  if (force) netWorthChart.draw();

  nwUpdateTFVisibility();
  nwUpdatePnlFromView(view);
}

/* ✅ Interaction: hover/touch shows point value (and HUD when expanded) */
function nwGetIndexFromEvent(evt){
  if (!netWorthChart) return null;
  const pts = netWorthChart.getElementsAtEventForMode(evt, "nearest", { intersect: false }, false);
  if (!pts || !pts.length) return null;
  return pts[0].index;
}

function nwShowHoverValue(idx){
  if (!netWorthChart) return;
  const ds = netWorthChart.data.datasets?.[0]?.data || [];
  idx = clamp(idx, 0, ds.length - 1);
  const p = ds[idx];
  if (!p) return;

  const v = safe(p.y);
  const t = safe(p.x);

  const lab = (nwTf === "live") ? fmtHHMMSS(t) : fmtHHMM(t);
  const text = `${lab} • $${v.toFixed(2)}`;

  // if not expanded, temporarily override the top value
  const el = $("netWorthUsd");
  if (el && !(document.body.classList.contains("card-expanded") && expandedCanvasId === "netWorthChart")){
    el.textContent = `$${v.toFixed(2)}`;
  }

  // HUD in expanded
  if (document.body.classList.contains("card-expanded") && expandedCanvasId === "netWorthChart"){
    setChartHud(text);
  }

  // show point label in pnl line
  const pnlEl = $("netWorthPnl");
  if (pnlEl){
    pnlEl.classList.remove("good","bad","flat");
    pnlEl.classList.add("flat");
    pnlEl.textContent = `Point: ${text}`;
  }
}

function nwRestoreRealtimeLabel(){
  nwHoverActive = false;
  nwHoverIndex = null;
  if (document.body.classList.contains("card-expanded") && expandedCanvasId === "netWorthChart"){
    setChartHud("");
  }
  // restore pnl line
  nwUpdatePnlFromView(nwBuildView());
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
    nwRestoreRealtimeLabel();
    netWorthChart.update("none");
  };

  canvas.addEventListener("mousemove", onMove, { passive: true });
  canvas.addEventListener("mouseleave", onLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => onMove(e), { passive: true });
  canvas.addEventListener("touchend", onLeave, { passive: true });
  canvas.addEventListener("touchcancel", onLeave, { passive: true });
}

/* TF buttons */
function attachNWTFHandlers(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  nwEnsureLiveButton();
  nwUpdateTFVisibility();

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "live";
    if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;

    nwTf = tf;
    wrap.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", (b.dataset.tf || "") === tf));
    nwSaveSoon(false);
    nwRedraw(true);
  }, { passive:true });
}

/* Record points */
let nwLastFixedT = 0;
let nwLastFixedUsd = 0;

function recordNetWorthFixedPoint(){
  if (!address) return;
  const px = safe(targetPrice || displayed.price);
  if (!Number.isFinite(px) || px <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;

  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

  const now = Date.now();
  const dt = now - safe(nwLastFixedT);
  const dUsd = Math.abs(totalUsd - safe(nwLastFixedUsd));

  if (nwLastFixedT && dt < NW_FIXED_MIN_DT_MS && dUsd < NW_FIXED_MIN_DUSD) return;

  nwFixedT.push(now);
  nwFixedUsd.push(totalUsd);
  nwFixedInj.push(totalInj);
  nwClampAll();

  nwLastFixedT = now;
  nwLastFixedUsd = totalUsd;

  nwSaveSoon(true);
  if (nwTf !== "live") nwRedraw(false);
  nwUpdateTFVisibility();
}

let nwLastLiveT = 0;
let nwLastLiveUsd = 0;

function recordNetWorthLivePoint(){
  if (!address) return;
  const px = safe(targetPrice || displayed.price);
  if (!Number.isFinite(px) || px <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * px;
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return;

  const now = Date.now();
  const dt = now - safe(nwLastLiveT);
  const dUsd = Math.abs(totalUsd - safe(nwLastLiveUsd));

  if (nwLastLiveT && dt < NW_LIVE_MIN_DT_MS && dUsd < NW_LIVE_MIN_DUSD) return;

  nwLiveT.push(now);
  nwLiveUsd.push(totalUsd);
  nwLiveInj.push(totalInj);
  nwTrimLiveWindow();
  nwClampAll();

  nwLastLiveT = now;
  nwLastLiveUsd = totalUsd;

  // save live less aggressively (no cloud bump)
  nwSaveSoon(false);

  if (nwTf === "live") nwRedraw(false);
}

/* ================= HUD wiring for charts in expanded mode ================= */
function attachHudForCanvas(canvasId, fallbackTextFn, fmtByIndexFn){
  const canvas = $(canvasId);
  if (!canvas) return;

  const getChart = () => {
    if (canvasId === "stakeChart") return stakeChart;
    if (canvasId === "rewardChart") return rewardChart;
    if (canvasId === "netWorthChart") return netWorthChart;
    if (canvasId === "priceChart") return chart;
    return null;
  };

  const getIndex = (ch, evt) => {
    if (!ch) return null;
    const pts = ch.getElementsAtEventForMode(evt, "nearest", { intersect: false }, false);
    if (!pts || !pts.length) return null;
    return pts[0].index;
  };

  const onMove = (evt) => {
    if (!(document.body.classList.contains("card-expanded") && expandedCanvasId === canvasId)) return;
    const ch = getChart();
    if (!ch) return;
    const idx = getIndex(ch, evt);
    if (idx == null) {
      const fb = fallbackTextFn ? fallbackTextFn() : "";
      if (fb) setChartHud(fb);
      return;
    }
    const txt = fmtByIndexFn ? fmtByIndexFn(idx) : "";
    if (txt) setChartHud(txt);
  };

  const onLeave = () => {
    if (!(document.body.classList.contains("card-expanded") && expandedCanvasId === canvasId)) return;
    setChartHud("");
  };

  canvas.addEventListener("mousemove", onMove, { passive:true });
  canvas.addEventListener("touchmove", onMove, { passive:true });
  canvas.addEventListener("touchstart", onMove, { passive:true });
  canvas.addEventListener("mouseleave", onLeave, { passive:true });
  canvas.addEventListener("touchend", onLeave, { passive:true });
  canvas.addEventListener("touchcancel", onLeave, { passive:true });
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  pendingAddress = a;
  localStorage.setItem(ADDR_KEY, address);

  setAddressDisplay(address);
  settleStart = Date.now();

  // reset runtime values (but charts reload from storage)
  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  displayed.available = 0; displayed.stake = 0; displayed.rewards = 0;
  displayed.availableUsd = 0; displayed.stakeUsd = 0; displayed.rewardsUsd = 0;
  displayed.netWorthUsd = 0; displayed.netWorthInj = 0;
  displayed.apr = 0;

  // stake series
  if (RESET_STAKE_FROM_NOW_ON_BOOT) {
    clearStakeSeriesStorage();
    resetStakeSeriesFromNow();
  } else {
    stakeLabels = []; stakeData = []; stakeMoves = []; stakeTypes = [];
    stakeBaselineCaptured = false;
    lastStakeRecordedRounded = null;
    loadStakeSeries();
    drawStakeChart();
  }

  // reward series
  wdLastRewardsSeen = null;
  wdMinFilter = safe($("rewardFilter")?.value || 0);
  wdLabelsAll = []; wdValuesAll = []; wdTimesAll = [];
  loadWdAll();
  rebuildWdView();
  goRewardLive();

  // net worth series
  nwFixedT = []; nwFixedUsd = []; nwFixedInj = [];
  nwLiveT = [];  nwLiveUsd = [];  nwLiveInj = [];
  nwLastFixedT = 0; nwLastFixedUsd = 0;
  nwLastLiveT = 0;  nwLastLiveUsd = 0;

  nwLoad();
  attachNWTFHandlers();
  nwSetScale(nwScale);
  nwUpdateTFVisibility();
  nwRedraw(true);

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

/* ================= BOOT ================= */
(async function boot() {
  cloudLoad();
  cloudRender();
  cloudSetState("synced");
  cloudEnsureDrawerMeta();

  refreshConnUI();
  setTimeout(() => setUIReady(true), 2800);

  attachRewardTimelineHandlers();
  attachRewardLiveHandler();
  attachRewardFilterHandler();
  attachNWTFHandlers();

  pendingAddress = address || "";
  if (addressInput) addressInput.value = pendingAddress;
  setAddressDisplay(address);

  wdMinFilter = safe($("rewardFilter")?.value || 0);

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  // load cached price chart first (so it never starts from 0)
  if (priceCacheLoad()){
    if (!chart) initChartToday();
    if (chart) {
      chart.data.labels = chartLabels;
      chart.data.datasets[0].data = chartData;
      chart.update("none");
      chartBootstrappedToday = true;
      const last = safe(chartData[chartData.length - 1]);
      if (!targetPrice && last) targetPrice = last;
    }
  }

  // stake/reward/networth from storage
  if (address && RESET_STAKE_FROM_NOW_ON_BOOT) {
    clearStakeSeriesStorage();
    resetStakeSeriesFromNow();
  } else {
    loadStakeSeries();
    drawStakeChart();
  }

  if (address) {
    loadWdAll();
    rebuildWdView();
    goRewardLive();
  }

  if (address) nwLoad();
  nwUpdateTFVisibility();
  nwSetScale(nwScale);
  nwRedraw(true);

  modeLoading = true;
  refreshConnUI();

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

  const aUsd = displayed.available * displayed.price;
  const oaUsd = displayed.availableUsd;
  displayed.availableUsd = tick(displayed.availableUsd, aUsd);
  colorApproxMoney($("availableUsd"), displayed.availableUsd, oaUsd, 2);

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);

  const sUsd = displayed.stake * displayed.price;
  const osUsd = displayed.stakeUsd;
  displayed.stakeUsd = tick(displayed.stakeUsd, sUsd);
  colorApproxMoney($("stakeUsd"), displayed.stakeUsd, osUsd, 2);

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

  const rUsd = displayed.rewards * displayed.price;
  const orUsd = displayed.rewardsUsd;
  displayed.rewardsUsd = tick(displayed.rewardsUsd, rUsd);
  colorApproxMoney($("rewardsUsd"), displayed.rewardsUsd, orUsd, 2);

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

  // APR (digit anim)
  const oapr = displayed.apr;
  displayed.apr = tick(displayed.apr, apr);
  colorNumberSuffix($("apr"), displayed.apr, oapr, 2, "%");

  // Last update bottom
  setText("updated", "Last update: " + nowLabel());

  /* ================= NET WORTH ================= */
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  // top value (only if not hovering the chart)
  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);
  }

  // total INJ (animated)
  const onwInj = displayed.netWorthInj;
  displayed.netWorthInj = tick(displayed.netWorthInj, totalInj);
  const injEl = $("netWorthInj");
  if (injEl) colorNumberSuffix(injEl, displayed.netWorthInj, onwInj, 4, " INJ");

  // LIVE series (always collected per address) + redraw only when LIVE selected
  recordNetWorthLivePoint();

  // keep blinking dot fluid
  if (netWorthChart) netWorthChart.draw();

  refreshConnUI();
  requestAnimationFrame(animate);
}
animate();
