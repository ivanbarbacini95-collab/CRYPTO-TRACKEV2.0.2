// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";
let targetPrice = 0, displayedPrice = 0;
let price24hOpen=0, price24hLow=0, price24hHigh=0;
let priceWeekOpen=0, priceWeekLow=0, priceWeekHigh=0;
let priceMonthOpen=0, priceMonthLow=0, priceMonthHigh=0;
let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayed = {price:0, available:0, stake:0, rewards:0};
let chart, chartData=[], ws;

// ================= HELPERS =================
const $ = id => document.getElementById(id);

function colorNumber(el, n, o, decimals=4){
    if(n===o){ el.innerHTML=n.toFixed(decimals); return; }
    const ns=n.toFixed(decimals), os=o.toFixed(decimals);
    el.innerHTML=[...ns].map((c,i)=>{
        if(c!==os[i]) return `<span style="color:${n>o?"#22c55e":"#ef4444"}">${c}</span>`;
        return `<span style="color:#f9fafb">${c}</span>`;
    }).join('');
}

async function fetchJSON(url){ try{return await (await fetch(url)).json();}catch{return{};} }

// ================= ADDRESS INPUT =================
$("addressInput").value=address;
$("addressInput").addEventListener("input", e=>{
    address=e.target.value.trim();
    localStorage.setItem("inj_address", address);
    loadAccount();
});

