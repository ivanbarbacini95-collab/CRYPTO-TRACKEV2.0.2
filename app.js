let address = localStorage.getItem("inj_address") || "";
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedPrice=0, displayedAvailable=0, displayedStake=0, displayedRewards=0;
let targetPrice=0, price24hOpen=0, price24hLow=0, price24hHigh=0;

let chart, chartData=[], chartLabels=[], chartDot;

const $ = id => document.getElementById(id);
const lerp = (a,b,f) => a + (b-a)*f;

/* Colore cifre cambiate */
function colorNumber(el, n, o, d){
  const ns = n.toFixed(d);
  const os = o.toFixed(d);
  el.innerHTML = [...ns].map((c,i) =>
    c!==os[i] ? `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>` : `<span style="color:#f9fafb">${c}</span>`
  ).join("");
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e => {
  address=e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

/* FETCH JSON */
async function fetchJSON(url){
  try { return await (await fetch(url)).json(); } 
  catch { return {}; }
}

/* ACCOUNT */
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

/* ------------------ CHART 24h ------------------ */

/* Fetch ultimi 24h da Binance (1m) */
async function fetchHistory24h(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData = d.map(c=>+c[4]); // chiusura
  chartLabels = d.map(c=>{
    const date = new Date(c[0]);
    return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
  });

  price24hOpen = chartData[0];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  targetPrice = chartData.at(-1);

  initChart24h();
}
fetchHistory24h();

/* Gradient dinamico */
function createGradient(ctx, price){
  const gradient = ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  gradient.addColorStop(0, price>=price24hOpen?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)");
  gradient.addColorStop(1,"rgba(0,0,0,0)");
  return gradient;
}

/* Inizializza Chart.js */
function initChart24h(){
  const ctx = $("priceChart").getContext("2d");
  chart = new Chart(ctx,{
    type:"line",
    data:{
      labels: chartLabels,
      datasets:[{
        data: chartData,
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx, chartData.at(-1)),
        fill:true,
        pointRadius:0,
        tension:0.3
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{
          ticks:{
            color:"#9ca3af",
            autoSkip:false,
            maxRotation:0,
            callback: function(val,index){
              const label = this.getLabelForValue(index);
              const [h,m] = label.split(':').map(Number);
              if(m===0 || m===30) return label;
              return '';
            }
          },
          grid:{color:"#374151"}
        },
        y:{ ticks:{color:"#9ca3af"}, grid:{color:"#374151"} }
      }
    }
  });

  // crea pallino giallo lampeggiante
  chartDot = document.createElement("div");
  chartDot.className="chart-dot";
  Object.assign(chartDot.style,{
    position:'absolute',
    width:'10px',
    height:'10px',
    borderRadius:'50%',
    background:'#facc15',
    pointerEvents:'none',
    transform:'translate(-50%, -50%)',
    animation:'pulse 1s infinite'
  });
  $("priceChart").parentElement.appendChild(chartDot);
  updatePallino();
}

/* Posiziona pallino sull'ultimo punto */
function updatePallino(){
  if(!chart || !chartDot) return;
  const meta = chart.getDatasetMeta(0);
  const lastPoint = meta.data[meta.data.length-1];
  if(lastPoint){
    const pos = lastPoint.getProps(['x','y'],true); 
    chartDot.style.left = pos.x + "px";
    chartDot.style.top = pos.y + "px";
  }
}

/* Aggiorna grafico realtime */
function updateChartRealtime(price){
  chartData.push(price);
  const now = new Date();
  chartLabels.push(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`);

  if(chartData.length>1440){ chartData.shift(); chartLabels.shift(); }

  price24hHigh = Math.max(price24hHigh, price);
  price24hLow = Math.min(price24hLow, price);

  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].borderColor = price>=price24hOpen?"#22c55e":"#ef4444";
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);
  chart.update("none");

  updatePallino();
}

/* ------------------ WEBSOCKET ------------------ */
let ws;
function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen = () => setConnectionStatus(true);
  ws.onmessage = e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    updateChartRealtime(p);
  };
  ws.onclose = ()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror = ()=> setConnectionStatus(false);
}
startWS();

/* ------------------ CONNECTION STATUS ------------------ */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");
function setConnectionStatus(online){
  statusDot.style.background = online?"#22c55e":"#ef4444";
  statusText.textContent = online?"Online":"Offline";
}

/* ------------------ ANIMAZIONE VALORI ------------------ */
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
  // Prezzo
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

  // Available
  const oldAvailable=displayedAvailable;
  displayedAvailable=lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,oldAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  // Staked
  const oldStake=displayedStake;
  displayedStake=lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,oldStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  // Rewards
  const oldRewards=displayedRewards;
  displayedRewards=lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,oldRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
  if(displayedRewards>oldRewards){ $("rewards").classList.add("up"); setTimeout(()=> $("rewards").classList.remove("up"),1000); }
  $("rewardBar").style.background="linear-gradient(to right, #0ea5e9, #3b82f6)";
  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  // APR
  $("apr").textContent=apr.toFixed(2)+"%";

  // Last update
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
