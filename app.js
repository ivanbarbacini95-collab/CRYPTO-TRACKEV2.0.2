/* =======================
   STATE
======================= */
let address = localStorage.getItem("inj_address") || "";
let targetPrice=0, displayedPrice=0;
let price24hOpen=0, price24hLow=0, price24hHigh=0;
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedAvailable=0, displayedStake=0, displayedRewards=0;
let chart, chartData=[], ws;

/* =======================
   HELPERS
======================= */
const $=id=>document.getElementById(id);

function clamp(n,min=0,max=100){return Math.min(Math.max(n,min),max);}
function colorNumber(el,n,o,d=4){
  const ns=n.toFixed(d), os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>
    `<span style="color:${c!==os[i]?(n>o?"#22c55e":"#ef4444"):"#f9fafb"}">${c}</span>`
  ).join("");
}
function smartSmooth(c,t){
  const diff=Math.abs(t-c);
  if(diff>5) return t;
  if(diff>1) return c+(t-c)*0.5;
  if(diff>0.1) return c+(t-c)*0.3;
  return c+(t-c)*0.15;
}
function rewardColor(p){
  if(p<30) return "#38bdf8";
  if(p<60) return "#6366f1";
  if(p<85) return "#a855f7";
  return "#ef4444";
}
async function fetchJSON(url){
  try{return await (await fetch(url)).json();}catch{return {};}
}

/* =======================
   ADDRESS
======================= */
$("addressInput").value=address;
$("addressInput").addEventListener("input",e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
});

/* =======================
   ACCOUNT
======================= */
async function loadAccount(){
  if(!address.startsWith("inj")) return;
  const [b,s,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);
  availableInj=(b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
  apr=Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount,60000);

/* =======================
   REWARDS
======================= */
async function loadRewards(){
  if(!address.startsWith("inj")) return;
  const r=await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
  rewardsInj=(r.rewards||[]).reduce((a,x)=>a+x.reward.reduce((s,y)=>s+Number(y.amount),0),0)/1e18;
}
loadRewards();
setInterval(loadRewards,2000);

/* =======================
   PRICE HISTORY + WS
======================= */
async function fetchHistory(){
  const d=await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData=d.map(x=>+x[4]);
  price24hOpen=+d[0][1];
  price24hLow=Math.min(...chartData);
  price24hHigh=Math.max(...chartData);
  targetPrice=chartData.at(-1);
  displayedPrice=targetPrice;
  if(!chart) initChart();
}
fetchHistory();

function initChart(){
  chart=new Chart($("priceChart"),{
    type:"line",
    data:{labels:Array(1440).fill(""),datasets:[{
      data:chartData,
      borderColor:"#22c55e",
      backgroundColor:"rgba(34,197,94,.2)",
      fill:true,pointRadius:0,tension:.3
    }]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false}},
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}}
  });
}

function updateChart(p){
  chart.data.datasets[0].data.push(p);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

function startWS(){
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose=()=>setTimeout(startWS,3000);
}
startWS();

/* =======================
   MAIN LOOP
======================= */
setInterval(()=>{
  /* PRICE */
  const oldP=displayedPrice;
  displayedPrice=smartSmooth(displayedPrice,targetPrice);
  colorNumber($("price"),displayedPrice,oldP,4);

  /* AVAILABLE / STAKE / REWARDS */
  displayedAvailable=smartSmooth(displayedAvailable,availableInj);
  displayedStake=smartSmooth(displayedStake,stakeInj);
  displayedRewards=smartSmooth(displayedRewards,rewardsInj);

  colorNumber($("available"),displayedAvailable,displayedAvailable-0.0001,6);
  colorNumber($("stake"),displayedStake,displayedStake-0.0001,4);
  colorNumber($("rewards"),displayedRewards,displayedRewards-0.0001,7);

  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  /* REWARD BAR */
  const perc=clamp((displayedRewards/0.1)*100);
  $("rewardLine").style.left=perc+"%";
  $("rewardBar").style.width=perc+"%";
  $("rewardBar").style.background=rewardColor(perc);

  /* PRICE BAR */
  const range=price24hHigh-price24hLow;
  const barPerc=range?(displayedPrice-price24hLow)/range*100:0;
  const linePerc=range?(price24hOpen-price24hLow)/range*100:50;
  $("priceBar").style.width=barPerc+"%";
  $("priceBar").style.background=displayedPrice>=price24hOpen?"#22c55e":"#ef4444";
  $("priceLine").style.left=linePerc+"%";

  /* 24H % */
  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();
},120);
