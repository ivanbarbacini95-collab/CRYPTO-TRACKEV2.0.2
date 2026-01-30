// ====================
// Helpers
// ====================
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

async function fetchJSON(url){
  try { return await (await fetch(url)).json(); }
  catch { return {}; }
}

// ====================
// Account & Rewards
// ====================
let address = localStorage.getItem("inj_address") || "";
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedAvailable=0, displayedStake=0, displayedRewards=0;

$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

// carica dati account
async function loadAccount(){
  if(!address) return;

  const [b,s,r,i] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj = (b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj = (s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards>rewardsInj) rewardsInj=newRewards;

  apr = Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount,60000); // refresh account ogni 60s

// aggiornamento rewards ogni 2s
setInterval(async()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards>rewardsInj) rewardsInj=newRewards;
},2000);

// ====================
// Price Bar & Color Number
// ====================
let targetPrice=0, displayedPrice=0;
let price24hOpen=0, price24hLow=Infinity, price24hHigh=-Infinity;

function colorNumber(el,n,o,d){
  const ns=n.toFixed(d), os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>c!==os[i]?`<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`:`<span style="color:#f9fafb">${c}</span>`).join("");
}

function updatePriceBar(){
  const min = price24hLow, max = price24hHigh, open = price24hOpen, price = displayedPrice;
  let linePercent = price>=open ? 50 + ((price-open)/(max-open))*50 : 50 - ((open-price)/(open-min))*50;
  linePercent = Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left = linePercent+"%";

  $("priceBar").style.background = price>=open
    ? "linear-gradient(to right, #22c55e, #10b981)"
    : "linear-gradient(to right, #ef4444, #f87171)";

  const barLeft = price>=open ? 50 : linePercent;
  const barWidth = price>=open ? linePercent-50 : 50-linePercent;
  $("priceBar").style.left = barLeft+"%";
  $("priceBar").style.width = barWidth+"%";
}

// ====================
// Chart Setup
// ====================
let chart, chartData=[], chartLabels=[];

// ottiene prezzo di apertura odierno (1D klines)
async function fetchDailyOpen(){
  const today = new Date();
  const utcDate = new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate(),0,0,0));
  const startTime = utcDate.getTime();
  const endTime = startTime+24*60*60*1000;
  const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=1`;
  const d = await fetchJSON(url);
  price24hOpen = d[0]?+d[0][1]:(chartData[0]||0);
}

// ottiene dati minuti odierni fino ad ora
async function fetchChartDataToday(){
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0,0,0,0);
  const startTime = startOfDay.getTime();

  const url = `https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&startTime=${startTime}&endTime=${now}&limit=1440`;
  const d = await fetchJSON(url);
  chartData = d.map(c=>+c[4]);
  chartLabels = Array(chartData.length).fill("");
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1)||0;

  if(!chart) initChart();
}

// ====================
// Chart Init
// ====================
function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=price24hOpen?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

function initChart(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: chartLabels,
      datasets:[{
        label:"Price",
        data: chartData,
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
      scales:{x:{ticks:{display:false}},y:{ticks:{color:"#9ca3af"}}}
    }
  });
}

function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.data.datasets[0].borderColor = p>=price24hOpen?"#22c55e":"#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx,p);
  chart.update("none");
}

// ====================
// WebSocket Price
// ====================
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
  statusDot.style.background = online?"#22c55e":"#ef4444";
  statusText.textContent = online?"Online":"Offline";
}

let ws;
function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = ()=>setConnectionStatus(true);
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    price24hHigh = Math.max(price24hHigh,p);
    price24hLow = Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose = ()=> { setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

// ====================
// Reset grafico a mezzanotte
// ====================
setInterval(async ()=>{
  const now = new Date();
  if(now.getHours()===0 && now.getMinutes()===0){
    await fetchDailyOpen();
    chartData=[]; chartLabels=[];
    price24hLow=Infinity; price24hHigh=-Infinity;
  }
},60000);

// ====================
// Animate Loop
// ====================
function animate(){
  // PRICE
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,oldPrice,4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);

  updatePriceBar();

  // AVAILABLE
  const oldAvailable = displayedAvailable;
  displayedAvailable = lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,oldAvailable,6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // STAKE
  const oldStake = displayedStake;
  displayedStake = lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,oldStake,4);
  $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // REWARDS
  const oldRewards = displayedRewards;
  displayedRewards = lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,oldRewards,7);
  $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  $("rewardBar").style.background="linear-gradient(to right, #0ea5e9,#3b82f6)";
  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent = (displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";

  // LAST UPDATE
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();

// ====================
// Init Today Chart
// ====================
(async()=>{
  await fetchDailyOpen();
  await fetchChartDataToday();
})();
