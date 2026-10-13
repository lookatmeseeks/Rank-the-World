(() => {
"use strict";
const $ = (selector) => document.querySelector(selector);
const viewport = $("#canvas-viewport"), world = $("#canvas-world"), layer = $("#islands-layer");
const modal = $("#create-modal"), form = $("#create-form"), titleInput = $("#ranking-title"), descInput = $("#ranking-description"), tagsInput = $("#ranking-tags");
const detail = $("#ranking-modal"), toast = $("#toast");
const state = { rankings: [], islands: new Map(), zoom: 1, panX: 0, panY: 0, nextId: 1, panning: null, activeRanking: null, clusterTag: "", layoutSeed: 1, animationFrame: null };
const COLORS = ["#b7a7ff","#7ed9c4","#f0be85","#f18ca7","#8ec7f3","#d4a0ef"];
function showToast(message) { toast.textContent = message; toast.classList.add("visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2800); }
function openDialog(d) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute("open"); }
function cleanTags(raw) { return [...new Set(raw.split(",").map(t => t.trim().replace(/^#+/, "")).filter(Boolean).map(t => t.slice(0, 32)))].slice(0, 8); }
function tagKey(tag) { return tag.trim().toLocaleLowerCase(); }
function groupRankings() {
  // Tags influence forces between individual rankings; they never merge rankings into a container.
  const matchingTags = [...new Map(state.rankings.flatMap(r=>r.tags).map(t=>[tagKey(t),t])).values()].sort((a,b)=>a.localeCompare(b));
  const selector=$("#cluster-tag");
  if(selector){
    const current=state.clusterTag;
    selector.replaceChildren();
    selector.append(new Option("No tag emphasis",""));
    matchingTags.forEach(t=>selector.append(new Option(t,t)));
    if(matchingTags.some(t=>tagKey(t)===tagKey(current))) selector.value=matchingTags.find(t=>tagKey(t)===tagKey(current));
    else { state.clusterTag=""; selector.value=""; }
  }
  return state.rankings.map(r=>({
    key:"ranking:"+r.id, items:[r], tags:r.tags, title:r.title,
    manual:false, cluster:false
  }));
}
function islandSize(group) { return { w: 320, h: 260 }; }
function arrangeIslands(groups, animate=true) {
  if(state.animationFrame) cancelAnimationFrame(state.animationFrame);
  const width=320,height=260,gap=54;
  const next=new Map();
  const rotation=Math.random()*Math.PI*2;
  const selected=state.clusterTag;
  const hasSelected=!!selected;
  const core=hasSelected?groups.filter(g=>g.items[0].tags.some(t=>tagKey(t)===tagKey(selected))):[];
  const outer=hasSelected?groups.filter(g=>!g.items[0].tags.some(t=>tagKey(t)===tagKey(selected))):[...groups];
  const placed=[];
  function sharedCount(a,b){
    return a.items[0].tags.filter(t=>b.items[0].tags.some(u=>tagKey(t)===tagKey(u))).length;
  }
  function overlaps(cx,cy,other){
    return Math.abs(cx-(other.targetX+width/2))<width+gap &&
           Math.abs(cy-(other.targetY+height/2))<height+gap;
  }
  // Rankings carrying the selected tag form the central group.
  // A golden-angle spiral spreads them around the center without a row/column bias.
  core.forEach((g,i)=>{
    g.w=width;g.h=height;g.manual=false;g.vx=0;g.vy=0;
    let radius=i===0?0:Math.ceil(Math.sqrt(i))*330;
    let angle=rotation+i*2.399963229728653;
    let cx=Math.cos(angle)*radius,cy=Math.sin(angle)*radius;
    let tries=0;
    while(placed.some(o=>overlaps(cx,cy,o))&&tries++<20){
      radius+=85;cx=Math.cos(angle)*radius;cy=Math.sin(angle)*radius;
    }
    g.targetX=cx-width/2;g.targetY=cy-height/2;
    placed.push(g);
  });
  // All remaining rankings grow outward in radial rings. Tag links affect the
  // preferred distance, while a fresh rotation/jitter avoids identical layouts.
  outer.forEach((g,i)=>{
    g.w=width;g.h=height;g.manual=false;g.vx=0;g.vy=0;
    let best=null,bestScore=Infinity;
    const coreRadius=hasSelected&&core.length?Math.max(...core.map(p=>Math.hypot(p.targetX+width/2,p.targetY+height/2))):0;
    const ringStart=hasSelected&&core.length?coreRadius+410:260;
    const startRadius=ringStart+Math.floor(i/8)*350;
    const phase=rotation+i*2.399963229728653;
    for(let ring=0;ring<6;ring++){
      const radius=startRadius+ring*100;
      for(let k=0;k<64;k++){
        const angle=phase+k*(Math.PI*2/64);
        const cx=Math.cos(angle)*radius+(Math.random()-.5)*55;
        const cy=Math.sin(angle)*radius+(Math.random()-.5)*55;
        let score=0;
        for(const other of placed){
          const ox=other.targetX+width/2,oy=other.targetY+height/2;
          const dist=Math.max(1,Math.hypot(cx-ox,cy-oy));
          const shared=sharedCount(g,other);
          const selectedLink=hasSelected&&g.items[0].tags.some(t=>tagKey(t)===tagKey(selected))&&other.items[0].tags.some(t=>tagKey(t)===tagKey(selected));
          const desired=shared?(selectedLink?390:450):720;
          score+=Math.abs(dist-desired)*(shared?1.2:.7);
          if(overlaps(cx,cy,other))score+=150000;
        }
        score+=Math.abs(Math.hypot(cx,cy)-radius)*.35;
        if(score<bestScore){bestScore=score;best={x:cx-width/2,y:cy-height/2};}
      }
      if(bestScore<10000)break;
    }
    g.targetX=best?best.x:Math.cos(phase)*startRadius-width/2;
    g.targetY=best?best.y:Math.sin(phase)*startRadius-height/2;
    placed.push(g);
  });
  groups.forEach(g=>{
    const angle=rotation+Math.random()*Math.PI*2;
    const radius=12+Math.random()*70;
    g.x=Math.cos(angle)*radius-width/2;
    g.y=Math.sin(angle)*radius-height/2;
    next.set(g.key,g);
  });
  state.islands=next;
}
function animateIslands(groups, slowAnimation=false) {
  const elements=groups.map(g=>layer.querySelector('[data-key="'+CSS.escape(g.key)+'"]'));
  elements.forEach(el=>{
    if(!el)return;
    const tilt=(Math.random()-.5)*12;
    el.style.left=(-160)+"px";el.style.top=(-130)+"px";
    el.style.opacity="0";
    el.style.transform="scale(.68) rotate("+tilt+"deg)";
    el.style.transition="none";
  });
  state.animationFrame=requestAnimationFrame(()=>{
    groups.forEach((g,i)=>{
      const el=elements[i];if(!el)return;
      const rankIndex=state.rankings.findIndex(r=>String(r.id)===String(g.items[0].id));
      const delay=(state.rankings.length-1-rankIndex)*(slowAnimation?125:65)+Math.random()*(slowAnimation?100:65);
      const moveDuration=slowAnimation?1550:850, popDuration=slowAnimation?1050:620, fadeDuration=slowAnimation?650:320;
      el.style.transition="left "+moveDuration+"ms cubic-bezier(.2,.75,.25,1) "+delay+"ms, top "+moveDuration+"ms cubic-bezier(.2,.75,.25,1) "+delay+"ms, opacity "+fadeDuration+"ms ease "+delay+"ms, transform "+popDuration+"ms cubic-bezier(.25,1.55,.5,1) "+delay+"ms";
      el.style.left=g.targetX+"px";el.style.top=g.targetY+"px";
      el.style.opacity="1";el.style.transform="scale(1) rotate(0deg)";
    });
    const strings=layer.querySelector(".tag-strings");
    if(strings)requestAnimationFrame(()=>{strings.style.opacity="1";});
    state.animationFrame=null;
  });
}
function createNode(tag, className, text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function createTagStrings(groups, slowAnimation=false) {
  const svgNS="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(svgNS,"svg");
  svg.classList.add("tag-strings");
  svg.setAttribute("aria-hidden","true");
  svg.style.cssText="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;opacity:0;transition:opacity "+(slowAnimation?"1200ms ease 900ms":"650ms ease 500ms")+";";
  const seen=new Set();
  for(let i=0;i<groups.length;i++){
    for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j];
      // Connect rankings only when their first tag matches.
      const tagA=a.items[0].tags[0], tagB=b.items[0].tags[0];
      if(!tagA || !tagB || tagKey(tagA)!==tagKey(tagB))continue;
      const tag=tagA;
      const pair=a.key+"|"+b.key;
      if(seen.has(pair))continue;seen.add(pair);
      const ax=a.targetX+a.w/2,ay=a.targetY+a.h/2;
      const bx=b.targetX+b.w/2,by=b.targetY+b.h/2;
      const dx=bx-ax,dy=by-ay,dist=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/dist,uy=dy/dist;
      const edge=(ux,uy)=>Math.min((a.w/2)/Math.max(.001,Math.abs(ux)),(a.h/2)/Math.max(.001,Math.abs(uy)));
      const ea=edge(ux,uy),eb=Math.min((b.w/2)/Math.max(.001,Math.abs(ux)),(b.h/2)/Math.max(.001,Math.abs(uy)));
      const x1=ax+ux*ea,y1=ay+uy*ea,x2=bx-ux*eb,y2=by-uy*eb;
      const bend=Math.min(65,dist*.12)*(i%2===0?1:-1);
      const cx=(x1+x2)/2-uy*bend,cy=(y1+y2)/2+ux*bend;
      const color=COLORS[Math.abs(hash(tagKey(tag)))%COLORS.length];
      const shadow=document.createElementNS(svgNS,"path");
      shadow.setAttribute("d",`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
      shadow.setAttribute("fill","none");shadow.setAttribute("stroke","#0b0c10");shadow.setAttribute("stroke-width","5");shadow.setAttribute("stroke-linecap","round");shadow.setAttribute("opacity",".72");
      const strand=document.createElementNS(svgNS,"path");
      strand.setAttribute("d",`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
      strand.setAttribute("fill","none");strand.setAttribute("stroke",color);strand.setAttribute("stroke-width","2");strand.setAttribute("stroke-linecap","round");strand.setAttribute("stroke-dasharray","5 5");strand.setAttribute("opacity",".82");
      svg.append(shadow,strand);
    }
  }
  return seen.size?svg:null;
}
function render(slowAnimation=false) {
  const groups=groupRankings(); arrangeIslands(groups, true);
  $("#ranking-count").textContent=state.rankings.length+" ranking"+(state.rankings.length===1?"":"s");
  $("#canvas-empty").hidden=state.rankings.length>0;
  layer.replaceChildren();
  const strings=createTagStrings(groups, slowAnimation);
  if(strings) layer.append(strings);
  groups.forEach(g=>{
    const island=createNode("section","island"+(g.cluster?" tag-cluster":" single-ranking"),undefined);
    island.dataset.key=g.key; island.style.left=g.x+"px"; island.style.top=g.y+"px"; island.style.width=g.w+"px";
    const header=createNode("div","island-header");
    const emblem=createNode("div","island-emblem",g.tags.length?g.tags[0].slice(0,1).toUpperCase():"◇");
    emblem.style.color=COLORS[Math.abs(hash(g.key))%COLORS.length];
    const titleWrap=createNode("div","island-title-wrap");
    titleWrap.append(createNode("h2","island-title",g.title),createNode("div","island-subtitle",g.cluster?g.items.length+" rankings share this tag":"Visible tier list"));
    header.append(emblem,titleWrap); island.append(header);
    const boards=createNode("div","island-rankings");
    boards.style.gridTemplateColumns=g.cluster?"repeat(2, minmax(0, 1fr))":"minmax(0, 1fr)";
    g.items.forEach(r=>{
      const board=createNode("article","ranking-board");
      board.dataset.rankingId=r.id;
      const boardHeader=createNode("div","board-header");
      boardHeader.append(createNode("h3","board-title",r.title));
      if(r.description)boardHeader.append(createNode("p","board-description",r.description));
      board.append(boardHeader);
      const tierGrid=createNode("div","tier-grid");
      [["S","#ef7777"],["A","#e9a45f"],["B","#e6cf6d"],["C","#80c99b"],["D","#83b6e9"]].forEach(([label,color])=>{
        const row=createNode("div","tier-row");
        const tier=createNode("div","tier-label",label);tier.style.background=color;
        const slots=createNode("div","tier-slots");
        for(let i=0;i<3;i++)slots.append(createNode("span","tier-slot"));
        row.append(tier,slots);tierGrid.append(row);
      });
      board.append(tierGrid);
      boards.append(board);
    });
    island.append(boards);
    const footer=createNode("div","island-footer"),tagWrap=createNode("div","island-tags");
    (g.cluster?g.tags:g.items[0].tags).slice(0,4).forEach(t=>tagWrap.append(createNode("span","tag","# "+t)));
    if(!g.tags.length)tagWrap.append(createNode("span","island-empty","No tags"));
    if(g.cluster){footer.append(tagWrap,createNode("span","island-count",g.items.length+" grids"));island.append(footer);} else {footer.append(tagWrap);island.append(footer);}
    layer.append(island);
  });
  applyTransform();
  animateIslands(groups, slowAnimation);
}
function hash(str){let h=0;for(let i=0;i<str.length;i++)h=((h<<5)-h)+str.charCodeAt(i)|0;return h;}
function applyTransform(){world.style.transform="translate("+((viewport.clientWidth/2)+state.panX)+"px,"+((viewport.clientHeight/2)+state.panY)+"px) scale("+state.zoom+")";$("#zoom-level").textContent=Math.round(state.zoom*100)+"%";}
function screenToWorld(x,y){const rect=viewport.getBoundingClientRect();return {x:(x-rect.left-rect.width/2-state.panX)/state.zoom,y:(y-rect.top-rect.height/2-state.panY)/state.zoom};}
function setZoom(next, cx=viewport.clientWidth/2, cy=viewport.clientHeight/2){const before=screenToWorld(cx+viewport.getBoundingClientRect().left,cy+viewport.getBoundingClientRect().top);state.zoom=Math.max(.25,Math.min(2.1,next));const rect=viewport.getBoundingClientRect();state.panX=cx-rect.width/2-before.x*state.zoom;state.panY=cy-rect.height/2-before.y*state.zoom;applyTransform();}
function startPan(e){
  if(e.button!==0||e.target.closest(".island")||e.target.closest("button"))return;
  e.preventDefault();
  state.panning={pointerId:e.pointerId,x:e.clientX,y:e.clientY,px:state.panX,py:state.panY};
  viewport.classList.add("panning");
  try{viewport.setPointerCapture(e.pointerId);}catch{}
}
function movePointer(e){
  if(!state.panning || e.pointerId!==state.panning.pointerId)return;
  e.preventDefault();
  state.panX=state.panning.px+e.clientX-state.panning.x;
  state.panY=state.panning.py+e.clientY-state.panning.y;
  applyTransform();
}
function endPointer(e){
  if(e && state.panning && e.pointerId!==undefined && e.pointerId!==state.panning.pointerId)return;
  if(state.panning){state.panning=null;viewport.classList.remove("panning");}
}
viewport.addEventListener("pointerdown",startPan);
viewport.addEventListener("pointermove",movePointer);
viewport.addEventListener("pointerup",endPointer);viewport.addEventListener("pointercancel",endPointer);
viewport.addEventListener("lostpointercapture",endPointer);

viewport.addEventListener("wheel",e=>{e.preventDefault();const rect=viewport.getBoundingClientRect();setZoom(state.zoom*(e.deltaY<0?1.1:1/1.1),e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
$("#zoom-in").addEventListener("click",()=>setZoom(state.zoom*1.18));$("#zoom-out").addEventListener("click",()=>setZoom(state.zoom/1.18));
$("#reset-view").addEventListener("click",()=>{state.zoom=1;state.panX=0;state.panY=0;applyTransform();});
$("#cluster-tag").addEventListener("change",e=>{state.clusterTag=e.target.value;render(true);showToast(state.clusterTag?"Reforming islands around tag: "+state.clusterTag:"Reforming islands using all shared tags.");});
function openCreate(){form.reset();openDialog(modal);setTimeout(()=>titleInput.focus(),30);}
$("#create-ranking").addEventListener("click",openCreate);$("#empty-create").addEventListener("click",openCreate);
function addTestSet(){
  const samples=[
    {title:"Naruto Characters",description:"Main and supporting characters",tags:["Naruto","Characters","Anime"]},
    {title:"One Piece Characters",description:"Pirates, marines, and other characters",tags:["One Piece","Characters","Anime"]},
    {title:"Naruto Openings",description:"Opening themes across the series",tags:["Naruto","Openings","Anime","Music"]},
    {title:"Naruto Powers",description:"Jutsu, kekkei genkai, and abilities",tags:["Naruto","Powers","Anime"]},
    {title:"One Piece Powers",description:"Devil fruits, haki, and techniques",tags:["One Piece","Powers","Anime"]},
    {title:"Best Anime Openings",description:"Cross-series opening comparison",tags:["Openings","Anime","Music"]},
    {title:"Studio Ghibli Films",description:"A separate topic with a few broad tags",tags:["Anime","Films","Studio Ghibli"]}
  ];
  let added=0;
  samples.forEach(sample=>{
    if(state.rankings.some(r=>r.title.toLocaleLowerCase()===sample.title.toLocaleLowerCase()))return;
    state.rankings.push({...sample,id:String(state.nextId++)});added++;
  });
  if(!added){showToast("The test rankings are already on the canvas.");return;}
  render();
  showToast("Added "+added+" test rankings with overlapping tags.");
}
$("#add-test-lists").addEventListener("click",addTestSet);

$("#close-modal").addEventListener("click",()=>closeDialog(modal));$("#cancel-modal").addEventListener("click",()=>closeDialog(modal));
modal.addEventListener("click",e=>{if(e.target===modal)closeDialog(modal);});
form.addEventListener("submit",e=>{e.preventDefault();const title=titleInput.value.trim();if(!title){titleInput.focus();return;}const id=form.dataset.editId;if(id){const r=state.rankings.find(x=>x.id===id);if(!r)return;r.title=title;r.description=descInput.value.trim();r.tags=cleanTags(tagsInput.value);delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";closeDialog(modal);render();showToast("Ranking updated; islands are reforming by tag relationships.");return;}state.rankings.push({id:String(state.nextId++),title,description:descInput.value.trim(),tags:cleanTags(tagsInput.value)});closeDialog(modal);render();showToast("Ranking added; the islands are forming.");});
modal.addEventListener("close",()=>{delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";});
window.addEventListener("resize",applyTransform);
applyTransform();
})();