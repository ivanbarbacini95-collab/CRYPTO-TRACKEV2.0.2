/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200; // ms (più lungo -> numeri scorrono di più)
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;     // safety sync candele 1D/1W/1M
const CHART_SYNC_MS = 60000;    // safety sync grafico giornata

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

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
  d: { t: 0, open: 0, high: 0, low: 0 }, // 1D (t = openTime ms)
  w: { t: 0, open: 0, high: 0, low: 0 }, // 1W
  m: { t: 0, open: 0, high: 0, low: 0 }, // 1M
};

/* Ready flags (evita barre “-100” all’avvio) */
const tfReady = { d: false, w: false, m: false };

/* ================= CHART (Price) ================= */
let chart = null;
let chartLabels = [];
let chartData = [];
let lastChartMinuteStart = 0;

let chartBootstrappedToday = false;

/* Hover interaction state */
let hoverActive = false;
let hoverIndex = null;
let hoverPrice = null;

/* Color state (performance daily) */
let lastChartSign = "neutral";

/* ws */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

/* ================= STAKED PROGRESS + CHART ================= */
const STAKE_TARGET = 1000; // range 0 - 1000

let stakeChart = null;
let stakeEventLabels = [];
let stakeEventData = [];
let lastStakeSeen = null; // per capire quando aumenta e aggiungere un punto

function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas || !window.Chart) return;

  stakeChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: stakeEventLabels,
      datasets: [{
        data: stakeEventData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        pointRadius: 2,
        tension: 0.25
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" } }
      }
    }
  });
}

function pushStakePoint(val) {
  const v = safe(val);
  if (!v) return;

  const label = fmtHHMM(Date.now());
  stakeEventLabels.push(label);
  stakeEventData.push(v);

  while (stakeEventLabels.length > 220) stakeEventLabels.shift();
  while (stakeEventData.length > 220) stakeEventData.shift();

  if (!stakeChart) initStakeChart();
  if (stakeChart) {
    stakeChart.data.labels = stakeEventLabels;
    stakeChart.data.datasets[0].data = stakeEventData;
    stakeChart.update("none");
  }
}

/* ================= SMOOTH DISPLAY ================= */
function scrollSpeed() {
  // più soft all’inizio, poi accelera gradualmente
  const t = Math.min((Date.now() - settleStart) / INITIAL_SETTLE_TIME, 1);
  const base = 0.08;           // più lento all’inizio
  const maxExtra = 0.80;       // tende a 0.88 circa
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

/* ================= BAR RENDER =================
   - open è al centro (marker CSS)
   - bar fill: da centro verso dx (verde) se val>=open, oppure verso sx (rosso) se val<open
   - bar-line gialla: posizione del prezzo reale (val)
*/
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
  if (!bar || !line) return;

  open = safe(open); low = safe(low); high = safe(high); val = safe(val);

  if (!open || !low || !high || high === low) {
    line.style.left = "50%";
    bar.style.left = "50%";
    bar.style.width = "0%";
    bar.style.background = "rgba(255,255,255,0.08)";
    return;
  }

  // range simmetrico intorno all’open -> open sempre centrale
  const range = Math.max(Math.abs(high - open), Math.abs(open - low));
  const min = open - range;
  const max = open + range;

  const pos = clamp(((val - min) / (max - min)) * 100, 0, 100);
  const center = 50;

  // linea gialla = prezzo reale
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

/* ================= HEAT COLOR (Rewards) ================= */
function heatColor(p) {
  const t = clamp(p, 0, 100) / 100;
  return `rgb(${14 + (239 - 14) * t},${165 - 165 * t},${233 - 233 * t})`;
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

/* ================= ACCOUNT (Injective LCD) ================= */
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

  /* ✅ stake chart: aggiunge un punto quando lo stake aumenta */
  if (Number.isFinite(stakeInj)) {
    if (lastStakeSeen == null) {
      lastStakeSeen = stakeInj;
      if (stakeInj > 0) pushStakePoint(stakeInj);
    } else {
      const diff = stakeInj - lastStakeSeen;
      if (diff > 0.0001) {
        lastStakeSeen = stakeInj;
        pushStakePoint(stakeInj);
      } else {
        lastStakeSeen = stakeInj;
      }
    }
  }
}
loadAccount();
setInterval(loadAccount, ACCOUNT_POLL_MS);

/* ================= BINANCE REST: snapshot candele 1D/1W/1M ================= */
async function loadCandleSnapshot() {
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

  const root = $("appRoot");
  if (root && root.classList.contains("loading") && tfReady.d) {
    root.classList.remove("loading");
    root.classList.add("ready");
  }
}
setInterval(loadCandleSnapshot, REST_SYNC_MS);

/* ================= CHART: vertical line plugin (solo quando hoverActive) ================= */
const verticalLinePlugin = {
  id: "verticalLinePlugin",
  afterDraw(ch) {
    if (!hoverActive || hoverIndex == null) return;

    const meta = ch.getDatasetMeta(0);
    const el = meta?.data?.[hoverIndex];
    if (!el) return;

    const ctx = ch.ctx;
    const x = el.x;
    const topY = ch.chartArea.top;
    const bottomY = ch.chartArea.bottom;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
    ctx.stroke();
    ctx.restore();
  }
};

function applyChartColorBySign(sign) {
  if (!chart) return;
  const ds = chart.data.datasets[0];
  if (!ds) return;

  if (sign === "up") {
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.20)";
  } else if (sign === "down") {
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.18)";
  } else {
    ds.borderColor = "#9ca3af";
    ds.backgroundColor = "rgba(156,163,175,.12)";
  }
  chart.update("none");
}

