:root{
  --bg-dark: #000;
  --fg-dark: #f9fafb;
  --muted-dark: rgba(249,250,251,.70);

  --bg-light: #e7eaf0;
  --fg-light: #0f172a;
  --muted-light: rgba(15,23,42,.62);

  --card-dark-a: #0b1220;
  --card-dark-b: #111c2f;

  --card-light-a: #f0f2f6;
  --card-light-b: #e6eaf2;

  --bar-dark: rgba(255,255,255,0.08);
  --bar-light: rgba(15,23,42,0.06);

  --radius: 18px;
  --radius-sm: 14px;

  --green: #22c55e;
  --red: #ef4444;
  --amber: #f59e0b;
  --blue: #3b82f6;
  --cyan: #38bdf8;
  --purple: #8b5cf6;

  --gap: 1.15rem;      /* distanza tra card */
  --pad: 1.15rem;      /* padding interno card */
  --pad-lg: 1.25rem;
}

* { box-sizing: border-box; }
html, body { height: 100%; }

body{
  font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg-dark);
  color: var(--fg-dark);
  margin: 0;
  padding: 1rem;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* LIGHT THEME */
body[data-theme="light"]{
  background:
    radial-gradient(1200px 600px at 30% -10%, rgba(59,130,246,0.06), transparent 55%),
    radial-gradient(900px 500px at 90% 10%, rgba(34,197,94,0.05), transparent 55%),
    var(--bg-light);
  color: var(--fg-light);
}

.container{
  max-width: 900px;
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: .85rem;
}

/* ================= HEADER ================= */
.header{
  display: flex;
  flex-direction: column;
  gap: .55rem;
  margin-bottom: .15rem;
}

.header-grid{
  display: grid;
  grid-template-columns: 56px minmax(0,1fr) auto;
  align-items: center;
  gap: .7rem;
}

.header-left { display:flex; align-items:center; justify-content:flex-start; }

.menu-btn{
  width: 44px;
  height: 44px;
  font-size: 26px;
  font-weight: 800;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
  color: rgba(249,250,251,.95);
  cursor: pointer;
  outline: none;
}
body[data-theme="light"] .menu-btn{
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.92);
}
.menu-btn:active { transform: translateY(1px); }

.header-center{
  min-width: 0;
  display:flex;
  flex-direction:column;
  align-items:center;       /* ✅ titolo centrato */
  justify-content:center;
  text-align:center;
}

.brand-title{
  margin: 0;
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: .2px;
  font-size: 1.9rem;
  background: linear-gradient(90deg, #22c55e, #3b82f6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.brand-title .dot{ -webkit-text-fill-color: transparent; }

.subtitle{
  font-size: 0.9rem;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
body[data-theme="light"] .subtitle{ color: var(--muted-light); }

.header-right{
  display:flex;
  justify-content:flex-end;
  align-items:center;
  min-width: 0;
}

.search-wrap{
  display:flex;
  align-items:center;
  gap:.45rem;
  justify-content:flex-end;
  max-width: min(520px, 58vw);
  min-width: 0;
}

.icon-btn{
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
  color: rgba(249,250,251,.92);
  font-size: 18px;
  display: grid;
  place-items: center;
  cursor: pointer;
  outline: none;
}
body[data-theme="light"] .icon-btn{
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.92);
}
.icon-btn:active { transform: translateY(1px); }

.search-wrap input{
  width: 0px;
  opacity: 0;
  pointer-events: none;
  border: 1px solid transparent;
  outline: none;
  padding: 0;
  height: 38px;
  border-radius: 12px;
  background: rgba(255,255,255,0.06);
  color: #f9fafb;
  transition: width 220ms ease, opacity 160ms ease, padding 220ms ease, background 220ms ease, border-color 220ms ease;
  min-width: 0;
}
body[data-theme="light"] .search-wrap input{
  background: rgba(15,23,42,0.06);
  color: rgba(15,23,42,.92);
}

.search-wrap.open input{
  width: min(520px, 58vw);
  opacity: 1;
  pointer-events: auto;
  padding: 0 .9rem;
  border-color: rgba(255,255,255,.10);
  background: rgba(255,255,255,0.08);
}
body[data-theme="light"] .search-wrap.open input{
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,0.08);
}

.search-wrap input::placeholder{ color: rgba(249,250,251,.55); }
body[data-theme="light"] .search-wrap input::placeholder{ color: rgba(15,23,42,.55); }

.title-compact{ display:none; }
.title-full{ display:inline; }

/* quando la ricerca è aperta: compatto ma titolo resta centrato */
body.search-open .title-full{ display:none; }
body.search-open .title-compact{ display:inline; }
body.search-open #subtitle{ display:none; }

@media (max-width: 520px){
  .brand-title{ font-size: 1.45rem; }
  .search-wrap.open input{ width: min(360px, 60vw); }
}

.header-meta-right{
  display:flex;
  align-items:center;
  gap: .6rem;
  justify-content: flex-end;
}

.address-display{
  min-width: 0;
}
.address-display .tag{
  font-size: 0.74rem;
  color: rgba(249,250,251,.88);
  background: rgba(255,255,255,.06);
  border-radius: 999px;
  padding: .25rem .6rem;
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
body[data-theme="light"] .address-display .tag{
  background: rgba(15,23,42,0.06);
  color: rgba(15,23,42,.82);
}

/* Copy address button */
.copy-address-btn{
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.85);
  font-size: 16px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
body[data-theme="light"] .copy-address-btn{
  border-color: rgba(15,23,42,0.12);
  background: rgba(15,23,42,0.06);
  color: rgba(15,23,42,0.75);
}
.copy-address-btn:hover {
  background: rgba(59,130,246,0.15);
  transform: scale(1.05);
}
.copy-address-btn:active {
  transform: scale(0.95);
}
.copy-address-btn.copied {
  background: rgba(34,197,94,0.2);
  color: #22c55e;
}

.connection-status{
  display:inline-flex;
  align-items:center;
  gap:.35rem;
  opacity:.95;
  flex-shrink: 0;
}
.status-dot{
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  animation: pulse 1.7s infinite;
}
.status-text{
  font-size: 0.72rem;
  color: rgba(249,250,251,.78);
}
body[data-theme="light"] .status-text{ color: rgba(15,23,42,.70); }

@keyframes pulse{
  0% { transform: scale(1); opacity: 0.75; }
  50% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1); opacity: 0.75; }
}

