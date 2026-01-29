let address = localStorage.getItem("inj_address") || "";

let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayedPrice=0, displayedAvailable=0, displayedStake=0, displayedRewards=0;
let targetPrice=0;

let prevPrice=0, prevAvailable=0, prevStake=0, prevRewards=0;
let price24hOpen=0, price24hLow=0, price24hHigh=0;

const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;

/* ===== number animation ===== */
function colorNumber(el,n,o,d){
  const ns=n.toFixed(d), os=o.toFixed(d);
  el.innerHTML=[...ns].map((c,i)=>{
    if(os[i]===undefined||c===os[i]) return `<span>${c}</span>`;
    return `<span style="color:${n>o?'#22c55e':'#ef4444'}">${c}</span>`;
  }).join("");
}

/* ===== address ===== */
$("addressInput").value=address;
$("addressInput").onchange=e=>{
  address=e.target.value.trim();
  localStorage.setItem("inj_address",address);
  loadAccount();
};

/* ===== API ===== */
async function fetchJSON(url){
  try{return await (await fetch(url)).json();}catch{return {};}
}

async function loadAccount(){
  if(!address) return;

  const [b,s,r,i]=await Promise.all([
    fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
  ]);

  availableInj=(b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
  stakeInj=(s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;

  const nr=(r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
  if(nr>rewardsInj) rewardsInj=nr;

  apr=Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount,2000);

/* ===== CHART ===== */
let chart, chartData=[];

async function fetchHistory(){
  const d=await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
  chartData=d.map(c=>+c[4]);
  price24hOpen=chartData[0];
  price24hLow=Math.min(...chartData);
  price24hHigh=Math.max(...chartData);
  targetPrice=chartData.at(-1);
  initChart();
}

function gradient(ctx,p){
  const g=ctx.createLinearGradient(0,0,0,ctx.canvas.height);
  g.addColorStop(0,p>=price24hOpen?"rgba(34,197,94,.25)":"rgba(239,68,68,.25)");
  g.addColorStop(1,"rgba(0,0,0,0)");
  return g;
}

function initChart(){
  const ctx=$("priceChart").getContext("2d");
  chart=new Chart(ctx,{
    type:"line",
    data:{labels:new Array(chartData.length).fill(""),
      datasets:[{data:chartData,pointRadius:0,borderWidth:2,tension:.25,fill:true,
        borderColor:"#22c55e",backgroundColor:gradient(ctx,chartData.at(-1))}]},
    options:{
      animation:false,responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        annotation:{
          drawTime:"afterDatasetsDraw",
          annotations:{
            ath:{type:"line",yMin:price24hHigh,yMax:price24hHigh,borderColor:"#facc15",
              label:{display:true,content:()=>`ATH ${price24hHigh.toFixed(3)}`,color:"#facc15",backgroundColor:"rgba(0,0,0,.6)",padding:4}},
            atl:{type:"line",yMin:price24hLow,yMax:price24hLow,borderColor:"#3b82f6",
              label:{display:true,content:()=>`ATL ${price24hLow.toFixed(3)}`,color:"#3b82f6",backgroundColor:"rgba(0,0,0,.6)",padding:4}}
          }
        }
      },
      scales:{x:{display:false},y:{ticks:{color:"#9ca3af"},grid:{color:"#1f2937"}}}
  });
}

fetchHistory();

/* ===== WS PRICE ===== */
let ws;
function startWS(){
  ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
  ws.onopen=()=>setConn(true);
  ws.onmessage=e=>{
    const p=+JSON.parse(e.data).p;
    targetPrice=p;
    chartData.push(p);
    if(chartData.length>1440) chartData.shift();

    price24hHigh=Math.max(...chartData);
    price24hLow=Math.min(...chartData);

    chart.data.datasets[0].data=chartData;
    chart.data.datasets[0].borderColor=p>=price24hOpen?"#22c55e":"#ef4444";
    chart.data.datasets[0].backgroundColor=gradient(chart.ctx,p);

    const a=chart.options.plugins.annotation.annotations;
    a.ath.yMin=a.ath.yMax=price24hHigh;
    a.atl.yMin=a.atl.yMax=price24hLow;

    chart.update("none");
  };
  ws.onclose=()=>{setConn(false);setTimeout(startWS,3000);}
}
startWS();

/* ===== UI ===== */
function setConn(on){
  $("connectionStatus").querySelector(".status-dot").style.background=on?"#22c55e":"#ef4444";
  $("connectionStatus").querySelector(".status-text").textContent=on?"Online":"Offline";
}

function updatePriceBar(){
  const o=price24hOpen,mn=price24hLow,mx=price24hHigh,p=displayedPrice;
  let pos=p>=o?50+((p-o)/(mx-o))*50:50-((o-p)/(o-mn))*50;
  pos=Math.max(0,Math.min(100,pos));
  $("priceLine").style.left=pos+"%";
  $("priceBar").style.left=Math.min(pos,50)+"%";
  $("priceBar").style.width=Math.abs(pos-50)+"%";
}

/* ===== LOOP ===== */
function animate(){
  displayedPrice=lerp(displayedPrice,targetPrice,.1);
  colorNumber($("price"),displayedPrice,prevPrice,4); prevPrice=displayedPrice;

  const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
  $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
  $("price24h").className="sub "+(d>0?"up":"down");

  $("priceMin").textContent=price24hLow.toFixed(3);
  $("priceOpen").textContent=price24hOpen.toFixed(3);
  $("priceMax").textContent=price24hHigh.toFixed(3);

  updatePriceBar();

  displayedAvailable=lerp(displayedAvailable,availableInj,.1);
  colorNumber($("available"),displayedAvailable,prevAvailable,6); prevAvailable=displayedAvailable;
  $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

  displayedStake=lerp(displayedStake,stakeInj,.1);
  colorNumber($("stake"),displayedStake,prevStake,4); prevStake=displayedStake;
  $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

  displayedRewards=lerp(displayedRewards,rewardsInj,.1);
  colorNumber($("rewards"),displayedRewards,prevRewards,7); prevRewards=displayedRewards;
  $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

  const perc=Math.min(displayedRewards/0.05*100,100);
  $("rewardBar").style.width=perc+"%";
  $("rewardPercent").textContent=perc.toFixed(1)+"%";

  $("apr").textContent=apr.toFixed(2)+"%";
  $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
