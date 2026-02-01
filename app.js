/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200; // ms (più lungo -> numeri scorrono di più)
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;     // safety sync candele 1D/1W/1M
const CHART_SYNC_MS = 60000;    // safety sync grafico giornata

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

/* stake range */
const STAKE_TARGET_MAX = 1000;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ================= CONNECTION UI ================= */
const statusDot = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

function refreshConnUI() {
  const ok = wsTradeOnline && wsKlineOnline && accountOnline;
  statusText.textContent = ok ? "Online" : "Offline";
  statusDot.style.background = ok ? "#22c55e" : "#ef4444";
}

/* ================= STATE ================= */
let address = localStorage.getItem("inj_address") || "";

/* live price */
let targetPrice = 0; // prezzo reale (trade WS)
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

/* Injective account */
let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

/* Candle state (current candles) */
const candle = {
  d: { t: 0, open: 0, high: 0, low: 0 }, // 1D
  w: { t: 0, open: 0, high: 0, low: 0 }, // 1W
  m: { t: 0, open: 0, high: 0, low: 0 }, // 1M
};

/* Ready flags */
const tfReady = { d: false, w: false, m: false };

/* ATH / ATL tracking */
const lastHL = {
  d: { h: 0, l: 0 },
  w: { h: 0, l: 0 },
  m: { h: 0, l: 0 },
};

/* ================= CHART ================= */
let chart = null;
let chartLabels = [];
let chartData = [];
let lastChartMinuteStart = 0;
let chartBootstrappedToday = false;

/* Hover interaction */
let hoverActive = false;
let hoverIndex = null;
let hoverPrice = null;
let hoverLabel = null;
let overlayVisible = false;

/* Color state */
let lastChartSign = "neutral";

/* ws */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

/* ================= STAKE HISTORY CHART ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let lastStakeRecorded = null;
let stakeBootstrapped = false;

/* 🔑 NEW: track visible stake growth */
let lastDisplayedStakeForChart = 0;

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

/* ================= COLORED DIGITS ================= */
function colorNumber(el, n, o, d) {
  if (!el) return;
  const ns = n.toFixed(d), os = o.toFixed(d);
  if (ns === os) {
    el.textContent = ns;
    return;
  }
  el.innerHTML = [...ns].map((c, i) => {
    const col = c !== os[i] ? (n > o ? "#22c55e" : "#ef4444") : "#f9fafb";
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
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
  if (!open || !low || !high || high === low) return;

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

/* ================= FLASH ================= */
function flash(el) {
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

/* ================= STAKE CHART ================= */
function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas) return;

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: stakeLabels,
      datasets: [{
        data: stakeData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { ticks: { color: "#9ca3af" } } }
    }
  });
}

/* 🔥 add point when visible stake grows */
function maybeAddStakePointFromDisplay(v) {
  const s = safe(v);
  if (!Number.isFinite(s)) return;

  if (s > lastDisplayedStakeForChart + 0.00001) {
    lastDisplayedStakeForChart = s;
    stakeLabels.push(new Date().toLocaleTimeString());
    stakeData.push(s);

    while (stakeLabels.length > 240) stakeLabels.shift();
    while (stakeData.length > 240) stakeData.shift();

    if (!stakeChart && window.Chart) initStakeChart();
    else if (stakeChart) {
      stakeChart.data.labels = stakeLabels;
      stakeChart.data.datasets[0].data = stakeData;
      stakeChart.update("none");
    }
  }
}

/* ================= MAIN LOOP ================= */
function animate() {
  /* PRICE */
  const op = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, op, 4);

  /* PERFORMANCE */
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  /* GRADIENTS */
  const GRADS = {
    d: { up: "linear-gradient(to right,#22c55e,#16a34a)", down: "linear-gradient(to left,#ef4444,#dc2626)" },
    w: { up: "linear-gradient(to right,#3b82f6,#2563eb)", down: "linear-gradient(to left,#f97316,#ea580c)" },
    m: { up: "linear-gradient(to right,#a855f7,#7c3aed)", down: "linear-gradient(to left,#ec4899,#db2777)" }
  };

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, GRADS.d.up, GRADS.d.down);
  renderBar($("weekBar"), $("weekLine"), targetPrice, candle.w.open, candle.w.low, candle.w.high, GRADS.w.up, GRADS.w.down);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, GRADS.m.up, GRADS.m.down);

  /* FLASH ATH / ATL */
  if (tfReady.d) {
    if (candle.d.high > lastHL.d.h) { lastHL.d.h = candle.d.high; flash($("priceMax")); }
    if (!lastHL.d.l || candle.d.low < lastHL.d.l) { lastHL.d.l = candle.d.low; flash($("priceMin")); }
  }

  /* VALUES */
  $("priceMin").textContent = tfReady.d ? candle.d.low.toFixed(3) : "--";
  $("priceOpen").textContent = tfReady.d ? candle.d.open.toFixed(3) : "--";
  $("priceMax").textContent = tfReady.d ? candle.d.high.toFixed(3) : "--";

  /* AVAILABLE */
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  $("availableUsd").textContent = `≈ $${(displayed.available * displayed.price).toFixed(2)}`;

  /* STAKE */
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake * displayed.price).toFixed(2)}`;

  maybeAddStakePointFromDisplay(displayed.stake);

  const stakePct = clamp((displayed.stake / STAKE_TARGET_MAX) * 100, 0, 100);
  $("stakeBar").style.width = stakePct + "%";
  $("stakeLine").style.left = stakePct + "%";
  $("stakePercent").textContent = stakePct.toFixed(1) + "%";

  /* REWARDS */
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

  $("apr").textContent = safe(apr).toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