/* ================= PAGES ================= */
.pages{
  display:block;
}
.page{
  display:none;
}
.page.active{
  display:block;
}

/* ================= CARDS ================= */
.cards-wrapper{
  display:flex;
  flex-direction: column;
  gap: var(--gap);              /* ✅ più spazio tra card */
  margin-top: .25rem;
}

.card{
  background: linear-gradient(135deg, var(--card-dark-a), var(--card-dark-b));
  border-radius: 0.9rem;
  padding: var(--pad);          /* ✅ più respiro interno */
  box-shadow: 0 20px 70px rgba(0,0,0,.35);
  border: 1px solid rgba(255,255,255,.08);
  position: relative;
}
body[data-theme="light"] .card{
  background: linear-gradient(135deg, var(--card-light-a), var(--card-light-b));
  box-shadow: 0 18px 55px rgba(2,6,23,.08);
  border-color: rgba(15,23,42,.10);
}

.label{
  font-size: 1.1rem;
  font-weight: 900;
  padding-right: 50px; /* spazio per il bottone expand */
  min-height: 28px;
}

.value-row{
  font-size: 1.4rem;
  font-weight: 900;
  text-align: right;
  margin-top: .35rem;
}

.sub-row{
  font-size: 0.9rem;
  color: #9ca3af;
  text-align: right;
  margin-top: .15rem;
}
body[data-theme="light"] .sub-row{ color: var(--muted-light); }

/* tools (expand icon in card) */
.card-tools{
  position:absolute;
  top: 12px;
  right: 12px;
  display:flex;
  gap:.4rem;
  z-index: 20;
}

/* expand icon: piccola e non invadente */
.card-expand{
  width: 30px;
  height: 30px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.90);
  font-weight: 900;
  font-size: 14px;
  display:grid;
  place-items:center;
  cursor:pointer;
}
body[data-theme="light"] .card-expand{
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.86);
}
.card-expand:active{ transform: translateY(1px); }

