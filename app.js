// ---------- DASHBOARD PREESISTENTE ----------
let address = localStorage.getItem("inj_address") || "";

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

// INPUT ADDRESS
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

// Account loader
async function fetchJSON(url){ try { return await (await fetch(url)).json(); } catch { return {}; } }
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
  if(newRewards > rewardsInj){ rewardsInj = newRewards; }
  apr = Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount, 60000);

// ---------- GRAFICO 24h INJ (PRIMA SERIE) ----------
let chart, chartData=[], chartLabels=[], ath=0, atl=Infinity;
let price24hOpen=0;

const ctx = document.getElementById("priceChart").getContext("2d");

function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=price24hOpen?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

async function fetchHistory24h(){
  const d = await (await fetch("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440")).json();
  chartData = d.map(c => +c[4]);
  chartLabels = Array(1440).fill("");
  price24hOpen = chartData[0];
  ath = Math.max(...chartData);
  atl = Math.min(...chartData);
  initChart();
}

function initChart(){
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: chartLabels,
      datasets:[
        {label:"Price", data: chartData, borderColor:"#22c55e", backgroundColor:createGradient(ctx, chartData.at(-1)), fill:true, pointRadius:0, tension:0.2},
        {label:"ATH", data: Array(chartData.length).fill(ath), borderColor:"#9ca3af", borderDash:[4,4], pointRadius:0, fill:false},
        {label:"ATL", data: Array(chartData.length).fill(atl), borderColor:"#9ca3af", borderDash:[4,4], pointRadius:0, fill:false}
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false, animation:false,
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
        x:{ticks:{display:false}, grid:{color:"#1f2937"}, min:0, max:1439},
        y:{ticks:{color:"#9ca3af"}, grid:{color:"#1f2937"}}
      }
    }
  });
  addAthAtlLabels();
}

function addAthAtlLabels(){
  const plugin = {
    id: 'athAtlLabels',
    afterDatasetsDraw(chart){
      const ctx = chart.ctx;
      const yScale = chart.scales.y;
      const xScale = chart.scales.x;
      ctx.save();
      ctx.fillStyle = "#9ca3af";
      ctx.font = "12px Inter";
      ctx.fillText(`ATH: ${ath.toFixed(3)}`, xScale.left + 5, yScale.getPixelForValue(ath)-5);
      ctx.fillText(`ATL: ${atl.toFixed(3)}`, xScale.left + 5, yScale.getPixelForValue(atl)-5);
      ctx.restore();
    }
  };
  chart.options.plugins.athAtlLabels = plugin;
  Chart.register(plugin);
  chart.update();
}

const ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
ws.onmessage = e=>{
  const p = +JSON.parse(e.data).p;
  chartData.push(p);
  chartData.shift();
  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].borderColor = p >= price24hOpen ? "#22c55e" : "#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(ctx, p);
  chart.update("none");
};

fetchHistory24h();

// ---------- ANIMATION LOOP DASHBOARD ----------
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i)=>c!==os[i]?`<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`:`<span style="color:#f9fafb">${c}</span>`).join("");
}

let displayedPrice = 0;
function animate(){
  const oldPrice = displayedPrice;
  displayedPrice = chartData.at(-1) || displayedPrice;
  colorNumber($("price"), displayedPrice, oldPrice, 4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=ath===0?price24hOpen.toFixed(3):chartData.reduce((a,b)=>Math.min(a,b),Infinity).toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=ath.toFixed(3);

  const oldAvailable = displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"), displayedAvailable, oldAvailable, 6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  const oldStake = displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"), displayedStake, oldStake, 4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  const oldRewards = displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"), displayedRewards, oldRewards, 7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  $("rewardBar").style.background = "linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";

  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
