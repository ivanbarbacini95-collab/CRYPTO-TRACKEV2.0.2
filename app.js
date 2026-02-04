/* =========================================================
   Injective Portfolio • v2.0.2
   app.js — FULL FILE
   ========================================================= */

/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const DEFAULT_STAKE_TARGET_MAX = 1000;
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* persistence versions */
const STAKE_LOCAL_VER = 3;
const REWARD_WD_LOCAL_VER = 2;
const NW_LOCAL_VER = 2;
const EV_LOCAL_VER = 1;

const NW_MAX_POINTS = 4800;
const NW_LIVE_WINDOW_MS = 2 * 60 * 1000;

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

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtHHMMSS(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }

function tsLabel(ms = Date.now()) { return String(Math.floor(ms)); }
function labelToTs(lbl) {
  if (lbl == null) return 0;
  const s = String(lbl).trim();
  if (/^\d{10,13}$/.test(s)) return safe(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function nowLabel() { return new Date().toLocaleTimeString(); }
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

function hasInternet() { return navigator.onLine === true; }

/* ================= GLOBAL ERROR GUARDS ================= */
function setStatusError(msg){
  const statusText = $("statusText");
  const statusDot = $("statusDot");
  if (statusText) statusText.textContent = msg || "Error";
  if (statusDot) statusDot.style.background = "#ef4444";
}
window.addEventListener("error", (e) => { setStatusError("JS Error"); console.error(e?.error || e); });
window.addEventListener("unhandledrejection", (e) => { setStatusError("Promise Error"); console.error(e?.reason || e); });

/* ================= THEME / MODE ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY  = "inj_mode"; // live | refresh

let theme = localStorage.getItem(THEME_KEY) || "dark";
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";

function axisGridColor() { return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.14)" : "rgba(249,250,251,.10)"; }
function axisTickColor() { return (document.body.dataset.theme === "light") ? "rgba(15,23,42,.65)" : "rgba(249,250,251,.60)"; }

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
const statusDot  = $("statusDot");
const statusText = $("statusText");

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
async function fetchJSON(url, opts = {}) {
  try {
    const res = await fetch(url, { cache: "no-store", ...opts });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
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

/* ================= COLORED DIGITS ================= */
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
function flash(el) { if (!el) return; el.classList.remove("flash-yellow"); void el.offsetWidth; el.classList.add("flash-yellow"); }

/* ================= ADDRESS / SEARCH ================= */
const searchWrap = $("searchWrap");
const searchBtn = $("searchBtn");
const addressInput = $("addressInput");
const addressDisplay = $("addressDisplay");
const menuBtn = $("menuBtn");
const copyAddressBtn = $("copyAddressBtn");

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

if (addressInput) addressInput.value = "";

if (searchBtn) {
  searchBtn.addEventListener("click", (e) => {
    e?.preventDefault?.(); e?.stopPropagation?.();
    if (!searchWrap.classList.contains("open")) openSearch();
    else addressInput?.focus();
  }, { passive: false });
}

if (addressInput) {
  addressInput.addEventListener("focus", () => openSearch(), { passive: true });
  addressInput.addEventListener("input", (e) => { pendingAddress = e.target.value.trim(); }, { passive: true });
  addressInput.addEventListener("keydown", async (e) => {
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
}

document.addEventListener("click", (e) => {
  if (!searchWrap) return;
  if (searchWrap.contains(e.target)) return;
  closeSearch();
}, { passive: true });

/* copy address */
function showCopyToast(){
  pushEvent({ kind:"system", title:"Copied", detail:"Wallet address copied.", status:"ok" });
}
copyAddressBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!address) return;
  try{
    await navigator.clipboard.writeText(address);
    showCopyToast();
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = address;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showCopyToast(); } catch {}
    document.body.removeChild(ta);
  }
}, { passive:false });

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

menuBtn?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); toggleDrawer(); }, { passive:false });
backdrop?.addEventListener("click", () => closeDrawer(), { passive:true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeDrawer();
    closeComingSoon();
    exitFullscreenCard();
    hideRangeModal("stake");
    hideRangeModal("reward");
  }
});

