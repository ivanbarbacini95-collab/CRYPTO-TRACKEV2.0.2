/* =======================
   STATE
======================= */

let address = localStorage.getItem("inj_address") || "";

let targetPrice = 0;
let displayedPrice = 0;

let price24hOpen = 0;
let price24hLow = 0;
let price24hHigh = 0;

let availableInj = 0;
let stakeInj = 0;
let rewardsInj = 0;
let apr = 0;

let displayedAvailable = 0;
let displayedStake = 0;
let displayedRewards = 0;

let chart, chartData = [];
let ws;

/* =======================
   HELPERS
======================= */

const $ = id => document.getElementById(id);

function colorNumber(el, n, o, decimals = 4) {
    if(n === o){
        el.innerHTML = n.toFixed(decimals);
        return;
    }
    const ns = n.toFixed(decimals);
    const os = o.toFixed(decimals);

    el.innerHTML = [...ns].map((c,i)=>{
        if(c!==os[i]){
            return `<span style="color:${n>o?"#22c55e":"#ef4444"}">${c}</span>`;
        }
        return `<span style="color:#f9fafb">${c}</span>`;
    }).join('');
}

async function fetchJSON(url){
    try { return await (await fetch(url)).json(); }
    catch { return {}; }
}

/* =======================
   ADDRESS INPUT
======================= */

$("addressInput").value = address;

$("addressInput").addEventListener("input", e=>{
    address = e.target.value.trim();
    localStorage.setItem("inj_address", address);
    loadAccount();
});

/* =======================
   ACCOUNT LOAD
======================= */

async function loadAccount() {
    if(!address) return;

    const [balances, staking, rewards, inflation] = await Promise.all([
        fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
        fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
    ]);

    availableInj = (balances.balances?.find(b=>b.denom==="inj")?.amount||0)/1e18;

    stakeInj = (staking.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;

    rewardsInj = (rewards.rewards||[]).reduce((a,r)=> a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;

    apr = Number(inflation.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount, 60000);

/* =======================
   PRICE HISTORY
======================= */

async function fetchHistory() {
    const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
    chartData = d.map(c=>+c[4]);
    price24hOpen = +d[0][1];
    price24hLow = Math.min(...chartData);
    price24hHigh = Math.max(...chartData);
    targetPrice = chartData.at(-1);
    if(!chart) initChart();
}

fetchHistory();

/* =======================
   CHART
======================= */

function initChart() {
    const ctx = $("priceChart").getContext("2d");

    chart = new Chart(ctx,{
        type:"line",
        data:{
            labels:Array(1440).fill(""),
            datasets:[{
                data: chartData,
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
            animation:false,
            plugins:{legend:{display:false}},
            scales:{
                x:{ display:false, grid:{display:false} }, // <-- nessun numero sotto
                y:{ ticks:{color:"#9ca3af"} }
            }
        }
    });
}

function updateChart(price){
    if(!chart) return;
    chart.data.datasets[0].data.push(price);
    chart.data.datasets[0].data.shift();
    chart.update("none");
}

/* =======================
   WEBSOCKET
======================= */

function setConnectionStatus(online){
    $("connectionStatus").querySelector(".status-dot").style.background = online?"#22c55e":"#ef4444";
    $("connectionStatus").querySelector(".status-text").textContent = online?"Online":"Offline";
}

function startWS(){
    if(ws) ws.close();

    ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

    ws.onopen = ()=>setConnectionStatus(true);

    ws.onmessage = e=>{
        const p = +JSON.parse(e.data).p;
        targetPrice = p;
        price24hHigh = Math.max(price24hHigh,p);
        price24hLow = Math.min(price24hLow,p);
        updateChart(p);
    };

    ws.onclose = ()=>{
        setConnectionStatus(false);
        setTimeout(startWS,3000);
    };

    ws.onerror = ()=>setConnectionStatus(false);
}

startWS();

/* =======================
   ANIMATION LOOP
======================= */

function animate() {
    /* -------- PRICE -------- */
    if(displayedPrice!==targetPrice){
        const old = displayedPrice;
        displayedPrice = targetPrice;
        colorNumber($("price"), displayedPrice, old,4);

        const d = ((displayedPrice-price24hOpen)/price24hOpen)*100;
        $("price24h").textContent = `${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
        $("price24h").className = "sub "+(d>0?"up":"down");

        $("priceMin").textContent = price24hLow.toFixed(3);
        $("priceOpen").textContent = price24hOpen.toFixed(3);
        $("priceMax").textContent = price24hHigh.toFixed(3);

        // BAR PREZZO
        const range = price24hHigh - price24hLow;
        const barPerc = range ? ((displayedPrice-price24hLow)/range)*100 : 0;
        const lineLeft = range ? ((price24hOpen-price24hLow)/range)*100 : 50;

        $("priceBar").style.width = barPerc+"%";
        $("priceBar").style.background = displayedPrice>=price24hOpen?"#22c55e":"#ef4444";

        $("priceLine").style.left = lineLeft+"%";
    }

    /* -------- AVAILABLE -------- */
    if(displayedAvailable!==availableInj){
        const old = displayedAvailable;
        displayedAvailable = availableInj;
        colorNumber($("available"), displayedAvailable, old,6);
        $("availableUsd").textContent = `≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;
    }

    /* -------- STAKE -------- */
    if(displayedStake!==stakeInj){
        const old = displayedStake;
        displayedStake = stakeInj;
        colorNumber($("stake"), displayedStake, old,4);
        $("stakeUsd").textContent = `≈ $${(displayedStake*displayedPrice).toFixed(2)}`;
    }

    /* -------- REWARDS -------- */
    if(displayedRewards!==rewardsInj){
        const old = displayedRewards;
        displayedRewards = rewardsInj;
        colorNumber($("rewards"), displayedRewards, old,7);

        $("rewardsUsd").textContent = `≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;

        const rewardPerc = Math.min(displayedRewards/0.1*100,100);
        $("rewardBar").style.width = rewardPerc+"%";
        $("rewardPercent").textContent = rewardPerc.toFixed(1)+"%";
    }

    /* -------- APR -------- */
    $("apr").textContent = apr.toFixed(2)+"%";

    /* -------- LAST UPDATE -------- */
    $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

    requestAnimationFrame(animate);
}

animate();
