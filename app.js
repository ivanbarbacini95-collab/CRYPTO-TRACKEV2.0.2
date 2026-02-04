/* =========================================================
   Injective Portfolio • v2.1.0
   app.js — ALL IMPROVEMENTS INCLUDED
   ========================================================= */

/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;
const REWARD_WITHDRAW_THRESHOLD = 0.0002;

/* persistence versions */
const STAKE_LOCAL_VER = 4;
const REWARD_WD_LOCAL_VER = 3;
const NW_LOCAL_VER = 3;
const EV_LOCAL_VER = 2;
const APR_LOCAL_VER = 1;

/* net worth limits */
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

window.addEventListener("error", (e) => {
  setStatusError("JS Error");
  console.error("JS Error:", e?.error || e);
});
window.addEventListener("unhandledrejection", (e) => {
  setStatusError("Promise Error");
  console.error("Promise Error:", e?.reason || e);
});

/* ================= THEME / MODE / PRIVACY ================= */
const THEME_KEY = "inj_theme";
const MODE_KEY  = "inj_mode";
const PRIVACY_KEY = "inj_privacy";

let theme = localStorage.getItem(THEME_KEY) || "dark";
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";
let privacyMode = localStorage.getItem(PRIVACY_KEY) === "true";

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

function applyPrivacyMode(enable){
  privacyMode = enable;
  localStorage.setItem(PRIVACY_KEY, enable);
  if (enable) {
    document.body.classList.add("privacy-mode");
    if ($("privacyIcon")) $("privacyIcon").textContent = "🙈";
    if ($("privacyLabel")) $("privacyLabel").textContent = "Hide";
  } else {
    document.body.classList.remove("privacy-mode");
    if ($("privacyIcon")) $("privacyIcon").textContent = "👁️";
    if ($("privacyLabel")) $("privacyLabel").textContent = "Show";
  }
}

/* ================= CHARTJS ZOOM REGISTER ================= */
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
  } catch (e) {
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
function flash(el) {
  if (!el) return;
  el.classList.remove("flash-yellow");
  void el.offsetWidth;
  el.classList.add("flash-yellow");
}

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
    e?.preventDefault?.();
    e?.stopPropagation?.();
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

/* ================= COPY ADDRESS ================= */
function setupCopyAddress() {
  if (!copyAddressBtn) return;
  
  copyAddressBtn.addEventListener("click", async () => {
    if (!address) return;
    
    try {
      await navigator.clipboard.writeText(address);
      
      copyAddressBtn.classList.add("copied");
      copyAddressBtn.textContent = "✓";
      
      const tempToast = document.createElement("div");
      tempToast.className = "toast";
      tempToast.innerHTML = `
        <div class="toast-row">
          <div class="toast-title">Address Copied</div>
        </div>
        <div class="toast-sub">${shortAddr(address)}</div>
      `;
      $("toastHost")?.appendChild(tempToast);
      
      setTimeout(() => {
        copyAddressBtn.classList.remove("copied");
        copyAddressBtn.textContent = "📋";
        try { $("toastHost")?.removeChild(tempToast); } catch {}
      }, 1500);
      
    } catch (err) {
      console.warn("Copy failed:", err);
    }
  }, { passive: true });
}

/* ================= DRAWER MENU ================= */
const backdrop = $("backdrop");
const drawer = $("drawer");
const drawerNav = $("drawerNav");
const themeToggle = $("themeToggle");
const liveToggle = $("liveToggle");
const privacyToggle = $("privacyToggle");
const liveIcon = $("liveIcon");
const modeHint = $("modeHint");

const cloudDotMenu = $("cloudDotMenu");
const cloudTextMenu = $("cloudTextMenu");
const cloudPtsMenu = $("cloudPtsMenu");

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
    exitFullscreenCard();
    closeRangeModal();
  }
});

themeToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyTheme(theme === "dark" ? "light" : "dark");
}, { passive:false });

privacyToggle?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  applyPrivacyMode(!privacyMode);
}, { passive:false });

/* ================= COMING SOON OVERLAY ================= */
const comingSoon = $("comingSoon");
const comingTitle = $("comingTitle");
const comingSub = $("comingSub");
const comingClose = $("comingClose");

function pageLabel(key){
  if (key === "home") return "HOME";
  if (key === "market") return "MARKET";
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

comingClose?.addEventListener("click", (e) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  closeComingSoon();
}, { passive:false });

comingSoon?.addEventListener("click", (e) => {
  if (e.target === comingSoon) closeComingSoon();
}, { passive:true });

/* ================= PAGES ================= */
const pageDashboard = $("pageDashboard");
const pageTools = $("pageTools");
const pageEvents = $("pageEvents");
const pageSettings = $("pageSettings");

function showPage(key){
  pageDashboard?.classList.remove("active");
  pageTools?.classList.remove("active");
  pageEvents?.classList.remove("active");
  pageSettings?.classList.remove("active");

  if (key === "dashboard") pageDashboard?.classList.add("active");
  else if (key === "tools") pageTools?.classList.add("active");
  else if (key === "events") pageEvents?.classList.add("active");
  else if (key === "settings") pageSettings?.classList.add("active");
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
  } else if (page === "tools") {
    closeComingSoon();
    showPage("tools");
    initToolsPage();
  } else if (page === "events") {
    closeComingSoon();
    showPage("events");
    renderEvents();
  } else if (page === "settings") {
    closeComingSoon();
    showPage("settings");
    initSettingsPage();
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
    try { chart?.resize?.(); } catch {}
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
    try { chart?.resize?.(); } catch {}
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
let eventsFilter = "all";
let eventsPage = 1;
const EVENTS_PER_PAGE = 25;

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
  } catch {
    eventsAll = [];
  }
}

