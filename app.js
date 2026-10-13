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
function preservePositions(groups) {
  const old=state.islands, next=new Map();
  groups.forEach((g,i)=>{
    const prior=old.get(g.key), size=islandSize(g);
    if(prior){g.x=prior.x;g.y=prior.y;g.vx=prior.vx||0;g.vy=prior.vy||0;g.manual=prior.manual;}
    else {
      // Seed new rankings near the existing landscape, then let tag forces settle them.
      const angle=i*2.399963229728653, radius=groups.length>1?180+Math.sqrt(i)*75:0;
      g.x=Math.cos(angle)*radius;g.y=Math.sin(angle)*radius;g.vx=0;g.vy=0;g.manual=false;
    }
    g.w=size.w;g.h=size.h;next.set(g.key,g);
  });
  state.islands=next;
}
function simulateLayout() {
  if(state.simFrame) cancelAnimationFrame(state.simFrame);
  let ticks=0;
  const nodes=[...state.islands.values()];
  if(nodes.length<2)return;
  function step(){
    const alpha=Math.max(0.025,1-ticks/240);
    for(let i=0;i<nodes.length;i++){
      const a=nodes[i];
      // Manually placed rankings stay pinned but still influence their neighbors.
      if(!a.manual){a.vx+=(-a.x)*0.0008*alpha;a.vy+=(-a.y)*0.0008*alpha;}
      for(let j=i+1;j<nodes.length;j++){
        const b=nodes[j],dx=b.x-a.x,dy=b.y-a.y;
        const dist=Math.max(1,Math.hypot(dx,dy)),ux=dx/dist,uy=dy/dist;
        const shared=a.items[0].tags.filter(t=>b.items[0].tags.some(u=>tagKey(t)===tagKey(u)));
        const selected=state.clusterTag && shared.some(t=>tagKey(t)===tagKey(state.clusterTag));
        if(shared.length){
          const target=selected?365:455;
          const strength=selected?0.018:0.0065;
          const force=(dist-target)*strength*alpha;
          if(!a.manual){a.vx+=ux*force;a.vy+=uy*force;}
          if(!b.manual){b.vx-=ux*force;b.vy-=uy*force;}
        } else {
          const minDist=440, force=Math.max(0,minDist-dist)*0.025*alpha;
          if(!a.manual){a.vx-=ux*force;a.vy-=uy*force;}
          if(!b.manual){b.vx+=ux*force;b.vy+=uy*force;}
        }
        // Collision padding prevents boards from overlapping even when several tags attract them.
        const collision=365-dist;
        if(collision>0){
          const force=collision*0.035*alpha;
          a.vx-=ux*force;a.vy-=uy*force;
          if(!b.manual){b.vx+=ux*force;b.vy+=uy*force;}
        }
      }
      if(!a.manual){a.vx*=0.82;a.vy*=0.82;a.x+=a.vx;a.y+=a.vy;}
    }
    nodes.forEach(g=>{
      const el=layer.querySelector('[data-key="'+CSS.escape(g.key)+'"]');
      if(el){el.style.left=g.x+"px";el.style.top=g.y+"px";}
    });
    ticks++;
    if(ticks<240)state.simFrame=requestAnimationFrame(step);
    else state.simFrame=null;
  }
  state.simFrame=requestAnimationFrame(step);
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
  simulateLayout();
}
function hash(str){let h=0;for(let i=0;i<str.length;i++)h=((h<<5)-h)+str.charCodeAt(i)|0;return h;}
function applyTransform(){world.style.transform="translate("+((viewport.clientWidth/2)+state.panX)+"px,"+((viewport.clientHeight/2)+state.panY)+"px) scale("+state.zoom+")";$("#zoom-level").textContent=Math.round(state.zoom*100)+"%";}
function screenToWorld(x,y){const rect=viewport.getBoundingClientRect();return {x:(x-rect.left-rect.width/2-state.panX)/state.zoom,y:(y-rect.top-rect.height/2-state.panY)/state.zoom};}
function setZoom(next, cx=viewport.clientWidth/2, cy=viewport.clientHeight/2){const before=screenToWorld(cx+viewport.getBoundingClientRect().left,cy+viewport.getBoundingClientRect().top);state.zoom=Math.max(.25,Math.min(2.1,next));const rect=viewport.getBoundingClientRect();state.panX=cx-rect.width/2-before.x*state.zoom;state.panY=cy-rect.height/2-before.y*state.zoom;applyTransform();}
function autoArrange(){state.islands.forEach(g=>g.manual=false);state.islands.clear();render();showToast("Rearranging rankings using tag relationships.");}
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
$("#auto-arrange").addEventListener("click",autoArrange);
$("#cluster-tag").addEventListener("change",e=>{state.clusterTag=e.target.value;state.islands.clear();render();showToast(state.clusterTag?"Emphasizing tag: "+state.clusterTag:"Using all tags equally.");});
function openCreate(){form.reset();openDialog(modal);setTimeout(()=>titleInput.focus(),30);}
$("#create-ranking").addEventListener("click",openCreate);$("#empty-create").addEventListener("click",openCreate);
$("#close-modal").addEventListener("click",()=>closeDialog(modal));$("#cancel-modal").addEventListener("click",()=>closeDialog(modal));
modal.addEventListener("click",e=>{if(e.target===modal)closeDialog(modal);});
form.addEventListener("submit",e=>{e.preventDefault();const title=titleInput.value.trim();if(!title){titleInput.focus();return;}const id=form.dataset.editId;if(id){const r=state.rankings.find(x=>x.id===id);if(!r)return;r.title=title;r.description=descInput.value.trim();r.tags=cleanTags(tagsInput.value);delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";closeDialog(modal);render();showToast("Ranking updated. Islands regrouped by tags.");return;}state.rankings.push({id:String(state.nextId++),title,description:descInput.value.trim(),tags:cleanTags(tagsInput.value)});closeDialog(modal);render();showToast("Ranking added to the canvas.");});
modal.addEventListener("close",()=>{delete form.dataset.editId;$("#modal-title").textContent="Create a ranking";form.querySelector('[type="submit"]').textContent="Create ranking";});
window.addEventListener("resize",applyTransform);
applyTransform();
})();