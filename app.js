```js
/* =========================================================
   Injective Portfolio — app.js (v2.0.3+)
   ✅ 100% intero (senza tagli)
   ✅ Compatibile con CSS che mi hai appena dato
   ✅ Robust: se qualche ID in HTML differisce, tenta fallback
   ✅ Integra: LIN/LOG, timeframe, live 1m, autoscaling, blinking dot,
              storage per-address, Events con filtri+paging, gear range,
              copy address, expand card fullscreen, reward estimates,
              reward/stake charts autoscaling + zoom/pan.
   NOTE onesta (CEX flows):
     "flussi in/out da Exchange con nome exchange" NON affidabile solo con LCD + price.
     Serve indexer/transazioni + mapping indirizzi CEX. Qui trovi hook pronto.

   Requisiti esterni:
     - Chart.js + chartjs-plugin-zoom già inclusi in HTML
========================================================= */

/* ================= CONFIG ================= */
const APP_VERSION = "2.0.3";
const TZ_LABEL = "UTC+1";

const INITIAL_SETTLE_TIME = 4200; // ms (animazioni iniziali)
let settleStart = Date.now();

const MODE_LIVE = "live";
const MODE_REFRESH = "refresh";

// polling
const PRICE_POLL_MS_LIVE = 1800;
const PRICE_POLL_MS_REFRESH = 8000;
const ACCOUNT_POLL_MS_LIVE = 2400;
const ACCOUNT_POLL_MS_REFRESH = 12000;

// safety sync (richieste più pesanti)
const REST_SYNC_MS = 60_000;

// net worth live point resolution
const ONE_MIN_MS = 60_000;

// persistence versions
const LS_VER = 4;

// reward withdraw detection
const REWARD_WITHDRAW_THRESHOLD = 0.0002; // INJ

// charts limits
const NW_MAX_POINTS = 4800;
const STAKE_MAX_POINTS = 4800;
const WD_MAX_POINTS = 4800;
const APR_MAX_POINTS = 4800;

// events
const EVENTS_PAGE_SIZE = 25;

// price movement thresholds
const PRICE_THRESHOLDS = [0.05, 0.10, 0.15, 0.20]; // 5/10/15/20%

// defaults for targets (range bars)
const DEFAULT_STAKE_TARGET = 1000; // INJ
const DEFAULT_REWARD_TARGET = 1;   // INJ

// endpoints (best effort)
const BINANCE_SYMBOL = "INJUSDT";
const BINANCE_PRICE_URL = `https://api.binance.com/api/v3/ticker/price?symbol=${BINANCE_SYMBOL}`;
const BINANCE_24H_URL = `https://api.binance.com/api/v3/ticker/24hr?symbol=${BINANCE_SYMBOL}`;
const BINANCE_KLINES_URL = `https://api.binance.com/api/v3/klines?symbol=${BINANCE_SYMBOL}`;

// Injective LCD public (best effort; puoi cambiare se usi altro)
const INJ_LCD_BASES = [
  "https://lcd.injective.network",
  "https://injective-rest.publicnode.com",
];

// endpoints cosmos-style
const LCD = {
  bank: (base, addr) => `${base}/cosmos/bank/v1beta1/balances/${addr}`,
  stakingDelegations: (base, addr) => `${base}/cosmos/staking/v1beta1/delegations/${addr}`,
  distributionRewards: (base, addr) => `${base}/cosmos/distribution/v1beta1/delegators/${addr}/rewards`,
};

// Cloud API (Vercel) — tentiamo più route senza rompere
const CLOUD_ROUTES = [
  "/api/point",      // classico
  "/api/points",     // fallback
];

/* ================= STATE ================= */
const state = {
  theme: "dark",
  mode: MODE_LIVE,
  modeLoading: false,

  // current address
  addr: "",
  addrShort: "",
  addrLoaded: false,

  // live prices
  price: 0,
  pricePrev: 0,
  price24hChangePct: 0,

  // balances
  available: 0,
  staked: 0,
  rewards: 0,

  // derived
  totalOwned: 0,
  netWorth: 0,

  // implied APR (semplice, stabile; sostituibile con endpoint APR se vuoi)
  apr: 0,

  // series per address
  series: {
    netWorth: [],      // {t, v}
    stake: [],         // {t, v}
    rewardWd: [],      // {t, v, meta:{...}}
    apr: [],           // {t, v}
    priceLive1m: [],   // {t, v}
    priceLive5m: [],   // {t, v}
  },

  // settings per address
  settings: {
    stakeTarget: DEFAULT_STAKE_TARGET,
    rewardTarget: DEFAULT_REWARD_TARGET,
    nwScale: "linear",
    stakeScale: "linear",
    rewardScale: "linear",
    priceScale: "linear",
    aprScale: "linear",
    nwTf: "all",     // 1d|1w|1m|1y|all
    stakeTf: "1m",   // 1d|1w|1m
    rewardTf: "1m",  // 1d|1w|1m
    priceTf: "1d",   // 1d|1w|1m|1y|all
    priceLiveInterval: "1m", // 1m|5m (solo per modalità live chart)
    rewardFilter: "all", // all|lt005|gt005|gte01
  },

  // last seen snapshots to detect events
  last: {
    rewards: null,
    staked: null,
    apr: null,
    price: null,
    priceRef: null, // reference for thresholds
  },

  // events per address
  events: [], // {t,type,title,detail,status,meta}

  // UI/Cloud
  cloud: {
    enabled: true,
    lastOk: 0,
    status: "idle", // idle|saving|ok|err
    points: 0,
  },

  // timers
  timers: {
    price: null,
    account: null,
    safety: null,
  },

  charts: {
    nw: null,
    stake: null,
    reward: null,
    price: null,
    apr: null,
  },
};

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);
const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const now = () => Date.now();

