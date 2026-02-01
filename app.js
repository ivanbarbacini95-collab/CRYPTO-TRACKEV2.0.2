/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 2800; // ms
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const PRICE_POLL_MS = 60000;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pctChange(price, open) {
  const p = safe(price), o = safe(open);
  if (!o) return 0;
  const v = ((p - o) / o) * 100;
  return Number.isFinite(v) ? v : 0;
}

/* ================= CONNECTION UI ================= */
const statusDot = $("statusDot");
const statusText = $("statusText");
let wsOnline = false;
let accountOnline = false;

function refreshConnUI() {
  const ok = wsOnline && accountOnline;
  statusText.textContent = ok ? "Online" : "Offline";
  statusDot.style.background = ok ? "#22c55e" : "#ef4444";
}

/* ================= STATE ================= */
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0; // prezzo REALE (WS + REST)
let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let priceWeekOpen = 0, priceWeekLow = 0, priceWeekHigh = 0;
let priceMonthOpen = 0, priceMonthLow = 0, priceMonthHigh = 0;

// SOLO per animazione numeri (visual), non per calcoli!
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let chart = null, chartData = [];
let ws = null;
let wsRetryTimer = null;

/* ================= SMOOTH DISPLAY ================= */
function scrollSpeed() {
  const t = Math.min((Date.now() - settleStart) / INITIAL_SETTLE_TIME, 1);
  return t < 1 ? 0.12 + t * 0.55 : 0.85;
}
function tick(cur, tgt) {
  if (!Number.isFinite(tgt)) return cur;
  return cur + (tgt - cur) * scrollSpeed();
}

