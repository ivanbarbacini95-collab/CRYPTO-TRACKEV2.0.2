/* =========================================================
   Injective • Portfolio — app.js (FULL)
   - Price realtime (Binance WS) + 1D/1W/1M bars
   - Account (Injective LCD) available / staked / rewards / apr
   - 1D Price Chart (REST bootstrap + WS 1m) + pan/zoom + overlay
   - Stake Chart (ALL points) + Y ticks step 1 + persistence chunked
   - Reward Withdrawals Chart (ALL points) + labels always visible (no overlap) + persistence chunked
   - Online/Offline: Offline ONLY if no internet
   - Live/Refresh mode (optional UI hooks)
========================================================= */

/* ===================== CONFIG ===================== */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2500;
const REST_SYNC_MS = 60_000;
const CHART_SYNC_MS = 60_000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;

/* Reward withdrawal detection */
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

/* Persistence (chunked append-only) */
const STORE_VER = 1;
const CHUNK_SIZE = 220;

/* "No overlap" windowing */
const MAX_LABELS_VISIBLE = 80;
const MIN_PX_PER_POINT_STAKE = 46;  // label "COMPOUND/DELEGATE"
const MIN_PX_PER_POINT_REWARD = 56; // label "+0.0034 INJ"

/* ===================== HELPERS ===================== */
const $ = (id) => document.getElementById(id);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function nowLabel() { return new Date().toLocaleTimeString(); }
function nowTS() { return Date.now(); }
function hasInternet() { return navigator.onLine === true; }

function fgColor() {
  // compatibile sia dark che light senza rompere la tua palette
  const isLight = document.body?.dataset?.theme === "light";
  return isLight ? "#111827" : "#f9fafb";
}

/* ===================== OPTIONAL UI HOOKS (menu/search) ===================== */
const statusDot = $("statusDot");
const statusText = $("statusText");

const menuBtn = $("menuBtn");
const backdrop = $("backdrop");
const drawer = $("drawer");
const drawerNav = $("drawerNav");

const themeToggle = $("themeToggle");
const themeIcon = $("themeIcon");

const liveToggle = $("liveToggle");
const liveIcon = $("liveIcon");
const modeHint = $("modeHint");

const searchWrap = $("searchWrap");
const searchBtn = $("searchBtn");
const addressInput = $("addressInput");
const addressDisplay = $("addressDisplay");

/* ===================== THEME ===================== */
const THEME_KEY = "inj_theme";
let theme = localStorage.getItem(THEME_KEY) || "dark";

function applyTheme(t) {
  theme = (t === "light") ? "light" : "dark";
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  if (themeIcon) themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
}
applyTheme(theme);

themeToggle?.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"), { passive: true });

/* ===================== LIVE/REFRESH MODE ===================== */
const MODE_KEY = "inj_mode"; // "live" | "refresh"
let liveMode = (localStorage.getItem(MODE_KEY) || "live") === "live";

function setMode(isLive) {
  liveMode = !!isLive;
  localStorage.setItem(MODE_KEY, liveMode ? "live" : "refresh");

  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;

  if (liveMode) {
    startAllTimers();
    startTradeWS();
    startKlineWS();
    loadAccount(false);
    loadCandleSnapshot(false);
    loadChartToday(false);
  } else {
    stopAllTimers();
    stopAllSockets();
    // in refresh mode: carichi una volta al refresh pagina
    oneShotRefresh().catch(() => {});
  }
  refreshConnUI();
}
liveToggle?.addEventListener("click", () => setMode(!liveMode), { passive: true });

/* ===================== CONNECTION UI ===================== */
let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

function refreshConnUI() {
  if (!statusDot || !statusText) return;

  // Offline SOLO se manca internet
  if (!hasInternet()) {
    statusText.textContent = "Offline";
    statusDot.style.background = "#ef4444";
    return;
  }

  // Se refresh mode -> online se internet
  if (!liveMode) {
    statusText.textContent = "Online";
    statusDot.style.background = "#22c55e";
    return;
  }

  // Live mode: ok solo se WS+LCD ok
  const ok = wsTradeOnline && wsKlineOnline && accountOnline;
  if (ok) {
    statusText.textContent = "Online";
    statusDot.style.background = "#22c55e";
  } else {
    statusText.textContent = "Connecting...";
    statusDot.style.background = "#facc15";
  }
}

window.addEventListener("online", () => {
  refreshConnUI();
  if (liveMode) {
    startTradeWS();
    startKlineWS();
    loadAccount(false);
  }
}, { passive: true });

window.addEventListener("offline", () => {
  wsTradeOnline = false;
  wsKlineOnline = false;
  accountOnline = false;
  refreshConnUI();
}, { passive: true });

/* ===================== SEARCH (optional lens UX) ===================== */
let address = localStorage.getItem("inj_address") || "";
let pendingAddress = address || "";

