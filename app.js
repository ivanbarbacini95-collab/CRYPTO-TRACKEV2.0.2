const ctx = document.getElementById("priceChart").getContext("2d");

/* ======================
   TIME
====================== */
const minuteOfDay = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const labels = Array.from({ length: 1440 }, (_, i) => {
  const h = Math.floor(i / 60);
  const m = i % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
});

/* ======================
   STATE
====================== */
let dayData = new Array(1440).fill(null);
let dayStartPrice = null;
let smoothPrice = null;
let lastMinute = null;
let candles = [];

/* ======================
   SMOOTH EMA
====================== */
function ema(price, alpha = 0.15) {
  if (smoothPrice === null) smoothPrice = price;
  smoothPrice += alpha * (price - smoothPrice);
  return smoothPrice;
}

/* ======================
   SNAPSHOT
====================== */
function saveSnapshot() {
  localStorage.setItem("inj_day", JSON.stringify(dayData));
}

function loadSnapshot() {
  const s = localStorage.getItem("inj_day");
  if (s) dayData = JSON.parse(s);
}

/* ======================
   CHART
====================== */
const chart = new Chart(ctx, {
  data: {
    labels,
    datasets: [
      {
        type: "line",
        data: dayData,
        tension: 0.45,
        cubicInterpolationMode: "monotone",
        pointRadius: 0,
        borderWidth: 2,
        fill: true,
        borderColor: "#22c55e",
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0,0,0,300);
          g.addColorStop(0,"rgba(34,197,94,0.35)");
          g.addColorStop(1,"rgba(34,197,94,0)");
          return g;
        }
      },
      {
        type: "scatter",
        data: [],
        pointRadius: 5,
        pointBackgroundColor: "#22c55e"
      },
      {
        type: "candlestick",
        data: candles
      }
    ]
  },
  options: {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: c =>
            `${c.label} • $${c.parsed.y?.toFixed(4)}`
        }
      }
    },
    scales: {
      x: { ticks: { maxTicksLimit: 6, color: "#9ca3af" } },
      y: { ticks: { color: "#9ca3af" } }
    }
  }
});

/* ======================
   RESET DAILY
====================== */
function checkReset(m) {
  if (lastMinute !== null && m < lastMinute) {
    saveSnapshot();
    dayData = new Array(1440).fill(null);
    candles.length = 0;
    dayStartPrice = null;
    chart.data.datasets[0].data = dayData;
  }
  lastMinute = m;
}

/* ======================
   WEBSOCKET
====================== */
const ws = new WebSocket("wss://stream.binance.com:9443/ws/injusdt@trade");

ws.onmessage = e => {
  const raw = +JSON.parse(e.data).p;
  const price = ema(raw);
  const m = minuteOfDay();

  checkReset(m);

  if (!dayStartPrice) dayStartPrice = price;
  dayData[m] = price;

  const up = price >= dayStartPrice;
  chart.data.datasets[0].borderColor = up ? "#22c55e" : "#ef4444";
  chart.data.datasets[1].data = [{ x: m, y: price }];
  chart.data.datasets[1].pointBackgroundColor = up ? "#22c55e" : "#ef4444";

  const last = candles.at(-1);
  if (!last || last.x !== m) {
    candles.push({ x: m, o: price, h: price, l: price, c: price });
  } else {
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    last.c = price;
  }

  chart.update("none");
  document.getElementById("updated").textContent =
    "Last update: " + new Date().toLocaleTimeString();
};

loadSnapshot();