/* ================= CHART: giornata corrente (REST bootstrap) ================= */
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
  if (!canvas) return;

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: chartLabels,
      datasets: [{
        data: chartData,
        borderColor: "#9ca3af",
        backgroundColor: "rgba(156,163,175,.12)",
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
        tooltip: { enabled: false }
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" } }
      }
    },
    plugins: [verticalLinePlugin]
  });

  setupChartInteractions();
  applyChartColorBySign(lastChartSign);

  const overlay = $("chartPrice")?.parentElement;
  if (overlay) overlay.style.display = "none";
}

async function loadChartToday() {
  if (!tfReady.d || !candle.d.t) return;

  const kl = await fetchKlines1mRange(candle.d.t, Date.now());
  if (!kl.length) return;

  chartLabels = kl.map(k => fmtHHMM(safe(k[0])));
  chartData = kl.map(k => safe(k[4]));

  lastChartMinuteStart = safe(kl[kl.length - 1][0]) || 0;

  const lastClose = safe(kl[kl.length - 1][4]);
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!chart && window.Chart) initChartToday();
  else if (chart) {
    chart.data.labels = chartLabels;
    chart.data.datasets[0].data = chartData;
    chart.update("none");
  }

  chartBootstrappedToday = true;
}

/* ================= CHART: interactions (line + top-right info) ================= */
function setHoverState(active, idx, price) {
  hoverActive = active;
  hoverIndex = active ? idx : null;
  hoverPrice = active ? price : null;

  const label = active && chart ? (chart.data.labels?.[idx] ?? "--") : "--";
  const p = safe(price);

  const txt = $("chartPrice");
  const overlay = txt ? txt.parentElement : null;

  if (overlay) overlay.style.display = active ? "block" : "none";
  if (txt && active) txt.textContent = `${label} • $${p.toFixed(4)}`;

  if (chart) chart.update("none");
}

function setupChartInteractions() {
  const canvas = $("priceChart");
  if (!canvas) return;

  const getIndexFromEvent = (evt) => {
    if (!chart) return null;
    const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, false);
    if (!points || !points.length) return null;
    return points[0].index;
  };

  const handleMove = (evt) => {
    const idx = getIndexFromEvent(evt);
    if (idx == null) {
      setHoverState(false);
      return;
    }
    const v = safe(chart.data.datasets[0].data[idx]);
    setHoverState(true, idx, v);
  };

  const handleLeave = () => setHoverState(false);

  canvas.addEventListener("mousemove", handleMove, { passive: true });
  canvas.addEventListener("mouseleave", handleLeave, { passive: true });

  canvas.addEventListener("touchstart", (e) => { handleMove(e); }, { passive: true });
  canvas.addEventListener("touchmove", (e) => { handleMove(e); }, { passive: true });
  canvas.addEventListener("touchend", handleLeave, { passive: true });
  canvas.addEventListener("touchcancel", handleLeave, { passive: true });
}

/* ================= BOOTSTRAP ensure chart is never empty on reload ================= */
async function ensureChartBootstrapped() {
  if (chartBootstrappedToday) return;

  if (!tfReady.d || !candle.d.t) {
    await loadCandleSnapshot();
  }
  if (tfReady.d && candle.d.t) {
    await loadChartToday();
  }
}
setInterval(ensureChartBootstrapped, 1500);
setInterval(loadChartToday, CHART_SYNC_MS);

/* ================= WS TRADE (price realtime) ================= */
function clearTradeRetry() {
  if (tradeRetryTimer) { clearTimeout(tradeRetryTimer); tradeRetryTimer = null; }
}
function scheduleTradeRetry() {
  clearTradeRetry();
  tradeRetryTimer = setTimeout(() => startTradeWS(), 1200);
}