themeToggle?.addEventListener("click", (e) => {
  e.preventDefault();
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
  if (key === "settings") return "SETTINGS";
  if (key === "tools") return "TOOL’S";
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
comingClose?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeComingSoon(); }, { passive:false });
comingSoon?.addEventListener("click", (e) => { if (e.target === comingSoon) closeComingSoon(); }, { passive:true });

/* ================= PAGES ================= */
const pageDashboard = $("pageDashboard");
const pageEvents = $("pageEvents");
function showPage(key){
  pageDashboard?.classList.remove("active");
  pageEvents?.classList.remove("active");
  if (key === "events") pageEvents?.classList.add("active");
  else pageDashboard?.classList.add("active");
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
  } else if (page === "event" || page === "events") {
    closeComingSoon();
    showPage("events");
    renderEvents();
  } else {
    showPage("dashboard");
    openComingSoon(page);
  }
}, { passive:true });

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
  const tools = card.querySelector(".card-tools");
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

function enterFullscreenCard(card){
  if (!card) return;
  if (expandedCard) exitFullscreenCard();
  expandedCard = card;

  buildExpandedBackdrop();
  expandedBackdrop.style.display = "block";

  document.body.classList.add("card-expanded");
  card.classList.add("fullscreen");
  hideNonChartContent(card);

  setTimeout(() => {
    try { chartPrice?.resize?.(); } catch {}
    try { stakeChart?.resize?.(); } catch {}
    try { rewardChart?.resize?.(); } catch {}
    try { netWorthChart?.resize?.(); } catch {}
    try { aprChart?.resize?.(); } catch {}
  }, 120);
}

function exitFullscreenCard(){
  if (!expandedCard) return;
  restoreNonChartContent(expandedCard);
  expandedCard.classList.remove("fullscreen");
  document.body.classList.remove("card-expanded");
  expandedBackdrop && (expandedBackdrop.style.display = "none");
  expandedCard = null;

  setTimeout(() => {
    try { chartPrice?.resize?.(); } catch {}
    try { stakeChart?.resize?.(); } catch {}
    try { rewardChart?.resize?.(); } catch {}
    try { netWorthChart?.resize?.(); } catch {}
    try { aprChart?.resize?.(); } catch {}
  }, 120);
}

