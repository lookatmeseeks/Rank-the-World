(() => {
"use strict";

const $ = s => document.querySelector(s);
const canvas = $("#world-map");
const ctx = canvas.getContext("2d");
const viewport = $("#canvas-viewport");
const countLabel = $("#ranking-count");
const zoomLabel = $("#zoom-level");
const searchInput = $("#map-search");
const suggestions = $("#search-results");
const sidePanel = $("#landmass-panel");
const toast = $("#toast");
const rankingDialog = $("#ranking-modal");
const rankingForm = $("#create-form");
const landmassForm = $("#landmass-form");

const COLORS = ["#8e83df","#53b6a1","#d79c61","#d77991","#68a5d6","#b780d0","#9ca85c","#d27f58"];
const thumbnailCache = new Map();
const state = {
  rankings: [], landmasses: [], nextRankingId: 1, nextLandmassId: 1,
  zoom: .16, panX: 0, panY: 0, selectedLandmassId: null, selectedRankingId: null,
  pointer: null, cameraFrame: null, searchMatches: [], searchIndex: -1, activeContinent: null, activeContinentExitZoom: null
};
const MIN_ZOOM = .055, MAX_ZOOM = 2.4;
const STORAGE_KEY = "rank-the-world-map-v2";

function notify(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}
function key(text) { return String(text || "").trim().toLocaleLowerCase(); }
function escapeText(text) { return String(text ?? ""); }
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function colorFor(id) { return COLORS[hash(id) % COLORS.length]; }
const CONTINENTS = ["Anime","Games","Movies","Manga","Music","Books","Fantasy","Sci-Fi","Comics","Animation","Tabletop RPG","Other"];
function isBroadSubject(value) { return CONTINENTS.some(c => key(c) === key(value)); }
function inferredCountry(tags) {
  const first = (tags || [])[0] || "Unsorted";
  return isBroadSubject(first) ? "Cross-series" : first;
}
function primaryTag(ranking) { return ranking.country || inferredCountry(ranking.tags); }
function inferContinent(ranking) {
  const tags = (ranking.tags || []).map(key);
  const known = CONTINENTS.find(c => tags.includes(key(c)));
  if (known) return known;
  const fallback = { "naruto":"Anime","one piece":"Anime","bleach":"Anime","dragon ball":"Anime","studio ghibli":"Movies","pixar":"Movies","pokémon":"Games","pokemon":"Games","the legend of zelda":"Games","final fantasy":"Games","elder scrolls":"Games","star wars":"Movies","star trek":"Sci-Fi","dune":"Sci-Fi","mass effect":"Games","discworld":"Books","cosmere":"Books","the witcher":"Games","wheel of time":"Books","dungeons & dragons":"Tabletop RPG","pathfinder":"Tabletop RPG","marvel":"Comics","dc":"Comics","rock music":"Music","game soundtracks":"Music","video games":"Games" };
  return fallback[key(ranking.country || ranking.tags?.[0])] || "Other";
}
function migrateRanking(ranking) {
  ranking.tags = Array.isArray(ranking.tags) ? ranking.tags : [];
  const oldMass = state.landmasses.find(m => m.id === ranking.landmassId);
  ranking.continent = ranking.continent || inferContinent(ranking);
  ranking.country = ranking.country || (oldMass?.manual ? oldMass.name : inferredCountry(ranking.tags));
  ranking.city = ranking.city || (ranking.tags.length >= 3 ? ranking.tags[2] : "General");
  ranking.creator = ranking.creator || "Guest";
  return ranking;
}
function cityName(ranking) { return ranking.city || "General"; }
function continentForMass(mass) {
  const member = state.rankings.find(r => r.landmassId === mass.id);
  return member ? (member.continent || inferContinent(member)) : "Other";
}
function continentGroups() {
  const groups = new Map();
  state.landmasses.forEach(m => {
    const name = continentForMass(m);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(m);
  });
  const positions = [[-5400,-2700],[-1800,-2700],[1800,-2700],[5400,-2700],[-5400,0],[-1800,0],[1800,0],[5400,0],[-3600,2700],[0,2700],[3600,2700],[7200,2700]];
  return [...groups].sort(([a],[b]) => {
    const ai=CONTINENTS.findIndex(c=>key(c)===key(a)), bi=CONTINENTS.findIndex(c=>key(c)===key(b));
    return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b);
  }).map(([name,masses],index)=>({
    name,masses,x:positions[index]?.[0]??(index%4-1.5)*3600,
    y:positions[index]?.[1]??(Math.floor(index/4)-1)*2700,
    count:state.rankings.filter(r=>(r.continent||inferContinent(r))===name).length,color:colorFor(name)
  }));
}
function activeCountryLayout(groupName) {
  const masses=state.landmasses.filter(m=>continentForMass(m)===groupName).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if(!masses.length)return new Map();
  // Use each country's full drawn footprint, not just its ranking-content bounds.
  // The landmass outline extends beyond massBounds, so sizing cells from b.w/b.h
  // lets countries overlap and makes the fitted continent appear clipped.
  const measured=masses.map(m=>{
    const b=massBounds(m), footprint=landmassFootprint(m);
    return {m,b,w:Math.max(b.w,footprint.halfW*2),h:Math.max(b.h,footprint.halfH*2)};
  });
  const cols=Math.max(1,Math.ceil(Math.sqrt(masses.length))), rows=Math.ceil(masses.length/cols);
  const colWidths=Array.from({length:cols},(_,col)=>Math.max(520,...measured.filter((_,i)=>i%cols===col).map(v=>v.w)));
  const rowHeights=Array.from({length:rows},(_,row)=>Math.max(400,...measured.filter((_,i)=>Math.floor(i/cols)===row).map(v=>v.h)));
  const colX=[],rowY=[]; let x=0,y=0;
  colWidths.forEach((w,i)=>{colX[i]=x+w/2;x+=w+120;});
  rowHeights.forEach((h,i)=>{rowY[i]=y+h/2;y+=h+120;});
  const totalW=x-120,totalH=y-120;
  return new Map(measured.map((v,i)=>[v.m.id,{x:colX[i%cols]-totalW/2,y:rowY[Math.floor(i/cols)]-totalH/2,w:v.w,h:v.h}]));
}
function displayMass(mass) {
  if(!state.activeContinent||continentForMass(mass)!==state.activeContinent)return mass;
  const pos=activeCountryLayout(state.activeContinent).get(mass.id);
  return pos?{...mass,x:pos.x,y:pos.y}:mass;
}
function continentLayoutBounds(groupName) {
  const positions=[...activeCountryLayout(groupName).values()];
  if(!positions.length)return {minX:0,maxX:0,minY:0,maxY:0,cx:0,cy:0};
  const minX=Math.min(...positions.map(v=>v.x-v.w/2)), maxX=Math.max(...positions.map(v=>v.x+v.w/2));
  const minY=Math.min(...positions.map(v=>v.y-v.h/2)), maxY=Math.max(...positions.map(v=>v.y+v.h/2));
  return {minX,maxX,minY,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
function continentLayoutFitZoom(groupName) {
  const bounds=continentLayoutBounds(groupName);
  if(bounds.maxX===bounds.minX||bounds.maxY===bounds.minY)return .42;
  const rect=viewport.getBoundingClientRect();
  return Math.max(MIN_ZOOM,Math.min(.8,Math.min(rect.width/Math.max(1,bounds.maxX-bounds.minX),rect.height/Math.max(1,bounds.maxY-bounds.minY))*.88));
}
function makeLandmass(name, autoKey, x, y, manual = false) {
  return { id: "land-" + state.nextLandmassId++, name, autoKey, x, y, color: colorFor(autoKey || name), manual, createdAt: state.nextLandmassId };
}
const WORLD_POSITIONS = [
  [-3100,-650], [-2300,850], [-500,-850], [-250,650], [1050,-650],
  [2200,-450], [3150,700], [3700,1150], [1450,1050], [650,1450],
  [-1250,-1250], [-3600,250], [2750,-1250], [500,-1450], [-1800,1450],
  [1850,350], [-700,1750], [3400,-350], [-2850,-1150], [1000,350],
  [2600,1400], [-400,200], [-1500,250], [4200,250], [800,1950],
  [-4000,-550], [2150,-1600], [4000,1500], [-2100,1850], [1600,1850]
];
function worldPositionForIndex(index) {
  if (index < WORLD_POSITIONS.length) {
    const [x, y] = WORLD_POSITIONS[index];
    return { x, y };
  }
  const extra = index - WORLD_POSITIONS.length;
  const angle = extra * 2.399963229728653;
  const radius = 4700 + Math.sqrt(extra + 1) * 560;
  return {
    x: Math.cos(angle) * radius + Math.sin(extra * 1.7) * 170,
    y: Math.sin(angle) * radius * .48 + Math.cos(extra * 1.3) * 160
  };
}
function nextMapPosition() {
  return worldPositionForIndex(state.landmasses.length);
}
function rankingCount(mass) {
  return state.rankings.reduce((count, ranking) => count + (ranking.landmassId === mass.id ? 1 : 0), 0);
}
function landmassSizeFactor(mass) {
  const counts = state.landmasses.map(rankingCount);
  const min = counts.length ? Math.min(...counts) : 1;
  const max = counts.length ? Math.max(...counts) : 1;
  if (max <= min) return 1;
  const count = rankingCount(mass);
  const normalized = (count - min) / (max - min);
  return .58 + Math.pow(normalized, .78) * .92;
}
function landmassFootprint(mass) {
  const bounds = massBounds(mass);
  const factor = landmassSizeFactor(mass);
  return {
    halfW: Math.max(240 * factor, bounds.w * .66) * 1.23 + 100,
    halfH: Math.max(180 * factor, bounds.h * .72) * 1.23 + 100
  };
}
function overlapsLandmass(a, b) {
  const aa = landmassFootprint(a), bb = landmassFootprint(b);
  return Math.abs(a.x - b.x) < aa.halfW + bb.halfW &&
    Math.abs(a.y - b.y) < aa.halfH + bb.halfH;
}
function positionWithoutOverlap(mass, desired, placed) {
  mass.x = desired.x; mass.y = desired.y;
  if (!placed.some(other => overlapsLandmass(mass, other))) return;
  const footprint = landmassFootprint(mass);
  const step = Math.max(footprint.halfW, footprint.halfH, 520) * 1.12;
  for (let ring = 1; ring <= 120; ring++) {
    const radius = step * ring;
    const samples = Math.max(16, Math.ceil(2 * Math.PI * ring));
    for (let i = 0; i < samples; i++) {
      const angle = i * Math.PI * 2 / samples + ring * .37;
      mass.x = desired.x + Math.cos(angle) * radius;
      mass.y = desired.y + Math.sin(angle) * radius * .72;
      if (!placed.some(other => overlapsLandmass(mass, other))) return;
    }
  }
  mass.x = desired.x + placed.length * step;
  mass.y = desired.y;
}
function countryWorldPosition(mass, automatic) {
  const continent = continentForMass(mass);
  const continents = [...new Set(automatic.map(continentForMass))].sort((a,b) => a.localeCompare(b));
  const ci = Math.max(0, continents.indexOf(continent));
  const countries = automatic.filter(m => continentForMass(m) === continent).sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0));
  const index = Math.max(0, countries.indexOf(mass));
  const cols = Math.max(1, Math.ceil(Math.sqrt(countries.length)));
  const rows = Math.max(1, Math.ceil(countries.length / cols));
  const continentRows = Math.max(1, Math.ceil(continents.length / 3));
  return {
    // Countries form a compact cluster inside each continent. The wider gap
    // between continent centres keeps neighbouring clusters out of the way
    // when a continent is opened, while still fitting the world overview.
    x: (ci % 3 - 1) * 2200 + (index % cols - (Math.min(cols, countries.length) - 1) / 2) * 620,
    y: (Math.floor(ci / 3) - (continentRows - 1) / 2) * 1700 + (Math.floor(index / cols) - (rows - 1) / 2) * 620
  };
}
function arrangeAutomaticLandmasses() {
  const ordered = [
    ...state.landmasses.filter(m => m.manual).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    ...state.landmasses.filter(m => !m.manual).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  ];
  const automatic = ordered.filter(m => !m.manual);
  const placed = [];
  ordered.forEach(mass => {
    const desired = mass.manual
      ? { x: mass.x, y: mass.y }
      : countryWorldPosition(mass, automatic);
    positionWithoutOverlap(mass, desired, placed);
    placed.push(mass);
  });
}
function ensureLandmassForRanking(ranking) {
  if (ranking.landmassId && state.landmasses.some(m => m.id === ranking.landmassId) && state.landmasses.find(m => m.id === ranking.landmassId).name === primaryTag(ranking)) return;
  ranking.landmassId = null;
  const tag = primaryTag(ranking), autoKey = key(tag);
  let mass = state.landmasses.find(m => !m.manual && m.autoKey === autoKey);
  if (!mass) {
    const p = nextMapPosition();
    mass = makeLandmass(tag, autoKey, p.x, p.y, false);
    state.landmasses.push(mass);
  }
  ranking.landmassId = mass.id;
}
function rebuildMembership() {
  state.rankings.forEach(migrateRanking);
  state.rankings.forEach(ensureLandmassForRanking);
  const used = new Set(state.rankings.map(r => r.landmassId));
  state.landmasses = state.landmasses.filter(m => used.has(m.id));
  if (!state.landmasses.some(m => m.id === state.selectedLandmassId)) state.selectedLandmassId = null;
}
function rankLocalPosition(ranking, indexInMass, count) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.25)));
  const col = indexInMass % cols, row = Math.floor(indexInMass / cols);
  const width = (cols - 1) * 255, height = Math.max(0, Math.ceil(count / cols) - 1) * 205;
  const jitter = (hash(ranking.id) % 31) - 15;
  return { x: col * 255 - width / 2 + jitter, y: row * 205 - height / 2 + ((hash(ranking.id + "y") % 25) - 12) };
}
function groupsForMass(mass) {
  const ranks = state.rankings.filter(r => r.landmassId === mass.id);
  const groups = new Map();
  ranks.forEach(r => {
    const name = cityName(r);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  });
  const entries = [...groups.entries()];
  if (!entries.length) return [];
  const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const blockW = 850, blockH = 700;
  return entries.flatMap(([name, members], groupIndex) => {
    const col = groupIndex % cols, row = Math.floor(groupIndex / cols);
    const cityX = (col - (Math.min(cols, entries.length) - 1) / 2) * blockW;
    const cityY = (row - (Math.ceil(entries.length / cols) - 1) / 2) * blockH;
    return members.map((ranking, index) => ({
      ranking, city: name, cityX, cityY,
      ...rankLocalPosition(ranking, index, members.length),
      x: cityX + rankLocalPosition(ranking, index, members.length).x,
      y: cityY + rankLocalPosition(ranking, index, members.length).y
    }));
  });
}
function massBounds(mass) {
  const items = groupsForMass(mass);
  if (!items.length) return { x: mass.x - 260, y: mass.y - 200, w: 520, h: 400, items };
  const xs = items.map(i => i.x), ys = items.map(i => i.y);
  const minX = Math.min(...xs) - 150, maxX = Math.max(...xs) + 150;
  const minY = Math.min(...ys) - 120, maxY = Math.max(...ys) + 120;
  return { x: mass.x + minX, y: mass.y + minY, w: maxX - minX, h: maxY - minY, items };
}
function rankWorldPosition(r) {
  const rawMass = state.landmasses.find(m => m.id === r.landmassId);
  if (!rawMass) return { x: 0, y: 0 };
  const mass = displayMass(rawMass);
  const items = groupsForMass(mass);
  const item = items.find(i => i.ranking.id === r.id);
  return item ? { x: mass.x + item.x, y: mass.y + item.y } : { x: mass.x, y: mass.y };
}
function resizeCanvas() {
  const rect = viewport.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  canvas.style.width = rect.width + "px"; canvas.style.height = rect.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
function screenPoint(worldX, worldY) {
  const rect = viewport.getBoundingClientRect();
  return { x: rect.width / 2 + state.panX + worldX * state.zoom, y: rect.height / 2 + state.panY + worldY * state.zoom };
}
function worldPoint(screenX, screenY) {
  const rect = viewport.getBoundingClientRect();
  return { x: (screenX - rect.width / 2 - state.panX) / state.zoom, y: (screenY - rect.height / 2 - state.panY) / state.zoom };
}
function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + rr, y); c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr); c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr); c.closePath();
}
function pathLandmass(mass, bounds, c) {
  const { x, y, w, h } = bounds;
  const cx = x + w / 2, cy = y + h / 2;
  const sizeFactor = landmassSizeFactor(mass);
  const radiusX = Math.max(240 * sizeFactor, w * .66), radiusY = Math.max(180 * sizeFactor, h * .72);
  const points = [];
  const seed = hash(mass.id);
  for (let i = 0; i < 28; i++) {
    const a = i * Math.PI * 2 / 28;
    const wave = 1 + .10 * Math.sin(a * 3 + seed) + .065 * Math.cos(a * 5 + seed * .003) + .035 * Math.sin(a * 7);
    points.push({ x: cx + Math.cos(a) * radiusX * wave, y: cy + Math.sin(a) * radiusY * wave });
  }
  c.beginPath(); c.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    c.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  c.closePath();
}
function drawThumbnail(r, x, y, size, c) {
  if (r.thumbnailUrl) {
    let image = thumbnailCache.get(r.thumbnailUrl);
    if (!image) {
      image = new Image();
      thumbnailCache.set(r.thumbnailUrl, image);
      image.onload = () => draw();
      image.onerror = () => { thumbnailCache.delete(r.thumbnailUrl); };
      image.src = r.thumbnailUrl;
    }
    if (image.complete && image.naturalWidth > 0) {
      c.save(); roundRect(c, x, y, size, size, Math.max(3, size * .16)); c.clip();
      c.drawImage(image, x, y, size, size); c.restore(); return;
    }
  }
  const base = colorFor(primaryTag(r));
  roundRect(c, x, y, size, size, Math.max(3, size * .16));
  c.fillStyle = "#222533"; c.fill();
  c.save(); c.clip();
  c.fillStyle = base; c.globalAlpha = .82;
  c.beginPath(); c.arc(x + size * .35, y + size * .33, size * .28, 0, Math.PI * 2); c.fill();
  c.globalAlpha = .55; c.fillStyle = "#f3e6c7";
  c.beginPath(); c.arc(x + size * .72, y + size * .68, size * .2, 0, Math.PI * 2); c.fill();
  c.globalAlpha = 1; c.fillStyle = "#fff"; c.font = "700 " + Math.max(8, size * .35) + "px system-ui";
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText((r.title || "?").trim().charAt(0).toUpperCase(), x + size / 2, y + size / 2 + 1);
  c.restore();
}
function drawLandmass(mass) {
  const c = ctx, bounds = massBounds(mass), selected = mass.id === state.selectedLandmassId;
  pathLandmass(mass, bounds, c);
  c.fillStyle = mass.color + "17"; c.fill();
  c.lineWidth = selected ? 2.2 / state.zoom : 1.3 / state.zoom;
  c.strokeStyle = selected ? "#c9bcff" : mass.color + "9a"; c.stroke();
  const ranks = bounds.items, cx = mass.x, cy = mass.y;
  if (state.zoom < .25) {
    const unit = 1 / state.zoom;
    c.fillStyle = "#151822"; c.beginPath(); c.ellipse(cx, cy, 34 * unit, 26 * unit, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = mass.color; c.lineWidth = 1.5 / state.zoom; c.stroke();
    const featured = ranks.slice(0, 3), thumbSize = 18 * unit;
    featured.forEach((it, i) => {
      const a = i * Math.PI * 2 / Math.max(1, featured.length) - Math.PI / 2;
      drawThumbnail(it.ranking, cx + Math.cos(a) * 17 * unit - thumbSize / 2, cy + Math.sin(a) * 13 * unit - thumbSize / 2, thumbSize, c);
    });
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#f2f2fa";
    c.font = "700 " + (12 * unit) + "px system-ui"; c.fillText(mass.name, cx, cy + 45 * unit, 170 * unit);
    c.font = (10 * unit) + "px system-ui"; c.fillStyle = "#aeb3c4"; c.fillText(ranks.length + (ranks.length === 1 ? " ranking" : " rankings"), cx, cy + 60 * unit);
    return;
  }
  c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = mass.color; c.font = "800 20px system-ui";
  c.fillText(mass.name, cx, bounds.y - 34);
  c.fillStyle = "#7f879a"; c.font = "11px system-ui";
  c.fillText(ranks.length + (ranks.length === 1 ? " ranking" : " rankings"), cx, bounds.y - 16);
  if (state.zoom < .58) {
    const cities = new Map();
    ranks.forEach(it => {
      const city = cityName(it.ranking);
      if (!cities.has(city)) cities.set(city, []);
      cities.get(city).push(it);
    });
    const entries = [...cities.entries()];
    entries.forEach(([name, items]) => {
      const x = cx + items.reduce((sum, item) => sum + item.x, 0) / items.length;
      const y = cy + items.reduce((sum, item) => sum + item.y, 0) / items.length;
      const w = 148, h = 82;
      roundRect(c, x-w/2, y-h/2, w, h, 10);
      c.fillStyle = "#191c26"; c.fill();
      c.strokeStyle = mass.color + "cc"; c.lineWidth = 1.4 / state.zoom; c.stroke();
      c.fillStyle = "#f0f1f7"; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "700 14px system-ui"; c.fillText(name, x, y - 10, w - 14);
      c.fillStyle = "#a4aabc"; c.font = "11px system-ui";
      c.fillText(items.length + (items.length === 1 ? " list" : " lists"), x, y + 13);
    });
    return;
  }
  ranks.forEach(({ ranking: r, x, y }) => {
    const rx = mass.x + x, ry = mass.y + y;
    if (state.zoom < .58) {
      drawThumbnail(r, rx - 25, ry - 25, 50, c);
      if (state.zoom > .34) {
        c.textAlign = "center"; c.textBaseline = "top"; c.fillStyle = "#e9eaf2";
        const labelUnit = 1 / Math.min(1, state.zoom);
        c.font = "600 " + (12 * labelUnit) + "px system-ui"; c.fillText(r.title, rx, ry + 31 * labelUnit, 180 * labelUnit);
      }
    } else {
      const w = 205, h = 144;
      roundRect(c, rx - w / 2, ry - h / 2, w, h, 11);
      c.fillStyle = "#191c26"; c.fill();
      c.strokeStyle = r.id === state.selectedRankingId ? "#f0d38a" : "#383e50";
      c.lineWidth = (r.id === state.selectedRankingId ? 2 : 1) / state.zoom; c.stroke();
      drawThumbnail(r, rx - w / 2 + 10, ry - h / 2 + 10, 32, c);
      c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = "#f0f1f7";
      c.font = "700 12px system-ui"; c.fillText(r.title, rx - w / 2 + 50, ry - h / 2 + 26, 140);
      c.fillStyle = "#9da4b6"; c.font = "10px system-ui"; c.fillText("by " + (r.creator || "Guest") + " · " + cityName(r), rx - w / 2 + 10, ry - h / 2 + 54, 180);
      const labels = ["S", "A", "B", "C", "D"], colors = ["#e77979", "#e8a45f", "#e4cc70", "#79c69b", "#82b4e8"];
      labels.forEach((label, i) => {
        const yy = ry - h / 2 + 67 + i * 13;
        roundRect(c, rx - w / 2 + 10, yy, 21, 10, 2); c.fillStyle = colors[i]; c.fill();
        c.fillStyle = "#171923"; c.font = "700 7px system-ui"; c.textAlign = "center"; c.fillText(label, rx - w / 2 + 20.5, yy + 5);
        c.fillStyle = "#323746";
        for (let k = 0; k < 3; k++) { roundRect(c, rx - w / 2 + 36 + k * 16, yy, 13, 10, 2); c.fill(); }
      });
    }
  });
}
function drawGrid() {
  const c = ctx, rect = viewport.getBoundingClientRect(), topLeft = worldPoint(0, 0), bottomRight = worldPoint(rect.width, rect.height);
  const spacing = state.zoom < .12 ? 400 : state.zoom < .35 ? 200 : 100;
  c.save(); c.strokeStyle = "#a6afca"; c.globalAlpha = state.zoom < .1 ? .035 : .06; c.lineWidth = 1 / state.zoom;
  const x0 = Math.floor(topLeft.x / spacing) * spacing, y0 = Math.floor(topLeft.y / spacing) * spacing;
  c.beginPath();
  for (let x = x0; x < bottomRight.x; x += spacing) { c.moveTo(x, topLeft.y); c.lineTo(x, bottomRight.y); }
  for (let y = y0; y < bottomRight.y; y += spacing) { c.moveTo(topLeft.x, y); c.lineTo(bottomRight.x, y); }
  c.stroke(); c.restore();
}
function draw() {
  if (!ctx || !canvas.width || !canvas.height) return;
  const rect = viewport.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.save();
  ctx.translate(rect.width / 2 + state.panX, rect.height / 2 + state.panY);
  ctx.scale(state.zoom, state.zoom);
  drawGrid();
  if (state.zoom < .25 && !state.activeContinent) {
    const tl = worldPoint(0, 0), br = worldPoint(rect.width, rect.height);
    continentGroups().forEach(group => {
      const unit = 1 / state.zoom;
      if (group.x < tl.x - 1000 || group.x > br.x + 1000 || group.y < tl.y - 1000 || group.y > br.y + 1000) return;
      const radius = Math.max(48, 27 + Math.sqrt(group.count) * 4) * unit;
      ctx.beginPath(); ctx.ellipse(group.x, group.y, radius, radius * .72, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#151822"; ctx.fill(); ctx.strokeStyle = group.color; ctx.lineWidth = 1.7 / state.zoom; ctx.stroke();
      const samples = state.rankings.filter(r => (r.continent || inferContinent(r)) === group.name).slice(0, 4);
      const thumb = 18 * unit;
      samples.forEach((r,i) => {
        const ang = i * Math.PI * 2 / Math.max(1,samples.length) - Math.PI/2;
        drawThumbnail(r, group.x + Math.cos(ang)*radius*.42-thumb/2, group.y + Math.sin(ang)*radius*.42-thumb/2, thumb, ctx);
      });
      ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="#f2f2fa";
      ctx.font="800 "+(13*unit)+"px system-ui"; ctx.fillText(group.name,group.x,group.y+radius*.86,220*unit);
      ctx.fillStyle="#aeb3c4"; ctx.font=(10*unit)+"px system-ui";
      ctx.fillText(group.masses.length+" countries · "+group.count+" lists",group.x,group.y+radius*1.12,240*unit);
    });
    ctx.restore();
    zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
    countLabel.textContent = state.rankings.length + (state.rankings.length === 1 ? " ranking" : " rankings") + " · " + continentGroups().length + " continents";
    $("#canvas-empty").hidden = state.rankings.length > 0;
    $("#world-map").setAttribute("aria-label", state.rankings.length + " rankings across " + continentGroups().length + " continents");
    return;
  }
  const renderMasses=state.activeContinent?state.landmasses.filter(m=>continentForMass(m)===state.activeContinent).map(displayMass):state.landmasses;
  const visible = renderMasses.map(m => ({ mass: m, bounds: massBounds(m) }))
    .filter(({ bounds }) => {
      const tl = worldPoint(0, 0), br = worldPoint(rect.width, rect.height);
      return bounds.x + bounds.w > tl.x - 250 && bounds.x < br.x + 250 && bounds.y + bounds.h > tl.y - 250 && bounds.y < br.y + 250;
    }).sort((a, b) => a.mass.id.localeCompare(b.mass.id));
  visible.forEach(({ mass }) => drawLandmass(mass));
  ctx.restore();
  zoomLabel.textContent = Math.round(state.zoom * 100) + "%";
  countLabel.textContent = state.rankings.length + (state.rankings.length === 1 ? " ranking" : " rankings") + " · " + state.landmasses.length + " countries";
  $("#canvas-empty").hidden = state.rankings.length > 0;
  $("#world-map").setAttribute("aria-label", state.rankings.length + " rankings across " + state.landmasses.length + " countries");
}
function setCamera(zoom, panX, panY) {
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  state.panX = panX; state.panY = panY; draw();
}
function zoomAt(nextZoom, sx, sy) {
  const rect = viewport.getBoundingClientRect(), z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
  if(state.activeContinent) {
    const fitZoom=continentLayoutFitZoom(state.activeContinent);
    // Keep the complete country layout centred and visible. Only return to the
    // world overview when the requested zoom would be too small to fit it.
    if(z < fitZoom * .995) { fitWorld(); return; }
    const bounds=continentLayoutBounds(state.activeContinent);
    state.zoom=z; state.panX=-bounds.cx*z; state.panY=-bounds.cy*z;
    draw(); return;
  }
  const p = worldPoint(sx, sy);
  if(z < .25) state.activeContinentExitZoom=null;
  state.zoom = z; state.panX = sx - rect.width / 2 - p.x * z; state.panY = sy - rect.height / 2 - p.y * z;
  draw();
}
function animateCamera(stages) {
  if (state.cameraFrame) cancelAnimationFrame(state.cameraFrame);
  const runStage = index => {
    if (index >= stages.length) { state.cameraFrame = null; return; }
    const stage = stages[index], from = { zoom: state.zoom, x: state.panX, y: state.panY }, start = performance.now();
    const tick = now => {
      const raw = Math.min(1, (now - start) / stage.duration), t = raw < .5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      setCamera(from.zoom + (stage.zoom - from.zoom) * t, from.x + (stage.x - from.x) * t, from.y + (stage.y - from.y) * t);
      if (raw < 1) state.cameraFrame = requestAnimationFrame(tick);
      else runStage(index + 1);
    };
    state.cameraFrame = requestAnimationFrame(tick);
  };
  runStage(0);
}
function flyToWorld(x, y, finalZoom = .85) {
  const target = z => ({ x: -x * z, y: -y * z });
  const low = MIN_ZOOM * 1.35, lowTarget = target(low), highTarget = target(finalZoom);
  animateCamera([
    { zoom: low, x: 0, y: 0, duration: 520 },
    { zoom: low, x: lowTarget.x, y: lowTarget.y, duration: 680 },
    { zoom: finalZoom, x: highTarget.x, y: highTarget.y, duration: 620 }
  ]);
}
function findContinentAt(p) {
  const groups = continentGroups();
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i], rx = Math.max(48, 27 + Math.sqrt(g.count) * 4) / state.zoom;
    const ry = rx * .72;
    if (Math.pow((p.x - g.x) / rx, 2) + Math.pow((p.y - g.y) / ry, 2) <= 1) return g;
  }
  return null;
}
function findLandmassAt(p) {
  for (let i = state.landmasses.length - 1; i >= 0; i--) {
    const raw=state.landmasses[i];
    if(state.activeContinent&&continentForMass(raw)!==state.activeContinent)continue;
    const m=displayMass(raw), b=massBounds(m);
    const rx = b.w * .78 + 30, ry = b.h * .8 + 30;
    if (Math.pow((p.x - (b.x + b.w / 2)) / rx, 2) + Math.pow((p.y - (b.y + b.h / 2)) / ry, 2) <= 1) return m;
  }
  return null;
}
function findRankingAt(p) {
  for (const raw of state.landmasses) {
    if(state.activeContinent&&continentForMass(raw)!==state.activeContinent)continue;
    const m=displayMass(raw);
    const items = groupsForMass(m);
    for (const item of items) {
      const r = item.ranking, x = m.x + item.x, y = m.y + item.y;
      const radius = state.zoom >= .58 ? 110 : state.zoom >= .25 ? 45 : 0;
      if (radius && Math.abs(p.x - x) < radius && Math.abs(p.y - y) < radius) return r;
    }
  }
  return null;
}
function selectMass(mass) {
  state.selectedLandmassId = mass ? mass.id : null;
  state.selectedRankingId = null;
  updateLandmassPanel(); draw();
}
function updateLandmassPanel() {
  const mass = state.landmasses.find(m => m.id === state.selectedLandmassId);
  sidePanel.hidden = !mass;
  if (!mass) return;
  $("#landmass-name").value = mass.name;
  $("#landmass-size").textContent = state.rankings.filter(r => r.landmassId === mass.id).length + " rankings";
  const merge = $("#merge-target"); merge.replaceChildren(new Option("Choose landmass…", ""));
  state.landmasses.filter(m => m.id !== mass.id).forEach(m => merge.add(new Option(m.name, m.id)));
  $("#split-landmass").disabled = state.rankings.filter(r => r.landmassId === mass.id).length < 2;
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rankings: state.rankings, landmasses: state.landmasses, nextRankingId: state.nextRankingId, nextLandmassId: state.nextLandmassId })); }
  catch (e) { console.warn("Could not save the local map", e); }
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.rankings) && Array.isArray(saved.landmasses)) {
      state.rankings = saved.rankings; state.landmasses = saved.landmasses; state.rankings.forEach(migrateRanking);
      state.nextRankingId = saved.nextRankingId || state.rankings.length + 1;
      state.nextLandmassId = saved.nextLandmassId || state.landmasses.length + 1;
      rebuildMembership();
      arrangeAutomaticLandmasses();
      return true;
    }
  } catch (e) { console.warn("Could not load local map", e); }
  return false;
}
function changed() { rebuildMembership(); arrangeAutomaticLandmasses(); save(); draw(); updateLandmassPanel(); }
function openRanking(ranking) {
  state.selectedRankingId = ranking.id;
  $("#detail-title").textContent = ranking.title;
  $("#detail-description").textContent = ranking.description || "No description.";
  $("#detail-tags").replaceChildren(...(ranking.tags || []).map(tag => {
    const el = document.createElement("span"); el.className = "tag"; el.textContent = "# " + tag; return el;
  }));
  const mass = state.landmasses.find(m => m.id === ranking.landmassId);
  $("#ranking-landmass-label").textContent = mass ? "Country: " + mass.name : "";
  draw();
  if (rankingDialog.showModal) rankingDialog.showModal();
}
function addRanking(title, description, tags, thumbnailUrl = "", geography = {}) {
  const r = { id: String(state.nextRankingId++), title, description, tags, thumbnailUrl,
    continent: geography.continent || inferContinent({ tags }),
    country: geography.country || inferredCountry(tags),
    city: geography.city || (tags.length >= 3 ? tags[2] : "General"),
    creator: geography.creator || "Guest", landmassId: null };
  state.rankings.push(r); ensureLandmassForRanking(r);
  return r;
}
function openCreate() {
  rankingForm.reset(); delete rankingForm.dataset.editId;
  $("#modal-title").textContent = "Create a ranking";
  if (rankingForm.querySelector('[type="submit"]')) rankingForm.querySelector('[type="submit"]').textContent = "Create ranking";
  $("#ranking-landmass-field").hidden = true;
  $("#create-modal").showModal();
}
function startTestSet() {
  const samples = [
    ["Naruto Characters","Main and supporting characters",["Naruto","Anime","Characters"]],
    ["Naruto Openings","Opening themes across the series",["Naruto","Anime","Music"]],
    ["Naruto Powers","Jutsu, kekkei genkai, and abilities",["Naruto","Anime","Powers"]],
    ["Naruto Villains","Antagonists from across the series",["Naruto","Anime","Characters"]],
    ["One Piece Characters","Pirates, marines, and other characters",["One Piece","Anime","Characters"]],
    ["One Piece Powers","Devil fruits, haki, and techniques",["One Piece","Anime","Powers"]],
    ["One Piece Arcs","Favorite story arcs",["One Piece","Anime","Story"]],
    ["Bleach Characters","Soul Reapers, Hollows, and Quincy",["Bleach","Anime","Characters"]],
    ["Best Anime Openings","Cross-series opening comparison",["Anime","Music","Openings"]],
    ["Studio Ghibli Films","Animated films",["Studio Ghibli","Anime","Films"]],
    ["Pokémon Starters","Starter Pokémon by generation",["Pokémon","Games","Characters"]],
    ["Pokémon Games","Mainline game ranking",["Pokémon","Games"]],
    ["Star Wars Characters","Heroes and villains",["Star Wars","Sci-Fi","Characters"]],
    ["Star Wars Films","Films and series",["Star Wars","Sci-Fi","Films"]],
    ["Fantasy Book Series","Favorite fantasy worlds",["Fantasy Books","Books"]],
    ["Discworld Characters","Characters from the Discworld novels",["Discworld","Fantasy Books","Characters"]],
    ["Cosmere Books","Books across the Cosmere",["Cosmere","Fantasy Books","Books"]],
    ["Video Game Soundtracks","Music from games",["Video Games","Music"]],
    ["RPG Classes","Classes across roleplaying games",["Tabletop RPG","Games","Fantasy"]],
    ["D&D Monsters","Monsters and creatures",["Dungeons & Dragons","Tabletop RPG","Fantasy"]]
  ];
  let added = 0;
  samples.forEach(([title, description, tags], index) => {
    if (state.rankings.some(r => key(r.title) === key(title))) return;
    addRanking(title, description, tags, "", { creator: ["Tobias", "Alex", "Sam"][index % 3] }); added++;
  });
  if (!added) { notify("The starter test set is already on the map."); return; }
  changed(); fitWorld(); notify("Added " + added + " sample rankings across thematic landmasses.");
}
function addLargeTestSet() {
  const franchises = [
    ["Naruto","Anime"],["One Piece","Anime"],["Bleach","Anime"],["Dragon Ball","Anime"],
    ["Pokémon","Games"],["The Legend of Zelda","Games"],["Final Fantasy","Games"],["Elder Scrolls","Games"],
    ["Star Wars","Sci-Fi"],["Star Trek","Sci-Fi"],["Dune","Sci-Fi"],["Mass Effect","Sci-Fi"],
    ["Discworld","Fantasy Books"],["Cosmere","Fantasy Books"],["The Witcher","Fantasy"],["Wheel of Time","Fantasy"],
    ["Dungeons & Dragons","Tabletop RPG"],["Pathfinder","Tabletop RPG"],["Marvel","Comics"],["DC","Comics"],
    ["Studio Ghibli","Animation"],["Pixar","Animation"],["Rock Music","Music"],["Game Soundtracks","Music"]
  ];
  const kinds = ["Characters","Villains","Heroes","Story Arcs","Worlds","Powers","Best Moments"];
  let added = 0;
  for (let i = 0; i < 120; i++) {
    const [world, broad] = franchises[i % franchises.length];
    const kind = kinds[Math.floor(i / franchises.length) % kinds.length];
    const title = world + " — " + kind + " " + (Math.floor(i / (franchises.length * kinds.length)) ? Math.floor(i / (franchises.length * kinds.length)) + 1 : "");
    if (state.rankings.some(r => key(r.title) === key(title))) continue;
    addRanking(title, "Sample data for zoom, search, and map performance testing.", [world, broad, kind], "", { creator: ["Tobias", "Alex", "Sam", "Morgan"][i % 4] }); added++;
  }
  changed(); fitWorld(); notify(added ? "Added " + added + " test rankings. The map now contains " + state.rankings.length + "." : "The large test set is already on the map.");
}
function fitWorld() {
  state.activeContinent=null;
  state.activeContinentExitZoom=null;
  const groups = continentGroups();
  if (!groups.length) { setCamera(.16, 0, 0); return; }
  // Fit the continent centres, not every country and list in the underlying
  // world coordinates. This keeps the overview readable as data grows.
  const xs = groups.map(g => g.x), ys = groups.map(g => g.y);
  const minX = Math.min(...xs) - 420, maxX = Math.max(...xs) + 420;
  const minY = Math.min(...ys) - 340, maxY = Math.max(...ys) + 340;
  const rect = viewport.getBoundingClientRect();
  const z = Math.max(MIN_ZOOM, Math.min(.24, Math.min(rect.width / Math.max(1, maxX - minX), rect.height / Math.max(1, maxY - minY)) * .9));
  setCamera(z, -(minX + maxX) / 2 * z, -(minY + maxY) / 2 * z);
}
function focusContinent(group) {
  if(!group.masses.length)return;
  if(state.cameraFrame) cancelAnimationFrame(state.cameraFrame);
  state.cameraFrame=null;
  state.activeContinent=group.name;
  const bounds=continentLayoutBounds(group.name), z=continentLayoutFitZoom(group.name);
  state.activeContinentExitZoom=z;
  // Switch to the compact continent layout and fit its entire footprint at once.
  setCamera(z,-bounds.cx*z,-bounds.cy*z);
}
function showSearchResults(query) {
  const q = key(query);
  suggestions.replaceChildren(); state.searchMatches = []; state.searchIndex = -1;
  if (!q) { suggestions.hidden = true; return; }
  const matches = state.rankings.filter(r => [r.title,r.description,r.continent,r.country,r.city,r.creator,...(r.tags || [])].some(v => key(v).includes(q))).slice(0, 8);
  state.searchMatches = matches;
  matches.forEach((r, i) => {
    const mass = state.landmasses.find(m => m.id === r.landmassId);
    const button = document.createElement("button"); button.type = "button"; button.className = "search-result";
    const title = document.createElement("strong"); title.textContent = r.title;
    const sub = document.createElement("span"); sub.textContent = [r.continent || "Other", r.country || (mass && mass.name), r.city || "General", "by " + (r.creator || "Guest")].filter(Boolean).join(" › ");
    button.append(title, sub); button.addEventListener("click", () => chooseSearchResult(r)); suggestions.append(button);
  });
  suggestions.hidden = matches.length === 0;
}
function chooseSearchResult(r) {
  suggestions.hidden = true; searchInput.value = r.title;
  state.activeContinent=r.continent||inferContinent(r);
  state.activeContinentExitZoom=Math.max(MIN_ZOOM*1.15,continentLayoutFitZoom(state.activeContinent)*.62);
  const p = rankWorldPosition(r), sameLandmass = state.selectedLandmassId === r.landmassId;
  state.selectedLandmassId = r.landmassId; state.selectedRankingId = r.id;
  updateLandmassPanel();
  if (sameLandmass && state.zoom >= .25) {
    const zoom = .92;
    animateCamera([{ zoom, x: -p.x * zoom, y: -p.y * zoom, duration: 680 }]);
  } else {
    flyToWorld(p.x, p.y, .92);
  }
  draw();
}
function chooseLandmassSearch(m) {
  suggestions.hidden=true; searchInput.value=m.name; state.activeContinent=continentForMass(m);
  state.activeContinentExitZoom=Math.max(MIN_ZOOM*1.15,continentLayoutFitZoom(state.activeContinent)*.62);
  const same=state.selectedLandmassId===m.id; state.selectedLandmassId=m.id; updateLandmassPanel();
  const shown=displayMass(m), zoom=.42;
  animateCamera([{zoom:Math.min(state.zoom,.22),x:state.panX,y:state.panY,duration:240},{zoom,x:-shown.x*zoom,y:-shown.y*zoom,duration:620}]);
}
function resetMap() { state.activeContinent=null; state.activeContinentExitZoom=null; setCamera(.16, 0, 0); state.selectedLandmassId = null; state.selectedRankingId = null; updateLandmassPanel(); }
function canvasPointerDown(e) {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.button === 1) e.preventDefault();
  const rect = viewport.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const p = worldPoint(sx, sy), continent = state.zoom < .25 && !state.activeContinent ? findContinentAt(p) : null, rank = findRankingAt(p), mass = findLandmassAt(p);
  let mode = e.button === 1 ? "pan" : "select-empty";
  if (e.button === 0 && continent) mode = "select-continent";
  else if (e.button === 0 && mass) mode = e.shiftKey || e.altKey ? "move-mass" : "select-mass";
  if (e.button === 0 && rank && state.zoom >= .58) mode = "select-rank";
  state.pointer = { id: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, panX: state.panX, panY: state.panY, mass, rank, continent, mode, massX: mass ? mass.x : 0, massY: mass ? mass.y : 0, moved: false };
  viewport.setPointerCapture(e.pointerId);
}
function canvasPointerMove(e) {
  const p = state.pointer;
  if (!p || p.id !== e.pointerId) {
    const rect = viewport.getBoundingClientRect(), wp = worldPoint(e.clientX - rect.left, e.clientY - rect.top);
    viewport.style.cursor = findRankingAt(wp) || findLandmassAt(wp) ? "pointer" : "grab";
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.abs(e.clientX - p.startX) + Math.abs(e.clientY - p.startY) > 4) p.moved = true;
  if (p.mode === "move-mass" && p.mass && p.moved) {
    p.mass.x = p.massX + dx / state.zoom; p.mass.y = p.massY + dy / state.zoom; draw();
  } else if (p.mode === "pan" && p.moved) {
    state.panX = p.panX + dx; state.panY = p.panY + dy; draw();
  }
}
function canvasPointerUp(e) {
  const p = state.pointer; if (!p || p.id !== e.pointerId) return;
  state.pointer = null;
  if (p.mode === "move-mass" && p.mass && p.moved) {
    p.mass.manual = true;
    arrangeAutomaticLandmasses();
    save(); draw(); updateLandmassPanel(); notify("Country repositioned without overlap."); return;
  }
  if (p.mode === "pan" || p.moved) return;
  if (p.mode === "select-rank" && p.rank) { openRanking(p.rank); return; }
  if (p.mode === "select-continent" && p.continent) { state.selectedLandmassId = null; state.selectedRankingId = null; updateLandmassPanel(); focusContinent(p.continent); return; }
  if (p.mode === "select-mass" && p.mass) {
    selectMass(p.mass);
    if (state.zoom < .25) flyToWorld(p.mass.x, p.mass.y, .42);
  } else if (p.mode === "select-empty") { selectMass(null); }
}
viewport.addEventListener("pointerdown", canvasPointerDown);
viewport.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
viewport.addEventListener("pointermove", canvasPointerMove);
viewport.addEventListener("pointerup", canvasPointerUp);
viewport.addEventListener("pointercancel", () => { state.pointer = null; });
viewport.addEventListener("wheel", e => {
  e.preventDefault(); const rect = viewport.getBoundingClientRect();
  zoomAt(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });
$("#zoom-in").addEventListener("click", () => zoomAt(state.zoom * 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2));
$("#zoom-out").addEventListener("click", () => zoomAt(state.zoom / 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2));
$("#reset-view").addEventListener("click", fitWorld);
$("#create-ranking").addEventListener("click", openCreate);
$("#empty-create").addEventListener("click", openCreate);
$("#add-test-lists").addEventListener("click", startTestSet);
$("#add-100-test-lists").addEventListener("click", addLargeTestSet);
$("#close-modal").addEventListener("click", () => $("#create-modal").close());
$("#cancel-modal").addEventListener("click", () => $("#create-modal").close());
rankingForm.addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#ranking-title").value.trim(); if (!title) return;
  const description = $("#ranking-description").value.trim();
  const tags = [...new Set($("#ranking-tags").value.split(",").map(t => t.trim().replace(/^#+/, "").slice(0, 32)).filter(Boolean))].slice(0, 8);
  const geography = { continent: $("#ranking-continent").value.trim() || "Other", country: $("#ranking-country").value.trim() || "Unsorted", city: $("#ranking-city").value.trim() || "General", creator: $("#ranking-creator").value.trim() || "Guest" };
  const thumbnailUrl = $("#ranking-thumbnail").value.trim();
  const editId = rankingForm.dataset.editId;
  if (editId) {
    const r = state.rankings.find(x => x.id === editId);
    if (r) {
      const oldMass = state.landmasses.find(m => m.id === r.landmassId);
      const tagsChanged = key(primaryTag(r)) !== key(geography.country);
      r.title = title; r.description = description; r.tags = tags; r.thumbnailUrl = thumbnailUrl;
      Object.assign(r, geography);
      if (tagsChanged && oldMass && !oldMass.manual) r.landmassId = null;
      if (!r.landmassId || !state.landmasses.some(m => m.id === r.landmassId)) ensureLandmassForRanking(r);
    }
    delete rankingForm.dataset.editId;
    changed(); $("#create-modal").close(); notify("Ranking updated. Its landmass assignment was preserved.");
  } else {
    const r = addRanking(title, description, tags, thumbnailUrl, geography);
    changed(); $("#create-modal").close(); const p = rankWorldPosition(r); flyToWorld(p.x, p.y, .92); notify("Ranking added to " + (state.landmasses.find(m => m.id === r.landmassId)?.name || "the map") + ".");
  }
});
$("#close-detail").addEventListener("click", () => rankingDialog.close());
$("#done-detail").addEventListener("click", () => rankingDialog.close());
$("#edit-ranking").addEventListener("click", () => {
  const r = state.rankings.find(x => x.id === state.selectedRankingId); if (!r) return;
  rankingDialog.close(); rankingForm.reset(); rankingForm.dataset.editId = r.id;
  $("#modal-title").textContent = "Edit ranking";
  $("#ranking-title").value = r.title; $("#ranking-description").value = r.description || ""; $("#ranking-tags").value = (r.tags || []).join(", "); $("#ranking-thumbnail").value = r.thumbnailUrl || ""; $("#ranking-continent").value = r.continent || inferContinent(r); $("#ranking-country").value = r.country || primaryTag(r); $("#ranking-city").value = r.city || "General"; $("#ranking-creator").value = r.creator || "Guest";
  $("#ranking-landmass-field").hidden = false;
  const select = $("#ranking-landmass"); select.replaceChildren();
  state.landmasses.forEach(m => select.add(new Option(m.name, m.id)));
  select.value = r.landmassId;
  $("#create-modal").showModal();
});
$("#ranking-landmass").addEventListener("change", e => {
  const r = state.rankings.find(x => x.id === rankingForm.dataset.editId); if (!r) return;
  r.landmassId = e.target.value;
  const mass = state.landmasses.find(m => m.id === r.landmassId);
  if (mass) { r.country = mass.name; $("#ranking-country").value = mass.name; }
  changed();
});
$("#delete-ranking").addEventListener("click", () => {
  const r = state.rankings.find(x => x.id === state.selectedRankingId); if (!r) return;
  if (!confirm('Delete "' + r.title + '"?')) return;
  state.rankings = state.rankings.filter(x => x.id !== r.id); state.selectedRankingId = null;
  rankingDialog.close(); changed(); notify("Ranking deleted.");
});
$("#close-landmass").addEventListener("click", () => selectMass(null));
$("#landmass-form").addEventListener("submit", e => {
  e.preventDefault(); const m = state.landmasses.find(x => x.id === state.selectedLandmassId); if (!m) return;
  const name = $("#landmass-name").value.trim(); if (!name) return;
  m.name = name; m.manual = true;
  state.rankings.filter(r => r.landmassId === m.id).forEach(r => { r.country = name; });
  save(); draw(); updateLandmassPanel(); notify("Country renamed.");
});
$("#merge-landmass").addEventListener("click", () => {
  const source = state.landmasses.find(x => x.id === state.selectedLandmassId), target = state.landmasses.find(x => x.id === $("#merge-target").value);
  if (!source || !target || source.id === target.id) return;
  state.rankings.filter(r => r.landmassId === source.id).forEach(r => { r.landmassId = target.id; r.country = target.name; r.continent = continentForMass(target); });
  target.manual = true;
  state.landmasses = state.landmasses.filter(m => m.id !== source.id);
  state.selectedLandmassId = target.id; changed(); notify("Countries merged into " + target.name + ".");
});
$("#split-landmass").addEventListener("click", () => {
  const source = state.landmasses.find(x => x.id === state.selectedLandmassId); if (!source) return;
  const members = state.rankings.filter(r => r.landmassId === source.id);
  if (members.length < 2) return;
  members.slice(1).forEach((r, i) => {
    const m = makeLandmass(r.title, "manual:" + r.id, source.x + 650 + (i % 3) * 950, source.y + 450 + Math.floor(i / 3) * 850, true);
    state.landmasses.push(m); r.landmassId = m.id; r.country = m.name;
  });
  source.manual = true; changed(); notify("Split into " + members.length + " separate landmasses.");
});
$("#delete-landmass").addEventListener("click", () => {
  const source = state.landmasses.find(x => x.id === state.selectedLandmassId); if (!source) return;
  const members = state.rankings.filter(r => r.landmassId === source.id);
  if (!confirm("Delete landmass \"" + source.name + "\" and its " + members.length + " rankings?")) return;
  state.rankings = state.rankings.filter(r => r.landmassId !== source.id);
  state.landmasses = state.landmasses.filter(m => m.id !== source.id);
  state.selectedLandmassId = null; changed(); notify("Country and its rankings deleted.");
});
searchInput.addEventListener("input", () => showSearchResults(searchInput.value));
searchInput.addEventListener("keydown", e => {
  if (e.key === "Escape") { suggestions.hidden = true; searchInput.blur(); }
  if (e.key === "Enter") {
    e.preventDefault();
    const q = key(searchInput.value);
    const rank = state.rankings.find(r => [r.title,r.creator,r.city,r.country,r.continent].some(v => key(v) === q)) || state.rankings.find(r => [r.title,r.creator,r.city,r.country,r.continent].some(v => key(v).includes(q)));
    const mass = state.landmasses.find(m => key(m.name) === q) || state.landmasses.find(m => key(m.name).includes(q));
    if (rank) chooseSearchResult(rank); else if (mass) chooseLandmassSearch(mass); else if (state.searchMatches[0]) chooseSearchResult(state.searchMatches[0]);
    else notify("No ranking or landmass matches that search.");
  }
});
document.addEventListener("pointerdown", e => {
  if (!e.target.closest(".search-wrap")) suggestions.hidden = true;
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", e => {
  if (e.key === "Escape") suggestions.hidden = true;
  if ((e.key === "+" || e.key === "=") && !e.target.matches("input,textarea")) zoomAt(state.zoom * 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2);
  if (e.key === "-" && !e.target.matches("input,textarea")) zoomAt(state.zoom / 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2);
});

if (!load()) {
  state.rankings = [];
  state.landmasses = [];
}
resizeCanvas();
fitWorld();
draw();
updateLandmassPanel();
})();