function saveEvents(){
  const key = evStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({ v: EV_LOCAL_VER, t: Date.now(), events: eventsAll.slice(0, 1200) }));
  } catch {}
}

function updateEventsBadge(){
  const badge = $("eventsBadge");
  if (!badge) return;
  
  const newEvents = eventsAll.filter(e => e.status === "pending" || e.status === "new").length;
  if (newEvents > 0) {
    badge.textContent = newEvents;
    badge.style.display = "grid";
  } else {
    badge.style.display = "none";
  }
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
    amount: ev.amount ?? null,
    dir: ev.dir || null,
    status: ev.status || "new"
  };
  eventsAll.unshift(obj);
  eventsAll = eventsAll.slice(0, 1200);
  saveEvents();
  renderEvents();
  showToast(obj);
  updateEventsBadge();

  if (obj.status === "new" && obj.kind !== "price") {
    setTimeout(() => {
      const idx = eventsAll.findIndex(x => x.id === obj.id);
      if (idx >= 0) {
        eventsAll[idx].status = hasInternet() ? "ok" : "err";
        saveEvents();
        renderEvents();
        updateEventsBadge();
      }
    }, 1500);
  }
}

function getFilteredEvents(){
  if (eventsFilter === "all") return eventsAll;
  return eventsAll.filter(e => e.kind === eventsFilter);
}

function renderEvents(){
  const body = $("eventsTbody");
  const empty = $("eventsEmpty");
  const pageInfo = $("pageInfo");
  const prevBtn = $("prevPage");
  const nextBtn = $("nextPage");
  if (!body) return;

  body.innerHTML = "";
  const filtered = getFilteredEvents();
  const totalPages = Math.max(1, Math.ceil(filtered.length / EVENTS_PER_PAGE));
  const startIdx = (eventsPage - 1) * EVENTS_PER_PAGE;
  const endIdx = Math.min(startIdx + EVENTS_PER_PAGE, filtered.length);
  const pageEvents = filtered.slice(startIdx, endIdx);

  if (empty) empty.style.display = pageEvents.length ? "none" : "block";
  if (!pageEvents.length) return;

  for (const ev of pageEvents){
    const tr = document.createElement("tr");

    const dt = new Date(ev.ts || Date.now());
    const when = `${dt.toLocaleDateString()} ${fmtHHMMSS(ev.ts || Date.now())}`;

    const pillDotClass = (ev.status === "ok") ? "ev-dot ok" : (ev.status === "err") ? "ev-dot err" : "ev-dot";
    const arrow = ev.dir === "up" ? `<span class="ev-arrow up">▲</span>` : ev.dir === "down" ? `<span class="ev-arrow down">▼</span>` : "";
    const kind = (ev.kind || "info").toUpperCase();

    tr.innerHTML = `
      <td>
        <span class="ev-pill"><span class="${pillDotClass}"></span>${kind}</span>
      </td>
      <td>${ev.title || "Event"}</td>
      <td style="white-space:nowrap">${when}</td>
      <td>${arrow} ${ev.detail || ""}</td>
      <td>${ev.status === "ok" ? "✅" : ev.status === "err" ? "❌" : "⏳"}</td>
    `;
    body.appendChild(tr);
  }

  if (pageInfo) pageInfo.textContent = `Page ${eventsPage} of ${totalPages}`;
  if (prevBtn) prevBtn.disabled = eventsPage <= 1;
  if (nextBtn) nextBtn.disabled = eventsPage >= totalPages;
}

function initEventsPage(){
  $("eventsFilter")?.addEventListener("change", (e) => {
    eventsFilter = e.target.value;
    eventsPage = 1;
    renderEvents();
  }, { passive: true });
  
  $("prevPage")?.addEventListener("click", () => {
    if (eventsPage > 1) {
      eventsPage--;
      renderEvents();
    }
  }, { passive: true });
  
  $("nextPage")?.addEventListener("click", () => {
    const filtered = getFilteredEvents();
    const totalPages = Math.max(1, Math.ceil(filtered.length / EVENTS_PER_PAGE));
    if (eventsPage < totalPages) {
      eventsPage++;
      renderEvents();
    }
  }, { passive: true });
  
  $("eventsClearBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    eventsAll = [];
    saveEvents();
    renderEvents();
    updateEventsBadge();
  }, { passive:false });
}

/* ================= MODE SWITCH + PULL TO REFRESH ================= */
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
  chartSyncTimer = setInterval(loadChartToday, CHART_SYNC_MS);
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
  
  const liveLabel = $("liveLabel");
  if (liveLabel) liveLabel.textContent = liveMode ? "Live" : "Refresh";

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

/* Pull-to-refresh */
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
      pushEvent({ kind:"info", title:"Refresh", detail:"Data refreshed (REFRESH mode).", status:"ok" });
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
let displayed = { price: 0, available: 0, stake: 0, rewards: 0, netWorthUsd: 0, apr: 0 };

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

/* ================= ACCOUNT + VALIDATOR ================= */
let validator = { addr: "", moniker: "", status: "unknown" };
let validatorLoading = false;

