// ====== HELPERS ======
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

function colorNumber(el,n,o,d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i)=>{
    if(c!==os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    }else{
      return `<span style="color:#f9fafb">${c}</span>`;
    }
  }).join("");
}

async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

function nowInTZ(offsetHours){
  const d = new Date();
  return new Date(d.getTime() + offsetHours*3600*1000);
}

// ====== ACCOUNT ======
let address = localStorage.getItem("inj_address") || "";
let targetPrice = 0, displayedPrice=0;
let price24hOpen=0, price24hLow=0, price24hHigh=0;
let availableInj=0, stakeInj=0, rewardsInj=0;
let displayedAvailable=0, displayedStake=0, displayedRewards=0;
let apr=0;

$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

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
setInterval(loadAccount,60000);

// ====== PRICE ======
let chart, chartData=[];
async function fetchHistory(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
  chartData=d.map(c=>+c[4]);
  price24hOpen = +d[0][1];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);
  if(!chart) initChart();
}
fetchHistory();

function initChart(){
  const ctx = $("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{labels:Array(chartData.length).fill(""),
      datasets:[{data:chartData,borderColor:"#22c55e",
        backgroundColor:"rgba(34,197,94,0.2)",
        fill:true,pointRadius:0,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,
      animation:false,plugins:{legend:{display:false}},
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}}
  });
}

function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ====== CONNECTION ======
const connectionStatus=$("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
  statusDot.style.background = online?"#22c55e":"#ef4444";
  statusText.textContent = online?"Online":"Offline";
}
setConnectionStatus(false);

let ws;
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen=()=>setConnectionStatus(true);
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose=()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror=()=>setConnectionStatus(false);
}
startWS();

// ====== PRICE BAR ======
function updatePriceBar(){
  const min=price24hLow, max=price24hHigh, open=price24hOpen, price=displayedPrice;
  let linePercent = price>=open?50 + ((price-open)/(max-open))*50 : 50 - ((open-price)/(open-min))*50;
  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";
  $("priceBar").style.background = price>=open?"linear-gradient(to right,#22c55e,#10b981)":"linear-gradient(to right,#ef4444,#f87171)";
  let barWidth, barLeft;
  if(price>=open){ barLeft=50; barWidth=linePercent-50; }
  else{ barLeft=linePercent; barWidth=50-linePercent; }
  $("priceBar").style.left=barLeft+"%";
  $("priceBar").style.width=barWidth+"%";
}

// ====== ANIMATION LOOP ======
function animate(){
  const d = ((displayedPrice-price24hOpen)/price24hOpen)*100;
  const marketOpen = true; // placeholder, ticker gestirà stato mercati globali

  // PRICE
  if(marketOpen){
    const oldPrice=displayedPrice;
    displayedPrice=lerp(displayedPrice,targetPrice,0.1);
    colorNumber($("price"),displayedPrice,oldPrice,4);
  }

  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");
  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);
  updatePriceBar();

  // AVAILABLE
  const oldAvailable = displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"), displayedAvailable, oldAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // STAKE
  const oldStake = displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"), displayedStake, oldStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // REWARDS
  const oldRewards = displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"), displayedRewards, oldRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  if(displayedRewards>oldRewards){ $("rewards").classList.add("up"); setTimeout(()=>$("rewards").classList.remove("up"),1000); }

  $("rewardBar").style.background="linear-gradient(to right,#0ea5e9,#3b82f6)";
  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();

// ====== GLOBAL INDICES TICKER ======
const indices = [
  {symbol:"^GSPC", name:"S&P500", tz:-5},
  {symbol:"^DJI", name:"Dow Jones", tz:-5},
  {symbol:"^IXIC", name:"Nasdaq", tz:-5},
  {symbol:"^FTSE", name:"FTSE100", tz:0},
  {symbol:"^GDAXI", name:"DAX", tz:1},
  {symbol:"^N225", name:"Nikkei225", tz:9},
  {symbol:"^HSI", name:"Hang Seng", tz:8}
];

const tickerInner = $("tickerInner");

// Crea elementi ticker
indices.forEach(idx=>{
  const item = document.createElement("div");
  item.className="ticker-item";
  item.dataset.symbol = idx.symbol;
  const dot = document.createElement("div");
  dot.className="ticker-dot";
  item.appendChild(dot);
  const text = document.createElement("span");
  text.textContent = `${idx.symbol} 0.00`;
  item.appendChild(text);
  tickerInner.appendChild(item);

  // Click mostra mini chart
  item.onclick = ()=>showIndexChart(idx.symbol, idx.name);
});

// Aggiorna ticker con dati reali
async function updateIndicesTicker(){
  for(let i=0;i<indices.length;i++){
    const idx=indices[i];
    const item = tickerInner.children[i];
    const text = item.querySelector("span");
    const dot = item.querySelector(".ticker-dot");

    // Stati mercati (chiuso 0, premarket 1, aperto 2)
    const d = nowInTZ(idx.tz);
    const h=d.getHours(), m=d.getMinutes();
    let state=0;
    if(h>=9 && h<16) state=2;           // mercato aperto
    else if(h===8 && m>=50) state=1;     // premarket 10min
    else state=0;                        // chiuso

    // Pallino
    dot.style.background = state===0?"#ef4444":state===1?"#facc15":"#22c55e";

    // Fetch prezzo solo aperto o pre-market
    if(state>0){
      const url=`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${idx.symbol}`;
      const data = await fetchJSON(url);
      const price = data.quoteResponse?.result?.[0]?.regularMarketPrice || 0;
      const open = data.quoteResponse?.result?.[0]?.regularMarketOpen || price;
      const dText = ((price-open)/open*100).toFixed(2);
      text.innerHTML=`${idx.symbol} <span style="color:${price>=open?'#22c55e':'#ef4444'}">${price.toFixed(2)}</span>`;
    }
  }
}
updateIndicesTicker();
setInterval(updateIndicesTicker,60000);

// ====== MINI CHART ======
let indexChartModal = $("indexChartModal");
let indexChartCanvas = $("indexChartCanvas");
let indexChartTitle = $("indexChartTitle");
let indexChartObj=null;

async function showIndexChart(symbol,name){
  indexChartTitle.textContent=name;
  indexChartModal.style.display="block";

  // Fetch dati settimanali
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=7d&interval=1d`;
  const data = await fetchJSON(url);
  const timestamps = data.chart.result[0].timestamp.map(t=>new Date(t*1000).toLocaleDateString());
  const prices = data.chart.result[0].indicators.quote[0].close;

  if(indexChartObj){
    indexChartObj.data.labels=timestamps;
    indexChartObj.data.datasets[0].data=prices;
    indexChartObj.update();
  } else {
    indexChartObj = new Chart(indexChartCanvas.getContext("2d"),{
      type:"line",
      data:{labels:timestamps,datasets:[{data:prices,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,0.2)",fill:true,pointRadius:0,tension:0.3}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:"#9ca3af"}},x:{ticks:{color:"#9ca3af"}}}}
    });
  }
}

// Chiudi modal
indexChartModal.querySelector(".close").onclick=()=>{indexChartModal.style.display="none";};
window.onclick=e=>{if(e.target===indexChartModal) indexChartModal.style.display="none";};