/* PERF */
.perf{
  display:flex;
  justify-content:flex-end;
  gap: 0.35rem;
  align-items:center;
  margin-top: .35rem;
}
.arrow.up { color: var(--green); }
.arrow.down { color: var(--red); }
.arrow.flat { color: #9ca3af; }

.pct.up { color: var(--green); }
.pct.down { color: var(--red); }
.pct.flat { color: #9ca3af; }

/* ================= BARS ================= */
.bar-container{
  position: relative;
  height: 24px;
  background: var(--bar-dark);
  border-radius: 0.55rem;
  overflow: hidden;
  margin-top: 1.05rem;
  margin-bottom: 0.2rem;
}
body[data-theme="light"] .bar-container{ background: var(--bar-light); }

.bar-fill{
  position:absolute;
  height: 100%;
  width: 0;
  transition: width 0.25s ease, left 0.25s ease, background 0.22s ease, background-position 0.25s ease;
  filter: saturate(1.05);
}

.bar-timeframe-label {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.75rem;
  font-weight: 950;
  letter-spacing: .08em;
  color: rgba(249, 250, 251, 0.90);
  pointer-events: none;
  text-shadow: 0 2px 14px rgba(0,0,0,0.85);
  padding: .14rem .5rem;
  border-radius: 999px;
  background: rgba(0,0,0,0.22);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
body[data-theme="light"] .bar-timeframe-label {
  color: rgba(15,23,42,.86);
  text-shadow:none;
  background: rgba(255,255,255,0.50);
}

.open-marker{
  position:absolute;
  left: 50%;
  top: 0;
  height: 100%;
  width: 2px;
  transform: translateX(-1px);
  background: rgba(249, 250, 251, 0.16);
  box-shadow: 0 0 12px rgba(249, 250, 251, 0.08);
  pointer-events:none;
}
body[data-theme="light"] .open-marker{
  background: rgba(15,23,42,.16);
  box-shadow: 0 0 12px rgba(15,23,42,.10);
}

.bar-line{
  position:absolute;
  width: 2px;
  height: 100%;
  background: linear-gradient(180deg, rgba(250,204,21,.95), rgba(245,158,11,.75));
  transition: left 0.25s ease;
}

.bar-label{
  position:absolute;
  left:50%;
  top:50%;
  transform: translate(-50%, -50%);
  font-size: 0.80rem;
  font-weight: 950;
  letter-spacing: .08em;
  color: rgba(249, 250, 251, 0.90);
  pointer-events:none;
  text-shadow: 0 2px 14px rgba(0,0,0,0.85);
  padding: .14rem .5rem;
  border-radius: 999px;
  background: rgba(0,0,0,0.22);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
body[data-theme="light"] .bar-label{
  color: rgba(15,23,42,.86);
  text-shadow:none;
  background: rgba(255,255,255,0.50);
}

.stake-percent,
.reward-percent{
  position:absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.90rem;
  font-weight: 950;
  letter-spacing: .04em;
  padding: .14rem .55rem;
  border-radius: 999px;
  background: rgba(0,0,0,0.22);
  color: rgba(249,250,251,0.92);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  text-shadow: 0 2px 14px rgba(0,0,0,0.65);
  pointer-events:none;
  z-index: 3;
}
body[data-theme="light"] .stake-percent,
body[data-theme="light"] .reward-percent{
  background: rgba(255,255,255,0.55);
  color: rgba(15,23,42,.90);
  text-shadow:none;
}

.bar-values{
  font-size: 0.8rem;
  color: #9ca3af;
  position: relative;
  height: 18px;
  margin-top: 0.6rem;
  padding-bottom: 0.25rem;
}
body[data-theme="light"] .bar-values{ color: var(--muted-light); }
.bar-values .left{ position:absolute; left:0; }
.bar-values .center{ position:absolute; left:50%; transform:translateX(-50%); }
.bar-values .right{ position:absolute; right:0; }

/* stake/reward gradients */
.stake-container{ height: 26px; }
.stake-fill{
  background: linear-gradient(90deg, rgba(34,197,94,.55), rgba(16,185,129,.45));
  background-size: 180% 100%;
  background-position: 0 0;
}
.reward-container{ height: 26px; }
.reward-fill{
  background: linear-gradient(90deg, rgba(59,130,246,.55), rgba(99,102,241,.45));
  background-size: 180% 100%;
  background-position: 0 0;
}

/* ================= CHARTS ================= */
.stake-chart-wrap { height: 175px; margin-top: 1rem; position: relative; }
.reward-chart-wrap{ height: 195px; margin-top: 1rem; position: relative; }
.apr-chart-wrap   { height: 160px; margin-top: 0.5rem; position: relative; }

#stakeChart, #rewardChart, #priceChart, #netWorthChart, #aprChart{
  width: 100% !important;
  height: 100% !important;
}

.chart-card{
  height: 320px;
  position: relative;
  padding-top: 1.1rem;
}

.chart-overlay{
  position:absolute;
  top: 12px;
  right: 52px; /* lascia spazio al pulsante expand */
  z-index: 10;
  font-size: 1.05rem;
  font-weight: 900;
  color: #f9fafb;
  pointer-events:none;
  text-shadow: 0 1px 10px rgba(0,0,0,0.55);
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 160ms ease, transform 160ms ease;
}
body[data-theme="light"] .chart-overlay{
  color: rgba(15,23,42,.92);
  text-shadow:none;
}
.chart-overlay.show{ opacity: .98; transform: translateY(0); }

/* ================= NET WORTH ================= */
.networth-card{
  position: relative;
  overflow: hidden;
  padding: var(--pad-lg);
}

/* riga top: titolo + expand */
.networth-top{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
}
.networth-title{
  font-size: 1.1rem;
  font-weight: 950;
}

/* top2: LIN/LOG */
.networth-top2{
  margin-top: .35rem;
  display:flex;
  align-items:center;
  justify-content: flex-end;
  gap: .55rem;
}

/* scale toggle */
.nw-scale-btn,
.stake-scale-btn,
.reward-scale-btn,
.apr-scale-btn,
.chart-scale-btn{
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.92);
  font-weight: 950;
  font-size: .75rem;
  cursor:pointer;
}
body[data-theme="light"] .nw-scale-btn,
body[data-theme="light"] .stake-scale-btn,
body[data-theme="light"] .reward-scale-btn,
body[data-theme="light"] .apr-scale-btn,
body[data-theme="light"] .chart-scale-btn{
  border-color: rgba(15,23,42,.14);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.88);
}
.nw-scale-btn:active,
.stake-scale-btn:active,
.reward-scale-btn:active,
.apr-scale-btn:active,
.chart-scale-btn:active{ transform: translateY(1px); }

/* metrics */
.networth-metrics{
  margin-top: .85rem;
}
.networth-usd{
  font-size: 2.05rem;
  font-weight: 950;
  line-height: 1.05;
  text-align:left;
}
.networth-pnl{
  margin-top: .55rem;
  font-size: .9rem;
  font-weight: 900;
  color: #9ca3af;
}
.networth-pnl.good{ color: var(--green); }
.networth-pnl.bad{ color: var(--red); }
.networth-pnl.flat{ color: #9ca3af; }
body[data-theme="light"] .networth-pnl{ color: var(--muted-light); }

/* chart */
.networth-chart{
  margin-top: 0.5rem;
  height: 280px;
  position: relative;
}

/* tf */
.networth-tf{
  margin-top: .9rem;
}
.tf-switch{
  display:flex;
  justify-content:center;
  gap: 8px;
  flex-wrap: wrap;
}
.tf-btn{
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.82);
  font-weight: 950;
  font-size: .72rem;
  cursor:pointer;
}
body[data-theme="light"] .tf-btn{
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.80);
}
.tf-btn.active{
  background: rgba(59,130,246,.18);
  border-color: rgba(59,130,246,.35);
  color: rgba(249,250,251,.96);
}
body[data-theme="light"] .tf-btn.active{
  background: rgba(59,130,246,.12);
  border-color: rgba(59,130,246,.26);
  color: rgba(15,23,42,.92);
}

/* hide asset row */
.networth-asset {
  display: none !important;
}

/* bottom mini boxes */
.networth-foot{
  margin-top: 1rem;
  display:flex;
  flex-direction: column;
  gap: .75rem;
}

.nw-mini{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 12px;
  padding: .9rem .9rem;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
}
body[data-theme="light"] .nw-mini{
  border-color: rgba(15,23,42,.10);
  background: rgba(15,23,42,.05);
}

.nw-mini-left{
  display:flex;
  align-items:center;
  gap: 10px;
  min-width: 0;
}
.nw-coin-logo-img{
  width: 32px;
  height: 32px;
  border-radius: 10px;
  object-fit: contain;
  background: rgba(59,130,246,.12);
  border: 1px solid rgba(255,255,255,.10);
  padding: 4px;
}
body[data-theme="light"] .nw-coin-logo-img{
  border-color: rgba(15,23,42,.10);
  background: rgba(59,130,246,.10);
}