function round(n, d = 4) {
  const p = Math.pow(10, d);
  return Math.round((+n + Number.EPSILON) * p) / p;
}
function fmt(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtUSD(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "$0";
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: d });
}
function fmtPct(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0%";
  return `${(x * 100).toFixed(d)}%`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function shortAddr(addr) {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}
function normalizeAddr(a) {
  const s = String(a || "").trim();
  if (!/^inj[a-z0-9]{20,80}$/i.test(s)) return "";
  return s;
}
function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}
function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/* ================= TOAST ================= */
function ensureToastHost() {
  let host = q(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  return host;
}
function toast(title, sub = "") {
  const host = ensureToastHost();
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `
    <div class="toast-row">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div style="opacity:.65;font-weight:900">${APP_VERSION}</div>
    </div>
    ${sub ? `<div class="toast-sub">${escapeHtml(sub)}</div>` : ``}
  `;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ================= LOCAL STORAGE ================= */
function lsKey(kind, addr = state.addr) {
  return `injpf_v${LS_VER}_${kind}_${addr || "global"}`;
}
function lsGet(kind, addr, fallback) {
  const k = lsKey(kind, addr);
  const v = localStorage.getItem(k);
  return v ? safeJsonParse(v, fallback) : fallback;
}
function lsSet(kind, addr, value) {
  const k = lsKey(kind, addr);
  localStorage.setItem(k, JSON.stringify(value));
}

function loadGlobalPrefs() {
  const prefs = lsGet("prefs", "", null);
  if (prefs) {
    state.theme = prefs.theme || state.theme;
    state.mode = prefs.mode || state.mode;
  }
}
function saveGlobalPrefs() {
  lsSet("prefs", "", { theme: state.theme, mode: state.mode, v: LS_VER, t: now() });
}

function loadAddrData(addr) {
  const pack = lsGet("pack", addr, null);
  if (pack && pack.addr === addr) {
    state.series.netWorth = pack.netWorth || [];
    state.series.stake = pack.stake || [];
    state.series.rewardWd = pack.rewardWd || [];
    state.series.apr = pack.apr || [];
    state.events = pack.events || [];
    state.settings = { ...state.settings, ...(pack.settings || {}) };
    state.cloud.points = (state.series.netWorth?.length || 0) +
                         (state.series.stake?.length || 0) +
                         (state.series.rewardWd?.length || 0) +
                         (state.series.apr?.length || 0) +
                         (state.events?.length || 0);
    return true;
  }
  return false;
}
function saveAddrData(addr) {
  if (!addr) return;
  const pack = {
    v: LS_VER,
    t: now(),
    addr,
    netWorth: trimSeries(state.series.netWorth, NW_MAX_POINTS),
    stake: trimSeries(state.series.stake, STAKE_MAX_POINTS),
    rewardWd: trimSeries(state.series.rewardWd, WD_MAX_POINTS),
    apr: trimSeries(state.series.apr, APR_MAX_POINTS),
    events: trimSeries(state.events, 2500), // eventi crescono
    settings: state.settings,
  };
  lsSet("pack", addr, pack);
}

function trimSeries(arr, max) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

/* ================= CLOUD SYNC (best effort) ================= */
function setCloudStatus(kind) {
  state.cloud.status = kind;
  const body = document.body;
  body.classList.remove("cloud-synced", "cloud-saving", "cloud-error");
  if (kind === "ok") body.classList.add("cloud-synced");
  if (kind === "saving") body.classList.add("cloud-saving");
  if (kind === "err") body.classList.add("cloud-error");

  const cloudEl = $("cloudStatus");
  if (cloudEl) {
    cloudEl.textContent =
      kind === "ok" ? "Cloud Sync: OK" :
      kind === "saving" ? "Cloud Sync: Saving…" :
      kind === "err" ? "Cloud Sync: Error" :
      "Cloud Sync";
  }

  // dot in drawer
  const dot = q(".cloud-dot");
  if (dot) {
    dot.classList.remove("ok", "saving", "err");
    if (kind === "ok") dot.classList.add("ok");
    if (kind === "saving") dot.classList.add("saving");
    if (kind === "err") dot.classList.add("err");
  }
}

async function cloudWrite(addr) {
  if (!state.cloud.enabled || !addr) return;
  setCloudStatus("saving");

  const payload = {
    addr,
    v: LS_VER,
    t: now(),
    pack: {
      netWorth: trimSeries(state.series.netWorth, NW_MAX_POINTS),
      stake: trimSeries(state.series.stake, STAKE_MAX_POINTS),
      rewardWd: trimSeries(state.series.rewardWd, WD_MAX_POINTS),
      apr: trimSeries(state.series.apr, APR_MAX_POINTS),
      events: trimSeries(state.events, 2500),
      settings: state.settings,
    },
  };

  for (const route of CLOUD_ROUTES) {
    try {
      const r = await fetch(`${route}?addr=${encodeURIComponent(addr)}&kind=pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        state.cloud.lastOk = now();
        setCloudStatus("ok");
        return true;
      }
    } catch { /* ignore */ }
  }
  setCloudStatus("err");
  return false;
}

async function cloudRead(addr) {
  if (!state.cloud.enabled || !addr) return false;

  for (const route of CLOUD_ROUTES) {
    try {
      const r = await fetch(`${route}?addr=${encodeURIComponent(addr)}&kind=pack`, { method: "GET" });
      if (!r.ok) continue;
      const j = await r.json();
      const pack = j?.pack || j?.data || j;
      if (pack && pack.netWorth) {
        state.series.netWorth = pack.netWorth || [];
        state.series.stake = pack.stake || [];
        state.series.rewardWd = pack.rewardWd || [];
        state.series.apr = pack.apr || [];
        state.events = pack.events || [];
        state.settings = { ...state.settings, ...(pack.settings || {}) };
        setCloudStatus("ok");
        return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

/* ================= NETWORK HELPERS ================= */
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function fetchText(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

function isOnline() {
  return navigator.onLine !== false;
}

/* ================= UI: CONNECTION STATUS ================= */
function setConnStatus(kind, label) {
  // kind: ok|loading|offline
  const dot = q(".status-dot");
  const txt = q(".status-text");
  if (!dot || !txt) return;

  if (kind === "ok") {
    dot.style.background = "#22c55e";
    dot.style.animation = "none";
    txt.textContent = label || "Connected";
  } else if (kind === "loading") {
    dot.style.background = "#f59e0b";
    dot.style.animation = "pulse 1.3s infinite";
    txt.textContent = label || "Connecting…";
  } else {
    dot.style.background = "#ef4444";
    dot.style.animation = "pulse 1.1s infinite";
    txt.textContent = label || "Offline";
  }
}

/* ================= UI: THEME ================= */
function applyTheme() {
  document.body.dataset.theme = state.theme === "light" ? "light" : "dark";
  const icon = $("themeIcon") || $("themeIconText") || $("themeIconSpan");
  if (icon) icon.textContent = state.theme === "light" ? "☀️" : "🌙";
  saveGlobalPrefs();
}
function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  applyTheme();
  toast("Theme", state.theme === "light" ? "Light mode" : "Dark mode");
}

/* ================= UI: MENU (DRAWER) ================= */
function openDrawer() {
  document.body.classList.add("drawer-open");
}
function closeDrawer() {
  document.body.classList.remove("drawer-open");
}
function wireDrawer() {
  const menuBtn = $("menuBtn");
  const backdrop = $("backdrop");
  const drawer = $("drawer");
  if (menuBtn) menuBtn.addEventListener("click", () => {
    if (document.body.classList.contains("drawer-open")) closeDrawer();
    else openDrawer();
  });
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  // menu nav items: prefer data-page, fallback IDs
  qa(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page || btn.getAttribute("data-target");
      if (page) {
        showPage(page);
        qa(".nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        closeDrawer();
      } else {
        // Coming soon overlay
        showComingSoon(btn.textContent.trim() || "Coming soon");
      }
    });
  });

  // toggles
  const themeToggle = $("themeToggle");
  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  const modeToggle = $("modeToggle") || $("liveToggle") || $("modeBtn");
  if (modeToggle) {
    modeToggle.addEventListener("click", () => {
      state.mode = state.mode === MODE_LIVE ? MODE_REFRESH : MODE_LIVE;
      saveGlobalPrefs();
      toast("Mode", state.mode === MODE_LIVE ? "LIVE (real-time)" : "REFRESH (lighter)");
      refreshModeUI();
      restartLoops();
    });
  }

  // labels next to icons (se in HTML esistono)
  const modeLabel = $("modeLabel");
  if (modeLabel) modeLabel.textContent = "Mode";
  const themeLabel = $("themeLabel");
  if (themeLabel) themeLabel.textContent = "Theme";

  // version small in drawer
  const vEl = q(".nav-version");
  if (vEl) vEl.textContent = `v${APP_VERSION}`;
}

function refreshModeUI() {
  // update icon if present
  const el = $("modeIcon") || $("modeIconText");
  if (el) el.textContent = state.mode === MODE_LIVE ? "⚡" : "⏱️";

  // update footer pills if exist
  const wsPill = $("wsPill");
  if (wsPill) wsPill.textContent = state.mode === MODE_LIVE ? "WS Live" : "Refresh";
}

/* ================= UI: COMING SOON ================= */
function ensureComingSoon() {
  let overlay = q(".coming-soon");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "coming-soon";
    overlay.innerHTML = `
      <div class="coming-card">
        <div class="coming-title">🚀 Coming soon</div>
        <div class="coming-sub" id="comingSub">This section will be available soon.</div>
        <button class="coming-close" id="comingClose">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const btn = $("comingClose");
  if (btn) btn.onclick = () => overlay.classList.remove("show");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("show");
  });
  return overlay;
}
function showComingSoon(label) {
  const overlay = ensureComingSoon();
  const sub = $("comingSub");
  if (sub) sub.textContent = `${label} — 🚀 Coming soon`;
  overlay.classList.add("show");
}

/* ================= UI: PAGES ================= */
function showPage(pageName) {
  // expected: page containers have class .page and dataset-name or id
  const pages = qa(".page");
  if (!pages.length) return;

  pages.forEach((p) => p.classList.remove("active"));
  let target =
    q(`.page[data-name="${pageName}"]`) ||
    $(pageName) ||
    q(`.page#${cssEscape(pageName)}`);
  if (!target) {
    // fallback to dashboard
    target = q(".page.active") || pages[0];
  }
  if (target) target.classList.add("active");

  // special render
  if (pageName.toLowerCase().includes("event")) renderEvents();
}
function cssEscape(s) {
  // minimal escape
  return String(s || "").replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/* ================= UI: SEARCH / ADDRESS ================= */
function wireSearch() {
  const wrap = q(".search-wrap");
  const btn = $("searchBtn") || q(".search-wrap .icon-btn");
  const input = $("addrInput") || $("addressInput") || q(".search-wrap input");

  if (!wrap || !btn || !input) return;

  const openSearch = () => {
    wrap.classList.add("open");
    document.body.classList.add("search-open");
    input.focus();
    input.select?.();
  };
  const closeSearch = () => {
    wrap.classList.remove("open");
    document.body.classList.remove("search-open");
    input.blur();
  };

  btn.addEventListener("click", () => {
    if (!wrap.classList.contains("open")) openSearch();
    else closeSearch();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearch();
      return;
    }
    if (e.key === "Enter") {
      const addr = normalizeAddr(input.value);
      if (!addr) {
        toast("Invalid address", "Use a valid inj… address");
        return;
      }
      closeSearch();
      setAddress(addr);
    }
  });

  // placeholder english requested
  input.placeholder = input.placeholder || "Enter Injective address (inj...)";
}

function wireCopyAddress() {
  const btn = $("addrCopyBtn") || q(".addr-copy-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!state.addr) return;
    try {
      await navigator.clipboard.writeText(state.addr);
      toast("Copied", "Address copied to clipboard");
    } catch {
      toast("Copy failed", "Your browser blocked clipboard access");
    }
  });
}

function updateAddressUI() {
  const tag = q(".address-display .tag");
  if (tag) {
    const txtEl = $("addrShort") || $("addressShort") || q(".address-display .tag span");
    if (txtEl) txtEl.textContent = state.addrShort || "No wallet";
    else tag.textContent = state.addrShort || "No wallet";
  }
}

async function setAddress(addr) {
  state.addr = addr;
  state.addrShort = shortAddr(addr);
  state.addrLoaded = true;

  updateAddressUI();
  toast("Wallet", `Loaded ${state.addrShort}`);

  // reset in-memory live price series (not persisted, but per address)
  state.series.priceLive1m = [];
  state.series.priceLive5m = [];

  // load local
  const okLocal = loadAddrData(addr);

  // optional: cloud read if local empty
  if (!okLocal) {
    setCloudStatus("loading");
    await cloudRead(addr);
  }

  // apply loaded settings to UI buttons
  syncScaleButtonsUI();
  syncTimeframeButtonsUI();

  // refresh charts with loaded data
  rebuildAllCharts();

  // run immediate account fetch
  await tickAccount(true);

  // persist immediately
  saveAddrData(addr);
  cloudWrite(addr).catch(() => {});
}

/* ================= MODALS (gear) ================= */
function ensureRangeModal() {
  let m = q(".modal");
  if (!m) {
    m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `
      <div class="modal-card">
        <div class="modal-title" id="rangeModalTitle">Set range</div>
        <div class="modal-sub" id="rangeModalSub">Set the target max value for the progress bar.</div>
        <div class="modal-form">
          <div class="modal-row">
            <label for="rangeMaxInput">Target max</label>
            <input id="rangeMaxInput" type="number" min="0" step="0.0001" />
          </div>
        </div>
        <div class="modal-actions">
          <button class="modal-btn" id="rangeCancel">Cancel</button>
          <button class="modal-btn primary" id="rangeApply">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
  }
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.remove("show");
  });
  return m;
}

function openRangeModal(kind) {
  const m = ensureRangeModal();
  const title = $("rangeModalTitle");
  const sub = $("rangeModalSub");
  const input = $("rangeMaxInput");

  const isStake = kind === "stake";
  title.textContent = isStake ? "Stake range" : "Reward range";
  sub.textContent = isStake
    ? "Set your target max (INJ) for the Staked progress bar."
    : "Set your target max (INJ) for the Reward progress bar.";

  const current = isStake ? state.settings.stakeTarget : state.settings.rewardTarget;
  input.value = String(current);

  const cancel = $("rangeCancel");
  const apply = $("rangeApply");

  cancel.onclick = () => m.classList.remove("show");
  apply.onclick = () => {
    const v = Number(input.value);
    if (!Number.isFinite(v) || v <= 0) {
      toast("Invalid value", "Enter a positive number");
      return;
    }
    if (isStake) state.settings.stakeTarget = v;
    else state.settings.rewardTarget = v;

    saveAddrData(state.addr);
    cloudWrite(state.addr).catch(() => {});
    updateBars();
    toast("Saved", `${isStake ? "Stake" : "Reward"} target set to ${fmt(v, 4)} INJ`);
    m.classList.remove("show");
  };

  m.classList.add("show");
}

function wireGears() {
  qa(".bar-gear").forEach((b) => {
    const kind = b.dataset.range || b.dataset.kind || "";
    b.addEventListener("click", () => openRangeModal(kind || "stake"));
  });
}

/* ================= CHARTS ================= */
function ensureChartJS() {
  if (typeof Chart === "undefined") {
    toast("Missing Chart.js", "Include Chart.js and chartjs-plugin-zoom in HTML");
    return false;
  }
  return true;
}

/* --- Plugin: blinking yellow dot at last point (Net Worth + live charts) --- */
const BlinkingLastPointPlugin = {
  id: "blinkingLastPoint",
  afterDatasetsDraw(chart, args, pluginOptions) {
    const opt = pluginOptions || {};
    if (!opt.enabled) return;

    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || meta.data.length === 0) return;
    const last = meta.data[meta.data.length - 1];
    if (!last) return;

    const ctx = chart.ctx;
    const t = Date.now();
    const blink = (Math.sin(t / 180) + 1) / 2; // 0..1
    const r1 = opt.radius || 4.2;
    const r2 = r1 + 5.5;

    ctx.save();
    // outer glow
    ctx.globalAlpha = 0.28 + blink * 0.35;
    ctx.beginPath();
    ctx.arc(last.x, last.y, r2, 0, Math.PI * 2);
    ctx.fillStyle = "#facc15";
    ctx.fill();
    // inner dot
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(last.x, last.y, r1, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b";
    ctx.fill();
    ctx.restore();
  },
};

/* --- Common chart options --- */
function makeTimeAxisTicks(maxTicks = 6) {
  return {
    autoSkip: true,
    maxTicksLimit: maxTicks,
    color: axisColor(),
    font: { weight: 800 },
    callback: (val, idx, ticks) => {
      // labels already formatted if category; if numeric timestamp:
      try {
        const v = Number(val);
        if (Number.isFinite(v) && v > 1e11) {
          const d = new Date(v);
          return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        }
      } catch {}
      return String(val);
    },
  };
}

function axisColor() {
  return document.body.dataset.theme === "light"
    ? "rgba(15,23,42,.60)"
    : "rgba(249,250,251,.60)";
}
function gridColor() {
  return document.body.dataset.theme === "light"
    ? "rgba(15,23,42,.10)"
    : "rgba(255,255,255,.08)";
}

function makeLineDataset(label, data, extra = {}) {
  return {
    label,
    data,
    parsing: false,
    pointRadius: 0,
    pointHitRadius: 10,
    borderWidth: 2,
    tension: 0.25,
    ...extra,
  };
}

function makeChart(ctx, { yScale = "linear", yRight = true, tooltipMode = "index", enableBlink = false, yFmt = null, zoom = false } = {}) {
  const chart = new Chart(ctx, {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: { mode: tooltipMode, intersect: false },
      layout: {
        padding: {
          left: 8,
          right: 4,  // ✅ colonna valori a dx super schiacciata
          top: 6,
          bottom: 0,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: document.body.dataset.theme === "light" ? "rgba(240,242,246,.95)" : "rgba(17,28,47,.92)",
          titleColor: document.body.dataset.theme === "light" ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)",
          bodyColor: document.body.dataset.theme === "light" ? "rgba(15,23,42,.80)" : "rgba(249,250,251,.86)",
          borderColor: document.body.dataset.theme === "light" ? "rgba(15,23,42,.12)" : "rgba(255,255,255,.12)",
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              const y = p?.y ?? ctx.parsed?.y;
              if (yFmt) return `${ctx.dataset.label}: ${yFmt(y)}`;
              return `${ctx.dataset.label}: ${fmt(y, 6)}`;
            },
            title: (items) => {
              const p = items?.[0]?.raw;
              const x = p?.x;
              if (typeof x === "number") return fmtTime(x);
              return items?.[0]?.label || "";
            },
          },
        },
        zoom: zoom ? {
          pan: { enabled: true, mode: "x" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
          limits: { x: { min: "original", max: "original" } },
        } : undefined,
        blinkingLastPoint: { enabled: enableBlink },
      },
      scales: {
        x: {
          type: "linear",
          grid: { color: gridColor(), drawBorder: false },
          ticks: makeTimeAxisTicks(7),
        },
        y: {
          type: yScale,
          position: yRight ? "right" : "left",
          grid: { color: gridColor(), drawBorder: false },
          ticks: {
            color: axisColor(),
            padding: 4,
            maxTicksLimit: 6,
            callback: (v) => yFmt ? yFmt(v) : fmt(v, 6),
          },
        },
      },
    },
    plugins: [BlinkingLastPointPlugin],
  });

  return chart;
}

function setChartTheme(chart) {
  if (!chart) return;
  const opts = chart.options;
  opts.scales.x.grid.color = gridColor();
  opts.scales.y.grid.color = gridColor();
  opts.scales.x.ticks.color = axisColor();
  opts.scales.y.ticks.color = axisColor();

  // tooltip colors update too (optional)
  if (opts.plugins?.tooltip) {
    opts.plugins.tooltip.backgroundColor =
      document.body.dataset.theme === "light" ? "rgba(240,242,246,.95)" : "rgba(17,28,47,.92)";
    opts.plugins.tooltip.titleColor =
      document.body.dataset.theme === "light" ? "rgba(15,23,42,.90)" : "rgba(249,250,251,.92)";
    opts.plugins.tooltip.bodyColor =
      document.body.dataset.theme === "light" ? "rgba(15,23,42,.80)" : "rgba(249,250,251,.86)";
    opts.plugins.tooltip.borderColor =
      document.body.dataset.theme === "light" ? "rgba(15,23,42,.12)" : "rgba(255,255,255,.12)";
  }

  chart.update("none");
}

/* ================= CHART BUILDERS ================= */
function buildNetWorthChart() {
  const c = $("netWorthChart");
  if (!c || !ensureChartJS()) return;

  if (state.charts.nw) state.charts.nw.destroy();
  state.charts.nw = makeChart(c.getContext("2d"), {
    yScale: state.settings.nwScale,
    yRight: true,
    tooltipMode: "nearest",
    enableBlink: true,
    yFmt: (v) => fmtUSD(v, 2),
    zoom: true,
  });

  state.charts.nw.data.datasets = [
    makeLineDataset("Net Worth", [], {
      borderColor: "rgba(56,189,248,.95)",
    }),
  ];

  wireChartClick(state.charts.nw, "networth");
  refreshNetWorthSeries();
}

function buildStakeChart() {
  const c = $("stakeChart");
  if (!c || !ensureChartJS()) return;

  if (state.charts.stake) state.charts.stake.destroy();
  state.charts.stake = makeChart(c.getContext("2d"), {
    yScale: state.settings.stakeScale,
    yRight: true,
    tooltipMode: "nearest",
    enableBlink: false,
    yFmt: (v) => `${fmt(v, 4)} INJ`,
    zoom: true,
  });

  state.charts.stake.data.datasets = [
    makeLineDataset("Staked", [], {
      borderColor: "rgba(34,197,94,.95)",
    }),
  ];

  wireChartClick(state.charts.stake, "stake");
  refreshStakeSeries();
}

function buildRewardChart() {
  const c = $("rewardChart");
  if (!c || !ensureChartJS()) return;

  if (state.charts.reward) state.charts.reward.destroy();
  state.charts.reward = makeChart(c.getContext("2d"), {
    yScale: state.settings.rewardScale,
    yRight: true,
    tooltipMode: "nearest",
    enableBlink: false,
    yFmt: (v) => `${fmt(v, 6)} INJ`,
    zoom: true,
  });

  state.charts.reward.data.datasets = [
    makeLineDataset("Reward Withdraw", [], {
      borderColor: "rgba(59,130,246,.95)",
    }),
  ];

  wireChartClick(state.charts.reward, "reward");
  refreshRewardSeries();
}

function buildPriceChart() {
  const c = $("priceChart");
  if (!c || !ensureChartJS()) return;

  if (state.charts.price) state.charts.price.destroy();
  state.charts.price = makeChart(c.getContext("2d"), {
    yScale: state.settings.priceScale,
    yRight: true,
    tooltipMode: "nearest",
    enableBlink: true,
    yFmt: (v) => fmtUSD(v, 4),
    zoom: true,
  });

  state.charts.price.data.datasets = [
    makeLineDataset("INJ Price", [], {
      borderColor: "rgba(250,204,21,.95)",
    }),
  ];

  wireChartClick(state.charts.price, "price");
  refreshPriceSeries();
}

function buildAprChart() {
  const c = $("aprChart");
  if (!c || !ensureChartJS()) return;

  if (state.charts.apr) state.charts.apr.destroy();
  state.charts.apr = makeChart(c.getContext("2d"), {
    yScale: state.settings.aprScale,
    yRight: true,
    tooltipMode: "nearest",
    enableBlink: false,
    yFmt: (v) => fmtPct(v, 2),
    zoom: true,
  });

  state.charts.apr.data.datasets = [
    makeLineDataset("APR", [], {
      borderColor: "rgba(99,102,241,.95)",
    }),
  ];

  wireChartClick(state.charts.apr, "apr");
  refreshAprSeries();
}

function rebuildAllCharts() {
  buildNetWorthChart();
  buildStakeChart();
  buildRewardChart();
  buildPriceChart();
  buildAprChart();

  // refresh theme after create
  setChartTheme(state.charts.nw);
  setChartTheme(state.charts.stake);
  setChartTheme(state.charts.reward);
  setChartTheme(state.charts.price);
  setChartTheme(state.charts.apr);
}

/* ================= SERIES FILTERS / TIMEFRAMES ================= */
function tfToMs(tf) {
  if (tf === "1d") return 24 * 60 * 60 * 1000;
  if (tf === "1w") return 7 * 24 * 60 * 60 * 1000;
  if (tf === "1m") return 30 * 24 * 60 * 60 * 1000;
  if (tf === "1y") return 365 * 24 * 60 * 60 * 1000;
  return Infinity; // all
}

function filterByTf(points, tf) {
  if (!Array.isArray(points)) return [];
  const ms = tfToMs(tf);
  if (ms === Infinity) return points.slice();
  const cutoff = now() - ms;
  // keep also a bit earlier for smoothness
  return points.filter(p => p.t >= cutoff);
}

function autoscalePadding(min, max, padRatio = 0.12) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const delta = Math.abs(min) * 0.08 + 1e-6;
    return { min: min - delta, max: max + delta };
  }
  const range = max - min;
  const pad = range * padRatio;
  return { min: min - pad, max: max + pad };
}

function applyAutoscale(chart, points, yScale, floorPositive = false) {
  if (!chart) return;

  const ys = chart.options.scales.y;
  ys.type = yScale;

  let min = Infinity, max = -Infinity;
  for (const p of points) {
    const v = p.v;
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    ys.min = undefined;
    ys.max = undefined;
    return;
  }

  const padded = autoscalePadding(min, max, 0.12);

  if (yScale === "logarithmic" || floorPositive) {
    // log scale needs >0
    const eps = 1e-6;
    padded.min = Math.max(eps, padded.min);
    padded.max = Math.max(padded.min * 1.01, padded.max);
  }

  ys.min = padded.min;
  ys.max = padded.max;
}

/* ================= CHART REFRESHERS ================= */
function refreshNetWorthSeries() {
  const pts = filterByTf(state.series.netWorth, state.settings.nwTf);
  const data = pts.map(p => ({ x: p.t, y: p.v }));
  const chart = state.charts.nw;
  if (!chart) return;

  chart.data.datasets[0].data = data;
  applyAutoscale(chart, pts, state.settings.nwScale, state.settings.nwScale === "logarithmic");
  chart.update("none");
}

function refreshStakeSeries() {
  const pts = filterByTf(state.series.stake, state.settings.stakeTf);
  const data = pts.map(p => ({ x: p.t, y: p.v }));
  const chart = state.charts.stake;
  if (!chart) return;

  chart.data.datasets[0].data = data;
  applyAutoscale(chart, pts, state.settings.stakeScale, state.settings.stakeScale === "logarithmic");
  chart.update("none");
}

function rewardFilterFn(p) {
  const f = state.settings.rewardFilter;
  const v = p.v;
  if (f === "lt005") return v < 0.05;
  if (f === "gt005") return v > 0.05;
  if (f === "gte01") return v >= 0.1;
  return true;
}

function refreshRewardSeries() {
  const base = filterByTf(state.series.rewardWd, state.settings.rewardTf);
  const pts = base.filter(rewardFilterFn);
  const data = pts.map(p => ({ x: p.t, y: p.v, meta: p.meta }));
  const chart = state.charts.reward;
  if (!chart) return;

  chart.data.datasets[0].data = data;
  applyAutoscale(chart, pts, state.settings.rewardScale, state.settings.rewardScale === "logarithmic");
  chart.update("none");

  renderRewardEstimates();
}

function refreshPriceSeries() {
  const chart = state.charts.price;
  if (!chart) return;

  // price: for 1d/1w/1m/1y/all show stored klines if present,
  // for live mode you still see last points (1m or 5m) on the same chart if priceTf === "all"?:
  // 👉 Qui: se priceTf è "all", mostriamo il live series "priceLiveInterval"
  //     altrimenti carichiamo i klines by timeframe (richiesta 1D/1W/1M/1Y/ALL).

  const tf = state.settings.priceTf;

  let pts = [];
  if (tf === "all") {
    pts = (state.settings.priceLiveInterval === "5m" ? state.series.priceLive5m : state.series.priceLive1m);
  } else {
    // we store latest fetched historical in state.tempPriceKlines (per tf)
    const hist = state._priceHist?.[tf] || [];
    pts = hist;
  }

  const data = pts.map(p => ({ x: p.t, y: p.v }));
  chart.data.datasets[0].data = data;

  applyAutoscale(chart, pts, state.settings.priceScale, state.settings.priceScale === "logarithmic");
  chart.update("none");
}

function refreshAprSeries() {
  const chart = state.charts.apr;
  if (!chart) return;

  // APR timeframe: use same as stakeTf for simplicity (puoi aggiungere bottoni dedicati)
  const tf = state.settings.stakeTf;
  const pts = filterByTf(state.series.apr, tf);
  chart.data.datasets[0].data = pts.map(p => ({ x: p.t, y: p.v }));

  applyAutoscale(chart, pts, state.settings.aprScale, state.settings.aprScale === "logarithmic");
  chart.update("none");
}

/* ================= CHART CLICK (show value + date) ================= */
function wireChartClick(chart, scope) {
  if (!chart) return;

  chart.canvas.onclick = (evt) => {
    const points = chart.getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
    if (!points || points.length === 0) return;

    const first = points[0];
    const raw = chart.data.datasets[first.datasetIndex].data[first.index];
    const x = raw?.x;
    const y = raw?.y;

    if (scope === "reward") {
      const meta = raw?.meta;
      const lines = [
        `Withdraw: ${fmt(y, 6)} INJ`,
        x ? fmtTime(x) : "",
        meta?.source ? `Source: ${meta.source}` : "",
      ].filter(Boolean).join(" • ");
      toast("Reward point", lines);
    } else if (scope === "stake") {
      toast("Staked point", `${fmt(y, 4)} INJ • ${x ? fmtTime(x) : ""}`);
    } else if (scope === "networth") {
      toast("Net Worth", `${fmtUSD(y, 2)} • ${x ? fmtTime(x) : ""}`);
    } else if (scope === "price") {
      toast("Price", `${fmtUSD(y, 4)} • ${x ? fmtTime(x) : ""}`);
    } else if (scope === "apr") {
      toast("APR", `${fmtPct(y, 2)} • ${x ? fmtTime(x) : ""}`);
    }
  };
}

/* ================= UI: VALUES & BARS ================= */
function updateHeaderPrice() {
  // try common ids (da versioni precedenti)
  const priceEl = $("injPrice") || $("priceValue") || $("injPriceValue");
  const pctEl = $("injChange") || $("priceChange") || $("injChangeValue");

  if (priceEl) priceEl.textContent = fmtUSD(state.price, 4);
  if (pctEl) {
    const up = state.price24hChangePct >= 0;
    pctEl.textContent = `${up ? "+" : ""}${(state.price24hChangePct).toFixed(2)}%`;
    pctEl.classList.remove("up", "down", "flat");
    pctEl.classList.add(up ? "up" : "down");
  }

  // net worth big value + pnl
  const nwEl = $("netWorthValue") || $("netWorthUsd") || q(".networth-usd");
  if (nwEl) nwEl.textContent = fmtUSD(state.netWorth, 2);

  const pnlEl = $("netWorthPnl") || q(".networth-pnl");
  if (pnlEl) {
    // PnL: base on first point of selected timeframe
    const pts = filterByTf(state.series.netWorth, state.settings.nwTf);
    const first = pts[0]?.v;
    const last = pts[pts.length - 1]?.v;
    if (Number.isFinite(first) && Number.isFinite(last) && first > 0) {
      const diff = last - first;
      const pct = diff / first;
      pnlEl.textContent = `${diff >= 0 ? "+" : ""}${fmtUSD(diff, 2)} (${diff >= 0 ? "+" : ""}${(pct * 100).toFixed(2)}%)`;
      pnlEl.classList.remove("good", "bad", "flat");
      pnlEl.classList.add(diff > 0 ? "good" : diff < 0 ? "bad" : "flat");
    } else {
      pnlEl.textContent = "PnL: —";
      pnlEl.classList.remove("good", "bad");
      pnlEl.classList.add("flat");
    }
  }

  // owned mini card (se presente)
  const ownedEl = $("ownedValue") || $("injOwnedValue");
  if (ownedEl) ownedEl.textContent = `${fmt(state.totalOwned, 4)} INJ`;

  const ownedSub = $("ownedSub") || $("injOwnedSub");
  if (ownedSub) ownedSub.textContent = `Available ${fmt(state.available, 4)} • Rewards ${fmt(state.rewards, 4)}`;

  // staked, rewards
  const stakedEl = $("stakedValue") || $("stakeValue");
  if (stakedEl) stakedEl.textContent = `${fmt(state.staked, 4)} INJ`;
  const rewardsEl = $("rewardsValue") || $("rewardValue");
  if (rewardsEl) rewardsEl.textContent = `${fmt(state.rewards, 4)} INJ`;

  // apr
  const aprEl = $("aprValue") || $("aprPctValue");
  if (aprEl) aprEl.textContent = fmtPct(state.apr, 2);
}

function updateBars() {
  // stake progress
  const stakeFill = $("stakeFill") || q(".stake-fill") || q(".stake-container .bar-fill");
  const stakePct = $("stakePercent") || q(".stake-percent");
  const stakeRight = $("stakeRight") || q(".bar-values .right");
  const stakeLeft = $("stakeLeft") || q(".bar-values .left");
  const stakeCenter = $("stakeCenter") || q(".bar-values .center");

  const sMax = Math.max(1e-6, Number(state.settings.stakeTarget) || DEFAULT_STAKE_TARGET);
  const sPct = clamp(state.staked / sMax, 0, 1);

  if (stakeFill) {
    stakeFill.style.width = `${(sPct * 100).toFixed(2)}%`;
    stakeFill.classList.add("stake-fill");
  }
  if (stakePct) stakePct.textContent = `${(sPct * 100).toFixed(1)}%`;
  if (stakeLeft) stakeLeft.textContent = "0";
  if (stakeCenter) stakeCenter.textContent = `${fmt(sMax / 2, 2)}`;
  if (stakeRight) stakeRight.textContent = `${fmt(sMax, 2)}`;

  // reward progress
  const rewardFill = $("rewardFill") || q(".reward-fill") || q(".reward-container .bar-fill");
  const rewardPct = $("rewardPercent") || q(".reward-percent");
  const rwRight = $("rewardRight");
  const rwLeft = $("rewardLeft");
  const rwCenter = $("rewardCenter");

  const rMax = Math.max(1e-6, Number(state.settings.rewardTarget) || DEFAULT_REWARD_TARGET);
  const rPct = clamp(state.rewards / rMax, 0, 1);

  if (rewardFill) {
    rewardFill.style.width = `${(rPct * 100).toFixed(2)}%`;
    rewardFill.classList.add("reward-fill");
  }
  if (rewardPct) rewardPct.textContent = `${(rPct * 100).toFixed(1)}%`;
  if (rwLeft) rwLeft.textContent = "0";
  if (rwCenter) rwCenter.textContent = `${fmt(rMax / 2, 4)}`;
  if (rwRight) rwRight.textContent = `${fmt(rMax, 4)}`;
}

/* ================= REWARD ESTIMATES (daily/weekly/monthly) ================= */
function renderRewardEstimates() {
  // We estimate based on last 24h withdrawals + current rewards drift is unknown.
  // Practical approach: use mean withdraw rate in timeframe 1w, project.
  const host = q(".reward-estimates");
  if (!host) return;

  const pts = filterByTf(state.series.rewardWd, "1w");
  if (pts.length < 2) {
    qa(".reward-est .v", host).forEach(v => v.textContent = "—");
    return;
  }

  // compute total withdrawn in window / days
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const days = Math.max(0.01, (t1 - t0) / (24 * 60 * 60 * 1000));
  const sum = pts.reduce((a, p) => a + (Number(p.v) || 0), 0);
  const daily = sum / days;
  const weekly = daily * 7;
  const monthly = daily * 30;

  const map = {
    daily: daily,
    weekly: weekly,
    monthly: monthly,
  };

  qa(".reward-est", host).forEach((box) => {
    const k = box.dataset.key || "";
    const vEl = q(".v", box);
    if (!vEl) return;
    const val = map[k];
    vEl.textContent = Number.isFinite(val) ? `${fmt(val, 6)} INJ` : "—";
  });
}

/* ================= DATA: PRICE ================= */
async function tickPrice(force = false) {
  if (!isOnline()) {
    setConnStatus("offline", "Offline");
    return;
  }

  if (!force && state.modeLoading) return;

  try {
    setConnStatus("loading", "Connecting…");

    const [p, p24] = await Promise.all([
      fetchJson(BINANCE_PRICE_URL),
      fetchJson(BINANCE_24H_URL),
    ]);

    const price = Number(p?.price);
    const changePct = Number(p24?.priceChangePercent);

    if (Number.isFinite(price) && price > 0) {
      state.pricePrev = state.price || price;
      state.price = price;
      state.price24hChangePct = Number.isFinite(changePct) ? changePct : 0;

      // live series 1m and 5m
      addLivePricePoint(price);

      // price threshold events
      detectPriceThresholdEvents(price);

      setConnStatus("ok", state.mode === MODE_LIVE ? "LIVE" : "Connected");
      updateDerived();
      updateHeaderPrice();
      updateBars();
      refreshNetWorthSeries();
      refreshPriceSeries();

      updateFooterMeta();
    } else {
      throw new Error("Bad price");
    }
  } catch (e) {
    setConnStatus("offline", "Offline");
  }
}

function addLivePricePoint(price) {
  // 1m aggregator: one point per minute (update last if same minute)
  const t = now();
  const m = Math.floor(t / ONE_MIN_MS) * ONE_MIN_MS;

  // 1m
  const s1 = state.series.priceLive1m;
  if (!s1.length || Math.floor(s1[s1.length - 1].t / ONE_MIN_MS) * ONE_MIN_MS !== m) {
    s1.push({ t: m, v: price });
  } else {
    s1[s1.length - 1].v = price;
  }
  // keep last ~3 days of points
  state.series.priceLive1m = trimSeries(s1, 5000);

  // 5m aggregator
  const m5 = Math.floor(t / (5 * ONE_MIN_MS)) * (5 * ONE_MIN_MS);
  const s5 = state.series.priceLive5m;
  if (!s5.length || Math.floor(s5[s5.length - 1].t / (5 * ONE_MIN_MS)) * (5 * ONE_MIN_MS) !== m5) {
    s5.push({ t: m5, v: price });
  } else {
    s5[s5.length - 1].v = price;
  }
  state.series.priceLive5m = trimSeries(s5, 5000);
}

/* ================= DATA: ACCOUNT (available/staked/rewards) ================= */
async function tickAccount(force = false) {
  if (!state.addr) return;
  if (!isOnline()) {
    setConnStatus("offline", "Offline");
    return;
  }

  try {
    if (!force && state.modeLoading) return;
    setConnStatus("loading", "Loading…");

    const { available, staked, rewards } = await fetchAccountSnapshot(state.addr);

    const a = Number(available) || 0;
    const s = Number(staked) || 0;
    const r = Number(rewards) || 0;

    // detect events: reward withdraw (rewards decrease), stake change
    detectRewardWithdraw(r);
    detectStakeChange(s);

    state.available = a;
    state.staked = s;
    state.rewards = r;

    updateDerived();
    updateHeaderPrice();
    updateBars();

    // points:
    addStakePoint(s);
    addNetWorthPoint();

    // implied APR update + point if changed
    updateAprAndSeries();

    // persist
    saveAddrData(state.addr);
    cloudWrite(state.addr).catch(() => {});

    // refresh charts
    refreshStakeSeries();
    refreshRewardSeries();
    refreshNetWorthSeries();
    refreshAprSeries();

    setConnStatus("ok", state.mode === MODE_LIVE ? "LIVE" : "Connected");
    updateFooterMeta();
  } catch (e) {
    setConnStatus("offline", "Offline");
  }
}

async function fetchAccountSnapshot(addr) {
  // Try multiple LCD bases until one works
  let lastErr = null;
  for (const base of INJ_LCD_BASES) {
    try {
      // bank balances
      const bank = await fetchJson(LCD.bank(base, addr));
      const balances = bank?.balances || [];

      // available INJ denom can differ; Injective uses "inj" (often "inj" or "uinj")
      // We'll detect both and normalize:
      const injBal = pickDenom(balances, ["inj", "uinj"]);
      const available = denomToInj(injBal);

      // delegations
      const del = await fetchJson(LCD.stakingDelegations(base, addr));
      const delegations = del?.delegation_responses || [];
      let staked = 0;
      for (const d of delegations) {
        const amt = Number(d?.balance?.amount);
        const denom = d?.balance?.denom || "";
        if (Number.isFinite(amt)) staked += denomToInj({ amount: String(amt), denom });
      }

      // rewards
      const rew = await fetchJson(LCD.distributionRewards(base, addr));
      const total = rew?.total || [];
      const injRew = pickDenom(total, ["inj", "uinj"]);
      const rewards = denomToInj(injRew);

      return { available, staked, rewards };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("LCD fetch failed");
}

function pickDenom(arr, denoms) {
  if (!Array.isArray(arr)) return null;
  for (const d of denoms) {
    const hit = arr.find(x => String(x?.denom || "").toLowerCase() === d);
    if (hit) return hit;
  }
  // fallback: if only one balance exists
  return arr[0] || null;
}

function denomToInj(obj) {
  if (!obj) return 0;
  const denom = String(obj.denom || "").toLowerCase();
  const amount = Number(obj.amount);
  if (!Number.isFinite(amount)) return 0;
  if (denom === "uinj") return amount / 1_000_000;
  return amount;
}

/* ================= DERIVED ================= */
function updateDerived() {
  state.totalOwned = (state.available || 0) + (state.staked || 0) + (state.rewards || 0);
  state.netWorth = state.totalOwned * (state.price || 0);

  // update mini asset row if exists (net worth card)
  const qty = q(".nw-asset-qty");
  const px = q(".nw-asset-price");
  const usd = q(".nw-asset-usd");
  if (qty) qty.textContent = `${fmt(state.totalOwned, 4)} INJ`;
  if (px) px.textContent = fmtUSD(state.price, 4);
  if (usd) usd.textContent = fmtUSD(state.netWorth, 2);
}

/* ================= POINTS (NETWORTH / STAKE / APR) ================= */
function addNetWorthPoint() {
  if (!state.addr) return;
  if (!Number.isFinite(state.netWorth) || state.netWorth <= 0) return;

  const t = now();
  const m = Math.floor(t / ONE_MIN_MS) * ONE_MIN_MS;

  const s = state.series.netWorth;
  if (!s.length || Math.floor(s[s.length - 1].t / ONE_MIN_MS) * ONE_MIN_MS !== m) {
    s.push({ t: m, v: state.netWorth });
  } else {
    s[s.length - 1].v = state.netWorth;
  }
  state.series.netWorth = trimSeries(s, NW_MAX_POINTS);
}

function addStakePoint(staked) {
  if (!state.addr) return;
  if (!Number.isFinite(staked) || staked < 0) return;

  const t = now();
  const m = Math.floor(t / ONE_MIN_MS) * ONE_MIN_MS;

  const s = state.series.stake;
  if (!s.length || Math.floor(s[s.length - 1].t / ONE_MIN_MS) * ONE_MIN_MS !== m) {
    s.push({ t: m, v: staked });
  } else {
    s[s.length - 1].v = staked;
  }
  state.series.stake = trimSeries(s, STAKE_MAX_POINTS);
}

function updateAprAndSeries() {
  // Implied APR: daily reward estimate / staked * 365
  // daily estimate: from last 7d withdrawals rate (best-effort)
  const st = state.staked;
  let apr = 0;
  if (st > 0) {
    const pts = filterByTf(state.series.rewardWd, "1w");
    if (pts.length >= 2) {
      const t0 = pts[0].t;
      const t1 = pts[pts.length - 1].t;
      const days = Math.max(0.01, (t1 - t0) / (24 * 60 * 60 * 1000));
      const sum = pts.reduce((a, p) => a + (Number(p.v) || 0), 0);
      const daily = sum / days;
      apr = (daily * 365) / st; // ratio (0.12 => 12%)
    }
  }
  if (!Number.isFinite(apr) || apr < 0) apr = 0;
  state.apr = apr;

  detectAprChange(apr);

  // add point only when APR changes meaningfully
  const last = state.series.apr[state.series.apr.length - 1]?.v;
  const delta = Math.abs((last ?? apr) - apr);
  if (state.series.apr.length === 0 || delta > 0.0005) {
    const t = Math.floor(now() / ONE_MIN_MS) * ONE_MIN_MS;
    state.series.apr.push({ t, v: apr });
    state.series.apr = trimSeries(state.series.apr, APR_MAX_POINTS);
  }
}

/* ================= EVENTS DETECTION ================= */
function pushEvent(ev) {
  state.events.unshift(ev);
  state.events = trimSeries(state.events, 2500);
}

function detectRewardWithdraw(currentRewards) {
  const prev = state.last.rewards;
  state.last.rewards = currentRewards;

  if (!Number.isFinite(prev)) return;

  const diff = prev - currentRewards;
  if (diff > REWARD_WITHDRAW_THRESHOLD) {
    const v = diff;

    const t = now();
    state.series.rewardWd.push({
      t,
      v,
      meta: {
        source: "rewards-delta",
      },
    });
    state.series.rewardWd = trimSeries(state.series.rewardWd, WD_MAX_POINTS);

    pushEvent({
      t,
      type: "reward_withdraw",
      title: "Reward withdrawn",
      detail: `${fmt(v, 6)} INJ`,
      status: "ok",
      meta: { amount: v },
    });
  }
}

function detectStakeChange(currentStaked) {
  const prev = state.last.staked;
  state.last.staked = currentStaked;
  if (!Number.isFinite(prev)) return;

  const diff = currentStaked - prev;
  if (Math.abs(diff) > 0.0005) {
    pushEvent({
      t: now(),
      type: "stake_change",
      title: "Stake changed",
      detail: `${diff >= 0 ? "+" : ""}${fmt(diff, 4)} INJ`,
      status: "ok",
      meta: { diff },
    });
  }
}

function detectAprChange(currentApr) {
  const prev = state.last.apr;
  state.last.apr = currentApr;
  if (!Number.isFinite(prev)) return;

  const diff = currentApr - prev;
  if (Math.abs(diff) > 0.0008) {
    pushEvent({
      t: now(),
      type: "apr_change",
      title: "APR changed",
      detail: `${fmtPct(prev, 2)} → ${fmtPct(currentApr, 2)}`,
      status: "ok",
      meta: { prev, current: currentApr, diff },
    });
  }
}

function detectPriceThresholdEvents(price) {
  if (!Number.isFinite(price) || price <= 0) return;

  // reference resets when address changes or on first run
  if (!Number.isFinite(state.last.priceRef) || state.last.priceRef <= 0) {
    state.last.priceRef = price;
    state.last.price = price;
    return;
  }

  const ref = state.last.priceRef;
  const pctMove = (price - ref) / ref;

  // create events for thresholds crossed
  for (const th of PRICE_THRESHOLDS) {
    const k = `th_${Math.round(th * 100)}`;
    const already = state._priceThCross?.[k];
    const crossedUp = pctMove >= th;
    const crossedDown = pctMove <= -th;

    if (!state._priceThCross) state._priceThCross = {};

    if ((crossedUp || crossedDown) && !already) {
      state._priceThCross[k] = true;

      pushEvent({
        t: now(),
        type: "price_move",
        title: `Price moved ${Math.round(th * 100)}%`,
        detail: `${crossedUp ? "↑" : "↓"} ${fmtPct(Math.abs(pctMove), 2)} • ${fmtUSD(ref, 4)} → ${fmtUSD(price, 4)}`,
        status: "ok",
        meta: { ref, price, pctMove, th },
      });
    }

    // reset threshold latch when it returns close to ref
    if (Math.abs(pctMove) < th * 0.35) {
      state._priceThCross[k] = false;
    }
  }

  // update priceRef occasionally so events remain meaningful
  const prev = state.last.price;
  state.last.price = price;

  // if price stabilizes or time passes, move ref
  if (Number.isFinite(prev)) {
    const small = Math.abs((price - prev) / prev) < 0.005;
    if (small) {
      // slow drift toward current
      state.last.priceRef = state.last.priceRef * 0.98 + price * 0.02;
    }
  }
}

/* ================= EVENTS PAGE RENDER ================= */
function ensureEventsControls() {
  // Buttons may exist in HTML; if not, we create minimal UI inside events page card.
  const page = q(".page-events") || q('.page[data-name="Event"]') || q('.page[data-name="Events"]');
  if (!page) return;

  // head/toolbar
  let toolbar = q(".events-toolbar", page);
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "events-toolbar";
    toolbar.innerHTML = `
      <div class="events-actions">
        <button class="events-icon-btn" id="evFilterBtn" title="Filters">⛭</button>
        <button class="events-icon-btn" id="evResetBtn" title="Reset">🗑</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <select class="mini-select" id="evTypeSel">
          <option value="all">All types</option>
          <option value="reward_withdraw">Reward withdraw</option>
          <option value="stake_change">Stake change</option>
          <option value="apr_change">APR change</option>
          <option value="price_move">Price move</option>
          <option value="cex_flow">CEX flow (hook)</option>
        </select>
        <select class="mini-select" id="evStatusSel">
          <option value="all">All status</option>
          <option value="ok">OK</option>
          <option value="warn">Warn</option>
          <option value="err">Error</option>
        </select>
      </div>
    `;
    page.prepend(toolbar);
  }
}

function renderEvents() {
  ensureEventsControls();

  const typeSel = $("evTypeSel");
  const statusSel = $("evStatusSel");
  const resetBtn = $("evResetBtn");
  const filterBtn = $("evFilterBtn"); // just a UX affordance

  if (filterBtn) {
    filterBtn.onclick = () => toast("Filters", "Use the dropdowns to filter events");
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!state.addr) return;
      state.events = [];
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      toast("Events", "Reset complete");
      renderEvents();
    };
  }

  const wrap = q(".events-table-wrap") || q(".events-card .events-table-wrap");
  const table = q(".events-table");
  const empty = q(".events-empty");

  // if missing HTML table, build it
  let container = q(".events-card");
  if (!container) container = q(".events-card", document.body);

  if (!container) {
    // create minimal container inside events page
    const page = q(".page-events") || q('.page[data-name="Event"]') || q('.page[data-name="Events"]');
    if (!page) return;

    container = document.createElement("div");
    container.className = "events-card";
    container.innerHTML = `
      <div class="events-table-wrap">
        <table class="events-table">
          <thead>
            <tr>
              <th>Time</th><th>Type</th><th>Detail</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="eventsTbody"></tbody>
        </table>
      </div>
      <div class="events-empty" id="eventsEmpty" style="display:none"></div>
      <div class="events-pagination" id="eventsPaging"></div>
    `;
    page.appendChild(container);
  }

  const tbody = $("eventsTbody") || q(".events-table tbody") || q("tbody", container);
  const emptyEl = $("eventsEmpty") || q(".events-empty", container);
  const paging = $("eventsPaging") || q(".events-pagination", container);

  const type = typeSel ? typeSel.value : "all";
  const status = statusSel ? statusSel.value : "all";

  const list = (state.events || []).filter((e) => {
    if (type !== "all" && e.type !== type) return false;
    if (status !== "all" && e.status !== status) return false;
    return true;
  });

  // pagination state
  if (!state._evPage) state._evPage = 1;
  const totalPages = Math.max(1, Math.ceil(list.length / EVENTS_PAGE_SIZE));
  state._evPage = clamp(state._evPage, 1, totalPages);

  const start = (state._evPage - 1) * EVENTS_PAGE_SIZE;
  const items = list.slice(start, start + EVENTS_PAGE_SIZE);

  // render rows
  if (tbody) tbody.innerHTML = "";
  if (items.length === 0) {
    if (emptyEl) {
      emptyEl.style.display = "block";
      emptyEl.textContent = state.addr ? "No events yet for this address." : "Enter an address first.";
    }
  } else {
    if (emptyEl) emptyEl.style.display = "none";
    for (const e of items) {
      const tr = document.createElement("tr");

      const typeLabel =
        e.type === "reward_withdraw" ? "Reward" :
        e.type === "stake_change" ? "Stake" :
        e.type === "apr_change" ? "APR" :
        e.type === "price_move" ? "Price" :
        e.type === "cex_flow" ? "CEX" : e.type;

      const pill = `<span class="ev-pill"><span class="ev-dot ${e.status === "ok" ? "ok" : e.status === "err" ? "err" : ""}"></span>${escapeHtml(typeLabel)}</span>`;
      const statusTxt = e.status || "ok";

      tr.innerHTML = `
        <td style="white-space:nowrap">${escapeHtml(fmtTime(e.t))}</td>
        <td>${pill}</td>
        <td><div style="font-weight:950">${escapeHtml(e.title || "")}</div>
            <div style="opacity:.75;font-weight:800;margin-top:2px">${escapeHtml(e.detail || "")}</div>
        </td>
        <td style="white-space:nowrap;font-weight:950">${escapeHtml(statusTxt.toUpperCase())}</td>
      `;

      tbody.appendChild(tr);
    }
  }

  // paging buttons
  if (paging) {
    paging.innerHTML = "";
    if (totalPages > 1) {
      for (let i = 1; i <= totalPages; i++) {
        const b = document.createElement("button");
        b.className = "page-btn" + (i === state._evPage ? " active" : "");
        b.textContent = String(i);
        b.onclick = () => {
          state._evPage = i;
          renderEvents();
        };
        paging.appendChild(b);
      }
    }
  }
}

/* ================= HOOK: CEX FLOW (NOT reliable without indexer) ================= */
async function tryDetectCexFlowsHook(/* addr */) {
  // 🔌 Hook pronto: qui potrai integrare un indexer / explorer API
  // per classificare indirizzi exchange e generare eventi:
  //  {type:"cex_flow", title:"Exchange deposit", detail:"Binance +123 INJ", ...}
  //
  // Esempio (pseudo):
  // const txs = await fetchJson(`https://<indexer>/txs?address=${addr}`);
  // txs.forEach(tx => { if (isCex(tx.to)) pushEvent(...) })
  return;
}

/* ================= HISTORICAL PRICE (klines) ================= */
async function loadPriceHistory(tf) {
  // tf: 1d|1w|1m|1y
  // map -> interval + limit
  let interval = "1m";
  let limit = 1440; // 1d

  if (tf === "1w") { interval = "15m"; limit = 7 * 24 * 4; }     // 15m points
  if (tf === "1m") { interval = "1h"; limit = 30 * 24; }         // hourly
  if (tf === "1y") { interval = "1d"; limit = 365; }             // daily

  try {
    const url = `${BINANCE_KLINES_URL}&interval=${interval}&limit=${limit}`;
    const rows = await fetchJson(url);
    const pts = (rows || []).map(r => ({
      t: Number(r[0]),
      v: Number(r[4]), // close
    })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v));

    if (!state._priceHist) state._priceHist = {};
    state._priceHist[tf] = pts;
  } catch {
    // ignore; keep old
  }
}

/* ================= BUTTONS: SCALE + TIMEFRAMES ================= */
function syncScaleButtonsUI() {
  // NetWorth scale button
  const nwBtn = $("nwScaleBtn") || q(".nw-scale-btn");
  if (nwBtn) nwBtn.textContent = state.settings.nwScale === "logarithmic" ? "LOG" : "LIN";

  // Stake/Reward/Price/APR (if exist)
  const stakeBtn = $("stakeScaleBtn") || q('[data-scale="stake"]');
  if (stakeBtn) stakeBtn.textContent = state.settings.stakeScale === "logarithmic" ? "LOG" : "LIN";

  const rewardBtn = $("rewardScaleBtn") || q('[data-scale="reward"]');
  if (rewardBtn) rewardBtn.textContent = state.settings.rewardScale === "logarithmic" ? "LOG" : "LIN";

  const priceBtn = $("priceScaleBtn") || q('[data-scale="price"]');
  if (priceBtn) priceBtn.textContent = state.settings.priceScale === "logarithmic" ? "LOG" : "LIN";

  const aprBtn = $("aprScaleBtn") || q('[data-scale="apr"]');
  if (aprBtn) aprBtn.textContent = state.settings.aprScale === "logarithmic" ? "LOG" : "LIN";
}

function syncTimeframeButtonsUI() {
  // net worth tf buttons: .networth-tf .tf-btn
  qa(".networth-tf .tf-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.tf || "").toLowerCase() === state.settings.nwTf);
  });

  // stake/reward mini tfs (if any)
  qa("#stakeCard .mini-tf .tf-btn, .stake-card .mini-tf .tf-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.tf || "").toLowerCase() === state.settings.stakeTf);
  });
  qa("#rewardCard .mini-tf .tf-btn, .reward-card .mini-tf .tf-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.tf || "").toLowerCase() === state.settings.rewardTf);
  });

  // price tf
  qa("#priceCard .tf-switch .tf-btn, .price-card .tf-switch .tf-btn").forEach((b) => {
    b.classList.toggle("active", (b.dataset.tf || "").toLowerCase() === state.settings.priceTf);
  });

  // price live interval
  const live1 = $("priceLive1mBtn");
  const live5 = $("priceLive5mBtn");
  if (live1) live1.classList.toggle("active", state.settings.priceLiveInterval === "1m");
  if (live5) live5.classList.toggle("active", state.settings.priceLiveInterval === "5m");
}

