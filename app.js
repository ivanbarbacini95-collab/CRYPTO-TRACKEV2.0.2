const $ = id => document.getElementById(id);
const hasInternet = () => navigator.onLine;

let liveMode = true;
let modeLoading = false;
let refreshLoading = false;
let refreshLoaded = false;

let wsTradeOnline = false;
let wsKlineOnline = false;

const statusDot = $("statusDot");
const statusText = $("statusText");

function refreshConnUI(){
  if(!hasInternet()){
    statusText.textContent="Offline";
    statusDot.style.background="#ef4444";
    return;
  }

  if(modeLoading || refreshLoading){
    statusText.textContent="Loading...";
    statusDot.style.background="#f59e0b";
    return;
  }

  if(liveMode){
    if(wsTradeOnline && wsKlineOnline){
      statusText.textContent="Online";
      statusDot.style.background="#22c55e";
    }else{
      statusText.textContent="Connecting...";
      statusDot.style.background="#f59e0b";
    }
    return;
  }

  if(refreshLoaded){
    statusText.textContent="Online";
    statusDot.style.background="#22c55e";
  }
}

function startTradeWS(){
  wsTradeOnline=false;
  refreshConnUI();
  setTimeout(()=>{
    wsTradeOnline=true;
    modeLoading=false;
    refreshConnUI();
  },800);
}

function startKlineWS(){
  wsKlineOnline=false;
  refreshConnUI();
  setTimeout(()=>{
    wsKlineOnline=true;
    modeLoading=false;
    refreshConnUI();
  },1000);
}

function setMode(isLive){
  liveMode=isLive;
  modeLoading=true;
  refreshConnUI();

  if(liveMode){
    startTradeWS();
    startKlineWS();
  }else{
    refreshLoading=true;
    setTimeout(()=>{
      refreshLoading=false;
      refreshLoaded=true;
      modeLoading=false;
      refreshConnUI();
    },1200);
  }
}

$("liveToggle")?.addEventListener("click",()=>setMode(!liveMode));
$("menuBtn")?.addEventListener("click",()=>{
  document.body.classList.toggle("drawer-open");
});

(function boot(){
  modeLoading=true;
  refreshConnUI();
  startTradeWS();
  startKlineWS();
})();
