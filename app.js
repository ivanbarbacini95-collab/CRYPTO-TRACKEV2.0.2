/* =======================
   STATE
======================= */

let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

let price24hOpen = 0;
let price24hLow = Infinity;
let price24hHigh = -Infinity;

let availableInj = 0;
let stakeInj = 0;
let rewardsInj = 0;
let apr = 0;

let displayedAvailable = 0;
let displayedStake = 0;
let displayedRewards = 0;

let chart, chartData = [];
let ws;

/* =======================
   HELPERS
======================= */

const $ = id => document.getElementById(id);
const lerp = (a, b, f) => a + (b - a) * f;

function colorNumber(el, n, o, d) {
  const ns = n.toFixed(d);
  const os = o.toFixed(d);

  el.innerHTML = [...ns].map((c, i) => {
    if (c !== os[i]) {
      return `<span style="color:${n > o ? "#22c55e" : "#ef4444"}">${c}</span>`;
    }
    return `<span style="color:#f9fafb">${c}</span>`;
  }).join("");
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    return await r.json();
  } catch {
    return {};
  }
}

/* =======================
   ADDRESS
======================= */

$("addressInput").value = address;
$("addressInput").addEventListener("input", e => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

/* =======================
   ACCOUNT
======================= */

async function loadAccount() {
  if (!address) return;

  const [balances, staking, rewards, inflation] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj =
    (balances.balances?.find(b => b.denom === "inj")?.amount || 0) / 1e18;

  stakeInj =
    (staking.delegation_responses || [])
      .reduce((a, d) => a + Number(d.balance.amount), 0) / 1e18;

  rewardsInj =
    (rewards.rewards || [])
      .reduce((a, r) =>
        a + r.reward.reduce((s, x) => s + Number(x.amount), 0), 0
      ) / 1e18;

  apr = Number(inflation.inflation || 0) * 100;
}

loadAccount();
setInterval(loadAccount, 60000);

/* =======================
   PRICE HISTORY 24H
======================= */

async function fetchHistory() {
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24"
  );

  chartData = d.map(c => +c[4]);
  price24hOpen = +d[0][1];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);

  if (!chart) initChart();
}

fetchHistory();

/* =======================
   CHART
======================= */

function initChart() {
  chart = new Chart($("priceChart"), {
    type: "line",
    data: {
      labels: Array(chartData.length).fill(""),
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
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" } }
      }
    }
  });
}

function updateChart(p) {
  if (!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

/* =======================
   WEBSOCKET
======================= */

function setConnectionStatus(online) {
  $("connectionStatus").querySelector(".status-dot").style.background =
    online ? "#22c55e" : "#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent =
    online ? "Online" : "Offline";
}

function startWS() {
  if (ws) ws.close();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => setConnectionStatus(true);

  ws.onmessage = e => {
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    price24hLow = Math.min(price24hLow, p);
    price24hHigh = Math.max(price24hHigh, p);
    updateChart(p);
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(startWS, 3000);
  };
}

startWS();

/* =======================
   ANIMATION LOOP
======================= */

function animate() {
  /* PRICE */
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const perf = ((displayedPrice - price24hOpen) / price24hOpen) * 100;
  $("price24h").textContent = `${perf >= 0 ? "▲" : "▼"} ${Math.abs(perf).toFixed(2)}%`;
  $("price24h").className = "sub " + (perf >= 0 ? "up" : "down");

  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);

  /* PRICE BAR */
  const container = $("priceBar").parentElement;
  const half = container.clientWidth / 2;
  const ratio = Math.min(Math.abs(perf) / 10, 1);
  const size = ratio * half;

  if (perf >= 0) {
    $("priceBar").style.left = half + "px";
    $("priceBar").style.width = size + "px";
    $("priceBar").style.background = "#22c55e";
    $("priceLine").style.left = half + size + "px";
  } else {
    $("priceBar").style.left = half - size + "px";
    $("priceBar").style.width = size + "px";
    $("priceBar").style.background = "#ef4444";
    $("priceLine").style.left = half - size + "px";
  }

  /* AVAILABLE */
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  colorNumber($("available"), displayedAvailable, displayedAvailable - 0.000001, 6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable * displayedPrice).toFixed(2)}`;

  /* STAKE */
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  colorNumber($("stake"), displayedStake, displayedStake - 0.0001, 4);
  $("stakeUsd").textContent = `≈ $${(displayedStake * displayedPrice).toFixed(2)}`;

  /* REWARDS */
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.1);
  colorNumber($("rewards"), displayedRewards, displayedRewards - 0.000001, 7);
  $("rewardsUsd").textContent = `≈ $${(displayedRewards * displayedPrice).toFixed(2)}`;

  const rewardPercent = Math.min(displayedRewards / 0.1 * 100, 100);
  $("rewardBar").style.width = rewardPercent + "%";
  $("rewardPercent").textContent = rewardPercent.toFixed(1) + "%";

  /* APR */
  $("apr").textContent = apr.toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

animate();
