// Genera public/architecture-map.html (autocontenido) desde public/architecture-map.json.
// Un solo origen de verdad: el JSON. El layout se calcula en el cliente para poder filtrar por zona.
// Correr: node scripts/build-architecture-map.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const data = JSON.parse(readFileSync(join(root, "public/architecture-map.json"), "utf8"))
const payload = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "")
const m = data.meta

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0f14">
<title>${m.name}</title>
<style>
:root{
  --bg:#0b0f14; --panel:#111820; --panel2:#0d131a; --line:#1d2833; --line2:#2b3a49;
  --fg:#dde6ef; --muted:#7f91a3; --dim:#5a6a7a;
  --v2:#e0a33e; --v3:#3fb9c9; --shared:#a184dd; --external:#6b7d8f;
  --crit:#e5544b; --alta:#e0a33e; --media:#5c9ce0; --baja:#6b7c8d;
  --r:6px;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
html{background:var(--bg)}
body{background:var(--bg);color:var(--fg);overflow:hidden;
  font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
h1,h2,h3{font-weight:600;margin:0}

.app{display:flex;flex-direction:column;height:100vh}
header{display:flex;align-items:baseline;gap:18px;padding:9px 15px;border-bottom:1px solid var(--line);
  background:var(--panel2);flex-wrap:wrap;flex:0 0 auto}
header h1{font-size:13px;letter-spacing:.02em;white-space:nowrap}
.stats{display:flex;gap:13px;color:var(--muted);font-size:11px;flex-wrap:wrap}
.stats b{color:var(--fg)}

.main{display:flex;flex:1;min-height:0}
.canvas{position:relative;flex:1;min-width:0;overflow:hidden}
svg{display:block;width:100%;height:100%;cursor:grab;touch-action:none}
svg.dragging{cursor:grabbing}

.topbar{position:absolute;top:9px;left:11px;right:11px;display:flex;gap:7px;align-items:center;
  z-index:6;flex-wrap:wrap;pointer-events:none}
.topbar>*{pointer-events:auto}
.zf{display:flex;gap:5px;padding:4px;border:1px solid var(--line2);border-radius:99px;
  background:rgba(11,15,20,.88);backdrop-filter:blur(6px)}
.zf button{padding:3px 10px;font-size:10.5px;border-radius:99px;color:var(--muted);white-space:nowrap}
.zf button i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:-1px;opacity:.45}
.zf button[aria-pressed=true]{background:#1b2733;color:var(--fg)}
.zf button[aria-pressed=true] i{opacity:1}
.zf button:hover{color:var(--fg)}

.controls{position:absolute;left:11px;bottom:11px;display:flex;gap:5px;z-index:6}
.controls button{height:29px;min-width:29px;padding:0 9px;border:1px solid var(--line2);border-radius:var(--r);
  background:rgba(11,15,20,.9);color:var(--muted);font-size:11px;display:grid;place-items:center}
.controls button:hover{color:var(--fg);border-color:var(--v3)}
.hint{position:absolute;right:11px;bottom:13px;font-size:10px;color:var(--dim);z-index:6;text-align:right;pointer-events:none}
.empty{position:absolute;inset:0;display:none;place-items:center;color:var(--dim);font-size:12px}
.empty.on{display:grid}

aside{width:430px;flex:0 0 430px;border-left:1px solid var(--line);background:var(--panel);
  display:flex;flex-direction:column;min-height:0}
.tabs{display:flex;border-bottom:1px solid var(--line);flex:0 0 auto}
.tabs button{flex:1;padding:8px 3px;font-size:11px;color:var(--muted);border-bottom:2px solid transparent}
.tabs button:hover{color:var(--fg)}
.tabs button[aria-selected=true]{color:var(--fg);border-bottom-color:var(--v3);background:var(--panel2)}
.tabs .n{display:block;font-size:9.5px;color:var(--dim);margin-top:1px}
.body{overflow-y:auto;overflow-x:hidden;padding:11px;flex:1;min-height:0}
.body::-webkit-scrollbar{width:9px}
.body::-webkit-scrollbar-thumb{background:var(--line2);border-radius:5px}
.lead{color:var(--muted);font-size:11px;margin:0 0 10px}
.lead b{color:var(--fg)}

.filters{display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap}
.chip{padding:3px 9px;font-size:10.5px;border:1px solid var(--line2);border-radius:99px;color:var(--muted)}
.chip:hover{color:var(--fg)}
.chip[aria-pressed=true]{background:var(--fg);color:#0b0f14;border-color:var(--fg);font-weight:600}

.item{border:1px solid var(--line);border-radius:var(--r);margin-bottom:7px;background:var(--panel2)}
.item>button{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:var(--r)}
.item>button:hover{background:#141e28}
.item.on{border-color:var(--v3);box-shadow:0 0 0 1px rgba(63,185,201,.3)}
.item .t{display:block;font-size:12px;font-weight:600;line-height:1.4}
.item .m{display:flex;gap:6px;align-items:center;margin-top:5px;font-size:10px;color:var(--muted);flex-wrap:wrap}
.tag{padding:1px 6px;border-radius:3px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.tag.v2{background:rgba(224,163,62,.15);color:var(--v2)}
.tag.v3{background:rgba(63,185,201,.15);color:var(--v3)}
.tag.shared{background:rgba(161,132,221,.17);color:var(--shared)}
.tag.critica{background:rgba(229,84,75,.16);color:var(--crit)}
.tag.alta{background:rgba(224,163,62,.15);color:var(--alta)}
.tag.media{background:rgba(92,156,224,.15);color:var(--media)}
.tag.baja{background:rgba(107,124,141,.17);color:var(--baja)}

.detail{padding:2px 11px 11px;font-size:11.5px;color:#b7c5d2}
.detail p{margin:7px 0}
.lbl{color:var(--dim);text-transform:uppercase;font-size:9.5px;letter-spacing:.07em;margin:11px 0 3px}
.steps{list-style:none;margin:7px 0 0;padding:0;counter-reset:s}
.steps li{position:relative;padding:0 0 10px 24px;border-left:1px solid var(--line2);margin-left:8px;cursor:default}
.steps li:last-child{border-left-color:transparent;padding-bottom:0}
.steps li::before{counter-increment:s;content:counter(s);position:absolute;left:-9px;top:-1px;width:18px;height:18px;
  border-radius:50%;background:var(--panel2);border:1px solid var(--line2);color:var(--muted);
  font-size:9.5px;display:grid;place-items:center}
.steps li:hover::before{background:var(--v3);border-color:var(--v3);color:#04141a;font-weight:700}
.steps .sn{color:var(--fg);font-weight:600}
.steps .sz{font-size:9px;color:var(--dim);margin-left:5px;text-transform:uppercase}
.steps .sd{color:var(--muted);display:block;margin-top:2px}
code{background:#080d12;border:1px solid var(--line);padding:1px 5px;border-radius:3px;
  font-size:10.5px;color:#9fb3c6;word-break:break-word}
.ev{margin:4px 0 0;padding-left:15px;color:var(--muted);font-size:10.5px}
.ev li{margin-bottom:3px}
.fix{border-left:2px solid var(--v3);padding:7px 10px;background:rgba(63,185,201,.06);
  margin-top:10px;border-radius:0 var(--r) var(--r) 0}
.fix .lbl{margin-top:0;color:var(--v3)}
.nodelist{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.nodelist button{font-size:10px;padding:2px 7px;border:1px solid var(--line2);border-radius:3px;color:var(--muted)}
.nodelist button:hover{color:var(--fg);border-color:var(--v3)}

.node rect{fill:var(--panel);stroke:var(--line2);rx:5}
.node text{font-size:10.5px;fill:var(--fg);pointer-events:none}
.node[data-zone=v2] rect{stroke:rgba(224,163,62,.55)}
.node[data-zone=v3] rect{stroke:rgba(63,185,201,.55)}
.node[data-zone=shared] rect{stroke:rgba(161,132,221,.6)}
.node[data-zone=external] rect{stroke:rgba(107,125,143,.55)}
.node{cursor:pointer}
.node:hover rect{fill:#18232f}
.node:focus{outline:none}
.node:focus rect{stroke:#fff}
.node.dimmed{opacity:.12}
.node.act rect{fill:#14313a;stroke:var(--v3);stroke-width:2}
.node.act text{fill:#fff}
.node.sel rect{stroke:#fff;stroke-width:2.5}
.edge{fill:none;stroke:var(--line2);stroke-width:1.1}
.edge.fk{stroke-dasharray:2 3;stroke:rgba(161,132,221,.55)}
.edge.dimmed{opacity:.05}
.edge.act{stroke:var(--v3);stroke-width:2.2;stroke-dasharray:7 5;animation:fl 1s linear infinite}
@keyframes fl{to{stroke-dashoffset:-24}}
.lane rect{fill:rgba(255,255,255,.013);stroke:var(--line);stroke-dasharray:3 4}
.lane text{font-size:10px;fill:var(--dim);text-transform:uppercase;letter-spacing:.11em}
.colhdr{font-size:10px;fill:var(--muted);text-transform:uppercase;letter-spacing:.09em}
.badge{font-size:8.5px;font-weight:700}

#tip{position:fixed;z-index:60;max-width:340px;padding:9px 11px;border:1px solid var(--line2);
  border-radius:var(--r);background:rgba(8,13,18,.98);pointer-events:none;opacity:0;
  transition:opacity .1s;box-shadow:0 10px 30px rgba(0,0,0,.65);font-size:11px}
#tip.on{opacity:1}
#tip .tt{font-weight:600;font-size:11.5px}
#tip .tz{font-size:9px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
#tip .td{color:var(--muted);margin:4px 0}
#tip .tf{color:var(--dim);font-size:10px;word-break:break-all;margin-top:3px}
#tip .tw{color:var(--alta);margin-top:5px}

@media(max-width:920px){
  body{overflow:auto}
  .main{flex-direction:column;height:auto}
  .canvas{height:70vh;flex:none;border-bottom:1px solid var(--line)}
  aside{width:auto;flex:none;border-left:none}
  .body{overflow:visible}
}
</style>
</head>
<body>
<div class="app">
<header>
  <h1>ASCI · Mapa de arquitectura</h1>
  <div class="stats">
    <span><b>${m.stats.tsFiles}</b> archivos TS</span>
    <span><b>${data.nodes.length}</b> nodos</span>
    <span><b>${data.edges.length}</b> aristas</span>
    <span><b>${data.flows.length}</b> flujos</span>
    <span><b>${m.stats.tablesPublic}</b> tablas public · <b>${m.stats.tablesV3}</b> v3</span>
    <span><b>${m.stats.crons}</b> crons</span>
    <span><b>${m.stats.mcpTools}</b> tools MCP</span>
  </div>
</header>

<div class="main">
  <div class="canvas">
    <div class="topbar">
      <div class="zf" id="zf" role="group" aria-label="Filtrar por zona"></div>
    </div>
    <svg id="svg" role="img" aria-label="Diagrama de arquitectura de ASCI v2 y v3"><g id="vp"></g></svg>
    <div class="empty" id="empty">Ninguna zona visible. Activá al menos una.</div>
    <div class="controls">
      <button id="zi" aria-label="Acercar" title="Acercar">+</button>
      <button id="zo" aria-label="Alejar" title="Alejar">−</button>
      <button id="zf100" title="Zoom 100%">1:1</button>
      <button id="zr" title="Encuadrar todo">encuadrar</button>
      <button id="clr" title="Quitar resaltado">limpiar</button>
    </div>
    <p class="hint">arrastrar para mover · rueda para zoom · clic en un nodo para aislar sus conexiones</p>
  </div>

  <aside>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="flows" aria-selected="true">Flujos<span class="n">${data.flows.length}</span></button>
      <button role="tab" data-tab="contact" aria-selected="false">Contacto<span class="n">${data.contactPoints.length}</span></button>
      <button role="tab" data-tab="opt" aria-selected="false">Optimizable<span class="n">${data.optimizations.length}</span></button>
      <button role="tab" data-tab="dead" aria-selected="false">Muerto<span class="n">${data.deadCode.length}</span></button>
    </div>
    <div class="body" id="panel"></div>
  </aside>
</div>
</div>
<div id="tip" role="tooltip" aria-hidden="true"></div>

<script>
const DATA=${payload};
const {nodes,edges,flows,contactPoints,optimizations,deadCode}=DATA;
const N=Object.fromEntries(nodes.map(n=>[n.id,n]));
const ZONES=["external","v2","shared","v3"];
const ZL={external:"Proveedores externos",v2:"ASCI v2 · producción (public)",shared:"Compartido · zona de riesgo",v3:"ASCI v3 · multitenant"};
const ZS={external:"externo",v2:"v2",shared:"compartido",v3:"v3"};
const LN={0:"Proveedores",1:"Entrada / UI",2:"API & Actions",3:"Servicios & Dominio",4:"Datos (Postgres)"};
const KIND={api:"API",ai:"IA",email:"MAIL",storage:"BLOB",client:"CLI",page:"UI",edge:"EDGE",route:"RTE",webhook:"HOOK",mcp:"MCP",cron:"CRON",infra:"INF",service:"SVC",table:"TBL"};
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- layout ---------- */
const NW=210,NH=44,GAP_Y=13,SUB_W=234,LAYER_GAP=46,PAD_X=158,PAD_Y=72,LANE_PAD=30,MAX_ROWS=9;
let vis=new Set(ZONES), pos={}, W=0, H=0, lanes=[], cols=[];

function layout(){
  pos={};lanes=[];cols=[];
  const vn=nodes.filter(n=>vis.has(n.zone));
  if(!vn.length){W=H=0;return}
  const cell=(z,l)=>vn.filter(n=>n.zone===z&&n.layer===l).sort((a,b)=>a.label.localeCompare(b.label));
  const zs=ZONES.filter(z=>vis.has(z)&&vn.some(n=>n.zone===z));
  const ls=[0,1,2,3,4].filter(l=>vn.some(n=>n.layer===l));
  // ancho de cada layer segun cuantas sub-columnas necesita
  let x=PAD_X;
  for(const l of ls){
    let sub=1;
    for(const z of zs) sub=Math.max(sub,Math.ceil(cell(z,l).length/MAX_ROWS)||1);
    cols.push({layer:l,x,sub});
    x+=sub*SUB_W+LAYER_GAP;
  }
  W=x-LAYER_GAP+40;
  const colOf=Object.fromEntries(cols.map(c=>[c.layer,c]));
  // alto de cada swimlane segun la celda mas alta
  let y=PAD_Y;
  for(const z of zs){
    let rows=1;
    for(const l of ls){
      const c=cell(z,l);if(!c.length)continue;
      rows=Math.max(rows,Math.ceil(c.length/(Math.ceil(c.length/MAX_ROWS)||1)));
    }
    const h=rows*(NH+GAP_Y)-GAP_Y+LANE_PAD*2;
    lanes.push({zone:z,y,h});
    for(const l of ls){
      const c=cell(z,l);if(!c.length)continue;
      const sub=Math.ceil(c.length/MAX_ROWS)||1, r=Math.ceil(c.length/sub);
      c.forEach((n,i)=>{pos[n.id]={x:colOf[l].x+Math.floor(i/r)*SUB_W,y:y+LANE_PAD+(i%r)*(NH+GAP_Y)}});
    }
    y+=h;
  }
  H=y+30;
}

function edgePath(e){
  const a=pos[e.from],b=pos[e.to];if(!a||!b)return"";
  const x1=a.x+NW,y1=a.y+NH/2,x2=b.x,y2=b.y+NH/2;
  if(x2>=x1-4){const mx=(x1+x2)/2;return'M'+x1+' '+y1+'C'+mx+' '+y1+','+mx+' '+y2+','+x2+' '+y2}
  const yo=Math.max(y1,y2)+NH*.85,xa=x1+18,xb=x2-18;
  return'M'+x1+' '+y1+'C'+xa+' '+y1+','+xa+' '+yo+','+((x1+x2)/2)+' '+yo+'C'+xb+' '+yo+','+xb+' '+y2+','+x2+' '+y2;
}

const svg=document.getElementById("svg"),vp=document.getElementById("vp"),emptyEl=document.getElementById("empty");
let visEdges=[];
function draw(){
  layout();
  emptyEl.classList.toggle("on",!W);
  if(!W){vp.innerHTML="";return}
  visEdges=edges.filter(e=>pos[e.from]&&pos[e.to]);
  const p=['<defs>',
    '<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#2b3a49"/></marker>',
    '<marker id="arA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#3fb9c9"/></marker>',
    '</defs>'];
  lanes.forEach(l=>p.push('<g class="lane"><rect x="8" y="'+l.y+'" width="'+(W-20)+'" height="'+l.h+'" rx="7"/>'+
    '<text x="20" y="'+(l.y+18)+'">'+esc(ZL[l.zone])+'</text></g>'));
  cols.forEach(c=>p.push('<text class="colhdr" x="'+c.x+'" y="32">'+esc(LN[c.layer])+'</text>'));
  visEdges.forEach(e=>p.push('<path class="edge'+(e.kind==="fk"?" fk":"")+'" id="'+e.id+'" d="'+edgePath(e)+
    '" marker-end="url(#ar)"><title>'+esc(e.label||e.kind)+'</title></path>'));
  nodes.forEach(n=>{
    const q=pos[n.id];if(!q)return;
    const lb=n.label.length>29?n.label.slice(0,28)+"…":n.label;
    const c=n.zone==="v2"?"var(--v2)":n.zone==="v3"?"var(--v3)":n.zone==="shared"?"var(--shared)":"var(--external)";
    p.push('<g class="node" id="n-'+n.id+'" data-id="'+n.id+'" data-zone="'+n.zone+'" tabindex="0" role="button" aria-label="'+esc(n.label)+'" transform="translate('+q.x+','+q.y+')">'+
      '<rect width="'+NW+'" height="'+NH+'"/>'+
      '<text class="badge" x="9" y="16" fill="'+c+'">'+(KIND[n.kind]||"·")+'</text>'+
      '<text x="9" y="31">'+esc(lb)+'</text>'+
      (n.risk?'<circle cx="'+(NW-11)+'" cy="12" r="3.2" fill="var(--crit)"/>':'')+'</g>');
  });
  vp.innerHTML=p.join("");
}

/* ---------- pan / zoom ---------- */
let z=1,tx=0,ty=0;
const apply=()=>vp.setAttribute("transform","translate("+tx+","+ty+") scale("+z+")");
function frame(){ // encuadre inicial: ancho completo pero legible
  if(!W)return;
  const r=svg.getBoundingClientRect();
  z=Math.min(Math.max(Math.min(r.width/W,r.height/H),.34),1);
  tx=(r.width-W*z)/2;
  // si entra completo en alto, centrar; si no, anclar arriba para leer de arriba hacia abajo
  ty=H*z<=r.height-20?(r.height-H*z)/2:10;
  apply();
}
function fitAll(){
  if(!W)return;
  const r=svg.getBoundingClientRect();
  z=Math.min(r.width/W,r.height/H)*.97;
  tx=(r.width-W*z)/2;ty=(r.height-H*z)/2;apply();
}
svg.addEventListener("wheel",e=>{
  e.preventDefault();
  const r=svg.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  const nz=Math.max(.1,Math.min(3.2,z*(e.deltaY<0?1.12:1/1.12)));
  tx=mx-(mx-tx)*(nz/z);ty=my-(my-ty)*(nz/z);z=nz;apply();
},{passive:false});
let dg=null;
svg.addEventListener("pointerdown",e=>{
  if(e.target.closest(".node"))return;
  dg={x:e.clientX-tx,y:e.clientY-ty};svg.classList.add("dragging");
  try{svg.setPointerCapture(e.pointerId)}catch(_){}
});
svg.addEventListener("pointermove",e=>{if(dg){tx=e.clientX-dg.x;ty=e.clientY-dg.y;apply()}});
["pointerup","pointercancel"].forEach(t=>svg.addEventListener(t,()=>{dg=null;svg.classList.remove("dragging")}));
document.getElementById("zi").onclick=()=>{z=Math.min(3.2,z*1.25);apply()};
document.getElementById("zo").onclick=()=>{z=Math.max(.1,z/1.25);apply()};
document.getElementById("zf100").onclick=()=>{z=1;apply()};
document.getElementById("zr").onclick=fitAll;
document.getElementById("clr").onclick=()=>{clearHi();panel.querySelectorAll(".item.on").forEach(i=>{i.classList.remove("on");i.querySelector(".detail")?.remove()})};

/* ---------- filtro de zonas ---------- */
const zfEl=document.getElementById("zf");
zfEl.innerHTML=ZONES.map(zn=>'<button data-z="'+zn+'" aria-pressed="true"><i style="background:var(--'+zn+')"></i>'+
  esc(ZS[zn])+' <span style="color:var(--dim)">'+nodes.filter(n=>n.zone===zn).length+'</span></button>').join("");
zfEl.addEventListener("click",e=>{
  const b=e.target.closest("button[data-z]");if(!b)return;
  const zn=b.dataset.z;
  if(vis.has(zn)&&vis.size>1)vis.delete(zn);else vis.add(zn);
  b.setAttribute("aria-pressed",String(vis.has(zn)));
  draw();frame();
});

/* ---------- resaltado ---------- */
function clearHi(){
  vp.querySelectorAll(".node").forEach(g=>g.classList.remove("dimmed","act","sel"));
  vp.querySelectorAll(".edge").forEach(p=>{p.classList.remove("dimmed","act");p.setAttribute("marker-end","url(#ar)")});
}
function ensureVisible(ids){ // si el resaltado toca zonas apagadas, prenderlas
  const need=[...new Set(ids.map(i=>N[i]?.zone).filter(Boolean))].filter(zn=>!vis.has(zn));
  if(!need.length)return false;
  need.forEach(zn=>{vis.add(zn);zfEl.querySelector('[data-z="'+zn+'"]')?.setAttribute("aria-pressed","true")});
  draw();return true;
}
function highlight(nodeIds,edgeIds,focus){
  const ids=nodeIds.filter(i=>N[i]);
  ensureVisible(ids);
  clearHi();
  const ns=new Set(ids),es=new Set(edgeIds||[]);
  vp.querySelectorAll(".node").forEach(g=>{
    if(ns.has(g.dataset.id)){g.classList.add("act");if(g.dataset.id===focus)g.classList.add("sel")}
    else g.classList.add("dimmed");
  });
  vp.querySelectorAll(".edge").forEach(p=>{
    if(es.has(p.id)){p.classList.add("act");p.setAttribute("marker-end","url(#arA)")}else p.classList.add("dimmed");
  });
  // encuadrar el subgrafo resaltado
  const pts=ids.map(i=>pos[i]).filter(Boolean);
  if(pts.length){
    const x0=Math.min(...pts.map(p=>p.x))-40,x1=Math.max(...pts.map(p=>p.x))+NW+40;
    const y0=Math.min(...pts.map(p=>p.y))-40,y1=Math.max(...pts.map(p=>p.y))+NH+40;
    const r=svg.getBoundingClientRect();
    z=Math.max(Math.min(r.width/(x1-x0),r.height/(y1-y0),1.25),.16);
    tx=r.width/2-((x0+x1)/2)*z;ty=r.height/2-((y0+y1)/2)*z;apply();
  }
}
const showFlow=f=>highlight(f.steps.map(s=>s.nodeId),f.steps.map(s=>s.edgeId).filter(Boolean),null);
function showNode(id){
  const inc=edges.filter(e=>e.from===id||e.to===id);
  highlight([...new Set([id,...inc.map(e=>e.from===id?e.to:e.from)])],inc.map(e=>e.id),id);
}

/* ---------- tooltip ---------- */
const tip=document.getElementById("tip");
function tipHTML(n){
  return'<div class="tt">'+esc(n.label)+'</div><div class="tz">'+esc(ZS[n.zone])+' · '+esc(LN[n.layer])+' · '+esc(n.kind)+'</div>'+
    '<div class="td">'+esc(n.desc||"")+'</div>'+
    (n.schedule?'<div class="tf">cron: '+esc(n.schedule)+'</div>':'')+
    (n.tables?.length?'<div class="tf">tablas: '+esc(n.tables.join(", "))+'</div>':'')+
    (n.env?.length?'<div class="tf">env: '+esc(n.env.join(", "))+'</div>':'')+
    (n.files?.length?'<div class="tf">'+n.files.map(esc).join("<br>")+'</div>':'')+
    (n.notes?'<div class="tw">⚠ '+esc(n.notes)+'</div>':'');
}
function moveTip(e){
  const b=tip.getBoundingClientRect();
  let x=e.clientX+15,y=e.clientY+15;
  if(x+b.width>innerWidth-8)x=Math.max(8,e.clientX-b.width-15);
  if(y+b.height>innerHeight-8)y=Math.max(8,e.clientY-b.height-15);
  tip.style.left=x+"px";tip.style.top=y+"px";
}
vp.addEventListener("pointerover",e=>{
  const g=e.target.closest(".node");if(!g)return;
  tip.innerHTML=tipHTML(N[g.dataset.id]);tip.classList.add("on");moveTip(e);
});
vp.addEventListener("pointermove",e=>{if(tip.classList.contains("on"))moveTip(e)});
vp.addEventListener("pointerout",e=>{if(e.target.closest(".node"))tip.classList.remove("on")});
vp.addEventListener("click",e=>{const g=e.target.closest(".node");if(g)showNode(g.dataset.id)});
vp.addEventListener("keydown",e=>{
  const g=e.target.closest?.(".node");
  if(g&&(e.key==="Enter"||e.key===" ")){e.preventDefault();showNode(g.dataset.id)}
});

/* ---------- panel ---------- */
const panel=document.getElementById("panel");
let tab="flows",vf="all";
const nodeChips=ids=>'<div class="nodelist">'+ids.filter(i=>N[i]).map(i=>'<button data-goto="'+i+'">'+esc(N[i].label)+'</button>').join("")+'</div>';

function flowsHTML(){
  const list=flows.filter(f=>vf==="all"||f.version===vf);
  return'<p class="lead">Seleccioná un flujo para resaltar su ruta completa en el diagrama. <b>'+list.length+'</b> visibles.</p>'+
  '<div class="filters">'+["all","v2","v3","shared"].map(v=>'<button class="chip" data-vf="'+v+'" aria-pressed="'+(vf===v)+'">'+
    (v==="all"?"todos":v==="shared"?"cruzan v2↔v3":v)+'</button>').join("")+'</div>'+
  list.map(f=>'<article class="item" id="it-'+f.id+'"><button data-flow="'+f.id+'"><span class="t">'+esc(f.name)+'</span>'+
    '<span class="m"><span class="tag '+f.version+'">'+(f.version==="shared"?"v2↔v3":f.version)+'</span>'+
    '<span>'+f.steps.length+' pasos</span><span>·</span><span>'+esc(f.trigger)+'</span></span></button></article>').join("");
}
const flowDetail=f=>'<div class="detail"><p>'+esc(f.desc)+'</p><div class="lbl">Ruta</div><ol class="steps">'+
  f.steps.map(s=>{const n=N[s.nodeId];return'<li data-node="'+s.nodeId+'"><span class="sn">'+esc(n?n.label:s.nodeId)+'</span>'+
    (n?'<span class="sz">'+esc(ZS[n.zone])+'</span>':'')+'<span class="sd">'+esc(s.detail||"")+'</span></li>'}).join("")+'</ol></div>';

const cpHTML=()=>'<p class="lead">Los puntos donde v2 y v3 <b>se tocan de verdad</b>: misma base, mismo schema o misma identidad. Acá un cambio en v3 puede romper producción.</p>'+
  contactPoints.map(c=>'<article class="item" id="it-'+c.id+'"><button data-cp="'+c.id+'"><span class="t">'+esc(c.title)+'</span>'+
    '<span class="m"><span class="tag '+c.severity+'">'+c.severity+'</span><span>'+c.nodes.length+' nodos</span></span></button></article>').join("");
const cpDetail=c=>'<div class="detail"><p>'+esc(c.desc)+'</p><div class="lbl">Impacto</div><p>'+esc(c.impact)+'</p>'+
  '<div class="lbl">Nodos involucrados</div>'+nodeChips(c.nodes)+'</div>';

const optHTML=()=>'<p class="lead">Cuestiones de diseño verificadas en código, ordenadas por severidad. <b>'+optimizations.filter(o=>o.severity==="critica").length+'</b> críticas.</p>'+
  optimizations.map(o=>'<article class="item" id="it-'+o.id+'"><button data-opt="'+o.id+'"><span class="t">'+esc(o.title)+'</span>'+
    '<span class="m"><span class="tag '+o.severity+'">'+o.severity+'</span><span>'+esc(o.area)+'</span><span>·</span><span>'+esc(o.id)+'</span></span></button></article>').join("");
const optDetail=o=>'<div class="detail"><div class="lbl">Hallazgo</div><p>'+esc(o.finding)+'</p>'+
  '<div class="lbl">Por qué importa</div><p>'+esc(o.why)+'</p>'+
  '<div class="lbl">Evidencia</div><ul class="ev">'+o.evidence.map(e=>'<li><code>'+esc(e)+'</code></li>').join("")+'</ul>'+
  (o.nodes?.length?'<div class="lbl">Nodos</div>'+nodeChips(o.nodes):'')+
  '<div class="fix"><div class="lbl">Cómo lo resolvería</div>'+esc(o.fix)+'</div></div>';

function deadHTML(){
  const loc=deadCode.reduce((a,d)=>a+(d.loc||0),0);
  return'<p class="lead">Código sin referencias, verificado por grep de importadores y por existencia real en la base. Total: <b>~'+loc+' líneas</b> borrables.</p>'+
  deadCode.map(d=>'<article class="item" id="it-'+d.id+'"><button data-dead="'+d.id+'"><span class="t">'+esc(d.title)+'</span>'+
    '<span class="m"><span class="tag '+d.severity+'">'+d.severity+'</span>'+(d.loc?'<span>'+d.loc+' loc</span>':'')+
    '<span>·</span><span>'+esc(d.id)+'</span></span></button></article>').join("");
}
const deadDetail=d=>'<div class="detail"><div class="lbl">Hallazgo</div><p>'+esc(d.finding)+'</p>'+
  '<div class="lbl">Verificación</div><p>'+esc(d.verification)+'</p>'+
  '<div class="lbl">Evidencia</div><ul class="ev">'+d.evidence.map(e=>'<li><code>'+esc(e)+'</code></li>').join("")+'</ul>'+
  (d.nodes?.length?'<div class="lbl">Nodos</div>'+nodeChips(d.nodes):'')+
  '<div class="fix"><div class="lbl">Recomendación</div>'+esc(d.recommendation)+'</div>';

const render=()=>panel.innerHTML=tab==="flows"?flowsHTML():tab==="contact"?cpHTML():tab==="opt"?optHTML():deadHTML();
document.querySelector(".tabs").addEventListener("click",e=>{
  const b=e.target.closest("button[data-tab]");if(!b)return;
  tab=b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(x=>x.setAttribute("aria-selected",String(x.dataset.tab===tab)));
  render();
});
panel.addEventListener("click",e=>{
  const g=e.target.closest("[data-goto]");
  if(g){showNode(g.dataset.goto);return}
  const f=e.target.closest("[data-vf]");
  if(f){vf=f.dataset.vf;render();return}
  const b=e.target.closest("button[data-flow],button[data-cp],button[data-opt],button[data-dead]");
  if(!b)return;
  const art=b.parentElement,was=art.classList.contains("on");
  panel.querySelectorAll(".item.on").forEach(i=>{i.classList.remove("on");i.querySelector(".detail")?.remove()});
  if(was){clearHi();return}
  art.classList.add("on");
  const d=b.dataset;
  if(d.flow){const x=flows.find(y=>y.id===d.flow);art.insertAdjacentHTML("beforeend",flowDetail(x));showFlow(x)}
  else if(d.cp){const x=contactPoints.find(y=>y.id===d.cp);art.insertAdjacentHTML("beforeend",cpDetail(x));
    highlight(x.nodes,edges.filter(e2=>x.nodes.includes(e2.from)&&x.nodes.includes(e2.to)).map(e2=>e2.id),null)}
  else if(d.opt){const x=optimizations.find(y=>y.id===d.opt);art.insertAdjacentHTML("beforeend",optDetail(x));
    if(x.nodes?.length)highlight(x.nodes,[],null)}
  else if(d.dead){const x=deadCode.find(y=>y.id===d.dead);art.insertAdjacentHTML("beforeend",deadDetail(x));
    if(x.nodes?.length)highlight(x.nodes,[],null)}
  art.scrollIntoView({block:"nearest",behavior:"smooth"});
});
panel.addEventListener("pointerover",e=>{
  const li=e.target.closest(".steps li");if(!li)return;
  const g=document.getElementById("n-"+li.dataset.node);
  if(g&&!g.classList.contains("dimmed"))g.classList.add("sel");
});
panel.addEventListener("pointerout",e=>{
  const li=e.target.closest(".steps li");if(!li)return;
  document.getElementById("n-"+li.dataset.node)?.classList.remove("sel");
});

let rt;addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(frame,180)});
draw();frame();render();
</script>
</body>
</html>`

writeFileSync(join(root, "public/architecture-map.html"), html)
console.log(`OK nodos=${data.nodes.length} aristas=${data.edges.length} flujos=${data.flows.length}`)
