/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;
const STAKE_TARGET_MAX = 1000;

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtHHMM(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ================= CONNECTION UI ================= */
const statusDot = $("statusDot");
const statusText = $("statusText");

let wsTradeOnline = false;
let wsKlineOnline = false;
let accountOnline = false;

function refreshConnUI() {
  const ok = wsTradeOnline && wsKlineOnline && accountOnline;
  statusText.textContent = ok ? "Online" : "Offline";
  statusDot.style.background = ok ? "#22c55e" : "#ef4444";
}

/* ================= STATE ================= */
let address = localStorage.getItem("inj_address") || "";

/* live price */
let targetPrice = 0;
let displayed = { price: 0, available: 0, stake: 0, rewards: 0 };

/* Injective account */
let availableInj = 0, stakeInj = 0, rewardsInj = 0, apr = 0;

/* ================= STAKE EVENT GRAPH ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let lastStakeRecorded = null;

/* ================= SMOOTH DISPLAY ================= */
function scrollSpeed() {
  const t = Math.min((Date.now() - settleStart) / INITIAL_SETTLE_TIME, 1);
  return 0.08 + (t * t) * 0.8;
}
function tick(cur, tgt) {
  if (!Number.isFinite(tgt)) return cur;
  return cur + (tgt - cur) * scrollSpeed();
}

/* ================= FETCH ================= */
async function fetchJSON(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    return null;
  }
}

/* ================= ADDRESS ================= */
$("addressInput").value = address;
$("addressInput").oninput = (e) => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  stakeLabels = [];
  stakeData = [];
  lastStakeRecorded = null;
  loadAccount();
  bootstrapStakeHistory();
};

/* ================= ACCOUNT ================= */
async function loadAccount() {
  if (!address) {
    accountOnline = false;
    refreshConnUI();
    return;
  }

  const base = "https://lcd.injective.network";
  const [b, s, r, i] = await Promise.all([
    fetchJSON(`${base}/cosmos/bank/v1beta1/balances/${address}`),
    fetchJSON(`${base}/cosmos/staking/v1beta1/delegations/${address}`),
    fetchJSON(`${base}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetchJSON(`${base}/cosmos/mint/v1beta1/inflation`)
  ]);

  if (!b || !s || !r || !i) {
    accountOnline = false;
    refreshConnUI();
    return;
  }

  accountOnline = true;
  refreshConnUI();

  availableInj = safe(b.balances?.find(x => x.denom === "inj")?.amount) / 1e18;
  stakeInj = (s.delegation_responses || []).reduce((a, d) => a + safe(d.balance.amount), 0) / 1e18;
  rewardsInj = (r.rewards || []).reduce((a, x) =>
    a + (x.reward || []).reduce((s2, y) => s2 + safe(y.amount), 0), 0) / 1e18;

  apr = safe(i.inflation) * 100;

  maybeAddStakePoint(stakeInj);
}
loadAccount();
setInterval(loadAccount, ACCOUNT_POLL_MS);

/* ================= STAKE CHART ================= */
function initStakeChart() {
  const c = $("stakeChart");
  if (!c) return;

  stakeChart = new Chart(c, {
    type: "line",
    data: {
      labels: stakeLabels,
      datasets: [{
        data: stakeData,
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.18)",
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { beginAtZero: false }
      }
    }
  });
}

function maybeAddStakePoint(v) {
  const val = safe(v);
  if (!Number.isFinite(val)) return;

  if (lastStakeRecorded === null || Math.abs(val - lastStakeRecorded) > 0.000001) {
    lastStakeRecorded = val;
    stakeLabels.push(new Date().toLocaleDateString());
    stakeData.push(val);

    if (!stakeChart) initStakeChart();
    else stakeChart.update("none");
  }
}

/* ================= STAKE HISTORY BOOTSTRAP (YTD) ================= */
function isDelegateMsg(m) {
  return (m?.["@type"] || "").toLowerCase().includes("msgdelegate");
}
function isUndelegateMsg(m) {
  return (m?.["@type"] || "").toLowerCase().includes("msgundelegate");
}
function readMsgAmount(m) {
  const a = m?.amount;
  if (!a) return 0;
  if (typeof a === "string") return safe(a) / 1e18;
  return safe(a.amount) / 1e18;
}

async function bootstrapStakeHistory() {
  if (!address) return;

  stakeLabels = [];
  stakeData = [];
  lastStakeRecorded = null;

  const startYear = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const base = "https://lcd.injective.network";
  const evSender = encodeURIComponent(`message.sender='${address}'`);
  const evTime = encodeURIComponent(`tx.time>='${startYear}'`);

  let offset = 0;
  const limit = 100;
  let running = 0;

  while (true) {
    const url = `${base}/cosmos/tx/v1beta1/txs?events=${evSender}&events=${evTime}&pagination.offset=${offset}&pagination.limit=${limit}&order_by=ORDER_BY_ASC`;
    const d = await fetchJSON(url);
    const txs = d?.txs || [];
    const resps = d?.tx_responses || [];
    if (!txs.length) break;

    for (let i = 0; i < txs.length; i++) {
      const msgs = txs[i]?.body?.messages || [];
      let delta = 0;

      for (const m of msgs) {
        if (isDelegateMsg(m)) delta += readMsgAmount(m);
        else if (isUndelegateMsg(m)) delta -= readMsgAmount(m);
      }

      if (delta !== 0) {
        running = Math.max(0, running + delta);
        if (lastStakeRecorded === null || Math.abs(running - lastStakeRecorded) > 0.000001) {
          stakeLabels.push(new Date(resps[i]?.timestamp || Date.now()).toLocaleDateString());
          stakeData.push(running);
          lastStakeRecorded = running;
        }
      }
    }

    if (txs.length < limit) break;
    offset += limit;
  }

  if (stakeData.length && !stakeChart) initStakeChart();
}

/* ================= BOOT ================= */
(async function boot() {
  await bootstrapStakeHistory();
})();

/* ================= LOOP ================= */
function animate() {
  /* PRICE */
  displayed.price = tick(displayed.price, targetPrice);
  $("price").textContent = displayed.price.toFixed(4);

  /* AVAILABLE */
  displayed.available = tick(displayed.available, availableInj);
  $("available").textContent = displayed.available.toFixed(6);
  $("availableUsd").textContent = `≈ $${(displayed.available * displayed.price).toFixed(2)}`;

  /* STAKE */
  displayed.stake = tick(displayed.stake, stakeInj);
  $("stake").textContent = displayed.stake.toFixed(4);
  $("stakeUsd").textContent = `≈ $${(displayed.stake * displayed.price).toFixed(2)}`;

  const pct = clamp((displayed.stake / STAKE_TARGET_MAX) * 100, 0, 100);
  $("stakeBar").style.width = pct + "%";
  $("stakeLine").style.left = pct + "%";
  $("stakePercent").textContent = pct.toFixed(1) + "%";

  /* REWARDS */
  displayed.rewards = tick(displayed.rewards, rewardsInj);
  $("rewards").textContent = displayed.rewards.toFixed(7);
  $("rewardsUsd").textContent = `≈ $${(displayed.rewards * displayed.price).toFixed(2)}`;

  $("apr").textContent = apr.toFixed(2) + "%";
  $("updated").textContent = "Last update: " + new Date().toLocaleTimeString();

  requestAnimationFrame(animate);
}
animate();