/* ================= COLORED DIGITS ================= */
function colorNumber(el, n, o, d) {
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

/* ================= PERF ARROWS ================= */
function updatePerf(arrowId, pctId, v) {
  const arrow = $(arrowId), pct = $(pctId);

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= BAR RENDER =================
   open sempre al centro (50%), linea = pos reale prezzo
*/
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
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

/* ================= FETCH ================= */
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

/* ================= ADDRESS ================= */
$("addressInput").value = address;
$("addressInput").oninput = (e) => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  settleStart = Date.now();
  loadAccount();
};

/* ================= ACCOUNT ================= */
async function loadAccount() {
  if (!address) {
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
}
loadAccount();
setInterval(loadAccount, ACCOUNT_POLL_MS);

/* ================= BINANCE REST ================= */
async function klines(interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=${limit}`;
  const j = await fetchJSON(url);
  return Array.isArray(j) ? j : [];
}

function calcOHLC(d) {
  return {
    open: safe(d[0]?.[1]),
    high: Math.max(...d.map(x => safe(x[2]))),
    low: Math.min(...d.map(x => safe(x[3]))),
    close: safe(d.at(-1)?.[4]),
  };
}

async function loadPrices() {
  const d = await klines("1m", 1440);
  if (!d.length) return;

  chartData = d.map(x => safe(x[4]));
  const o = calcOHLC(d);

  price24hOpen = o.open;
  price24hHigh = o.high;
  price24hLow = o.low;

  // prezzo reale attuale = close dell’ultima candela (fallback)
  targetPrice = o.close;

  if (!chart && window.Chart) initChart();

  // quando abbiamo dati veri, stop shimmer
  const root = $("appRoot");
  root.classList.remove("loading");
  root.classList.add("ready");
}

async function loadTF() {
  const [w, m] = await Promise.all([klines("1w", 1), klines("1M", 1)]);

  if (w[0]) {
    priceWeekOpen = safe(w[0][1]);
    priceWeekHigh = safe(w[0][2]);
    priceWeekLow = safe(w[0][3]);
  }

  if (m[0]) {
    priceMonthOpen = safe(m[0][1]);
    priceMonthHigh = safe(m[0][2]);
    priceMonthLow = safe(m[0][3]);
  }
}

loadPrices();
loadTF();
setInterval(loadPrices, PRICE_POLL_MS);
setInterval(loadTF, PRICE_POLL_MS);

/* ================= CHART ================= */
function initChart() {
  const canvas = $("priceChart");
  if (!canvas) return;

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: Array(1440).fill(""),
      datasets: [{
        data: chartData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.2)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { ticks: { color: "#9ca3af" } } }
    }
  });
}

function updateChart(p) {
  if (!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

/* ================= WS (RECONNECT) ================= */
function clearWsRetry() {
  if (wsRetryTimer) {
    clearTimeout(wsRetryTimer);
    wsRetryTimer = null;
  }
}
function scheduleWsRetry() {
  clearWsRetry();
  wsRetryTimer = setTimeout(() => startWS(), 1200);
}

function startWS() {
  try { if (ws) ws.close(); } catch {}

  wsOnline = false;
  refreshConnUI();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => {
    wsOnline = true;
    refreshConnUI();
    clearWsRetry();
  };

  ws.onclose = () => {
    wsOnline = false;
    refreshConnUI();
    scheduleWsRetry();
  };

  ws.onerror = () => {
    wsOnline = false;
    refreshConnUI();
    try { ws.close(); } catch {}
    scheduleWsRetry();
  };

  ws.onmessage = (e) => {
    const p = safe(JSON.parse(e.data).p);
    if (!p) return;

    // prezzo REALE live
    targetPrice = p;

    // aggiorna highs/lows live (coerente con ciò che stai mostrando)
    if (price24hHigh) price24hHigh = Math.max(price24hHigh, p);
    if (price24hLow)  price24hLow  = Math.min(price24hLow, p);

    if (priceWeekHigh) priceWeekHigh = Math.max(priceWeekHigh, p);
    if (priceWeekLow)  priceWeekLow  = Math.min(priceWeekLow, p);

    if (priceMonthHigh) priceMonthHigh = Math.max(priceMonthHigh, p);
    if (priceMonthLow)  priceMonthLow  = Math.min(priceMonthLow, p);

    updateChart(p);
  };
}
startWS();

/* ================= LOOP ================= */
function animate() {
  /* PRICE (visual smooth) */
  const prevDisp = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, prevDisp, 4);

  /* PERFORMANCE (REAL) -> TradingView-coerente */
  const p24 = pctChange(targetPrice, price24hOpen);
  const pW  = pctChange(targetPrice, priceWeekOpen);
  const pM  = pctChange(targetPrice, priceMonthOpen);

  updatePerf("arrow24h", "pct24h", p24);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  /* BARS (REAL) */
  renderBar($("priceBar"), $("priceLine"), targetPrice, price24hOpen, price24hLow, price24hHigh,
    "linear-gradient(to right,#22c55e,#10b981)",
    "linear-gradient(to left,#ef4444,#f87171)");

  renderBar($("weekBar"), $("weekLine"), targetPrice, priceWeekOpen, priceWeekLow, priceWeekHigh,
    "linear-gradient(to right,#f59e0b,#fbbf24)",
    "linear-gradient(to left,#f97316,#f87171)");

  renderBar($("monthBar"), $("monthLine"), targetPrice, priceMonthOpen, priceMonthLow, priceMonthHigh,
    "linear-gradient(to right,#8b5cf6,#c084fc)",
    "linear-gradient(to left,#6b21a8,#c084fc)");

  $("priceMin").textContent  = safe(price24hLow).toFixed(3);
  $("priceOpen").textContent = safe(price24hOpen).toFixed(3);
  $("priceMax").textContent  = safe(price24hHigh).toFixed(3);

  $("weekMin").textContent   = safe(priceWeekLow).toFixed(3);
  $("weekOpen").textContent  = safe(priceWeekOpen).toFixed(3);
  $("weekMax").textContent   = safe(priceWeekHigh).toFixed(3);

  $("monthMin").textContent  = safe(priceMonthLow).toFixed(3);
  $("monthOpen").textContent = safe(priceMonthOpen).toFixed(3);
  $("monthMax").textContent  = safe(priceMonthHigh).toFixed(3);

  /* AVAILABLE */
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  $("availableUsd").textContent = `≈ $${(displayed.available * targetPrice).toFixed(2)}`;

  /* STAKE */
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake * targetPrice).toFixed(2)}`;

  /* REWARDS */
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards * targetPrice).toFixed(2)}`;

  // scala auto, ma con minimo 0.1
  const maxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  $("rewardBar").style.width = rp + "%";
  $("rewardLine").style.left = rp + "%";
  $("rewardPercent").textContent = rp.toFixed(1) + "%";
  $("rewardBar").style.setProperty("--heat", rp);

  $("rewardMin").textContent = "0";
  $("rewardMax").textContent = maxR.toFixed(1);

  $("apr").textContent = safe(apr).toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