function setValidatorUI(state){
  const nameEl = $("validatorName");
  const dotEl  = $("validatorDot");

  if (nameEl) nameEl.textContent = validator.moniker || "Validator";

  if (!dotEl) return;

  dotEl.classList.remove("ok","err");
  dotEl.style.background = "#f59e0b";

  if (!hasInternet()) {
    dotEl.classList.add("err");
    dotEl.style.background = "#ef4444";
    return;
  }

  if (state === "loading" || validatorLoading) {
    dotEl.style.background = "#f59e0b";
    return;
  }

  if (validator.status === "bonded" || validator.status === "active") {
    dotEl.classList.add("ok");
    dotEl.style.background = "#22c55e";
  } else if (validator.status === "unbonded" || validator.status === "jailed") {
    dotEl.classList.add("err");
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

/* ================= BINANCE REST ================= */
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
let chartScale = "linear";
let chartTf = "live";

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
          type: chartScale === "log" ? "logarithmic" : "linear",
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
    chart.options.scales.y.type = chartScale === "log" ? "logarithmic" : "linear";
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

function initChartControls(){
  $("priceScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    chartScale = chartScale === "log" ? "linear" : "log";
    const b = $("priceScaleToggle");
    if (b) b.textContent = chartScale === "log" ? "LOG" : "LIN";
    if (chart) {
      chart.options.scales.y.type = chartScale === "log" ? "logarithmic" : "linear";
      chart.update("none");
    }
  }, { passive: false });
  
  const chartTfBtns = document.querySelectorAll(".chart-timeframe .tf-btn");
  chartTfBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      chartTf = btn.dataset.tf;
      chartTfBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      // Here you would implement timeframe switching logic
    }, { passive: false });
  });
}

/* ================= STAKE CHART ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let stakeMoves = [];
let stakeTypes = [];
let lastStakeRecordedRounded = null;
let stakeBaselineCaptured = false;
let stakeScale = "linear";
let stakeTf = "live";
let stakeCustomRange = { min: 0, max: 1000 };

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
      labels: stakeLabels, data: stakeData, moves: stakeMoves, types: stakeTypes,
      scale: stakeScale, tf: stakeTf, customRange: stakeCustomRange
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
    stakeScale  = obj.scale === "log" ? "log" : "linear";
    stakeTf     = obj.tf || "live";
    stakeCustomRange = obj.customRange || { min: 0, max: 1000 };

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
            title: (items) => {
              const lbl = stakeLabels[items?.[0]?.dataIndex ?? 0] || "";
              const ts = labelToTs(lbl);
              return ts ? `${new Date(ts).toLocaleDateString()} ${fmtHHMMSS(ts)}` : String(lbl);
            },
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
        x: {
          ticks: {
            color: axisTickColor(),
            callback: (val, idx) => {
              const ts = labelToTs(stakeLabels[idx]);
              return ts ? fmtHHMM(ts) : "";
            },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          },
          grid: { color: axisGridColor() }
        },
        y: {
          type: stakeScale === "log" ? "logarithmic" : "linear",
          ticks: { color: axisTickColor() },
          grid: { color: axisGridColor() }
        }
      }
    }
  });
}

function drawStakeChart() {
  if (!stakeChart) initStakeChart();
  if (stakeChart) {
    stakeChart.data.labels = stakeLabels;
    stakeChart.data.datasets[0].data = stakeData;
    stakeChart.options.scales.y.type = stakeScale === "log" ? "logarithmic" : "linear";
    stakeChart.update("none");
  }
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

  saveStakeSeriesLocal();
  drawStakeChart();

  pushEvent({
    kind: "tx",
    title: delta > 0 ? "Stake increased" : "Stake decreased",
    detail: `${delta > 0 ? "+" : ""}${delta.toFixed(6)} INJ`,
    status: "new"
  });
}

function initStakeControls(){
  $("stakeScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    stakeScale = stakeScale === "log" ? "linear" : "log";
    const b = $("stakeScaleToggle");
    if (b) b.textContent = stakeScale === "log" ? "LOG" : "LIN";
    saveStakeSeriesLocal();
    drawStakeChart();
  }, { passive: false });
  
  $("stakeRangeConfig")?.addEventListener("click", () => {
    openRangeModal("stake");
  }, { passive: true });
  
  const stakeTfBtns = document.querySelectorAll(".stake-timeframe .tf-btn");
  stakeTfBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      stakeTf = btn.dataset.tf;
      stakeTfBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      saveStakeSeriesLocal();
    }, { passive: false });
  });
}

/* ================= REWARD WITHDRAWALS ================= */
let wdLabelsAll = [];
let wdValuesAll = [];
let wdTimesAll  = [];

let wdLabels = [];
let wdValues = [];
let wdTimes  = [];

