const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

let address = localStorage.getItem("inj_address") || "";
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value;
  localStorage.setItem("inj_address", address);
  loadAccount();
};

/* ================= INJECTIVE ================= */
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedPrice=0, targetPrice=0;
let price24hOpen=0, price24hLow=0, price24hHigh=0;

async function fetchJSON(url){
  try { return await (await fetch(url)).json(); }
  catch { return {}; }
}

async function loadAccount(){
  if(!address) return;
  const b = await fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`);
  availableInj = (b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
}
loadAccount();

/* ================= PRICE WS ================= */
let ws;
function startWS(){
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    if(!price24hOpen) price24hOpen = p;
    price24hLow = price24hLow ? Math.min(price24hLow,p) : p;
    price24hHigh = Math.max(price24hHigh,p);
  };
}
startWS();

/* ================= TICKER ================= */
const indices = [
  {symbol:"^GSPC", label:"S&P 500"},
  {symbol:"^DJI", label:"DOW"},
  {symbol:"^IXIC", label:"NASDAQ"},
  {symbol:"^FTSE", label:"FTSE"},
  {symbol:"^GDAXI", label:"DAX"},
  {symbol:"^N225", label:"NIKKEI"}
];

let enabled = JSON.parse(localStorage.getItem("enabled_indices")) || indices.map(i=>i.symbol);

async function updateTicker(){
  const d = await fetchJSON(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${enabled.join(",")}`
  );
  const track = $("tickerTrack");
  track.innerHTML = "";
  d.quoteResponse?.result.forEach(i=>{
    const up = i.regularMarketPrice >= i.regularMarketOpen;
    track.innerHTML += `
      <div class="ticker-item" onclick="openMiniChart('${i.symbol}','${i.shortName}')">
        <span>${i.symbol.replace("^","")}</span>
        <span>${i.regularMarketPrice.toFixed(2)}</span>
        <span class="ticker-dot" style="background:${up?"#22c55e":"#ef4444"}"></span>
      </div>`;
  });
  track.innerHTML += track.innerHTML;
}
updateTicker();
setInterval(updateTicker,30000);

/* ================= MINI CHART ================= */
let miniChart;
async function openMiniChart(symbol,name){
  $("chartModal").classList.remove("hidden");
  $("modalTitle").textContent = name;

  const d = await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=15m`
  );
  const prices = d.chart.result[0].indicators.quote[0].close;

  if(miniChart) miniChart.destroy();
  miniChart = new Chart($("miniChart"),{
    type:"line",
    data:{labels:prices.map(()=>""),datasets:[{data:prices,borderColor:"#3b82f6",pointRadius:0}]},
    options:{plugins:{legend:{display:false}},scales:{x:{display:false}}}
  });
}
$("closeModal").onclick=()=> $("chartModal").classList.add("hidden");

/* ================= CONFIG ================= */
$("configBtn").onclick=()=> $("configPanel").classList.toggle("hidden");

const cfg = $("indicesConfig");
indices.forEach(i=>{
  cfg.innerHTML += `
    <label>
      <input type="checkbox" ${enabled.includes(i.symbol)?"checked":""}
        onchange="toggleIndex('${i.symbol}',this.checked)">
      ${i.label}
    </label>`;
});

function toggleIndex(sym,on){
  enabled = on ? [...enabled,sym] : enabled.filter(s=>s!==sym);
  localStorage.setItem("enabled_indices",JSON.stringify(enabled));
  updateTicker();
}

/* ================= LOOP ================= */
function animate(){
  displayedPrice = lerp(displayedPrice,targetPrice,.1);
  $("price").textContent = displayedPrice.toFixed(4);
  requestAnimationFrame(animate);
}
animate();
