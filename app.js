let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, displayedAvailable = 0;
let stakeInj = 0, displayedStake = 0;
let rewardsInj = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData = [];
let ws;

const $ = id=>document.getElementById(id);

function colorNumber(el,n,o,decimals=4){
  if(n===o){el.innerHTML=n.toFixed(decimals); return;}
  const ns=n.toFixed(decimals), os=o.toFixed(decimals);
  el.innerHTML=[...ns].map((c,i)=>c!==os[i]?`<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`:`<span style="color:#f9fafb">${c}</span>`).join('');
}

async function fetchJSON(url){try{return await (await fetch(url)).json();}catch{return{};}}

$("addressInput").value=address;
$("addressInput").addEventListener("input", e=>{
  address = e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
});

async function loadAccount(){
  if(!address) return;

  const [balances,staking,rewards,inflation]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj = (balances.balances?.find(b=>b.denom==="inj")?.amount||0)/1e18;
  stakeInj = (staking.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
  rewardsInj = (rewards.rewards||[]).reduce((a,r)=>a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  apr = Number(inflation.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,2000); // refresh reward velocemente

async function fetchHistory(){
  const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData=d.map(c=>+c[4]);
  price24hOpen=+d[0][1];
  price24hLow=Math.min(...chartData);
  price24hHigh=Math.max(...chartData);
  targetPrice=chartData.at(-1);
  if(!chart)initChart();
}

fetchHistory();

function initChart(){
  const ctx=$("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{labels:Array(1440).fill(""),datasets:[{data:chartData,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,0.2)",fill:true,pointRadius:0,tension:0.3}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{display:false,grid:{display:false}},y:{ticks:{color:"#9ca3af"}}}}
  });
}

function updateChart(price){
  if(!chart) return;
  chart.data.datasets[0].data.push(price);
  chart.data.datasets[0].data.shift();
  chart.update("none");
}

function setConnectionStatus(online){
  $("connectionStatus").querySelector(".status-dot").style.background=online?"#22c55e":"#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent=online?"Online":"Offline";
}

function startWS(){
  if(ws) ws.close();
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen=()=>setConnectionStatus(true);
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    price24hHigh=Math.max(price24hHigh,p);
    price24hLow=Math.min(price24hLow,p);
    updateChart(p);
  };
  ws.onclose=()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
  ws.onerror=()=>setConnectionStatus(false);
}

startWS();

function animate(){
  // PRICE
  if(displayedPrice!==targetPrice){
    const old=displayedPrice;
    displayedPrice += (targetPrice-displayedPrice)*0.25; // animazione fluida
    colorNumber($("price"), displayedPrice, old,4);

    const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
    $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
    $("price24h").className="sub "+(d>0?"up":"down");

    $("priceMin").textContent=price24hLow.toFixed(3);
    $("priceOpen").textContent=price24hOpen.toFixed(3);
    $("priceMax").textContent=price24hHigh.toFixed(3);

    // BAR PRICE dal centro
    const barContainer=$("priceBar").parentElement;
    const mid=50; // centro
    let perc=Math.abs((displayedPrice-price24hOpen)/(price24hHigh-price24hLow)*100);
    perc=Math.min(perc,50); // max metà barra per lato
    if(displayedPrice>=price24hOpen){
      $("priceBar").style.left=`${mid}%`;
      $("priceBar").style.width=`${perc}%`;
      $("priceBar").style.background="linear-gradient(to right, #22c55e, #3b82f6)";
      $("priceLine").style.left=`${mid+perc}%`;
    }else{
      $("priceBar").style.left=`${mid-perc}%`;
      $("priceBar").style.width=`${perc}%`;
      $("priceBar").style.background="linear-gradient(to left, #ef4444, #f87171)";
      $("priceLine").style.left=`${mid-perc}%`;
    }
  }

  // AVAILABLE
  if(displayedAvailable!==availableInj){
    const old=displayedAvailable;
    displayedAvailable += (availableInj-displayedAvailable)*0.25;
    colorNumber($("available"), displayedAvailable, old,6);
    $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;
  }

  // STAKE
  if(displayedStake!==stakeInj){
    const old=displayedStake;
    displayedStake += (stakeInj-displayedStake)*0.25;
    colorNumber($("stake"), displayedStake, old,4);
    $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;
  }

  // REWARDS
  if(displayedRewards!==rewardsInj){
    const old=displayedRewards;
    displayedRewards += (rewardsInj-displayedRewards)*0.25;
    colorNumber($("rewards"), displayedRewards, old,7);
    $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

    const perc=Math.min(displayedRewards/0.1,1);
    $("rewardBar").style.width=`${perc*100}%`;
    $("rewardBar").style.background="linear-gradient(to right, #22c55e, #3b82f6)";
    $("rewardLine").style.left=`${perc*100}%`;
    $("rewardPercent").textContent=`${(perc*100).toFixed(1)}%`;
  }

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