let wdLastRewardsSeen = null;
let wdMinFilter = 0;
let rewardScale = "linear";
let rewardTf = "live";
let rewardCustomRange = { min: 0, max: 0.1 };

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
      labels: wdLabelsAll, values: wdValuesAll, times: wdTimesAll,
      scale: rewardScale, tf: rewardTf, customRange: rewardCustomRange
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
    rewardScale = obj.scale === "log" ? "log" : "linear";
    rewardTf    = obj.tf || "live";
    rewardCustomRange = obj.customRange || { min: 0, max: 0.1 };

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
            title: (items) => {
              const i = items?.[0]?.dataIndex ?? 0;
              const ts = wdTimes[i] || labelToTs(wdLabels[i]);
              return ts ? `${new Date(ts).toLocaleDateString()} ${fmtHHMMSS(ts)}` : (wdLabels[i] || "");
            },
            label: (item) => `Withdrawn • +${safe(item.raw).toFixed(6)} INJ`
          }
        },
        ...(ZOOM_OK ? { zoom: { pan: { enabled: true, mode: "x", threshold: 2 }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } } } : {})
      },
      scales: {
        x: { ticks: { color: axisTickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: axisGridColor() } },
        y: {
          type: rewardScale === "log" ? "logarithmic" : "linear",
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
    rewardChart.options.scales.y.type = rewardScale === "log" ? "logarithmic" : "linear";
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

  const fromTs = wdTimes[minIdx] || labelToTs(wdLabels[minIdx]);
  const toTs   = wdTimes[maxIdx] || labelToTs(wdLabels[maxIdx]);
  const from = fromTs ? fmtHHMM(fromTs) : (wdLabels[minIdx] || "");
  const to   = toTs ? fmtHHMM(toTs) : (wdLabels[maxIdx] || "");
  meta.textContent = n <= 1 ? `${to}` : `${from} → ${to}`;
}

function updateRewardEstimates() {
  const daily = $("dailyEstimate");
  const weekly = $("weeklyEstimate");
  const monthly = $("monthlyEstimate");
  
  if (!daily || !weekly || !monthly) return;
  
  const dailyEst = rewardsInj * (apr / 100) / 365;
  const weeklyEst = dailyEst * 7;
  const monthlyEst = dailyEst * 30;
  
  daily.textContent = dailyEst.toFixed(6);
  weekly.textContent = weeklyEst.toFixed(6);
  monthly.textContent = monthlyEst.toFixed(6);
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
    saveWdAllLocal();
    rebuildWdView();
    goRewardLive();

    pushEvent({
      kind: "tx",
      title: "Rewards withdrawn",
      detail: `+${diff.toFixed(6)} INJ`,
      status: "new"
    });
  }
  wdLastRewardsSeen = r;
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
function initRewardControls(){
  $("rewardScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    rewardScale = rewardScale === "log" ? "linear" : "log";
    const b = $("rewardScaleToggle");
    if (b) b.textContent = rewardScale === "log" ? "LOG" : "LIN";
    saveWdAllLocal();
    drawRewardWdChart();
  }, { passive: false });
  
  $("rewardRangeConfig")?.addEventListener("click", () => {
    openRangeModal("reward");
  }, { passive: true });
  
  const rewardTfBtns = document.querySelectorAll(".reward-timeframe .tf-btn");
  rewardTfBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      rewardTf = btn.dataset.tf;
      rewardTfBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      saveWdAllLocal();
    }, { passive: false });
  });
  
  const filter = $("rewardFilter");
  if (filter) {
    filter.addEventListener("change", () => {
      wdMinFilter = safe(filter.value);
      rebuildWdView();
      goRewardLive();
    }, { passive: true });
  }
}

/* ================= NET WORTH ================= */
let nwTf = "1d";
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
      tAll: nwTAll,
      usdAll: nwUsdAll,
      injAll: nwInjAll,
      tf: nwTf,
      scale: nwScale
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
    nwTf = typeof obj.tf === "string" ? obj.tf : "1d";
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

function nwHasSpan(tf){
  if (!nwTAll.length) return false;
  const first = nwTAll[0];
  const span = Date.now() - first;
  return span >= nwWindowMs(tf) * 0.8;
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
      nwApplySignStyling(pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat"));
    }
  } else {
    if (pnlEl){
      pnlEl.classList.remove("good","bad");
      pnlEl.classList.add("flat");
      pnlEl.textContent = "PnL: —";
      nwApplySignStyling("flat");
    }
  }

  updateNWTFButtons();
}

function updateNWTFButtons(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;
  const btns = wrap.querySelectorAll(".tf-btn");
  btns.forEach(b => {
    const tf = b.dataset.tf || "";
    const enabled = (tf === "live") ? true
      : (tf === "1d") ? true
      : (tf === "1w") ? nwHasSpan("1w")
      : (tf === "1m") ? nwHasSpan("1m")
      : (tf === "1y") ? nwHasSpan("1y")
      : (tf === "all") ? (nwTAll.length > 20)
      : true;

    b.disabled = !enabled;
    b.style.opacity = enabled ? "1" : "0.42";
    b.style.pointerEvents = enabled ? "auto" : "none";
    b.classList.toggle("active", (b.dataset.tf === nwTf));
  });
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
  if (el){
    el.textContent = `$${v.toFixed(2)}`;
  }
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

function initNWControls(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["live","1d","1w","1m","1y","all"].includes(tf)) return;
    if (btn.disabled) return;

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
  const lastUsd = nwUsdAll.length ? safe(nwUsdAll[nwTAll.length - 1]) : 0;

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

function updateNetWorthMiniRows(){
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const px = safe(displayed.price);

  setText("nwInjQty", totalInj.toFixed(4));
  setText("nwInjPx", `$${px.toFixed(2)}`);
  setText("netWorthInj", `${totalInj.toFixed(4)} INJ`);
}

/* ================= APR CHART SYSTEM ================= */
let aprChart = null;
let aprLabels = [];
let aprData = [];
let aprTimes = [];
let aprScale = "linear";
let aprTf = "live";

function aprStoreKey(addr) {
  const a = (addr || "").trim();
  return a ? `inj_apr_series_v${APR_LOCAL_VER}_${a}` : null;
}

function saveAprSeriesLocal() {
  const key = aprStoreKey(address);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      v: APR_LOCAL_VER,
      t: Date.now(),
      labels: aprLabels,
      data: aprData,
      times: aprTimes,
      scale: aprScale,
      tf: aprTf
    }));
  } catch {}
}

