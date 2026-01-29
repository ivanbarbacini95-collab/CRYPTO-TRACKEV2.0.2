/* =================== VARS =================== */
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], ws;

const $ = id=>document.getElementById(id);
const lerp=(a,b,f)=>a+(b-a)*f;

/* =================== HELPERS =================== */
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d), os = o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>{
    if(c!==os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    } else return `<span style="color:#f9fafb">${c}</span>`;
  }).join("");
}

async function fetchJSON(url){
  try{return await (await fetch(url)).json();}
  catch{return {};}
}

/* =================== ADDRESS =================== */
$("addressInput").value=address;
$("addressInput").onchange=e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* =================== ACCOUNT =================== */
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
loadAccount(); setInterval(loadAccount,60000);
setInterval(async ()=>{
  if(!address) return;
  const r=await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards=(r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards>rewardsInj) rewardsInj=newRewards;
},2000);

/* =================== PRICE =================== */
async function fetchHistory(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
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

/* =================== CONNECTION =================== */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
  if(online){ statusDot.style.background="#22c55e"; statusText.textContent="Online"; }
  else { statusDot.style.background="#ef4444"; statusText.textContent="Offline"; }
}
setConnectionStatus(false);

/* =================== WEBSOCKET =================== */
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

/* =================== PRICE BAR =================== */
function updatePriceBar(){
  const min=price24hLow, max=price24hHigh, open=price24hOpen, price=displayedPrice;
  let linePercent;
  if(price>=open) linePercent=50+((price-open)/(max-open))*50;
  else linePercent=50-((open-price)/(open-min))*50;
  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";
  $("priceBar").style.background=price>=open?"linear-gradient(to right, #22c55e, #10b981)":"linear-gradient(to right, #ef4444, #f87171)";
  let barWidth, barLeft;
  if(price>=open){ barLeft=50; barWidth=linePercent-50; } 
  else { barLeft=linePercent; barWidth=50-linePercent; }
  $("priceBar").style.left=barLeft+"%";
  $("priceBar").style.width=barWidth+"%";
}

/* =================== ANIMATE =================== */
function animate(){
  // PRICE
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

  // AVAILABLE
  const oldAvailable=displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,oldAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // STAKE
  const oldStake=displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,oldStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // REWARDS
  const oldRewards=displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,oldRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  $("rewardBar").style.width=Math.min(100,(displayedRewards/(stakeInj+0.01))*100+"%");
  $("rewardPercent").textContent=Math.min(100,(displayedRewards/(stakeInj+0.01))*100).toFixed(1)+"%";

  // APR
  $("apr").textContent=apr.toFixed(2)+"%";

  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();

/* =================== INDICES =================== */
const indices = [
  {symbol:"DJI", name:"Dow Jones", api:"^DJI", timezone:"America/New_York"},
  {symbol:"SPX", name:"S&P 500", api:"^GSPC", timezone:"America/New_York"},
  {symbol:"NAS", name:"NASDAQ", api:"^IXIC", timezone:"America/New_York"},
  {symbol:"FTSE", name:"FTSE 100", api:"^FTSE", timezone:"Europe/London"},
  {symbol:"DAX", name:"DAX", api:"^GDAXI", timezone:"Europe/Berlin"},
  {symbol:"N225", name:"Nikkei 225", api:"^N225", timezone:"Asia/Tokyo"},
  {symbol:"HSI", name:"Hang Seng", api:"^HSI", timezone:"Asia/Hong_Kong"}
];

let indexData = {};
const tickerEl = $("indicesTicker");

async function fetchIndices(){
  for(const idx of indices){
    try{
      const resp = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${idx.api}?interval=1d&range=7d`);
      const result = resp.chart?.result?.[0];
      if(result){
        const close = result.indicators?.quote?.[0]?.close?.at(-1) || 0;
        const prevClose = result.indicators?.quote?.[0]?.close?.at(-2) || close;
        const history = result.indicators?.quote?.[0]?.close || [];
        indexData[idx.symbol] = {current:close, prevClose, history, name:idx.name, timezone:idx.timezone};
      }
    }catch(e){ console.log("Error fetching", idx.symbol, e);}
  }
  renderIndices();
}
fetchIndices();
setInterval(fetchIndices,60000);

function renderIndices(){
  tickerEl.innerHTML="";
  const inner = document.createElement("div");
  inner.className="ticker-inner";

  for(const idx of indices){
    const data=indexData[idx.symbol];
    if(!data) continue;

    const item=document.createElement("div");
    item.className="index-item";

    const dot=document.createElement("span");
    dot.className="index-dot";

    const now = new Date().toLocaleString("en-US",{timeZone:data.timezone});
    const hour = new Date(now).getHours() + new Date(now).getMinutes()/60;

    let marketOpen=false, preMarket=false;
    if(hour>=9 && hour<16) marketOpen=true;
    else if(hour>=8.833 && hour<9) preMarket=true;

    if(marketOpen) dot.style.background="#22c55e";
    else if(preMarket) dot.style.background="#facc15";
    else dot.style.background="#ef4444";

    const sym=document.createElement("span");
    sym.className="index-symbol"; sym.textContent=idx.symbol;

    const price=document.createElement("span");
    price.className="index-price"; price.textContent=data.current.toFixed(2);

    item.append(dot,sym,price);
    item.onclick=()=>showIndexChart(idx.symbol);

    inner.appendChild(item);
  }
  tickerEl.appendChild(inner);

  animateTicker(inner);
}

function animateTicker(el){
  let left=0;
  const width=el.scrollWidth;
  function loop(){
    left-=0.5;
    if(left<-width) left=0;
    el.style.transform=`translateX(${left}px)`;
    requestAnimationFrame(loop);
  }
  loop();
}

/* MODAL */
const modal=$("indexModal");
const closeModal=$("closeModal");
const modalChartEl=$("modalChart");
const modalIndexName=$("modalIndexName");
let modalChart;

closeModal.onclick=()=>modal.style.display="none";

function showIndexChart(symbol){
  const data=indexData[symbol];
  if(!data) return;
  modal.style.display="flex";
  modalIndexName.textContent=data.name;

  const weeklyData = data.history.slice(-7);
  const color = weeklyData.at(-1)>=weeklyData.at(0)?"#22c55e":"#ef4444";

  if(modalChart) modalChart.destroy();

  modalChart=new Chart(modalChartEl.getContext("2d"),{
    type:"line",
    data:{labels:weeklyData.map((_,i)=>i+1), datasets:[{data:weeklyData,borderColor:color,backgroundColor:color==="#22c55e"?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)",fill:true,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:true}},y:{display:true}}
  });
}
