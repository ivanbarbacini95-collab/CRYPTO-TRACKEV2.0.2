let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], ws;

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

/* Funzione per colorare solo le cifre cambiate */
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);

  el.innerHTML = [...ns].map((c,i) => {
    if(c !== os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    } else {
      return `<span style="color:#f9fafb">${c}</span>`;
    }
  }).join("");
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* FETCH ACCOUNT DATA */
async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

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
  if(newRewards > rewardsInj) rewardsInJ = newRewards;

  apr = Number(i.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount, 60000);

/* FETCH CHART HISTORY */
async function fetchHistory24h(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData = d.map(c=>+c[4]);
  price24hOpen = chartData[0];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);
  initChart();
}
fetchHistory24h();

/* INIT CHART */
function initChart(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type: "line",
    data: {
      labels: Array(chartData.length).fill(""),
      datasets: [{
        label: "Price",
        data: chartData,
        borderColor: "#22c55e",
        backgroundColor: ctx.createLinearGradient(0,0,0,300),
        fill: true,
        pointRadius: 0,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } }
      }
    }
  });
}

function updateChart(p){
  chartData.push(p);
  chartData.shift();
  chart.data.datasets[0].data = chartData;
  chart.update("none");
}

/* CONNECTION STATUS */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
  if(online){
    statusDot.style.background = "#22c55e";
    statusText.textContent = "Online";
  } else {
    statusDot.style.background = "#ef4444";
    statusText.textContent = "Offline";
  }
}
setConnectionStatus(false);

/* WEBSOCKET */
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => setConnectionStatus(true);
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    price24hHigh = Math.max(...chartData, p);
    price24hLow = Math.min(...chartData, p);
    updateChart(p);
  };
  ws.onclose = ()=> {
    setConnectionStatus(false);
    setTimeout(startWS,3000);
  };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

/* PRICE BAR */
function updatePriceBar() {
  const min = price24hLow, max = price24hHigh, open = price24hOpen, price = displayedPrice;
  let linePercent = price >= open ? 50 + ((price - open)/(max - open))*50 : 50 - ((open - price)/(open - min))*50;
  linePercent = Math.max(0, Math.min(100, linePercent));
  $("priceLine").style.left = linePercent + "%";

  let barLeft = price >= open ? 50 : linePercent;
  let barWidth = price >= open ? linePercent - 50 : 50 - linePercent;
  $("priceBar").style.left = barLeft + "%";
  $("priceBar").style.width = barWidth + "%";
  $("priceBar").style.background = price >= open ? "linear-gradient(to right, #22c55e, #10b981)" : "linear-gradient(to right, #ef4444, #f87171)";
}

/* ANIMATION LOOP */
function animate(){
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, displayedPrice, 4);
  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");
  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);
  updatePriceBar();

  requestAnimationFrame(animate);
}
animate();
