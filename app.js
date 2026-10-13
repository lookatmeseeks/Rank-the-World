(() => {
"use strict";
const $ = (selector) => document.querySelector(selector);
const viewport = $("#canvas-viewport"), world = $("#canvas-world"), layer = $("#islands-layer");
const modal = $("#create-modal"), form = $("#create-form"), titleInput = $("#ranking-title"), descInput = $("#ranking-description"), tagsInput = $("#ranking-tags");
const detail = $("#ranking-modal"), toast = $("#toast");
const DEFAULT_FORCES = { coreSpacing:300, outerOffset:1000, ringSpacing:420, tagPull:70, separation:850, randomness:35 };
const forces = {...DEFAULT_FORCES};
let lastAppliedForces = {...DEFAULT_FORCES};
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
  const variation=forces.randomness/100;
  // The selected tag's rankings occupy a compact central cluster, with only enough spacing to avoid overlap.
  core.forEach((g,i)=>{
    g.w=width;g.h=height;g.vx=0;g.vy=0;
    let radius=i===0?0:Math.ceil(Math.sqrt(i))*forces.coreSpacing;
    let angle=rotation+i*2.399963229728653+(Math.random()-.5)*variation*.5;
    let cx=Math.cos(angle)*radius,cy=Math.sin(angle)*radius;
    let tries=0;
    while(placed.some(o=>overlaps(cx,cy,o))&&tries++<24){
      radius+=Math.max(35,forces.coreSpacing*.2);cx=Math.cos(angle)*radius;cy=Math.sin(angle)*radius;
    }
    g.targetX=cx-width/2;g.targetY=cy-height/2;placed.push(g);
  });
  // Nonmatching rankings are constrained to distant concentric rings. Shared tags
  // influence angular placement, so related outer rankings orbit near one another.
  outer.forEach((g,i)=>{
    g.w=width;g.h=height;g.vx=0;g.vy=0;
    let best=null,bestScore=Infinity;
    const coreRadius=hasSelected&&core.length?Math.max(...core.map(p=>Math.hypot(p.targetX+width/2,p.targetY+height/2))):0;
    const ringStart=hasSelected&&core.length?Math.max(forces.outerOffset,coreRadius+forces.outerOffset):Math.max(420,forces.outerOffset*.65);
    const ringIndex=Math.floor(i/Math.max(8,Math.floor(8+variation*8)));
    const targetRadius=ringStart+ringIndex*forces.ringSpacing;
    const phase=rotation+i*2.399963229728653;
    for(let ring=0;ring<4;ring++){
      const radius=targetRadius+ring*forces.ringSpacing*.45;
      for(let k=0;k<96;k++){
        const angle=phase+k*(Math.PI*2/96);
        const jitter=(Math.random()-.5)*forces.randomness*1.2;
        const cx=Math.cos(angle)*(radius+jitter);
        const cy=Math.sin(angle)*(radius+jitter);
        let score=Math.abs(Math.hypot(cx,cy)-targetRadius)*1.7;
        for(const other of placed){
          const ox=other.targetX+width/2,oy=other.targetY+height/2;
          const dist=Math.max(1,Math.hypot(cx-ox,cy-oy));
          const shared=sharedCount(g,other);
          if(hasSelected&&core.includes(other)){
            // Keep every nonmatching ranking outside a clear buffer around the emphasized core.
            const minDist=coreRadius+forces.outerOffset;
            score+=Math.max(0,minDist-dist)*5;
          } else {
            const desired=shared?Math.max(width+gap+15,forces.separation*(1-(forces.tagPull/100)*Math.min(1,shared/2))):forces.separation;
            score+=Math.abs(dist-desired)*(shared?1.8:0.75);
          }
          if(overlaps(cx,cy,other))score+=250000;
        }
        score+=(Math.random()-.5)*forces.randomness*4;
        if(score<bestScore){bestScore=score;best={x:cx-width/2,y:cy-height/2};}
      }
    }
    g.targetX=best?best.x:Math.cos(phase)*targetRadius-width/2;
    g.targetY=best?best.y:Math.sin(phase)*targetRadius-height/2;
    placed.push(g);
  });
  // Without an emphasized tag, retain a radial layout but still group shared tags.
  if(!hasSelected){
    // The scoring above already applies shared-tag attraction across all rankings.
  }
  groups.forEach(g=>{
    const angle=rotation+Math.random()*Math.PI*2;
    const radius=12+Math.random()*70;
    g.x=Math.cos(angle)*radius-width/2;g.y=Math.sin(angle)*radius-height/2;
  });
  state.islands=new Map(groups.map(g=>[g.key,g]));
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
    if(strings){
      updateTagStringPaths(groups,strings);
      requestAnimationFrame(()=>{
        strings.querySelectorAll('path[data-role="strand"]').forEach(path=>path.setAttribute("stroke-dashoffset","0"));
        const began=performance.now();
        const total=(slowAnimation?1550:850)+Math.max(0,...groups.map((g,i)=>{
          const rankIndex=state.rankings.findIndex(r=>String(r.id)===String(g.items[0].id));
          return (state.rankings.length-1-rankIndex)*(slowAnimation?125:65)+(slowAnimation?100:65);
        }));
        const follow=now=>{
          updateTagStringPaths(groups,strings);
          if(now-began<total+100)requestAnimationFrame(follow);
        };
        requestAnimationFrame(follow);
      });
    }
    state.animationFrame=null;
  });
}
function createNode(tag, className, text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function createTagStrings(groups, slowAnimation=false) {
  const svgNS="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(svgNS,"svg");
  svg.classList.add("tag-strings");
  svg.setAttribute("aria-hidden","true");
  svg.style.cssText="position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;opacity:1;";
  const seen=new Set();
  for(let i=0;i<groups.length;i++){
    for(let j=i+1;j<groups.length;j++){
      const a=groups[i],b=groups[j];
      const tagA=a.items[0].tags[0], tagB=b.items[0].tags[0];
      if(!tagA || !tagB || tagKey(tagA)!==tagKey(tagB))continue;
      const pair=a.key+"|"+b.key;
      if(seen.has(pair))continue;
      seen.add(pair);
      const tag=tagA;
      const color=COLORS[Math.abs(hash(tagKey(tag)))%COLORS.length];
      const shadow=document.createElementNS(svgNS,"path");
      const strand=document.createElementNS(svgNS,"path");
      [shadow,strand].forEach(path=>{
        path.dataset.a=a.key;
        path.dataset.b=b.key;
        path.setAttribute("fill","none");
        path.setAttribute("stroke-linecap","round");
        path.setAttribute("vector-effect","non-scaling-stroke");
      });
      shadow.dataset.role="shadow";
      shadow.setAttribute("stroke","#0b0c10");
      shadow.setAttribute("stroke-width","5");
      shadow.setAttribute("opacity",".72");
      strand.dataset.role="strand";
      strand.setAttribute("pathLength","1");
      strand.setAttribute("stroke",color);
      strand.setAttribute("stroke-width","2");
      strand.setAttribute("opacity",".9");
      strand.setAttribute("stroke-dasharray","1");
      strand.setAttribute("stroke-dashoffset","1");
      strand.style.transition="stroke-dashoffset "+(slowAnimation?"1550ms":"850ms")+" cubic-bezier(.2,.75,.25,1)";
      const dotA=document.createElementNS(svgNS,"circle");
      const dotB=document.createElementNS(svgNS,"circle");
      [[dotA,"a"],[dotB,"b"]].forEach(([dot,side])=>{
        dot.dataset.a=a.key;
        dot.dataset.b=b.key;
        dot.dataset.endpoint=side;
        dot.setAttribute("r","3");
        dot.setAttribute("fill",color);
        dot.setAttribute("stroke","#171920");
        dot.setAttribute("stroke-width","1.5");
      });
      svg.append(shadow,strand,dotA,dotB);
    }
  }
  return seen.size?svg:null;
}
function updateTagStringPaths(groups, svg) {
  if(!svg)return;
  const elements=new Map(groups.map(g=>[g.key,layer.querySelector('[data-key="'+CSS.escape(g.key)+'"]')]));
  const rectFor=key=>{
    const el=elements.get(key);
    if(!el)return null;
    const x=parseFloat(getComputedStyle(el).left)||0;
    const y=parseFloat(getComputedStyle(el).top)||0;
    return {x,y,w:el.offsetWidth||320,h:el.offsetHeight||260,cx:x+(el.offsetWidth||320)/2,cy:y+(el.offsetHeight||260)/2};
  };
  const closestAnchors=(a,b)=>{
    const overlapTop=Math.max(a.y,b.y),overlapBottom=Math.min(a.y+a.h,b.y+b.h);
    const overlapLeft=Math.max(a.x,b.x),overlapRight=Math.min(a.x+a.w,b.x+b.w);
    const gapX=Math.max(0,b.x-(a.x+a.w),a.x-(b.x+b.w));
    const gapY=Math.max(0,b.y-(a.y+a.h),a.y-(b.y+b.h));
    if(gapX>0 && overlapBottom>=overlapTop){
      const y=Math.max(overlapTop,Math.min(overlapBottom,(a.cy+b.cy)/2));
      return b.cx>a.cx?[{x:a.x+a.w,y},{x:b.x,y}]:[{x:a.x,y},{x:b.x+b.w,y}];
    }
    if(gapY>0 && overlapRight>=overlapLeft){
      const x=Math.max(overlapLeft,Math.min(overlapRight,(a.cx+b.cx)/2));
      return b.cy>a.cy?[{x,y:a.y+a.h},{x,y:b.y}]:[{x,y:a.y},{x,y:b.y+b.h}];
    }
    if(gapX>0 && gapY>0){
      return [
        {x:b.cx>a.cx?a.x+a.w:a.x,y:b.cy>a.cy?a.y+a.h:a.y},
        {x:b.cx>a.cx?b.x:b.x+b.w,y:b.cy>a.cy?b.y:b.y+b.h}
      ];
    }
    const dx=b.cx-a.cx,dy=b.cy-a.cy;
    const scaleA=1/Math.max(Math.abs(dx)/(a.w/2),Math.abs(dy)/(a.h/2),0.0001);
    const scaleB=1/Math.max(Math.abs(dx)/(b.w/2),Math.abs(dy)/(b.h/2),0.0001);
    return [{x:a.cx+dx*scaleA,y:a.cy+dy*scaleA},{x:b.cx-dx*scaleB,y:b.cy-dy*scaleB}];
  };
  svg.querySelectorAll("path[data-a]").forEach(path=>{
    const a=rectFor(path.dataset.a),b=rectFor(path.dataset.b);
    if(!a||!b)return;
    const [p1,p2]=closestAnchors(a,b);
    const dx=p2.x-p1.x,dy=p2.y-p1.y,dist=Math.hypot(dx,dy);
    const slack=Math.min(72,18+dist*.065);
    const cx=(p1.x+p2.x)/2,cy=(p1.y+p2.y)/2+slack;
    path.setAttribute("d",`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`);
  });
  svg.querySelectorAll("circle[data-endpoint]").forEach(dot=>{
    const a=rectFor(dot.dataset.a),b=rectFor(dot.dataset.b);
    if(!a||!b)return;
    const [p1,p2]=closestAnchors(a,b);
    const point=dot.dataset.endpoint==="a"?p1:p2;
    dot.setAttribute("cx",point.x);
    dot.setAttribute("cy",point.y);
  });
}

function updateLayoutVisually(changedKey="") {
  // Adjust the current positions in place. Never run the randomized layout search
  // from a force-slider event: that would choose new angular positions each time.
  const groups=[...state.islands.values()];
  if(!groups.length)return;
  const width=320,height=260;
  const elements=groups.map(g=>({g,el:layer.querySelector('[data-key="'+CSS.escape(g.key)+'"]')})).filter(x=>x.el);
  const positions=elements.map(({g,el})=>({
    g,el,
    x:parseFloat(el.style.left)||0,
    y:parseFloat(el.style.top)||0,
    cx:(parseFloat(el.style.left)||0)+width/2,
    cy:(parseFloat(el.style.top)||0)+height/2
  }));
  const selected=state.clusterTag;
  const core=positions.filter(p=>selected&&p.g.items[0].tags.some(t=>tagKey(t)===tagKey(selected)));
  const coreKeys=new Set(core.map(p=>p.g.key));
  const center={x:0,y:0};
  const before={...lastAppliedForces};
  const after={...forces};
  const dx=after.coreSpacing-before.coreSpacing;
  const dOuter=after.outerOffset-before.outerOffset;
  const dRing=after.ringSpacing-before.ringSpacing;
  const dSeparation=after.separation-before.separation;
  const dPull=after.tagPull-before.tagPull;
  const moved=new Map(positions.map(p=>[p.g.key,{x:p.x,y:p.y}]));
  const addMove=(key,x,y)=>{
    const point=moved.get(key);if(!point)return;
    point.x+=x;point.y+=y;
  };
  // Spacing sliders scale along existing radial directions, preserving the layout's shape.
  if(dx){
    core.forEach((p,i)=>{
      const scale=dx/Math.max(1,before.coreSpacing);
      addMove(p.g.key,p.cx*scale,p.cy*scale);
    });
  }
  if(dOuter||dRing){
    positions.filter(p=>!coreKeys.has(p.g.key)).forEach(p=>{
      const radius=Math.max(1,Math.hypot(p.cx,p.cy));
      const unitX=p.cx/radius,unitY=p.cy/radius;
      const ringFactor=dRing/Math.max(1,before.ringSpacing);
      const radialDelta=dOuter+radius*ringFactor;
      addMove(p.g.key,unitX*radialDelta,unitY*radialDelta);
    });
  }
  // Separation and tag attraction act as small pairwise corrections along each
  // existing line between rankings; their angles do not get randomized.
  if(dSeparation||dPull){
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
      const a=positions[i],b=positions[j];
      const dx=b.cx-a.cx,dy=b.cy-a.cy,dist=Math.max(1,Math.hypot(dx,dy));
      const shared=a.g.items[0].tags.filter(t=>b.g.items[0].tags.some(u=>tagKey(t)===tagKey(u))).length;
      const factor=Math.min(1,shared/2);
      const oldDesired=shared?Math.max(width+54+15,before.separation*(1-(before.tagPull/100)*factor)):before.separation;
      const newDesired=shared?Math.max(width+54+15,after.separation*(1-(after.tagPull/100)*factor)):after.separation;
      let delta=(newDesired-oldDesired)*0.5;
      delta=Math.max(-10,Math.min(10,delta));
      const ux=dx/dist,uy=dy/dist;
      addMove(a.g.key,-ux*delta*.5,-uy*delta*.5);
      addMove(b.g.key, ux*delta*.5, uy*delta*.5);
    }
  }
  positions.forEach(p=>{
    const next=moved.get(p.g.key);
    p.el.style.transition="left 280ms cubic-bezier(.2,.75,.25,1), top 280ms cubic-bezier(.2,.75,.25,1)";
    p.el.style.left=next.x+"px";p.el.style.top=next.y+"px";
    p.g.targetX=next.x;p.g.targetY=next.y;
  });
  // Keep the stored positions aligned with the DOM so subsequent adjustments build on them.
  lastAppliedForces={...after};
  const strings=layer.querySelector(".tag-strings");
  if(strings){
    const began=performance.now();
    const follow=now=>{
      updateTagStringPaths(groups,strings);
      if(now-began<320)requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }
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
$("#cluster-tag").addEventListener("change",e=>{state.clusterTag=e.target.value;render(true);showToast(state.clusterTag?"Rebuilding layout around tag: "+state.clusterTag:"Rebuilding layout using all shared tags.");});
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

const forceControls=[
  ["coreSpacing","force-core-spacing",v=>v+" px"],
  ["outerOffset","force-outer-offset",v=>v+" px"],
  ["ringSpacing","force-ring-spacing",v=>v+" px"],
  ["tagPull","force-tag-pull",v=>v+"%"],
  ["separation","force-separation",v=>v+" px"],
  ["randomness","force-randomness",v=>v+"%"]
];
function syncForceControls(){
  forceControls.forEach(([key,id,format])=>{
    const input=$("#"+id),output=$("#"+id+"-value");
    if(input)input.value=forces[key];
    if(output)output.textContent=format(forces[key]);
  });
}
forceControls.forEach(([key,id,format])=>{
  $("#"+id).addEventListener("input",e=>{
    forces[key]=Number(e.target.value);
    $("#"+id+"-value").textContent=format(forces[key]);
    updateLayoutVisually(key);
  });
});
$("#reset-forces").addEventListener("click",()=>{
  Object.assign(forces,DEFAULT_FORCES);syncForceControls();updateLayoutVisually();showToast("Layout forces reset.");
});
$("#export-forces").addEventListener("click",()=>{
  const payload={format:"rank-the-world-layout-preset",version:1,forces:{...forces}};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");link.href=url;link.download="rank-the-world-layout-preset.json";link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast("Layout preset exported.");
});
$("#import-forces").addEventListener("change",async e=>{
  const file=e.target.files&&e.target.files[0];if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const source=parsed&&parsed.format==="rank-the-world-layout-preset"&&parsed.forces;
    if(!source)throw new Error("Not a Rank the World layout preset.");
    forceControls.forEach(([key,id])=>{
      const input=$("#"+id),value=Number(source[key]);
      if(Number.isFinite(value))forces[key]=Math.max(Number(input.min),Math.min(Number(input.max),value));
    });
    syncForceControls();updateLayoutVisually();showToast("Layout preset imported.");
  }catch(error){showToast("Could not import preset: "+error.message);}
  e.target.value="";
});
$("#toggle-forces").addEventListener("click",()=>{
  const sidebar=$("#force-sidebar"),collapsed=sidebar.classList.toggle("collapsed");
  $("#toggle-forces").textContent=collapsed?"+":"−";
  $("#toggle-forces").setAttribute("aria-label",collapsed?"Expand layout settings":"Collapse layout settings");
});
syncForceControls();

window.addEventListener("resize",applyTransform);
applyTransform();
})();