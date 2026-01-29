const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

let targetPrice=0, displayedPrice=0, prevPrice=0;
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let dAvail=0, dStake=0, dRewards=0;
let pAvail=0, pStake=0, pRewards=0;

let price24hOpen=0, price24hLow=0, price24hHigh=0;
let chart, chartData=[];

/* ===== number coloring ===== */
function colorNumber(el,n,o,d){
  const ns=n.toFixed(d), os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>{
    if(os[i]===c) return `<span>${c}</span>`;
    return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
  }).join("");
}

/* ===== ACCOUNT ===== */
async function fetchJSON(url){
  try{return await (await fetch(url)).json();}catch{return {};}
}

async function loadAccount(){
  const addr=$("addressInput").value.trim();
  if(!addr) return;

  const [b,s,r,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${addr}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${addr}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${addr}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj=(b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
  rewardsInj=Math.max(rewardsInj,(r.rewards||[]).flatMap(x=>x.reward).reduce((a,x)=>a+Number(x.amount),0)/1e18);
  apr=Number(i.inflation||0)*100;
}

setInterval(loadAccount,2000);

/* ===== CHART ===== */
async function initChart(){
  const d=await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData=d.map(c=>+c[4]);

  price24hOpen=chartData[0];
  price24hLow=Math.min(...chartData);
  price24hHigh=Math.max(...chartData);
  targetPrice=chartData.at(-1);

  const ctx=$("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{
      labels:new Array(chartData.length).fill(""),
      datasets:[
        {
          data:chartData,
          borderWidth:2,
          pointRadius:0,
          tension:.25,
          fill:true,
          borderColor:"#22c55e",
          backgroundColor:"rgba(34,197,94,.2)"
        },
        { data:new Array(chartData.length).fill(price24hHigh), borderColor:"#facc15", borderWidth:1, pointRadius:0 },
        { data:new Array(chartData.length).fill(price24hLow),  borderColor:"#3b82f6", borderWidth:1, pointRadius:0 }
      ]
    },
    options:{
      responsive:true,
      animation:false,
      plugins:{legend:{display:false}},
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}
    }
  });
}
initChart();

/* ===== WS PRICE ===== */
const ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
ws.onmessage=e=>{
  targetPrice=+JSON.parse(e.data).p;
};

/* ===== LOOP ===== */
function animate(){
  displayedPrice=lerp(displayedPrice,targetPrice,.1);
  colorNumber($("price"),displayedPrice,prevPrice,4); prevPrice=displayedPrice;

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className=d>0?"up":"down";

  dAvail=lerp(dAvail,availableInj,.1);
  colorNumber($("available"),dAvail,pAvail,6); pAvail=dAvail;
  $("availableUsd").textContent=`≈ $${(dAvail*displayedPrice).toFixed(2)}`;

  dStake=lerp(dStake,stakeInj,.1);
  colorNumber($("stake"),dStake,pStake,4); pStake=dStake;
  $("stakeUsd").textContent=`≈ $${(dStake*displayedPrice).toFixed(2)}`;

  dRewards=lerp(dRewards,rewardsInj,.1);
  colorNumber($("rewards"),dRewards,pRewards,7); pRewards=dRewards;
  $("rewardsUsd").textContent=`≈ $${(dRewards*displayedPrice).toFixed(2)}`;

  const perc=Math.min(dRewards/.05*100,100);
  $("rewardBar").style.width=perc+"%";
  $("rewardPercent").textContent=perc.toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