function wireScaleButtons() {
  // Net worth: only scale toggle next to price (come richiesto)
  const nwBtn = $("nwScaleBtn") || q(".nw-scale-btn");
  if (nwBtn) {
    nwBtn.addEventListener("click", () => {
      state.settings.nwScale = state.settings.nwScale === "linear" ? "logarithmic" : "linear";
      syncScaleButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      buildNetWorthChart();
      toast("Net Worth scale", state.settings.nwScale === "linear" ? "Linear" : "Logarithmic");
    });
  }

  // stake
  const stakeBtn = $("stakeScaleBtn") || q('[data-scale="stake"]');
  if (stakeBtn) {
    stakeBtn.addEventListener("click", () => {
      state.settings.stakeScale = state.settings.stakeScale === "linear" ? "logarithmic" : "linear";
      syncScaleButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      buildStakeChart();
      toast("Stake scale", state.settings.stakeScale === "linear" ? "Linear" : "Logarithmic");
    });
  }

  // reward
  const rewardBtn = $("rewardScaleBtn") || q('[data-scale="reward"]');
  if (rewardBtn) {
    rewardBtn.addEventListener("click", () => {
      state.settings.rewardScale = state.settings.rewardScale === "linear" ? "logarithmic" : "linear";
      syncScaleButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      buildRewardChart();
      toast("Reward scale", state.settings.rewardScale === "linear" ? "Linear" : "Logarithmic");
    });
  }

  // price
  const priceBtn = $("priceScaleBtn") || q('[data-scale="price"]');
  if (priceBtn) {
    priceBtn.addEventListener("click", () => {
      state.settings.priceScale = state.settings.priceScale === "linear" ? "logarithmic" : "linear";
      syncScaleButtonsUI();
      buildPriceChart();
      toast("Price scale", state.settings.priceScale === "linear" ? "Linear" : "Logarithmic");
    });
  }

  // apr
  const aprBtn = $("aprScaleBtn") || q('[data-scale="apr"]');
  if (aprBtn) {
    aprBtn.addEventListener("click", () => {
      state.settings.aprScale = state.settings.aprScale === "linear" ? "logarithmic" : "linear";
      syncScaleButtonsUI();
      buildAprChart();
      toast("APR scale", state.settings.aprScale === "linear" ? "Linear" : "Logarithmic");
    });
  }
}