function shortAddr(a) {
  a = (a || "").trim();
  if (!a) return "";
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}
function setAddressDisplay(addr) {
  if (!addressDisplay) return;
  if (!addr) { addressDisplay.innerHTML = ""; return; }
  addressDisplay.innerHTML = `<span class="tag"><strong>Wallet:</strong> ${shortAddr(addr)}</span>`;
}

function openSearch() {
  if (!searchWrap) return;
  searchWrap.classList.add("open");
  setTimeout(() => addressInput?.focus(), 20);
}
function closeSearch() {
  if (!searchWrap) return;
  searchWrap.classList.remove("open");
  addressInput?.blur();
}

if (addressInput) addressInput.value = pendingAddress;

searchBtn?.addEventListener("click", () => {
  if (!searchWrap?.classList.contains("open")) openSearch();
  else addressInput?.focus();
}, { passive: true });

addressInput?.addEventListener("focus", openSearch, { passive: true });
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
});

/* ===================== DRAWER MENU (optional) ===================== */
let drawerOpen = false;
function openDrawer() {
  drawerOpen = true;
  document.body.classList.add("drawer-open");
  drawer?.setAttribute("aria-hidden", "false");
  backdrop?.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  drawerOpen = false;
  document.body.classList.remove("drawer-open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.setAttribute("aria-hidden", "true");
}
function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }

menuBtn?.addEventListener("click", toggleDrawer, { passive: true });
backdrop?.addEventListener("click", closeDrawer, { passive: true });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

drawerNav?.addEventListener("click", (e) => {
  const btn = e.target?.closest(".nav-item");
  if (!btn) return;
  // pagina futura: per ora solo evidenzia
  const items = drawerNav.querySelectorAll(".nav-item");
  items.forEach(x => x.classList.toggle("active", x === btn));
  closeDrawer();
});

/* ===================== SMOOTH DISPLAY ===================== */
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

/* colored digits */
function colorNumber(el, n, o, d) {
  if (!el) return;
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i] ? (n > o ? "#22c55e" : "#ef4444") : fgColor();
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

/* ===================== PERFORMANCE ===================== */
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

/* ===================== BAR RENDER ===================== */
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
  if (!bar || !line) return;

  open = safe(open); low = safe(low); high = safe(high); val = safe(val);

  if (!open || !Number.isFinite(low) || !Number.isFinite(high) || high === low) {
    line.style.left = "50%";
    bar.style.left = "50%";
    bar.style.width = "0%";
    bar.style.background = "rgba(255,255,255,0.08)";
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

/* rewards bar heat */
function heatColor(p) {
  const t = clamp(p, 0, 100) / 100;
  return `rgb(${14 + (239 - 14) * t},${165 - 165 * t},${233 - 233 * t})`;
}

/* ===================== STATE ===================== */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 },
  w: { t: 0, open: 0, high: 0, low: 0 },
  m: { t: 0, open: 0, high: 0, low: 0 },
};
const tfReady = { d: false, w: false, m: false };

/* flash extremes (optional) */
const lastExtremes = {
  d: { low: null, high: null },
  w: { low: null, high: null },
  m: { low: null, high: null }
};
function flash(el) {
  if (!el) return;
  el.classList.remove("flash-yellow");
  void el.offsetWidth;
  el.classList.add("flash-yellow");
}

/* ===================== FETCH ===================== */
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

/* ===================== TIMERS & SOCKETS ===================== */
let accountPollTimer = null;
let restSyncTimer = null;
let chartSyncTimer = null;
let ensureChartTimer = null;

let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

function stopAllTimers() {
  if (accountPollTimer) { clearInterval(accountPollTimer); accountPollTimer = null; }
  if (restSyncTimer) { clearInterval(restSyncTimer); restSyncTimer = null; }
  if (chartSyncTimer) { clearInterval(chartSyncTimer); chartSyncTimer = null; }
  if (ensureChartTimer) { clearInterval(ensureChartTimer); ensureChartTimer = null; }
}
function startAllTimers() {
  stopAllTimers();
  accountPollTimer = setInterval(() => loadAccount(false), ACCOUNT_POLL_MS);
  restSyncTimer = setInterval(() => loadCandleSnapshot(false), REST_SYNC_MS);
  chartSyncTimer = setInterval(() => loadChartToday(false), CHART_SYNC_MS);
  ensureChartTimer = setInterval(ensureChartBootstrapped, 1500);
}

function stopAllSockets() {
  try { wsTrade?.close(); } catch {}
  try { wsKline?.close(); } catch {}
  wsTrade = null; wsKline = null;

  if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; }
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }

  wsTradeOnline = false;
  wsKlineOnline = false;
}

/* One-shot refresh (refresh mode) */
async function oneShotRefresh() {
  await loadCandleSnapshot(true);
  await loadChartToday(true);
  if (address) await loadAccount(true);
  refreshConnUI();
}

/* ===================== ACCOUNT (Injective LCD) ===================== */
let lastRewardsSeenForWithdraw = null;
let lastStakeSeenForType = null;
let lastRewardsSeenForType = null;

