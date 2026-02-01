/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

/* ================= FLASH CSS ================= */
(() => {
  const s = document.createElement("style");
  s.textContent = `
    @keyframes flashHigh {
      0% { color:#facc15; text-shadow:0 0 16px rgba(250,204,21,.95); }
      100% { color:#9ca3af; text-shadow:none; }
    }
    @keyframes flashLow {
      0% { color:#38bdf8; text-shadow:0 0 16px rgba(56,189,248,.95); }
      100% { color:#9ca3af; text-shadow:none; }
    }
    .flash-high { animation: flashHigh .9s ease; }
    .flash-low  { animation: flashLow  .9s ease; }
  `;
  document.head.appendChild(s);
})();

function flash(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* ================= STATE ================= */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

const candle = {
  d: { open: 0, high: 0, low: 0 },
  w: { open: 0, high: 0, low: 0 },
  m: { open: 0, high: 0, low: 0 },
};

const prev = {
  d: { high: null, low: null },
  w: { high: null, low: null },
  m: { high: null, low: null },
};

/* ================= GRADIENTS ================= */
const GRAD = {
  d: {
    up: "linear-gradient(90deg,rgba(34,197,94,.35),rgba(59,130,246,.85))",
    dn: "linear-gradient(270deg,rgba(239,68,68,.35),rgba(30,64,175,.85))"
  },
  w: {
    up: "linear-gradient(90deg,rgba(56,189,248,.35),rgba(37,99,235,.85))",
    dn: "linear-gradient(270deg,rgba(14,165,233,.35),rgba(30,64,175,.85))"
  },
  m: {
    up: "linear-gradient(90deg,rgba(250,204,21,.35),rgba(245,158,11,.85))",
    dn: "linear-gradient(270deg,rgba(217,119,6,.35),rgba(146,64,14,.85))"
  },
  reward: "linear-gradient(90deg,rgba(34,197,94,.35),rgba(59,130,246,.85))"
};

/* ================= BAR RENDER ================= */
function renderBar(tf, barId, lineId, minId, openId, maxId) {
  const bar = $(barId);
  const line = $(lineId);
  const s = candle[tf];
  if (!bar || !line || !s.open) return;

  const range = Math.max(s.high - s.open, s.open - s.low);
  const min = s.open - range;
  const max = s.open + range;

  const pos = clamp(((targetPrice - min) / (max - min)) * 100, 0, 100);
  line.style.left = pos + "%";

  if (targetPrice >= s.open) {
    bar.style.left = "50%";
    bar.style.width = Math.max(0, pos - 50) + "%";
    bar.style.background = GRAD[tf].up;
  } else {
    bar.style.left = pos + "%";
    bar.style.width = Math.max(0, 50 - pos) + "%";
    bar.style.background = GRAD[tf].dn;
  }

  const elMin = $(minId);
  const elOpen = $(openId);
  const elMax = $(maxId);

  elMin.textContent = s.low.toFixed(3);
  elOpen.textContent = s.open.toFixed(3);
  elMax.textContent = s.high.toFixed(3);

  if (prev[tf].high !== null && s.high > prev[tf].high) flash(elMax, "flash-high");
  if (prev[tf].low  !== null && s.low  < prev[tf].low ) flash(elMin, "flash-low");

  prev[tf].high = s.high;
  prev[tf].low  = s.low;
}

/* ================= MOCK REALTIME (BINANCE) ================= */
async function initMock() {
  const base = 10;
  candle.d.open = candle.w.open = candle.m.open = base;
  candle.d.low = candle.w.low = candle.m.low = base;
  candle.d.high = candle.w.high = candle.m.high = base;

  setInterval(() => {
    const delta = (Math.random() - 0.5) * 0.15;
    targetPrice = safe(targetPrice || base) + delta;

    ["d","w","m"].forEach(tf => {
      candle[tf].high = Math.max(candle[tf].high, targetPrice);
      candle[tf].low  = Math.min(candle[tf].low, targetPrice);
    });
  }, 900);
}
initMock();

/* ================= LOOP ================= */
function animate() {

  renderBar("d","priceBar","priceLine","priceMin","priceOpen","priceMax");
  renderBar("w","weekBar","weekLine","weekMin","weekOpen","weekMax");
  renderBar("m","monthBar","monthLine","monthMin","monthOpen","monthMax");

  /* reward */
  displayed.rewards += (rewardsInj - displayed.rewards) * 0.06;
  const maxR = Math.max(0.1, displayed.rewards * 1.2);
  const rp = clamp((displayed.rewards / maxR) * 100, 0, 100);

  $("rewardBar").style.width = rp + "%";
  $("rewardBar").style.background = GRAD.reward;
  $("rewardLine").style.left = rp + "%";
  $("rewardPercent").textContent = rp.toFixed(1) + "%";

  $("rewardMin").textContent = "0";
  $("rewardMax").textContent = maxR.toFixed(2);

  requestAnimationFrame(animate);
}
animate();
