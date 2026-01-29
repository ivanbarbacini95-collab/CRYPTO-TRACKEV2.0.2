let chart, chartData = [];
const MAX_POINTS = 24 * 60; // 24h a 1 tick al minuto
let tickIndex = 0;
let startPrice = 0;
let lastPrice = 0;

// Utility
const $ = id => document.getElementById(id);
const lerp = (a, b, f) => a + (b - a) * f;

// Inizializza grafico 24h
function initChart24h(start) {
    startPrice = start;
    lastPrice = start;
    chartData = Array(MAX_POINTS).fill(null);
    chartData[0] = startPrice;

    const ctx = $("priceChart").getContext("2d");
    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: generateLabels(), // X dinamiche
            datasets: [{
                data: chartData,
                borderColor: "#22c55e",
                backgroundColor: createGradient(ctx, startPrice),
                fill: true,
                pointRadius: 0,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    callbacks: {
                        label: ctx => {
                            const price = ctx.raw ? ctx.raw.toFixed(4) : '-';
                            const time = chart.data.labels[ctx.dataIndex] || '';
                            return `${time} → $${price}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: "#9ca3af", autoSkip: true, maxTicksLimit: 25 }
                },
                y: { ticks: { color: "#9ca3af" } }
            }
        }
    });

    addBlinkingDot(ctx);
}

// Crea gradient dinamico
function createGradient(ctx, price) {
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    if (lastPrice >= startPrice) {
        gradient.addColorStop(0, "rgba(34,197,94,0.2)");
    } else {
        gradient.addColorStop(0, "rgba(239,68,68,0.2)");
    }
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    return gradient;
}

// Genera etichette orarie ogni 10 minuti
function generateLabels() {
    const labels = [];
    const now = new Date();
    for (let i = 0; i < MAX_POINTS; i++) {
        const d = new Date(now.getTime() - (MAX_POINTS - i - 1) * 60 * 1000);
        if (d.getMinutes() % 10 === 0) {
            labels.push(`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`);
        } else {
            labels.push('');
        }
    }
    return labels;
}

// Aggiorna grafico con nuovo prezzo
function updateChartRealtime(price) {
    lastPrice = price;
    tickIndex++;
    if (tickIndex >= MAX_POINTS) {
        tickIndex = 0;
        startPrice = price;
        chartData.fill(null);
        chartData[0] = startPrice;
    } else {
        chartData[tickIndex] = price;
    }

    chart.data.datasets[0].data = chartData;
    chart.data.datasets[0].borderColor = price >= startPrice ? "#22c55e" : "#ef4444";
    chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, price);

    chart.update("none");
}

// Puntino giallo lampeggiante per ultimo prezzo
function addBlinkingDot(ctx) {
    const dot = { alpha: 1, increasing: false };
    function drawDot() {
        if (!chart) return;
        const dataset = chart.data.datasets[0].data;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        const x = xScale.getPixelForValue(tickIndex);
        const y = dataset[tickIndex] !== null ? yScale.getPixelForValue(dataset[tickIndex]) : yScale.getPixelForValue(lastPrice);

        dot.alpha += dot.increasing ? 0.05 : -0.05;
        if (dot.alpha <= 0.2) dot.increasing = true;
        if (dot.alpha >= 1) dot.increasing = false;

        chart.update("none"); // aggiorna senza ricreare canvas
        ctx.save();
        ctx.globalAlpha = dot.alpha;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#facc15";
        ctx.fill();
        ctx.restore();

        requestAnimationFrame(drawDot);
    }
    drawDot();
}