function wireTimeframeButtons() {
  // Net worth tf
  qa(".networth-tf .tf-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const tf = (b.dataset.tf || "all").toLowerCase();
      state.settings.nwTf = tf;
      syncTimeframeButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      refreshNetWorthSeries();
    });
  });

  // Stake mini tf
  qa(".stake-card .mini-tf .tf-btn, #stakeCard .mini-tf .tf-btn, .mini-tf[data-scope='stake'] .tf-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const tf = (b.dataset.tf || "1m").toLowerCase();
      state.settings.stakeTf = tf;
      syncTimeframeButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      refreshStakeSeries();
      refreshAprSeries(); // apr uses same tf
    });
  });

  // Reward mini tf
  qa(".reward-card .mini-tf .tf-btn, #rewardCard .mini-tf .tf-btn, .mini-tf[data-scope='reward'] .tf-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const tf = (b.dataset.tf || "1m").toLowerCase();
      state.settings.rewardTf = tf;
      syncTimeframeButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      refreshRewardSeries();
    });
  });

  // Price tf
  qa(".price-card .tf-switch .tf-btn, #priceCard .tf-switch .tf-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const tf = (b.dataset.tf || "1d").toLowerCase();
      state.settings.priceTf = tf;
      syncTimeframeButtonsUI();
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      if (tf !== "all") {
        await loadPriceHistory(tf);
      }
      refreshPriceSeries();
    });
  });

  // Price live interval buttons (if exist)
  const live1 = $("priceLive1mBtn");
  const live5 = $("priceLive5mBtn");
  if (live1) live1.addEventListener("click", () => {
    state.settings.priceLiveInterval = "1m";
    syncTimeframeButtonsUI();
    refreshPriceSeries();
  });
  if (live5) live5.addEventListener("click", () => {
    state.settings.priceLiveInterval = "5m";
    syncTimeframeButtonsUI();
    refreshPriceSeries();
  });

  // Reward filter select
  const rewardFilter = $("rewardFilter") || q("#rewardCard .mini-select") || q(".reward-tools .mini-select");
  if (rewardFilter) {
    rewardFilter.value = state.settings.rewardFilter;
    rewardFilter.addEventListener("change", () => {
      state.settings.rewardFilter = rewardFilter.value;
      saveAddrData(state.addr);
      cloudWrite(state.addr).catch(() => {});
      refreshRewardSeries();
      toast("Reward filter", rewardFilter.options[rewardFilter.selectedIndex]?.textContent || rewardFilter.value);
    });
  }
}