.nw-mini-meta{
  display:flex;
  flex-direction:column;
  gap: 2px;
  min-width: 0;
}
.nw-mini-title{
  font-weight: 950;
  letter-spacing:.02em;
}
.nw-mini-sub{
  font-size: .78rem;
  color: rgba(249,250,251,.65);
  font-weight: 800;
  overflow:hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
body[data-theme="light"] .nw-mini-sub{ color: rgba(15,23,42,.60); }

.nw-mini-right{
  text-align:right;
  font-weight: 950;
  font-size: .95rem;
  flex-shrink: 0;
}

/* validator styles */
.nw-mini-single {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.18);
}
.nw-mini-validator {
  background: rgba(245, 158, 11, 0.08);
  border-color: rgba(245, 158, 11, 0.18);
}

.validator-right{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap: 10px;
}
.validator-dot{
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 16px rgba(245,158,11,.35);
  animation: vPulse 1.1s infinite;
}
@keyframes vPulse{
  0%{ transform: scale(1); opacity:.65; }
  50%{ transform: scale(1.35); opacity: 1; }
  100%{ transform: scale(1); opacity:.65; }
}

/* responsive */
@media (max-width: 520px){
  .networth-usd{ font-size: 1.75rem; }
  .networth-chart{ height: 270px; }
}

/* ================= STAKE CARD ENHANCEMENTS ================= */
.stake-scale-row,
.reward-scale-row {
  margin-top: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.range-control {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.range-config-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.85);
  font-size: 14px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
body[data-theme="light"] .range-config-btn {
  border-color: rgba(15,23,42,0.12);
  background: rgba(15,23,42,0.05);
  color: rgba(15,23,42,0.75);
}

.range-label {
  font-size: 0.72rem;
  font-weight: 900;
  color: rgba(249,250,251,0.75);
}
body[data-theme="light"] .range-label {
  color: rgba(15,23,42,0.65);
}

.stake-timeframe,
.reward-timeframe,
.chart-timeframe,
.apr-timeframe {
  margin-top: 0.8rem;
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.apr-timeframe-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.82);
  font-weight: 950;
  font-size: .72rem;
  cursor: pointer;
}
.apr-timeframe-btn.active {
  background: rgba(139, 92, 246, 0.18);
  border-color: rgba(139, 92, 246, 0.35);
  color: rgba(249,250,251,0.96);
}

.chart-tools {
  margin-top: 0.8rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

/* ================= REWARD ESTIMATES ================= */
.reward-estimates {
  margin-top: 1rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.8rem;
  background: rgba(59,130,246,0.06);
  border-radius: 12px;
  border: 1px solid rgba(59,130,246,0.12);
}

.estimate-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

.estimate-label {
  font-size: 0.7rem;
  font-weight: 900;
  color: rgba(249,250,251,0.75);
  letter-spacing: 0.03em;
}
body[data-theme="light"] .estimate-label {
  color: rgba(15,23,42,0.65);
}

.estimate-value {
  font-size: 0.85rem;
  font-weight: 950;
  color: rgba(249,250,251,0.95);
}
body[data-theme="light"] .estimate-value {
  color: rgba(15,23,42,0.9);
}

.estimate-item.highlight .estimate-value {
  color: var(--green);
}

/* ================= REWARD tools ================= */
.reward-tools{
  margin-top: .9rem;
  display:flex;
  align-items:center;
  justify-content: flex-end;
  gap:.75rem;
}

.mini-btn{
  height: 32px;
  padding: 0 .85rem;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.92);
  font-weight: 900;
  font-size: .76rem;
  cursor:pointer;
}
body[data-theme="light"] .mini-btn{
  border-color: rgba(15,23,42,.14);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.85);
}
.mini-btn:active{ transform: translateY(1px); }

.mini-select-wrap{
  display:flex;
  align-items:center;
  gap:.45rem;
}
.mini-select-label{
  font-size:.72rem;
  color: rgba(249,250,251,.68);
}
body[data-theme="light"] .mini-select-label{ color: rgba(15,23,42,.60); }

.mini-select{
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.06);
  color: rgba(249,250,251,0.9);
  padding: 0 .65rem;
  font-size: .76rem;
  outline:none;
}
body[data-theme="light"] .mini-select{
  border-color: rgba(15,23,42,.14);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.85);
}

.reward-timeline{
  margin-top: .9rem;
  display:flex;
  flex-direction: column;
  gap:.4rem;
}
.reward-timeline input[type="range"]{
  width: 100%;
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  border-radius: 99px;
  background: rgba(255,255,255,0.16);
  outline:none;
}
body[data-theme="light"] .reward-timeline input[type="range"]{ background: rgba(15,23,42,0.16); }

.reward-timeline input[type="range"]::-webkit-slider-thumb{
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(249,250,251,.95);
  border: 2px solid rgba(59,130,246,.65);
  cursor:pointer;
}

.reward-timeline-meta{
  font-size: .74rem;
  color: rgba(249,250,251,.72);
  text-align:right;
}
body[data-theme="light"] .reward-timeline-meta{ color: rgba(15,23,42,.68); }

/* ================= EVENTS PAGE ================= */
.page-events,
.page-tools,
.page-settings {
  margin-top: .6rem;
}

.events-head,
.tools-head,
.settings-head {
  display:flex;
  align-items:flex-end;
  justify-content: space-between;
  gap: 14px;
  margin: .25rem 0 .85rem 0;
}
.events-head h2,
.tools-head h2,
.settings-head h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 950;
  letter-spacing: .02em;
}
.events-sub,
.tools-sub,
.settings-sub {
  margin-top: .25rem;
  font-size: .86rem;
  color: rgba(249,250,251,.65);
}
body[data-theme="light"] .events-sub,
body[data-theme="light"] .tools-sub,
body[data-theme="light"] .settings-sub {
  color: rgba(15,23,42,.62);
}

.events-controls {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.events-filter {
  height: 34px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.90);
  padding: 0 12px;
  font-size: .78rem;
  font-weight: 900;
  outline: none;
}
body[data-theme="light"] .events-filter {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.86);
}

