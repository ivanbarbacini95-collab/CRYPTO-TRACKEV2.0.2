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
let chartData = [];
let chartLabels = [];

let ws;
let dataReady = false;

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
   DAY CHART
====================== */
function midnightItaly(){
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const cet = 1*60*60*1000;
  const italyTime = utc + cet;
  const newD = new Date(italyTime);
  newD.setHours(0,0,0,0);
  return newD.getTime();
}

async function initDayChart(){
  const start = midnightItaly();
  const now = Date.now();
  const minutes = 24*60;

  chartLabels = Array.from({length:minutes}, (_,i)=>{
    const h = Math.floor(i/60).toString().padStart(2,'0');
    const m = (i%60).toString().padStart(2,'0');
    return `${h}:${m}`;
  });

  chartData = new Array(minutes).fill(null);

  const klines = await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&startTime=${start}&endTime=${now}`);
  if(klines.length){
    priceOpen = +klines[0][1];
    priceLow = Math.min(...klines.map(c=>+c[4]));
    priceHigh = Math.max(...klines.map(c=>+c[4]));
    klines.forEach(c=>{
      const idx = Math.floor((+c[0]-start)/60000);
      if(idx>=0 && idx<chartData.length) chartData[idx] = +c[4];
    });
    targetPrice = +klines.at(-1)[4];
    displayedPrice = targetPrice;
  }

  initChart();
  dataReady = true;
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
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: chartLabels,
      datasets:[{
        data: chartData.map(v=>v??NaN),
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
      scales:{
        x:{display:true, ticks:{color:"#9ca3af"}},
        y:{ticks:{color:"#9ca3af"}}
      }
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

function updateChartRealtime(price){
  if(!chart) return;
  const idx = Math.floor((Date.now()-midnightItaly())/60000);
  if(idx<0 || idx>=chartData.length) return;
  chartData[idx] = price;

  priceLow = Math.min(priceLow, price);
  priceHigh = Math.max(priceHigh, price);

  chart.data.datasets[0].data = chartData.map(v=>v??NaN);
  chart.data.datasets[0].borderColor = price>=priceOpen ? "#22c55e" : "#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);
  chart.update("none");

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
function animateBoxes(){
  if(Math.abs(displayedAvailable - availableInj) > 0.000001){
    const old = displayedAvailable;
    displayedAvailable = lerp(displayedAvailable, availableInj, 0.05);
    colorNumber($("available"), displayedAvailable, old, 6);
    $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;
  }
  if(Math.abs(displayedStake - stakeInj) > 0.000001){
    const old = displayedStake;
    displayedStake = lerp(displayedStake, stakeInj, 0.05);
    colorNumber($("stake"), displayedStake, old, 4);
    $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;
  }
  if(Math.abs(displayedRewards - rewardsInj) > 0.000001){
    const old = displayedRewards;
    displayedRewards = lerp(displayedRewards, rewardsInj, 0.05);
    colorNumber($("rewards"), displayedRewards, old, 7);
    $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  }
  if(Math.abs(displayedApr - apr) > 0.01){
    displayedApr = lerp(displayedApr, apr, 0.05);
    $("apr").textContent = displayedApr.toFixed(2)+"%";
  }
}

/* ======================
   24H CHANGE
====================== */
async function fetch24hChange(){
  const data = await fetchJSON("https://api.binance.com/api/v3/ticker/24hr?symbol=INJUSDT");
  price24hChange = parseFloat(data.priceChangePercent||0);
  $("pricePercent").textContent = `${price24hChange.toFixed(2)}%`;
  $("pricePercent").className = price24hChange>=0?"up":"down";
}

/* ======================
   RESET GIORNALIERO
====================== */
setInterval(()=>{
  const now = new Date();
  if(now.getHours()===0 && now.getMinutes()===0){
    priceLow = Infinity;
    priceHigh = 0;
    initDayChart();
  }
},60000);

/* ======================
   MAIN LOOP
====================== */
function animate(){
  animateBoxes();
  $("price").textContent = displayedPrice.toFixed(4);
  $("updated").textContent = `Last update: ${new Date().toLocaleTimeString()}`;
  requestAnimationFrame(animate);
}

/* ======================
   START
====================== */
initDayChart().then(()=>{
  startWS();
  animate();
});