function loadAprSeriesLocal() {
  const key = aprStoreKey(address);
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== APR_LOCAL_VER) return false;
    
    aprLabels = Array.isArray(obj.labels) ? obj.labels : [];
    aprData = Array.isArray(obj.data) ? obj.data : [];
    aprTimes = Array.isArray(obj.times) ? obj.times : [];
    aprScale = obj.scale === "log" ? "log" : "linear";
    aprTf = obj.tf || "live";
    return true;
  } catch {
    return false;
  }
}

function initAprChart() {
  const canvas = $("aprChart");
  if (!canvas || !window.Chart) return;
  
  aprChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: aprLabels,
      datasets: [{
        data: aprData,
        borderColor: "#8b5cf6",
        backgroundColor: "rgba(139, 92, 246, 0.12)",
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: "#8b5cf6",
        pointBorderColor: "rgba(249,250,251,0.6)",
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
            title: (items) => {
              const idx = items[0]?.dataIndex ?? 0;
              const ts = aprTimes[idx] || labelToTs(aprLabels[idx]);
              return ts ? `${new Date(ts).toLocaleDateString()} ${fmtHHMMSS(ts)}` : "";
            },
            label: (item) => `${item.raw.toFixed(2)}% APR`
          }
        }
      },
      scales: {
        x: { display: false },
        y: {
          type: aprScale === "log" ? "logarithmic" : "linear",
          position: "right",
          ticks: {
            color: axisTickColor(),
            callback: (v) => `${v.toFixed(2)}%`,
            maxTicksLimit: 5
          },
          grid: { color: axisGridColor() }
        }
      }
    }
  });
}

function drawAprChart() {
  if (!aprChart) initAprChart();
  if (aprChart) {
    aprChart.data.labels = aprLabels;
    aprChart.data.datasets[0].data = aprData;
    aprChart.options.scales.y.type = aprScale === "log" ? "logarithmic" : "linear";
    aprChart.update("none");
  }
}

function recordAprPoint(newApr) {
  if (!address) return;
  const a = safe(newApr);
  if (!Number.isFinite(a) || a <= 0) return;
  
  const now = Date.now();
  const lastA = aprData.length ? safe(aprData[aprData.length - 1]) : 0;
  
  if (aprData.length && Math.abs(a - lastA) < 0.01) return;
  
  aprTimes.push(now);
  aprLabels.push(tsLabel(now));
  aprData.push(a);
  
  if (aprData.length > 1000) {
    aprTimes.shift();
    aprLabels.shift();
    aprData.shift();
  }
  
  saveAprSeriesLocal();
  drawAprChart();
  
  if (aprData.length >= 2 && Math.abs(a - lastA) >= 0.1) {
    pushEvent({
      kind: "apr",
      title: "APR Changed",
      detail: `${lastA.toFixed(2)}% → ${a.toFixed(2)}%`,
      dir: a > lastA ? "up" : "down",
      status: "ok"
    });
  }
}

function initAprControls(){
  $("aprScaleToggle")?.addEventListener("click", (e) => {
    e.preventDefault();
    aprScale = aprScale === "log" ? "linear" : "log";
    const b = $("aprScaleToggle");
    if (b) b.textContent = aprScale === "log" ? "LOG" : "LIN";
    saveAprSeriesLocal();
    drawAprChart();
  }, { passive: false });
  
  const aprTfBtns = document.querySelectorAll(".apr-timeframe-btn");
  aprTfBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      aprTf = btn.dataset.tf;
      aprTfBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      saveAprSeriesLocal();
    }, { passive: false });
  });
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

  if (cloudDotMenu) {
    cloudDotMenu.classList.remove("ok","saving","err");
    if (state === "saving") cloudDotMenu.classList.add("saving");
    else if (state === "error") cloudDotMenu.classList.add("err");
    else cloudDotMenu.classList.add("ok");
  }
  if (cloudTextMenu) {
    cloudTextMenu.textContent = (state === "saving") ? "Saving"
      : (state === "error") ? "Error"
      : hasInternet() ? "Synced" : "Offline cache";
  }
}

function cloudRenderMeta(){
  const hist = $("cloudHistory");
  if (hist) hist.textContent = `· ${Math.max(0, Math.floor(cloudPts))} pts`;
  if (cloudPtsMenu) cloudPtsMenu.textContent = `${Math.max(0, Math.floor(cloudPts))} pts`;
}

function cloudBumpLocal(points = 1){
  cloudPts = safe(cloudPts) + safe(points);
  cloudLastSync = Date.now();
  cloudSaveMeta();
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
    apr: { labels: aprLabels, data: aprData, times: aprTimes }
  };
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

