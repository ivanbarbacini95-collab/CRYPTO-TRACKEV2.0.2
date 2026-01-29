// ========================
// UTILITY
// ========================
const $ = id => document.getElementById(id);
const lerp = (a,b,f)=>a+(b-a)*f;
const formatNumber = (n, d=2) => n.toFixed(d);

// Colorazione cifre con effetto flash
function colorNumber(el, n, o, d, marketOpen=true){
    if(!marketOpen){
        el.textContent = n.toFixed(d);
        return;
    }
    const ns = n.toFixed(d);
    const os = o.toFixed(d);
    el.innerHTML = [...ns].map((c,i)=>{
        if(c !== os[i]){
            const color = n>o ? '#22c55e' : '#ef4444';
            return `<span style="color:${color}">${c}</span>`;
        } else {
            return `<span style="color:#f9fafb">${c}</span>`;
        }
    }).join("");
}

// ========================
// ACCOUNT INJ
// ========================
let address = localStorage.getItem("inj_address") || "";
let targetPrice = 0, displayedPrice = 0;
let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let availableInj=0, stakeInj=0, rewardsInj=0;
let displayedAvailable=0, displayedStake=0, displayedRewards=0;
let apr=0;

$("addressInput").value = address;
$("addressInput").onchange = e=>{
    address=e.target.value.trim();
    localStorage.setItem("inj_address",address);
    loadAccount();
};

async function fetchJSON(url){
    try{ return await (await fetch(url)).json(); }
    catch{ return {}; }
}

async function loadAccount(){
    if(!address) return;
    const [b,s,r,i] = await Promise.all([
        fetchJSON(`https://lcd.injective.network/cosmos/bank/v1beta1/balances/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/staking/v1beta1/delegations/${address}`),
        fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
        fetchJSON(`https://lcd.injective.network/cosmos/mint/v1beta1/inflation`)
    ]);
    availableInj = (b.balances?.find(x=>x.denom==="inj")?.amount||0)/1e18;
    stakeInj = (s.delegation_responses||[]).reduce((a,d)=>a+Number(d.balance.amount),0)/1e18;
    const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
    if(newRewards>rewardsInj) rewardsInj=newRewards;
    apr = Number(i.inflation||0)*100;
}
loadAccount();
setInterval(loadAccount,60000);
setInterval(async ()=>{
    if(!address) return;
    const r = await fetchJSON(`https://lcd.injective.network/cosmos/distribution/v1beta1/delegators/${address}/rewards`);
    const newRewards = (r.rewards||[]).reduce((a,v)=>a+v.reward.reduce((s,x)=>s+Number(x.amount),0),0)/1e18;
    if(newRewards>rewardsInj) rewardsInj=newRewards;
},2000);

// ========================
// PRICE CHART INJ
// ========================
let chart, chartData=[];
async function fetchHistory(){
    const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1h&limit=24");
    chartData = d.map(c=>+c[4]);
    price24hOpen = +d[0][1];
    price24hLow = Math.min(...chartData);
    price24hHigh = Math.max(...chartData);
    targetPrice = chartData.at(-1);
    if(!chart) initChart();
}
fetchHistory();

