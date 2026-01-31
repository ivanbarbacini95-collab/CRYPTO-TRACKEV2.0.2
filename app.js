// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

const market = {
  open: 0,
  high: 0,
  low: 0,
  price: 0,
  changePct: 0
};

let uiPrice = 0;

let availableInj = 0;
let stakeInj = 0;
let rewardsInj = 0;
let apr = 0;

let displayedAvailable = 0;
let displayedStake = 0;
let displayedRewards = 0;

let chart, chartData = [];
let ws;

// ================= HELPERS =================
const $ = id => document.getElementById(id);

async function fetchJSON(url){
  try { return await (await fetch(url)).json(); }
  catch { return {}; }
}

// ================= ADDRESS =================
$("addressInput").value = address;
$("addressInput").addEventListener("input", e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

// ================= ACCOUNT =================
async function loadAccount(){
  if(!address) return;

  const [balances, staking, rewards, inflation] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj = (balances.balances?.find(b=>b.denom==="inj")?.amount || 0) / 1e18;
  stakeInj = (staking.delegation_responses || []).reduce((a,d)=>a+Number(d.balance.amount),0) / 1e18;
  rewardsInj = (rewards.rewards || []).reduce((a,r)=>a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0) / 1e18;
  apr = Number(inflation.inflation || 0) * 100;
}
loadAccount();
setInterval(loadAccount, 3000);

// ================= BINANCE 24H =================
async function fetch24h(){
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/ticker/24hr?symbol=INJUSDT"
  );

  market.open = +d.openPrice;
  market.high = +d.highPrice;
  market.low = +d.lowPrice;
  market.price = +d.lastPrice;
  market.changePct = +d.priceChangePercent;

  if(!uiPrice) uiPrice = market.price;
}
fetch24h();
setInterval(fetch24h, 30000);

// ================= WEBSOCKET =================
function setConnectionStatus(ok){
  $("connectionStatus").querySelector(".status-dot").style.background =
    ok ? "#22c55e" : "#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent =
    ok ? "Online" : "Offline";
}

function startWS(){
  if(ws) ws.close();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => setConnectionStatus(true);

  ws.onmessage = e => {
    market.price = +JSON.parse(e.data).p;
    updateChart(market.price);
  };

  ws.onclose = () => {
    setConnectionStatus(false);
    setTimeout(startWS, 3000);
  };

  ws.onerror = () => setConnectionStatus(false);
}
startWS();

// ================= CHART =================
async function initHistory(){
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440"
  );
  chartData = d.map(c=>+c[4]);
  initChart();
}
initHistory();

function initChart(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels:Array(chartData.length).fill(""),
      datasets:[{
        data: chartData,
        borderColor:"#22c55e",
        backgroundColor:"rgba(34,197,94,0.2)",
        fill:true,
        pointRadius:0,
        tension:0.3
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ display:false },
        y:{ ticks:{color:"#9ca3af"} }
      }
    }
  });
}

function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ================= RENDER =================
function renderPrice(){
  const prev = uiPrice;
  uiPrice += (market.price - uiPrice) * 0.12;

  $("price").textContent = uiPrice.toFixed(4);

  const pct = market.changePct;
  $("price24h").textContent =
    `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2)}%`;
  $("price24h").className = "sub " + (pct > 0 ? "up" : "down");

  // micro feedback card
  const card = document.querySelector(".price-card");
  card.classList.remove("up","down");
  if(Math.abs(uiPrice - prev) > 0.0001){
    card.classList.add(uiPrice > prev ? "up" : "down");
    setTimeout(()=>card.classList.remove("up","down"),150);
  }
}

function renderBar(){
  const { open, high, low } = market;
  if(!high || !low) return;

  const bar = $("priceBar");
  const line = $("priceLine");

  const openPos = (open - low) / (high - low) * 100;
  const pricePos = (uiPrice - low) / (high - low) * 100;

  if(uiPrice >= open){
    bar.style.left = openPos+"%";
    bar.style.width = (pricePos-openPos)+"%";
    bar.style.background = "linear-gradient(to right,#22c55e,#10b981)";
  } else {
    bar.style.left = pricePos+"%";
    bar.style.width = (openPos-pricePos)+"%";
    bar.style.background = "linear-gradient(to left,#ef4444,#f87171)";
  }

  line.style.left = pricePos+"%";

  $("priceMin").textContent = low.toFixed(3);
  $("priceOpen").textContent = open.toFixed(3);
  $("priceMax").textContent = high.toFixed(3);
}

function renderBalances(){
  if(displayedAvailable !== availableInj){
    displayedAvailable = availableInj;
    $("available").textContent = displayedAvailable.toFixed(6);
    $("availableUsd").textContent =
      `≈ $${(displayedAvailable * uiPrice).toFixed(2)}`;
  }

  if(displayedStake !== stakeInj){
    displayedStake = stakeInj;
    $("stake").textContent = displayedStake.toFixed(4);
    $("stakeUsd").textContent =
      `≈ $${(displayedStake * uiPrice).toFixed(2)}`;
  }

  if(displayedRewards !== rewardsInj){
    displayedRewards = rewardsInj;
    $("rewards").textContent = displayedRewards.toFixed(7);
    $("rewardsUsd").textContent =
      `≈ $${(displayedRewards * uiPrice).toFixed(2)}`;

    const perc = Math.min(displayedRewards / 0.1, 1) * 100;
    $("rewardBar").style.width = perc + "%";
    $("rewardLine").style.left = perc + "%";
    $("rewardPercent").textContent = perc.toFixed(1) + "%";
  }

  $("apr").textContent = apr.toFixed(2) + "%";
}

// ================= LOOP =================
function loop(){
  renderPrice();
  renderBar();
  renderBalances();
  $("updated").textContent =
    "Last update: " + new Date().toLocaleTimeString();
  requestAnimationFrame(loop);
}
loop();
