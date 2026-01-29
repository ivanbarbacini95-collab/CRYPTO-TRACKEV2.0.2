let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], ws, miniChart;

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

/* COLOR NUMBER */
function colorNumber(el,n,o,d){
  const ns=n.toFixed(d);
  const os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>{
    if(c!==os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    } else {
      return `<span style="color:#f9fafb">${c}</span>`;
    }
  }).join("");
}

/* FETCH JSON */
async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{return {};}
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* LOAD ACCOUNT */
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
  if(newRewards > rewardsInj) rewardsInj = newRewards;

  apr = Number(i.inflation||0)*100;
}

/* PERIODIC ACCOUNT UPDATE */
loadAccount();
setInterval(loadAccount,60000);
setInterval(async ()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards=(r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards>rewardsInj) rewardsInj=newRewards;
},2000);

/* HISTORY CHART */
async function fetchHistory(){
  const d=await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
  chartData=d.map(c=>+c[4]);
  price24hOpen=+d[0][1];
  price24hLow=Math.min(...chartData);
  price24hHigh=Math.max(...chartData);
  targetPrice=chartData.at(-1);
  if(!chart) initChart();
}
fetchHistory();

function initChart(){
  const ctx=$("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{labels:Array(chartData.length).fill(""), datasets:[{data:chartData,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,0.2)",fill:true,pointRadius:0,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}}
  });
}
function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

/* CONNECTION STATUS */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");
function setConnectionStatus(online){
  if(online){ statusDot.style.background="#22c55e"; statusText.textContent="Online"; }
  else { statusDot.style.background="#ef4444"; statusText.textContent="Offline"; }
}
setConnectionStatus(false);

/* WEBSOCKET */
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen=()=> setConnectionStatus(true);
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose=()=> { setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror=()=> setConnectionStatus(false);
}
startWS();

/* PRICE BAR */
function updatePriceBar(){
  const min=price24hLow, max=price24hHigh, open=price24hOpen, price=displayedPrice;
  let linePercent = price>=open ? 50 + ((price-open)/(max-open))*50 : 50 - ((open-price)/(open-min))*50;
  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";

  $("priceBar").style.background=price>=open ? "linear-gradient(to right, #22c55e, #10b981)" : "linear-gradient(to right, #ef4444, #f87171)";
  let barLeft=price>=open?50:linePercent, barWidth=price>=open?linePercent-50:50-linePercent;
  $("priceBar").style.left=barLeft+"%";
  $("priceBar").style.width=barWidth+"%";
}

/* ANIMATION LOOP */
function animate(){
  const oldPrice=displayedPrice;
  displayedPrice=lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,oldPrice,4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  updatePriceBar();

  const oldAvailable=displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,oldAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  const oldStake=displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,oldStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  const oldRewards=displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,oldRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  if(displayedRewards>oldRewards){ $("rewards").classList.add("up"); setTimeout(()=> $("rewards").classList.remove("up"),1000); }

  $("rewardBar").style.background="linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";

  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();

/* -------------------- TICKER INDICI -------------------- */
const indices=[
  {symbol:"S&P500",close:4000},
  {symbol:"DOWJ",close:33000},
  {symbol:"NASDAQ",close:13000},
  {symbol:"FTSE",close:7500},
  {symbol:"DAX",close:15000}
];

function isMarketOpen(symbol){
  const now=new Date();
  let openHour=14.5, closeHour=21; // default NYSE
  if(symbol==="FTSE"){openHour=8; closeHour=16.5;}
  if(symbol==="DAX"){openHour=7; closeHour=15.5;}
  const hoursUTC=now.getUTCHours()+now.getUTCMinutes()/60;
  return hoursUTC>=openHour && hoursUTC<=closeHour;
}

const tickerTrack=$("tickerTrack");
function renderTicker(){
  tickerTrack.innerHTML="";
  indices.forEach(i=>{
    const div=document.createElement("div");
    div.className="ticker-item";

    const color=isMarketOpen(i.symbol) ? "#22c55e" : "#ef4444";

    div.innerHTML=`<span>${i.symbol}</span> <span class="ticker-price" id="tickerPrice-${i.symbol}">${i.close.toFixed(2)}</span> <span class="status-dot" style="background:${color}"></span>`;

    div.onclick=()=>openMiniChart(i.symbol,i);

    tickerTrack.appendChild(div);
  });
}
renderTicker();

/* UPDATE TICKER PRICES */
setInterval(()=>{
  indices.forEach(i=>{
    const old=i.close;
    i.close*=(1+(Math.random()-0.5)/100);
    const el=$(`tickerPrice-${i.symbol}`);
    if(el) colorNumber(el,i.close,old,2);
  });
},2000);

/* -------------------- MINI CHART -------------------- */
const chartModal=$("chartModal");
const miniChartCtx=$("miniChart").getContext("2d");
function openMiniChart(title,data){
  $("miniChartTitle").textContent=title;
  const weeklyData=Array.from({length:7},()=>data.close*(1+(Math.random()-0.5)/50));
  if(miniChart) miniChart.destroy();
  miniChart=new Chart(miniChartCtx,{
    type:"line",
    data:{labels:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], datasets:[{data:weeklyData,borderColor:"#3b82f6",backgroundColor:"rgba(14,165,233,0.2)",fill:true,pointRadius:3,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:"#9ca3af"}},x:{ticks:{color:"#9ca3af"}}}}
  });
  chartModal.classList.remove("hidden");
}

$("closeModal").onclick=()=> chartModal.classList.add("hidden");