function startTradeWS() {
  try { if (wsTrade) wsTrade.close(); } catch {}

  wsTradeOnline = false;
  refreshConnUI();

  wsTrade = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  wsTrade.onopen = () => {
    wsTradeOnline = true;
    refreshConnUI();
    clearTradeRetry();
  };

  wsTrade.onclose = () => {
    wsTradeOnline = false;
    refreshConnUI();
    scheduleTradeRetry();
  };

  wsTrade.onerror = () => {
    wsTradeOnline = false;
    refreshConnUI();
    try { wsTrade.close(); } catch {}
    scheduleTradeRetry();
  };

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
startTradeWS();

/* ================= WS KLINES (1m chart + 1D/1W/1M bars) ================= */
function clearKlineRetry() {
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }
}
function scheduleKlineRetry() {
  clearKlineRetry();
  klineRetryTimer = setTimeout(() => startKlineWS(), 1200);
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

function updateChartFrom1mKline(k) {
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

async function resetDayAndReloadChart(nextOpenTime) {
  chartBootstrappedToday = false;

  chartLabels = [];
  chartData = [];
  lastChartMinuteStart = 0;

  if (chart) {
    chart.data.labels = [];
    chart.data.datasets[0].data = [];
    chart.update("none");
  }

  if (nextOpenTime) candle.d.t = nextOpenTime;

  await loadCandleSnapshot();
  await loadChartToday();

  setHoverState(false);
}

function startKlineWS() {
  try { if (wsKline) wsKline.close(); } catch {}

  wsKlineOnline = false;
  refreshConnUI();

  const url =
    "wss://stream.binance.com:9443/stream?streams=" +
    "injusdt@kline_1m/" +
    "injusdt@kline_1d/" +
    "injusdt@kline_1w/" +
    "injusdt@kline_1M";

  wsKline = new WebSocket(url);

  wsKline.onopen = () => {
    wsKlineOnline = true;
    refreshConnUI();
    clearKlineRetry();
  };

  wsKline.onclose = () => {
    wsKlineOnline = false;
    refreshConnUI();
    scheduleKlineRetry();
  };

  wsKline.onerror = () => {
    wsKlineOnline = false;
    refreshConnUI();
    try { wsKline.close(); } catch {}
    scheduleKlineRetry();
  };

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
        await loadChartToday();
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
startKlineWS();

/* ================= BOOT ================= */
(async function boot() {
  await loadCandleSnapshot();
  await loadChartToday();
  initStakeChart();
})();

/* ================= LOOP ================= */
function animate() {
  /* PRICE (card INJ Price) */
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

  /* Colore grafico = performance daily */
  const sign =
    !tfReady.d ? "neutral" :
    pD > 0 ? "up" :
    pD < 0 ? "down" : "neutral";

  if (sign !== lastChartSign) {
    lastChartSign = sign;
    applyChartColorBySign(sign);
  }

  /* BARS (tutte green/red coerenti con performance) */
  const upGrad = "linear-gradient(to right,#22c55e,#10b981)";
  const downGrad = "linear-gradient(to left,#ef4444,#f87171)";

  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high, upGrad, downGrad);
  renderBar($("weekBar"), $("weekLine"), targetPrice, candle.w.open, candle.w.low, candle.w.high, upGrad, downGrad);
  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high, upGrad, downGrad);

  /* Values under bars */
  $("priceMin").textContent  = tfReady.d ? safe(candle.d.low).toFixed(3)  : "--";
  $("priceOpen").textContent = tfReady.d ? safe(candle.d.open).toFixed(3) : "--";
  $("priceMax").textContent  = tfReady.d ? safe(candle.d.high).toFixed(3) : "--";

  $("weekMin").textContent   = tfReady.w ? safe(candle.w.low).toFixed(3)  : "--";
  $("weekOpen").textContent  = tfReady.w ? safe(candle.w.open).toFixed(3) : "--";
  $("weekMax").textContent   = tfReady.w ? safe(candle.w.high).toFixed(3) : "--";

  $("monthMin").textContent  = tfReady.m ? safe(candle.m.low).toFixed(3)  : "--";
  $("monthOpen").textContent = tfReady.m ? safe(candle.m.open).toFixed(3) : "--";
  $("monthMax").textContent  = tfReady.m ? safe(candle.m.high).toFixed(3) : "--";

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

  /* ✅ STAKE BAR (0 - 1000) */
  const stakeMax = STAKE_TARGET;
  const sp = clamp((displayed.stake / stakeMax) * 100, 0, 100);

  $("stakeBar").style.width = sp + "%";
  $("stakeLine").style.left = sp + "%";
  $("stakePercent").textContent = sp.toFixed(1) + "%";
  $("stakeMin").textContent = "0";
  $("stakeMax").textContent = "1000";

  /* REWARDS */
  const or = displayed.rewards;
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  colorNumber($("rewards"), displayed.rewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

  const maxR = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  $("rewardBar").style.width = rp + "%";
  $("rewardLine").style.left = rp + "%";
  $("rewardPercent").textContent = rp.toFixed(1) + "%";
  $("rewardBar").style.background = heatColor(rp);
  $("rewardMin").textContent = "0";
  $("rewardMax").textContent = maxR.toFixed(1);

  $("apr").textContent = safe(apr).toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