.events-badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--red);
  color: white;
  font-size: 0.7rem;
  font-weight: 900;
  display: grid;
  place-items: center;
  animation: badgePulse 1s infinite;
}
@keyframes badgePulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.events-clear {
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.90);
  font-weight: 900;
  cursor: pointer;
}
body[data-theme="light"] .events-clear {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.86);
}

.events-card,
.tools-grid,
.settings-card {
  background: linear-gradient(135deg, var(--card-dark-a), var(--card-dark-b));
  border-radius: 0.9rem;
  padding: var(--pad);
  box-shadow: 0 20px 70px rgba(0,0,0,.35);
  border: 1px solid rgba(255,255,255,.08);
}
body[data-theme="light"] .events-card,
body[data-theme="light"] .tools-grid,
body[data-theme="light"] .settings-card {
  background: linear-gradient(135deg, var(--card-light-a), var(--card-light-b));
  box-shadow: 0 18px 55px rgba(2,6,23,.08);
  border-color: rgba(15,23,42,.10);
}

.tools-grid {
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.events-table-wrap {
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.10);
}
body[data-theme="light"] .events-table-wrap {
  border-color: rgba(15,23,42,.10);
}

.events-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}
.events-table th,
.events-table td {
  padding: .75rem .75rem;
  font-size: .86rem;
  border-bottom: 1px solid rgba(255,255,255,.08);
  text-align: left;
}
body[data-theme="light"] .events-table th,
body[data-theme="light"] .events-table td {
  border-bottom-color: rgba(15,23,42,.08);
}
.events-table th {
  font-size: .78rem;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: rgba(249,250,251,.70);
  background: rgba(255,255,255,.04);
}
body[data-theme="light"] .events-table th {
  color: rgba(15,23,42,.62);
  background: rgba(15,23,42,.04);
}
.events-table tr:last-child td { border-bottom: none; }

.ev-pill {
  display:inline-flex;
  align-items:center;
  gap:.45rem;
  padding:.22rem .55rem;
  border-radius: 999px;
  font-weight: 900;
  font-size: .74rem;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
}
body[data-theme="light"] .ev-pill {
  border-color: rgba(15,23,42,.10);
  background: rgba(15,23,42,.04);
}

.ev-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 14px rgba(245,158,11,.30);
  animation: evPulse 1s infinite;
}
@keyframes evPulse {
  0% { transform: scale(1); opacity:.6; }
  50% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1); opacity:.6; }
}
.ev-dot.ok { background: var(--green); box-shadow: 0 0 14px rgba(34,197,94,.28); animation:none; }
.ev-dot.err { background: var(--red); box-shadow: 0 0 14px rgba(239,68,68,.28); animation:none; }

.ev-arrow.up { color: var(--green); font-weight: 900; }
.ev-arrow.down { color: var(--red); font-weight: 900; }

.events-pagination {
  margin-top: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.page-btn {
  height: 36px;
  padding: 0 1.2rem;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  font-weight: 900;
  font-size: .8rem;
  cursor: pointer;
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-info {
  font-size: .85rem;
  font-weight: 900;
  color: rgba(249,250,251,.75);
}

.events-empty {
  margin-top: .9rem;
  font-size: .86rem;
  color: rgba(249,250,251,.65);
}
body[data-theme="light"] .events-empty { color: rgba(15,23,42,.62); }

/* ================= TOOLS PAGE ================= */
.converter-card,
.marketcap-card {
  position: relative;
}

.converter-inputs,
.marketcap-controls {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.converter-row,
.marketcap-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.converter-label,
.marketcap-label {
  font-size: 0.85rem;
  font-weight: 900;
  color: rgba(249,250,251,.88);
  min-width: 100px;
}

.converter-input {
  flex: 1;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  padding: 0 12px;
  font-size: 0.9rem;
  font-weight: 900;
  outline: none;
}
body[data-theme="light"] .converter-input {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.06);
  color: rgba(15,23,42,.88);
}

.converter-select,
.marketcap-select {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  padding: 0 12px;
  font-size: 0.85rem;
  font-weight: 900;
  outline: none;
  min-width: 120px;
}

.converter-hint {
  font-size: 0.8rem;
  color: rgba(249,250,251,.65);
  font-weight: 900;
}

.converter-btn,
.marketcap-btn {
  height: 42px;
  padding: 0 1.5rem;
  border-radius: 12px;
  background: rgba(59,130,246,0.18);
  border: 1px solid rgba(59,130,246,0.35);
  color: rgba(249,250,251,.96);
  font-weight: 950;
  font-size: 0.85rem;
  cursor: pointer;
  margin-top: 0.5rem;
}

.converter-results,
.marketcap-results {
  margin-top: 1.5rem;
  padding: 1rem;
  background: rgba(59,130,246,0.08);
  border-radius: 12px;
  border: 1px solid rgba(59,130,246,0.15);
}

.result-item,
.comparison-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.result-item:last-child,
.comparison-item:last-child {
  border-bottom: none;
}

.result-label {
  font-size: 0.85rem;
  font-weight: 900;
  color: rgba(249,250,251,.75);
}
.result-value {
  font-size: 1rem;
  font-weight: 950;
  color: rgba(249,250,251,.95);
}
.result-item.highlight .result-value {
  color: var(--green);
}

.comparison-coin {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-width: 120px;
}

.coin-name {
  font-size: 0.9rem;
  font-weight: 950;
  color: rgba(249,250,251,.95);
}
.coin-cap {
  font-size: 0.85rem;
  font-weight: 900;
  color: rgba(249,250,251,.75);
}

.comparison-bar {
  flex: 1;
  height: 8px;
  background: rgba(255,255,255,.1);
  border-radius: 4px;
  overflow: hidden;
}

.comparison-fill {
  height: 100%;
  transition: width 0.5s ease;
}
.inj-fill {
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
}
.compare-fill {
  background: linear-gradient(90deg, #22c55e, #10b981);
}

.comparison-ratio {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255,255,255,.12);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}

.ratio-label {
  font-size: 0.85rem;
  font-weight: 900;
  color: rgba(249,250,251,.75);
}
.ratio-value {
  font-size: 1.1rem;
  font-weight: 950;
  color: var(--green);
}

.format-buttons {
  display: flex;
  gap: 0.4rem;
}

.format-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.82);
  font-weight: 950;
  font-size: 0.8rem;
  cursor: pointer;
}
.format-btn.active {
  background: rgba(59,130,246,.18);
  border-color: rgba(59,130,246,.35);
  color: rgba(249,250,251,.96);
}