function mergeStakeByLabel(payloadStake){
  if (!payloadStake) return;
  const pl = Array.isArray(payloadStake.labels) ? payloadStake.labels : [];
  const pd = Array.isArray(payloadStake.data) ? payloadStake.data : [];
  const pm = Array.isArray(payloadStake.moves) ? payloadStake.moves : [];
  const pt = Array.isArray(payloadStake.types) ? payloadStake.types : [];

  const map = new Map();
  for (let i=0;i<stakeLabels.length;i++){
    const k = String(stakeLabels[i]);
    map.set(k, { d: safe(stakeData[i]), m: safe(stakeMoves[i]), t: String(stakeTypes[i] || "Stake update") });
  }
  for (let i=0;i<pl.length;i++){
    const k = String(pl[i]);
    if (!map.has(k)) {
      map.set(k, { d: safe(pd[i]), m: safe(pm[i]), t: String(pt[i] || "Stake update") });
    }
  }

  const keys = [...map.keys()].sort((a,b)=>labelToTs(a)-labelToTs(b));
  stakeLabels = keys;
  stakeData = keys.map(k => map.get(k).d);
  stakeMoves = keys.map(k => map.get(k).m);
  stakeTypes = keys.map(k => map.get(k).t);

  stakeLabels = clampArray(stakeLabels, 2400);
  stakeData   = clampArray(stakeData,   2400);
  stakeMoves  = clampArray(stakeMoves,  2400);
  stakeTypes  = clampArray(stakeTypes,  2400);

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
  wdTimesAll  = times;
  wdValuesAll = times.map(t => map.get(t).v);
  wdLabelsAll = times.map(t => map.get(t).l);

  wdTimesAll  = clampArray(wdTimesAll, 2400);
  wdValuesAll = clampArray(wdValuesAll, 2400);
  wdLabelsAll = clampArray(wdLabelsAll, 2400);
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
  const pt = Array.isArray(payloadApr.times) ? payloadApr.times : [];

  const map = new Map();
  for (let i=0;i<aprTimes.length;i++){
    const t = safe(aprTimes[i]) || labelToTs(aprLabels[i]);
    if (!t) continue;
    map.set(t, { d: safe(aprData[i]), l: String(aprLabels[i] || tsLabel(t)) });
  }
  for (let i=0;i<pt.length;i++){
    const t = safe(pt[i]) || labelToTs(pl[i]);
    if (!t) continue;
    if (!map.has(t)) map.set(t, { d: safe(pd[i]), l: String(pl[i] || tsLabel(t)) });
  }

  const times = [...map.keys()].sort((a,b)=>a-b);
  aprTimes = times;
  aprData = times.map(t => map.get(t).d);
  aprLabels = times.map(t => map.get(t).l);

  if (aprData.length > 1000) {
    aprTimes = aprTimes.slice(-1000);
    aprData = aprData.slice(-1000);
    aprLabels = aprLabels.slice(-1000);
  }
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
    rebuildWdView();
    goRewardLive();
    saveNWLocal();
    drawNW();
    drawStakeChart();
    drawRewardWdChart();
    saveAprSeriesLocal();
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

/* ================= PRICE EVENTS ================= */
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
    if (aprChart) {
      aprChart.options.scales.y.grid.color = axisGridColor();
      aprChart.options.scales.y.ticks.color = axisTickColor();
      aprChart.update("none");
    }
  } catch {}
}

/* ================= RANGE MODAL ================= */
let currentRangeType = null;
const rangeModal = $("rangeModal");
const rangeMin = $("rangeMin");
const rangeMax = $("rangeMax");
const rangeModalClose = $("rangeModalClose");
const rangeCancel = $("rangeCancel");
const rangeApply = $("rangeApply");

function openRangeModal(type){
  currentRangeType = type;
  
  if (type === "stake") {
    rangeMin.value = stakeCustomRange.min;
    rangeMax.value = stakeCustomRange.max;
  } else if (type === "reward") {
    rangeMin.value = rewardCustomRange.min;
    rangeMax.value = rewardCustomRange.max;
  }
  
  rangeModal.classList.add("show");
  rangeModal.setAttribute("aria-hidden", "false");
}

function closeRangeModal(){
  rangeModal.classList.remove("show");
  rangeModal.setAttribute("aria-hidden", "true");
  currentRangeType = null;
}

function applyRange(){
  const min = safe(rangeMin.value);
  const max = safe(rangeMax.value);
  
  if (min >= max) {
    alert("Maximum must be greater than minimum");
    return;
  }
  
  if (currentRangeType === "stake") {
    stakeCustomRange = { min, max };
    saveStakeSeriesLocal();
    // Update UI
    const label = document.querySelector(".stake-scale-row .range-label");
    if (label) label.textContent = `Range: ${min}-${max}`;
  } else if (currentRangeType === "reward") {
    rewardCustomRange = { min, max };
    saveWdAllLocal();
    const label = document.querySelector(".reward-scale-row .range-label");
    if (label) label.textContent = `Range: ${min}-${max}`;
  }
  
  closeRangeModal();
}

rangeModalClose?.addEventListener("click", closeRangeModal, { passive: true });
rangeCancel?.addEventListener("click", closeRangeModal, { passive: true });
rangeApply?.addEventListener("click", applyRange, { passive: true });

rangeModal?.addEventListener("click", (e) => {
  if (e.target === rangeModal) closeRangeModal();
}, { passive: true });