/* ================= FULLSCREEN CARD EXPAND ================= */
function wireCardExpand() {
  qa(".card-expand").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      if (!card) return;

      const expanded = card.classList.contains("fullscreen");
      if (expanded) {
        card.classList.remove("fullscreen");
        document.body.classList.remove("card-expanded");
        toast("View", "Collapsed");
        // chart resize
        resizeAllCharts();
      } else {
        // collapse others
        qa(".card.fullscreen").forEach(c => c.classList.remove("fullscreen"));
        card.classList.add("fullscreen");
        document.body.classList.add("card-expanded");
        toast("View", "Expanded");
        resizeAllCharts();
      }
    });
  });

  // ESC to exit expanded
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const card = q(".card.fullscreen");
      if (card) {
        card.classList.remove("fullscreen");
        document.body.classList.remove("card-expanded");
        resizeAllCharts();
      }
    }
  });
}

function resizeAllCharts() {
  Object.values(state.charts).forEach((c) => {
    try { c?.resize(); } catch {}
  });
}

/* ================= FOOTER META ================= */
function updateFooterMeta() {
  const last = $("lastSync") || q(".pro-footer #lastSync");
  const utc = $("utcLabel") || q(".pro-footer #utcLabel");
  const api = $("apiLabel") || q(".pro-footer #apiLabel");
  const ws = $("wsLabel") || q(".pro-footer #wsLabel");

  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");

  if (last) last.textContent = `Last sync ${hh}:${mm}:${ss}`;
  if (utc) utc.textContent = TZ_LABEL;

  if (api) api.textContent = isOnline() ? "API Online" : "API Offline";
  if (ws) ws.textContent = state.mode === MODE_LIVE ? "WS Live" : "Refresh";
}

