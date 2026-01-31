let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;

let availableInj = 0, displayedAvailable = 0;
let stakeInj = 0, displayedStake = 0;
let rewardsInj = 0, displayedRewards = 0;
let apr = 0;

let chart, chartData=[];

let ws;

const $ = id=>document.getElementById(id);

function colorNumber(el, n, o, decimals=4){
    const ns=n.toFixed(decimals), os=o.toFixed(decimals);
    el.innerHTML = [...ns].map((c,i)=>c!==os[i]?`<span style="color:${n>o?"#22c55e":"#ef4444"}">${c}</span>`:`<span style="color:#f9fafb">${c}</span>`).join('');
}

async function fetchJSON(url){
    try {return await (await fetch(url)).json();}
    catch{return {};}
}

$("addressInput").value=address;
$("addressInput").addEventListener("input",e=>{
    address=e.target.value.trim();
    localStorage.setItem("inj_address",address);
    loadAccount();
});

async function loadAccount(){
    if(!address) return;

    const [balances, staking, rewards, inflation] = await Promise.all([
        fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
        fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
    ]);

    availableInj=(balances.balances?.find(b=>b.denom==="inj")?.amount||0)/1e18;
    stakeInj=(staking.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
    rewardsInj=(rewards.rewards||[]).reduce((a,r)=>a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
    apr=Number(inflation.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,2000);

async function fetchHistory(){
    const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
    chartData=d.map(c=>+c[4]);
    price24hOpen=+d[0][1];
    price24hLow=Math.min(...chartData);
    price24hHigh=Math.max(...chartData);
    targetPrice=chartData.at(-1);
    if(!chart) initChart();
}

fetchHistory();

function initChart(){
    const ctx=$("priceChart").getContext("2d");
    chart=new Chart(ctx,{
        type:"line",
        data:{labels:Array(1440).fill(""), datasets:[{data:chartData,borderColor:"#22c55e",backgroundColor:"rgba(34,197,94,0.2)",fill:true,pointRadius:0,tension:0.3}]},
        options:{responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false,grid:{display:false}},y:{ticks:{color:"#9ca3af"}}}}
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
    ws.onclose=()=>{setConnectionStatus(false); setTimeout(startWS,3000);}
    ws.onerror=()=>setConnectionStatus(false);
}

startWS();

function smoothStep(current,target,speed=0.1){return current+(target-current)*speed;}

function updatePriceBar(){
    const range=price24hHigh-price24hLow;
    const openPerc=range?((price24hOpen-price24hLow)/range)*100:50;
    const pricePerc=range?((displayedPrice-price24hOpen)/range)*100:0;
    const bar=$("priceBar");
    const line=$("priceLine");

    if(displayedPrice>=price24hOpen){
        bar.style.left=openPerc+"%";
        bar.style.width=Math.min(pricePerc,100-openPerc)+"%";
        bar.style.background="#22c55e";
    } else {
        bar.style.left=Math.max(openPerc+pricePerc,0)+"%";
        bar.style.width=-pricePerc+"%";
        bar.style.background="#ef4444";
    }
    line.style.left=openPerc+"%";
}

function updateRewardBar(){
    const perc=Math.min(displayedRewards/0.1*100,100);
    $("rewardBar").style.width=perc+"%";
    $("rewardLine").style.left=perc+"%";
    $("rewardPercent").textContent=perc.toFixed(1)+"%";
    $("rewardBar").style.background=`linear-gradient(to right, #0ea5e9, #3b82f6, #ef4444)`;
}

function animate(){
    displayedPrice=smoothStep(displayedPrice,targetPrice,0.3);
    colorNumber($("price"),displayedPrice,displayedPrice,4);

    const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
    $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
    $("price24h").className="sub "+(d>0?"up":"down");

    $("priceMin").textContent=price24hLow.toFixed(3);
    $("priceOpen").textContent=price24hOpen.toFixed(3);
    $("priceMax").textContent=price24hHigh.toFixed(3);
    updatePriceBar();

    displayedAvailable=smoothStep(displayedAvailable,availableInj,0.2);
    colorNumber($("available"),displayedAvailable,displayedAvailable,6);
    $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

    displayedStake=smoothStep(displayedStake,stakeInj,0.2);
    colorNumber($("stake"),displayedStake,displayedStake,4);
    $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

    displayedRewards=smoothStep(displayedRewards,rewardsInj,0.2);
    colorNumber($("rewards"),displayedRewards,displayedRewards,7);
    $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
    updateRewardBar();

    $("apr").textContent=apr.toFixed(2)+"%";
    $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

    requestAnimationFrame(animate);
}

animate();
