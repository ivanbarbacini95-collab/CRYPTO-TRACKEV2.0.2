const INITIAL_LOAD_DURATION = 3000;

const $ = id => document.getElementById(id);
const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
const safe = n => Number.isFinite(+n) ? +n : 0;

const containerEl = document.querySelector(".container");
containerEl.classList.add("loading");

let readyTimeout = null;
let hasPriceData = false;
let hasTFData = false;

function setReadyUI(ready){
  containerEl.classList.toggle("loading", !ready);
  containerEl.classList.toggle("ready", ready);
}

function armMinimumLoading(){
  if(readyTimeout) clearTimeout(readyTimeout);
  setReadyUI(false);
  readyTimeout = setTimeout(()=>{
    if(hasPriceData && hasTFData) setReadyUI(true);
  }, INITIAL_LOAD_DURATION);
}

let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;

let price24hOpen=0,price24hLow=0,price24hHigh=0;
let priceWeekOpen=0,priceWeekLow=0,priceWeekHigh=0;
let priceMonthOpen=0,priceMonthLow=0,priceMonthHigh=0;

let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayed={price:0,available:0,stake:0,rewards:0};

let chart=null, chartData=[], ws;

function tick(current,target){
  const speed = containerEl.classList.contains("loading") ? 0.25 : 0.85;
  if (Math.abs(current-target) < 1e-6) return target;
  return current + (target-current)*speed;
}

function colorNumber(el,n,o,d=4){
  const ns=n.toFixed(d), os=o.toFixed(d);
  if(ns===os){ el.textContent=ns; return; }
  el.innerHTML=[...ns].map((c,i)=>{
    const col=c!==os[i]?(n>o?"#22c55e":"#ef4444"):"#f9fafb";
    return `<span style="color:${col}">${c}</span>`;
  }).join("");
}

function updatePerf(a,p,v){
  const arrow=$(a), pct=$(p);
  if(!Number.isFinite(v)) v = 0;
  if(v>0){arrow.textContent="▲";arrow.className="arrow up";pct.className="pct up";}
  else if(v<0){arrow.textContent="▼";arrow.className="arrow down";pct.className="pct down";}
  else{arrow.textContent="►";arrow.className="arrow flat";pct.className="pct flat";}
  pct.textContent=Math.abs(v).toFixed(2)+"%";
}

function getHeatColor(percent){
  const p = clamp(percent,0,100)/100;
  return `rgb(${14+(239-14)*p},${165-165*p},${233-233*p})`;
}

async function fetchJSON(u){
  try{ return await (await fetch(u,{cache:"no-store"})).json(); }
  catch{ return {}; }
}

/* ADDRESS */
$("addressInput").value = address;
$("addressInput").oninput = e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address",address);
  hasPriceData = false;
  hasTFData = false;
  armMinimumLoading();
  loadAccount();
};

/* ACCOUNT */
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

/* BINANCE */
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

  price24hOpen=o.open;price24hHigh=o.high;price24hLow=o.low;
  targetPrice=o.close;

  hasPriceData = true;
  if(hasTFData) setTimeout(()=>setReadyUI(true), INITIAL_LOAD_DURATION);

  if(!chart) initChart();
}

async function loadTF(){
  const [w,m]=await Promise.all([klines("1w",1),klines("1M",1)]);
  if(w[0]){priceWeekOpen=safe(w[0][1]);priceWeekHigh=safe(w[0][2]);priceWeekLow=safe(w[0][3]);}
  if(m[0]){priceMonthOpen=safe(m[0][1]);priceMonthHigh=safe(m[0][2]);priceMonthLow=safe(m[0][3]);}

  hasTFData = true;
  if(hasPriceData) setTimeout(()=>setReadyUI(true), INITIAL_LOAD_DURATION);
}

loadPrices();
loadTF();
armMinimumLoading();
setInterval(loadPrices,60000);
setInterval(loadTF,60000);

