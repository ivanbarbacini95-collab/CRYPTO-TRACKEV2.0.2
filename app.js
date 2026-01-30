const $ = id => document.getElementById(id);

/* =======================
   STATE
======================= */
let priceOpen = 0;
let priceMin = Infinity;
let priceMax = -Infinity;
let targetPrice = 0;
let displayedPrice = 0;

let chart;
let chartData = new Array(1440).fill(null);

/* =======================
   DAILY HISTORY
======================= */
async function loadDaily() {
  const d = await fetch(
    "https://api.binance.com/api/v3/klines?symbol=INJUSDT&interval=1m&limit=1440"
  ).then(r => r.json());

  const now = new Date();
  const idx = now.getHours() * 60 + now.getMinutes();

  chartData = new Array(1440).fill(null);

  d.forEach((c, i) => {
    if (i <= idx) chartData[i] = +c[4];
  });

  priceOpen = +d[0][1];
  priceMin = Math.min(...chartData.filter(v => v !== null));
  priceMax = Math.max(...chartData.filter(v => v !== null));
  targetPrice = chartData[idx];

  initChart();
}

/* =======================
   CHART
======================= */
function initChart() {
  const labels = Array.from({ length: 1440 }, (_, i) =>
    i % 60 === 0 ? `${String(i / 60).padStart(2, "0")}:00` : ""
  );

  chart = new Chart($("priceChart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: chartData,
        spanGaps: false,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.25)",
        fill: true,
        pointRadius: 0,
        tension: .3
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }},
      scales: {
        x: {
          offset: false,
          ticks: { color: "#9ca3af", autoSkip: false }
        },
        y: {
          ticks: { color: "#9ca3af" }
        }
      }
    }
  });
}

/* =======================
   WEBSOCKET
======================= */
const ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

ws.onmessage = e => {
  const p = +JSON.parse(e.data).p;
  targetPrice = p;

  const now = new Date();
  const idx = now.getHours() * 60 + now.getMinutes();

  chartData[idx] = p;
  chart.data.datasets[0].data[idx] = p;
  chart.update("none");

  priceMin = Math.min(priceMin, p);
  priceMax = Math.max(priceMax, p);
};

/* =======================
   UI LOOP
======================= */
function animate() {
  displayedPrice += (targetPrice - displayedPrice) * .1;

  $("price").textContent = displayedPrice.toFixed(4);

  const perf = ((displayedPrice - priceOpen) / priceOpen);
  const container = $("priceBar").parentElement;
  const w = container.clientWidth / 2;

  if (perf >= 0) {
    $("priceBar").style.left = w + "px";
    $("priceBar").style.width = Math.min(w, w * perf * 5) + "px";
    $("priceBar").style.background = "#22c55e";
    $("priceLine").style.left = w + Math.min(w, w * perf * 5) + "px";
  } else {
    $("priceBar").style.left = w + w * perf * 5 + "px";
    $("priceBar").style.width = Math.abs(w * perf * 5) + "px";
    $("priceBar").style.background = "#ef4444";
    $("priceLine").style.left = w + w * perf * 5 + "px";
  }

  $("priceMin").textContent = priceMin.toFixed(3);
  $("priceOpen").textContent = priceOpen.toFixed(3);
  $("priceMax").textContent = priceMax.toFixed(3);

  $("updated").textContent = new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}

loadDaily();
animate();
