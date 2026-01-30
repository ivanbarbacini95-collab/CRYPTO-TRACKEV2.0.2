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

let prevAvailable = 0;
let prevStake = 0;
let prevRewards = 0;

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

function colorNumber(el,n,o,d){
  if(!el) return;
  const ns=n.toFixed(d), os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>{
    if(c!==os[i]) return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    return `<span>${c}</span>`;
  }).join("");
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
  const g=ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  g.addColorStop(0,price>=priceOpen?"rgba(34,197,94,.25)":"rgba(239,68,68,.25)");
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

function updateChartRealtime(p){
  if(!chart) return;
  const idx=Math.floor((Date.now()-midnight())/60000);
  chartData[idx]=p;
  chart.data.datasets[0].data=chartData.map(v=>v??NaN);
  chart.data.datasets[0].backgroundColor=createGradient(chart.ctx,p);
  chart.update("none");

  priceLow=Math.min(priceLow,p);
  priceHigh=Math.max(priceHigh,p);
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
   PRICE BAR
====================== */
function updatePriceBar(){
  if(!dataReady || priceHigh===priceLow) return;

  const p=displayedPrice;
  let pct=p>=priceOpen
    ?50+((p-priceOpen)/(priceHigh-priceOpen))*50
    :50-((priceOpen-p)/(priceOpen-priceLow))*50;

  pct=Math.max(0,Math.min(100,pct));
  $("priceLine").style.left=pct+"%";

  if(p>=priceOpen){
    $("priceBar").style.left="50%";
    $("priceBar").style.width=(pct-50)+"%";
  }else{
    $("priceBar").style.left=pct+"%";
    $("priceBar").style.width=(50-pct)+"%";
  }
}

/* ======================
   ANIMATION LOOP
====================== */
function animate(){
  if(!dataReady) return requestAnimationFrame(animate);

  const old=displayedPrice;
  displayedPrice=lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,old,4);

  updatePriceBar();

  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,prevAvailable,6);
  prevAvailable=displayedAvailable;

  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,prevStake,4);
  prevStake=displayedStake;

  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,prevRewards,7);
  prevRewards=displayedRewards;

  requestAnimationFrame(animate);
}

/* ======================
   START
====================== */
fetchDayHistory().then(()=>{
  startWS();
  animate();
});
