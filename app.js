/* ======================
   STATE
====================== */
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

let priceOpen = 0;
let priceLow = Infinity;
let priceHigh = 0;

let availableInj = 0;
let stakeInj = 0;
let rewardsInj = 0;
let apr = 0;

let displayedAvailable = 0;
let displayedStake = 0;
let displayedRewards = 0;

let chart;
let chartData = [];
let chartLabels = [];

let ws;
let dataReady = false;

/* ======================
   HELPERS
====================== */
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

/* Animazione cifra per cifra */
function colorNumber(el, current, previous, decimals=2){
  if(!el) return;
  
  const curStr = current.toFixed(decimals);
  const prevStr = previous.toFixed(decimals).padStart(curStr.length, '0');

  let html = '';
  for(let i=0; i<curStr.length; i++){
    if(curStr[i] !== prevStr[i]){
      const color = +curStr[i] > +prevStr[i] ? '#22c55e' : '#ef4444';
      html += `<span style="color:${color}">${curStr[i]}</span>`;
    } else {
      html += `<span>${curStr[i]}</span>`;
    }
  }
  el.innerHTML = html;
}

async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

/* ======================
   ADDRESS INPUT
====================== */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* ======================
   ACCOUNT
====================== */
async function loadAccount(){
  if(!address) return;

  const [b,s,r,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj=(b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;

  rewardsInj=(r.rewards||[]).reduce(
    (a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0
  )/1e18;

  apr=Number(i.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,60000);

/* ======================
   CONNECTION STATUS
====================== */
const statusDot=$("connectionStatus").querySelector(".status-dot");
const statusText=$("connectionStatus").querySelector(".status-text");

function setStatus(on){
  statusDot.style.background=on?"#22c55e":"#ef4444";
  statusText.textContent=on?"Online":"Offline";
}

/* ======================
   DAY HISTORY
====================== */
function midnight(){
  const d=new Date();
  d.setHours(0,0,0,0);
  return d.getTime();
}

async function fetchDayHistory(){
  const start=midnight();
  const end=Date.now();
  const minutes=Math.floor((end-start)/60000);

  chartData=new Array(minutes).fill(null);
  chartLabels=new Array(minutes).fill("");

  const url=`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&startTime=${start}&endTime=${end}`;
  const d=await fetchJSON(url);
  if(!d.length) return;

  priceOpen=+d[0][1];
  priceLow=Math.min(...d.map(c=>+c[4]));
  priceHigh=Math.max(...d.map(c=>+c[4]));

  d.forEach(c=>{
    const idx=Math.floor((+c[0]-start)/60000);
    if(idx>=0 && idx<chartData.length) chartData[idx]=+c[4];
  });

  targetPrice=+d.at(-1)[4];
  displayedPrice=targetPrice;
  dataReady=true;

  initChart();
}

/* ======================
   CHART
====================== */
function createGradient(ctx,price){
  const color = price>=priceOpen ? "rgba(34,197,94,.25)" : "rgba(239,68,68,.25)";
  const g=ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  g.addColorStop(0,color);
  g.addColorStop(1,"rgba(0,0,0,0)");
  return g;
}

function initChart(){
  const ctx=$("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{
      labels:chartLabels,
      datasets:[{
        data:chartData.map(v=>v??NaN),
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx,targetPrice),
        fill:true,
        pointRadius:0
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{legend:{display:false}},
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}
    }
  });
}

/* ======================
   WEBSOCKET
====================== */
function startWS(){
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen=()=>setStatus(true);
  ws.onmessage=e=>{
    targetPrice=+JSON.parse(e.data).p;
    updateChartRealtime(targetPrice);
  };
  ws.onclose=()=>setTimeout(startWS,3000);
  ws.onerror=()=>setStatus(false);
}

/* ======================
   UPDATE CHART & PRICE BAR
====================== */
function updateChartRealtime(p){
  if(!chart) return;
  
  const idx = Math.floor((Date.now()-midnight())/60000);
  chartData[idx] = p;

  const color = p >= priceOpen ? "#22c55e" : "#ef4444";
  chart.data.datasets[0].borderColor = color;
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, p);

  chart.data.datasets[0].data = chartData.map(v => v??NaN);
  chart.update("none");

  priceLow = Math.min(priceLow, p);
  priceHigh = Math.max(priceHigh, p);

  updatePriceBar();
}

function updatePriceBar(){
  if(!dataReady || priceHigh===priceLow) return;

  const price = displayedPrice;
  let pct = price>=priceOpen
    ? 50 + ((price-priceOpen)/(priceHigh-priceOpen))*50
    : 50 - ((priceOpen-price)/(priceOpen-priceLow))*50;

  pct = Math.max(0, Math.min(100, pct));

  $("priceLine").style.left = pct+"%";

  const barColor = price>=priceOpen
    ? "linear-gradient(to right,#22c55e,#10b981)"
    : "linear-gradient(to right,#ef4444,#f87171)";

  $("priceBar").style.background = barColor;

  if(price>=priceOpen){
    $("priceBar").style.left = "50%";
    $("priceBar").style.width = (pct-50)+"%";
  } else {
    $("priceBar").style.left = pct+"%";
    $("priceBar").style.width = (50-pct)+"%";
  }

  $("priceMin").textContent = priceLow.toFixed(3);
  $("priceOpen").textContent = priceOpen.toFixed(3);
  $("priceMax").textContent = priceHigh.toFixed(3);
}

/* ======================
   UPDATE BOXES OGNI 2 SEC
====================== */
function updateBoxes() {
  // Available INJ
  const oldAvailable = displayedAvailable;
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  colorNumber($("available"), displayedAvailable, oldAvailable, 6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // Stake
  const oldStake = displayedStake;
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  colorNumber($("stake"), displayedStake, oldStake, 4);
  $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // Rewards
  const oldRewards = displayedRewards;
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.08);
  colorNumber($("rewards"), displayedRewards, oldRewards, 7);
  const rewardPct = Math.min(displayedRewards/0.05*100,100);
  $("rewardBar").style.width = rewardPct + "%";
  $("rewardBar").style.background = "linear-gradient(to right,#0ea5e9,#3b82f6)";
  $("rewardPercent").textContent = rewardPct.toFixed(1)+"%";

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";

  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();
}

// Aggiornamento box ogni 2 secondi
setInterval(updateBoxes, 2000);

/* ======================
   ANIMATION LOOP SOLO PREZZO
====================== */
function animate(){
  if(!dataReady){
    requestAnimationFrame(animate);
    return;
  }

  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  updatePriceBar();
  requestAnimationFrame(animate);
}

/* ======================
   RESET A MEZZANOTTE
====================== */
setInterval(()=>{
  const n = new Date();
  if(n.getHours()===0 && n.getMinutes()===0){
    fetchDayHistory();
  }
},60000);

/* ======================
   START
====================== */
fetchDayHistory().then(()=>{
  startWS();
  animate();
});
