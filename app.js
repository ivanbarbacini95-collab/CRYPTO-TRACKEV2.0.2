/* =======================
   STATE
======================= */

let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

let price24hOpen = 0;
let price24hLow = 0;
let price24hHigh = 0;

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
  try { return await (await fetch(url)).json(); } 
  catch { return {}; }
}

/* =======================
   ADDRESS INPUT
======================= */

$("addressInput").value = address;

$("addressInput").addEventListener("input", e => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

/* =======================
   ACCOUNT LOAD
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
   PRICE HISTORY
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
  const ctx = $("priceChart").getContext("2d");

  chart = new Chart(ctx, {
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
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
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
    updateChart(p);
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(startWS, 3000);
  };

  ws.onerror = () => setConnectionStatus(false);
}

startWS();

/* =======================
   PRICE BAR LOGIC
======================= */

function updatePriceBar() {
  const price = displayedPrice;
  const open = price24hOpen;
  const min = price24hLow;
  const max = price24hHigh;
  const center = 50;

  if (price >= open) {
    const width = ((price - open) / (max - open || 1)) * 50;
    $("priceBar").style.left = center + "%";
    $("priceBar").style.width = width + "%";
    $("priceBar").style.background = "#22c55e";

    $("priceLine").style.left = (center + width) + "%";
    price24hHigh = Math.max(price24hHigh, price);
    $("priceMax").textContent = price24hHigh.toFixed(3);

  } else {
    const width = ((open - price) / (open - min || 1)) * 50;
    $("priceBar").style.left = (center - width) + "%";
    $("priceBar").style.width = width + "%";
    $("priceBar").style.background = "#ef4444";

    $("priceLine").style.left = (center - width) + "%";
    price24hLow = Math.min(price24hLow, price);
    $("priceMin").textContent = price24hLow.toFixed(3);
  }

  $("priceOpen").textContent = price24hOpen.toFixed(3);
}

/* =======================
   ANIMATION LOOP
======================= */

function animate() {
  /* PRICE */
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const d = ((displayedPrice - price24hOpen) / price24hOpen) * 100;
  $("price24h").textContent = `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className = "sub " + (d > 0 ? "up" : "down");

  updatePriceBar();

  /* AVAILABLE */
  const oa = displayedAvailable;
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  colorNumber($("available"), displayedAvailable, oa, 6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable * displayedPrice).toFixed(2)}`;

  /* STAKE */
  const os = displayedStake;
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  colorNumber($("stake"), displayedStake, os, 4);
  $("stakeUsd").textContent = `≈ $${(displayedStake * displayedPrice).toFixed(2)}`;

  /* REWARDS */
  const or = displayedRewards;
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.1);
  colorNumber($("rewards"), displayedRewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayedRewards * displayedPrice).toFixed(2)}`;

  /* REWARD BAR */
  const rewardTarget = 0.1;
  const rewardPercent = Math.min(displayedRewards / rewardTarget * 100, 100);
  $("rewardBar").style.width = rewardPercent + "%";
  $("rewardBar").style.background = "linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardPercent").textContent = rewardPercent.toFixed(1) + "%";

  /* APR */
  $("apr").textContent = apr.toFixed(2) + "%";

  $("updated").textContent =
    "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

animate();