/* ================= TOOLS PAGE ================= */
function initToolsPage(){
  // Converter
  const convertBtn = $("convertBtn");
  const convertAmount = $("convertAmount");
  const convertCurrency = $("convertCurrency");
  const exchangeRate = $("exchangeRate");
  
  function updateConverter(){
    const amount = safe(convertAmount.value);
    const currency = convertCurrency.value;
    const rate = safe(exchangeRate.value);
    const injPrice = safe(targetPrice) || safe(displayed.price);
    
    let eur, usd, inj;
    
    if (currency === "EUR") {
      eur = amount;
      usd = amount * rate;
    } else {
      usd = amount;
      eur = amount / rate;
    }
    
    inj = usd / injPrice;
    
    $("resultEur").textContent = `€${eur.toFixed(2)}`;
    $("resultUsd").textContent = `$${usd.toFixed(2)}`;
    $("resultInj").textContent = `${inj.toFixed(6)} INJ`;
    $("currentInjPrice").textContent = injPrice.toFixed(4);
  }
  
  convertBtn?.addEventListener("click", updateConverter, { passive: true });
  convertAmount?.addEventListener("input", updateConverter, { passive: true });
  convertCurrency?.addEventListener("change", updateConverter, { passive: true });
  exchangeRate?.addEventListener("input", updateConverter, { passive: true });
  
  // Market Cap Comparator
  const compareBtn = $("compareBtn");
  const compareCurrency = $("compareCurrency");
  const formatBtns = document.querySelectorAll(".format-btn");
  
  const marketCaps = {
    BTC: 1_200_000_000_000,
    ETH: 450_000_000_000,
    SOL: 80_000_000_000,
    ATOM: 4_500_000_000,
    DOT: 12_000_000_000,
    INJ: 3_500_000_000
  };
  
  let currentFormat = "billions";
  
  function formatNumber(num, format){
    if (format === "thousands") return `$${(num / 1_000).toFixed(1)}K`;
    if (format === "millions") return `$${(num / 1_000_000).toFixed(1)}M`;
    if (format === "billions") return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (format === "trillions") return `$${(num / 1_000_000_000_000).toFixed(3)}T`;
    return `$${num.toFixed(0)}`;
  }
  
  function updateMarketCap(){
    const selected = compareCurrency.value;
    const injCap = marketCaps.INJ;
    const compareCap = marketCaps[selected];
    const ratio = (injCap / compareCap) * 100;
    
    $("injCap").textContent = formatNumber(injCap, currentFormat);
    $("compareCoinName").textContent = selected;
    $("compareCap").textContent = formatNumber(compareCap, currentFormat);
    $("capRatio").textContent = `${ratio.toFixed(2)}%`;
    
    const injBar = $("injBar");
    const compareBar = $("compareBar");
    
    if (injBar && compareBar) {
      const maxCap = Math.max(injCap, compareCap);
      injBar.style.width = `${(injCap / maxCap) * 100}%`;
      compareBar.style.width = `${(compareCap / maxCap) * 100}%`;
    }
  }
  
  compareBtn?.addEventListener("click", updateMarketCap, { passive: true });
  compareCurrency?.addEventListener("change", updateMarketCap, { passive: true });
  
  formatBtns.forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      formatBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFormat = btn.dataset.format;
      updateMarketCap();
    }, { passive: false });
  });
  
  // Initial updates
  updateConverter();
  updateMarketCap();
}

/* ================= SETTINGS PAGE ================= */
function initSettingsPage(){
  const defaultMode = $("defaultMode");
  const defaultTheme = $("defaultTheme");
  const resetSelect = $("resetSelect");
  const resetConfirm = $("resetConfirm");
  const resetCancel = $("resetCancel");
  const resetExecute = $("resetExecute");
  const settingsSave = $("settingsSave");
  
  // Load current settings
  if (defaultMode) defaultMode.value = liveMode ? "live" : "refresh";
  if (defaultTheme) defaultTheme.value = theme;
  
  // Reset selector
  resetSelect?.addEventListener("change", (e) => {
    if (e.target.value) {
      resetConfirm.style.display = "block";
    } else {
      resetConfirm.style.display = "none";
    }
  }, { passive: true });
  
  resetCancel?.addEventListener("click", () => {
    resetSelect.value = "";
    resetConfirm.style.display = "none";
  }, { passive: true });
  
  resetExecute?.addEventListener("click", () => {
    const type = resetSelect.value;
    if (!type) return;
    
    if (type === "stake" || type === "all") {
      stakeLabels = [];
      stakeData = [];
      stakeMoves = [];
      stakeTypes = [];
      stakeBaselineCaptured = false;
      lastStakeRecordedRounded = null;
      saveStakeSeriesLocal();
      drawStakeChart();
    }
    
    if (type === "rewards" || type === "all") {
      wdLabelsAll = [];
      wdValuesAll = [];
      wdTimesAll = [];
      wdLastRewardsSeen = null;
      saveWdAllLocal();
      rebuildWdView();
    }
    
    if (type === "networth" || type === "all") {
      nwTAll = [];
      nwUsdAll = [];
      nwInjAll = [];
      saveNWLocal();
      drawNW();
    }
    
    if (type === "apr" || type === "all") {
      aprLabels = [];
      aprData = [];
      aprTimes = [];
      saveAprSeriesLocal();
      drawAprChart();
    }
    
    pushEvent({
      kind: "info",
      title: "Chart Data Reset",
      detail: `${type === "all" ? "All charts" : type + " chart"} data has been reset.`,
      status: "ok"
    });
    
    resetSelect.value = "";
    resetConfirm.style.display = "none";
  }, { passive: true });
  
  // Save settings
  settingsSave?.addEventListener("click", () => {
    if (defaultMode) {
      const newMode = defaultMode.value === "live";
      if (newMode !== liveMode) {
        setMode(newMode);
      }
    }
    
    if (defaultTheme) {
      const newTheme = defaultTheme.value;
      if (newTheme !== theme) {
        applyTheme(newTheme);
      }
    }
    
    pushEvent({
      kind: "info",
      title: "Settings Saved",
      detail: "Your preferences have been updated.",
      status: "ok"
    });
    
    showPage("dashboard");
    setActivePage("dashboard");
  }, { passive: true });
}

