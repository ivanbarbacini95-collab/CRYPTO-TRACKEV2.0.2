let address = localStorage.getItem("inj_address") || "";
let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], ws;

// INDICI
const indices = [
  {symbol:"^GSPC", name:"S&P500", tz:"America/New_York", api:"https://api.example.com/sp500"},
  {symbol:"^DJI", name:"Dow Jones", tz:"America/New_York", api:"https://api.example.com/dji"},
  {symbol:"^IXIC", name:"NASDAQ", tz:"America/New_York", api:"https://api.example.com/nasdaq"},
  {symbol:"^N225", name:"Nikkei 225", tz:"Asia/Tokyo", api:"https://api.example.com/nikkei"},
  {symbol:"000001.SS", name:"SSE Composite", tz:"Asia/Shanghai", api:"https://api.example.com/sse"}
];

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i)=>{
    if(c!==os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    } else return `<span style="color:#f9fafb">${c}</span>`;
  }).join("");
}

async function fetchJSON(url){
  try{return await (await fetch(url)).json();}
  catch{return {};}
}

// INPUT ADDRESS
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

// ACCOUNT
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
  apr=Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount,60000);

// PRICE HISTORY
async function fetchHistory(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
  chartData = d.map(c=>+c[4]);
  price24hOpen = +d[0][1];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);
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

// CONNECTION STATUS
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");
function setConnectionStatus(online){
  statusDot.style.background=online?"#22c55e":"#ef4444";
  statusText.textContent=online?"Online":"Offline";
}
setConnectionStatus(false);

// WEBSOCKET
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = ()=> setConnectionStatus(true);
  ws.onmessage = e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose = ()=>{setConnectionStatus(false); setTimeout(startWS,3000);}
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

// PRICE BAR
function updatePriceBar(){
  const min=price24hLow, max=price24hHigh, open=price24hOpen, price=displayedPrice;
  let linePercent = price>=open?50+((price-open)/(max-open))*50:50-((open-price)/(open-min))*50;
  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";
  $("priceBar").style.background=price>=open?"linear-gradient(to right, #22c55e, #10b981)":"linear-gradient(to right, #ef4444, #f87171)";
  let barLeft=price>=open?50:linePercent, barWidth=price>=open?linePercent-50:50-linePercent;
  $("priceBar").style.left=barLeft+"%"; $("priceBar").style.width=barWidth+"%";
}

// ANIMATION LOOP
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
  colorNumber($("rewards"),displayedRewards,oldRewards,6);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  $("apr").textContent=apr.toFixed(2)+"%";

  requestAnimationFrame(animate);
}
animate();

// TICKER
const tickerInner=$("tickerInner");
function buildTicker(){
  tickerInner.innerHTML="";
  indices.forEach(idx=>{
    const item=document.createElement("div");
    item.className="ticker-item";
    item.dataset.symbol=idx.symbol;
    const dot=document.createElement("span"); dot.className="ticker-dot"; dot.style.background="#ef4444";
    const name=document.createElement("span"); name.textContent=idx.symbol;
    const price=document.createElement("span"); price.textContent="0.00"; price.className="ticker-price";
    item.append(dot,name,price);
    item.onclick=()=> showIndexChart(idx);
    tickerInner.appendChild(item);
  });
}
buildTicker();

async function updateTicker(){
  for(const idx of indices){
    const res = await fetchJSON(idx.api);
    const item = tickerInner.querySelector(`[data-symbol="${idx.symbol}"]`);
    if(!item) continue;
    const dot = item.querySelector(".ticker-dot");
    const priceEl = item.querySelector(".ticker-price");
    const now = new Date();
    const hour = now.toLocaleString("en-US",{timeZone:idx.tz,hour:"2-digit", hour12:false});
    const openHour = 9, closeHour = 16; // esempio NYSE
    let statusColor="#ef4444";
    if(hour>=openHour && hour<closeHour) statusColor="#22c55e";
    else if(hour>=openHour-0.16 && hour<openHour) statusColor="#facc15"; // 10min prima pre-market
    dot.style.background=statusColor;
    if(priceEl) priceEl.textContent=res.price?.toFixed(2)||"0.00";
  }
}
updateTicker();
setInterval(updateTicker,30000);

// MINI CHART MODAL
const modal=$("indexChartModal");
const modalClose=modal.querySelector(".close");
modalClose.onclick=()=>modal.style.display="none";
function showIndexChart(idx){
  modal.style.display="flex";
  $("indexChartTitle").textContent=idx.name;
  const ctx=$("indexChartCanvas").getContext("2d");
  fetchJSON(idx.api+"&interval=1w&limit=52").then(data=>{
    const prices=data.map(c=>+c.close);
    new Chart(ctx,{
      type:"line",
      data:{labels:Array(prices.length).fill(""), datasets:[{data:prices,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,0.2)",fill:true,pointRadius:0,tension:0.3}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}}
    });
  });
}