function inferStakeType(newStake, newRewards) {
  if (lastStakeSeenForType == null) return "START";
  const ds = safe(newStake) - safe(lastStakeSeenForType);
  if (ds === 0) return null;

  if (ds > 0) {
    if (lastRewardsSeenForType != null) {
      const dr = safe(lastRewardsSeenForType) - safe(newRewards);
      if (dr > REWARD_WITHDRAW_THRESHOLD) return "COMPOUND";
    }
    return "DELEGATE";
  }
  return "UNDELEGATE";
}

async function loadAccount(forceOnce = false) {
  if (!liveMode && !forceOnce) return;
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
  refreshConnUI();

  availableInj = safe(b.balances?.find(x => x.denom === "inj")?.amount) / 1e18;
  stakeInj = (s.delegation_responses || []).reduce((a, d) => a + safe(d.balance.amount), 0) / 1e18;
  rewardsInj = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  apr = safe(i.inflation) * 100;

  // 1) record withdrawal event
  if (lastRewardsSeenForWithdraw == null) lastRewardsSeenForWithdraw = rewardsInj;
  const diff = safe(lastRewardsSeenForWithdraw) - safe(rewardsInj);
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    addRewardWithdrawalPoint(address, diff);
  }
  lastRewardsSeenForWithdraw = rewardsInj;

  // 2) record stake point on EVERY change
  const type = inferStakeType(stakeInj, rewardsInj);
  addStakePoint(address, stakeInj, type || "");

  lastStakeSeenForType = stakeInj;
  lastRewardsSeenForType = rewardsInj;
}

/* ===================== BINANCE REST SNAPSHOT (1D/1W/1M) ===================== */
async function loadCandleSnapshot(forceOnce = false) {
  if (!liveMode && !forceOnce) return;
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
    if (candle.d.open && Number.isFinite(candle.d.high) && Number.isFinite(candle.d.low)) tfReady.d = true;
  }
  if (Array.isArray(w) && w[0]) {
    candle.w.t = safe(w[0][0]);
    candle.w.open = safe(w[0][1]);
    candle.w.high = safe(w[0][2]);
    candle.w.low  = safe(w[0][3]);
    if (candle.w.open && Number.isFinite(candle.w.high) && Number.isFinite(candle.w.low)) tfReady.w = true;
  }
  if (Array.isArray(m) && m[0]) {
    candle.m.t = safe(m[0][0]);
    candle.m.open = safe(m[0][1]);
    candle.m.high = safe(m[0][2]);
    candle.m.low  = safe(m[0][3]);
    if (candle.m.open && Number.isFinite(candle.m.high) && Number.isFinite(candle.m.low)) tfReady.m = true;
  }

  const root = $("appRoot");
  if (root && root.classList.contains("loading") && tfReady.d) {
    root.classList.remove("loading");
    root.classList.add("ready");
  }
}

/* ===================== AUTO-LOAD ZOOM PLUGIN ===================== */
async function ensureZoomPlugin() {
  // If already available, try register
  try {
    if (window.Chart && window.ChartZoom) {
      window.Chart.register(window.ChartZoom);
      return;
    }
  } catch {}

  // Load from CDN
  await new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });

  try {
    if (window.Chart && window.ChartZoom) window.Chart.register(window.ChartZoom);
  } catch {}
}

/* ===================== PRICE CHART 1D ===================== */
let priceChart = null;
let chartLabels = [];
let chartData = [];
let lastChartMinuteStart = 0;
let chartBootstrappedToday = false;

let hoverActive = false;
let hoverIndex = null;
let pinnedIndex = null;
let lastChartSign = "neutral";

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

function applyPriceChartColorBySign(sign) {
  if (!priceChart) return;
  const ds = priceChart.data.datasets?.[0];
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
  priceChart.update("none");
}

function updatePriceOverlayFromPinned() {
  const chartEl = $("chartPrice");
  const overlay = $("chartOverlay");
  if (!chartEl || !overlay || !priceChart) return;

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

  let idx = clamp(Math.round(+pinnedIndex), 0, ds.length - 1);
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

async function initPriceChart() {
  await ensureZoomPlugin();

  const canvas = $("priceChart");
  if (!canvas || !window.Chart) return;

  priceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        zoom: {
          pan: {
            enabled: true,
            mode: "x",
            threshold: 2,
            onPanComplete: ({ chart }) => {
              const xScale = chart.scales.x;
              const centerPx = (chart.chartArea.left + chart.chartArea.right) / 2;
              pinnedIndex = xScale.getValueForPixel(centerPx);
              updatePriceOverlayFromPinned();
            }
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
            onZoomComplete: ({ chart }) => {
              const xScale = chart.scales.x;
              const centerPx = (chart.chartArea.left + chart.chartArea.right) / 2;
              pinnedIndex = xScale.getValueForPixel(centerPx);
              updatePriceOverlayFromPinned();
            }
          }
        }
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" } }
      }
    },
    plugins: [verticalLinePlugin]
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
    const idx = getIndexFromEvent(evt);
    if (idx == null) return;

    hoverActive = true;
    hoverIndex = idx;

    pinnedIndex = idx;
    updatePriceOverlayFromPinned();
    priceChart.update("none");
  };

  const handleLeave = () => {
    hoverActive = false;
    hoverIndex = null;
    pinnedIndex = null;
    updatePriceOverlayFromPinned();
    priceChart.update("none");
  };

  canvas.addEventListener("mousemove", handleMove, { passive: true });
  canvas.addEventListener("mouseleave", handleLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => { handleMove(e); }, { passive: true });
  canvas.addEventListener("touchmove", (e) => { handleMove(e); }, { passive: true });
  canvas.addEventListener("touchend", handleLeave, { passive: true });
  canvas.addEventListener("touchcancel", handleLeave, { passive: true });
}

