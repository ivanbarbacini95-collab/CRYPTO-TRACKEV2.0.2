/* ======================
   STATE
====================== */
let address = localStorage.getItem("inj_address") || "";

let priceOpen = 0, priceLow = Infinity, priceHigh = 0;
let chart, chartData = [], chartLabels = [];

let ws, dataReady = false;
let targetPrice = 0, displayedPrice = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;
let price24hChange = 0;

/* ======================
   HELPERS
====================== */
const $ = id => document.getElementById(id);
const fetchJSON = async url => {
  try { return await (await fetch(url)).json(); }
  catch { return null; }
};
const colorNumber = (el, cur, prev, decimals=2) => {
  if(!el) return;
  const c = cur.toFixed(decimals), p = prev.toFixed(decimals).padStart(c.length,'0');
  let html='';
  for(let i=0;i<c.length;i++){
    if(c[i]!==p[i]){
      html+=`<span style="color:${+c[i]>+p[i]?'#22c55e':'#ef4444'}">${c[i]}</span>`;
    } else html+=c[i];
  }
  el.innerHTML=html;
};

/* ======================
   ADDRESS INPUT
====================== */
$("addressInput").value = address;
$("addressInput").onchange = e => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
  fetchDayHistory();
};

/* ======================
   ACCOUNT DATA
====================== */
async function loadAccount() {
  if(!address) return;

  const [balances, delegations, rewardsData, inflation] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj = (balances?.balances?.find(b => b.denom==="inj")?.amount||0)/1e18;
  stakeInj = (delegations?.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
  rewardsInj = (rewardsData?.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  apr = Number(inflation?.inflation||0)*100;
}

/* ======================
   CONNECTION STATUS
====================== */
const statusDot = $("connectionStatus").querySelector(".status-dot");
const statusText = $("connectionStatus").querySelector(".status-text");
function setStatus(on){ statusDot.style.background = on?"#22c55e":"#ef4444"; statusText.textContent = on?"Online":"Offline"; }

/* ======================
   DAY HISTORY
====================== */
function midnight(){ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); }

async function fetchDayHistory(){
  const start=midnight(), end=Date.now();
  const minutes=Math.floor((end-start)/60000);

  chartData=new Array(minutes).fill(null);
  chartLabels=new Array(minutes).fill("");

  const d = await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&startTime=${start}&endTime=${end}`);
  if(!d?.length) return;

  priceOpen=+d[0][1];
  priceLow=Math.min(...d.map(c=>+c[4]));
  priceHigh=Math.max(...d.map(c=>+c[4]));

  d.forEach(c=>{
    const idx=Math.floor((+c[0]-start)/60000);
    if(idx>=0 && idx<chartData.length) chartData[idx]=+c[4];
  });

  targetPrice = +d.at(-1)[4];
  displayedPrice = targetPrice;
  dataReady = true;

  initChart();
  fetch24hChange();
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
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{ labels: chartLabels, datasets:[{data: chartData.map(v=>v??NaN), borderColor:"#22c55e", backgroundColor:createGradient(ctx,targetPrice), fill:true, pointRadius:0}]},
    options:{ responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}} }
  });
}

/* ======================
   WEBSOCKET
====================== */
function startWS(){
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = ()=>setStatus(true);
  ws.onmessage = e=>{
    targetPrice = +JSON.parse(e.data).p;
    updateChartRealtime(targetPrice);
  };
  ws.onclose = ()=>setTimeout(startWS,3000);
  ws.onerror = ()=>setStatus(false);
}

/* ======================
   CHART UPDATE
====================== */
function updateChartRealtime(p){
  if(!chart) return;
  const idx = Math.floor((Date.now()-midnight())/60000);
  chartData[idx] = p;
  const color = p>=priceOpen?"#22c55e":"#ef4444";
  chart.data.datasets[0].borderColor=color;
  chart.data.datasets[0].backgroundColor=createGradient(chart.ctx,p);
  chart.data.datasets[0].data=chartData.map(v=>v??NaN);
  chart.update("none");
  priceLow=Math.min(priceLow,p);
  priceHigh=Math.max(priceHigh,p);
  updatePriceBar();
}

/* ======================
   PRICE BAR
====================== */
function updatePriceBar(){
  if(!dataReady||priceHigh===priceLow) return;
  const price = displayedPrice;
  let pct = price>=priceOpen ? 50 + ((price-priceOpen)/(priceHigh-priceOpen))*50 : 50 - ((priceOpen-price)/(priceOpen-priceLow))*50;
  pct=Math.max(0,Math.min(100,pct));
  $("priceLine").style.left = pct+"%";
  const barColor = price>=priceOpen ? "linear-gradient(to right,#22c55e,#10b981)" : "linear-gradient(to right,#ef4444,#f87171)";
  $("priceBar").style.background=barColor;
  if(price>=priceOpen){ $("priceBar").style.left="50%"; $("priceBar").style.width=(pct-50)+"%"; }
  else{ $("priceBar").style.left=pct+"%"; $("priceBar").style.width=(50-pct)+"%"; }
  $("priceMin").textContent=priceLow.toFixed(3);
  $("priceOpen").textContent=priceOpen.toFixed(3);
  $("priceMax").textContent=priceHigh.toFixed(3);
}

/* ======================
   ACCOUNT BOXES
====================== */
function updateBoxes(){
  colorNumber($("available"), availableInj, availableInj, 6);
  $("availableUsd").textContent=`≈ $${(availableInj*displayedPrice).toFixed(2)}`;
  colorNumber($("stake"), stakeInj, stakeInj, 4);
  $("stakeUsd").textContent=`≈ $${(stakeInj*displayedPrice).toFixed(2)}`;
  colorNumber($("rewards"), rewardsInj, rewardsInj, 7);
  $("rewardsUsd").textContent=`≈ $${(rewardsInj*displayedPrice).toFixed(2)}`;
  const rewardPct=Math.min(rewardsInj/0.05*100,100);
  $("rewardBar").style.width=rewardPct+"%";
  $("rewardBar").style.background="linear-gradient(to right,#0ea5e9,#3b82f6)";
  $("rewardPercent").textContent=rewardPct.toFixed(1)+"%";
  colorNumber($("apr"), apr, apr, 2);
}

/* ======================
   24H CHANGE
====================== */
async function fetch24hChange(){
  const data = await fetchJSON("https://api.binance.com/api/v3/ticker/24hr?symbol=INJUSDT");
  if(!data) return;
  price24hChange=parseFloat(data.priceChangePercent);
  $("pricePercent").textContent=(price24hChange>=0?"+":"")+price24hChange.toFixed(2)+"%";
  $("pricePercent").style.color=price24hChange>=0?"#22c55e":"#ef4444";
}

/* ======================
   ANIMATION LOOP
====================== */
function animate(){
  if(!dataReady){ requestAnimationFrame(animate); return; }
  const oldPrice = displayedPrice;
  displayedPrice = targetPrice;
  colorNumber($("price"), displayedPrice, oldPrice, 4);
  updatePriceBar();
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();
  updateBoxes();
  requestAnimationFrame(animate);
}

/* ======================
   RESET A MEZZANOTTE
====================== */
setInterval(()=>{ 
  const now=new Date();
  if(now.getHours()===0 && now.getMinutes()===0) fetchDayHistory();
},60000);

/* ======================
   REFRESH ACCOUNT
====================== */
setInterval(loadAccount, 2500);

/* ======================
   START
====================== */
fetchDayHistory().then(()=>{
  startWS();
  animate();
});
