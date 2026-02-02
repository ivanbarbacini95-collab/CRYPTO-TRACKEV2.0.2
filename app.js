/* =========================================================
   Injective • Portfolio — app.js (UI + Data + LIVE/REFRESH)
========================================================= */

/* ===================== CONFIG ===================== */
const INITIAL_SETTLE_TIME = 4200;

const ACCOUNT_POLL_MS = 2500;
const REST_SYNC_MS = 60_000;
const CHART_SYNC_MS = 60_000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

const STAKE_TARGET_MAX = 1000;

const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ (drop -> withdrawal point)
const STORE_VER = 1;
const CHUNK_SIZE = 220;

const STAKE_PAD = 6; // requested
const REWARD_PAD = 1;

const MIN_PX_PER_POINT_STAKE = 46;
const MIN_PX_PER_POINT_REWARD = 56;
const MAX_LABELS_VISIBLE = 80;

/* ===================== HELPERS ===================== */
const $ = (id) => document.getElementById(id);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function nowLabel() { return new Date().toLocaleTimeString(); }
function nowTS() { return Date.now(); }
function hasInternet() { return navigator.onLine === true; }

/* Inject tiny CSS for flash + safety (if not present) */
(function injectFlashCSS() {
  const id = "inj_flash_css";
  if (document.getElementById(id)) return;
  const st = document.createElement("style");
  st.id = id;
  st.textContent = `
    .flash-yellow { animation: injFlashYellow 650ms ease; }
    @keyframes injFlashYellow {
      0% { transform: scale(1); }
      30% { transform: scale(1.12); color: #facc15; }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(st);
})();

/* ===================== THEME ===================== */
const THEME_KEY = "inj_theme";
function getTheme() { return localStorage.getItem(THEME_KEY) || "dark"; }
function setTheme(t) { localStorage.setItem(THEME_KEY, t); applyTheme(); }
function applyTheme() {
  const t = getTheme();
  document.body.dataset.theme = t;
  const icon = $("themeIcon");
  if (icon) icon.textContent = t === "light" ? "☀️" : "🌙";
  const iconRow = $("themeIconRow");
  if (iconRow) iconRow.textContent = t === "light" ? "☀️" : "🌙";
}
applyTheme();

/* ===================== MODE (LIVE/REFRESH) ===================== */
const MODE_KEY = "inj_mode";
function getMode() { return localStorage.getItem(MODE_KEY) || "live"; } // "live" | "refresh"
function setMode(m) { localStorage.setItem(MODE_KEY, m); applyModeUI(); restartMode(); }
function applyModeUI() {
  const icon = $("liveIcon");
  const hint = $("modeHint");
  const m = getMode();
  if (icon) icon.textContent = (m === "live") ? "📡" : "🔄";
  if (hint) hint.textContent = `Mode: ${(m === "live") ? "LIVE" : "REFRESH"}`;
  const iconRow = $("liveIconRow");
  if (iconRow) iconRow.textContent = (m === "live") ? "📡" : "🔄";
}
applyModeUI();

/* ===================== CONNECTION UI (3-states) ===================== */
const statusDot = $("statusDot");
const statusText = $("statusText");
let loadingCount = 0;

function setConnState(state) {
  if (!statusDot || !statusText) return;

  statusDot.classList.remove("online", "offline", "loading");

  if (state === "loading") {
    statusDot.classList.add("loading");
    statusText.textContent = "Loading";
    return;
  }

  if (state === "online") {
    statusDot.classList.add("online");
    statusText.textContent = "Online";
    return;
  }

  statusDot.classList.add("offline");
  statusText.textContent = "Offline";
}

function refreshConnUI() {
  if (!hasInternet()) {
    setConnState("offline");
    return;
  }
  setConnState(loadingCount > 0 ? "loading" : "online");
}

function beginLoading() {
  loadingCount++;
  refreshConnUI();
}
function endLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  refreshConnUI();
}

window.addEventListener("online", () => {
  refreshConnUI();
  if (getMode() === "live") restartMode();
}, { passive: true });

window.addEventListener("offline", refreshConnUI, { passive: true });

refreshConnUI();

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

/* Colored digits */
function colorNumber(el, n, o, d) {
  if (!el) return;
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) { el.textContent = ns; return; }
  const baseColor = (document.body.dataset.theme === "light") ? "#111827" : "#f9fafb";
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i] ? (n > o ? "#22c55e" : "#ef4444") : baseColor;
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

/* ===================== PERF ===================== */
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
function heatColor(p) {
  const t = clamp(p, 0, 100) / 100;
  return `rgb(${14 + (239 - 14) * t},${165 - 165 * t},${233 - 233 * t})`;
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

/* =========================================================
   UI: DRAWER MENU + BACKDROP + NAV
========================================================= */
const appRoot = $("appRoot");
const menuBtn = $("menuBtn");
const drawer = $("drawer");
const backdrop = $("backdrop");
const drawerNav = $("drawerNav");

function openDrawer() {
  drawer?.classList.add("show");
  backdrop?.classList.add("show");
  drawer?.setAttribute("aria-hidden", "false");
  backdrop?.setAttribute("aria-hidden", "false");
  appRoot?.classList.add("blurred");
}
function closeDrawer() {
  drawer?.classList.remove("show");
  backdrop?.classList.remove("show");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.setAttribute("aria-hidden", "true");
  appRoot?.classList.remove("blurred");
}

menuBtn?.addEventListener("click", () => {
  if (drawer?.classList.contains("show")) closeDrawer();
  else openDrawer();
});
backdrop?.addEventListener("click", closeDrawer);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
}, { passive: true });

drawerNav?.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-item");
  if (!btn) return;

  [...drawerNav.querySelectorAll(".nav-item")].forEach(x => x.classList.remove("active"));
  btn.classList.add("active");

  const targetId = btn.getAttribute("data-scroll");
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  closeDrawer();
});

$("themeToggle")?.addEventListener("click", () => {
  setTheme(getTheme() === "dark" ? "light" : "dark");
});

$("liveToggle")?.addEventListener("click", () => {
  setMode(getMode() === "live" ? "refresh" : "live");
});

/* Drawer action rows -> trigger toggles */
$("themeToggleRow")?.addEventListener("click", () => $("themeToggle")?.click());
$("liveToggleRow")?.addEventListener("click", () => $("liveToggle")?.click());

/* =========================================================
   UI: SEARCH (expand/collapse minimal)
========================================================= */
let address = localStorage.getItem("inj_address") || "";

const searchWrap = $("searchWrap");
const addressInput = $("addressInput");
const searchBtn = $("searchBtn");
const addressDisplay = $("addressDisplay");

/* short address 6 + 6 */
function shortAddr6x6(addr) {
  const a = String(addr || "").trim();
  if (!a) return "";
  if (a.length <= 16) return a;
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

function setAddressDisplay(addr) {
  if (!addressDisplay) return;
  const full = (addr || "").trim();
  addressDisplay.textContent = full ? shortAddr6x6(full) : "";
  addressDisplay.title = full || "";
}
setAddressDisplay(address);

function expandSearch() {
  if (!searchWrap || !addressInput) return;
  searchWrap.classList.add("expanded");
  addressInput.focus();
}
function collapseSearch() {
  if (!searchWrap) return;
  searchWrap.classList.remove("expanded");
}

function commitAddress(next) {
  const a = (next || "").trim();
  if (!a) { collapseSearch(); return; }

  address = a;
  localStorage.setItem("inj_address", address);
  setAddressDisplay(address);

  settleStart = Date.now();

  // reset some state for new address
  lastRewardsSeenForWithdraw = null;
  lastStakeForType = null;
  lastRewardsForType = null;

  // load persisted points for address
  loadStakePointsForAddress(address);
  loadRewardPointsForAddress(address);

  // rebuild charts
  if (stakeChart) redrawStakeChart();
  if (rewardChart) rebuildRewardView(true);

  beginLoading();
  bootstrapOnce();

  collapseSearch();
}

if (addressInput) {
  addressInput.value = address || "";

  addressInput.addEventListener("focus", expandSearch, { passive: true });

  addressInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAddress(addressInput.value);
    } else if (e.key === "Escape") {
      collapseSearch();
    }
  });
}

if (searchBtn) {
  searchBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!searchWrap?.classList.contains("expanded")) {
      expandSearch();
      return;
    }
    commitAddress(addressInput?.value);
  });
}

document.addEventListener("click", (e) => {
  if (!searchWrap?.classList.contains("expanded")) return;
  const inside = searchWrap.contains(e.target);
  if (!inside) collapseSearch();
}, { passive: true });

/* =========================================================
   PERSISTENCE (chunked append-only)
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
  try { localStorage.setItem(k, JSON.stringify(meta)); return true; }
  catch { return false; }
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
  try { localStorage.setItem(k, JSON.stringify(arr)); return true; }
  catch { return false; }
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
  for (let i = 0; i < meta.chunks; i++) out.push(...readChunk(prefix, addr, i));
  return out;
}

/* =========================================================
   CHART window + autoscale Y on visible
========================================================= */
function ensureReadableWindow(ch, minPxPerPoint, maxLabels = MAX_LABELS_VISIBLE) {
  if (!ch) return;
  const ds = ch.data.datasets?.[0];
  const n = ds?.data?.length || 0;
  if (n <= 2) return;

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

  if (visibleNow > maxVisible) {
    const xmin = Math.max(0, xmax - maxVisible + 1);
    ch.options.scales.x.min = xmin;
    ch.options.scales.x.max = xmax;
    ch.update("none");
  }
}
function visibleIndexRange(ch, n) {
  const xScale = ch?.scales?.x;
  if (!xScale || !n) return { min: 0, max: Math.max(0, n - 1) };

  let min = Number.isFinite(xScale.min) ? Math.floor(xScale.min) : 0;
  let max = Number.isFinite(xScale.max) ? Math.ceil(xScale.max) : (n - 1);

  min = clamp(min, 0, n - 1);
  max = clamp(max, 0, n - 1);
  if (max < min) [min, max] = [max, min];
  return { min, max };
}
function autoScaleYOnVisible(ch, valuesArray, pad, { floorAtZero = false, minSpan = 2 } = {}) {
  if (!ch) return;
  const n = valuesArray?.length || 0;
  if (n < 1) return;

  const { min: i0, max: i1 } = visibleIndexRange(ch, n);

  let vMin = Infinity, vMax = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const v = safe(valuesArray[i]);
    if (!Number.isFinite(v)) continue;
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax)) return;

  let min = Math.floor(vMin - pad);
  let max = Math.ceil(vMax + pad);

  if (floorAtZero) min = Math.max(0, min);
  if (max - min < minSpan) max = min + minSpan;

  ch.options.scales.y.min = min;
  ch.options.scales.y.max = max;
}

/* =========================================================
   CLIPPED point labels plugin
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

      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();

      ctx.font = font;
      ctx.fillStyle = (document.body.dataset.theme === "light")
        ? "rgba(17,24,39,0.88)"
        : "rgba(249,250,251,0.92)";
      ctx.textBaseline = "bottom";

      const n = els.length;
      const { min, max } = visibleIndexRange(ch, n);

      for (let i = min; i <= max; i++) {
        const el = els[i];
        if (!el) continue;

        const label = getLabel(i, ds.data[i]);
        if (!label) continue;

        let x = el.x;
        const y = el.y - 6;

        const pad = 6;
        const w = ctx.measureText(label).width;

        if (x - w / 2 < area.left + pad) { ctx.textAlign = "left"; x = area.left + pad; }
        else if (x + w / 2 > area.right - pad) { ctx.textAlign = "right"; x = area.right - pad; }
        else { ctx.textAlign = "center"; }

        ctx.fillText(label, x, y);
      }

      ctx.restore();
    }
  };
}

/* =========================================================
   STATE
========================================================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 },
  w: { t: 0, open: 0, high: 0, low: 0 },
  m: { t: 0, open: 0, high: 0, low: 0 },
};
const tfReady = { d: false, w: false, m: false };

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

/* =========================================================
   STAKE chart (persisted)
========================================================= */
let stakeChart = null;
let stakePoints = []; // {t,label,value,type}

const stakeLabelPlugin = makeClippedPointLabelPlugin({
  id: "stakeLabelPlugin",
  getLabel: (i) => (stakePoints[i]?.type ? String(stakePoints[i].type).toUpperCase() : "")
});

function loadStakePointsForAddress(addr) {
  stakePoints = loadAllPoints("inj_stake_points", addr)
    .filter(p => p && Number.isFinite(+p.value))
    .map(p => ({ t: safe(p.t) || 0, label: p.label || "", value: safe(p.value), type: p.type || "" }));
}

function inferStakeType(newStake, newRewards) {
  if (lastStakeForType == null) return "START";
  const ds = safe(newStake) - safe(lastStakeForType);
  if (ds === 0) return null;

  if (ds > 0) {
    if (lastRewardsForType != null) {
      const dr = safe(lastRewardsForType) - safe(newRewards);
      if (dr > REWARD_WITHDRAW_THRESHOLD) return "COMPOUND";
    }
    return "DELEGATE";
  }
  return "UNDELEGATE";
}

function addStakePoint(addr, stakeValue, typeLabel) {
  const s = safe(stakeValue);
  if (!Number.isFinite(s) || !addr) return;

  if (stakePoints.length) {
    const prev = safe(stakePoints[stakePoints.length - 1].value);
    if (s === prev) return; // only changes
  }

  const point = { t: nowTS(), label: nowLabel(), value: s, type: typeLabel || "" };
  stakePoints.push(point);
  appendPoint("inj_stake_points", addr, point);

  if (!stakeChart) initStakeChart();
  else redrawStakeChart();
}

function initStakeChart() {
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
          pan: {
            enabled: true,
            mode: "x",
            threshold: 2,
            onPanComplete: ({ chart }) => {
              ensureReadableWindow(chart, MIN_PX_PER_POINT_STAKE);
              autoScaleYOnVisible(chart, chart.data.datasets[0].data, STAKE_PAD, { floorAtZero: false, minSpan: 2 });
              chart.update("none");
            }
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
            onZoomComplete: ({ chart }) => {
              ensureReadableWindow(chart, MIN_PX_PER_POINT_STAKE);
              autoScaleYOnVisible(chart, chart.data.datasets[0].data, STAKE_PAD, { floorAtZero: false, minSpan: 2 });
              chart.update("none");
            }
          }
        }
      },
      scales: {
        x: { display: false },
        y: {
          beginAtZero: false,
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
  autoScaleYOnVisible(stakeChart, stakeChart.data.datasets[0].data, STAKE_PAD, { floorAtZero: false, minSpan: 2 });
  stakeChart.update("none");
}

function redrawStakeChart() {
  if (!stakeChart) return;
  stakeChart.data.labels = stakePoints.map(p => p.label);
  stakeChart.data.datasets[0].data = stakePoints.map(p => p.value);

  ensureReadableWindow(stakeChart, MIN_PX_PER_POINT_STAKE);
  autoScaleYOnVisible(stakeChart, stakeChart.data.datasets[0].data, STAKE_PAD, { floorAtZero: false, minSpan: 2 });

  stakeChart.update("none");
}

/* =========================================================
   REWARD withdrawals chart (persisted) + filter + timeline + LIVE
========================================================= */
let rewardChart = null;
let rewardPointsAll = [];
let rewardPointsView = [];
let rewardFollowLive = true;

const rewardLabelPlugin = makeClippedPointLabelPlugin({
  id: "rewardLabelPlugin",
  getLabel: (i, v) => {
    const val = safe(v);
    if (!val) return "";
    return `+${val.toFixed(4)} INJ`;
  }
});

const rewardFilterEl = $("rewardFilter");
const rewardTimelineEl = $("rewardTimeline");
const rewardTimelineMeta = $("rewardTimelineMeta");
const rewardLiveBtn = $("rewardLiveBtn");

function loadRewardPointsForAddress(addr) {
  rewardPointsAll = loadAllPoints("inj_reward_withdrawals", addr)
    .filter(p => p && Number.isFinite(+p.value))
    .map(p => ({ t: safe(p.t) || 0, label: p.label || "", value: safe(p.value) }));
}

function addRewardWithdrawalPoint(addr, amount) {
  const v = safe(amount);
  if (!Number.isFinite(v) || v <= 0 || !addr) return;

  const point = { t: nowTS(), label: nowLabel(), value: v };
  rewardPointsAll.push(point);
  appendPoint("inj_reward_withdrawals", addr, point);

  rebuildRewardView(true);
}

function getRewardFilterMin() {
  const v = safe(rewardFilterEl?.value);
  return v || 0;
}
function buildRewardViewArray() {
  const minVal = getRewardFilterMin();
  if (!minVal) return rewardPointsAll.slice();
  return rewardPointsAll.filter(p => safe(p.value) >= minVal);
}

function updateRewardTimelineMeta() {
  if (!rewardTimelineMeta) return;
  const n = rewardPointsView.length;
  if (!n) { rewardTimelineMeta.textContent = "—"; return; }
  const idx = clamp(parseInt(rewardTimelineEl?.value || "0", 10), 0, n - 1);
  const p = rewardPointsView[idx];
  rewardTimelineMeta.textContent = `${p.label} • +${safe(p.value).toFixed(6)} INJ`;
}
function updateRewardTimelineUI() {
  if (!rewardTimelineEl) return;
  const n = rewardPointsView.length;
  rewardTimelineEl.min = "0";
  rewardTimelineEl.max = String(Math.max(0, n - 1));
  rewardTimelineEl.value = String(rewardFollowLive ? Math.max(0, n - 1) : clamp(parseInt(rewardTimelineEl.value || "0", 10), 0, Math.max(0, n - 1)));
  updateRewardTimelineMeta();
}

function setRewardWindowAroundIndex(ch, idx) {
  if (!ch) return;
  const ds = ch.data.datasets?.[0]?.data || [];
  const n = ds.length;
  if (!n) return;

  idx = clamp(idx, 0, n - 1);

  const area = ch.chartArea;
  const width = area?.width || 600;
  const maxVisible = Math.max(8, Math.floor(width / MIN_PX_PER_POINT_REWARD));

  const half = Math.floor(maxVisible / 2);
  const xmin = clamp(idx - half, 0, n - 1);
  const xmax = clamp(xmin + maxVisible - 1, 0, n - 1);

  ch.options.scales.x.min = xmin;
  ch.options.scales.x.max = xmax;
}

function rebuildRewardView(ensureLiveTail = false) {
  rewardPointsView = buildRewardViewArray();

  if (!rewardChart) initRewardChart();
  else redrawRewardChart();

  updateRewardTimelineUI();

  if ((rewardFollowLive && rewardChart) || (ensureLiveTail && rewardChart && rewardFollowLive)) {
    const lastIdx = Math.max(0, rewardPointsView.length - 1);
    setRewardWindowAroundIndex(rewardChart, lastIdx);
    autoScaleYOnVisible(rewardChart, rewardChart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
    rewardChart.update("none");
  }
}

function initRewardChart() {
  const canvas = $("rewardChart");
  if (!canvas || !window.Chart) return;

  rewardChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: rewardPointsView.map(p => p.label),
      datasets: [{
        data: rewardPointsView.map(p => p.value),
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
            title: (items) => rewardPointsView[items?.[0]?.dataIndex ?? 0]?.label || "",
            label: (item) => `Withdrawn • +${safe(item.raw).toFixed(6)} INJ`
          }
        },
        zoom: {
          pan: {
            enabled: true,
            mode: "x",
            threshold: 2,
            onPanComplete: ({ chart }) => {
              ensureReadableWindow(chart, MIN_PX_PER_POINT_REWARD);
              autoScaleYOnVisible(chart, chart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
              chart.update("none");
            }
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
            onZoomComplete: ({ chart }) => {
              ensureReadableWindow(chart, MIN_PX_PER_POINT_REWARD);
              autoScaleYOnVisible(chart, chart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
              chart.update("none");
            }
          }
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
  autoScaleYOnVisible(rewardChart, rewardChart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
  rewardChart.update("none");
}

function redrawRewardChart() {
  if (!rewardChart) return;

  rewardChart.data.labels = rewardPointsView.map(p => p.label);
  rewardChart.data.datasets[0].data = rewardPointsView.map(p => p.value);

  ensureReadableWindow(rewardChart, MIN_PX_PER_POINT_REWARD);

  if (!rewardFollowLive && rewardTimelineEl) {
    const idx = clamp(parseInt(rewardTimelineEl.value || "0", 10), 0, Math.max(0, rewardPointsView.length - 1));
    setRewardWindowAroundIndex(rewardChart, idx);
  } else {
    const lastIdx = Math.max(0, rewardPointsView.length - 1);
    setRewardWindowAroundIndex(rewardChart, lastIdx);
  }

  autoScaleYOnVisible(rewardChart, rewardChart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
  rewardChart.update("none");
}

/* Reward UI bindings */
rewardFilterEl?.addEventListener("change", () => rebuildRewardView(true));
rewardTimelineEl?.addEventListener("input", () => {
  rewardFollowLive = false;
  updateRewardTimelineMeta();
  if (rewardChart) {
    const idx = clamp(parseInt(rewardTimelineEl.value || "0", 10), 0, Math.max(0, rewardPointsView.length - 1));
    setRewardWindowAroundIndex(rewardChart, idx);
    autoScaleYOnVisible(rewardChart, rewardChart.data.datasets[0].data, REWARD_PAD, { floorAtZero: true, minSpan: 2 });
    rewardChart.update("none");
  }
});
rewardLiveBtn?.addEventListener("click", () => {
  rewardFollowLive = true;
  rebuildRewardView(true);
});

/* =========================================================
   ACCOUNT (Injective LCD)
========================================================= */
let lastRewardsSeenForWithdraw = null;
let lastStakeForType = null;
let lastRewardsForType = null;

async function loadAccount() {
  if (!address || !hasInternet()) return;

  const base = "https://lcd.injective.network";
  const [b, s, r, i] = await Promise.all([
    fetchJSON(`${base}/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`${base}/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`${base}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`${base}/cosmos/mint/v1beta1/inflation`)
  ]);
  if (!b || !s || !r || !i) return;

  availableInj = safe(b.balances?.find(x => x.denom === "inj")?.amount) / 1e18;
  stakeInj = (s.delegation_responses || []).reduce((a, d) => a + safe(d.balance.amount), 0) / 1e18;
  rewardsInj = (r.rewards || []).reduce((a, x) => a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;
  apr = safe(i.inflation) * 100;

  if (lastRewardsSeenForWithdraw == null) lastRewardsSeenForWithdraw = rewardsInj;
  const diff = safe(lastRewardsSeenForWithdraw) - safe(rewardsInj);
  if (diff > REWARD_WITHDRAW_THRESHOLD) addRewardWithdrawalPoint(address, diff);
  lastRewardsSeenForWithdraw = rewardsInj;

  const type = inferStakeType(stakeInj, rewardsInj);
  addStakePoint(address, stakeInj, type || "");

  lastStakeForType = stakeInj;
  lastRewardsForType = rewardsInj;
}

