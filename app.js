let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let displayedAvailable = 0, displayedStake = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [], chartLabels = [];
let ws;

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

async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); }
  catch{ return {}; }
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* ACCOUNT COMPLETO */
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

/* Aggiornamento solo rewards ogni 2s */
setInterval(async ()=>{
  if(!address) return;
  const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(newRewards > rewardsInj) rewardsInj = newRewards;
}, 2000);

/* HISTORY */
async function fetchHistory(){
  const d = await fetchJSON(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24"
  );

  chartData = d.map(c=>+c[4]);
  chartLabels = d.map((c,i)=>{
    const date = new Date(c[0]);
    return date.getHours()+":00";
  });

  price24hOpen = +d[0][1];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);

  if(!chart) initChart();
}
fetchHistory();

/* CHART */
function initChart(){
  const ctx=$("priceChart").getContext("2d");

  chart=new Chart(ctx,{
    type:"line",
    data:{
      labels: chartLabels,
      datasets:[{
        data: chartData,
        borderColor: "#22c55e",
        backgroundColor: ctx.createLinearGradient(0,0,0,300),
        fill:true,
        pointRadius:0,
        tension:0.4
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label: context => "Price: $"+context.raw.toFixed(4),
            title: context => "Ora: "+context.label
          }
        }
      },
      scales:{
        x:{display:true, ticks:{color:"#9ca3af"}},
        y:{ticks:{color:"#9ca3af"}}
      }
    }
  });
}

function pushPriceTick(price){
  if(!chart) return;
  const now = new Date();
  const label = now.getHours()+":"+String(now.getMinutes()).padStart(2,"0");

  chart.data.labels.push(label);
  chart.data.labels.shift();

  chart.data.datasets[0].data.push(price);
  chart.data.datasets[0].data.shift();

  const open = price24hOpen;
  chart.data.datasets[0].borderColor = price>=open?"#22c55e":"#ef4444";

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
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);

    pushPriceTick(p);
  };
  ws.onclose = ()=> {
    setConnectionStatus(false);
    setTimeout(startWS,3000);
  };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

/* PRICE BAR & ANIMATION */
function updatePriceBar() {
  const min = price24hLow;
  const max = price24hHigh;
  const open = price24hOpen;
  const price = displayedPrice;

  let linePercent = price>=open?
    50 + ((price-open)/(max-open))*50 :
    50 - ((open-price)/(open-min))*50;

  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";
  $("priceBar").style.left=price>=open?50+"%":linePercent+"%";
  $("priceBar").style.width=price>=open?linePercent-50+"%":50-linePercent+"%";
  $("priceBar").style.background = price>=open?
    "linear-gradient(to right,#22c55e,#10b981)" :
    "linear-gradient(to right,#ef4444,#f87171)";
}

function animate(){
  const oldPrice = displayedPrice;
  displayedPrice = lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,oldPrice,4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  updatePriceBar();

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
  if(displayedRewards>oldRewards){
    $("rewards").classList.add("up");
    setTimeout
::contentReference[oaicite:0]{index=0}

     setTimeout(()=> $("rewards").classList.remove("up"), 1000);
  }

  $("rewardBar").style.background = "linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width = Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent = (displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent = apr.toFixed(2)+"%";

  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

animate();
   
