// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let isInitialLoad = true;
let initialFrames = 0;

let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let priceWeekOpen = 0, priceWeekLow = 0, priceWeekHigh = 0;
let priceMonthOpen = 0, priceMonthLow = 0, priceMonthHigh = 0;

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

let displayed = {
  price: 0,
  available: 0,
  stake: 0,
  rewards: 0
};

let chart, chartData = [], ws;

// ================= HELPERS =================
const $ = id => document.getElementById(id);
const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
const safe = n => Number.isFinite(+n) ? +n : 0;

// velocità dinamica
function tick(current, target){
  const speed = isInitialLoad ? 0.35 : 0.85;
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

// ================= BAR (SAFE) =================
function bar(bar,line,v,o,l,h,up,down){
  if(!o || !h || !l || h===l) return;

  const r=Math.max(Math.abs(h-o),Math.abs(o-l),1e-9);
  const p=clamp(((v-(o-r))/(2*r))*100,0,100);

  line.style.left=p+"%";

  if(v>=o){
    bar.style.left="50%";
    bar.style.width=(p-50)+"%";
    bar.style.background=up;
  } else {
    bar.style.left=p+"%";
    bar.style.width=(50-p)+"%";
    bar.style.background=down;
  }
}

// ================= LOOP =================
function animate(){

  // PRICE
  const oldPrice = displayed.price;
  displayed.price = tick(displayed.price, targetPrice);
  colorNumber($("price"), displayed.price, oldPrice, 4);

  $("price24h").textContent = arrow(pct(displayed.price,price24hOpen));
  $("priceWeek").textContent = arrow(pct(displayed.price,priceWeekOpen));
  $("priceMonth").textContent = arrow(pct(displayed.price,priceMonthOpen));

  // BARS — sempre renderizzate
  bar($("priceBar"),$("priceLine"),displayed.price,price24hOpen,price24hLow,price24hHigh,
      "linear-gradient(to right,#22c55e,#10b981)",
      "linear-gradient(to left,#ef4444,#f87171)");

  bar($("weekBar"),$("weekLine"),displayed.price,priceWeekOpen,priceWeekLow,priceWeekHigh,
      "linear-gradient(to right,#f59e0b,#fbbf24)",
      "linear-gradient(to left,#f97316,#f87171)");

  bar($("monthBar"),$("monthLine"),displayed.price,priceMonthOpen,priceMonthLow,priceMonthHigh,
      "linear-gradient(to right,#8b5cf6,#c084fc)",
      "linear-gradient(to left,#6b21a8,#c084fc)");

  // AVAILABLE
  const oa = displayed.available;
  displayed.available = tick(displayed.available, availableInj);
  colorNumber($("available"), displayed.available, oa, 6);
  $("availableUsd").textContent = `≈ $${(displayed.available*displayed.price).toFixed(2)}`;

  // STAKE
  const os = displayed.stake;
  displayed.stake = tick(displayed.stake, stakeInj);
  colorNumber($("stake"), displayed.stake, os, 4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake*displayed.price).toFixed(2)}`;

  // REWARDS
  const or = displayed.rewards;
  if(rewardsInj < or){
    displayed.rewards = 0;
    $("rewardBar").style.width="0%";
    $("rewardLine").style.left="0%";
    $("rewardPercent").textContent="0%";
  } else {
    displayed.rewards = tick(displayed.rewards, rewardsInj);
  }
  colorNumber($("rewards"), displayed.rewards, or, 7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards*displayed.price).toFixed(2)}`;

  // APR
  $("apr").textContent = apr.toFixed(2)+"%";
  $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

  // fine caricamento iniziale dopo ~30 frame
  if(isInitialLoad){
    initialFrames++;
    if(initialFrames > 30) isInitialLoad = false;
  }

  requestAnimationFrame(animate);
}
animate();
