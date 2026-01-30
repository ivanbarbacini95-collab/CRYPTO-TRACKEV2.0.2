/* =======================
   STATE
======================= */
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

/* =======================
   HELPERS
======================= */
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

function colorNumber(el,n,o,d){
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

/* =======================
   ADDRESS INPUT
======================= */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* =======================
   ACCOUNT DATA
======================= */
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

  const newRewards=(r.rewards||[]).reduce(
    (a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0
  )/1e18;
  if(newRewards>rewardsInj) rewardsInj=newRewards;

  apr=Number(i.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,60000);

/* =======================
   CONNECTION STATUS
======================= */
const statusDot=$("connectionStatus").querySelector(".status-dot");
const statusText=$("connectionStatus").querySelector(".status-text");

function setStatus(on){
  statusDot.style.background=on?"#22c55e":"#ef4444";
  statusText.textContent=on?"Online":"Offline";
}
setStatus(false);

/* =======================
   GRAFICO – STORICO GIORNO
======================= */
function todayMidnight(){
  const d=new Date();
  d.setHours(0,0,0,0);
  return d.getTime();
}

async function fetchDayHistory(){
  const start=todayMidnight();
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
    if(idx>=0 && idx<chartData.length){
      chartData[idx]=+c[4];
    }
  });

  targetPrice=d.at(-1)[4];
  displayedPrice=targetPrice;

  initChart();
}

/* =======================
   CHART INIT
======================= */
function createGradient(ctx,price){
  const g=ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  g.addColorStop(0,price>=priceOpen?"rgba(34,197,94,.2)":"rgba(239,68,68,.2)");
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
        tension:0
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{display:false},
        y:{ticks:{color:"#9ca3af"}}
      }
    }
  });
}

/* =======================
   REALTIME UPDATE
======================= */
function updateChartRealtime(p){
  const idx=Math.floor((Date.now()-todayMidnight())/60000);
  if(idx>=chartData.length){
    chartData.push(p);
    chartLabels.push("");
  }else{
    chartData[idx]=p;
  }

  chart.data.datasets[0].data=chartData.map(v=>v??NaN);
  chart.data.datasets[0].backgroundColor=createGradient(chart.ctx,p);
  chart.update("none");

  priceLow=Math.min(priceLow,p);
  priceHigh=Math.max(priceHigh,p);
}

/* =======================
   WEBSOCKET
======================= */
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen=()=>setStatus(true);
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    updateChartRealtime(p);
  };
  ws.onclose=()=>{
    setStatus(false);
    setTimeout(startWS,3000);
  };
  ws.onerror=()=>setStatus(false);
}

/* =======================
   PRICE BAR
======================= */
function updatePriceBar(){
  const min=priceLow,max=priceHigh,open=priceOpen,price=displayedPrice;
  let pct;

  if(price>=open){
    pct=50+((price-open)/(max-open))*50;
  }else{
    pct=50-((open-price)/(open-min))*50;
  }

  pct=Math.max(0,Math.min(100,pct));
  $("priceLine").style.left=pct+"%";

  $("priceBar").style.left=price>=open?"50%":pct+"%";
  $("priceBar").style.width=Math.abs(pct-50)+"%";
  $("priceBar").style.background=
    price>=open
      ?"linear-gradient(to right,#22c55e,#10b981)"
      :"linear-gradient(to right,#ef4444,#f87171)";
}

/* =======================
   ANIMATION LOOP
======================= */
function animate(){
  const old=displayedPrice;
  displayedPrice=lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,old,4);

  const d=((displayedPrice-priceOpen)/priceOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=priceLow.toFixed(3);
  $("priceOpen").textContent=priceOpen.toFixed(3);
  $("priceMax").textContent=priceHigh.toFixed(3);

  updatePriceBar();

  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,displayedAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,displayedStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,displayedRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  $("rewardBar").style.background="linear-gradient(to right,#0ea5e9,#3b82f6)";
  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

/* =======================
   RESET A MEZZANOTTE
======================= */
setInterval(()=>{
  const now=new Date();
  if(now.getHours()===0 && now.getMinutes()===0){
    fetchDayHistory();
  }
},60000);

/* =======================
   START
======================= */
fetchDayHistory().then(startWS);
animate();
