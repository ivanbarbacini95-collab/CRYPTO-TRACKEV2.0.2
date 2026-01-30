// --------- VARIABILI ---------
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = Infinity, price24hHigh = -Infinity;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], chartLabels = [], ws;

// --------- FUNZIONI UTILI ---------
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=price24hOpen?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

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

async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

// --------- INPUT INDIRIZZO ---------
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

// --------- ACCOUNT ---------
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
loadAccount();
setInterval(loadAccount, 60000);

setInterval(async ()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards > rewardsInj) rewardsInj = newRewards;
}, 2000);

// --------- GRAFICO ---------
function initChart(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: Array(1440).fill(""),
      datasets:[{
        data: Array(1440).fill(0),
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx, 1),
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
      scales:{x:{display:false}, y:{ticks:{color:"#9ca3af"}}}
    }
  });
}

function prefillChart(initialPrice){
  chartData = Array(1440).fill(initialPrice);
  chartLabels = Array(1440).fill("");
  price24hOpen = initialPrice;
  price24hLow = initialPrice;
  price24hHigh = initialPrice;

  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, initialPrice);
  chart.update();
}

function updateChart(price){
  chartData.push(price);
  chartData.shift();

  // aggiorna min/max real time
  price24hHigh = Math.max(...chartData);
  price24hLow = Math.min(...chartData);

  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].borderColor = price>=price24hOpen?"#22c55e":"#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);
  chart.update("none");
}

// reset grafico a mezzanotte
function scheduleMidnightReset(){
  const now = new Date();
  const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1).getTime() - now.getTime();
  setTimeout(()=>{
    prefillChart(targetPrice);
    scheduleMidnightReset();
  }, msToMidnight);
}

// --------- WEBSOCKET ---------
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

function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = ()=>setConnectionStatus(true);
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    updateChart(p);
  };
  ws.onclose = ()=> {
    setConnectionStatus(false);
    setTimeout(startWS,3000);
  };
  ws.onerror = ()=>setConnectionStatus(false);
}

// --------- PRICE BAR ---------
function updatePriceBar(){
  const min = price24hLow;
  const max = price24hHigh;
  const open = price24hOpen;
  const price = displayedPrice;

  let linePercent;
  if(price >= open){
    linePercent = 50 + ((price - open)/(max - open))*50;
  } else {
    linePercent = 50 - ((open - price)/(open - min))*50;
  }
  linePercent = Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left = linePercent + "%";

  $("priceBar").style.background = price>=open
    ? "linear-gradient(to right, #22c55e, #10b981)"
    : "linear-gradient(to right, #ef4444, #f87171)";

  let barWidth, barLeft;
  if(price >= open){
    barLeft = 50; barWidth = linePercent - 50;
  } else {
    barLeft = linePercent; barWidth = 50 - linePercent;
  }
  $("priceBar").style.left = barLeft + "%";
  $("priceBar").style.width = barWidth + "%";
}

// --------- LOOP ANIMAZIONE ---------
function animate(){
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  updatePriceBar();

  const oldAvailable = displayedAvailable;
  displayedAvailable = lerp(displayedAvailable, availableInj, 0.1);
  colorNumber($("available"), displayedAvailable, oldAvailable, 6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  const oldStake = displayedStake;
  displayedStake = lerp(displayedStake, stakeInj, 0.1);
  colorNumber($("stake"), displayedStake, oldStake, 4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  const oldRewards = displayedRewards;
  displayedRewards = lerp(displayedRewards, rewardsInj, 0.1);
  colorNumber($("rewards"), displayedRewards, oldRewards, 7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  $("rewardBar").style.background = "linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent = (displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent = apr.toFixed(2)+"%";

  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

// --------- INIZIALIZZAZIONE ---------
initChart();
prefillChart(1); // inizializza grafico neutro
startWS();
scheduleMidnightReset();
animate();
