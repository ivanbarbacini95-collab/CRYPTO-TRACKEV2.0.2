const clamp = (n,a,b)=>Math.min(Math.max(n,a),b);
const $=id=>document.getElementById(id);

const state={
  d:{open:10,low:9,high:11},
  w:{open:10,low:8,high:12},
  m:{open:10,low:7,high:14}
};

const prev={d:{},w:{},m:{}};

const gradients={
  d:{up:"linear-gradient(90deg,#22c55e,#4ade80)",
     dn:"linear-gradient(270deg,#ef4444,#f87171)"},
  w:{up:"linear-gradient(90deg,#38bdf8,#2563eb)",
     dn:"linear-gradient(270deg,#0ea5e9,#1e40af)"},
  m:{up:"linear-gradient(90deg,#f59e0b,#fde68a)",
     dn:"linear-gradient(270deg,#d97706,#92400e)"},
  reward:"linear-gradient(90deg,#22c55e,#3b82f6)"
};

function render(tf,val){
  const s=state[tf];
  const bar=$(`bar${tf.toUpperCase()}`);
  const line=$(`line${tf.toUpperCase()}`);

  const range=Math.max(s.high-s.open,s.open-s.low);
  const min=s.open-range,max=s.open+range;
  const pos=clamp((val-min)/(max-min)*100,0,100);

  line.style.left=pos+"%";

  if(val>=s.open){
    bar.style.left="50%";
    bar.style.width=(pos-50)+"%";
    bar.style.background=gradients[tf].up;
  }else{
    bar.style.left=pos+"%";
    bar.style.width=(50-pos)+"%";
    bar.style.background=gradients[tf].dn;
  }

  // values + flash
  ["min","open","max"].forEach(k=>{
    const el=$(`${k}${tf.toUpperCase()}`);
    const v=s[k];
    el.textContent=v.toFixed(2);

    if(prev[tf][k]!=null){
      if(k==="max" && v>prev[tf][k]) el.classList.add("flash-up");
      if(k==="min" && v<prev[tf][k]) el.classList.add("flash-down");
    }
    prev[tf][k]=v;
  });
}

function loop(){
  const price=10+Math.sin(Date.now()/1200);
  ["d","w","m"].forEach(tf=>{
    state[tf].high=Math.max(state[tf].high,price);
    state[tf].low=Math.min(state[tf].low,price);
    render(tf,price);
  });

  const rp=clamp((price-8)/6*100,0,100);
  $("rewardBar").style.width=rp+"%";
  $("rewardBar").style.background=gradients.reward;
  $("rewardPct").textContent=rp.toFixed(1)+"%";

  requestAnimationFrame(loop);
}
loop();
