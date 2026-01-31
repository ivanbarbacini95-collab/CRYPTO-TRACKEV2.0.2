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

function colorNumber(el, n, o, decimals = 4){
  const ns = n.toFixed(decimals);
  const os = o.toFixed(decimals);

  el.innerHTML = [...ns].map((c,i)=>{
    if(c !== os[i]){
      return `<span style="color:${n>o?"#22c55e":"#ef4444"}">${c}</span>`;
    }
    return `<span style="color:#f9fafb">${c}</span>`;
  }).join("");
}

function smartSmooth(current, target){
  const diff = Math.abs(target - current);

  if(diff > 10) return target;              // cambi grossi → istantaneo
  if(diff > 1)  return current + (target-current)*0.45;
  if(diff > 0.1)return current + (target-current)*0.28;
  return current + (target-current)*0.14;
}

async function fetchJSON(url){
  try { return await (await fetch(url)).json(); }
  catch { return {}; }
}

/* =======================
   ADDRESS INPUT
======================= */

$("addressInput").value = address;

$("addressInput").addEventListener("input", e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
});

/* =======================
   ACCOUNT LOAD
======================= */

async function loadAccount(){
  if(!address.startsWith("inj")) return;

  const [balances, staking, rewards, inflation] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj =
    (balances.balances?.find(b=>b.denom==="inj")?.amount || 0) / 1e18;

  stakeInj =
    (staking.delegation_responses || [])
      .reduce((a,d)=>a + Number(d.balance.amount), 0) / 1e18;

  rewardsInj =
    (rewards.rewards || [])
      .reduce((a,r)=>a + r.reward.reduce((s,x)=>s + Number(x.amount),0), 0) / 1e18;

  apr = Number(inflation.inflation || 0) * 100;
}

loadAccount();
setInterval(loadAccount, 60000);

/* =======================
   PRICE HISTORY
======================= */

async function fetchHistory(){
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440"
  );

  chartData = d.map(c=>+c[4]);

  price24hOpen = +d[0][1];
  price24hLow  = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);

  targetPrice = chartData.at(-1);
  displayedPrice = targetPrice;

  if(!chart) initChart();
}

fetchHistory();

/* =======================
   CHART
======================= */

function initChart(){
  const ctx = $("priceChart").getContext("2d");

  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels:Array(1440).fill(""),
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

/* =======================
   WEBSOCKET
======================= */

function setConnectionStatus(online){
  $("connectionStatus").querySelector(".status-dot").style.background =
    online ? "#22c55e" : "#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent =
    online ? "Online" : "Offline";
}

function startWS(){
  if(ws) ws.close();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = ()=>setConnectionStatus(true);

  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    price24hHigh = Math.max(price24hHigh, p);
    price24hLow  = Math.min(price24hLow,  p);
    updateChart(p);
  };

  ws.onclose = ()=>{
    setConnectionStatus(false);
    setTimeout(startWS, 3000);
  };

  ws.onerror = ()=>setConnectionStatus(false);
}

startWS();

/* =======================
   MAIN LOOP (FAST & FLUID)
======================= */

setInterval(()=>{

  /* -------- PRICE -------- */

  const oldPrice = displayedPrice;
  displayedPrice = smartSmooth(displayedPrice, targetPrice);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const sessionPerc =
    ((displayedPrice - price24hOpen) / price24hOpen) * 100;

  $("price24h").textContent =
    `${sessionPerc>=0?"▲":"▼"} ${Math.abs(sessionPerc).toFixed(2)}%`;
  $("price24h").className =
    "sub " + (sessionPerc>=0 ? "up" : "down");

  $("priceMin").textContent  = price24hLow.toFixed(3);
  $("priceOpen").textContent= price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);

  /* -------- PRICE BAR (OPEN-CENTERED) -------- */

  const maxMove = Math.max(
    Math.abs(price24hHigh - price24hOpen),
    Math.abs(price24hOpen - price24hLow),
    0.0001
  );

  const offsetPerc =
    ((displayedPrice - price24hOpen) / maxMove) * 50;

  const linePos = Math.max(0, Math.min(100, 50 + offsetPerc));
  $("priceLine").style.left = linePos + "%";

  const barWidth = Math.abs(offsetPerc);
  $("priceBar").style.width = barWidth + "%";
  $("priceBar").style.left =
    offsetPerc >= 0
      ? "50%"
      : (50 - barWidth) + "%";

  $("priceBar").style.background =
    offsetPerc >= 0 ? "#22c55e" : "#ef4444";

  /* -------- AVAILABLE -------- */

  const oldA = displayedAvailable;
  displayedAvailable = smartSmooth(displayedAvailable, availableInj);
  colorNumber($("available"), displayedAvailable, oldA, 6);
  $("availableUsd").textContent =
    `≈ $${(displayedAvailable * displayedPrice).toFixed(2)}`;

  /* -------- STAKE -------- */

  const oldS = displayedStake;
  displayedStake = smartSmooth(displayedStake, stakeInj);
  colorNumber($("stake"), displayedStake, oldS, 4);
  $("stakeUsd").textContent =
    `≈ $${(displayedStake * displayedPrice).toFixed(2)}`;

  /* -------- REWARDS -------- */

  const oldR = displayedRewards;
  displayedRewards = smartSmooth(displayedRewards, rewardsInj);
  colorNumber($("rewards"), displayedRewards, oldR, 7);
  $("rewardsUsd").textContent =
    `≈ $${(displayedRewards * displayedPrice).toFixed(2)}`;

  const rewardPerc = stakeInj
    ? Math.min((displayedRewards / stakeInj) * 100, 100)
    : 0;

  $("rewardBar").style.width = rewardPerc + "%";
  $("rewardPercent").textContent =
    rewardPerc.toFixed(1) + "%";

  /* -------- APR + UPDATE -------- */

  $("apr").textContent = apr.toFixed(2) + "%";
  $("updated").textContent =
    "Last update: " + new Date().toLocaleTimeString();

}, 120);