async function loadChartToday(forceOnce = false) {
  if (!liveMode && !forceOnce) return;
  if (!hasInternet()) return;
  if (!tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  chartLabels = kl.map(k => fmtHHMM(safe(k[0])));
  chartData = kl.map(k => safe(k[4]));

  lastChartMinuteStart = safe(kl[kl.length - 1][0]) || 0;
  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!priceChart && window.Chart) await initPriceChart();
  if (priceChart) {
    priceChart.data.labels = chartLabels;
    priceChart.data.datasets[0].data = chartData;
    priceChart.update("none");
  }

  chartBootstrappedToday = true;
}

function updateChartFrom1mKline(k) {
  if (!liveMode) return;
  if (!priceChart || !chartBootstrappedToday || !tfReady.d || !candle.d.t) return;

  const openTime = safe(k.t);
  const close = safe(k.c);
  if (!openTime || !close) return;
  if (openTime < candle.d.t) return;

  if (lastChartMinuteStart === openTime) {
    const idx = priceChart.data.datasets[0].data.length - 1;
    if (idx >= 0) {
      priceChart.data.datasets[0].data[idx] = close;
      priceChart.update("none");
    }
    return;
  }

  lastChartMinuteStart = openTime;

  priceChart.data.labels.push(fmtHHMM(openTime));
  priceChart.data.datasets[0].data.push(close);

  while (priceChart.data.labels.length > DAY_MINUTES) priceChart.data.labels.shift();
  while (priceChart.data.datasets[0].data.length > DAY_MINUTES) priceChart.data.datasets[0].data.shift();

  priceChart.update("none");
}

async function resetDayAndReloadChart(nextOpenTime) {
  chartBootstrappedToday = false;
  chartLabels = [];
  chartData = [];
  lastChartMinuteStart = 0;

  if (priceChart) {
    priceChart.data.labels = [];
    priceChart.data.datasets[0].data = [];
    priceChart.update("none");
  }

  if (nextOpenTime) candle.d.t = nextOpenTime;

  await loadCandleSnapshot(false);
  await loadChartToday(false);

  hoverActive = false;
  hoverIndex = null;
  pinnedIndex = null;
  updatePriceOverlayFromPinned();
}

async function ensureChartBootstrapped() {
  if (!liveMode) return;
  if (chartBootstrappedToday) return;

  if (!tfReady.d || !candle.d.t) await loadCandleSnapshot(false);
  if (tfReady.d && candle.d.t) await loadChartToday(false);
}

/* ===================== BINANCE WS TRADE ===================== */
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

  wsTrade.onopen = () => { wsTradeOnline = true; refreshConnUI(); clearTradeRetry(); };
  wsTrade.onclose = () => { wsTradeOnline = false; refreshConnUI(); scheduleTradeRetry(); };
  wsTrade.onerror = () => { wsTradeOnline = false; refreshConnUI(); try { wsTrade.close(); } catch {} scheduleTradeRetry(); };

  wsTrade.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = safe(msg.p);
    if (!p) return;

    targetPrice = p;

    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}

/* ===================== BINANCE WS KLINES ===================== */
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

  wsKline.onopen = () => { wsKlineOnline = true; refreshConnUI(); clearKlineRetry(); };
  wsKline.onclose = () => { wsKlineOnline = false; refreshConnUI(); scheduleKlineRetry(); };
  wsKline.onerror = () => { wsKlineOnline = false; refreshConnUI(); try { wsKline.close(); } catch {} scheduleKlineRetry(); };

  wsKline.onmessage = async (e) => {
    const payload = JSON.parse(e.data);
    const data = payload.data;
    if (!data || !data.k) return;

    const stream = payload.stream || "";
    const k = data.k;

    if (stream.includes("@kline_1m")) {
      updateChartFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) {
      const prevDayOpen = candle.d.t;
      applyKline("d", k);

      if (!chartBootstrappedToday && tfReady.d && candle.d.t) {
        await loadChartToday(false);
      }

      if (k.x === true) {
        const nextOpen = safe(k.T) ? (safe(k.T) + 1) : 0;
        await resetDayAndReloadChart(nextOpen || (prevDayOpen + 24 * 60 * 60 * 1000));
      } else {
        if (prevDayOpen && candle.d.t && candle.d.t !== prevDayOpen) {
          await resetDayAndReloadChart(candle.d.t);
        }
      }
    }
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    const root = $("appRoot");
    if (root && root.classList.contains("loading") && tfReady.d) {
      root.classList.remove("loading");
      root.classList.add("ready");
    }
  };
}