/* =========================================================
   BINANCE REST SNAPSHOT (1D/1W/1M)
========================================================= */
async function loadCandleSnapshot() {
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
    refreshConnUI();
  }
}

/* =========================================================
   PRICE CHART 1D (REST bootstrap) + LIVE WS 1m
========================================================= */
let priceChart = null;
let priceLabels = [];
let priceData = [];
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
  if (!chartEl || !priceChart) return;

  if (pinnedIndex == null) {
    chartEl.textContent = "--";
    return;
  }
  const ds = priceChart.data.datasets?.[0]?.data || [];
  const lbs = priceChart.data.labels || [];
  if (!ds.length || !lbs.length) { chartEl.textContent = "--"; return; }

  const idx = clamp(Math.round(+pinnedIndex), 0, ds.length - 1);
  const price = safe(ds[idx]);
  const label = lbs[idx];
  if (!Number.isFinite(price) || !label) { chartEl.textContent = "--"; return; }

  chartEl.textContent = `${label} • $${price.toFixed(4)}`;
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

function initPriceChart() {
  const canvas = $("priceChart");
  if (!canvas || !window.Chart) return;

  priceChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: priceLabels,
      datasets: [{
        data: priceData,
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
          pan: { enabled: true, mode: "x", threshold: 2 },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
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
  updatePriceOverlayFromPinned();
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

async function loadChartToday() {
  if (!hasInternet() || !tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  priceLabels = kl.map(k => fmtHHMM(safe(k[0])));
  priceData = kl.map(k => safe(k[4]));
  lastChartMinuteStart = safe(kl[kl.length - 1][0]) || 0;

  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!priceChart) initPriceChart();
  if (priceChart) {
    priceChart.data.labels = priceLabels;
    priceChart.data.datasets[0].data = priceData;
    priceChart.update("none");
  }

  chartBootstrappedToday = true;
}

function updateChartFrom1mKline(k) {
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

async function ensureChartBootstrapped() {
  if (chartBootstrappedToday) return;
  await loadCandleSnapshot();
  await loadChartToday();
}

/* =========================================================
   WS (LIVE only)
========================================================= */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

function clearTradeRetry() { if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; } }
function scheduleTradeRetry() { clearTradeRetry(); tradeRetryTimer = setTimeout(() => startTradeWS(), 1200); }

function startTradeWS() {
  try { wsTrade?.close(); } catch {}
  if (getMode() !== "live" || !hasInternet()) return;

  wsTrade = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  wsTrade.onopen = () => clearTradeRetry();
  wsTrade.onclose = () => scheduleTradeRetry();
  wsTrade.onerror = () => { try { wsTrade.close(); } catch {} scheduleTradeRetry(); };

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

function clearKlineRetry() { if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; } }
function scheduleKlineRetry() { clearKlineRetry(); klineRetryTimer = setTimeout(() => startKlineWS(), 1200); }

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
  try { wsKline?.close(); } catch {}
  if (getMode() !== "live" || !hasInternet()) return;

  const url =
    "wss://stream.binance.com:9443/stream?streams=" +
    "injusdt@kline_1m/" +
    "injusdt@kline_1d/" +
    "injusdt@kline_1w/" +
    "injusdt@kline_1M";

  wsKline = new WebSocket(url);

  wsKline.onopen = () => clearKlineRetry();
  wsKline.onclose = () => scheduleKlineRetry();
  wsKline.onerror = () => { try { wsKline.close(); } catch {} scheduleKlineRetry(); };

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

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    const root = $("appRoot");
    if (root && root.classList.contains("loading") && tfReady.d) {
      root.classList.remove("loading");
      root.classList.add("ready");
      refreshConnUI();
    }
  };
}

/* =========================================================
   LOOP RENDER
========================================================= */
function animate() {
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  const sign = pD > 0 ? "up" : (pD < 0 ? "down" : "neutral");
  if (sign !== lastChartSign) {
    lastChartSign = sign;
    applyPriceChartColorBySign(sign);

    if (stakeChart) {
      const ds = stakeChart.data.datasets[0];
      if (sign === "up") { ds.borderColor = "#22c55e"; ds.backgroundColor = "rgba(34,197,94,.18)"; }
      else if (sign === "down") { ds.borderColor = "#ef4444"; ds.backgroundColor = "rgba(239,68,68,.16)"; }
      else { ds.borderColor = "#3b82f6"; ds.backgroundColor = "rgba(59,130,246,.12)"; }
      stakeChart.update("none");
    }
    if (rewardChart) {
      const ds = rewardChart.data.datasets[0];
      if (sign === "up") { ds.borderColor = "#22c55e"; ds.backgroundColor = "rgba(34,197,94,.14)"; }
      else if (sign === "down") { ds.borderColor = "#ef4444"; ds.backgroundColor = "rgba(239,68,68,.12)"; }
      else { ds.borderColor = "#3b82f6"; ds.backgroundColor = "rgba(59,130,246,.12)"; }
      rewardChart.update("none");
    }
  }

  const dUp   = "linear-gradient(to right, rgba(34,197,94,.95), rgba(16,185,129,.85))";
  const dDown = "linear-gradient(to left,  rgba(239,68,68,.95), rgba(248,113,113,.85))";
  const wUp   = "linear-gradient(to right, rgba(59,130,246,.95), rgba(99,102,241,.82))";
  const wDown = "linear-gradient(to left,  rgba(239,68,68,.90), rgba(59,130,246,.55))";
  const mUp   = "linear-gradient(to right, rgba(249,115,22,.92), rgba(236,72,153,.78))";
  const mDown = "linear-gradient(to left,  rgba(239,68,68,.90), rgba(236,72,153,.55))";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, dUp, dDown);
  renderBar($("weekBar"),  $("weekLine"),  targetPrice, candle.w.open, candle.w.low, candle.w.high, wUp, wDown);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, mUp, mDown);

  const pMinEl = $("priceMin"), pMaxEl = $("priceMax");
  const wMinEl = $("weekMin"),  wMaxEl = $("weekMax");
  const mMinEl = $("monthMin"), mMaxEl = $("monthMax");

  if (tfReady.d) {
    const low = safe(candle.d.low), high = safe(candle.d.high);
    pMinEl.textContent = low.toFixed(3);
    $("priceOpen").textContent = safe(candle.d.open).toFixed(3);
    pMaxEl.textContent = high.toFixed(3);

    if (lastExtremes.d.low !== null && low !== lastExtremes.d.low) flash(pMinEl);
    if (lastExtremes.d.high !== null && high !== lastExtremes.d.high) flash(pMaxEl);
    lastExtremes.d.low = low; lastExtremes.d.high = high;
  } else {
    pMinEl.textContent = "--"; $("priceOpen").textContent = "--"; pMaxEl.textContent = "--";
  }

  if (tfReady.w) {
    const low = safe(candle.w.low), high = safe(candle.w.high);
    wMinEl.textContent = low.toFixed(3);
    $("weekOpen").textContent = safe(candle.w.open).toFixed(3);
    wMaxEl.textContent = high.toFixed(3);

    if (lastExtremes.w.low !== null && low !== lastExtremes.w.low) flash(wMinEl);
    if (lastExtremes.w.high !== null && high !== lastExtremes.w.high) flash(wMaxEl);
    lastExtremes.w.low = low; lastExtremes.w.high = high;
  } else {
    wMinEl.textContent = "--"; $("weekOpen").textContent = "--"; wMaxEl.textContent = "--";
  }

  if (tfReady.m) {
    const low = safe(candle.m.low), high = safe(candle.m.high);
    mMinEl.textContent = low.toFixed(3);
    $("monthOpen").textContent = safe(candle.m.open).toFixed(3);
    mMaxEl.textContent = high.toFixed(3);

    if (lastExtremes.m.low !== null && low !== lastExtremes.m.low) flash(mMinEl);
    if (lastExtremes.m.high !== null && high !== lastExtremes.m.high) flash(mMaxEl);
    lastExtremes.m.low = low; lastExtremes.m.high = high;
  } else {
    mMinEl.textContent = "--"; $("monthOpen").textContent = "--"; mMaxEl.textContent = "--";
  }

  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  $("availableUsd").textContent = `≈ $${(displayed.available * displayed.price).toFixed(2)}`;

  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake * displayed.price).toFixed(2)}`;

  const stakePct = clamp((displayed.stake / STAKE_TARGET_MAX) * 100, 0, 100);
  $("stakeBar").style.width = stakePct + "%";
  $("stakeLine").style.left = stakePct + "%";
  $("stakePercent").textContent = stakePct.toFixed(1) + "%";

  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

  const maxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);
  $("rewardBar").style.width = rp + "%";
  $("rewardBar").style.background = heatColor(rp);
  $("rewardLine").style.left = rp + "%";
  $("rewardPercent").textContent = rp.toFixed(1) + "%";
  $("rewardMax").textContent = maxR.toFixed(1);

  $("apr").textContent = safe(apr).toFixed(2) + "%";
  $("updated").textContent = "Last update: " + nowLabel();

  requestAnimationFrame(animate);
}

/* =========================================================
   MODE RUNNER (LIVE vs REFRESH)
========================================================= */
let timers = [];
function clearAllTimers() {
  timers.forEach(t => clearInterval(t));
  timers = [];
}
function closeWS() {
  try { wsTrade?.close(); } catch {}
  try { wsKline?.close(); } catch {}
  wsTrade = null; wsKline = null;
}

async function bootstrapOnce() {
  refreshConnUI();
  if (!hasInternet()) return;

  beginLoading();
  try {
    if (address) {
      loadStakePointsForAddress(address);
      loadRewardPointsForAddress(address);
    }

    if (!stakeChart) initStakeChart();
    rebuildRewardView(true);

    await loadCandleSnapshot();
    await loadChartToday();
    await loadAccount();
  } finally {
    endLoading();
  }
}

function startLiveLoop() {
  if (!hasInternet()) return;

  clearAllTimers();
  timers.push(setInterval(loadAccount, ACCOUNT_POLL_MS));
  timers.push(setInterval(loadCandleSnapshot, REST_SYNC_MS));
  timers.push(setInterval(loadChartToday, CHART_SYNC_MS));
  timers.push(setInterval(ensureChartBootstrapped, 1500));

  startTradeWS();
  startKlineWS();
}

function restartMode() {
  applyModeUI();
  refreshConnUI();

  clearAllTimers();
  closeWS();

  chartBootstrappedToday = false;

  bootstrapOnce().then(() => {
    if (getMode() === "live") startLiveLoop();
  });
}

/* ===================== BOOT ===================== */
(function boot() {
  restartMode();
  animate();
})();
