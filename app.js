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

const $ = id => document.getElementById(id);
const lerp = (a, b, f) => a + (b - a) * f;

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    return await r.json();
  } catch {
    return {};
  }
}

/* ADDRESS */
$("addressInput").value = address;
$("addressInput").addEventListener("input", e => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

/* ACCOUNT */
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

/* PRICE HISTORY */
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

/* CHART */
function initChart() {
  chart = new Chart($("priceChart"), {
    type: "line",
    data: {
      labels: Array(chartData.length).fill(""),
      datasets: [{
        data: chartData,
        borderColor: "#22c55e",
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      plugins: { legend: { display: false } }
    }
  });
}

/* WEBSOCKET */
ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
ws.onmessage = e => {
  const p = +JSON.parse(e.data).p;
  targetPrice = p;
};

/* ANIMATION */
function animate() {
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  $("price").textContent = displayedPrice.toFixed(4);
  requestAnimationFrame(animate);
}

animate();