function bindExpandButtons(){
  const btns = document.querySelectorAll(".card-expand");
  btns.forEach(btn => {
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
function evStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_events_v${EV_LOCAL_VER}_${a}` : null;
}
function loadEvents(){
  const key = evStoreKey(address);
  if (!key) { eventsAll = []; return; }
  try{
    const raw = localStorage.getItem(key);
    if (!raw) { eventsAll = []; return; }
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj?.events)) { eventsAll = []; return; }
    eventsAll = obj.events.slice(0, 1200);
  } catch { eventsAll = []; }
}
function saveEvents(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EV_LOCAL_VER, t: Date.now(), events: eventsAll.slice(0, 1200) }));
  } catch {}
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
  setTimeout(() => { try { host.removeChild(el); } catch {} }, 2600);
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
    status: ev.status || "pending"
  };
  eventsAll.unshift(obj);
  eventsAll = eventsAll.slice(0, 1200);
  saveEvents();
  renderEvents();
  showToast(obj);

  if (obj.status === "pending" && obj.kind !== "price") {
    setTimeout(() => {
      const idx = eventsAll.findIndex(x => x.id === obj.id);
      if (idx >= 0) {
        eventsAll[idx].status = hasInternet() ? "ok" : "err";
        saveEvents();
        renderEvents();
      }
    }, 1400);
  }
}

function renderEvents(){
  const body = $("eventsTbody");
  const empty = $("eventsEmpty");
  if (!body) return;

  body.innerHTML = "";
  const list = eventsAll || [];

  if (empty) empty.style.display = list.length ? "none" : "block";
  if (!list.length) return;

  for (const ev of list){
    const tr = document.createElement("tr");
    const dt = new Date(ev.ts || Date.now());
    const when = `${dt.toLocaleDateString()} ${fmtHHMMSS(ev.ts || Date.now())}`;
    const kind = String(ev.kind || "info").toUpperCase();
    const st = ev.status === "ok" ? "OK" : ev.status === "err" ? "ERR" : "…";

    tr.innerHTML = `
      <td>${kind}</td>
      <td style="white-space:nowrap">${when}</td>
      <td>${ev.detail || ev.title || ""}</td>
      <td style="font-weight:900">${st}</td>
    `;
    body.appendChild(tr);
  }
}

$("eventsClearBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  eventsAll = [];
  saveEvents();
  renderEvents();
}, { passive:false });

/* ================= MODE SWITCH ================= */
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
  accountPollTimer = setInterval(loadAccount, ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(loadCandleSnapshot, REST_SYNC_MS);
  chartSyncTimer = setInterval(loadPriceTF, CHART_SYNC_MS);
  ensureChartTimer = setInterval(ensureChartBootstrapped, 1500);
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
    await loadPriceTF(true);
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
    loadPriceTF();
    if (address) loadAccount();
    startAllTimers();
    refreshConnUI();
  }
}

liveToggle?.addEventListener("click", (e) => { e.preventDefault(); setMode(!liveMode); }, { passive:false });

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0, netWorthUsd: 0, apr: 0 };

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
function scheduleTradeRetry() { clearTradeRetry(); tradeRetryTimer = setTimeout(() => { if (liveMode) startTradeWS(); }, 1200); }

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
function scheduleKlineRetry() { clearKlineRetry(); klineRetryTimer = setTimeout(() => { if (liveMode) startKlineWS(); }, 1200); }

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
      // keep 1D price chart live-updated when TF=1D
      updatePriceFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    setUIReady(false);
  };
}

/* ================= ACCOUNT + VALIDATOR ================= */
let validator = { addr: "", moniker: "", status: "unknown" };
let validatorLoading = false;

function setValidatorUI(state){
  const nameEl = $("validatorName");
  const dotEl  = $("validatorDot");

  if (nameEl) nameEl.textContent = validator.moniker || "Validator";
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
  if (validator.status === "bonded" || validator.status === "active") dotEl.style.background = "#22c55e";
  else if (validator.status === "unbonded" || validator.status === "jailed") dotEl.style.background = "#ef4444";
  else dotEl.style.background = "#f59e0b";
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

/* ================= PRICE CHART (TF + LIN/LOG + 5m) ================= */
let chartPrice = null;
let priceLabelsAll = [];
let priceDataAll = [];
let priceTimesAll = [];
let priceTF = "1d";          // 1d|1w|1m|1y|all
let priceScale = "linear";   // linear|log
let price5mView = false;

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

function updatePinnedOverlay() {
  const overlay = $("chartOverlay");
  const chartEl = $("chartPrice");
  if (!overlay || !chartEl || !chartPrice) return;

  if (pinnedIndex == null) {
    overlay.classList.remove("show");
    chartEl.textContent = "--";
    return;
  }

  const ds = chartPrice.data.datasets?.[0]?.data || [];
  const lbs = chartPrice.data.labels || [];
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

  chartPrice = new Chart(canvas, {
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
          type: priceScale === "log" ? "logarithmic" : "linear",
          ticks: { color: axisTickColor() },
          grid: { color: axisGridColor() }
        }
      }
    },
    plugins: [verticalLinePlugin]
  });

  setupPriceInteractions();
}

function priceTFConfig(tf){
  // returns { interval, limit }
  if (tf === "1d") return { interval:"1m", limit: 1440 };
  if (tf === "1w") return { interval:"15m", limit: 7*24*4 };   // 672
  if (tf === "1m") return { interval:"1h", limit: 30*24 };     // 720
  if (tf === "1y") return { interval:"4h", limit: 365*6 };     // 2190 -> binance max 1000 per call, we cap later
  return { interval:"1d", limit: 1000 }; // all
}

async function fetchKlines(interval, limit){
  const cap = Math.min(1000, Math.max(1, Math.floor(limit)));
  const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=${cap}`;
  const d = await fetchJSON(url);
  return Array.isArray(d) ? d : [];
}

function buildPriceSeriesFromKlines(kl){
  const times = kl.map(x => safe(x[0]));
  const data = kl.map(x => safe(x[4]));
  const labels = times.map(t => fmtHHMM(t));
  return { times, data, labels };
}

function applyPriceView(){
  if (!chartPrice) initPriceChart();
  if (!chartPrice) return;

  // filter 5m view: only when TF=1d and interval is 1m
  let labels = priceLabelsAll.slice();
  let data = priceDataAll.slice();
  let times = priceTimesAll.slice();

  if (price5mView && priceTF === "1d" && data.length > 0){
    const n = data.length;
    const from = Math.max(0, n - 5);
    labels = labels.slice(from);
    data = data.slice(from);
    times = times.slice(from);
  }

  chartPrice.data.labels = labels;
  chartPrice.data.datasets[0].data = data;
  chartPrice.options.scales.y.type = (priceScale === "log") ? "logarithmic" : "linear";
  chartPrice.update("none");
}

async function loadPriceTF(isRefresh=false){
  if (!isRefresh && !liveMode) return;
  if (!hasInternet()) return;

  const cfg = priceTFConfig(priceTF);
  let kl = await fetchKlines(cfg.interval, cfg.limit);

  // for 1y we may want more than 1000 points: we keep last 1000 (ok for now)
  if (!kl.length) return;

  const { times, data, labels } = buildPriceSeriesFromKlines(kl);
  priceTimesAll = times;
  priceDataAll = data;
  priceLabelsAll = labels;

  // update targetPrice on first load
  const last = safe(data[data.length - 1]);
  if (!targetPrice && last) targetPrice = last;

  applyPriceView();
  setUIReady(true);
}

function setupPriceInteractions() {
  const canvas = $("priceChart");
  if (!canvas || !chartPrice) return;

  const getIndexFromEvent = (evt) => {
    const points = chartPrice.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
    if (!points || !points.length) return null;
    return points[0].index;
  };

  const handleMove = (evt) => {
    if (!chartPrice) return;
    if (isPanning) return;

    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverActive = true;
    hoverIndex = idx;
    pinnedIndex = idx;

    updatePinnedOverlay();
    chartPrice.update("none");
  };

  const handleLeave = () => {
    hoverActive = false;
    hoverIndex = null;
    pinnedIndex = null;
    updatePinnedOverlay();
    if (chartPrice) chartPrice.update("none");
  };

  canvas.addEventListener("mousemove", handleMove, { passive: true });
  canvas.addEventListener("mouseleave", handleLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => handleMove(e), { passive: true });
  canvas.addEventListener("touchend", handleLeave, { passive: true });
  canvas.addEventListener("touchcancel", handleLeave, { passive: true });
}

function updatePriceFrom1mKline(k) {
  // live update only when TF is 1d and not in refresh mode
  if (!liveMode) return;
  if (priceTF !== "1d") return;
  if (!chartPrice || !priceTimesAll.length) return;

  const openTime = safe(k.t);
  const close = safe(k.c);
  if (!openTime || !close) return;

  const lastT = safe(priceTimesAll[priceTimesAll.length - 1]);
  if (openTime === lastT){
    priceDataAll[priceDataAll.length - 1] = close;
    priceLabelsAll[priceLabelsAll.length - 1] = fmtHHMM(openTime);
  } else if (openTime > lastT){
    priceTimesAll.push(openTime);
    priceDataAll.push(close);
    priceLabelsAll.push(fmtHHMM(openTime));
    while (priceDataAll.length > DAY_MINUTES){ priceTimesAll.shift(); priceDataAll.shift(); priceLabelsAll.shift(); }
  } else {
    return;
  }

  applyPriceView();
}

function bindPriceTFButtons(){
  const wrap = $("priceTfSwitch");
  if (!wrap) return;
  wrap.addEventListener("click", async (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["1d","1w","1m","1y","all"].includes(tf)) return;

    priceTF = tf;
    price5mView = false;
    const b5 = $("price5mBtn");
    if (b5) b5.classList.remove("active");

    wrap.querySelectorAll(".tf-btn").forEach(b => b.classList.toggle("active", b.dataset.tf === tf));
    await loadPriceTF(true);
  }, { passive:true });

  $("priceScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    priceScale = (priceScale === "log") ? "linear" : "log";
    const b = $("priceScaleToggle");
    if (b) b.textContent = (priceScale === "log") ? "LOG" : "LIN";
    applyPriceView();
  }, { passive:false });

  $("price5mBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    price5mView = !price5mView;
    const b = $("price5mBtn");
    if (b) b.classList.toggle("active", price5mView);
    applyPriceView();
  }, { passive:false });
}

