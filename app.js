// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

// 24h (da 1m klines 1440)
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

// Week / Month (da klines reali)
let priceWeekOpen = 0, priceWeekLow = 0, priceWeekHigh = 0;
let priceMonthOpen = 0, priceMonthLow = 0, priceMonthHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let chart, chartData = [];
let ws;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function colorNumber(el, n, o, dec = 4) {
  const nn = safeNum(n), oo = safeNum(o);
  const ns = nn.toFixed(dec), os = oo.toFixed(dec);
  if (ns === os) { el.innerHTML = ns; return; }

  el.innerHTML = [...ns].map((c, i) => {
    const same = os[i] === c;
    const col = same ? "#f9fafb" : (nn > oo ? "#22c55e" : "#ef4444");
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return await r.json();
  } catch {
    return {};
  }
}

// da freddo (blu) a caldo (rosso)
function getHeatColor(percent) {
  const p = clamp(percent, 0, 100) / 100;
  const r = Math.round(14 + (239 - 14) * p);
  const g = Math.round(165 - 165 * p);
  const b = Math.round(233 - 233 * p);
  return `rgb(${r},${g},${b})`;
}

function fmtArrowPct(p) {
  const n = safeNum(p);
  const up = n >= 0;
  return `${up ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;
}

// ================= ADDRESS INPUT =================
$("addressInput").value = address;
$("addressInput").addEventListener("input", (e) => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

// ================= ACCOUNT LOAD =================
async function loadAccount() {
  if (!address) return;

  const [balances, staking, rewardsData, inflation] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj =
    safeNum(balances.balances?.find((b) => b.denom === "inj")?.amount) / 1e18;

  stakeInj =
    (staking.delegation_responses || []).reduce((a, d) => a + safeNum(d.balance.amount), 0) / 1e18;

  rewardsInj =
    (rewardsData.rewards || []).reduce(
      (a, r) => a + (r.reward || []).reduce((s, x) => s + safeNum(x.amount), 0),
      0
    ) / 1e18;

  apr = safeNum(inflation.inflation) * 100;
}
loadAccount();
setInterval(loadAccount, 2000);

// ================= BINANCE HELPERS (OHLC) =================
async function fetchKlines(interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=${limit}`;
  const d = await fetchJSON(url);
  return Array.isArray(d) ? d : [];
}

function calcFromKlines(klines) {
  if (!klines.length) return { open: 0, high: 0, low: 0, close: 0 };

  const open = safeNum(klines[0][1]);
  let high = -Infinity;
  let low = Infinity;
  const close = safeNum(klines[klines.length - 1][4]);

  for (const k of klines) {
    const h = safeNum(k[2]);
    const l = safeNum(k[3]);
    if (h > high) high = h;
    if (l < low) low = l;
  }

  if (!Number.isFinite(high)) high = open;
  if (!Number.isFinite(low)) low = open;

  return { open, high, low, close };
}

// ================= PRICE HISTORY =================
async function fetchHistory24h() {
  const d = await fetchKlines("1m", 1440);
  if (!d.length) return;

  chartData = d.map((c) => safeNum(c[4])); // close

  const ohlc = calcFromKlines(d);
  price24hOpen = ohlc.open;
  price24hLow = ohlc.low;
  price24hHigh = ohlc.high;

  targetPrice = safeNum(d[d.length - 1][4]);

  if (!chart) initChart();
}

async function fetchTimeframes() {
  const [w, m] = await Promise.all([
    fetchKlines("1w", 1),
    fetchKlines("1M", 1)
  ]);

  if (w.length) {
    const k = w[0];
    priceWeekOpen = safeNum(k[1]);
    priceWeekHigh = safeNum(k[2]);
    priceWeekLow = safeNum(k[3]);
  }

  if (m.length) {
    const k = m[0];
    priceMonthOpen = safeNum(k[1]);
    priceMonthHigh = safeNum(k[2]);
    priceMonthLow = safeNum(k[3]);
  }
}

fetchHistory24h();
fetchTimeframes();

setInterval(fetchHistory24h, 60_000);
setInterval(fetchTimeframes, 60_000);

// ================= CHART =================
function initChart() {
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array(1440).fill(""),
      datasets: [{
        data: chartData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,0.2)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { ticks: { color: "#9ca3af" } }
      }
    }
  });
}

