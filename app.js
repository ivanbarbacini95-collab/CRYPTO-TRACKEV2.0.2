// ================================
// Injective Dashboard – Realtime
// ================================

let address = localStorage.getItem("inj_address") || "";

// ---- PRICE ----
let targetPrice = 0;
let displayedPrice = 0;
let price24hOpen = 0;
let price24hLow = Infinity;
let price24hHigh = -Infinity;

// ---- WALLET ----
let availableInj = 0, displayedAvailable = 0;
let stakeInj = 0, displayedStake = 0;
let rewardsInj = 0, displayedRewards = 0;
let apr = 0;

// ---- CHART ----
let chart, chartData = [];

// ---- DOM ----
const el = id => document.getElementById(id);
const priceEl = el("price");
const price24hEl = el("price24h");
const priceBarEl = el("priceBar");
const priceLineEl = el("priceLine");
const priceMinEl = el("priceMin");
const priceMaxEl = el("priceMax");
const priceOpenEl = el("priceOpen");

const availableEl = el("available");
const availableUsdEl = el("availableUsd");
const stakeEl = el("stake");
const stakeUsdEl = el("stakeUsd");
const rewardsEl = el("rewards");
const rewardsUsdEl = el("rewardsUsd");
const rewardBarEl = el("rewardBar");
const rewardPercentEl = el("rewardPercent");
const aprEl = el("apr");
const updatedEl = el("updated");

const addressInput = el("addressInput");
addressInput.value = address;
addressInput.onchange = e => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadWallet();
};

// ================================
// Helpers
// ================================
const fetchJSON = async url => {
  try {
    const r = await fetch(url);
    return await r.json();
  } catch {
    return {};
  }
};

// ================================
// WALLET DATA (every 2s)
// ================================
async function loadWallet(){
  if(!address) return;

  const balance = await fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`);
  const inj = balance.balances?.find(b=>b.denom==="inj");
  availableInj = inj ? +inj.amount/1e18 : 0;

  const stake = await fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`);
  stakeInj = stake.delegation_responses?.reduce((s,d)=>s+Number(d.balance.amount||0),0)/1e18||0;

  const rewards = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  rewardsInj = rewards.rewards?.reduce((s,r)=>s+Number(r.reward[0]?.amount||0),0)/1e18||0;

  const inflation = await fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`);
  const pool = await fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/pool`);
  const bonded = Number(pool.pool?.bonded_tokens||0);
  const total = bonded + Number(pool.pool?.not_bonded_tokens||0);
  apr = bonded ? (inflation.inflation * total / bonded) * 100 : 0;
}
loadWallet();
setInterval(loadWallet, 2000);

// ================================
// INIT 24H PRICE + CHART
// ================================
async function init24h(){
  const res = await fetch("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=15m&limit=96");
  const d = await res.json();

  chartData = d.map(c=>+c[4]);
  price24hOpen = +d[0][1];
  price24hLow = Math.min(...d.map(c=>+c[3]));
  price24hHigh = Math.max(...d.map(c=>+c[2]));
  targetPrice = chartData.at(-1);
  displayedPrice = targetPrice;

  drawChart();
  updateBarImmediate();
}
init24h();

// ================================
// BINANCE WEBSOCKET
// ================================
function startWS(){
  const ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onmessage = e => {
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    if(p < price24hLow) price24hLow = p;
    if(p > price24hHigh) price24hHigh = p;

    chartData.push(p);
    if(chartData.length>96) chartData.shift();
    chart.data.datasets[0].data = chartData;
    chart.update();
  };
  ws.onclose = ()=>setTimeout(startWS,3000);
}
startWS();

// ================================
// CHART
// ================================
function drawChart(){
  const ctx = el("priceChart");
  chart = new Chart(ctx,{
    type:"line",
    data:{labels:chartData.map((_,i)=>i),datasets:[{
      data:chartData,
      borderColor:"#22c55e",
      backgroundColor:"rgba(34,197,94,.2)",
      fill:true,
      tension:.3,
      pointRadius:0
    }]},
    options:{plugins:{legend:{display:false}},scales:{x:{display:false}}}
  });
}