/* =========================================================
   PERSISTENCE — Chunked append-only
========================================================= */
function storageBase(prefix, addr) {
  const a = (addr || "").trim();
  return a ? `${prefix}_v${STORE_VER}_${a}` : null;
}
function metaKey(prefix, addr) {
  const b = storageBase(prefix, addr);
  return b ? `${b}__meta` : null;
}
function chunkKey(prefix, addr, idx) {
  const b = storageBase(prefix, addr);
  return b ? `${b}__chunk_${idx}` : null;
}
function readMeta(prefix, addr) {
  const k = metaKey(prefix, addr);
  if (!k) return { chunks: 0, total: 0 };
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return { chunks: 0, total: 0 };
    const m = JSON.parse(raw);
    return {
      chunks: Math.max(0, parseInt(m?.chunks || 0, 10)),
      total: Math.max(0, parseInt(m?.total || 0, 10))
    };
  } catch {
    return { chunks: 0, total: 0 };
  }
}
function writeMeta(prefix, addr, meta) {
  const k = metaKey(prefix, addr);
  if (!k) return true;
  try {
    localStorage.setItem(k, JSON.stringify(meta));
    return true;
  } catch (e) {
    console.warn("[storage] META save failed (quota?)", e);
    return false;
  }
}
function readChunk(prefix, addr, idx) {
  const k = chunkKey(prefix, addr, idx);
  if (!k) return [];
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function writeChunk(prefix, addr, idx, arr) {
  const k = chunkKey(prefix, addr, idx);
  if (!k) return true;
  try {
    localStorage.setItem(k, JSON.stringify(arr));
    return true;
  } catch (e) {
    console.warn("[storage] CHUNK save failed (quota?)", e);
    return false;
  }
}
function appendPoint(prefix, addr, pointObj) {
  const meta = readMeta(prefix, addr);

  let chunkIdx = Math.max(0, meta.chunks - 1);
  let chunk = meta.chunks > 0 ? readChunk(prefix, addr, chunkIdx) : [];

  if (chunk.length >= CHUNK_SIZE || meta.chunks === 0) {
    chunkIdx = meta.chunks;
    chunk = [];
    meta.chunks += 1;
  }

  chunk.push(pointObj);
  meta.total += 1;

  const ok1 = writeChunk(prefix, addr, chunkIdx, chunk);
  const ok2 = writeMeta(prefix, addr, meta);

  return ok1 && ok2;
}
function loadAllPoints(prefix, addr) {
  const meta = readMeta(prefix, addr);
  const out = [];
  for (let i = 0; i < meta.chunks; i++) {
    out.push(...readChunk(prefix, addr, i));
  }
  return out;
}

/* =========================================================
   NO-OVERLAP WINDOWING
========================================================= */
function ensureReadableWindow(ch, minPxPerPoint, maxLabels = MAX_LABELS_VISIBLE) {
  if (!ch) return;
  const ds = ch.data.datasets?.[0];
  const n = ds?.data?.length || 0;
  if (n <= 1) return;

  const area = ch.chartArea;
  if (!area || !area.width) return;

  const maxByPx = Math.max(2, Math.floor(area.width / minPxPerPoint));
  const maxVisible = Math.max(2, Math.min(maxByPx, maxLabels));

  const xmax = n - 1;
  const xScale = ch.scales?.x;
  if (!xScale) return;

  const curMin = Number.isFinite(xScale.min) ? xScale.min : 0;
  const curMax = Number.isFinite(xScale.max) ? xScale.max : xmax;
  const visibleNow = Math.floor(curMax - curMin + 1);

  // se troppi punti visibili -> forza finestra leggibile sugli ultimi maxVisible
  if (visibleNow > maxVisible) {
    const xmin = Math.max(0, xmax - maxVisible + 1);
    ch.options.scales.x.min = xmin;
    ch.options.scales.x.max = xmax;
    ch.update("none");
  }
}

/* =========================================================
   LABEL PLUGIN — clipped inside chartArea (never invades Y axis)
========================================================= */
function makeClippedPointLabelPlugin({ id, getLabel, font = "800 11px Inter, sans-serif" }) {
  return {
    id,
    afterDatasetsDraw(ch) {
      const ds = ch.data.datasets?.[0];
      if (!ds) return;

      const meta = ch.getDatasetMeta(0);
      const els = meta?.data || [];
      if (!els.length) return;

      const area = ch.chartArea;
      if (!area) return;

      const ctx = ch.ctx;
      ctx.save();

      // CLIP inside chart area => never touches Y axis column
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();

      ctx.font = font;
      ctx.fillStyle = (document.body?.dataset?.theme === "light")
        ? "rgba(17,24,39,0.88)"
        : "rgba(249,250,251,0.92)";
      ctx.textBaseline = "bottom";

      const xScale = ch.scales?.x;
      let min = Number.isFinite(xScale?.min) ? Math.floor(xScale.min) : 0;
      let max = Number.isFinite(xScale?.max) ? Math.ceil(xScale.max) : (els.length - 1);
      min = clamp(min, 0, els.length - 1);
      max = clamp(max, 0, els.length - 1);

      for (let i = min; i <= max; i++) {
        const el = els[i];
        if (!el) continue;

        const label = getLabel(i, ds.data[i]);
        if (!label) continue;

        let x = el.x;
        const y = el.y - 6;

        const pad = 6;
        const w = ctx.measureText(label).width;

        if (x - w / 2 < area.left + pad) {
          ctx.textAlign = "left";
          x = area.left + pad;
        } else if (x + w / 2 > area.right - pad) {
          ctx.textAlign = "right";
          x = area.right - pad;
        } else {
          ctx.textAlign = "center";
        }

        ctx.fillText(label, x, y);
      }

      ctx.restore();
    }
  };
}

/* =========================================================
   STAKE CHART — all points, step=1, no overlap, persistence
========================================================= */
let stakeChart = null;
let stakePoints = []; // {t,label,value,type}

const stakeLabelPlugin = makeClippedPointLabelPlugin({
  id: "stakeLabelPlugin",
  getLabel: (i) => (stakePoints[i]?.type ? String(stakePoints[i].type).toUpperCase() : "")
});

async function initStakeChart() {
  await ensureZoomPlugin();

  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: stakePoints.map(p => p.label),
      datasets: [{
        data: stakePoints.map(p => p.value),
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        tension: 0.22,
        pointRadius: 4,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { left: 10, right: 6, top: 8, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            title: (items) => stakePoints[items?.[0]?.dataIndex ?? 0]?.label || "",
            label: (item) => {
              const i = item.dataIndex ?? 0;
              const t = stakePoints[i]?.type ? ` • ${stakePoints[i].type}` : "";
              return `Staked • ${safe(item.raw).toFixed(6)} INJ${t}`;
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: "x", threshold: 2 },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#9ca3af",
            padding: 10,
            stepSize: 1,
            callback: (v) => String(Math.round(v))
          }
        }
      }
    },
    plugins: [stakeLabelPlugin]
  });

  ensureReadableWindow(stakeChart, MIN_PX_PER_POINT_STAKE);

  canvas.addEventListener("wheel", () => setTimeout(() => ensureReadableWindow(stakeChart, MIN_PX_PER_POINT_STAKE), 0), { passive: true });
  canvas.addEventListener("touchend", () => setTimeout(() => ensureReadableWindow(stakeChart, MIN_PX_PER_POINT_STAKE), 0), { passive: true });
}

