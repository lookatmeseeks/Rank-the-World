(() => {
"use strict";
const $ = (selector) => document.querySelector(selector);
const viewport = $("#canvas-viewport"), world = $("#canvas-world"), layer = $("#islands-layer");
const modal = $("#create-modal"), form = $("#create-form"), titleInput = $("#ranking-title"), descInput = $("#ranking-description"), tagsInput = $("#ranking-tags");
const detail = $("#ranking-modal"), toast = $("#toast");
const state = { rankings: [], islands: new Map(), zoom: 1, panX: 0, panY: 0, nextId: 1, dragging: null, panning: null, activeRanking: null, clusterTag: "" };
const COLORS = ["#b7a7ff","#7ed9c4","#f0be85","#f18ca7","#8ec7f3","#d4a0ef"];
function showToast(message) { toast.textContent = message; toast.classList.add("visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2800); }
function openDialog(d) { if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute("open"); }
function cleanTags(raw) { return [...new Set(raw.split(",").map(t => t.trim().replace(/^#+/, "")).filter(Boolean).map(t => t.slice(0, 32)))].slice(0, 8); }
function tagKey(tag) { return tag.trim().toLocaleLowerCase(); }
function groupRankings() {
  // A selected tag controls proximity, never merges all transitively connected tags.
  const matchingTags = [...new Map(state.rankings.flatMap(r=>r.tags).map(t=>[tagKey(t),t])).values()].sort((a,b)=>a.localeCompare(b));
  const selector=$("#cluster-tag");
  if(selector){
    const current=state.clusterTag;
    selector.replaceChildren();
    selector.append(new Option("No tag grouping",""));
    matchingTags.forEach(t=>selector.append(new Option(t,t)));
    if(matchingTags.some(t=>tagKey(t)===tagKey(current))) selector.value=matchingTags.find(t=>tagKey(t)===tagKey(current));
    else { state.clusterTag=""; selector.value=""; }
  }
  const clusters=new Map();
  state.rankings.forEach(r=>{
    const selected=state.clusterTag && r.tags.some(t=>tagKey(t)===tagKey(state.clusterTag));
    const key=selected ? "tag:"+tagKey(state.clusterTag) : "ranking:"+r.id;
    if(!clusters.has(key)) clusters.set(key,[]);
    clusters.get(key).push(r);
  });
  return [...clusters.values()].map(items=>{
    const isCluster=items.length>1 && state.clusterTag && items.every(r=>r.tags.some(t=>tagKey(t)===tagKey(state.clusterTag)));
    const tags=isCluster?[state.clusterTag]:items[0].tags;
    return {key:isCluster?"tag:"+tagKey(state.clusterTag):"ranking:"+items[0].id,items,tags,title:isCluster?state.clusterTag:items[0].title,manual:false,cluster:!!isCluster};
  });
}
function islandSize(group) {
  const columns = group.items.length > 1 ? 2 : 1;
  const rows = Math.ceil(group.items.length / columns);
  return { w: group.cluster ? 670 : 320, h: group.cluster ? 86 + rows * 218 + 28 : 250 };
}
function getIslandPosition(key, w, h, taken) {
  const gap=150, step=850;
  // Spiral outward from the origin until a clear rectangle is found.
  for(let ring=0;ring<100;ring++){
    const candidates=[];
    if(ring===0)candidates.push([0,0]);
    else for(let x=-ring;x<=ring;x++){candidates.push([x*step,-ring*step]);candidates.push([x*step,ring*step]);}
    for(let y=-ring+1;y<ring;y++){candidates.push([-ring*step,y*step]);candidates.push([ring*step,y*step]);}
    for(const [x,y] of candidates){
      const rect={x,y,w,h};
      if(taken.every(p=>rect.x+rect.w+gap<=p.x||p.x+p.w+gap<=rect.x||rect.y+rect.h+gap<=p.y||p.y+p.h+gap<=rect.y)) return {x,y};
    }
  }
  return {x:taken.length*step,y:0};
}
function preservePositions(groups) {
  const old=state.islands, next=new Map(), occupied=[];
  // Keep prior locations when the island key still exists, then place new groups into free space.
  groups.forEach(g=>{const prior=old.get(g.key);if(prior){const size=islandSize(g);g.x=prior.x;g.y=prior.y;g.manual=prior.manual;g.w=size.w;g.h=size.h;}});
  groups.filter(g=>g.manual).forEach(g=>occupied.push({x:g.x,y:g.y,w:g.w,h:g.h,key:g.key}));
  groups.filter(g=>!g.manual&&old.has(g.key)).forEach(g=>occupied.push({x:g.x,y:g.y,w:g.w,h:g.h,key:g.key}));
  groups.filter(g=>!old.has(g.key)).forEach(g=>{const size=islandSize(g),p=getIslandPosition(g.key,size.w,size.h,occupied);g.x=p.x;g.y=p.y;g.w=size.w;g.h=size.h;occupied.push({...p,w:size.w,h:size.h,key:g.key});});
  // If a tag merge brings existing islands together, keep the merged island at one prior location and
  // re-place only conflicting auto islands; manually placed islands remain where their owner left them.
  const placed=[];
  groups.forEach(g=>{
    if(!g.w){const s=islandSize(g);g.w=s.w;g.h=s.h;}
    if(placed.some(p=>!(g.x+g.w+55<=p.x||p.x+p.w+55<=g.x||g.y+g.h+55<=p.y||p.y+p.h+55<=g.y))){
      const s=islandSize(g),p=getIslandPosition(g.key,s.w,s.h,placed);g.x=p.x;g.y=p.y;g.w=s.w;g.h=s.h;
    }
    placed.push({x:g.x,y:g.y,w:g.w,h:g.h,key:g.key});
    next.set(g.key,g);
  });
  state.islands=next;
}
function createNode(tag, className, text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function render() {
  const groups=groupRankings(); preservePositions(groups);
  $("#ranking-count").textContent=state.rankings.length+" ranking"+(state.rankings.length===1?"":"s");
  $("#canvas-empty").hidden=state.rankings.length>0;
  layer.replaceChildren();
  groups.forEach(g=>{
    const island=createNode("section","island"+(g.manual?" manual":"")+(g.cluster?" tag-cluster":" single-ranking"),undefined);
    island.dataset.key=g.key; island.style.left=g.x+"px"; island.style.top=g.y+"px"; island.style.width=g.w+"px";
    const header=createNode("div","island-header");
    const emblem=createNode("div","island-emblem",g.tags.length?g.tags[0].slice(0,1).toUpperCase():"◇");
    emblem.style.color=COLORS[Math.abs(hash(g.key))%COLORS.length];
    const titleWrap=createNode("div","island-title-wrap");
    titleWrap.append(createNode("h2","island-title",g.title),createNode("div","island-subtitle",g.cluster?g.items.length+" rankings share this tag":"Visible tier list"));
    const mode=createNode("span","island-mode",g.manual?"MANUAL":"AUTO");
    header.append(emblem,titleWrap,mode); island.append(header);
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
}
function hash(str){let h=0;for(let i=0;i<str.length;i++)h=((h<<5)-h)+str.charCodeAt(i)|0;return h;}
function applyTransform(){world.style.transform="translate("+((viewport.clientWidth/2)+state.panX)+"px,"+((viewport.clientHeight/2)+state.panY)+"px) scale("+state.zoom+")";$("#zoom-level").textContent=Math.round(state.zoom*100)+"%";}
function screenToWorld(x,y){const rect=viewport.getBoundingClientRect();return {x:(x-rect.left-rect.width/2-state.panX)/state.zoom,y:(y-rect.top-rect.height/2-state.panY)/state.zoom};}
function setZoom(next, cx=viewport.clientWidth/2, cy=viewport.clientHeight/2){const before=screenToWorld(cx+viewport.getBoundingClientRect().left,cy+viewport.getBoundingClientRect().top);state.zoom=Math.max(.25,Math.min(2.1,next));const rect=viewport.getBoundingClientRect();state.panX=cx-rect.width/2-before.x*state.zoom;state.panY=cy-rect.height/2-before.y*state.zoom;applyTransform();}
function autoArrange(){state.islands.forEach(g=>g.manual=false);state.islands.clear();render();showToast("Islands automatically arranged by tags.");}
function startPan(e){if(e.button!==0||e.target.closest(".island")||e.target.closest("button"))return;state.panning={x:e.clientX,y:e.clientY,px:state.panX,py:state.panY};viewport.classList.add("panning");viewport.setPointerCapture(e.pointerId);}
function movePointer(e){if(state.panning){state.panX=state.panning.px+e.clientX-state.panning.x;state.panY=state.panning.py+e.clientY-state.panning.y;applyTransform();}else if(state.dragging){const p=screenToWorld(e.clientX,e.clientY),g=state.islands.get(state.dragging.key);if(!g)return;g.x=p.x-state.dragging.dx;g.y=p.y-state.dragging.dy;const el=layer.querySelector('[data-key="'+CSS.escape(g.key)+'"]');if(el){el.style.left=g.x+"px";el.style.top=g.y+"px";}}}
function endPointer(){if(state.panning){state.panning=null;viewport.classList.remove("panning");}if(state.dragging){const g=state.islands.get(state.dragging.key);if(g)g.manual=true;const el=layer.querySelector(".island.dragging");if(el)el.classList.remove("dragging");state.dragging=null;render();}}
viewport.addEventListener("pointerdown",startPan);
viewport.addEventListener("pointermove",movePointer);
viewport.addEventListener("pointerup",endPointer);viewport.addEventListener("pointercancel",endPointer);
layer.addEventListener("pointerdown",e=>{const header=e.target.closest(".island-header");const island=e.target.closest(".island");if(!header||!island||e.button!==0)return;e.preventDefault();const key=island.dataset.key,g=state.islands.get(key),p=screenToWorld(e.clientX,e.clientY);state.dragging={key,dx:p.x-g.x,dy:p.y-g.y};island.classList.add("dragging");island.setPointerCapture?.(e.pointerId);});

viewport.addEventListener("wheel",e=>{e.preventDefault();const rect=viewport.getBoundingClientRect();setZoom(state.zoom*(e.deltaY<0?1.1:1/1.1),e.clientX-rect.left,e.clientY-rect.top);},{passive:false});
$("#zoom-in").addEventListener("click",()=>setZoom(state.zoom*1.18));$("#zoom-out").addEventListener("click",()=>setZoom(state.zoom/1.18));
$("#reset-view").addEventListener("click",()=>{state.zoom=1;state.panX=0;state.panY=0;applyTransform();});
$("#auto-arrange").addEventListener("click",autoArrange);\n$("#cluster-tag").addEventListener("change",e=>{state.clusterTag=e.target.value;state.islands.clear();render();showToast(state.clusterTag?"Clustered by tag: "+state.clusterTag:"Showing rankings as separate grids.");});
function openCreate(){form.reset();openDialog(modal);setTimeout(()=>titleInput.focus(),30);}
$("#create-ranking").addEventListener("click",openCreate);$("#empty-create").addEventListener("click",openCreate);
$("#close-modal").addEventListener("click",()=>closeDialog(modal));$("#cancel-modal").addEventListener("click",()=>closeDialog(modal));
modal.addEventListener("click",e=>{if(e.target===modal)closeDialog(modal);});
form.addEventListener("submit",e=>{e.preventDefault();const title=titleInput.value.trim();if(!title){titleInput.focus();return;}const id=form.dataset.editId;if(id){const r=state.rankings.find(x=>x.id===id);if(!r)return;r.title=title;r.description=descInput.value.trim();r.tags=cleanTags(tagsInput.value);delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";closeDialog(modal);render();showToast("Ranking updated. Islands regrouped by tags.");return;}state.rankings.push({id:String(state.nextId++),title,description:descInput.value.trim(),tags:cleanTags(tagsInput.value)});closeDialog(modal);render();showToast("Ranking added to the canvas.");});
modal.addEventListener("close",()=>{delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";});
window.addEventListener("resize",applyTransform);
applyTransform();
})();