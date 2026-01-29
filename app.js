/* ================== STATE ================== */
let address = localStorage.getItem("inj_address") || "";

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;
let displayedPrice = 0, displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let targetPrice = 0;

let prevPrice = 0, prevAvailable = 0, prevStake = 0, prevRewards = 0;

let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

/* ================== HELPERS ================== */
const $ = id => document.getElementById(id);
const lerp = (a,b,f) => a + (b-a)*f;

/* ===== Number coloring (REAL FIX) ===== */
function colorNumber(el, newVal, oldVal, decimals){
  const ns = newVal.toFixed(decimals);
  const os = oldVal.toFixed(decimals);

  el.innerHTML = [...ns].map((c,i)=>{
    if(os[i] === undefined || c === os[i])
      return `<span style="color:#f9fafb">${c}</span>`;
    return `<span style="color:${newVal > oldVal ? '#22c55e' : '#ef4444'}">${c}</span>`;
  }).join("");
}

/* ================== ADDRESS ================== */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

/* ================== API ================== */
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

  availableInj = (b.balances?.find(x=>x.denom==="inj")?.amount || 0) / 1e18;
  stakeInj = (s.delegation_responses || []).reduce((a,d)=>a+Number(d.balance.amount),0) / 1e18;

  const newRewards = (r.rewards || []).reduce(
    (a,v)=>a + v.reward.reduce((s,x)=>s+Number(x.amount),0),0
  ) / 1e18;

  if(newRewards > rewardsInj) rewardsInj = newRewards;
  apr = Number(i.inflation || 0) * 100;
}

loadAccount();
setInterval(loadAccount, 2000);

/* ================== CHART ================== */
let chart, chartData = [];
const chartDot = document.getElementById("chartDot");

async function fetchHistory24h(){
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440"
  );

  chartData = d.map(c=>+c[4]);
  price24hOpen = chartData[0];
  price24hLow  = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice  = chartData.at(-1);

  initChart();
}

function createGradient(ctx, price){
  const g = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  g.addColorStop(0, price>=price24hOpen ? "rgba(34,197,94,.25)" : "rgba(239,68,68,.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  return g;
}

function initChart(){
  const ctx = $("priceChart").getContext("2d");

  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: new Array(chartData.length).fill(""),
      datasets:[{
        data: chartData,
        borderWidth:2,
        pointRadius:0,
        tension:.25,
        fill:true,
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx, chartData.at(-1))
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{
        legend:{display:false},
        annotation:{
          annotations:{
            ath:{
              type:"line",
              yMin:price24hHigh,
              yMax:price24hHigh,
              borderColor:"#facc15",
              borderWidth:1,
              label:{
                display:true,
                content:()=>`ATH ${price24hHigh.toFixed(3)}`,
                color:"#facc15",
                position:"end"
              }
            },
            atl:{
              type:"line",
              yMin:price24hLow,
              yMax:price24hLow,
              borderColor:"#3b82f6",
              borderWidth:1,
              label:{
                display:true,
                content:()=>`ATL ${price24hLow.toFixed(3)}`,
                color:"#3b82f6",
                position:"end"
              }
            }
          }
        }
      },
      scales:{
        x:{display:false},
        y:{
          ticks:{color:"#9ca3af"},
          grid:{color:"#1f2937"},
          min:price24hLow * .995,
          max:price24hHigh * 1.005
        }
      }
    }
  });
}

fetchHistory24h();

/* ===== realtime update ===== */
function updateChartRealtime(price){
  chartData.push(price);
  if(chartData.length > 1440) chartData.shift();

  price24hHigh = Math.max(...chartData);
  price24hLow  = Math.min(...chartData);

  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].borderColor = price>=price24hOpen ? "#22c55e" : "#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);

  chart.options.plugins.annotation.annotations.ath.yMin =
  chart.options.plugins.annotation.annotations.ath.yMax = price24hHigh;

  chart.options.plugins.annotation.annotations.atl.yMin =
  chart.options.plugins.annotation.annotations.atl.yMax = price24hLow;

  chart.update("none");

  const meta = chart.getDatasetMeta(0);
  const last = meta.data.at(-1);
  if(last){
    const rect = chart.canvas.getBoundingClientRect();
    chartDot.style.left = rect.left + last.x + "px";
    chartDot.style.top  = rect.top  + last.y + "px";
  }
}

/* ================== WEBSOCKET ================== */
let ws;
function startWS(){
  if(ws) ws.close();

  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

  ws.onopen = ()=> setConnectionStatus(true);
  ws.onmessage = e=>{
    const p = +JSON.parse(e.data).p;
    targetPrice = p;
    updateChartRealtime(p);
  };
  ws.onclose = ()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

/* ================== CONNECTION UI ================== */
function setConnectionStatus(online){
  $("connectionStatus").querySelector(".status-dot").style.background =
    online ? "#22c55e" : "#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent =
    online ? "Online" : "Offline";
}

/* ================== PRICE BAR ================== */
function updatePriceBar(){
  const open = price24hOpen;
  const min  = price24hLow;
  const max  = price24hHigh;
  const p    = displayedPrice;

  let pos = p>=open
    ? 50 + ((p-open)/(max-open))*50
    : 50 - ((open-p)/(open-min))*50;

  pos = Math.max(0,Math.min(100,pos));

  $("priceLine").style.left = pos+"%";
  $("priceBar").style.left = Math.min(pos,50)+"%";
  $("priceBar").style.width = Math.abs(pos-50)+"%";
}

/* ================== ANIMATION LOOP ================== */
function animate(){
  displayedPrice = lerp(displayedPrice, targetPrice, .1);
  colorNumber($("price"), displayedPrice, prevPrice, 4);
  prevPrice = displayedPrice;

  const d = ((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent = `${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className = "sub "+(d>0?"up":"down");

  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);

  updatePriceBar();

  displayedAvailable = lerp(displayedAvailable, availableInj, .1);
  colorNumber($("available"), displayedAvailable, prevAvailable, 6);
  prevAvailable = displayedAvailable;
  $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  displayedStake = lerp(displayedStake, stakeInj, .1);
  colorNumber($("stake"), displayedStake, prevStake, 4);
  prevStake = displayedStake;
  $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  displayedRewards = lerp(displayedRewards, rewardsInj, .1);
  colorNumber($("rewards"), displayedRewards, prevRewards, 7);
  prevRewards = displayedRewards;
  $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  const perc = Math.min(displayedRewards / 0.05 * 100, 100);
  $("rewardBar").style.width = perc + "%";
  $("rewardPercent").textContent = perc.toFixed(1) + "%";

  $("apr").textContent = apr.toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
