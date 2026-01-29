const $ = id => document.getElementById(id);

/* ================== INDICES ================== */
const indices = [
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "^DJI", label: "DOW" },
  { symbol: "^IXIC", label: "NASDAQ" },
  { symbol: "^FTSE", label: "FTSE 100" },
  { symbol: "^GDAXI", label: "DAX" },
  { symbol: "^N225", label: "NIKKEI" }
];

let enabledIndices =
  JSON.parse(localStorage.getItem("enabled_indices")) ||
  indices.map(i=>i.symbol);

/* ================== FETCH ================== */
async function fetchJSON(url){
  try { return await (await fetch(url)).json(); }
  catch { return {}; }
}

/* ================== SESSION ================== */
function marketSession(symbol){
  const h = new Date().getUTCHours();
  if(["^GSPC","^DJI","^IXIC"].includes(symbol))
    return h>=14 && h<=21 ? ["US","#22c55e"] : ["US CLOSED","#64748b"];
  if(["^FTSE","^GDAXI"].includes(symbol))
    return h>=7 && h<=16 ? ["EU","#22c55e"] : ["EU CLOSED","#64748b"];
  if(symbol==="^N225")
    return h>=0 && h<=6 ? ["ASIA","#22c55e"] : ["ASIA CLOSED","#64748b"];
  return ["CLOSED","#64748b"];
}

/* ================== TICKER ================== */
async function updateTicker(){
  const syms = enabledIndices.join(",");
  const d = await fetchJSON(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${syms}`
  );
  const track = $("tickerTrack");
  track.innerHTML = "";

  d.quoteResponse?.result.forEach(i=>{
    const up = i.regularMarketPrice >= i.regularMarketOpen;
    track.innerHTML += `
      <div class="ticker-item" onclick="openMiniChart('${i.symbol}','${i.shortName}')">
        <span class="ticker-symbol">${i.symbol.replace("^","")}</span>
        <span class="ticker-price">${i.regularMarketPrice.toFixed(2)}</span>
        <span class="ticker-dot" style="background:${up?"#22c55e":"#ef4444"}"></span>
      </div>`;
  });

  track.innerHTML += track.innerHTML;
}

updateTicker();
setInterval(updateTicker, 30000);

/* ================== MINI CHART ================== */
let miniChart;

async function openMiniChart(symbol,name){
  $("chartModal").classList.remove("hidden");
  $("modalTitle").textContent = name;

  const [label,color] = marketSession(symbol);
  const badge = $("sessionBadge");
  badge.textContent = label;
  badge.style.background = color;

  const d = await fetchJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=15m`
  );
  const prices = d.chart.result[0].indicators.quote[0].close;

  if(miniChart) miniChart.destroy();
  miniChart = new Chart($("miniChart"),{
    type:"line",
    data:{labels:prices.map(()=>""),datasets:[{
      data:prices,
      borderColor:"#3b82f6",
      pointRadius:0,
      tension:.3
    }]},
    options:{plugins:{legend:{display:false}},scales:{x:{display:false}}}
  });
}

$("closeModal").onclick=()=> $("chartModal").classList.add("hidden");

/* ================== CONFIG UI ================== */
$("configBtn").onclick=()=>{
  $("configPanel").classList.toggle("hidden");
};

const cfg = $("indicesConfig");
indices.forEach(i=>{
  const checked = enabledIndices.includes(i.symbol);
  cfg.innerHTML += `
    <label>
      <input type="checkbox" ${checked?"checked":""}
        onchange="toggleIndex('${i.symbol}',this.checked)">
      ${i.label}
    </label>`;
});

function toggleIndex(sym,on){
  enabledIndices = on
    ? [...enabledIndices,sym]
    : enabledIndices.filter(s=>s!==sym);
  localStorage.setItem("enabled_indices",JSON.stringify(enabledIndices));
  updateTicker();
}
