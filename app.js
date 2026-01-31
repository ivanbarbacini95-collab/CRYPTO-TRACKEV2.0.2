// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";
let price24hOpen=0, price24hLow=0, price24hHigh=0;
let priceWeekOpen=0, priceWeekLow=0, priceWeekHigh=0;
let priceMonthOpen=0, priceMonthLow=0, priceMonthHigh=0;
let targetPrice=0, chart, chartData=[], ws;

let availableInj=0, stakeInj=0, rewardsInj=0, apr=0;
let displayed={price:0, available:0, stake:0, rewards:0};

// ================= HELPERS =================
const $ = id => document.getElementById(id);

function colorNumber(el, curr, prev, d=4){
    const s1 = curr.toFixed(d), s2 = prev.toFixed(d);
    let html = "";
    for(let i=0;i<s1.length;i++){
        html+=`<span style="color:${s1[i]===s2[i]?'#f9fafb':curr>prev?'#22c55e':'#ef4444'}">${s1[i]}</span>`;
    }
    el.innerHTML=html;
}

async function fetchJSON(url){
    try { return await (await fetch(url)).json(); }
    catch{return{};}
}

// ================= ADDRESS INPUT =================
$("addressInput").value = address;
$("addressInput").addEventListener("input", e=>{
    address = e.target.value.trim();
    localStorage.setItem("inj_address", address);
    loadAccount();
});

// ================= ACCOUNT LOAD =================
async function loadAccount(){
    if(!address) return;
    const [balances, staking, rewardsData, inflation] = await Promise.all([
        fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
        fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
    ]);

    availableInj = (balances.balances?.find(b=>b.denom==="inj")?.amount||0)/1e18;
    stakeInj = (staking.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
    rewardsInj = (rewardsData.rewards||[]).reduce((a,r)=> a+r.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
    apr = Number(inflation.inflation||0)*100;
}

loadAccount(); setInterval(loadAccount,2000);

// ================= PRICE HISTORY =================
async function fetchHistory(){
    const d24h = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
    const dWeek = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=168");
    const dMonth = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1d&limit=30");

    chartData = d24h.map(c=>+c[4]);
    price24hOpen = +d24h[0][1];
    price24hLow = Math.min(...chartData);
    price24hHigh = Math.max(...chartData);
    targetPrice = chartData.at(-1);

    priceWeekOpen = +dWeek[0][1];
    priceWeekLow = Math.min(...dWeek.map(c=>+c[4]));
    priceWeekHigh = Math.max(...dWeek.map(c=>+c[4]));

    priceMonthOpen = +dMonth[0][1];
    priceMonthLow = Math.min(...dMonth.map(c=>+c[4]));
    priceMonthHigh = Math.max(...dMonth.map(c=>+c[4]));

    if(!chart){
        const ctx = $("priceChart").getContext("2d");
        chart = new Chart(ctx,{
            type:"line",
            data:{labels:Array(1440).fill(""), datasets:[{data:chartData, borderColor:"#22c55e", backgroundColor:"rgba(34,197,94,0.2)", fill:true, pointRadius:0, tension:0.3}]},
            options:{responsive:true, maintainAspectRatio:false, animation:false, plugins:{legend:{display:false}}, scales:{x:{display:false, grid:{display:false}}, y:{ticks:{color:"#9ca3af"}}}}
        });
    }
}

fetchHistory();

// ================= WEBSOCKET =================
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
        chart.data.datasets[0].data.push(p);
        chart.data.datasets[0].data.shift();
        chart.update("none");
    };
    ws.onclose = ()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
    ws.onerror = ()=>setConnectionStatus(false);
}
startWS();

// ================= ANIMATION =================
function updateValue(el,val,key,d){
    let old=displayed[key];
    if(old!==val){
        displayed[key]+=(val-old)*0.3;
        if(Math.abs(displayed[key]-val)<1e-8) displayed[key]=val;
        colorNumber(el,displayed[key],old,d);
    }
}

function updateBar(barEl,lineEl,val,open,low,high,colorUp,colorDown){
    const range = high-low;
    const perc = ((val-low)/range)*100;
    lineEl.style.left = perc+"%";
    if(val>=open){ barEl.style.left="50%"; barEl.style.width=(perc-50)+"%"; barEl.style.background=colorUp; }
    else { barEl.style.left=perc+"%"; barEl.style.width=(50-perc)+"%"; barEl.style.background=colorDown; }
}

function animate(){
    updateValue($("price"), targetPrice,"price",4);
    updateValue($("available"), availableInj,"available",6); $("availableUsd").textContent=`≈ $${(displayed.available*displayed.price).toFixed(2)}`;
    updateValue($("stake"), stakeInj,"stake",4); $("stakeUsd").textContent=`≈ $${(displayed.stake*displayed.price).toFixed(2)}`;
    updateValue($("rewards"), rewardsInj,"rewards",7); $("rewardsUsd").textContent=`≈ $${(displayed.rewards*displayed.price).toFixed(2)}`;
    $("apr").textContent=apr.toFixed(2)+"%";

    // 24h
    updateBar($("priceBar"), $("priceLine"), displayed.price, price24hOpen, price24hLow, price24hHigh, "linear-gradient(to right,#22c55e,#10b981)", "linear-gradient(to left,#ef4444,#f87171)");
    $("priceMin").textContent=price24hLow.toFixed(3);
    $("priceOpen").textContent=price24hOpen.toFixed(3);
    $("priceMax").textContent=price24hHigh.toFixed(3);
    const d24h = (displayed.price-price24hOpen)/price24hOpen*100;
    $("price24h").textContent=`${d24h>0?"▲":"▼"} ${Math.abs(d24h).toFixed(2)}%`;
    $("price24h").className="sub-row "+(d24h>0?"up":"down");

    // Weekly
    updateBar($("weekBar"), $("weekLine"), displayed.price, priceWeekOpen, priceWeekLow, priceWeekHigh, "linear-gradient(to right,#f59e0b,#fbbf24)", "linear-gradient(to left,#f97316,#f87171)");
    $("weekMin").textContent=priceWeekLow.toFixed(3);
    $("weekOpen").textContent=priceWeekOpen.toFixed(3);
    $("weekMax").textContent=priceWeekHigh.toFixed(3);
    const dWeek = (displayed.price-priceWeekOpen)/priceWeekOpen*100;
    $("priceWeek").textContent=`${dWeek>0?"▲":"▼"} ${Math.abs(dWeek).toFixed(2)}%`;
    $("priceWeek").className="sub-row "+(dWeek>0?"up":"down");

    // Monthly
    updateBar($("monthBar"), $("monthLine"), displayed.price, priceMonthOpen, priceMonthLow, priceMonthHigh, "linear-gradient(to right,#8b5cf6,#c084fc)", "linear-gradient(to left,#6b21a8,#c084fc)");
    $("monthMin").textContent=priceMonthLow.toFixed(3);
    $("monthOpen").textContent=priceMonthOpen.toFixed(3);
    $("monthMax").textContent=priceMonthHigh.toFixed(3);
    const dMonth = (displayed.price-priceMonthOpen)/priceMonthOpen*100;
    $("priceMonth").textContent=`${dMonth>0?"▲":"▼"} ${Math.abs(dMonth).toFixed(2)}%`;
    $("priceMonth").className="sub-row "+(dMonth>0?"up":"down");

    $("updated").textContent="Last update: "+new Date().toLocaleTimeString();
    requestAnimationFrame(animate);
}

animate();
