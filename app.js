let address = localStorage.getItem("inj_address") || "";
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedPrice=0, displayedAvailable=0, displayedStake=0, displayedRewards=0;
let targetPrice=0, price24hOpen=0, price24hLow=0, price24hHigh=0;
let chartATH=0, chartATL=Infinity;

const $ = id => document.getElementById(id);
const lerp = (a,b,f) => a + (b-a)*f;

/* COLORAZIONE NUMERI SOLO CIFRE CAMBIATE */
function colorNumber(el, newValue, oldValue, decimals){
  const ns = newValue.toFixed(decimals);
  const os = oldValue.toFixed(decimals);
  el.innerHTML = [...ns].map((c,i)=>{
    if(i>=os.length) return `<span style="color:#f9fafb">${c}</span>`;
    return c!==os[i] ? `<span style="color:${newValue>oldValue?'#22c55e':'#ef4444'}">${c}</span>` : `<span style="color:#f9fafb">${c}</span>`;
  }).join("");
}

/* INPUT ADDRESS */
$("addressInput").value = address;
$("addressInput").onchange = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  loadAccount();
};

/* FETCH ACCOUNT */
async function fetchJSON(url){
  try{ return await (await fetch(url)).json(); } catch{return {};}
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

/* ---------------- CHART ---------------- */
let chart, chartData=[], chartLabels=[];

async function fetchHistory24h(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData = d.map(c=>+c[4]);
  chartLabels = new Array(chartData.length).fill(""); // X fisso, niente ore
  price24hOpen = chartData[0];
  price24hLow = Math.min(...chartData);
  price24hHigh = Math.max(...chartData);
  chartATH = price24hHigh;
  chartATL = price24hLow;
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
      labels: chartLabels,
      datasets:[{
        data: chartData,
        borderColor:"#22c55e",
        backgroundColor:createGradient(ctx, chartData.at(-1)),
        fill:true,
        pointRadius:0,
        tension:0.2
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
            athLine:{
              type:'line', yMin:chartATH, yMax:chartATH,
              borderColor:'#facc15', borderWidth:1,
              label:{display:true, content:'ATH: '+chartATH.toFixed(3), position:'end', color:'#facc15'}
            },
            atlLine:{
              type:'line', yMin:chartATL, yMax:chartATL,
              borderColor:'#3b82f6', borderWidth:1,
              label:{display:true, content:'ATL: '+chartATL.toFixed(3), position:'end', color:'#3b82f6'}
            }
          }
        }
      },
      scales:{
        x:{ticks:{display:false}, grid:{color:"#1f2937"}},
        y:{ticks:{color:"#9ca3af"}, grid:{color:"#1f2937"}, min:price24hLow*0.995, max:price24hHigh*1.005}
      }
    }
  });
}

/* ---------------- PALLINO AZZURRO ---------------- */
let chartDot = document.createElement("div");
chartDot.className = "chart-dot";
document.querySelector(".chart-card").appendChild(chartDot);

function updateChartRealtime(price){
  chartData.push(price);
  if(chartData.length>1440) chartData.shift();
  price24hHigh = Math.max(...chartData);
  price24hLow = Math.min(...chartData);

  const color = price>=price24hOpen ? "#22c55e" : "#ef4444";
  chart.data.datasets[0].data = chartData;
  chart.data.datasets[0].borderColor = color;
  chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);
  chart.update("none");

  // Pallino segue ultimo punto
  const meta = chart.getDatasetMeta(0);
  const lastPoint = meta.data[meta.data.length-1];
  if(lastPoint){
    const pos = lastPoint.getProps(['x','y'],true);
    chartDot.style.left = pos.x + "px";
    chartDot.style.top = pos.y + "px";
  }
}

/* ---------------- WEBSOCKET ---------------- */
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

/* ---------------- CONNECTION ---------------- */
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");
function setConnectionStatus(online){
  statusDot.style.background = online?"#22c55e":"#ef4444";
  statusText.textContent = online?"Online":"Offline";
}

/* ---------------- ANIMAZIONE VALORI ---------------- */
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
  displayedPrice = lerp(displayedPrice,targetPrice,0.1);
  colorNumber($("price"),displayedPrice,displayedPrice,4);

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  updatePriceBar();

  displayedAvailable = lerp(displayedAvailable,availableInj,0.1);
  colorNumber($("available"),displayedAvailable,displayedAvailable,6);
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  displayedStake = lerp(displayedStake,stakeInj,0.1);
  colorNumber($("stake"),displayedStake,displayedStake,4);
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  displayedRewards = lerp(displayedRewards,rewardsInj,0.1);
  colorNumber($("rewards"),displayedRewards,displayedRewards,7);
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
  $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();

/* ---------------- UPDATE ACCOUNT EVERY 2 SEC ---------------- */
setInterval(loadAccount,2000);