/* ================= APP ROOT LOADING CLASS ================= */
function setAppReady(ready) {
  const root = $("appRoot") || q(".container");
  if (!root) return;
  root.classList.remove("loading", "ready");
  root.classList.add(ready ? "ready" : "loading");
}

/* ================= LOOPS ================= */
function stopLoops() {
  const t = state.timers;
  if (t.price) clearInterval(t.price);
  if (t.account) clearInterval(t.account);
  if (t.safety) clearInterval(t.safety);
  t.price = t.account = t.safety = null;
}

function restartLoops() {
  stopLoops();

  const priceMs = state.mode === MODE_LIVE ? PRICE_POLL_MS_LIVE : PRICE_POLL_MS_REFRESH;
  const accMs = state.mode === MODE_LIVE ? ACCOUNT_POLL_MS_LIVE : ACCOUNT_POLL_MS_REFRESH;

  state.timers.price = setInterval(() => tickPrice(false), priceMs);
  state.timers.account = setInterval(() => tickAccount(false), accMs);

  // safety: refresh historical price based on selected tf
  state.timers.safety = setInterval(async () => {
    if (state.settings.priceTf && state.settings.priceTf !== "all") {
      await loadPriceHistory(state.settings.priceTf);
      refreshPriceSeries();
    }
    // optional hook
    if (state.addr) await tryDetectCexFlowsHook(state.addr);
  }, REST_SYNC_MS);
}

