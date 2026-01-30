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

/* FETCH JSON UTILITY */
async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

/* LOAD ACCOUNT DATA */
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

/* AUTO REFRESH ACCOUNT */
loadAccount();
setInterval(loadAccount, 60000); // completo ogni 60s

/* AGGIORNAMENTO SOLO REWARDS OGNI 2s */
setInterval(async ()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards > rewardsInj) rewardsInj = newRewards;
}, 2000);

/* FETCH 24h HISTORY */
async function fetchHistory24h(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
  chartData = d.map(c=>+c[4]);
  price24hOpen = +d[0][1];
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
        data: chartData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,0.2)",
        fill: true,
        pointRadius: 0,
        tension: 0.3
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

/* ANIMATION LOOP COMPLETO */
function animate(){
  // PRICE
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);
  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");
  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);
  updatePriceBar();

  // AVAILABLE
  const oldAvailable = displayedAvailable;
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  colorNumber($("available"), displayedAvailable, oldAvailable, 6);
  $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // STAKE
  const oldStake = displayedStake;
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  colorNumber($("stake"), displayedStake, oldStake, 4);
  $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // REWARDS
  const oldRewards = displayedRewards;
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.1);
  colorNumber($("rewards"), displayedRewards, oldRewards, 7);
  $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardBar").style.background = "linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardPercent").textContent = (displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";

  // LAST UPDATE
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
