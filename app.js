const $ = id => document.getElementById(id);

let ws, chart, chartData = [];
let apr = 0;

const market = { open:0, high:0, low:0, price:0, change:0 };
const ui = { price:0, available:0, stake:0, rewards:0 };
const target = { available:0, stake:0, rewards:0 };

function smooth(curr, next){ return curr + (next - curr) * 0.12; }

// ================= BINANCE =================
async function fetch24h(){
  const d = await fetch("https://api.binance.com/api/v3/ticker/24hr?symbol=INJUSDT").then(r=>r.json());
  market.open = +d.openPrice;
  market.high = +d.highPrice;
  market.low  = +d.lowPrice;
  market.price = +d.lastPrice;
  market.change = +d.priceChangePercent;
  if(!ui.price) ui.price = market.price;
}
fetch24h();
setInterval(fetch24h,30000);

function startWS(){
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = ()=>setStatus(true);
  ws.onclose = ()=>{ setStatus(false); setTimeout(startWS,2000); };
  ws.onmessage = e=>{
    market.price = +JSON.parse(e.data).p;
    updateChart(market.price);
  };
}
startWS();

function setStatus(ok){
  $(".status-dot").style.background = ok?"#22c55e":"#ef4444";
  $(".status-text").textContent = ok?"Online":"Offline";
}

// ================= CHART =================
async function initChart(){
  const d = await fetch("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=200").then(r=>r.json());
  chartData = d.map(c=>+c[4]);
  chart = new Chart($("priceChart"),{
    type:"line",
    data:{ labels:chartData.map(()=>""), datasets:[{
      data:chartData, borderColor:"#22c55e",
      fill:true, backgroundColor:"rgba(34,197,94,.2)",
      pointRadius:0, tension:.3
    }]},
    options:{ responsive:true, animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false}}}
  });
}
initChart();

function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ================= RENDER =================
function render(){
  ui.price = smooth(ui.price, market.price);
  $("price").textContent = ui.price.toFixed(4);

  $("price24h").textContent = `${market.change>0?"▲":"▼"} ${Math.abs(market.change).toFixed(2)}%`;
  $("price24h").className = "sub " + (market.change>0?"up":"down");

  renderBar();
  requestAnimationFrame(render);
}
render();

function renderBar(){
  const { open, high, low } = market;
  if(!high||!low) return;

  const center = 50;
  const bar = $("priceBar");
  const line = $("priceLine");

  const delta = (ui.price - open) / (high - low) * 50;

  if(ui.price >= open){
    bar.style.left = center+"%";
    bar.style.width = delta+"%";
    bar.style.background = "linear-gradient(to right,#22c55e,#16a34a)";
  } else {
    bar.style.left = center+delta+"%";
    bar.style.width = Math.abs(delta)+"%";
    bar.style.background = "linear-gradient(to left,#ef4444,#dc2626)";
  }

  line.style.left = ((ui.price-low)/(high-low))*100+"%";

  $("priceMin").textContent = low.toFixed(3);
  $("priceOpen").textContent = open.toFixed(3);
  $("priceMax").textContent = high.toFixed(3);
}