function redrawStakeChart() {
  if (!stakeChart) return;
  stakeChart.data.labels = stakePoints.map(p => p.label);
  stakeChart.data.datasets[0].data = stakePoints.map(p => p.value);
  stakeChart.update("none");
  ensureReadableWindow(stakeChart, MIN_PX_PER_POINT_STAKE);
}

function loadStakePointsForAddress(addr) {
  stakePoints = loadAllPoints("inj_stake_points", addr)
    .filter(p => p && Number.isFinite(+p.value))
    .map(p => ({
      t: safe(p.t) || 0,
      label: p.label || "",
      value: safe(p.value),
      type: p.type || ""
    }));
}

function addStakePoint(addr, stakeValue, typeLabel) {
  const s = safe(stakeValue);
  if (!Number.isFinite(s)) return;

  if (stakePoints.length) {
    const prev = safe(stakePoints[stakePoints.length - 1].value);
    if (s === prev) return; // ogni cambiamento -> punto, identico -> no
  }

  const point = { t: nowTS(), label: nowLabel(), value: s, type: typeLabel || "" };
  stakePoints.push(point);

  const ok = appendPoint("inj_stake_points", addr, point);
  if (!ok) console.warn("[stake] localStorage quota? point NOT saved");

  if (!stakeChart) initStakeChart().then(() => redrawStakeChart());
  else redrawStakeChart();
}

/* =========================================================
   REWARD WITHDRAWALS CHART — all points, label visible, no overlap, step=1, persistence
========================================================= */
let rewardChart = null;
let rewardPoints = []; // {t,label,value}

const rewardLabelPlugin = makeClippedPointLabelPlugin({
  id: "rewardLabelPlugin",
  getLabel: (i, v) => {
    const val = safe(v);
    if (!val) return "";
    return `+${val.toFixed(4)} INJ`;
  }
});