.converter-footer,
.marketcap-footer {
  margin-top: 1rem;
  font-size: 0.75rem;
  color: rgba(249,250,251,.6);
  text-align: center;
}

/* ================= SETTINGS PAGE ================= */
.settings-section {
  margin-bottom: 2rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.settings-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.settings-section-title {
  font-size: 0.95rem;
  font-weight: 950;
  letter-spacing: 0.03em;
  margin-bottom: 1rem;
  color: rgba(249,250,251,.92);
}
body[data-theme="light"] .settings-section-title {
  color: rgba(15,23,42,.88);
}

.settings-option {
  margin-bottom: 1.2rem;
}
.settings-option.warning {
  background: rgba(245, 158, 11, 0.05);
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid rgba(245, 158, 11, 0.15);
}

.settings-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 900;
  margin-bottom: 0.5rem;
  color: rgba(249,250,251,.88);
}
body[data-theme="light"] .settings-label {
  color: rgba(15,23,42,.85);
}

.settings-control {
  margin-bottom: 0.5rem;
}

.settings-select {
  width: 100%;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  padding: 0 12px;
  font-size: 0.85rem;
  font-weight: 900;
  outline: none;
}
body[data-theme="light"] .settings-select {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.06);
  color: rgba(15,23,42,.88);
}

.settings-hint {
  font-size: 0.75rem;
  color: rgba(249,250,251,.65);
  margin-top: 0.4rem;
}
body[data-theme="light"] .settings-hint {
  color: rgba(15,23,42,.6);
}

.reset-warning {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  padding: 0.8rem;
  margin: 1rem 0;
  font-size: 0.8rem;
  font-weight: 900;
  color: rgba(239, 68, 68, 0.95);
}

.reset-actions {
  display: flex;
  gap: 0.8rem;
  justify-content: flex-end;
}

.reset-btn {
  height: 36px;
  padding: 0 1.2rem;
  border-radius: 10px;
  font-weight: 900;
  font-size: 0.8rem;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,.12);
}
.reset-btn.cancel {
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
}
.reset-btn.confirm {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.35);
  color: rgba(239, 68, 68, 0.95);
}

.settings-actions {
  margin-top: 2rem;
  text-align: right;
}

.settings-save {
  height: 42px;
  padding: 0 1.5rem;
  border-radius: 12px;
  background: rgba(59,130,246,0.18);
  border: 1px solid rgba(59,130,246,0.35);
  color: rgba(249,250,251,.96);
  font-weight: 950;
  font-size: 0.85rem;
  cursor: pointer;
}

/* ================= TOAST EVENTS ================= */
.toast-host {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100vw - 24px));
  z-index: 140;
  pointer-events: none;
  display:flex;
  flex-direction: column;
  gap: .55rem;
}
.toast {
  pointer-events: none;
  border-radius: 16px;
  padding: .85rem .95rem;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(17,28,47,.92);
  box-shadow: 0 18px 80px rgba(0,0,0,.55);
  transform: translateY(-18px);
  opacity: 0;
  animation: toastIn 240ms ease forwards, toastOut 240ms ease forwards 2.2s;
}
body[data-theme="light"] .toast {
  background: rgba(240,242,246,.95);
  border-color: rgba(15,23,42,.12);
  box-shadow: 0 18px 70px rgba(2,6,23,.12);
}

@keyframes toastIn {
  to { transform: translateY(0); opacity: 1; }
}
@keyframes toastOut {
  to { transform: translateY(-10px); opacity: 0; }
}

.toast-row {
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 12px;
}
.toast-title {
  font-weight: 950;
  letter-spacing:.02em;
}
.toast-sub {
  margin-top: .25rem;
  font-size: .84rem;
  color: rgba(249,250,251,.70);
}
body[data-theme="light"] .toast-sub { color: rgba(15,23,42,.62); }

/* ================= COMING SOON ================= */
.coming-soon {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: none;
  place-items: center;
  background: rgba(0,0,0,.50);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 18px;
}
.coming-soon.show { display:grid; }

.coming-card {
  width: min(520px, 92vw);
  border-radius: 18px;
  padding: 16px 16px 14px 16px;
  background: linear-gradient(135deg, rgba(11,18,32,.95), rgba(17,28,47,.92));
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 26px 90px rgba(0,0,0,.55);
}
body[data-theme="light"] .coming-card {
  background: linear-gradient(135deg, rgba(240,242,246,.98), rgba(230,234,242,.96));
  border: 1px solid rgba(15,23,42,.10);
}

.coming-title {
  font-size: 1.05rem;
  font-weight: 950;
  letter-spacing: .04em;
}
.coming-sub {
  margin-top: .35rem;
  font-size: .86rem;
  color: rgba(249,250,251,.72);
}
body[data-theme="light"] .coming-sub { color: rgba(15,23,42,.64); }

.coming-close {
  margin-top: .9rem;
  width: 100%;
  height: 40px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  font-weight: 900;
  cursor:pointer;
}
body[data-theme="light"] .coming-close {
  border-color: rgba(15,23,42,.14);
  background: rgba(15,23,42,.06);
  color: rgba(15,23,42,.88);
}
.coming-close:active{ transform: translateY(1px); }

/* ================= DRAWER MENU ================= */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
  z-index: 80;
}

