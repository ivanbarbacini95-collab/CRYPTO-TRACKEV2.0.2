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
let displayedApr = 0;

let chart;
let chartData = new Array(1440).fill(null);
let chartLabels = Array.from({length:1440},(_,i)=>`${Math.floor(i/60).toString().padStart(2,'0')}:${(i%60).toString().padStart(2,'0')}`);

let ws;
let dataReady = false;
let firstLoad = true;

let price24hChange = 0;

/* ======================
   HELPERS
====================== */
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

function colorNumber(el, current, previous, decimals=2){
  if(!el) return;
  const curStr = current.toFixed(decimals);
  const prevStr = previous.toFixed(decimals).padStart(curStr.length, '0');
  let html = '';
  for(let i=0;i<curStr.length;i++){
    if(curStr[i]!==prevStr[i]){
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

function midnight(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }

/* ======================
   ADDRESS INPUT
====================== */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
  firstLoad = true;
};

/* ======================
   ACCOUNT
====================== */
async function loadAccount(){
  if(!address) return;

  const [b,s,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj=(b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
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
   CHART
====================== */
async function fetchChartData(){
  const start=midnight();
  const end=Date.now();
  const minutes=Math.floor((end-start)/60000);

  const url=`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&startTime=${start}&endTime=${end}`;
  const d=await fetchJSON(url);
  if(!d.length) return;

  priceOpen=+d[0][1];
  priceLow=Math.min(...d.map(c=>+c[4]));
  priceHigh=Math.max(...d.map(c=>+c[4]));

  d.forEach(c=>{
    const idx = Math.floor((+c[0]-start)/60000);
    if(idx>=0 && idx<chartData.length) chartData[idx] = +c[4];
  });

  targetPrice = +d.at(-1)[4];
  displayedPrice = targetPrice;
  dataReady = true;

  initChart();
  fetch24hChange();
}

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
        pointRadius:0,
        tension:0.2
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{legend:{display:false}},
      scales:{x:{display:true},y:{ticks:{color:"#9ca3af"}}}
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
  if(idx>=chartData.length) return;
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

/* ======================
   PRICE BAR
====================== */
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
   ACCOUNT BOXES
====================== */
function animateBoxes() {
  // Available
  if(Math.abs(displayedAvailable - availableInj) > 0.000001){
    const old = displayedAvailable;
    displayedAvailable = lerp(displayedAvailable, availableInj, 0.05);
    colorNumber($("available"), displayedAvailable, old, 6);
    $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;
  }

  // Staked
  if(Math.abs(displayedStake - stakeInj) > 0.000001){
    const old = displayedStake;
    displayedStake = lerp(displayedStake, stakeInj, 0.05);
    colorNumber($("stake"), displayedStake, old, 4);
    $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;
  }

  // Rewards
  if(Math.abs(displayedRewards - rewardsInj) > 0.0000001){
    const old = displayedRewards;
    displayedRewards = lerp(displayedRewards, rewardsInj, 0.05);
    colorNumber($("rewards"), displayedRewards, old, 7);
    $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

    const rewardPct = Math.min(displayedRewards/0.1*100,100);
    $("rewardBar").style.width = rewardPct + "%";
    $("rewardBar").style.background = "linear-gradient(to right,#0ea5e9,#3b82f6)";
    $("rewardPercent").textContent = rewardPct.toFixed(1)+"%";
  }

  // APR
  if(Math.abs(displayedApr - apr) > 0.0001){
    const old = displayedApr;
    displayedApr = lerp(displayedApr, apr, 0.05);
    colorNumber($("apr"), displayedApr, old, 2);
  }
}

/* ======================
   REWARDS UPDATE
====================== */
setInterval(async ()=>{
  if(!address) return;

  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce(
    (a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0
  )/1e18;

  // Se rewards sono stati prelevati o aggiunti, aggiorna available e staked
  if(newRewards !== rewardsInj){
    const diff = rewardsInj - newRewards;
    availableInj += diff; // se prelevati, aumentano in available
    rewardsInj = newRewards;
  }
}, 2500);

/* ======================
   PRICE TREND & 24H %
====================== */
async function fetch24hChange(){
  const data = await fetchJSON("https://api.binance.com/api/v3/ticker/24hr?symbol=INJUSDT");
  if(!data) return;

  price24hChange = parseFloat(data.priceChangePercent);
  $("pricePercent").textContent = (price24hChange>=0?"+":"")+price24hChange.toFixed(2)+"%";
  $("pricePercent").style.color = price24hChange>=0?"#22c55e":"#ef4444";
}

function updatePriceTrend(oldPrice){
  const trendEl = $("priceTrend");
  if(displayedPrice > oldPrice){
    trendEl.textContent = "▲";
    trendEl.style.color = "#22c55e";
  } else if(displayedPrice < oldPrice){
    trendEl.textContent = "▼";
    trendEl.style.color = "#ef4444";
  } else {
    trendEl.textContent = "–";
    trendEl.style.color = "#9ca3af";
  }
}

/* ======================
   ANIMATION LOOP
====================== */
function animate(){
  if(!dataReady){ requestAnimationFrame(animate); return; }

  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.05);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  updatePriceBar();
  updatePriceTrend(oldPrice);
  animateBoxes();

  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

/* ======================
   RESET A MEZZANOTTE
====================== */
setInterval(()=>{
  const n = new Date();
  if(n.getHours()===0 && n.getMinutes()===0){
    chartData.fill(null);
    priceLow = Infinity;
    priceHigh = 0;
    fetchChartData();
  }
},60000);

/* ======================
   START
====================== */
fetchChartData().then(()=>{
  startWS();
  animate();
});