/* ================= STAKE CHART (TF + LIN/LOG) ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;

let stakeTf = "all";          // all|1d|1w|1m
let stakeScale = "linear";    // linear|log

const STAKE_TARGET_KEY = "inj_stake_target_max";
function getStakeTargetMax(){
  const v = safe(localStorage.getItem(STAKE_TARGET_KEY));
  return v > 0 ? v : DEFAULT_STAKE_TARGET_MAX;
}
function setStakeTargetMax(v){
  v = safe(v);
  if (!v) localStorage.removeItem(STAKE_TARGET_KEY);
  else localStorage.setItem(STAKE_TARGET_KEY, String(v));
}

function stakeStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_stake_series_v${STAKE_LOCAL_VER}_${a}` : null;
}
function clampArray(arr, max) { if (!Array.isArray(arr)) return []; return arr.length <= max ? arr : arr.slice(arr.length - max); }

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

function stakeWindowMs(tf){
  if (tf === "1d") return 24*60*60*1000;
  if (tf === "1w") return 7*24*60*60*1000;
  if (tf === "1m") return 30*24*60*60*1000;
  return 10*365*24*60*60*1000;
}
function buildStakeView(){
  const now = Date.now();
  const minT = (stakeTf === "all") ? 0 : (now - stakeWindowMs(stakeTf));
  const L = [], D = [], M = [], T = [];
  for (let i=0;i<stakeLabels.length;i++){
    const ts = labelToTs(stakeLabels[i]);
    if (!ts) continue;
    if (ts < minT) continue;
    L.push(stakeLabels[i]);
    D.push(safe(stakeData[i]));
    M.push(safe(stakeMoves[i]));
    T.push(String(stakeTypes[i] || "Stake update"));
  }
  return { labels:L, data:D, moves:M, types:T };
}

function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  const view = buildStakeView();

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
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: (ctx) => (view.moves[ctx.dataIndex] || 0) < 0 ? "#ef4444" : "#22c55e",
        pointBorderColor: (ctx) => (view.moves[ctx.dataIndex] || 0) < 0 ? "rgba(239,68,68,.95)" : "rgba(34,197,94,.90)",
        pointBorderWidth: 1
      }]
   },
options: {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  normalized: true,

  scales: {
    x: {
      type: 'time',
      time: {
        unit: 'minute',
        tooltipFormat: 'dd/MM HH:mm'
      },
      ticks: {
        maxRotation: 0,
        autoSkip: true,
        color: 'rgba(150,150,150,.6)'
      },
      grid: {
        display: false
      }
    },

    y: {
      type: 'linear', // 👈 verrà switchato LIN / LOG
      beginAtZero: false,
      ticks: {
        color: 'rgba(150,150,150,.7)',
        callback: v => v.toLocaleString()
      },
      grid: {
        color: 'rgba(255,255,255,.05)'
      }
    }
  },

  plugins: {
    legend: { display: false },

    tooltip: {
      enabled: true,
      displayColors: false,
      callbacks: {
        title: (items) => {
          const d = items[0].parsed.x
          return new Date(d).toLocaleString()
        },
        label: (item) => {
          return item.parsed.y.toLocaleString()
        }
      }
    }
  },

  elements: {
    line: {
      borderWidth: 2,
      tension: 0.35
    },
    point: {
      radius: ctx => {
        const i = ctx.dataIndex
        const len = ctx.dataset.data.length - 1
        return i === len ? 4 : 0
      },
      backgroundColor: ctx => {
        const i = ctx.dataIndex
        const len = ctx.dataset.data.length - 1
        return i === len ? '#22c55e' : 'transparent'
      }
    }
  }
}