function updateChart(price) {
  if (!chart) return;
  chart.data.datasets[0].data.push(price);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ================= WEBSOCKET =================
function setConnectionStatus(online) {
  const dot = $("connectionStatus").querySelector(".status-dot");
  const txt = $("connectionStatus").querySelector(".status-text");
  dot.style.background = online ? "#22c55e" : "#ef4444";
  txt.textContent = online ? "Online" : "Offline";
}

function startWS() {
  if (ws) ws.close();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => setConnectionStatus(true);

  ws.onmessage = (e) => {
    const p = safeNum(JSON.parse(e.data).p);
    if (!p) return;

    targetPrice = p;

    price24hHigh = Math.max(price24hHigh || p, p);
    price24hLow = Math.min(price24hLow || p, p);

    priceWeekHigh = Math.max(priceWeekHigh || p, p);
    priceWeekLow = Math.min(priceWeekLow || p, p);

    priceMonthHigh = Math.max(priceMonthHigh || p, p);
    priceMonthLow = Math.min(priceMonthLow || p, p);

    updateChart(p);
  };

  ws.onclose = () => { setConnectionStatus(false); setTimeout(startWS, 3000); };
  ws.onerror = () => setConnectionStatus(false);
}
startWS();

// ================= BAR UPDATE (OPEN ALWAYS CENTER) =================
function updateBarOpenCentered(bar, line, val, open, low, high, gradUp, gradDown) {
  const v = safeNum(val);
  const o = safeNum(open);
  const lo = safeNum(low);
  const hi = safeNum(high);

  const range = Math.max(Math.abs(hi - o), Math.abs(o - lo), 1e-9);
  const scaledLow = o - range;
  const scaledHigh = o + range;

  const pos = ((v - scaledLow) / (scaledHigh - scaledLow)) * 100;
  const p = clamp(pos, 0, 100);

  line.style.left = p + "%";

  const center = 50;

  if (v >= o) {
    const width = clamp(p - center, 0, 100);
    bar.style.left = center + "%";
    bar.style.width = width + "%";
    bar.style.background = gradUp;
  } else {
    const width = clamp(center - p, 0, 100);
    bar.style.left = p + "%";
    bar.style.width = width + "%";
    bar.style.background = gradDown;
  }
}

// ================= ANIMATION LOOP =================
function animate() {
  // PRICE (smooth)
  if (displayed.price !== targetPrice) {
    const old = displayed.price;

    displayed.price += (targetPrice - old) * 0.5;
    if (Math.abs(displayed.price - targetPrice) < 1e-6) displayed.price = targetPrice;

    colorNumber($("price"), displayed.price, old, 4);

    const d24h = price24hOpen ? ((displayed.price - price24hOpen) / price24hOpen) * 100 : 0;
    $("price24h").textContent = fmtArrowPct(d24h);
    $("price24h").className = "sub-row " + (d24h >= 0 ? "up" : "down");

    const dWeek = priceWeekOpen ? ((displayed.price - priceWeekOpen) / priceWeekOpen) * 100 : 0;
    $("priceWeek").textContent = fmtArrowPct(dWeek);
    $("priceWeek").className = "sub-row " + (dWeek >= 0 ? "up" : "down");

    const dMonth = priceMonthOpen ? ((displayed.price - priceMonthOpen) / priceMonthOpen) * 100 : 0;
    $("priceMonth").textContent = fmtArrowPct(dMonth);
    $("priceMonth").className = "sub-row " + (dMonth >= 0 ? "up" : "down");

    updateBarOpenCentered(
      $("priceBar"), $("priceLine"),
      displayed.price, price24hOpen, price24hLow, price24hHigh,
      "linear-gradient(to right,#22c55e,#10b981)",
      "linear-gradient(to left,#ef4444,#f87171)"
    );
    $("priceMin").textContent = price24hLow.toFixed(3);
    $("priceOpen").textContent = price24hOpen.toFixed(3);
    $("priceMax").textContent = price24hHigh.toFixed(3);

    updateBarOpenCentered(
      $("weekBar"), $("weekLine"),
      displayed.price, priceWeekOpen, priceWeekLow, priceWeekHigh,
      "linear-gradient(to right,#f59e0b,#fbbf24)",
      "linear-gradient(to left,#f97316,#f87171)"
    );
    $("weekMin").textContent = priceWeekLow.toFixed(3);
    $("weekOpen").textContent = priceWeekOpen.toFixed(3);
    $("weekMax").textContent = priceWeekHigh.toFixed(3);

    updateBarOpenCentered(
      $("monthBar"), $("monthLine"),
      displayed.price, priceMonthOpen, priceMonthLow, priceMonthHigh,
      "linear-gradient(to right,#8b5cf6,#c084fc)",
      "linear-gradient(to left,#6b21a8,#c084fc)"
    );
    $("monthMin").textContent = priceMonthLow.toFixed(3);
    $("monthOpen").textContent = priceMonthOpen.toFixed(3);
    $("monthMax").textContent = priceMonthHigh.toFixed(3);
  }

  // AVAILABLE
  if (displayed.available !== availableInj) {
    const old = displayed.available;
    displayed.available += (availableInj - old) * 0.5;
    if (Math.abs(displayed.available - availableInj) < 1e-6) displayed.available = availableInj;
    colorNumber($("available"), displayed.available, old, 6);
    $("availableUsd").textContent = `≈ $${(displayed.available * displayed.price).toFixed(2)}`;
  }

  // STAKE
  if (displayed.stake !== stakeInj) {
    const old = displayed.stake;
    displayed.stake += (stakeInj - old) * 0.5;
    if (Math.abs(displayed.stake - stakeInj) < 1e-6) displayed.stake = stakeInj;
    colorNumber($("stake"), displayed.stake, old, 4);
    $("stakeUsd").textContent = `≈ $${(displayed.stake * displayed.price).toFixed(2)}`;
  }

  // REWARDS
  if (displayed.rewards !== rewardsInj) {
    const old = displayed.rewards;
    displayed.rewards += (rewardsInj - old) * 0.5;
    if (Math.abs(displayed.rewards - rewardsInj) < 1e-8) displayed.rewards = rewardsInj;
    colorNumber($("rewards"), displayed.rewards, old, 7);
    $("rewardsUsd").textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

    // scala dinamica
    const minMax = 0.1;
    const dynMax = Math.max(minMax, Math.ceil(displayed.rewards * 10) / 10 || minMax);

    const perc = clamp((displayed.rewards / dynMax) * 100, 0, 100);

    $("rewardBar").style.width = perc + "%";
    $("rewardLine").style.left = perc + "%";
    $("rewardPercent").textContent = perc.toFixed(1) + "%";
    $("rewardBar").style.background = getHeatColor(perc);

    const rewardVals = document.querySelectorAll(".reward-values .reward-extremes");
    if (rewardVals.length >= 2) {
      rewardVals[0].textContent = "0";
      rewardVals[1].textContent = dynMax.toFixed(1);
    }
  }

  // APR
  $("apr").textContent = apr.toFixed(2) + "%";

  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

animate();