.drawer {
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: min(320px, 86vw);
  background: linear-gradient(135deg, rgba(11,18,32,.98), rgba(17,28,47,.96));
  border-right: 1px solid rgba(255,255,255,.10);
  transform: translateX(-105%);
  transition: transform 220ms ease;
  z-index: 90;
  display: flex;
  flex-direction: column;
  padding: 14px 14px 16px 14px;
  box-shadow: 0 30px 90px rgba(0,0,0,.55);
}
body[data-theme="light"] .drawer {
  background: linear-gradient(135deg, rgba(240,242,246,.98), rgba(230,234,242,.96));
  border-right: 1px solid rgba(15,23,42,.10);
}

.drawer-top {
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 6px 12px 6px;
}
.drawer-title {
  font-size: .95rem;
  font-weight: 900;
  color: rgba(249,250,251,.92);
  letter-spacing: .04em;
  text-transform: uppercase;
}
body[data-theme="light"] .drawer-title { color: rgba(15,23,42,.88); }

.drawer-toggles { display:flex; align-items:center; gap: 10px; }

.toggle-btn {
  width: 50px;
  height: 60px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  cursor:pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 6px;
  padding-bottom: 4px;
}
body[data-theme="light"] .toggle-btn {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.85);
}
.toggle-btn:active{ transform: translateY(1px); }

/* Toggle labels in drawer */
.toggle-label {
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.03em;
  color: rgba(249,250,251,0.75);
  margin-top: 4px;
}
body[data-theme="light"] .toggle-label {
  color: rgba(15,23,42,0.65);
}

.drawer-nav {
  display:flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
  height: 100%;
}

.nav-item {
  height: 44px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.05);
  color: rgba(249,250,251,.88);
  font-weight: 900;
  letter-spacing: .04em;
  text-transform: uppercase;
  cursor:pointer;
  text-align:left;
  padding: 0 14px;
  display:flex;
  align-items:center;
  justify-content: space-between;
}
body[data-theme="light"] .nav-item {
  border-color: rgba(15,23,42,.10);
  background: rgba(15,23,42,.05);
  color: rgba(15,23,42,.84);
}
.nav-item:hover{ background: rgba(255,255,255,.07); }
body[data-theme="light"] .nav-item:hover{ background: rgba(15,23,42,.07); }

.nav-item.active {
  background: rgba(59,130,246,.18);
  border-color: rgba(59,130,246,.35);
  color: rgba(249,250,251,.96);
}
body[data-theme="light"] .nav-item.active {
  background: rgba(59,130,246,.12);
  border-color: rgba(59,130,246,.24);
  color: rgba(15,23,42,.92);
}

.nav-spacer { flex: 1 1 auto; }

.nav-version {
  font-size: .72rem;
  font-weight: 900;
  letter-spacing: .02em;
  opacity: .75;
  text-transform: none;
}

.drawer-foot {
  margin-top: auto;
  padding: 10px 8px 0 8px;
  display:flex;
  flex-direction: column;
  gap: .65rem;
}

.drawer-hint {
  font-size: .78rem;
  color: rgba(249,250,251,.65);
  text-align: right;
}
body[data-theme="light"] .drawer-hint { color: rgba(15,23,42,.62); }

.drawer-meta {
  border-top: 1px solid rgba(255,255,255,.10);
  padding-top: .6rem;
}
body[data-theme="light"] .drawer-meta {
  border-top-color: rgba(15,23,42,.10);
}

.drawer-meta-row {
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
  padding: .35rem 0;
  font-size: .78rem;
}
.drawer-meta-label {
  color: rgba(249,250,251,.62);
  font-weight: 900;
  letter-spacing:.02em;
}
body[data-theme="light"] .drawer-meta-label {
  color: rgba(15,23,42,.58);
}
.drawer-meta-value {
  color: rgba(249,250,251,.86);
  font-weight: 900;
  display:flex;
  align-items:center;
  gap: .45rem;
}
body[data-theme="light"] .drawer-meta-value {
  color: rgba(15,23,42,.82);
}

.cloud-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(156,163,175,.9);
}
.cloud-dot.ok { background: var(--green); }
.cloud-dot.saving { background: var(--amber); animation: cloudBlink 1.0s infinite; }
.cloud-dot.err { background: var(--red); }

@keyframes cloudBlink {
  0%{opacity:.55;}
  50%{opacity:1;}
  100%{opacity:.55;}
}

body.drawer-open .backdrop{ opacity: 1; pointer-events: auto; }
body.drawer-open .drawer{ transform: translateX(0); }

body.drawer-open .header,
body.drawer-open .pages,
body.drawer-open .last-update,
body.drawer-open .pro-footer{
  filter: blur(4px);
  transform: scale(0.995);
  transition: filter 180ms ease, transform 180ms ease;
}
body.drawer-open .drawer,
body.drawer-open .backdrop{
  filter: none !important;
  transform: none !important;
}

/* ================= RANGE MODAL ================= */
.range-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
  place-items: center;
  background: rgba(0,0,0,.50);
  backdrop-filter: blur(12px);
  padding: 18px;
}
.range-modal.show { display: grid; }

.range-modal-content {
  width: min(400px, 90vw);
  background: linear-gradient(135deg, var(--card-dark-a), var(--card-dark-b));
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 26px 90px rgba(0,0,0,.55);
  overflow: hidden;
}
body[data-theme="light"] .range-modal-content {
  background: linear-gradient(135deg, var(--card-light-a), var(--card-light-b));
  border-color: rgba(15,23,42,.10);
}

.range-modal-header {
  padding: 1.2rem 1.5rem;
  border-bottom: 1px solid rgba(255,255,255,.10);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.range-modal-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 950;
  letter-spacing: .02em;
}

.range-modal-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.85);
  font-size: 18px;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.range-modal-body {
  padding: 1.5rem;
}

.range-input-group {
  margin-bottom: 1.2rem;
}
.range-input-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 900;
  margin-bottom: 0.5rem;
  color: rgba(249,250,251,.88);
}
.range-input-group input {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
  padding: 0 12px;
  font-size: 0.95rem;
  font-weight: 900;
  outline: none;
}
body[data-theme="light"] .range-input-group input {
  border-color: rgba(15,23,42,.12);
  background: rgba(15,23,42,.06);
  color: rgba(15,23,42,.88);
}