// ================================
// BAR INIT (no animation)
// ================================
function updateBarImmediate(){
  const center = 50;
  let pos = center;

  if(displayedPrice>=price24hOpen){
    pos = center + Math.min((displayedPrice-price24hOpen)/(price24hHigh-price24hOpen)*50,50);
    priceBarEl.style.left="50%";
    priceBarEl.style.width=(pos-center)+"%";
    priceBarEl.style.background="linear-gradient(to right,#22c55e,#10b981)";
  } else {
    pos = center - Math.min((price24hOpen-displayedPrice)/(price24hOpen-price24hLow)*50,50);
    priceBarEl.style.left=pos+"%";
    priceBarEl.style.width=(center-pos)+"%";
    priceBarEl.style.background="linear-gradient(to right,#ef4444,#f87171)";
  }

  priceLineEl.style.left=pos+"%";
}

// ================================
// DIGIT ANIMATION
// ================================
function animateDigits(el, cur, tgt, dec){
  const c = cur.toFixed(dec);
  const t = tgt.toFixed(dec);
  if(c===t) return cur;

  el.classList.add(tgt>cur?"up":"down");
  setTimeout(()=>el.classList.remove("up","down"),300);
  el.innerText = t;
  return tgt;
}

// ================================
// MAIN LOOP
// ================================
function animate(){
  // PRICE
  displayedPrice += (targetPrice-displayedPrice)*0.15;
  displayedPrice = animateDigits(priceEl, displayedPrice, targetPrice, 4);

  const delta = ((displayedPrice-price24hOpen)/price24hOpen)*100;
  price24hEl.innerText = (delta>=0?"▲ ":"▼ ")+Math.abs(delta).toFixed(2)+"%";
  price24hEl.className="sub "+(delta>0?"up":"down");

  // BAR + ATH/ATL FLASH
  const center=50;
  let pos=center;
  let flash=false;

  if(displayedPrice>=price24hOpen){
    pos=center+Math.min((displayedPrice-price24hOpen)/(price24hHigh-price24hOpen)*50,50);
    priceBarEl.style.left="50%";
    priceBarEl.style.width=(pos-center)+"%";
    flash = displayedPrice>=price24hHigh;
    priceBarEl.style.background=flash?"#facc15":"linear-gradient(to right,#22c55e,#10b981)";
  } else {
    pos=center-Math.min((price24hOpen-displayedPrice)/(price24hOpen-price24hLow)*50,50);
    priceBarEl.style.left=pos+"%";
    priceBarEl.style.width=(center-pos)+"%";
    flash = displayedPrice<=price24hLow;
    priceBarEl.style.background=flash?"#facc15":"linear-gradient(to right,#ef4444,#f87171)";
  }

  priceLineEl.style.left=pos+"%";
  priceMinEl.innerText=price24hLow.toFixed(4);
  priceMaxEl.innerText=price24hHigh.toFixed(4);
  priceOpenEl.innerText=price24hOpen.toFixed(4);

  // WALLET
  displayedAvailable = animateDigits(availableEl, displayedAvailable, availableInj, 6);
  availableUsdEl.innerText=(displayedAvailable*displayedPrice).toFixed(2);

  displayedStake = animateDigits(stakeEl, displayedStake, stakeInj, 4);
  stakeUsdEl.innerText=(displayedStake*displayedPrice).toFixed(2);

  displayedRewards = animateDigits(rewardsEl, displayedRewards, rewardsInj, 7);
  rewardsUsdEl.innerText=(displayedRewards*displayedPrice).toFixed(2);

  const rp=Math.min(displayedRewards/0.1*100,100);
  rewardBarEl.style.width=rp+"%";
  rewardPercentEl.innerText=rp.toLocaleString("it-IT",{minimumFractionDigits:2})+"%";

  aprEl.innerText=apr.toFixed(2)+"%";
  updatedEl.innerText="Last Update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();