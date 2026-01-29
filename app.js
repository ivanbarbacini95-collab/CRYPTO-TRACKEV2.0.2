let address = localStorage.getItem("inj_address") || "";
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;

let displayedPrice=0, displayedAvailable=0, displayedStake=0, displayedRewards=0;
let targetPrice=0, price24hOpen=0, price24hLow=0, price24hHigh=0;

const $ = id => document.getElementById(id);
const lerp = (a,b,f) => a + (b-a)*f;

/* Funzione per colorare le cifre cambiate */
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i) => c!==os[i] ? `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>` : `<span style="color:#f9fafb">${c}</span>`).join("");
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e => {
  address=e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

/* ACCOUNT */
async function fetchJSON(url){
  try { return await (await fetch(url)).json(); } 
  catch { return {}; }
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
  if(newRewards>rewardsInj) rewardsInj=newRewards;
  apr = Number(i.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,60000);

/* PRICE HISTORY & CHART 24h */
const MAX_POINTS = 24*60;
let chart, chartData=[], tickIndex=0, startPrice=0, lastPrice=0;

async function fetchHistory(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData = d.map(c=>+c[4]);
  price24hOpen = +d[0][1];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  startPrice = chartData[0];
  lastPrice = chartData.at(-1);
  targetPrice = lastPrice;
  initChart24h(startPrice);
}
fetchHistory();

/* INIZIALIZZA CHART */
function initChart24h(start){
  startPrice=start; lastPrice=start;
  chartData = Array(MAX_POINTS).fill(null); chartData[0]=startPrice;
  tickIndex=0;
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: generateLabels(),
      datasets:[{
        data: chartData,
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx,start),
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
          enabled:true,
          callbacks:{
            label: ctx => {
              const price = ctx.raw ? ctx.raw.toFixed(4) : '-';
              const time = chart.data.labels[ctx.dataIndex]||'';
              return `${time} → $${price}`;
            }
          }
        }
      },
      scales:{
        x:{ ticks:{color:"#9ca3af", autoSkip:true, maxTicksLimit:25} },
        y:{ ticks:{color:"#9ca3af"} }
      }
    }
  });
  addBlinkingDot(ctx);
}

function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=startPrice?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

function generateLabels(){
  const labels = [];
  const now = new Date();
  for(let i=0;i<MAX_POINTS;i++){
    const d = new Date(now.getTime()-(MAX_POINTS-i-1)*60*1000);
    labels.push(d.getMinutes()%10===0 ? `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` : '');
  }
  return labels;
}

/* AGGIORNA CHART REALTIME */
function updateChartRealtime(price){
  lastPrice=price; tickIndex++;
  if(tickIndex>=MAX_POINTS){ tickIndex=0; startPrice=price; chartData.fill(null); chartData[0]=startPrice; }
  else chartData[tickIndex]=price;
  chart.data.datasets[0].data=chartData;
  chart.data.datasets[0].borderColor = price>=startPrice?"#22c55e":"#ef4444";
  chart.data.datasets[0].backgroundColor=createGradient(chart.ctx,price);
  chart.update("none");
}

/* BLINKING DOT */
function addBlinkingDot(ctx){
  const dot={alpha:1,increasing:false};
  function drawDot(){
    if(!chart) return;
    const dataset = chart.data.datasets[0].data;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    const x = xScale.getPixelForValue(tickIndex);
    const y = dataset[tickIndex]!==null?yScale.getPixelForValue(dataset[tickIndex]):yScale.getPixelForValue(lastPrice);
    dot.alpha += dot.increasing?0.05:-0.05;
    if(dot.alpha<=0.2) dot.increasing=true;
    if(dot.alpha>=1) dot.increasing=false;
    chart.update("none");
    ctx.save();
    ctx.globalAlpha=dot.alpha;
    ctx.beginPath();
    ctx.arc(x,y,5,0,2*Math.PI);
    ctx.fillStyle="#facc15";
    ctx.fill();
    ctx.restore();
    requestAnimationFrame(drawDot);
  }
  drawDot();
}

/* CONNECTION STATUS */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
  if(online){ statusDot.style.background="#22c55e"; statusText.textContent="Online"; }
  else { statusDot.style.background="#ef4444"; statusText.textContent="Offline"; }
}
setConnectionStatus(false);

/* WEBSOCKET */
let ws;
function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = () => setConnectionStatus(true);
  ws.onmessage = e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChartRealtime(p);
  };
  ws.onclose=()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror=()=> setConnectionStatus(false);
}
startWS();

/* PRICE BAR & ANIMATION LOOP */
function updatePriceBar(){
  const min=price24hLow, max=price24hHigh, open=price24hOpen, price=displayedPrice;
  let linePercent = price>=open? 50+((price-open)/(max-open)*50) : 50-((open-price)/(open-min)*50);
  linePercent=Math.max(0,Math.min(100,linePercent));
  $("priceLine").style.left=linePercent+"%";
  $("priceBar").style.background=price>=open? "linear-gradient(to right, #22c55e, #10b981)" : "linear-gradient(to right, #ef4444, #f87171)";
  let barWidth, barLeft;
  if(price>=open){ barLeft=50; barWidth=linePercent-50; } else { barLeft=linePercent; barWidth=50-linePercent; }
  $("priceBar").style.left=barLeft+"%"; $("priceBar").style.width=barWidth+"%";
}

function animate(){
  // PRICE
  const oldPrice=displayedPrice;
  displayedPrice=lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,oldPrice,4);
  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");
  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);
  updatePriceBar();

  // AVAILABLE
  const oldAvailable = displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,oldAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // STAKE
  const oldStake = displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,oldStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // REWARDS
  const oldRewards = displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,oldRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  if(displayedRewards>oldRewards){ $("rewards").classList.add("up"); setTimeout(()=>$("rewards").classList.remove("up"),1000); }
  $("rewardBar").style.background="linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent=apr.toFixed(2)+"%";

  // LAST UPDATE
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
