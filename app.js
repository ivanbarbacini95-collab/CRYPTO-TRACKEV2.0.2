// ================= STATE =================
let address = localStorage.getItem("inj_address") || "";

let price24hOpen = 0, price24hLow = 0, price24hHigh = 0;
let targetPrice = 0;
let availableInj = 0, stakeInj = 0, rewardsInj = 0;
let apr = 0;
let chart, chartData = [];
let ws;

// ATH/ATL tracking
let lastATH = 0, lastATL = Infinity;
let athFlash = false, atlFlash = false;

// ================= HELPERS =================
const $ = id => document.getElementById(id);

// Numeri cifra per cifra
function colorNumber(el, current, previous, decimals=4){
    const curStr = current.toFixed(decimals);
    const prevStr = previous.toFixed(decimals);
    let html = '';
    for(let i=0;i<curStr.length;i++){
        if(curStr[i]===prevStr[i]){
            html += `<span style="color:#f9fafb">${curStr[i]}</span>`;
        } else {
            html += `<span style="color:${current>previous?"#22c55e":"#ef4444"}">${curStr[i]}</span>`;
        }
    }
    el.innerHTML = html;
}

async function fetchJSON(url){
    try { return await (await fetch(url)).json(); }
    catch { return {}; }
}

// ================= ADDRESS INPUT =================
$("addressInput").value = address;
$("addressInput").addEventListener("input", e=>{
    address = e.target.value.trim();
    localStorage.setItem("inj_address", address);
    loadAccount();
});

// ================= ACCOUNT LOAD =================
async function loadAccount() {
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

loadAccount();
setInterval(loadAccount, 2000);

// ================= PRICE HISTORY =================
async function fetchHistory(){
    const d = await fetchJSON("https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440");
    chartData = d.map(c=>+c[4]);
    price24hOpen = +d[0][1];
    price24hLow = Math.min(...chartData);
    price24hHigh = Math.max(...chartData);
    targetPrice = chartData.at(-1);
    lastATH = price24hHigh;
    lastATL = price24hLow;
    if(!chart) initChart();
}
fetchHistory();

// ================= CHART =================
function initChart(){
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
    ws.onclose = ()=>{ setConnectionStatus(false); setTimeout(startWS,3000); };
    ws.onerror = ()=>setConnectionStatus(false);
}
startWS();

// ================= VALUE STRUCTURE =================
const values = {
    price: {el:$("price"), displayed:0, target:0, decimals:4},
    available: {el:$("available"), displayed:0, target:0, decimals:6},
    stake: {el:$("stake"), displayed:0, target:0, decimals:4},
    rewards: {el:$("rewards"), displayed:0, target:0, decimals:7}
};

// ================= UPDATE VALUE =================
function updateValue(ref, newVal){
    // se differenza grande (simula prelievo/deposito), cambio istantaneo
    if(Math.abs(newVal - ref.displayed) > 0.001){
        const old = ref.displayed;
        ref.displayed = newVal;
        colorNumber(ref.el, ref.displayed, old, ref.decimals);
    } else {
        const old = ref.displayed;
        ref.displayed += (newVal - ref.displayed) * 0.2;
        if(Math.abs(ref.displayed - newVal) < 1e-6) ref.displayed = newVal;
        colorNumber(ref.el, ref.displayed, old, ref.decimals);
    }
}

// ================= ANIMATION LOOP =================
function animate(){

    // ---------------- NUMBERS ----------------
    values.price.target = targetPrice;
    updateValue(values.price, values.price.target);

    updateValue(values.available, availableInj);
    $("availableUsd").textContent = `≈ $${(values.available.displayed*values.price.displayed).toFixed(2)}`;

    updateValue(values.stake, stakeInj);
    $("stakeUsd").textContent = `≈ $${(values.stake.displayed*values.price.displayed).toFixed(2)}`;

    updateValue(values.rewards, rewardsInj);
    $("rewardsUsd").textContent = `≈ $${(values.rewards.displayed*values.price.displayed).toFixed(2)}`;

    // ---------------- PRICE BAR ----------------
    const barElPrice = $("priceBar"), lineElPrice = $("priceLine");
    const totalRange = price24hHigh - price24hLow;
    const linePerc = ((values.price.displayed - price24hLow)/totalRange)*100;
    lineElPrice.style.left = linePerc+"%"; // linea gialla trascina
    if(values.price.displayed >= price24hOpen){
        barElPrice.style.left = "50%";
        barElPrice.style.width = (linePerc-50)+"%";
        barElPrice.style.background = "linear-gradient(to right, #22c55e, #10b981)";
    } else {
        barElPrice.style.left = linePerc+"%";
        barElPrice.style.width = (50-linePerc)+"%";
        barElPrice.style.background = "linear-gradient(to left, #ef4444, #f87171)";
    }

    // ---------------- REWARD BAR ----------------
    const percReward = Math.min(values.rewards.displayed/0.1,1)*100;
    const lineElReward = $("rewardLine"), barElReward = $("rewardBar");
    lineElReward.style.left = percReward+"%";
    barElReward.style.left = "0%";
    barElReward.style.width = percReward+"%";
    barElReward.style.background = "linear-gradient(to right, #22c55e, #10b981)";
    $("rewardPercent").textContent = percReward.toFixed(1)+"%";

    // ---------------- PRICE CHANGE ----------------
    const d = ((values.price.displayed-price24hOpen)/price24hOpen)*100;
    $("price24h").textContent = `${d>0?"▲":"▼"} ${Math.abs(d).toFixed(2)}%`;
    $("price24h").className = "sub "+(d>0?"up":"down");
    $("priceMin").textContent = price24hLow.toFixed(3);
    $("priceOpen").textContent = price24hOpen.toFixed(3);
    $("priceMax").textContent = price24hHigh.toFixed(3);

    // Lampeggio ATH/ATL
    if(price24hHigh>lastATH){ athFlash = true; lastATH = price24hHigh; }
    if(price24hLow<lastATL){ atlFlash = true; lastATL = price24hLow; }
    if(athFlash){ $("priceMax").style.color = $("priceMax").style.color==="yellow"?"#9ca3af":"yellow"; if(values.price.displayed<lastATH) athFlash=false; }
    if(atlFlash){ $("priceMin").style.color = $("priceMin").style.color==="yellow"?"#9ca3af":"yellow"; if(values.price.displayed>lastATL) atlFlash=false; }

    // ---------------- APR ----------------
    $("apr").textContent = apr.toFixed(2)+"%";

    // ---------------- LAST UPDATE ----------------
    $("updated").textContent = "Last update: "+new Date().toLocaleTimeString();

    requestAnimationFrame(animate);
}
animate();