.range-hint {
  font-size: 0.75rem;
  color: rgba(249,250,251,.65);
  margin-top: 0.8rem;
}

.range-modal-footer {
  padding: 1.2rem 1.5rem;
  border-top: 1px solid rgba(255,255,255,.10);
  display: flex;
  justify-content: flex-end;
  gap: 0.8rem;
}

.range-btn {
  height: 40px;
  padding: 0 1.5rem;
  border-radius: 10px;
  font-weight: 900;
  font-size: 0.85rem;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,.12);
}
.range-btn.cancel {
  background: rgba(255,255,255,.06);
  color: rgba(249,250,251,.92);
}
.range-btn.apply {
  background: rgba(59,130,246,0.18);
  border-color: rgba(59,130,246,0.35);
  color: rgba(249,250,251,.96);
}

/* ================= LOADING shimmer ================= */
.container.loading .value-row span,
.container.loading .sub-row,
.container.loading .bar-values{
  opacity: 0;
}

.container.loading .card{
  position: relative;
  overflow: hidden;
}

.container.loading .card::after{
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    110deg,
    rgba(255,255,255,0.00) 25%,
    rgba(255,255,255,0.06) 35%,
    rgba(255,255,255,0.00) 45%
  );
  transform: translateX(-100%);
  animation: shimmer 1.1s infinite;
  pointer-events:none;
}
body[data-theme="light"] .container.loading .card::after{
  background: linear-gradient(
    110deg,
    rgba(15,23,42,0.00) 25%,
    rgba(15,23,42,0.06) 35%,
    rgba(15,23,42,0.00) 45%
  );
}

@keyframes shimmer{
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.container.ready .value-row span,
.container.ready .sub-row,
.container.ready .bar-values{
  opacity: 1;
  transition: opacity 450ms ease;
}

.flash-yellow{ animation: flashY 650ms ease; }
@keyframes flashY{
  0%   { color: #facc15; transform: scale(1.08); }
  55%  { color: #facc15; }
  100% { color: #9ca3af; transform: scale(1); }
}

/* ================= FOOTER ================= */
.last-update{
  margin-top: .9rem;
  font-size: 0.8rem;
  text-align:center;
  color: #9ca3af;
}
body[data-theme="light"] .last-update{ color: var(--muted-light); }

.pro-footer{
  margin-top: .35rem;
  display:flex;
  justify-content:center;
  align-items:center;
  gap:.45rem;
  font-size: .72rem;
  color: rgba(249,250,251,.55);
  user-select:none;
  flex-wrap: wrap;
}
body[data-theme="light"] .pro-footer{ color: rgba(15,23,42,.55); }

.pro-pill{
  padding: .18rem .55rem;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.04);
  color: rgba(249,250,251,.72);
  font-weight: 900;
}
body[data-theme="light"] .pro-pill{
  border-color: rgba(15,23,42,.10);
  background: rgba(15,23,42,.04);
  color: rgba(15,23,42,.70);
}
.pro-dot{ opacity:.6; }
.pro-meta{ opacity:.85; }

#cloudStatus{ font-weight: 900; }
.cloud-synced #cloudStatus{ color: rgba(34,197,94,.95); }
.cloud-saving #cloudStatus{ color: rgba(245,158,11,.95); animation: cloudBlink 1.0s infinite; }
.cloud-error #cloudStatus{ color: rgba(239,68,68,.95); }
.cloud-points{ color: rgba(56,189,248,.95); font-weight: 900; }

/* ================= EXPANDED VIEW (fullscreen card) ================= */
/* il JS userà una classe su body per attivare una modalità fullscreen */
body.card-expanded{
  overflow: hidden;
}
.card.fullscreen{
  position: fixed !important;
  inset: 10px;
  z-index: 200;
  border-radius: 18px;
  padding: 14px;
  overflow: hidden;
}
@media (max-width: 520px){
  .card.fullscreen{ inset: 8px; }
}
.card.fullscreen .card-expand{
  position:absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
}
.card.fullscreen canvas{
  height: calc(100% - 40px) !important;
}

/* ================= PRIVACY MODE ================= */
body.privacy-mode .value-row span:not(#netWorthUsd):not(#price),
body.privacy-mode .networth-usd,
body.privacy-mode .nw-mini-qty,
body.privacy-mode .sub-row,
body.privacy-mode .estimate-value,
body.privacy-mode .coin-cap,
body.privacy-mode .result-value,
body.privacy-mode .converter-results,
body.privacy-mode .marketcap-results {
  filter: blur(6px);
  user-select: none;
}
body.privacy-mode .copy-address-btn {
  opacity: 0.5;
}

/* ================= RESPONSIVE ================= */
@media (max-width: 768px) {
  .header-grid {
    grid-template-columns: 44px minmax(0,1fr) auto;
    gap: 0.5rem;
  }
  
  .header-meta-right {
    gap: 0.4rem;
  }
  
  .events-controls {
    flex-direction: column;
    align-items: stretch;
  }
  
  .converter-row,
  .marketcap-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
  }
  
  .converter-label,
  .marketcap-label {
    min-width: auto;
  }
  
  .settings-actions {
    text-align: center;
  }
}

@media (max-width: 480px) {
  .cards-wrapper {
    gap: 1rem;
  }
  
  .card {
    padding: 0.9rem;
  }
  
  .tf-switch,
  .stake-timeframe,
  .reward-timeframe,
  .chart-timeframe,
  .apr-timeframe {
    gap: 0.3rem;
  }
  
  .tf-btn,
  .apr-timeframe-btn {
    padding: 0 8px;
    font-size: 0.68rem;
  }
  
  .reward-estimates {
    flex-direction: column;
    gap: 0.8rem;
  }
}
