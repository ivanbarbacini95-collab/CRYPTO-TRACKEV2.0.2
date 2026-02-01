// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;

// OHLC
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let priceWeekOpen = 0, priceWeekLow = 0, priceWeekHigh = 0;
let priceMonthOpen = 0, priceMonthLow = 0, priceMonthHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let chart, chartData = [], ws;

// ================= CSS INJECT (FLASH + SHAKE) =================
const style = document.createElement("style");
style.innerHTML = `
.reward-flash {
  animation: rewardFlash 0.35s ease-out;
}
@keyframes rewardFlash {
  0%   { box-shadow: 0 0 0 rgba(239,68,68,0); }
  30%  { box-shadow: 0 0 35px rgba(239,68,68,0.9); }
  100% { box-shadow: 0 0 0 rgba(239,68,68,0); }
}

.reward-shake {
  animation: rewardShake 0.25s linear;
}
@keyframes rewardShake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-3px); }
  100% { transform: translateX(0); }
}
`;
document.head.appendChild(style);

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const clamp = (n,a,b) => Math.min(Math.max(n,a),b);
const safe = n => Number.isFinite(+n) ? +n : 0;

function colorNumber(el, n, o, dec = 4) {
  const ns = n.toFixed(dec), os = o.toFixed(dec);
  if (ns === os) { el.innerHTML = ns; return; }
  el.innerHTML = [...ns].map((c,i)=>{
    const col = c!==os[i] ? (n>o ? "#22c55e" : "#ef4444") : "#f9fafb";
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

async function fetchJSON(url){
  try{ return await (await fetch(url,{cache:"no-store"})).json(); }
  catch{ return {}; }
}

function getHeatColor(p){
  p=clamp(p,0,100)/100;
  return `rgb(${14+(239-14)*p},${165-165*p},${233-233*p})`;
}

const pct = (v,o)=>o?((v-o)/o*100):0;
const arrow = v=>`${v>=0?"▲":"▼"} ${Math.abs(v).toFixed(2)}%`;

// ================= ADDRESS =================
$("addressInput").value = address;
$("addressInput").oninput = e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

// ================= ACCOUNT =================
async function loadAccount(){
  if(!address) return;
  const [b,s,r,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj=safe(b.balances?.find(x=>x.denom==="inj")?.amount)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+safe(d.balance.amount),0)/1e18;
  rewardsInj=(r.rewards||[]).reduce((a,x)=>a+x.reward.reduce((s,y)=>s+safe(y.amount),0),0)/1e18;
  apr=safe(i.inflation)*100;
}
loadAccount();
setInterval(loadAccount,2000);

// ================= BINANCE =================
async function klines(i,l){
  return await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${i}&limit=${l}`)||[];
}

function calcOHLC(d){
  if(!d.length) return{};
  return{
    open:safe(d[0][1]),
    high:Math.max(...d.map(x=>safe(x[2]))),
    low:Math.min(...d.map(x=>safe(x[3]))),
    close:safe(d.at(-1)[4])
  };
}

async function loadPrices(){
  const d=await klines("1m",1440);
  if(!d.length) return;
  chartData=d.map(x=>safe(x[4]));
  const o=calcOHLC(d);
  price24hOpen=o.open; price24hHigh=o.high; price24hLow=o.low;
  targetPrice=o.close;
  if(!chart) initChart();
}
async function loadTF(){
  const [w,m]=await Promise.all([klines("1w",1),klines("1M",1)]);
  if(w[0]){priceWeekOpen=safe(w[0][1]);priceWeekHigh=safe(w[0][2]);priceWeekLow=safe(w[0][3]);}
  if(m[0]){priceMonthOpen=safe(m[0][1]);priceMonthHigh=safe(m[0][2]);priceMonthLow=safe(m[0][3]);}
}
loadPrices(); loadTF();
setInterval(loadPrices,60000); setInterval(loadTF,60000);

// ================= CHART =================
function initChart(){
  chart=new Chart($("priceChart"),{
    type:"line",
    data:{labels:Array(1440).fill(""),datasets:[{data:chartData,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,.2)",fill:true,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}}
  });
}
function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ================= WS =================
function status(on){
  $("connectionStatus").querySelector(".status-dot").style.background=on?"#22c55e":"#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent=on?"Online":"Offline";
}
function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen=()=>status(true);
  ws.onmessage=e=>{
    const p=safe(JSON.parse(e.data).p);
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    priceWeekHigh=Math.max(priceWeekHigh,p);
    priceWeekLow=Math.min(priceWeekLow,p);
    priceMonthHigh=Math.max(priceMonthHigh,p);
    priceMonthLow=Math.min(priceMonthLow,p);
    updateChart(p);
  };
  ws.onclose=()=>{status(false);setTimeout(startWS,3000);}
}
startWS();

// ================= BAR =================
function bar(bar,line,v,o,l,h,up,down){
  const r=Math.max(Math.abs(h-o),Math.abs(o-l),1e-9);
  const p=clamp(((v-(o-r))/(2*r))*100,0,100);
  line.style.left=p+"%";
  if(v>=o){bar.style.left="50%";bar.style.width=(p-50)+"%";bar.style.background=up;}
  else{bar.style.left=p+"%";bar.style.width=(50-p)+"%";bar.style.background=down;}
}

// ================= LOOP (ISTANT) =================
function animate(){

  // PRICE
  if(displayed.price!==targetPrice){
    const o=displayed.price; displayed.price=targetPrice;
    colorNumber($("price"),displayed.price,o,4);

    $("price24h").textContent=arrow(pct(displayed.price,price24hOpen));
    $("priceWeek").textContent=arrow(pct(displayed.price,priceWeekOpen));
    $("priceMonth").textContent=arrow(pct(displayed.price,priceMonthOpen));

    bar($("priceBar"),$("priceLine"),displayed.price,price24hOpen,price24hLow,price24hHigh,"linear-gradient(to right,#22c55e,#10b981)","linear-gradient(to left,#ef4444,#f87171)");
    bar($("weekBar"),$("weekLine"),displayed.price,priceWeekOpen,priceWeekLow,priceWeekHigh,"linear-gradient(to right,#f59e0b,#fbbf24)","linear-gradient(to left,#f97316,#f87171)");
    bar($("monthBar"),$("monthLine"),displayed.price,priceMonthOpen,priceMonthLow,priceMonthHigh,"linear-gradient(to right,#8b5cf6,#c084fc)","linear-gradient(to left,#6b21a8,#c084fc)");
  }

  // AVAILABLE
  if(displayed.available!==availableInj){
    colorNumber($("available"),availableInj,displayed.available,6);
    displayed.available=availableInj;
    $("availableUsd").textContent=`≈ $${(availableInj*displayed.price).toFixed(2)}`;
  }

  // STAKE
  if(displayed.stake!==stakeInj){
    colorNumber($("stake"),stakeInj,displayed.stake,4);
    displayed.stake=stakeInj;
    $("stakeUsd").textContent=`≈ $${(stakeInj*displayed.price).toFixed(2)}`;
  }

  // REWARDS + FLASH + SHAKE
  if(displayed.rewards!==rewardsInj){
    const old=displayed.rewards;
    displayed.rewards=rewardsInj;
    colorNumber($("rewards"),rewardsInj,old,7);
    $("rewardsUsd").textContent=`≈ $${(rewardsInj*displayed.price).toFixed(2)}`;

    const card=document.querySelector(".reward-card");

    if(rewardsInj<old){
      $("rewardBar").style.transition="none";
      $("rewardBar").style.width="0%";
      $("rewardLine").style.left="0%";
      $("rewardPercent").textContent="0%";

      card.classList.remove("reward-flash","reward-shake");
      void card.offsetWidth;
      card.classList.add("reward-flash","reward-shake");

      setTimeout(()=>card.classList.remove("reward-flash","reward-shake"),400);
    } else {
      const max=Math.max(.1,Math.ceil(rewardsInj*10)/10);
      const p=Math.min(rewardsInj/max*100,100);
      $("rewardBar").style.transition="";
      $("rewardBar").style.width=p+"%";
      $("rewardLine").style.left=p+"%";
      $("rewardPercent").textContent=p.toFixed(1)+"%";
      $("rewardBar").style.background=getHeatColor(p);
    }
  }

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();
  requestAnimationFrame(animate);
}
animate();
