// ================= CONFIG =================
const INITIAL_LOAD_DURATION = 3000; // 3 secondi

// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let startTime = Date.now();

let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let priceWeekOpen = 0, priceWeekLow = 0, priceWeekHigh = 0;
let priceMonthOpen = 0, priceMonthLow = 0, priceMonthHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let chart = null;
let chartData = [];
let ws;

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
const safe = n => Number.isFinite(+n) ? +n : 0;

function isInitialLoad(){
  return Date.now() - startTime < INITIAL_LOAD_DURATION;
}

function tick(current, target){
  const speed = isInitialLoad() ? 0.25 : 0.85;
  if (Math.abs(current - target) < 1e-6) return target;
  return current + (target - current) * speed;
}

function colorNumber(el, n, o, dec = 4){
  const ns = n.toFixed(dec), os = o.toFixed(dec);
  if (ns === os){ el.textContent = ns; return; }
  el.innerHTML = [...ns].map((c,i)=>{
    const col = c!==os[i] ? (n>o?"#22c55e":"#ef4444") : "#f9fafb";
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

async function fetchJSON(url){
  try{ return await (await fetch(url,{cache:"no-store"})).json(); }
  catch{ return {}; }
}

const pct = (v,o)=>o?((v-o)/o*100):0;
const arrow = v=>`${v>=0?"▲":"▼"} ${Math.abs(v).toFixed(2)}%`;

function heat(p){
  p = clamp(p,0,100)/100;
  return `rgb(${14+(239-14)*p},${165-165*p},${233-233*p})`;
}

// ================= ADDRESS =================
$("addressInput").value = address;
$("addressInput").oninput = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address",address);
  startTime = Date.now(); // ricarico animazione iniziale
  loadAccount();
};

// ================= ACCOUNT =================
async function loadAccount(){
  if(!address) return;
  const [b,s,r,i] = await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj = safe(b.balances?.find(x=>x.denom==="inj")?.amount)/1e18;
  stakeInj = (s.delegation_responses||[]).reduce((a,d)=>a+safe(d.balance.amount),0)/1e18;
  rewardsInj = (r.rewards||[]).reduce((a,x)=>a+x.reward.reduce((s,y)=>s+safe(y.amount),0),0)/1e18;
  apr = safe(i.inflation)*100;
}
loadAccount();
setInterval(loadAccount,2000);

// ================= BINANCE =================
async function klines(interval,limit){
  return await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=${interval}&limit=${limit}`)||[];
}

function calcOHLC(d){
  return{
    open: safe(d[0][1]),
    high: Math.max(...d.map(x=>safe(x[2]))),
    low:  Math.min(...d.map(x=>safe(x[3]))),
    close:safe(d.at(-1)[4])
  };
}

async function loadPrices(){
  const d = await klines("1m",1440);
  if(!d.length) return;

  chartData = d.map(x=>safe(x[4]));
  const o = calcOHLC(d);

  price24hOpen=o.open; price24hHigh=o.high; price24hLow=o.low;
  targetPrice=o.close;

  if(!chart) initChart();
}

async function loadTF(){
  const [w,m] = await Promise.all([klines("1w",1),klines("1M",1)]);
  if(w[0]){
    priceWeekOpen=safe(w[0][1]);
    priceWeekHigh=safe(w[0][2]);
    priceWeekLow=safe(w[0][3]);
  }
  if(m[0]){
    priceMonthOpen=safe(m[0][1]);
    priceMonthHigh=safe(m[0][2]);
    priceMonthLow=safe(m[0][3]);
  }
}

loadPrices();
loadTF();
setInterval(loadPrices,60000);
setInterval(loadTF,60000);

// ================= CHART =================
function initChart(){
  chart = new Chart($("priceChart"),{
    type:"line",
    data:{
      labels:Array(1440).fill(""),
      datasets:[{
        data:chartData,
        borderColor:"#22c55e",
        backgroundColor:"rgba(34,197,94,0.2)",
        fill:true,
        pointRadius:0,
        tension:0.3
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}
    }
  });
}

function updateChart(p){
  if(!chart) return;
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

// ================= WS =================
function startWS(){
  if(ws) ws.close();
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onmessage = e=>{
    const p = safe(JSON.parse(e.data).p);
    targetPrice = p;

    price24hHigh = Math.max(price24hHigh,p);
    price24hLow  = Math.min(price24hLow,p);
    priceWeekHigh = Math.max(priceWeekHigh,p);
    priceWeekLow  = Math.min(priceWeekLow,p);
    priceMonthHigh = Math.max(priceMonthHigh,p);
    priceMonthLow  = Math.min(priceMonthLow,p);

    updateChart(p);
  };
}
startWS();

// ================= BAR =================
function renderBar(bar,line,val,open,low,high,up,down){
  if(!open||!high||!low||high===low) return;

  const range = Math.max(Math.abs(high-open),Math.abs(open-low));
  const scaledLow = open-range;
  const scaledHigh = open+range;

  const p = clamp((val-scaledLow)/(scaledHigh-scaledLow)*100,0,100);
  line.style.left=p+"%";

  if(val>=open){
    bar.style.left="50%";
    bar.style.width=(p-50)+"%";
    bar.style.background=up;
  }else{
    bar.style.left=p+"%";
    bar.style.width=(50-p)+"%";
    bar.style.background=down;
  }
}

// ================= LOOP =================
function animate(){

  // PRICE
  const op = displayed.price;
  displayed.price = tick(displayed.price,targetPrice);
  colorNumber($("price"),displayed.price,op,4);

  $("price24h").textContent = arrow(pct(displayed.price,price24hOpen));
  $("priceWeek").textContent = arrow(pct(displayed.price,priceWeekOpen));
  $("priceMonth").textContent = arrow(pct(displayed.price,priceMonthOpen));

  // BARS + VALUES
  renderBar($("priceBar"),$("priceLine"),displayed.price,price24hOpen,price24hLow,price24hHigh,
    "linear-gradient(to right,#22c55e,#10b981)","linear-gradient(to left,#ef4444,#f87171)");
  $("priceMin").textContent = price24hLow.toFixed(3);
  $("priceOpen").textContent = price24hOpen.toFixed(3);
  $("priceMax").textContent = price24hHigh.toFixed(3);

  renderBar($("weekBar"),$("weekLine"),displayed.price,priceWeekOpen,priceWeekLow,priceWeekHigh,
    "linear-gradient(to right,#f59e0b,#fbbf24)","linear-gradient(to left,#f97316,#f87171)");
  $("weekMin").textContent = priceWeekLow.toFixed(3);
  $("weekOpen").textContent = priceWeekOpen.toFixed(3);
  $("weekMax").textContent = priceWeekHigh.toFixed(3);

  renderBar($("monthBar"),$("monthLine"),displayed.price,priceMonthOpen,priceMonthLow,priceMonthHigh,
    "linear-gradient(to right,#8b5cf6,#c084fc)","linear-gradient(to left,#6b21a8,#c084fc)");
  $("monthMin").textContent = priceMonthLow.toFixed(3);
  $("monthOpen").textContent = priceMonthOpen.toFixed(3);
  $("monthMax").textContent = priceMonthHigh.toFixed(3);

  // AVAILABLE
  const oa = displayed.available;
  displayed.available = tick(displayed.available,availableInj);
  colorNumber($("available"),displayed.available,oa,6);
  $("availableUsd").textContent = `≈ $${(displayed.available*displayed.price).toFixed(2)}`;

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake,stakeInj);
  colorNumber($("stake"),displayed.stake,os,4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake*displayed.price).toFixed(2)}`;

  // REWARDS
  const or = displayed.rewards;
  if(rewardsInj < or){
    displayed.rewards = 0;
    $("rewardBar").style.width="0%";
    $("rewardLine").style.left="0%";
    $("rewardPercent").textContent="0%";
  }else{
    displayed.rewards = tick(displayed.rewards,rewardsInj);
  }
  colorNumber($("rewards"),displayed.rewards,or,7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards*displayed.price).toFixed(2)}`;

  const maxR = Math.max(0.1,Math.ceil(displayed.rewards*10)/10);
  const rp = Math.min(displayed.rewards/maxR*100,100);
  $("rewardBar").style.width = rp+"%";
  $("rewardLine").style.left = rp+"%";
  $("rewardPercent").textContent = rp.toFixed(1)+"%";
  $("rewardBar").style.background = heat(rp);

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";
  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
