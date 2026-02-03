/* ================= NET WORTH (persist + chart) ================= */
let nwTf = "1d";
let nwTAll = [];
let nwUsdAll = [];
let nwInjAll = [];
let netWorthChart = null;

function nwStoreKey(addr){
  const a = (addr || "").trim();
  return a ? `inj_networth_v${NW_LOCAL_VER}_${a}` : null;
}

function saveNW(){
  const key = nwStoreKey(address);
  if (!key) return;
  try{
    localStorage.setItem(key, JSON.stringify({
      v: NW_LOCAL_VER, t: Date.now(),
      tAll: nwTAll,
      usdAll: nwUsdAll,
      injAll: nwInjAll,
      tf: nwTf
    }));
    cloudBump(1); /* ✅ */
  } catch {
    cloudSetState("error");
  }
}

function loadNW(){
  const key = nwStoreKey(address);
  if (!key) return false;
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    if (!obj || obj.v !== NW_LOCAL_VER) return false;

    nwTAll   = Array.isArray(obj.tAll)   ? obj.tAll.map(Number)   : [];
    nwUsdAll = Array.isArray(obj.usdAll) ? obj.usdAll.map(Number) : [];
    nwInjAll = Array.isArray(obj.injAll) ? obj.injAll.map(Number) : [];
    nwTf = (obj.tf === "1w" || obj.tf === "1m" || obj.tf === "1y") ? obj.tf : "1d";

    clampNWArrays();
    return true;
  } catch {
    return false;
  }
}

function clampNWArrays(){
  const n = Math.min(nwTAll.length, nwUsdAll.length, nwInjAll.length);
  nwTAll = nwTAll.slice(-n);
  nwUsdAll = nwUsdAll.slice(-n);
  nwInjAll = nwInjAll.slice(-n);

  if (nwTAll.length > NW_MAX_POINTS){
    nwTAll = nwTAll.slice(-NW_MAX_POINTS);
    nwUsdAll = nwUsdAll.slice(-NW_MAX_POINTS);
    nwInjAll = nwInjAll.slice(-NW_MAX_POINTS);
  }
}

function nwWindowMs(tf){
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/* ✅ Build view as XY points (prevents "barcode/bars" effect) */
function nwBuildView(tf){
  const now = Date.now();
  const w = nwWindowMs(tf);
  const minT = now - w;

  const pts = [];
  for (let i = 0; i < nwTAll.length; i++){
    const t = safe(nwTAll[i]);
    const y = safe(nwUsdAll[i]);
    if (t >= minT && Number.isFinite(t) && Number.isFinite(y)){
      pts.push({ x: t, y });
    }
  }

  // keep chronological order (safety)
  pts.sort((a,b) => a.x - b.x);

  return { pts };
}

function nwApplySignStyling(sign){
  if (!netWorthChart) return;
  const ds = netWorthChart.data.datasets?.[0];
  if (!ds) return;

  if (sign === "up"){
    ds.borderColor = "#22c55e";
    ds.backgroundColor = "rgba(34,197,94,.18)";
  } else if (sign === "down"){
    ds.borderColor = "#ef4444";
    ds.backgroundColor = "rgba(239,68,68,.16)";
  } else {
    ds.borderColor = "#3b82f6";
    ds.backgroundColor = "rgba(59,130,246,.14)";
  }
  netWorthChart.update("none");
}

function initNWChart(){
  const canvas = $("netWorthChart");
  if (!canvas || !window.Chart) return;

  const view = nwBuildView(nwTf);

  netWorthChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        data: view.pts,              // ✅ XY points
        parsing: false,              // ✅ don't parse labels
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,.14)",
        fill: true,
        pointRadius: 0,
        tension: 0.28,               // smooth but not rubber
        cubicInterpolationMode: "monotone",
        spanGaps: true
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
      elements: {
        line: { borderWidth: 2 }
      },
      scales: {
        x: {
          type: "linear",            // ✅ time as number → no duplicate label issue
          display: false
        },
        y: {
          display: false
        }
      }
    }
  });
}

function drawNW(){
  if (!netWorthChart) initNWChart();
  if (!netWorthChart) return;

  const view = nwBuildView(nwTf);
  netWorthChart.data.datasets[0].data = view.pts;
  netWorthChart.update("none");

  // PnL computed on visible window (what you see)
  if (view.pts.length >= 2){
    const first = safe(view.pts[0].y);
    const last  = safe(view.pts[view.pts.length - 1].y);
    const pnl = last - first;
    const pnlPct = first ? (pnl / first) * 100 : 0;

    const pnlEl = $("netWorthPnl");
    if (pnlEl){
      pnlEl.classList.remove("good","bad","flat");
      const cls = pnl > 0 ? "good" : (pnl < 0 ? "bad" : "flat");
      pnlEl.classList.add(cls);
      const sign = pnl > 0 ? "+" : "";
      pnlEl.textContent = `PnL: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(2)}%)`;
      nwApplySignStyling(pnl > 0 ? "up" : (pnl < 0 ? "down" : "flat"));
    }
  } else {
    const pnlEl = $("netWorthPnl");
    if (pnlEl){
      pnlEl.classList.remove("good","bad");
      pnlEl.classList.add("flat");
      pnlEl.textContent = "PnL: —";
      nwApplySignStyling("flat");
    }
  }
}

function recordNetWorthPoint(){
  if (!address) return;
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return;

  const totalInj = safe(availableInj) + safe(stakeInj) + safe(rewardsInj);
  const totalUsd = totalInj * safe(targetPrice);
  if (!Number.isFinite(totalUsd)) return;

  const now = Date.now();

  const lastT = nwTAll.length ? safe(nwTAll[nwTAll.length - 1]) : 0;
  const lastUsd = nwUsdAll.length ? safe(nwUsdAll[nwUsdAll.length - 1]) : 0;

  const dt = now - lastT;
  const dUsd = Math.abs(totalUsd - lastUsd);

  // same logic as before: no spam points
  if (lastT && dt < 30_000 && dUsd < 1) return;

  nwTAll.push(now);
  nwUsdAll.push(totalUsd);
  nwInjAll.push(totalInj);

  clampNWArrays();
  saveNW();
  drawNW();
}

function attachNWTFHandlers(){
  const wrap = $("nwTfSwitch");
  if (!wrap) return;

  const btns = wrap.querySelectorAll(".tf-btn");
  btns.forEach(b => b.classList.toggle("active", b.dataset.tf === nwTf));

  wrap.addEventListener("click", (e) => {
    const btn = e.target?.closest(".tf-btn");
    if (!btn) return;
    const tf = btn.dataset.tf || "1d";
    if (!["1d","1w","1m","1y"].includes(tf)) return;

    nwTf = tf;
    btns.forEach(b => b.classList.toggle("active", b.dataset.tf === tf));
    saveNW();
    drawNW();
  }, { passive:true });
}
