/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 2800; // ms
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000; // safety sync (se websocket perde un update)

// Chart: ultime 34 ore a 1m
const CHART_MINUTES = 34 * 60; // 2040 punti

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
  d: { open: 0, high: 0, low: 0 }, // 1D
  w: { open: 0, high: 0, low: 0 }, // 1W
  m: { open: 0, high: 0, low: 0 }, // 1M
};

/* Ready flags (evita barre “-100” all’avvio) */
const tfReady = { d: false, w: false, m: false };

/* ================= CHART STATE (34H) ================= */
let chart = null;
let chartLabels = []; // HH:MM
let chartData = [];   // close price
let lastChartMinuteStart = 0; // open time della candela 1m corrente

/* ws */
let wsTrade = null;
let wsKline = null;
let tradeRetryTimer = null;
let klineRetryTimer = null;

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

/* ================= PERF ================= */
function pctChange(price, open) {
  const p = safe(price), o = safe(open);
  if (!o) return 0;
  const v = ((p - o) / o) * 100;
  return Number.isFinite(v) ? v : 0;
}

function updatePerf(arrowId, pctId, v) {
  const arrow = $(arrowId), pct = $(pctId);

  if (v > 0) { arrow.textContent = "▲"; arrow.className = "arrow up"; pct.className = "pct up"; }
  else if (v < 0) { arrow.textContent = "▼"; arrow.className = "arrow down"; pct.className = "pct down"; }
  else { arrow.textContent = "►"; arrow.className = "arrow flat"; pct.className = "pct flat"; }

  pct.textContent = Math.abs(v).toFixed(2) + "%";
}

