// ------------------------
// VARIABILI GLOBALI
// ------------------------
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], ws;

let ath = 0, atl = Infinity;

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

// ------------------------
// COLOR NUMBER
// ------------------------
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i)=>{
    if(c!==os[i]){
      return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
    } else {
      return `<span style="color:#f9fafb">${c}</span>`;
    }
  }).join("");
}

// ------------------------
// FETCH JSON UTILE
// ------------------------
async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

// ------------------------
// INPUT ADDRESS
// ------------------------
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

// ------------------------
// LOAD ACCOUNT
// ------------------------
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
  if(newRewards > rewardsInj){
    rewardsInj = newRewards;
  }

  apr = Number(i.inflation||0)*100;
}

// ------------------------
// AGGIORNAMENTI
// ------------------------
loadAccount();
setInterval(loadAccount, 60000); // completo ogni 60s
setInterval(async ()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards > rewardsInj) rewardsInj = newRewards;
}, 2000);

// ------------------------
// CHART 24h
// ------------------------
async function fetchHistory24h(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData = d.map(c=>+c[4]);
  price24hOpen = chartData[0];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  ath = Math.max(...chartData);
  atl = Math.min(...chartData);
  targetPrice = chartData.at(-1);

  initChart24h();
}
fetchHistory24h();

function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=price24hOpen?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

function initChart24h(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: Array(chartData.length).fill(""),
      datasets:[
        {
          label:"Price",
          data: chartData,
          borderColor:"#22c55e",
          backgroundColor:createGradient(ctx, chartData.at(-1)),
          fill:true,
          pointRadius:0,
          tension:0.2
        },
        {
          label:"ATH",
          data: Array(chartData.length).fill(ath),
          borderColor:"#9ca3af",
          borderDash:[4,4],
          pointRadius:0,
          fill:false
        },
        {
          label:"ATL",
          data: Array(chartData.length).fill(atl),
          borderColor:"#9ca3af",
          borderDash:[4,4],
          pointRadius:0,
          fill:false
        }
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          enabled:true,
          callbacks:{
            label: ctx=>{
              if(ctx.dataset.label==="ATH") return `ATH: ${ath.toFixed(3)}`;
              if(ctx.dataset.label==="ATL") return `ATL: ${atl.toFixed(3)}`;
              return `Price: ${ctx.raw.toFixed(3)}`;
            }
          }
        }
      },
      scales:{
        x:{ticks:{display:false}, grid:{color:"#1f2937"}},
        y:{ticks:{color:"#9ca3af"}, grid:{color:"#1f2937"}}
      }
    }
  });

  // plugin per ATH/ATL come testo
  const plugin = {
    id: 'athAtlLabels',
    afterDatasetsDraw(chart){
      const ctx = chart.ctx;
      const yScale = chart.scales.y;
      const xScale = chart.scales.x;

      ctx.save();
      ctx.fillStyle = "#9ca3af";
      ctx.font = "12px Inter";

      ctx.fillText(`ATH: ${ath.toFixed(3)}`, xScale.left + 5, yScale.getPixelForValue(ath) - 5);
      ctx.fillText(`ATL: ${atl.toFixed(3)}`, xScale.left + 5, yScale.getPixelForValue(atl) - 5);

      ctx.restore();
    }
  };
  Chart.register(plugin);
  chart.options.plugins.athAtlLabels = plugin;
  chart.update();
}

// ------------------------
// RESET AUTOMATICO OGNI MEZZANOTTE
// ------------------------
function resetChart24h(){
  chartData = [];
  price24hOpen = targetPrice;
  price24hLow = targetPrice;
  price24hHigh = targetPrice;
  ath = targetPrice;
  atl = targetPrice;

  if(chart) chart.destroy();
  initChart24h();
}

function msUntilMidnight(){
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24,0,0,0);
  return midnight - now;
}

function scheduleDailyReset(){
  const ms = msUntilMidnight();
  setTimeout(()=>{
    resetChart24h();
    setInterval(resetChart24h, 24*60*60*1000);
  }, ms);
}
scheduleDailyReset();

// ------------------------
// WEBSOCKET
// ------------------------
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

function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = () => setConnectionStatus(true);
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    price24hHigh = Math.max(price24hHigh, p);
    price24hLow = Math.min(price24hLow, p);
    ath = Math.max(ath, p);
    atl = Math.min(atl, p);
    chartData.push(p);
    if(chartData.length > 1440) chartData.shift();
    if(chart) {
      chart.data.datasets[0].data = chartData;
      chart.data.datasets[0].borderColor = p >= price24hOpen ? "#22c55e" : "#ef4444";
      chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, p);
      chart.update("none");
    }
  };
  ws.onclose = ()=> {
    setConnectionStatus(false);
    setTimeout(startWS,3000);
  };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

// ------------------------
// PRICE BAR
// ------------------------
function updatePriceBar(){
  const min = price24hLow, max = price24hHigh, open = price24hOpen, price = displayedPrice;
  let linePercent;
  if(price >= open){
    linePercent = 50 + ((price - open)/(max - open))*50;
  } else {
    linePercent = 50 - ((open - price)/(open - min))*50;
  }
  linePercent = Math.max(0, Math.min(100, linePercent));
  $("priceLine").style.left = linePercent + "%";

  if(price >= open){
    $("priceBar").style.background = "linear-gradient(to right, #22c55e, #10b981)";
  } else {
    $("priceBar").style.background = "linear-gradient(to right, #ef4444, #f87171)";
  }

  let barWidth, barLeft;
  if(price >= open){
    barLeft = 50;
    barWidth = linePercent - 50;
  } else {
    barLeft = linePercent;
    barWidth = 50 - linePercent;
  }
  $("priceBar").style.left = barLeft + "%";
  $("priceBar").style.width = barWidth + "%";
}

// ------------------------
// ANIMATION LOOP
// ------------------------
function animate(){
  // PRICE
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice, targetPrice, 0.1);
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const d = ((displayedPrice - price24hOpen)/price24hOpen)*100;
  $("price24h").textContent = `${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className = "sub " + (d>0?"up":"down");

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
  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100, 100)+"%";
  $("rewardPercent").textContent = (displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";

  // LAST UPDATE
  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