/* ================= ADDRESS COMMIT ================= */
async function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  localStorage.setItem("inj_address", address);

  setAddressDisplay(address);
  settleStart = Date.now();

  availableInj = 0; stakeInj = 0; rewardsInj = 0; apr = 0;
  displayed.available = 0; displayed.stake = 0; displayed.rewards = 0; displayed.netWorthUsd = 0; displayed.apr = 0;

  loadStakeSeriesLocal();
  drawStakeChart();

  wdLastRewardsSeen = null;
  wdMinFilter = safe($("rewardFilter")?.value || 0);
  loadWdAllLocal();
  rebuildWdView();
  goRewardLive();

  loadNWLocal();
  const scaleBtn = $("nwScaleToggle");
  if (scaleBtn) scaleBtn.textContent = (nwScale === "log") ? "LOG" : "LIN";
  initNWControls();
  drawNW();

  loadAprSeriesLocal();
  initAprControls();
  drawAprChart();

  loadEvents();
  renderEvents();
  updateEventsBadge();

  cloudSetState("saving");
  await cloudPull();

  modeLoading = true;
  refreshConnUI();

  if (liveMode) await loadAccount();
  else {
    refreshLoaded = false;
    refreshConnUI();
    await refreshLoadAllOnce();
  }
}

/* ================= ONLINE / OFFLINE ================= */
window.addEventListener("online", () => {
  refreshConnUI();
  setValidatorUI("ready");
  cloudSetState("synced");
  if (address) cloudPull();
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
  setValidatorUI("ready");
  cloudSetState("synced");
}, { passive: true });

/* ================= BOOT ================= */
(async function boot() {
  applyTheme(theme);
  applyPrivacyMode(privacyMode);
  ZOOM_OK = tryRegisterZoom();

  cloudLoadMeta();
  cloudRenderMeta();
  cloudSetState("synced");
  refreshConnUI();
  setTimeout(() => setUIReady(true), 2600);

  attachRewardTimelineHandlers();
  initRewardControls();
  initStakeControls();
  initChartControls();
  initAprControls();
  initEventsPage();
  setupCopyAddress();

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;
  
  const liveLabel = $("liveLabel");
  if (liveLabel) liveLabel.textContent = liveMode ? "Live" : "Refresh";

  bindExpandButtons();
  initPullToRefresh();
  setAddressDisplay(address);

  wdMinFilter = safe($("rewardFilter")?.value || 0);

  if (address) {
    loadStakeSeriesLocal(); drawStakeChart();
    loadWdAllLocal(); rebuildWdView(); goRewardLive();
    loadNWLocal();
    const scaleBtn = $("nwScaleToggle");
    if (scaleBtn) scaleBtn.textContent = (nwScale === "log") ? "LOG" : "LIN";
    initNWControls();
    drawNW();
    
    loadAprSeriesLocal();
    initAprControls();
    drawAprChart();

    loadEvents();
    renderEvents();
    updateEventsBadge();

    await cloudPull();
  }

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

/* ================= ANIMATION LOOP ================= */
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

  if (tfReady.d) maybePriceEvent(pD);

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

  const stakePct = clamp((displayed.stake / stakeCustomRange.max) * 100, 0, 100);
  const stakeBar = $("stakeBar");
  const stakeLine = $("stakeLine");
  if (stakeBar) {
    stakeBar.style.width = stakePct + "%";
    stakeBar.style.backgroundPosition = `${(100 - stakePct) * 0.6}% 0`;
  }
  if (stakeLine) stakeLine.style.left = stakePct + "%";
  setText("stakePercent", stakePct.toFixed(1) + "%");
  setText("stakeMin", stakeCustomRange.min.toString());
  setText("stakeMax", stakeCustomRange.max.toString());

  // REWARDS
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  setText("rewardsUsd", `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`);

  const maxR = Math.max(rewardCustomRange.max, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  const rewardBar = $("rewardBar");
  const rewardLine = $("rewardLine");
  if (rewardBar) {
    rewardBar.style.width = rp + "%";
    rewardBar.style.backgroundPosition = `${(100 - rp)}% 0`;
  }
  if (rewardLine) rewardLine.style.left = rp + "%";
  setText("rewardPercent", rp.toFixed(1) + "%");
  setText("rewardMin", rewardCustomRange.min.toString());
  setText("rewardMax", maxR.toFixed(1));

  // APR
  const oapr = displayed.apr;
  displayed.apr = tick(displayed.apr, apr);
  colorNumber($("apr"), displayed.apr, oapr, 2);

  // Last update
  setText("updated", "Last update: " + nowLabel());

  // NET WORTH
  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(displayed.price);

  if (!nwHoverActive) {
    const onw = displayed.netWorthUsd;
    displayed.netWorthUsd = tick(displayed.netWorthUsd, totalUsd);
    colorMoney($("netWorthUsd"), displayed.netWorthUsd, onw, 2);
    drawNW();
  }

  updateNetWorthMiniRows();
  updateRewardEstimates();

  if (address && liveMode) {
    recordNetWorthPoint();
    recordAprPoint(apr);
  }

  if (cloudDirty && hasInternet()) scheduleCloudPush();

  refreshConnUI();
  setValidatorUI("ready");

  if (netWorthChart) netWorthChart.draw();

  requestAnimationFrame(animate);
}
animate();

/* ================= v2.1.0 CHANGELOG =================
✅ Added APR chart with log/linear scaling and timeframe buttons
✅ Added Settings page with Advanced reset options
✅ Enhanced Events page with pagination, filters, and badge counter
✅ Added Privacy Mode toggle (eye icon in menu)
✅ Added Copy Address button next to wallet display
✅ Improved all charts with consistent scale toggles
✅ Added Range Configuration modal for stake/reward charts
✅ Added Reward Estimates (daily/weekly/monthly)
✅ Enhanced Tools page with Converter and Market Cap Comparator
✅ Fixed all chart label positions and improved mobile responsiveness
✅ Added blinking dots on live charts
✅ Improved timeframe labels on price bars
✅ All data now properly scoped to individual addresses
✅ Enhanced cloud sync with APR data support
✅ Fixed expand button positions
✅ Added proper event filtering and pagination
=================================================== */