/* ================= BAR RENDER =================
   - open sempre al centro (50%)
   - low/high presi dalla candela (realtime)
   - linea = posizione reale del prezzo
   - fill tira dal centro (verde/rosso)
   - SE NON PRONTO: barra neutra (mai -100 o valori falsi)
*/
function renderBar(bar, line, val, open, low, high, gradUp, gradDown) {
  open = safe(open); low = safe(low); high = safe(high); val = safe(val);

  // Candle non pronta => stato neutro elegante
  if (!open || !low || !high || high === low) {
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
}
loadAccount();
setInterval(loadAccount, ACCOUNT_POLL_MS);

/* ================= BINANCE REST: initial candle snapshot ================= */
async function loadCandleSnapshot() {
  const [d, w, m] = await Promise.all([
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1d&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1w&limit=1"),
    fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1M&limit=1"),
  ]);

  if (Array.isArray(d) && d[0]) {
    candle.d.open = safe(d[0][1]);
    candle.d.high = safe(d[0][2]);
    candle.d.low  = safe(d[0][3]);
    if (candle.d.open && candle.d.high && candle.d.low) tfReady.d = true;
  }
  if (Array.isArray(w) && w[0]) {
    candle.w.open = safe(w[0][1]);
    candle.w.high = safe(w[0][2]);
    candle.w.low  = safe(w[0][3]);
    if (candle.w.open && candle.w.high && candle.w.low) tfReady.w = true;
  }
  if (Array.isArray(m) && m[0]) {
    candle.m.open = safe(m[0][1]);
    candle.m.high = safe(m[0][2]);
    candle.m.low  = safe(m[0][3]);
    if (candle.m.open && candle.m.high && candle.m.low) tfReady.m = true;
  }

  // stop shimmer quando abbiamo almeno daily valido
  const root = $("appRoot");
  if (root && root.classList.contains("loading") && tfReady.d) {
    root.classList.remove("loading");
    root.classList.add("ready");
  }
}
loadCandleSnapshot();
setInterval(loadCandleSnapshot, REST_SYNC_MS);

/* ================= CHART 34H (REST bootstrap) =================
   Binance limita a 1000 klines per richiesta, quindi facciamo 3 chunk.
*/
async function fetchKlines1mChunk(limit, endTime) {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=${limit}` +
    (endTime ? `&endTime=${endTime}` : "");
  const d = await fetchJSON(url);
  return Array.isArray(d) ? d : [];
}

async function loadChart34h() {
  // vogliamo CHART_MINUTES = 2040 punti
  // chunk: 1000 + 1000 + 40
  const now = Date.now();

  const c1 = await fetchKlines1mChunk(1000, now); // ultimi 1000
  if (!c1.length) return;

  const firstOfC1 = safe(c1[0][0]); // openTime del primo in c1
  const c2 = await fetchKlines1mChunk(1000, firstOfC1 - 1);
  const firstOfC2 = c2.length ? safe(c2[0][0]) : 0;
  const remaining = Math.max(0, CHART_MINUTES - (c1.length + c2.length)); // ~40
  const c3 = remaining ? await fetchKlines1mChunk(remaining, firstOfC2 ? (firstOfC2 - 1) : undefined) : [];

  // unisci in ordine cronologico
  const all = [...c3, ...c2, ...c1].slice(-CHART_MINUTES);

  chartLabels = all.map(k => fmtHHMM(safe(k[0])));
  chartData = all.map(k => safe(k[4]));

  // minuto corrente (ultimo openTime)
  lastChartMinuteStart = all.length ? safe(all[all.length - 1][0]) : 0;

  // prezzo fallback
  const lastClose = all.length ? safe(all[all.length - 1][4]) : 0;
  if (!targetPrice && lastClose) targetPrice = lastClose;

  if (!chart && window.Chart) initChart34h();
  else if (chart) {
    chart.data.labels = chartLabels;
    chart.data.datasets[0].data = chartData;
    chart.update("none");
  }
}

function initChart34h() {
  const canvas = $("priceChart");
  if (!canvas) return;

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: chartLabels,
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
      scales: {
        x: {
          display: false  // se vuoi, possiamo farlo visibile (ma non tocchiamo UI adesso)
        },
        y: {
          ticks: { color: "#9ca3af" }
        }
      },
      animation: false
    }
  });
}

/* realtime chart update from kline_1m:
   - se è lo stesso minuto: aggiorna l’ultimo punto (si muove “live”)
   - se è un nuovo minuto: shift + push (scorrimento destra->sinistra)
*/
function updateChartFrom1mKline(k) {
  if (!chart) return;

  const openTime = safe(k.t);   // start time 1m
  const close = safe(k.c);      // close aggiornato realtime
  if (!openTime || !close) return;

  const label = fmtHHMM(openTime);

  // stesso minuto -> aggiorna ultimo punto
  if (lastChartMinuteStart === openTime) {
    const lastIdx = chart.data.datasets[0].data.length - 1;
    if (lastIdx >= 0) {
      chart.data.datasets[0].data[lastIdx] = close;
      chart.update("none");
    }
    return;
  }

  // nuovo minuto -> scorre a sinistra: shift e push
  lastChartMinuteStart = openTime;

  chart.data.labels.push(label);
  chart.data.labels.shift();

  chart.data.datasets[0].data.push(close);
  chart.data.datasets[0].data.shift();

  chart.update("none");
}

// bootstrap + refresh periodico
loadChart34h();
setInterval(loadChart34h, 60000);

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

    // aggiorna hi/low “al volo” solo se TF pronta (evita valori sballati all’avvio)
    if (tfReady.d) { candle.d.high = Math.max(candle.d.high, p); candle.d.low = Math.min(candle.d.low, p); }
    if (tfReady.w) { candle.w.high = Math.max(candle.w.high, p); candle.w.low = Math.min(candle.w.low, p); }
    if (tfReady.m) { candle.m.high = Math.max(candle.m.high, p); candle.m.low = Math.min(candle.m.low, p); }
  };
}
startTradeWS();

/* ================= WS KLINES (1D / 1W / 1M + 1m chart realtime) ================= */
function clearKlineRetry() {
  if (klineRetryTimer) { clearTimeout(klineRetryTimer); klineRetryTimer = null; }
}
function scheduleKlineRetry() {
  clearKlineRetry();
  klineRetryTimer = setTimeout(() => startKlineWS(), 1200);
}

function applyKline(intervalKey, k) {
  const o = safe(k.o);
  const h = safe(k.h);
  const l = safe(k.l);

  // valida candela in corso
  if (o && h && l) {
    candle[intervalKey].open = o;
    candle[intervalKey].high = h;
    candle[intervalKey].low  = l;

    // al primo dato valido, abilita TF e fai “settle” elegante
    if (!tfReady[intervalKey]) {
      tfReady[intervalKey] = true;
      settleStart = Date.now();
    }
  }
}

function startKlineWS() {
  try { if (wsKline) wsKline.close(); } catch {}

  wsKlineOnline = false;
  refreshConnUI();

  // aggiungiamo anche kline_1m per il grafico 34h realtime
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

  wsKline.onmessage = (e) => {
    const payload = JSON.parse(e.data);
    const data = payload.data;
    if (!data || !data.k) return;

    const stream = payload.stream || "";
    const k = data.k;

    // grafico 34h realtime (1m)
    if (stream.includes("@kline_1m")) {
      // assicura chart bootstrap se non ancora pronto
      if (!chart && window.Chart) initChart34h();
      updateChartFrom1mKline(k);
      return;
    }

    if (stream.includes("@kline_1d")) applyKline("d", k);
    else if (stream.includes("@kline_1w")) applyKline("w", k);
    else if (stream.includes("@kline_1M")) applyKline("m", k);

    // stop shimmer quando daily è pronta
    const root = $("appRoot");
    if (root && root.classList.contains("loading") && tfReady.d) {
      root.classList.remove("loading");
      root.classList.add("ready");
    }
  };
}
startKlineWS();

/* ================= LOOP ================= */
function animate() {
  /* PRICE (smooth visual) */
  const prevDisp = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, prevDisp, 4);

  /* PERFORMANCE (solo se TF pronta, altrimenti 0) */
  const pD = tfReady.d ? pctChange(targetPrice, candle.d.open) : 0;
  const pW = tfReady.w ? pctChange(targetPrice, candle.w.open) : 0;
  const pM = tfReady.m ? pctChange(targetPrice, candle.m.open) : 0;

  updatePerf("arrow24h", "pct24h", pD);
  updatePerf("arrowWeek", "pctWeek", pW);
  updatePerf("arrowMonth", "pctMonth", pM);

  /* BARS (se non pronte -> neutre, vedi renderBar) */
  renderBar($("priceBar"), $("priceLine"), targetPrice, candle.d.open, candle.d.low, candle.d.high,
    "linear-gradient(to right,#22c55e,#10b981)",
    "linear-gradient(to left,#ef4444,#f87171)");

  renderBar($("weekBar"), $("weekLine"), targetPrice, candle.w.open, candle.w.low, candle.w.high,
    "linear-gradient(to right,#f59e0b,#fbbf24)",
    "linear-gradient(to left,#f97316,#f87171)");

  renderBar($("monthBar"), $("monthLine"), targetPrice, candle.m.open, candle.m.low, candle.m.high,
    "linear-gradient(to right,#8b5cf6,#c084fc)",
    "linear-gradient(to left,#6b21a8,#c084fc)");

  /* Values under bars (finché non pronti, mostra --) */
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