/* CHART */
function initChart(){
  chart = new Chart($("priceChart"),{
    type:"line",
    data:{labels:Array(1440).fill(""),datasets:[{
      data:chartData,
      borderColor:"#22c55e",
      backgroundColor:"rgba(34,197,94,.2)",
      fill:true,
      pointRadius:0,
      tension:0.3
    }]},
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

/* WS */
function startWS(){
  ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onmessage = e=>{
    const p = safe(JSON.parse(e.data).p);
    targetPrice = p;

    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    priceWeekHigh=Math.max(priceWeekHigh,p);
    priceWeekLow=Math.min(priceWeekLow,p);
    priceMonthHigh=Math.max(priceMonthHigh,p);
    priceMonthLow=Math.min(priceMonthLow,p);

    updateChart(p);
  };
}
startWS();

/* BAR */
function renderBar(bar,line,v,o,l,h,up,down){
  if(!o||!h||!l||h===l) return;
  const r=Math.max(Math.abs(h-o),Math.abs(o-l),1e-9);
  const scaledLow = o - r;
  const scaledHigh = o + r;
  const p=clamp((v-scaledLow)/(scaledHigh-scaledLow)*100,0,100);
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

/* LOOP */
function animate(){
  const op=displayed.price;
  displayed.price=tick(displayed.price,targetPrice);
  colorNumber($("price"),displayed.price,op,4);

  const p24 = price24hOpen ? ((displayed.price-price24hOpen)/price24hOpen*100) : 0;
  const pW  = priceWeekOpen ? ((displayed.price-priceWeekOpen)/priceWeekOpen*100) : 0;
  const pM  = priceMonthOpen ? ((displayed.price-priceMonthOpen)/priceMonthOpen*100) : 0;

  updatePerf("arrow24h","pct24h",p24);
  updatePerf("arrowWeek","pctWeek",pW);
  updatePerf("arrowMonth","pctMonth",pM);

  renderBar($("priceBar"),$("priceLine"),displayed.price,price24hOpen,price24hLow,price24hHigh,
    "linear-gradient(to right,#22c55e,#10b981)",
    "linear-gradient(to left,#ef4444,#f87171)");

  renderBar($("weekBar"),$("weekLine"),displayed.price,priceWeekOpen,priceWeekLow,priceWeekHigh,
    "linear-gradient(to right,#f59e0b,#fbbf24)",
    "linear-gradient(to left,#f97316,#f87171)");

  renderBar($("monthBar"),$("monthLine"),displayed.price,priceMonthOpen,priceMonthLow,priceMonthHigh,
    "linear-gradient(to right,#8b5cf6,#c084fc)",
    "linear-gradient(to left,#6b21a8,#c084fc)");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);
  $("weekMin").textContent=priceWeekLow.toFixed(3);
  $("weekOpen").textContent=priceWeekOpen.toFixed(3);
  $("weekMax").textContent=priceWeekHigh.toFixed(3);
  $("monthMin").textContent=priceMonthLow.toFixed(3);
  $("monthOpen").textContent=priceMonthOpen.toFixed(3);
  $("monthMax").textContent=priceMonthHigh.toFixed(3);

  const oa=displayed.available;
  displayed.available=tick(displayed.available,availableInj);
  colorNumber($("available"),displayed.available,oa,6);
  $("availableUsd").textContent=`≈ $${(displayed.available*displayed.price).toFixed(2)}`;

  const os=displayed.stake;
  displayed.stake=tick(displayed.stake,stakeInj);
  colorNumber($("stake"),displayed.stake,os,4);
  $("stakeUsd").textContent=`≈ $${(displayed.stake*displayed.price).toFixed(2)}`;

  const or=displayed.rewards;
  if(rewardsInj < or) displayed.rewards = 0;
  else displayed.rewards = tick(displayed.rewards,rewardsInj);
  colorNumber($("rewards"),displayed.rewards,or,7);
  $("rewardsUsd").textContent=`≈ $${(displayed.rewards*displayed.price).toFixed(2)}`;

  const dynMax = Math.max(0.1, Math.ceil(displayed.rewards * 10) / 10 || 0.1);
  const rp = clamp((displayed.rewards / dynMax) * 100, 0, 100);
  $("rewardBar").style.width = rp + "%";
  $("rewardLine").style.left = rp + "%";
  $("rewardPercent").textContent = rp.toFixed(1) + "%";
  $("rewardBar").style.background = getHeatColor(rp);
  $("rewardMin").textContent = "0";
  $("rewardMax").textContent = dynMax.toFixed(1);

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