/* ================= INIT WIRES ================= */
function wireEverything() {
  wireDrawer();
  wireSearch();
  wireCopyAddress();
  wireGears();
  wireScaleButtons();
  wireTimeframeButtons();
  wireCardExpand();

  // online/offline listeners
  window.addEventListener("online", () => {
    toast("Network", "Online");
    setConnStatus("loading", "Connecting…");
    tickPrice(true);
    tickAccount(true);
  });
  window.addEventListener("offline", () => {
    toast("Network", "Offline");
    setConnStatus("offline", "Offline");
  });
}

/* ================= INIT DEFAULT UI ================= */
function initUI() {
  // header version / footer pills if exist
  const versionEl = $("appVersion") || q(".pro-footer .pro-pill.version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  // cloud status initial
  setCloudStatus("idle");

  // set theme
  applyTheme();

  // initial connection label
  setConnStatus(isOnline() ? "loading" : "offline", isOnline() ? "Connecting…" : "Offline");

  // page default
  // if there is a nav-item active with data-page, show it, else show dashboard
  const activeNav = q(".nav-item.active");
  if (activeNav?.dataset?.page) showPage(activeNav.dataset.page);
  else showPage("dashboard");

  updateFooterMeta();
}

/* ================= STARTUP ================= */
async function bootstrap() {
  setAppReady(false);

  loadGlobalPrefs();
  applyTheme();
  refreshModeUI();

  wireEverything();
  initUI();

  // build charts (even without address -> empty)
  rebuildAllCharts();

  // load last used address if present
  const lastAddr = lsGet("last_addr", "", "");
  if (lastAddr && normalizeAddr(lastAddr)) {
    await setAddress(lastAddr);
  } else {
    setAppReady(true);
  }

  // initial ticks
  await tickPrice(true);

  if (state.addr) await tickAccount(true);

  // load initial historical price if tf not all
  if (state.settings.priceTf && state.settings.priceTf !== "all") {
    await loadPriceHistory(state.settings.priceTf);
    refreshPriceSeries();
  }

  // start loops
  restartLoops();

  // finalize ready
  setTimeout(() => setAppReady(true), Math.max(0, INITIAL_SETTLE_TIME - (now() - settleStart)));
}

/* ================= PERSIST last addr ================= */
function persistLastAddr() {
  if (!state.addr) return;
  lsSet("last_addr", "", state.addr);
}

/* ================= SMALL FIXES: ensure labels in drawer toggle row (if present) ================= */
function ensureToggleLabels() {
  // optional: if HTML has wrappers with labels, fine. If not, do nothing.
  // We avoid injecting into drawer to not break structure.
}

/* ================= SAFETY: theme change refresh chart theme ================= */
const _origToggleTheme = toggleTheme;
function toggleThemeAndRefreshCharts() {
  _origToggleTheme();
  setChartTheme(state.charts.nw);
  setChartTheme(state.charts.stake);
  setChartTheme(state.charts.reward);
  setChartTheme(state.charts.price);
  setChartTheme(state.charts.apr);
}
function patchThemeToggleHandler() {
  const themeToggle = $("themeToggle");
  if (themeToggle) {
    themeToggle.removeEventListener("click", toggleTheme);
    themeToggle.addEventListener("click", toggleThemeAndRefreshCharts);
  }
}

/* ================= AUTO FIX: store last addr on change ================= */
function hookAddrPersistence() {
  const wrap = q(".search-wrap");
  if (!wrap) return;
  // whenever we set address, save
  const _setAddress = setAddress;
  setAddress = async function(addr) {
    await _setAddress(addr);
    persistLastAddr();
  };
}

/* ================= RUN ================= */
document.addEventListener("DOMContentLoaded", () => {
  // patch theme toggler (if already wired)
  patchThemeToggleHandler();
  hookAddrPersistence();
  bootstrap().catch((e) => {
    console.error(e);
    toast("Boot error", "Check console for details");
    setAppReady(true);
  });
});
```