// ================= ACCOUNT LOAD =================
async function loadAccount(){
    if(!address) return;
    const [balances, staking, rewardsData, inflation]=await Promise.all([
        fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
        fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
    ]);
    availableInj=(balances.balances?.find(b=>b.denom==="inj")?.amount||0)/1e18;
    stakeInj=(staking.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
    rewardsInj=(rewardsData.rewards||[]).reduce((a,r)=>a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
    apr=Number(inflation.inflation||0)*100;
}

loadAccount();
setInterval(loadAccount,2000);

// ================= PRICE HISTORY =================
async function fetchHistory(){
    const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
    chartData=d.map(c=>+c[4]);
    price24hOpen=+d[0][1];
    price24hLow=Math.min(...chartData);
    price24hHigh=Math.max(...chartData);
    priceWeekOpen=chartData[0]; priceWeekLow=Math.min(...chartData); priceWeekHigh=Math.max(...chartData);
    priceMonthOpen=chartData[0]; priceMonthLow=Math.min(...chartData); priceMonthHigh=Math.max(...chartData);
    targetPrice=chartData.at(-1);
    if(!chart) initChart();
}
fetchHistory();

// ================= CHART =================
function initChart(){
    const ctx=$("priceChart").getContext("2d");
    chart=new Chart(ctx,{
        type:"line",
        data:{labels:Array(1440).fill(""), datasets:[{
            data: chartData,
            borderColor:"#22c55e",
            backgroundColor:"rgba(34,197,94,0.2)",
            fill:true,
            pointRadius:0,
            tension:0.3
        }]},
        options:{
            responsive:true, maintainAspectRatio:false, animation:false,
            plugins:{legend:{display:false}},
            scales:{
                x:{ display:false, grid:{display:false} },
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

// ================= WEBSOCKET =================
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

// ================= BAR UPDATE =================
function updateBar(barEl, lineEl, val, open, low, high, gradUp, gradDown){
    let leftPercent;
    if(val>=open){
        leftPercent=50;
        const widthPerc=((val-open)/(high-open))*50;
        barEl.style.left="50%"; barEl.style.width=widthPerc+"%"; barEl.style.background=gradUp;
    } else {
        leftPercent=50-((open-val)/(open-low))*50;
        barEl.style.left=leftPercent+"%"; barEl.style.width=(50-leftPercent)+"%"; barEl.style.background=gradDown;
    }
    lineEl.style.left=((val-low)/(high-low))*100+"%";
}

// ================= ANIMATION LOOP =================
function animate(){
    // -------- PRICE -----------
    if(displayed.price!==targetPrice){
        const old=displayed.price;
        displayed.price += (targetPrice-old)*0.5;
        if(Math.abs(displayed.price-targetPrice)<1e-6) displayed.price=targetPrice;
        colorNumber($("price"), displayed.price, old,4);

        const d24h=(displayed.price-price24hOpen)/price24hOpen*100;
        $("price24h").textContent=`${d24h>0?"▲":"▼"} ${Math.abs(d24h).toFixed(2)}%`;
        $("price24h").className="sub-row "+(d24h>0?"up":"down");

        const dWeek=(displayed.price-priceWeekOpen)/priceWeekOpen*100;
        $("priceWeek").textContent=`${dWeek>0?"▲":"▼"} ${Math.abs(dWeek).toFixed(2)}%`;
        $("priceWeek").className="sub-row "+(dWeek>0?"up":"down");

        const dMonth=(displayed.price-priceMonthOpen)/priceMonthOpen*100;
        $("priceMonth").textContent=`${dMonth>0?"▲":"▼"} ${Math.abs(dMonth).toFixed(2)}%`;
        $("priceMonth").className="sub-row "+(dMonth>0?"up":"down");

        // Update bars
        updateBar($("priceBar"), $("priceLine"), displayed.price, price24hOpen, price24hLow, price24hHigh, "linear-gradient(to right,#22c55e,#10b981)", "linear-gradient(to left,#ef4444,#f87171)");
        $("priceMin").textContent=price24hLow.toFixed(3);
        $("priceOpen").textContent=price24hOpen.toFixed(3);
        $("priceMax").textContent=price24hHigh.toFixed(3);

        updateBar($("weekBar"), $("weekLine"), displayed.price, priceWeekOpen, priceWeekLow, priceWeekHigh, "linear-gradient(to right,#f59e0b,#fbbf24)", "linear-gradient(to left,#f97316,#f87171)");
        $("weekMin").textContent=priceWeekLow.toFixed(3);
        $("weekOpen").textContent=priceWeekOpen.toFixed(3);
        $("weekMax").textContent=priceWeekHigh.toFixed(3);

        updateBar($("monthBar"), $("monthLine"), displayed.price, priceMonthOpen, priceMonthLow, priceMonthHigh, "linear-gradient(to right,#8b5cf6,#c084fc)", "linear-gradient(to left,#6b21a8,#c084fc)");
        $("monthMin").textContent=priceMonthLow.toFixed(3);
        $("monthOpen").textContent=priceMonthOpen.toFixed(3);
        $("monthMax").textContent=priceMonthHigh.toFixed(3);
    }

    // -------- AVAILABLE --------
    if(displayed.available!==availableInj){
        const old=displayed.available;
        displayed.available += (availableInj-old)*0.5;
        if(Math.abs(displayed.available-availableInj)<1e-6) displayed.available=availableInj;
        colorNumber($("available"), displayed.available, old,6);
        $("availableUsd").textContent=`≈ $${(displayed.available*displayed.price).toFixed(2)}`;
    }

    // -------- STAKE --------
    if(displayed.stake!==stakeInj){
        const old=displayed.stake;
        displayed.stake += (stakeInj-old)*0.5;
        if(Math.abs(displayed.stake-stakeInj)<1e-6) displayed.stake=stakeInj;
        colorNumber($("stake"), displayed.stake, old,4);
        $("stakeUsd").textContent=`≈ $${(displayed.stake*displayed.price).toFixed(2)}`;
    }

    // -------- REWARDS --------
    if(displayed.rewards!==rewardsInj){
        const old=displayed.rewards;
        displayed.rewards += (rewardsInj-old)*0.5;
        if(Math.abs(displayed.rewards-rewardsInj)<1e-8) displayed.rewards=rewardsInj;
        colorNumber($("rewards"), displayed.rewards, old,7);
        $("rewardsUsd").textContent=`≈ $${(displayed.rewards*displayed.price).toFixed(2)}`;

        const maxReward=0.1;
        const perc=Math.min(displayed.rewards/maxReward,1)*100;
        $("rewardBar").style.width=perc+"%";
        $("rewardLine").style.left=perc+"%";
        $("rewardPercent").textContent=perc.toFixed(1)+"%";
        $("rewardBar").style.background="linear-gradient(to right,#22c55e,#10b981)";
    }

    // -------- APR --------
    $("apr").textContent=apr.toFixed(2)+"%";

    $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

    requestAnimationFrame(animate);
}

animate();