async function initRewardChart() {
  await ensureZoomPlugin();

  const canvas = $("rewardChart");
  if (!canvas || !window.Chart) return;

  rewardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: rewardPoints.map(p => p.label),
      datasets: [{
        data: rewardPoints.map(p => p.value),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        tension: 0.25,
        pointRadius: 4,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { left: 10, right: 6, top: 8, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            title: (items) => rewardPoints[items?.[0]?.dataIndex ?? 0]?.label || "",
            label: (item) => `Withdrawn • +${safe(item.raw).toFixed(6)} INJ`
          }
        },
        zoom: {
          pan: { enabled: true, mode: "x", threshold: 2 },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#9ca3af",
            padding: 10,
            stepSize: 1,
            callback: (v) => String(Math.round(v))
          }
        }
      }
    },
    plugins: [rewardLabelPlugin]
  });

  ensureReadableWindow(rewardChart, MIN_PX_PER_POINT_REWARD);

  canvas.addEventListener("wheel", () => setTimeout(() => ensureReadableWindow(rewardChart, MIN_PX_PER_POINT_REWARD), 0), { passive: true });
  canvas.addEventListener("touchend", () => setTimeout(() => ensureReadableWindow(rewardChart, MIN_PX_PER_POINT_REWARD), 0), { passive: true });
}

function redrawRewardChart() {
  if (!rewardChart) return;
  rewardChart.data.labels = rewardPoints.map(p => p.label);
  rewardChart.data.datasets[0].data = rewardPoints.map(p => p.value);
  rewardChart.update("none");
  ensureReadableWindow(rewardChart, MIN_PX_PER_POINT_REWARD);
}

function loadRewardPointsForAddress(addr) {
  rewardPoints = loadAllPoints("inj_reward_withdrawals", addr)
    .filter(p => p && Number.isFinite(+p.value))
    .map(p => ({
      t: safe(p.t) || 0,
      label: p.label || "",
      value: safe(p.value)
    }));
}

function addRewardWithdrawalPoint(addr, amount) {
  const v = safe(amount);
  if (!Number.isFinite(v) || v <= 0) return;

  const point = { t: nowTS(), label: nowLabel(), value: v };
  rewardPoints.push(point);

  const ok = appendPoint("inj_reward_withdrawals", addr, point);
  if (!ok) console.warn("[reward] localStorage quota? point NOT saved");

  if (!rewardChart) initRewardChart().then(() => redrawRewardChart());
  else redrawRewardChart();
}

/* ===================== ADDRESS COMMIT ===================== */
function commitAddress(newAddr) {
  const a = (newAddr || "").trim();
  if (!a) return;

  address = a;
  pendingAddress = a;
  localStorage.setItem("inj_address", address);
  setAddressDisplay(address);

  // reset smoothing
  settleStart = Date.now();
  displayed.available = 0;
  displayed.stake = 0;
  displayed.rewards = 0;

  // reset withdraw detector
  lastRewardsSeenForWithdraw = null;

  // load charts from storage for this address (no loss)
  loadStakePointsForAddress(address);
  loadRewardPointsForAddress(address);

  if (stakeChart) redrawStakeChart(); else initStakeChart().then(() => redrawStakeChart());
  if (rewardChart) redrawRewardChart(); else initRewardChart().then(() => redrawRewardChart());

  // refresh data
  if (liveMode) {
    loadAccount(false);
    startTradeWS();
    startKlineWS();
  } else {
    oneShotRefresh().catch(() => {});
  }

  refreshConnUI();
}