function initChart(){
    const ctx=$("priceChart").getContext("2d");
    chart=new Chart(ctx,{
        type:"line",
        data:{labels:Array(chartData.length).fill(""),datasets:[{
            data:chartData,
            borderColor:"#22c55e",
            backgroundColor:"rgba(34,197,94,0.2)",
            fill:true,
            pointRadius:0,
            tension:0.3
        }]},
        options:{
            responsive:true,
            maintainAspectRatio:false,
            animation:false,
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

// ========================
// CONNECTION STATUS & WS
// ========================
const connectionStatus = $("connectionStatus");
const statusDot = connectionStatus.querySelector(".status-dot");
const statusText = connectionStatus.querySelector(".status-text");

function setConnectionStatus(online){
    if(online){
        statusDot.style.background="#22c55e";
        statusText.textContent="Online";
    } else {
        statusDot.style.background="#ef4444";
        statusText.textContent="Offline";
    }
}
setConnectionStatus(false);

let ws;
function startWS(){
    if(ws) ws.close?.();
    ws=new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");
    ws.onopen = ()=>setConnectionStatus(true);
    ws.onmessage = e=>{
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

// ========================
// PRICE BAR UPDATE
// ========================
function updatePriceBar(){
    const min=price24hLow,max=price24hHigh,open=price24hOpen,price=displayedPrice;
    let linePercent;
    if(price>=open) linePercent=50+((price-open)/(max-open))*50;
    else linePercent=50-((open-price)/(open-min))*50;
    linePercent=Math.max(0,Math.min(100,linePercent));
    $("priceLine").style.left=linePercent+"%";
    $("priceBar").style.background = price>=open ? "linear-gradient(to right,#22c55e,#10b981)" : "linear-gradient(to right,#ef4444,#f87171)";
    let barWidth,barLeft;
    if(price>=open){ barLeft=50; barWidth=linePercent-50; }
    else{ barLeft=linePercent; barWidth=50-linePercent; }
    $("priceBar").style.left=barLeft+"%";
    $("priceBar").style.width=barWidth+"%";
}

// ========================
// INDICI GLOBALI
// ========================
const indices = [
    {name:"S&P 500", symbol:"^GSPC", tz:"America/New_York", open:14, close:21},
    {name:"NASDAQ", symbol:"^IXIC", tz:"America/New_York", open:14, close:21},
    {name:"DOW JONES", symbol:"^DJI", tz:"America/New_York", open:14, close:21},
    {name:"FTSE 100", symbol:"^FTSE", tz:"Europe/London", open:8, close:16},
    {name:"DAX", symbol:"^GDAXI", tz:"Europe/Berlin", open:8, close:16},
    {name:"NIKKEI 225", symbol:"^N225", tz:"Asia/Tokyo", open:0, close:6},
    {name:"HANG SENG", symbol:"^HSI", tz:"Asia/Hong_Kong", open:1, close:9}
];
let tickerData = [];

async function fetchIndexData(index){
    // Simulazione dati reali tramite API Yahoo Finance JSONP
    try{
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${index.symbol}?interval=1d&range=1wk`;
        const res = await fetch(url);
        const data = await res.json();
        const lastPrice = data.chart.result[0].meta.regularMarketPrice;
        const prevClose = data.chart.result[0].meta.chartPreviousClose;
        const prices = data.chart.result[0].indicators.quote[0].close;
        return {lastPrice, prevClose, prices};
    }catch{ return {lastPrice:0, prevClose:0, prices:[]}; }
}

async function updateTickerData(){
    tickerData=[];
    for(const idx of indices){
        const d = await fetchIndexData(idx);
        const now = new Date();
        const tzOffset = { "America/New_York": -5, "Europe/London":0, "Europe/Berlin":1, "Asia/Tokyo":9, "Asia/Hong_Kong":8 }[idx.tz];
        const hour = (now.getUTCHours() + tzOffset + 24)%24;
        let status="closed";
        if(hour>=idx.open && hour<idx.close) status="open";
        else if(hour>=idx.open-1 && hour<idx.open) status="pre";
        tickerData.push({
            ...idx,
            lastPrice:d.lastPrice,
            prevClose:d.prevClose,
            prices:d.prices,
            marketStatus:status
        });
    }
}
updateTickerData();
setInterval(updateTickerData,60000);

// ========================
// TICKER SCROLL
// ========================
const tickerInner = $("tickerInner");

function createTickerItems(){
    tickerInner.innerHTML="";
    tickerData.forEach(idx=>{
        const item = document.createElement("div");
        item.className="ticker-item";
        const dot = document.createElement("div");
        dot.className="ticker-dot";
        dot.style.background = idx.marketStatus==="open"?"#22c55e": idx.marketStatus==="pre"?"#facc15":"#ef4444";
        const name = document.createElement("span");
        name.textContent = idx.symbol;
        const price = document.createElement("span");
        price.className="ticker-price";
        price.textContent = idx.lastPrice.toFixed(2);
        item.append(dot,name,price);
        item.onclick = ()=>showIndexChart(idx);
        tickerInner.appendChild(item);
    });
}

let tickerOffset=0;
function animateTicker(){
    tickerOffset-=0.5;
    if(tickerOffset <= -tickerInner.scrollWidth/2) tickerOffset=0;
    tickerInner.style.transform = `translateX(${tickerOffset}px)`;
    requestAnimationFrame(animateTicker);
}
setInterval(createTickerItems,5000);
animateTicker();

// ========================
// ANIMATE LOOP INJ
// ========================
function animate(){
    const marketOpen = true; // sempre true per INJ
    const oldPrice = displayedPrice;
    displayedPrice = lerp(displayedPrice,targetPrice,0.1);
    colorNumber($("price"), displayedPrice, oldPrice,4, marketOpen);

    const d=((displayedPrice-price24hOpen)/price24hOpen)*100;
    $("price24h").textContent=`${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
    $("price24h").className="sub "+(d>0?"up":"down");

    $("priceMin").textContent=price24hLow.toFixed(3);
    $("priceOpen").textContent=price24hOpen.toFixed(3);
    $("priceMax").textContent=price24hHigh.toFixed(3);
    updatePriceBar();

    const oldAvailable = displayedAvailable;
    displayedAvailable = lerp(displayedAvailable,availableInj,0.1);
    colorNumber($("available"), displayedAvailable, oldAvailable,6, marketOpen);
    $("availableUsd").textContent=`≈ $${(displayedAvailable*displayedPrice).toFixed(2)}`;

    const oldStake = displayedStake;
    displayedStake = lerp(displayedStake,stakeInj,0.1);
    colorNumber($("stake"), displayedStake, oldStake,4, marketOpen);
    $("stakeUsd").textContent=`≈ $${(displayedStake*displayedPrice).toFixed(2)}`;

    const oldRewards = displayedRewards;
    displayedRewards = lerp(displayedRewards,rewardsInj,0.1);
    colorNumber($("rewards"), displayedRewards, oldRewards,7, marketOpen);
    $("rewardsUsd").textContent=`≈ $${(displayedRewards*displayedPrice).toFixed(2)}`;
    if(displayedRewards>oldRewards){
        $("rewards").classList.add("up");
        setTimeout(()=> $("rewards").classList.remove("up"),1000);
    }

    $("rewardBar").style.background="linear-gradient(to right,#0ea5e9,#3b82f6)";
    $("rewardBar").style.width=Math.min(displayedRewards/0.05*100,100)+"%";
    $("rewardPercent").textContent=(displayedRewards/0.05*100).toFixed(1)+"%";

    $("apr").textContent=apr.toFixed(2)+"%";
    $("updated").textContent="Last update: "+new Date().toLocaleTimeString();

    requestAnimationFrame(animate);
}
animate();

// ========================
// MINI CHART MODAL
// ========================
const modal = $("indexChartModal");
const modalClose = modal.querySelector(".close");
const modalTitle = $("indexChartTitle");
const modalCanvas = $("indexChartCanvas");
let modalChart=null;

function showIndexChart(idx){
    modal.style.display="flex";
    modalTitle.textContent = idx.name;
    const ctx = modalCanvas.getContext("2d");
    if(modalChart) modalChart.destroy();
    const color = idx.lastPrice >= idx.prevClose ? "#22c55e" : "#ef4444";
    modalChart = new Chart(ctx,{
        type:"line",
        data:{
            labels:idx.prices.map((_,i)=>i),
            datasets:[{
                data:idx.prices,
                borderColor: color,
                backgroundColor: "rgba(34,197,94,0.2)",
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
            scales:{x:{display:false},y:{ticks:{color:"#9ca3af"}}}
        }
    });
}
modalClose.onclick = ()=> modal.style.display="none";
window.onclick = e=>{ if(e.target==modal) modal.style.display="none"; };
