/* ================= CONFIG ================= */
const INITIAL_SETTLE_TIME = 4200;
let settleStart = Date.now();

const ACCOUNT_POLL_MS = 2000;
const REST_SYNC_MS = 60000;
const CHART_SYNC_MS = 60000;

const DAY_MINUTES = 24 * 60;
const ONE_MIN_MS = 60_000;

/* stake range */
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

/* ================= STAKE HISTORY CHART ================= */
let stakeChart = null;
let stakeLabels = [];
let stakeData = [];
let lastStakeRecorded = null;
let stakeBootstrapped = false;

/* ================= FETCH ================= */
async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return null;
  }
}

/* ================= ADDRESS ================= */
$("addressInput").value = address;
$("addressInput").oninput = (e) => {
  address = e.target.value.trim();
  localStorage.setItem("inj_address", address);
  settleStart = Date.now();
  stakeBootstrapped = false;
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

  // LIVE: aggiunge punto SOLO se cambia
  if (stakeBootstrapped) maybeAddStakePoint(stakeInj);
}
loadAccount();
setInterval(loadAccount, ACCOUNT_POLL_MS);

/* ================= STAKE CHART ================= */
function initStakeChart() {
  const canvas = $("stakeChart");
  if (!canvas) return;

  stakeChart = new Chart(canvas, {
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

/* aggiunge punto SOLO se valore cambia */
function maybeAddStakePoint(v) {
  const val = safe(v);
  if (!Number.isFinite(val)) return;

  if (lastStakeRecorded === null || Math.abs(val - lastStakeRecorded) > 0.000001) {
    lastStakeRecorded = val;
    stakeLabels.push(new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString());
    stakeData.push(val);

    if (!stakeChart && window.Chart) initStakeChart();
    else stakeChart.update("none");
  }
}

/* ================= STAKE FULL HISTORY (DAL 1° GENNAIO) ================= */
function isDelegateMsg(m) {
  return ((m?.["@type"] || m?.type || "").toLowerCase()).includes("msgdelegate");
}
function isUndelegateMsg(m) {
  return ((m?.["@type"] || m?.type || "").toLowerCase()).includes("msgundelegate");
}
function readMsgAmount(m) {
  const a = m?.amount;
  if (!a) return 0;
  if (typeof a === "string") return safe(a) / 1e18;
  return safe(a.amount) / 1e18;
}

async function fetchAllTxsFromYear(addressInj) {
  const base = "https://lcd.injective.network";
  const limit = 100;
  let offset = 0;
  const out = [];

  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
  const evSender = encodeURIComponent(`message.sender='${addressInj}'`);
  const evTime = encodeURIComponent(`tx.time>='${yearStart}'`);

  while (true) {
    const url =
      `${base}/cosmos/tx/v1beta1/txs?events=${evSender}&events=${evTime}` +
      `&pagination.offset=${offset}&pagination.limit=${limit}&order_by=ORDER_BY_ASC`;

    const data = await fetchJSON(url);
    const txs = data?.txs || [];
    const resps = data?.tx_responses || [];

    if (!txs.length) break;

    for (let i = 0; i < txs.length; i++) {
      out.push({ tx: txs[i], resp: resps[i] });
    }

    if (txs.length < limit) break;
    offset += limit;
  }
  return out;
}

async function bootstrapStakeHistory() {
  if (!address) return;

  stakeLabels = [];
  stakeData = [];
  lastStakeRecorded = null;
  stakeBootstrapped = false;

  const all = await fetchAllTxsFromYear(address);
  let running = 0;

  for (const item of all) {
    const tx = item.tx;
    const when = item.resp?.timestamp ? new Date(item.resp.timestamp) : null;
    const msgs = tx?.body?.messages || [];
    let delta = 0;

    for (const m of msgs) {
      if (isDelegateMsg(m)) delta += readMsgAmount(m);
      else if (isUndelegateMsg(m)) delta -= readMsgAmount(m);
    }

    if (delta !== 0) {
      running = Math.max(0, running + delta);
      stakeLabels.push(when ? when.toLocaleDateString() + " " + when.toLocaleTimeString() : "");
      stakeData.push(running);
    }
  }

  if (stakeData.length) {
    lastStakeRecorded = stakeData[stakeData.length - 1];
    if (!stakeChart && window.Chart) initStakeChart();
    else stakeChart.update("none");
  } else {
    // fallback: parte dal live
    lastStakeRecorded = stakeInj;
    stakeLabels.push(new Date().toLocaleTimeString());
    stakeData.push(stakeInj);
    initStakeChart();
  }

  stakeBootstrapped = true;
}

/* ================= BOOT ================= */
(async function boot() {
  await bootstrapStakeHistory();
})();
