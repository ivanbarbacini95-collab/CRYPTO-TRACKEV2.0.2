/* ================= CONFIG ================= */
const LCD_BASE = "https://sentry.lcd.injective.network:443";
const BINANCE_REST = "https://api.binance.com";
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";

const SYMBOL = "INJUSDT";
const STREAM_TRADE = "injusdt@trade";
const STREAM_KLINE = "injusdt@kline_5m";

const ACCOUNT_POLL_MS = 5000;
const TICKER24H_POLL_MS = 15000;
const CHART_SYNC_MS = 60000;

const INJ_DECIMALS = 18;

/* “scorrimento” iniziale più lungo */
const INITIAL_SETTLE_TIME = 3200;
let settleStart = Date.now();

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const safe = (n) => (Number.isFinite(+n) ? +n : 0);

function pad2(n){ return String(n).padStart(2, "0"); }
function fmtHHMM(ms){
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function nowMs(){ return Date.now(); }

function fmtNum(n, decimals){
  const x = safe(n);
  return x.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtUsd(n){
  const x = safe(n);
  return x.toLocaleString("en-US", { style:"currency", currency:"USD" });
}
function injFromBaseAmount(amountStr){
  return safe(amountStr) / 10 ** INJ_DECIMALS;
}

function setConnection(online){
  const box = $("connectionStatus");
  if(!box) return;
  box.classList.toggle("online", !!online);
  box.classList.toggle("offline", !online);
  box.querySelector(".status-text").textContent = online ? "Online" : "Offline";
}

function addPulse(el, dir){
  if(!el) return;
  el.classList.remove("pulse-up","pulse-down");
  void el.offsetWidth;
  el.classList.add(dir === "up" ? "pulse-up" : "pulse-down");
}

function tweenNumber(el, toValue, decimals, opts={}){
  if(!el) return;
  const from = safe(el.dataset._v ?? el.textContent.replace(/,/g,""));
  const to = safe(toValue);

  const inSettle = (nowMs() - settleStart) < INITIAL_SETTLE_TIME;
  const duration = opts.duration ?? (inSettle ? 950 : 420);

  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function frame(ts){
    const t = clamp((ts - start) / duration, 0, 1);
    const v = from + (to - from) * ease(t);
    el.textContent = fmtNum(v, decimals);
    if(t < 1) requestAnimationFrame(frame);
    else el.dataset._v = String(to);
  }
  requestAnimationFrame(frame);
}

function isValidInjAddress(a){
  return /^inj1[0-9a-z]{30,90}$/i.test((a||"").trim());
}

/* ================= DOM ================= */
const elAddress = $("addressInput");

const elPrice = $("price");
const elPrice24h = $("price24h");

const elAvail = $("available");
const elAvailUsd = $("availableUsd");

const elStake = $("stake");
const elStakeUsd = $("stakeUsd");

const elRewards = $("rewards");
const elRewardsUsd = $("rewardsUsd");

const elApr = $("apr");

const elUpdated = $("updated");

const elPriceMin = $("priceMin");
const elPriceMax = $("priceMax");
const elPriceOpen = $("priceOpen");

const elPriceBar = $("priceBar");
const elPriceLine = $("priceLine");

const elRewardBar = $("rewardBar");
const elRewardPercent = $("rewardPercent");

/* Hover badge grafico */
const elChartHover = $("chartHover");
const elChartHoverTime = $("chartHoverTime");
const elChartHoverPrice = $("chartHoverPrice");

/* ================= STATE ================= */
let address = "";
let wsTrade = null;
let wsKline = null;

let wsTradeOnline = false;
let wsKlineOnline = false;

let lastRestOkAt = 0;

let lastPrice = 0;

let price24h = {
  changePercent: 0,
  high: 0,
  low: 0,
  open: 0,
};

let chart = null;
let chartData = []; // [{t, c}]

let lastAvail = 0, lastStake = 0, lastRew = 0;

function allOnline(){
  const restOk = (nowMs() - lastRestOkAt) < 20000;
  return (wsTradeOnline || wsKlineOnline) && restOk;
}

/* ================= BINANCE ================= */
function connectTradeWS(){
  if(wsTrade) try{ wsTrade.close(); }catch{}
  wsTradeOnline = false;

  wsTrade = new WebSocket(`${BINANCE_WS_BASE}/${STREAM_TRADE}`);

  wsTrade.onopen = () => { wsTradeOnline = true; setConnection(allOnline()); };
  wsTrade.onclose = () => { wsTradeOnline = false; setConnection(allOnline()); setTimeout(connectTradeWS, 1200); };
  wsTrade.onerror = () => { try{ wsTrade.close(); }catch{} };

  wsTrade.onmessage = (ev) => {
    try{
      const msg = JSON.parse(ev.data);
      const p = safe(msg.p);
      if(!p) return;

      const dir = (lastPrice && p < lastPrice) ? "down" : "up";
      lastPrice = p;

      tweenNumber(elPrice, p, 4);
      elPrice.classList.toggle("up", dir === "up");
      elPrice.classList.toggle("down", dir === "down");
      addPulse(elPrice, dir);

      updatePriceBarAndLine();
      setConnection(allOnline());
    }catch{}
  };
}

function connectKlineWS(){
  if(wsKline) try{ wsKline.close(); }catch{}
  wsKlineOnline = false;

  wsKline = new WebSocket(`${BINANCE_WS_BASE}/${STREAM_KLINE}`);

  wsKline.onopen = () => { wsKlineOnline = true; setConnection(allOnline()); };
  wsKline.onclose = () => { wsKlineOnline = false; setConnection(allOnline()); setTimeout(connectKlineWS, 1200); };
  wsKline.onerror = () => { try{ wsKline.close(); }catch{} };

  wsKline.onmessage = (ev) => {
    try{
      const msg = JSON.parse(ev.data);
      const k = msg.k;
      if(!k) return;

      const t = safe(k.t);
      const close = safe(k.c);
      if(!t || !close) return;

      const last = chartData[chartData.length - 1];
      if(last && last.t === t){
        last.c = close;
      }else{
        chartData.push({ t, c: close });
        if(chartData.length > 288) chartData.shift();
      }

      buildOrUpdateChart(true);
      updatePriceBarAndLine();
      setConnection(allOnline());
    }catch{}
  };
}

async function fetch24hTicker(){
  const url = `${BINANCE_REST}/api/v3/ticker/24hr?symbol=${SYMBOL}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("ticker_24hr_failed");
  const j = await r.json();

  price24h.changePercent = safe(j.priceChangePercent);
  price24h.high = safe(j.highPrice);
  price24h.low = safe(j.lowPrice);

  lastRestOkAt = nowMs();

  update24hChangeUI();
  updatePriceBarAndLine();
  setConnection(allOnline());
}

function update24hChangeUI(){
  const pct = safe(price24h.changePercent);
  elPrice24h.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  elPrice24h.classList.toggle("up", pct >= 0);
  elPrice24h.classList.toggle("down", pct < 0);
}

async function fetchChartHistory(){
  const url = `${BINANCE_REST}/api/v3/klines?symbol=${SYMBOL}&interval=5m&limit=288`;
  const r = await fetch(url);
  if(!r.ok) throw new Error("klines_failed");
  const arr = await r.json();

  chartData = arr.map(k => ({ t: k[0], c: safe(k[4]) })).filter(x => x.c > 0);

  if(arr.length){
    price24h.open = safe(arr[0][1]);
  }

  lastRestOkAt = nowMs();

  buildOrUpdateChart(false);
  updatePriceBarAndLine();
  setConnection(allOnline());
}

/* ================= CHART HOVER BADGE ================= */
function showChartHover(timeLabel, priceValue){
  if(!elChartHover) return;
  elChartHoverTime.textContent = timeLabel;
  elChartHoverPrice.textContent = `$${safe(priceValue).toFixed(4)}`;
  elChartHover.classList.remove("hidden");
}

function hideChartHover(){
  if(!elChartHover) return;
  elChartHover.classList.add("hidden");
}

function bindChartHoverEvents(canvas){
  if(!canvas) return;

  const updateFromEvent = (evt) => {
    if(!chart || !chartData.length) return;

    const points = chart.getElementsAtEventForMode(evt, "nearest", { intersect: false }, true);
    if(!points || !points.length){
      hideChartHover();
      return;
    }

    const idx = points[0].index;
    const p = chartData[idx];
    if(!p){ hideChartHover(); return; }

    showChartHover(fmtHHMM(p.t), p.c);
  };

  canvas.addEventListener("mousemove", updateFromEvent);
  canvas.addEventListener("mouseleave", hideChartHover);

  canvas.addEventListener("touchstart", (e) => updateFromEvent(e), { passive: true });
  canvas.addEventListener("touchmove", (e) => updateFromEvent(e), { passive: true });
  canvas.addEventListener("touchend", hideChartHover);
  canvas.addEventListener("touchcancel", hideChartHover);
}

/* ================= CHART.JS ================= */
function buildOrUpdateChart(soft=false){
  const canvas = $("priceChart");
  if(!canvas) return;

  const labels = chartData.map(p => fmtHHMM(p.t));
  const values = chartData.map(p => p.c);

  if(!chart){
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "INJ/USDT",
          data: values,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.22,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: soft ? false : { duration: 450 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false } // usiamo solo il badge custom
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
          y: {
            grid: { color: "rgba(255,255,255,.08)" },
            ticks: { callback: (v) => `$${safe(v).toFixed(2)}` }
          }
        }
      }
    });

    hideChartHover();
    bindChartHoverEvents(canvas);
    return;
  }

  chart.data.labels = labels;
  chart.data.datasets[0].data = values;
  chart.update(soft ? "none" : undefined);
}

/* ================= PRICE BAR LOGIC ================= */
function updatePriceBarAndLine(){
  const min = safe(price24h.low);
  const max = safe(price24h.high);
  const open = safe(price24h.open);
  const price = safe(lastPrice || chartData?.[chartData.length-1]?.c);

  if(!(min > 0 && max > 0 && max > min)) return;

  elPriceMin.textContent = fmtNum(min, 3);
  elPriceMax.textContent = fmtNum(max, 3);
  elPriceOpen.textContent = fmtNum(open || ((min + max) / 2), 3);

  const container = elPriceBar.parentElement;
  const w = container.getBoundingClientRect().width;

  const pos = clamp((price - min) / (max - min), 0, 1);
  elPriceLine.style.left = `${Math.round(pos * (w - 2))}px`;

  const openPos = (open > 0) ? clamp((open - min) / (max - min), 0, 1) : 0.5;
  const delta = pos - openPos;

  const isUp = delta >= 0;
  elPriceBar.classList.toggle("upbar", isUp);
  elPriceBar.classList.toggle("downbar", !isUp);

  const abs = clamp(Math.abs(delta) * 2, 0, 1);
  const widthPct = 12 + abs * 88;
  elPriceBar.style.width = `${widthPct.toFixed(2)}%`;

  const openX = openPos * w;
  const barW = (widthPct / 100) * w;

  let leftPx;
  if(isUp) leftPx = openX;
  else leftPx = openX - barW;

  leftPx = clamp(leftPx, 0, Math.max(0, w - barW));
  elPriceBar.style.left = `${Math.round(leftPx)}px`;
}

/* ================= INJECTIVE LCD ================= */
async function lcdJson(path){
  const url = `${LCD_BASE}${path}`;
  const r = await fetch(url, { headers: { "Accept":"application/json" }});
  if(!r.ok) throw new Error(`lcd_failed_${r.status}`);
  lastRestOkAt = nowMs();
  return r.json();
}

async function fetchAccountSnapshot(addr){
  const balances = await lcdJson(`/cosmos/bank/v1beta1/balances/${addr}`);
  const coins = balances?.balances || [];
  const injCoin = coins.find(c => c.denom === "inj");
  const availableInj = injCoin ? injFromBaseAmount(injCoin.amount) : 0;

  const dels = await lcdJson(`/cosmos/staking/v1beta1/delegations/${addr}`);
  const ds = dels?.delegation_responses || [];
  const stakedInj = ds.reduce((sum, d) => sum + injFromBaseAmount(d?.balance?.amount || 0), 0);

  const rew = await lcdJson(`/cosmos/distribution/v1beta1/delegators/${addr}/rewards`);
  const total = rew?.total || [];
  const injTotal = total.find(c => c.denom === "inj");
  const rewardsInj = injTotal ? injFromBaseAmount(injTotal.amount) : 0;

  let apr = 0;
  try{
    const inf = await lcdJson(`/cosmos/mint/v1beta1/inflation`);
    const inflation = safe(inf?.inflation);

    const pool = await lcdJson(`/cosmos/staking/v1beta1/pool`);
    const bonded = safe(pool?.pool?.bonded_tokens);
    const notBonded = safe(pool?.pool?.not_bonded_tokens);
    const bondedRatio = (bonded + notBonded) > 0 ? bonded / (bonded + notBonded) : 0;

    if(bondedRatio > 0) apr = (inflation / bondedRatio) * 100;
  }catch{}

  return { availableInj, stakedInj, rewardsInj, apr };
}

/* ================= UI APPLY ================= */
function pulseDelta(el, current, prev){
  if(!el) return;
  if(prev === 0) return;
  const dir = current >= prev ? "up" : "down";
  el.classList.toggle("up", dir === "up");
  el.classList.toggle("down", dir === "down");
  addPulse(el, dir);
}

function applyAccountUI(s, price){
  const p = safe(price);

  tweenNumber(elAvail, s.availableInj, 6);
  elAvailUsd.textContent = `≈ ${fmtUsd(s.availableInj * p)}`;
  pulseDelta(elAvail, s.availableInj, lastAvail);
  lastAvail = s.availableInj;

  tweenNumber(elStake, s.stakedInj, 4);
  elStakeUsd.textContent = `≈ ${fmtUsd(s.stakedInj * p)}`;
  pulseDelta(elStake, s.stakedInj, lastStake);
  lastStake = s.stakedInj;

  tweenNumber(elRewards, s.rewardsInj, 7);
  elRewardsUsd.textContent = `≈ ${fmtUsd(s.rewardsInj * p)}`;
  pulseDelta(elRewards, s.rewardsInj, lastRew);
  lastRew = s.rewardsInj;

  elApr.textContent = `${safe(s.apr).toFixed(2)}%`;

  const base = Math.max(s.stakedInj, 0.000001);
  const ratio = (s.rewardsInj / base) * 100;
  elRewardPercent.textContent = `${ratio.toFixed(2)}%`;

  const maxVisual = 5;
  const width = clamp((ratio / maxVisual) * 100, 0, 100);
  elRewardBar.style.width = `${width.toFixed(2)}%`;
}

/* ================= MAIN LOOP ================= */
async function tickAccount(){
  if(!isValidInjAddress(address)) return;

  try{
    const price = safe(lastPrice || chartData?.[chartData.length-1]?.c);
    const snap = await fetchAccountSnapshot(address);
    applyAccountUI(snap, price);

    elUpdated.textContent = `Last update: ${fmtHHMM(nowMs())}`;
    setConnection(allOnline());
  }catch{
    setConnection(allOnline());
  }
}

/* ================= BOOT ================= */
async function boot(){
  settleStart = nowMs();

  connectTradeWS();
  connectKlineWS();

  try{ await fetchChartHistory(); } catch{}
  try{ await fetch24hTicker(); } catch{}

  setInterval(() => fetch24hTicker().catch(()=>{}), TICKER24H_POLL_MS);
  setInterval(() => fetchChartHistory().catch(()=>{}), CHART_SYNC_MS);

  setInterval(tickAccount, ACCOUNT_POLL_MS);

  const saved = localStorage.getItem("inj_addr") || "";
  if(saved){
    elAddress.value = saved;
    address = saved.trim();
    setTimeout(tickAccount, 350);
  }

  elAddress.addEventListener("change", () => {
    const v = elAddress.value.trim();
    if(isValidInjAddress(v)){
      address = v;
      localStorage.setItem("inj_addr", v);
      settleStart = nowMs();
      tickAccount();
    }
  });

  setConnection(false);
  elUpdated.textContent = "Last update: --:--";
  hideChartHover();
}

boot();
