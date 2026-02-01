/* ================= CONFIG ================= */
const SYMBOL = "INJUSDT";
const DAY_MINUTES = 24 * 60;
const ONE_MIN = 60_000;

/* ================= DOM ================= */
const canvas = document.getElementById("priceChart");
const tooltip = document.getElementById("chartTooltip");
const ctTime = document.getElementById("ctTime");
const ctPrice = document.getElementById("ctPrice");

/* ================= HELPERS ================= */
const safe = n => Number.isFinite(+n) ? +n : 0;
const pad2 = n => String(n).padStart(2, "0");
const fmtTime = ms => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/* ================= STATE ================= */
let chart;
let labels = [];
let prices = [];

let hoverActive = false;
let hoverIndex = null;

let lastMinuteOpen = 0;
let dailyOpen = 0;

/* ================= CHART PLUGIN (vertical line) ================= */
const verticalLinePlugin = {
  id: "vline",
  afterDraw(chart) {
    if (!hoverActive || hoverIndex == null) return;

    const meta = chart.getDatasetMeta(0);
    const pt = meta.data[hoverIndex];
    if (!pt) return;

    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pt.x, chart.chartArea.top);
    ctx.lineTo(pt.x, chart.chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(250,204,21,0.9)";
    ctx.stroke();
    ctx.restore();
  }
};

/* ================= INIT CHART ================= */
function initChart() {
  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: prices,
        borderColor: "#9ca3af",
        backgroundColor: "rgba(156,163,175,.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      interaction: {
        mode: "index",
        intersect: false
      },
      scales: {
        x: { display: false },
        y: { ticks: { color: "#9ca3af" } }
      }
    },
    plugins: [verticalLinePlugin]
  });

  setupInteractions();
}

/* ================= LOAD DAY HISTORY ================= */
async function fetchDayHistory() {
  const url =
    `https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=1440`;

  const d = await fetch(url).then(r => r.json());
  if (!Array.isArray(d) || !d.length) return;

  labels = [];
  prices = [];

  dailyOpen = safe(d[0][1]);

  d.forEach(k => {
    labels.push(fmtTime(k[0]));
    prices.push(safe(k[4]));
  });

  lastMinuteOpen = safe(d[d.length - 1][0]);

  if (!chart) initChart();
  else {
    chart.data.labels = labels;
    chart.data.datasets[0].data = prices;
    chart.update("none");
  }

  updateChartColor();
}

/* ================= REALTIME (WS 1m) ================= */
function startWS() {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${SYMBOL.toLowerCase()}@kline_1m`
  );

  ws.onmessage = e => {
    const k = JSON.parse(e.data).k;
    if (!k) return;

    const openTime = safe(k.t);
    const close = safe(k.c);

    if (!openTime || !close) return;

    // stesso minuto
    if (openTime === lastMinuteOpen) {
      prices[prices.length - 1] = close;
      chart.update("none");
      updateChartColor();
      return;
    }

    // nuovo minuto
    lastMinuteOpen = openTime;
    labels.push(fmtTime(openTime));
    prices.push(close);

    while (labels.length > DAY_MINUTES) {
      labels.shift();
      prices.shift();
    }

    chart.update("none");
    updateChartColor();
  };
}

/* ================= CHART COLOR (performance daily) ================= */
function updateChartColor() {
  if (!dailyOpen || !prices.length) return;

  const last = prices[prices.length - 1];
  const ds = chart.data.datasets[0];

  if (last > dailyOpen) {
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.22)";
  } else if (last < dailyOpen) {
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.20)";
  } else {
    ds.borderColor = "#9ca3af";
    ds.backgroundColor = "rgba(156,163,175,.15)";
  }
}

/* ================= INTERACTIONS ================= */
function setupInteractions() {
  const getIndex = evt => {
    const pts = chart.getElementsAtEventForMode(
      evt,
      "index",
      { intersect: false },
      false
    );
    return pts.length ? pts[0].index : null;
  };

  function show(idx) {
    hoverActive = true;
    hoverIndex = idx;

    ctTime.textContent = labels[idx];
    ctPrice.textContent = `$${prices[idx].toFixed(4)}`;

    tooltip.classList.remove("hidden");
    chart.update("none");
  }

  function hide() {
    hoverActive = false;
    hoverIndex = null;
    tooltip.classList.add("hidden");
    chart.update("none");
  }

  canvas.addEventListener("mousemove", e => {
    const idx = getIndex(e);
    if (idx == null) return hide();
    show(idx);
  });

  canvas.addEventListener("mouseleave", hide);

  canvas.addEventListener("touchstart", e => {
    const idx = getIndex(e);
    if (idx != null) show(idx);
  }, { passive: true });

  canvas.addEventListener("touchmove", e => {
    const idx = getIndex(e);
    if (idx != null) show(idx);
  }, { passive: true });

  canvas.addEventListener("touchend", hide);
  canvas.addEventListener("touchcancel", hide);
}

/* ================= BOOT ================= */
(async function boot() {
  await fetchDayHistory();
  startWS();
})();