/* ===================== MAIN ANIMATION LOOP ===================== */
function animate() {
  /* PRICE card */
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  /* PERF */
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  /* price chart color by 24h sign */
  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "neutral");
  if (sign !== lastChartSign) {
    lastChartSign = sign;
    applyPriceChartColorBySign(sign);
  }

  /* bars gradients */
  const dUp   = "linear-gradient(to right, rgba(34,197,94,.95), rgba(16,185,129,.85))";
  const dDown = "linear-gradient(to left,  rgba(239,68,68,.95), rgba(248,113,113,.85))";
  const wUp   = "linear-gradient(to right, rgba(59,130,246,.95), rgba(99,102,241,.82))";
  const wDown = "linear-gradient(to left,  rgba(239,68,68,.90), rgba(59,130,246,.55))";
  const mUp   = "linear-gradient(to right, rgba(249,115,22,.92), rgba(236,72,153,.78))";
  const mDown = "linear-gradient(to left,  rgba(239,68,68,.90), rgba(236,72,153,.55))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"),  $("weekLine"),  targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);

  /* bar numbers + flash extremes */
  const pMinEl = $("priceMin"), pMaxEl = $("priceMax");
  const wMinEl = $("weekMin"),  wMaxEl = $("weekMax");
  const mMinEl = $("monthMin"), mMaxEl = $("monthMax");

  if (tfReady.d) {
    const low = safe(candle.d.low), high = safe(candle.d.high);
    $("priceMin").textContent  = low.toFixed(3);
    $("priceOpen").textContent = safe(candle.d.open).toFixed(3);
    $("priceMax").textContent  = high.toFixed(3);

    if (lastExtremes.d.low !== null && low !== lastExtremes.d.low) flash(pMinEl);
    if (lastExtremes.d.high !== null && high !== lastExtremes.d.high) flash(pMaxEl);
    lastExtremes.d.low = low; lastExtremes.d.high = high;
  } else {
    $("priceMin").textContent = "--";
    $("priceOpen").textContent = "--";
    $("priceMax").textContent = "--";
  }

  if (tfReady.w) {
    const low = safe(candle.w.low), high = safe(candle.w.high);
    $("weekMin").textContent   = low.toFixed(3);
    $("weekOpen").textContent  = safe(candle.w.open).toFixed(3);
    $("weekMax").textContent   = high.toFixed(3);

    if (lastExtremes.w.low !== null && low !== lastExtremes.w.low) flash(wMinEl);
    if (lastExtremes.w.high !== null && high !== lastExtremes.w.high) flash(wMaxEl);
    lastExtremes.w.low = low; lastExtremes.w.high = high;
  } else {
    $("weekMin").textContent = "--";
    $("weekOpen").textContent = "--";
    $("weekMax").textContent = "--";
  }

  if (tfReady.m) {
    const low = safe(candle.m.low), high = safe(candle.m.high);
    $("monthMin").textContent  = low.toFixed(3);
    $("monthOpen").textContent = safe(candle.m.open).toFixed(3);
    $("monthMax").textContent  = high.toFixed(3);

    if (lastExtremes.m.low !== null && low !== lastExtremes.m.low) flash(mMinEl);
    if (lastExtremes.m.high !== null && high !== lastExtremes.m.high) flash(mMaxEl);
    lastExtremes.m.low = low; lastExtremes.m.high = high;
  } else {
    $("monthMin").textContent = "--";
    $("monthOpen").textContent = "--";
    $("monthMax").textContent = "--";
  }

  /* AVAILABLE */
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  const availableUsd = $("availableUsd");
  if (availableUsd) availableUsd.textContent = `≈ $${(displayed.available * displayed.price).toFixed(2)}`;

  /* STAKE */
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  const stakeUsd = $("stakeUsd");
  if (stakeUsd) stakeUsd.textContent = `≈ $${(displayed.stake * displayed.price).toFixed(2)}`;

  const stakePct = clamp((displayed.stake / STAKE_TARGET_MAX) * 100, 0, 100);
  const stakeBar = $("stakeBar");
  const stakeLine = $("stakeLine");
  const stakePercent = $("stakePercent");
  if (stakeBar) stakeBar.style.width = stakePct + "%";
  if (stakeLine) stakeLine.style.left = stakePct + "%";
  if (stakePercent) stakePercent.textContent = stakePct.toFixed(1) + "%";

  const stakeMin = $("stakeMin");
  const stakeMax = $("stakeMax");
  if (stakeMin) stakeMin.textContent = "0";
  if (stakeMax) stakeMax.textContent = String(STAKE_TARGET_MAX);

  /* REWARDS */
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  const rewardsUsd = $("rewardsUsd");
  if (rewardsUsd) rewardsUsd.textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

  const maxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  const rewardBar = $("rewardBar");
  const rewardLine = $("rewardLine");
  const rewardPercent = $("rewardPercent");
  if (rewardBar) {
    rewardBar.style.width = rp + "%";
    rewardBar.style.background = heatColor(rp);
  }
  if (rewardLine) rewardLine.style.left = rp + "%";
  if (rewardPercent) rewardPercent.textContent = rp.toFixed(1) + "%";

  const rewardMin = $("rewardMin");
  const rewardMax = $("rewardMax");
  if (rewardMin) rewardMin.textContent = "0";
  if (rewardMax) rewardMax.textContent = maxR.toFixed(1);

  /* APR */
  const aprEl = $("apr");
  if (aprEl) aprEl.textContent = safe(apr).toFixed(2) + "%";

  /* Updated */
  const upd = $("updated");
  if (upd) upd.textContent = "Last update: " + nowLabel();

  requestAnimationFrame(animate);
}

/* ===================== BOOT ===================== */
(async function boot() {
  // initial UI
  if (liveIcon) liveIcon.textContent = liveMode ? "📡" : "⟳";
  if (modeHint) modeHint.textContent = `Mode: ${liveMode ? "LIVE" : "REFRESH"}`;
  setAddressDisplay(address);
  refreshConnUI();

  // load saved points for current address (no loss)
  if (address) {
    loadStakePointsForAddress(address);
    loadRewardPointsForAddress(address);
    // init charts
    await initStakeChart();
    await initRewardChart();
    redrawStakeChart();
    redrawRewardChart();
  }

  // load price snapshots + chart once
  await loadCandleSnapshot(true);
  await loadChartToday(true);

  // mode start
  if (liveMode) {
    startTradeWS();
    startKlineWS();
    startAllTimers();
    if (address) loadAccount(false);
  } else {
    stopAllTimers();
    stopAllSockets();
    if (address) await loadAccount(true);
    refreshConnUI();
  }

  // start UI loop
  animate();
})();

/* expose commitAddress for debug */
window.commitAddress = commitAddress;
