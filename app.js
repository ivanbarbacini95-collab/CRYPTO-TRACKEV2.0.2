/* =======================
   STATE
======================= */
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

let priceOpen = 0;
let priceMin = 0;
let priceMax = 0;

let availableInj = 0;
let stakeInj = 0;
let rewardsInj = 0;
let apr = 0;

let displayedAvailable = 0;
let displayedStake = 0;
let displayedRewards = 0;

let chart, chartData = new Array(1440).fill(null);
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
   PRICE HISTORY - DAILY
======================= */
async function fetchDailyHistory() {
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440"
  );

  chartData = new Array(1440).fill(null); // inizializzo vuoto
  const now = new Date();
  const currentIndex = now.getHours() * 60 + now.getMinutes();

  // popolo i dati fino ad ora corrente
  d.forEach((c, i) => {
    if (i <= currentIndex) chartData[i] = +c[4]; // prezzo di chiusura
  });

  priceOpen = +d[0][1];
  priceMin = Math.min(...chartData.filter(v => v !== null));
  priceMax = Math.max(...chartData.filter(v => v !== null));
  targetPrice = chartData[currentIndex] || priceOpen;

  if (!chart) initChart();
}

fetchDailyHistory();

/* =======================
   CHART INIT
======================= */
function initChart() {
  const ctx = $("priceChart").getContext("2d");

  const labels = Array.from({length: 1440}, (_, i) => {
    if (i % 60 === 0) return `${String(Math.floor(i/60)).padStart(2,'0')}:00`;
    return "";
  });

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
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
        x: { display: true, ticks: { color: "#9ca3af" } },
        y: { ticks: { color: "#9ca3af" }, beginAtZero: false }
      }
    }
  });
}

/* =======================
   WEBSOCKET REAL-TIME
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

    priceMin = Math.min(priceMin, p);
    priceMax = Math.max(priceMax, p);

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
   CHART UPDATE - DAILY
======================= */
function updateChart(p) {
  if (!chart) return;

  const now = new Date();
  const index = now.getHours() * 60 + now.getMinutes();
  chart.data.datasets[0].data[index] = p;
  chart.update("none");
}

/* =======================
   PRICE & REWARD BAR ANIMATION
======================= */
function animate() {
  /* PRICE */
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  $("price").textContent = displayedPrice.toFixed(4);

  const perf = ((displayedPrice - priceOpen) / priceOpen) * 100;

  const barWidth = $("priceBar").parentElement.offsetWidth;
  const center = barWidth / 2;

  if (perf >= 0) {
    $("priceBar").style.left = `${center}px`;
    $("priceBar").style.width = `${Math.min(center, center * (perf / 100))}px`;
    $("priceBar").style.background = "#22c55e";
    $("priceLine").style.left = `${center + Math.min(center, center * (perf / 100))}px`;
  } else {
    $("priceBar").style.left = `${center + perf/100 * center}px`;
    $("priceBar").style.width = `${-perf/100 * center}px`;
    $("priceBar").style.background = "#ef4444";
    $("priceLine").style.left = `${center + perf/100 * center}px`;
  }

  $("price24h").textContent = `${perf >= 0 ? "▲" : "▼"} ${Math.abs(perf).toFixed(2)}%`;
  $("price24h").className = "sub " + (perf >= 0 ? "up" : "down");
  $("priceMin").textContent = priceMin.toFixed(3);
  $("priceOpen").textContent = priceOpen.toFixed(3);
  $("priceMax").textContent = priceMax.toFixed(3);

  /* AVAILABLE */
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  $("available").textContent = displayedAvailable.toFixed(6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable * displayedPrice).toFixed(2)}`;

  /* STAKE */
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  $("stake").textContent = displayedStake.toFixed(4);
  $("stakeUsd").textContent = `≈ $${(displayedStake * displayedPrice).toFixed(2)}`;

  /* REWARDS */
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.1);
  $("rewards").textContent = displayedRewards.toFixed(7);
  $("rewardsUsd").textContent = `≈ $${(displayedRewards * displayedPrice).toFixed(2)}`;

  const rewardPercent = Math.min((displayedRewards / 0.1) * 100, 100);
  $("rewardBar").style.width = rewardPercent + "%";
  $("rewardPercent").textContent = rewardPercent.toFixed(1) + "%";

  /* APR */
  $("apr").textContent = apr.toFixed(2) + "%";

  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  /* RESET MEZZANOTTE */
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 1) {
    chartData = new Array(1440).fill(priceOpen);
    chart.data.datasets[0].data = [...chartData];
    priceMin = priceOpen;
    priceMax = priceOpen;
  }

  requestAnimationFrame(animate);
}

animate();
