'use strict';
/* ============================================================
   AIRSPACE — UI core: state, loop, map + JFK surface renderers, timeline
   ============================================================ */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const HORIZON = 360, SEED = 11;
const RUN_COLORS = ['#8a96a8', '#5aa9ff', '#ff8a3d', '#3ddc97', '#b18cff', '#f5b942', '#ff4d5e', '#2dd4bf', '#e879f9', '#a3e635'];

const S = {
  view: 'net', sim: null, cfg: newCfg(), applied: newCfg(), speed: 10 / 60, playing: true, acc: 0, sel: 'JFK',
  wxAmt: 0.6, layers: { jfk: 1, sectors: 1, wx: 1, cloud: 1, wind: 1, storm: 1, xw: 1, routes: 0, aircraft: 1, rings: 1, labels: 1 },
  runs: [], runSeq: 0, uid: 1, cmp: 'q',
  alerts: [], alertByKey: {}, alertSeq: 1, alertVer: 0, alertSel: null, incIdx: 0, lastIncAt: {},
  tasks: [], taskKeys: {}, taskVer: 0, restored: {}, decisions: [], selTaxi: null,
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f0 = v => Math.round(v), f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const clock = t => { const m = ((480 + Math.floor(t)) % 1440 + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const dur = m => m < 60 ? Math.round(m) + 'm' : Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0') + 'm';
const tag = c => `<span class="tag ${c}" title="${{ PUBLIC: 'Public / reference data', SYNTHETIC: 'Synthetic: generated for this model', ESTIMATED: 'Estimated: derived by the model', SIMULATED: 'Simulated: produced by a scenario' }[c]}">${c}</span>`;
function setHTML(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
const sevOf = (v, a, b, c) => v >= c ? 'crit' : v >= b ? 'warn' : v >= a ? 'watch' : 'ok';
const cloneCfg = c => JSON.parse(JSON.stringify(c, (k, v) => k.startsWith('_') ? undefined : v));

/* ---------- sim lifecycle ---------- */
function newSim(cfg) {
  S.applied = cloneCfg(cfg); S.sim = new Sim(S.applied, { seed: SEED });
  S.alerts = []; S.alertByKey = {}; S.alertVer++; S.incIdx = 0; S.lastIncAt = {}; S.tasks = []; S.taskKeys = {}; S.taskVer++; S.restored = {}; S.decisions = [];
  S.acc = 0; S.playing = true; $('#bPlay').textContent = '❚❚'; updateChip();
}
function seek(t) {
  t = clamp(Math.round(t), 0, HORIZON - 1);
  S.alerts = []; S.alertByKey = {}; S.incIdx = 0; S.lastIncAt = {}; S.tasks = []; S.taskKeys = {}; S.restored = {}; S.alertVer++; S.taskVer++;
  S.sim = new Sim(S.applied, { seed: SEED });
  while (S.sim.t < t) { S.sim.step(); onMinute(); }
  S.acc = 0;
}
function updateChip() {
  const st = S.applied.stack, el = $('#scenChip');
  el.className = 'chip' + (st.length ? ' on' : '');
  el.innerHTML = st.length ? `Scenario: <b>${esc(st.map(s => SCEN[s.sid]?.name || s.sid).join(' + '))}</b>` : 'Baseline · no scenario';
}

/* ---------- main loop ---------- */
let last = performance.now(), lastPanel = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const sim = S.sim;
  if (S.playing && sim.t < HORIZON) {
    S.acc += dt * S.speed; let n = 0;
    while (S.acc >= 1 && sim.t < HORIZON && n++ < 40) { S.acc -= 1; sim.step(); onMinute(); }
    if (S.sim.t >= HORIZON) { seek(0); if (typeof toast === 'function') toast('Run complete. Restarting from the start.'); }
  }
  zoomStep(); draw();
  if (now - lastPanel > 250) { lastPanel = now; refreshPanels(); drawTimeline(); }
  requestAnimationFrame(frame);
}

/* ---------- map camera ---------- */
const CV = $('#cv'), ctx = CV.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 23.2, y: 13, s: 18, ox: 0 };
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  CV.width = W * DPR; CV.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const tl = $('#tlc'); const r = tl.parentElement.getBoundingClientRect(); tl.width = Math.max(10, r.width) * DPR; tl.height = Math.max(10, r.height) * DPR;
}
function freeArea() { // area not covered by side panels
  const l = (S.view === 'net' || S.view === 'sfc') ? (W > 1100 ? 334 : 286) : 0, r = (S.view === 'net' || S.view === 'sfc') ? (W > 1100 ? 368 : 306) : 0;
  return { cx: l + (W - l - r) / 2, cy: 58 + (H - 58 - 96) / 2, w: W - l - r, h: H - 154 };
}
function fitUS() { if (typeof ZM !== 'undefined') ZM.s = null; const a = freeArea(); cam.x = 23.2; cam.y = 13.4; cam.s = Math.min(a.w / 47.5, a.h / 27.5); }
function focusNY() { if (typeof ZM !== 'undefined') ZM.s = null; const a = freeArea(); cam.x = lon2x(-74.6); cam.y = lat2y(40.6); cam.s = Math.min(a.w / 7.5, a.h / 6.5); }
function focusAp(id) { if (typeof ZM !== 'undefined') ZM.s = null; const a = freeArea(); cam.x = AP[id].x; cam.y = AP[id].y; cam.s = Math.max(cam.s, 40); }
const w2s = (x, y) => { const a = freeArea(); return [(x - cam.x) * cam.s + a.cx, (y - cam.y) * cam.s + a.cy]; };
const s2w = (px, py) => { const a = freeArea(); return [(px - a.cx) / cam.s + cam.x, (py - a.cy) / cam.s + cam.y]; };
let dragging = null, moved = 0;
CV.addEventListener('pointerdown', e => { ZM.s = null; dragging = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; moved = 0; CV.setPointerCapture(e.pointerId); CV.classList.add('drag'); });
CV.addEventListener('pointermove', e => { if (!dragging || S.view === 'sfc') return; const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; moved = Math.max(moved, Math.abs(dx) + Math.abs(dy)); cam.x = dragging.cx - dx / cam.s; cam.y = dragging.cy - dy / cam.s; });
CV.addEventListener('pointerup', e => {
  CV.classList.remove('drag'); const was = dragging; dragging = null; if (!was || moved > 5) return;
  if (S.view === 'net') {
    let ph = null, pd = 14; for (const h of LASTHIT) { const d = Math.hypot(h.x - e.clientX, h.y - e.clientY); if (d < pd) { pd = d; ph = h; } }
    if (ph) { S.pick = S.pick === ph.f ? null : ph.f; return; }
    S.pick = null;
    let best = null, bd = 18; for (const a of AIRPORTS) { const [x, y] = w2s(a.x, a.y); const d = Math.hypot(x - e.clientX, y - e.clientY); if (d < bd) { bd = d; best = a.id; } }
    if (best) { S.sel = best; refreshPanels(true); }
  }
});
/* smooth zoom: wheel / double-click / buttons / keys set a target; the loop eases toward it, keeping the point under the cursor fixed */
const ZM = { s: null, px: 0, py: 0, wx: 0, wy: 0 };
function zoomBy(f, px, py) {
  const a = freeArea(); if (px == null) { px = a.cx; py = a.cy; }
  [ZM.wx, ZM.wy] = s2w(px, py); ZM.px = px; ZM.py = py; ZM.s = clamp((ZM.s ?? cam.s) * f, 8, 600);
}
function zoomStep() {
  if (ZM.s == null) return; const a = freeArea(); cam.s += (ZM.s - cam.s) * 0.3;
  if (Math.abs(ZM.s - cam.s) < ZM.s * 0.003) { cam.s = ZM.s; ZM.s = null; }
  cam.x = ZM.wx - (ZM.px - a.cx) / cam.s; cam.y = ZM.wy - (ZM.py - a.cy) / cam.s;
}
CV.addEventListener('wheel', e => { if (S.view === 'sfc') return; e.preventDefault(); zoomBy(clamp(Math.exp(-e.deltaY * 0.0042), 0.45, 2.2), e.clientX, e.clientY); }, { passive: false });
CV.addEventListener('dblclick', e => { if (S.view === 'net') zoomBy(e.shiftKey ? 0.4 : 2.4, e.clientX, e.clientY); });
addEventListener('keydown', e => { if (S.view !== 'net' || e.metaKey || e.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (e.key === '+' || e.key === '=') zoomBy(1.8); else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.8); else if (e.key === '0') { ZM.s = null; fitUS(); } });

/* ---------- aircraft helpers ---------- */
const NYAP = new Set(['JFK', 'LGA', 'EWR']);
const PLANE = new Path2D('M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'); // generic top-down airliner silhouette (Material Icons, Apache 2.0)
function drawPlane(x, y, ang, sz, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI / 2); const k = sz / 24; ctx.scale(k, k); ctx.translate(-12, -12);
  ctx.fillStyle = fill; ctx.fill(PLANE); ctx.lineWidth = 1.3 / k; ctx.strokeStyle = 'rgba(5,8,14,.85)'; ctx.stroke(PLANE); ctx.restore();
}
let MOUSE = null, LASTHIT = [];
CV.addEventListener('pointermove', e => { MOUSE = { x: e.clientX, y: e.clientY }; });
CV.addEventListener('pointerleave', () => { MOUSE = null; });
function acPos(f, tt) {
  if (f.st === 'enroute') { const A = AP[f.from || f.o], B = AP[f.d], p = clamp((tt - f.dep) / f.dur, 0, 1); return [A.x + (B.x - A.x) * p, A.y + (B.y - A.y) * p, Math.atan2(B.y - A.y, B.x - A.x), 0]; }
  if (f.st === 'hold') { const B = AP[f.d]; return [B.x, B.y, 0, 1]; }
  return null;
}
function sectorPressure(sim) {
  const P = {};
  for (const c of CENTERS) P[c.id] = 0;
  for (const a of AIRPORTS) { const A = sim.A[a.id]; P[a.ctr] = Math.max(P[a.ctr], clamp((A.delay60 - 4) / 28, 0, 1), clamp((1 - A.arrM) * 1.1, 0, 1)); }
  for (const k in sim.fx.src) { const fid = k.split('|')[0]; if (CTR[fid]) P[fid] = Math.max(P[fid], sim.fx.src[k].st === 'lost' ? 0.9 : 0.45); }
  return P;
}
const sectorColor = p => p < 0.04 ? 'rgba(90,169,255,0.028)' : `rgba(${f0(245 + 10 * p)},${f0(185 - 108 * p)},${f0(66 + 28 * p)},${(0.07 + 0.25 * p).toFixed(3)})`;

/* ---------- network map ---------- */
const SEC = { cv: document.createElement('canvas'), key: '' }; SEC.cv.width = 118; SEC.cv.height = 52; SEC.x = SEC.cv.getContext('2d');
function drawNet() {
  const sim = S.sim, tt = sim.t + Math.min(0.999, S.acc), fx = sim.fx;
  const L = S.layers, P = sectorPressure(sim);
  // base: US outline
  ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
  ctx.fillStyle = '#090d14'; ctx.fill();
  if (L.sectors) {
    const key = Object.values(P).map(v => v.toFixed(2)).join();
    if (SEC.key !== key) { SEC.key = key; SEC.x.clearRect(0, 0, 118, 52); for (const c of SECTOR_CELLS.cells) { SEC.x.fillStyle = sectorColor(P[c.c]); SEC.x.fillRect(c.gx, 51 - c.gy, 1, 1); } }
    ctx.save(); ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.clip();
    const [x0, y0] = w2s(0, 0), [x1, y1] = w2s(lon2x(-66), lat2y(24)); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(SEC.cv, x0, y0, x1 - x0, y1 - y0); ctx.restore();
    ctx.strokeStyle = `rgba(138,150,168,${cam.s > 36 ? 0.07 : 0.16})`; ctx.lineWidth = 0.7; ctx.beginPath();
    for (const e of SECTOR_CELLS.edges) { const [ax, ay] = w2s(e[0], e[1]), [bx, by] = w2s(e[2], e[3]); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.stroke();
  }
  if (L.wx || L.cloud) { ctx.save(); ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.clip(); const [x0, y0] = w2s(0, 0), [x1, y1] = w2s(lon2x(-66), lat2y(24)); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = S.wxAmt; if (L.cloud) ctx.drawImage(wxCloudImage(tt), x0, y0, x1 - x0, y1 - y0); if (L.wx) ctx.drawImage(wxNetImage(tt), x0, y0, x1 - x0, y1 - y0); ctx.restore(); }
  if (L.wind) wxDrawWind(tt);
  if (L.wx) wxDrawFront(tt);
  ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
  ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1.2; ctx.stroke();
  if (L.sectors && cam.s > 14) { ctx.fillStyle = 'rgba(138,150,168,.5)'; ctx.font = '500 10px Geist Mono,monospace'; ctx.textAlign = 'center'; for (const c of CENTERS) { const [x, y] = w2s(c.x, c.y); ctx.fillText(c.id, x, y); } }
  // weather disks
  for (const id in fx.wx) { const w = fx.wx[id], a = AP[id], [x, y] = w2s(a.x, a.y), r = (0.5 + 1.1 * w.sev) * cam.s; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(177,140,255,${0.32 * w.f})`); g.addColorStop(1, 'rgba(177,140,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  // routes (aggregated by pair)
  const flows = {}, air = [];
  for (const f of sim.tails) if (f.st === 'enroute') { air.push(f); const k = (f.from || f.o) + '|' + f.d, o = flows[k] || (flows[k] = { n: 0, dl: 0, a: f.from || f.o, b: f.d }); o.n++; o.dl += Math.max(0, f.dep - f.sched); }
  const HIT = []; // aircraft screen positions, for hover
  if (L.routes) {
    ctx.lineCap = 'round';
    for (const k in flows) { const o = flows[k], A = AP[o.a], B = AP[o.b], d = o.dl / o.n, jfk = o.a === 'JFK' || o.b === 'JFK'; if (L.jfk && !(NYAP.has(o.a) || NYAP.has(o.b))) continue; const [x1, y1] = w2s(A.x, A.y), [x2, y2] = w2s(B.x, B.y); ctx.strokeStyle = d > 30 ? `rgba(255,77,94,${0.25 + 0.05 * o.n})` : d > 12 ? `rgba(245,185,66,${0.2 + 0.05 * o.n})` : jfk ? `rgba(90,169,255,${0.1 + 0.05 * o.n})` : `rgba(138,150,168,${0.04 + 0.03 * o.n})`; ctx.lineWidth = Math.min(3, 0.5 + 0.35 * o.n); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  }
  // ripple arcs & rings
  if (L.rings) {
    const rp = sim.ripple(), edges = {};
    for (const e of sim.A.JFK.rip) { edges[e.d] = (edges[e.d] || 0) + e.v; }
    for (const d in edges) { const A = AP.JFK, B = AP[d], [x1, y1] = w2s(A.x, A.y), [x2, y2] = w2s(B.x, B.y), mx = (x1 + x2) / 2 - (y2 - y1) * 0.12, my = (y1 + y2) / 2 + (x2 - x1) * 0.12; const k = clamp(edges[d] / 120, 0.1, 1); ctx.strokeStyle = `rgba(255,138,61,${0.25 + 0.5 * k})`; ctx.lineWidth = 1 + 2.5 * k; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -tt * 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke(); ctx.setLineDash([]); }
    for (const id in rp) { const a = AP[id], [x, y] = w2s(a.x, a.y), k = clamp(rp[id].sum / 250, 0.12, 1), ph = (((tt * 0.12 + a.lon) % 1) + 1) % 1; ctx.strokeStyle = `rgba(255,138,61,${0.55 * (1 - ph)})`; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, (8 + 26 * k) * (0.5 + ph), 0, 7); ctx.stroke(); ctx.fillStyle = `rgba(255,138,61,${0.12 + 0.25 * k})`; ctx.beginPath(); ctx.arc(x, y, 6 + 16 * k, 0, 7); ctx.fill(); }
  }
  // facility outage rings
  for (const a of AIRPORTS) {
    let worst = 0; for (const f of [a.id + '_TWR', a.tracon, 'JFK_GND'].filter(Boolean)) { if (f === 'JFK_GND' && a.id !== 'JFK') continue; for (const s of SRCS) { const r = fx.src[f + '|' + s]; if (r) worst = Math.max(worst, r.st === 'lost' ? 2 : 1); } }
    if (worst) { const [x, y] = w2s(a.x, a.y); ctx.strokeStyle = worst === 2 ? 'rgba(255,77,94,.9)' : 'rgba(245,185,66,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 14, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
  // aircraft
  if (L.aircraft) {
    const rr = clamp(cam.s / 14, 1, 1.7);
    for (const f of air) {
      const p = acPos(f, tt); if (!p) continue; const [x, y] = w2s(p[0], p[1]); if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      const late = f.dep - f.sched > 20, jfk = f.d === 'JFK' || (f.from || f.o) === 'JFK';
      if (L.jfk && !(NYAP.has(f.d) || NYAP.has(f.from || f.o))) continue;
      drawPlane(x, y, p[2], 11 * rr, f.div ? '#b18cff' : late ? '#f5b942' : '#e6eefb'); HIT.push({ f, x, y, p });
      if (tt - f.flag < 12 && f.flag) { ctx.strokeStyle = '#ff4d5e'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    }
    // holding aircraft orbit their destination (plane icons following the circle)
    for (const id of sim.ids) { const hs = sim.A[id].h; hs.forEach((f, i) => { if (L.jfk && !NYAP.has(id) && !NYAP.has(f.from || f.o)) return; const a = AP[id], [cx, cy] = w2s(a.x, a.y), ang = tt * 0.25 + i * 0.9, r = 16 + (i % 3) * 4; drawPlane(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, ang + Math.PI / 2, 8, tt - f.hold0 > 20 ? '#ff4d5e' : '#f5b942'); }); }
  }
  if (L.storm) wxDrawCells(tt);
  // airports
  for (const a of AIRPORTS) {
    const A = sim.A[a.id], [x, y] = w2s(a.x, a.y); if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
    const bad = Math.max(1 - A.arrM, clamp(A.delay60 / 40, 0, 1)), col = bad > 0.5 ? '#ff4d5e' : bad > 0.2 ? '#f5b942' : '#3ddc97', r = a.id === 'JFK' ? 7 : NYAP.has(a.id) ? 5.5 : 2.4 + a.cap / 45;
    ctx.fillStyle = col; ctx.globalAlpha = a.id === 'JFK' ? 1 : 0.85; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (L.xw) wxStation(a, x, y, r, tt);
    if (a.id === 'JFK') { ctx.strokeStyle = '#5aa9ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); }
    if (a.id === S.sel) { ctx.strokeStyle = '#eef2f7'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r + 8, 0, 7); ctx.stroke(); }
    if (L.labels && (NYAP.has(a.id) || a.id === S.sel || cam.s > 12 || a.cap >= 70)) { ctx.fillStyle = NYAP.has(a.id) ? '#eef2f7' : 'rgba(205,214,228,.7)'; ctx.font = `${NYAP.has(a.id) ? 600 : 500} ${a.id === 'JFK' ? 12 : NYAP.has(a.id) ? 11.5 : 10}px Geist,sans-serif`; ctx.textAlign = 'left'; ctx.fillText(a.id, x + r + 6, y + 3.5); }
  }
  drawHover(flows, HIT, tt);
}

/* ---------- hover: a flight's route appears only when you point at the flight (or its line) ---------- */
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1, t = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function drawHover(flows, hits, tt) {
  LASTHIT = hits;
  if (S.view !== 'net') return;
  const pk = S.pick ? hits.find(h => h.f === S.pick) : null; if (S.pick && !pk) S.pick = null;
  let hov = null, bd = 14;
  if (MOUSE && !dragging) for (const h of hits) { const d = Math.hypot(h.x - MOUSE.x, h.y - MOUSE.y); if (d < bd) { bd = d; hov = h; } }
  if (!dragging) CV.style.cursor = hov ? 'pointer' : 'grab';
  ctx.save(); ctx.lineCap = 'round';
  const card = (h, lines, ax, ay) => { ctx.font = '500 11.5px Geist,sans-serif'; const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20, ht = lines.length * 16 + 12; let tx = ax + 18, ty = ay + 14; if (tx + w > W - 10) tx = ax - w - 18; if (ty + ht > H - 10) ty = ay - ht - 14;
    ctx.fillStyle = 'rgba(9,13,20,.94)'; ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(tx, ty, w, ht, 9); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left'; lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#fff' : '#a9b6cc'; ctx.font = (i === 0 ? '600 ' : '500 ') + '11.5px Geist,sans-serif'; ctx.fillText(l, tx + 10, ty + 18 + i * 16); }); };
  if (pk) { // route line only for the plane you clicked
    const f = pk.f, a = AP[f.from || f.o], b = AP[f.d], [x1, y1] = w2s(a.x, a.y), [x2, y2] = w2s(b.x, b.y);
    ctx.strokeStyle = 'rgba(235,242,255,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(pk.x, pk.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(235,242,255,.5)'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pk.x, pk.y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(pk.x, pk.y, 13, 0, 7); ctx.stroke();
    card(pk, [`${f.cs}${f.div ? '  DIVERTED' : ''}`, `${a.id} → ${b.id}`, `Departure delay ${f0(Math.max(0, f.dep - f.sched))} min`, `ETA ${clock(f.dep + f.dur)}`], pk.x, pk.y);
  } else if (hov) card(hov, [hov.f.cs, 'Click to show route'], hov.x, hov.y);
  ctx.restore();
}

/* ---------- JFK surface (schematic, not to scale) ---------- */
const RW_GEO = { '4L/22R': { a: [400, 610], b: [560, 160], n: ['4L', '22R'] }, '4R/22L': { a: [560, 570], b: [672, 255], n: ['4R', '22L'] }, '13L/31R': { a: [260, 230], b: [740, 320], n: ['13L', '31R'] }, '13R/31L': { a: [120, 330], b: [880, 470], n: ['13R', '31L'] } };
const TWYS = [
  { id: 'Taxiway B (north loop)', s: 'B', pts: [[470, 300], [560, 262], [650, 272], [712, 300]], wd: 0.35, wa: 0.1 },
  { id: 'Taxiway K (south)', s: 'K', pts: [[300, 425], [500, 447], [700, 468], [830, 490]], wd: 0.5, wa: 0.2 },
  { id: 'Taxiway A (west)', s: 'A', pts: [[372, 570], [440, 390], [490, 255]], wd: 0.3, wa: 0.15 },
  { id: 'Taxiway Z (east)', s: 'Z', pts: [[690, 540], [706, 430], [696, 335]], wd: 0.25, wa: 0.2 },
  { id: 'Runway 22R/4L crossing', s: 'X', pts: [[455, 330], [505, 352], [545, 345]], wd: 0.45, wa: 0.3 },
  { id: 'Terminal 4 ramp', s: 'T4', pts: [[600, 392], [645, 400]], wd: 0.1, wa: 0.45 },
  { id: 'Ramp / gates (central)', s: 'R', pts: [[512, 330], [560, 342], [625, 360]], wd: 0.15, wa: 0.5 },
];
const TERMS = [['T1', 514, 298], ['T2', 548, 294], ['T4', 588, 298], ['T5', 516, 342], ['T7', 556, 348], ['T8', 596, 346]];
function surfaceCong(sim) {
  const A = sim.A.JFK, q = A.q.length, tin = sim.tails.filter(f => f.o === 'JFK' && f.st === 'taxiin').length, out = {};
  for (const t of TWYS) { let c = clamp((q * t.wd + tin * t.wa * 1.6) / 11, 0, 1); if (sim.fx.taxi.has(t.id)) c = Math.max(c, 0.95); out[t.id] = c; }
  return out;
}
const congCol = c => c > 0.75 ? '#ff4d5e' : c > 0.5 ? '#ff8a3d' : c > 0.28 ? '#f5b942' : '#3ddc97';
function drawSurface() {
  const sim = S.sim, J = sim.jfk, A = sim.A.JFK, tt = sim.t, a = freeArea(), sc = Math.min(a.w / 960, a.h / 640) * 0.96;
  ctx.save(); ctx.translate(a.cx - 500 * sc, a.cy - 335 * sc); ctx.scale(sc, sc);
  // land + bay hints
  ctx.fillStyle = '#0a0e15'; ctx.strokeStyle = '#232c3b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(40, 90, 900, 540, 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(90,169,255,.05)'; ctx.beginPath(); ctx.ellipse(220, 560, 190, 55, -0.1, 0, 7); ctx.fill(); ctx.ellipse(800, 160, 130, 40, 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(138,150,168,.55)'; ctx.font = '500 11px Geist Mono,monospace'; ctx.textAlign = 'left'; ctx.fillText('SCHEMATIC — NOT TO SCALE · SYNTHETIC TRAFFIC', 58, 116);
  const cong = surfaceCong(sim);
  // taxiways
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const t of TWYS) {
    const c = cong[t.id]; ctx.strokeStyle = congCol(c); ctx.globalAlpha = 0.18 + 0.35 * c; ctx.lineWidth = 12; ctx.beginPath(); t.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3a475f'; ctx.lineWidth = 3; ctx.beginPath(); t.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    ctx.fillStyle = '#8a96a8'; ctx.font = '500 10px Geist Mono,monospace'; const p = t.pts[0]; ctx.fillText(t.s, p[0] - 14, p[1] - 8);
  }
  // runways
  for (const r in RW_GEO) {
    const g = RW_GEO[r], closed = J.closedTrue.has(r), known = J.closedKnown.has(r);
    const used = [...J.dep, ...J.arr].some(e => END2PHYS[e] === r);
    ctx.lineWidth = 15; ctx.strokeStyle = closed ? '#4a1f27' : '#1b2331'; ctx.beginPath(); ctx.moveTo(...g.a); ctx.lineTo(...g.b); ctx.stroke();
    ctx.lineWidth = 2; ctx.setLineDash([10, 9]); ctx.strokeStyle = closed ? '#ff4d5e' : used ? '#cdd6e4' : '#566177'; ctx.beginPath(); ctx.moveTo(...g.a); ctx.lineTo(...g.b); ctx.stroke(); ctx.setLineDash([]);
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    ctx.font = '600 11px Geist Mono,monospace'; ctx.textAlign = 'center';
    g.n.forEach((n, i) => { const p = i ? g.b : g.a, sg = i ? 1 : -1; const isDep = J.dep.includes(n), isArr = J.arr.includes(n); ctx.fillStyle = isDep ? '#f5b942' : isArr ? '#5aa9ff' : '#6c788d'; ctx.fillText(n, p[0] + ux * sg * 20, p[1] + uy * sg * 20 + 4); });
    if (closed) { const mx = (g.a[0] + g.b[0]) / 2, my = (g.a[1] + g.b[1]) / 2; ctx.fillStyle = '#ff4d5e'; ctx.font = '700 11px Geist Mono,monospace'; ctx.fillText(known ? 'CLOSED' : 'CLOSED (not yet in feed)', mx, my - 14); ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(mx - 9, my - 9); ctx.lineTo(mx + 9, my + 9); ctx.moveTo(mx + 9, my - 9); ctx.lineTo(mx - 9, my + 9); ctx.stroke(); }
  }
  // terminals
  for (const [n, x, y] of TERMS) { ctx.fillStyle = '#161d29'; ctx.strokeStyle = '#2c374b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, 32, 24, 5); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#8a96a8'; ctx.font = '500 9.5px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText(n, x + 16, y + 15); }
  // departure queues behind each active departure threshold
  const q = A.q, depR = J.dep.length ? J.dep : [], per = depR.length ? Math.ceil(q.length / depR.length) : 0;
  depR.forEach((e, ri) => {
    const phys = END2PHYS[e], g = RW_GEO[phys], first = g.n[0] === e, T = first ? g.a : g.b, dir = first ? 1 : -1;
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], L = Math.hypot(dx, dy), ux = dx / L * dir, uy = dy / L * dir, nx = -uy, ny = ux;
    const list = q.filter((_, i) => i % depR.length === ri);
    list.slice(0, 22).forEach((f, i) => { const d = 26 + i * 13; const x = T[0] - ux * d + nx * 24, y = T[1] - uy * d + ny * 24; ctx.fillStyle = tt - f.qEnter > 25 ? '#ff4d5e' : tt - f.qEnter > 10 ? '#f5b942' : '#d7e3f7'; ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 7); ctx.fill(); });
    if (list.length > 22) { ctx.fillStyle = '#f5b942'; ctx.font = '600 10px Geist Mono,monospace'; ctx.textAlign = 'left'; ctx.fillText('+' + (list.length - 22), T[0] - ux * 26 * 12 + nx * 24 + 8, T[1] - uy * 26 * 12 + ny * 24); }
    ctx.fillStyle = 'rgba(245,185,66,.9)'; ctx.font = '600 10px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText(`DEP ${e} · ${list.length}`, T[0] + nx * 44 - ux * 4, T[1] + ny * 44 - uy * 4);
  });
  // arrival streams on final
  const inb = sim.tails.filter(f => f.d === 'JFK' && f.st === 'enroute').sort((x, y) => (x.dep + x.dur) - (y.dep + y.dur));
  J.arr.forEach((e, ri) => {
    const phys = END2PHYS[e], g = RW_GEO[phys], first = g.n[0] === e, T = first ? g.a : g.b, dir = first ? 1 : -1;
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], L = Math.hypot(dx, dy), ux = dx / L * dir, uy = dy / L * dir;
    ctx.strokeStyle = 'rgba(90,169,255,.25)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(T[0], T[1]); ctx.lineTo(T[0] - ux * 200, T[1] - uy * 200); ctx.stroke(); ctx.setLineDash([]);
    inb.filter((_, i) => i % J.arr.length === ri).slice(0, 5).forEach((f, i) => { const eta = f.dep + f.dur - tt; if (eta > 25) return; const d = 20 + clamp(eta, 0, 25) * 7; ctx.fillStyle = '#5aa9ff'; ctx.beginPath(); ctx.arc(T[0] - ux * d, T[1] - uy * d, 3.6, 0, 7); ctx.fill(); });
    ctx.fillStyle = 'rgba(90,169,255,.9)'; ctx.font = '600 10px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText('ARR ' + e, T[0] - ux * 215, T[1] - uy * 215);
  });
  // holding stack
  const hold = A.h; ctx.strokeStyle = 'rgba(245,185,66,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(130, 170, 54, 24, 0, 0, 7); ctx.stroke();
  hold.slice(0, 16).forEach((f, i) => { const ang = tt * 0.3 + i * 0.7; ctx.fillStyle = tt - f.hold0 > 20 ? '#ff4d5e' : '#f5b942'; ctx.beginPath(); ctx.arc(130 + Math.cos(ang) * (54 - (i % 2) * 8), 170 + Math.sin(ang) * (24 - (i % 2) * 5), 3, 0, 7); ctx.fill(); });
  ctx.fillStyle = '#f5b942'; ctx.font = '600 11px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText(`HOLDING ×${hold.length}`, 130, 212);
  // taxi-in aircraft near terminals
  sim.tails.filter(f => f.o === 'JFK' && f.st === 'taxiin').slice(0, 14).forEach((f, i) => { const p = clamp(1 - (f.tin - tt) / 10, 0, 1); ctx.fillStyle = '#9fe8c8'; ctx.beginPath(); ctx.arc(470 + 120 * p + (i % 3) * 6, 380 + 20 * p + (i % 4) * 5, 2.8, 0, 7); ctx.fill(); });
  ctx.restore();
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, W, H);
  if (S.view === 'sfc') drawSurface(); else drawNet();
  if (S.view === 'lab' || S.view === 'deg' || S.view === 'alr') { ctx.fillStyle = 'rgba(5,7,11,.72)'; ctx.fillRect(0, 0, W, H); }
}

/* ---------- timeline ---------- */
const TL = $('#tlc'), tctx = TL.getContext('2d');
function drawTimeline() {
  const w = TL.width / DPR, h = TL.height / DPR; tctx.setTransform(DPR, 0, 0, DPR, 0, 0); tctx.clearRect(0, 0, w, h);
  const sim = S.sim, padB = 14, X = t => t / HORIZON * w, base = S.runs[0];
  tctx.font = '10px Geist Mono,monospace'; tctx.fillStyle = '#5b667a'; tctx.textAlign = 'left';
  for (let t = 0; t <= HORIZON; t += 60) { const x = X(t); tctx.fillStyle = 'rgba(255,255,255,.05)'; tctx.fillRect(x, 0, 1, h - padB); tctx.fillStyle = '#5b667a'; tctx.fillText(clock(t), Math.min(x + 3, w - 30), h - 3); }
  S.applied.stack.forEach((s, i) => { tctx.fillStyle = 'rgba(177,140,255,.16)'; tctx.fillRect(X(s.start), 0, X(s.dur) , h - padB); tctx.fillStyle = 'rgba(177,140,255,.8)'; tctx.fillRect(X(s.start), 0, X(s.dur), 2); tctx.fillStyle = '#c9b2ff'; tctx.fillText((SCEN[s.sid]?.name || s.sid).slice(0, 26), X(s.start) + 4, 12 + i * 11); });
  const b0 = S.applied.stack.length ? Math.min(...S.applied.stack.map(s => s.start)) : 0;
  for (const m of MITS) { const c = S.applied.mit[m.key]; if (c && c.on) { const x = X(b0 + (c.at || 0)); tctx.fillStyle = '#3ddc97'; tctx.fillRect(x, 0, 1.5, h - padB); } }
  const line = (ser, col, wd) => { if (!ser || !ser.length) return; const mx = Math.max(10, ...(base ? base.series.map(s => s.net) : [0]), ...ser.map(s => s.net)); tctx.strokeStyle = col; tctx.lineWidth = wd; tctx.beginPath(); ser.forEach((s, i) => { const x = X(s.t), y = (h - padB - 3) - s.net / mx * (h - padB - 8); i ? tctx.lineTo(x, y) : tctx.moveTo(x, y); }); tctx.stroke(); };
  if (base) line(base.series, 'rgba(138,150,168,.5)', 1);
  line(sim.series, '#5aa9ff', 1.6);
  const px = X(Math.max(0, sim.t)); tctx.fillStyle = '#eef2f7'; tctx.fillRect(px - 0.5, 0, 1.5, h - padB);
  $('#clock').textContent = clock(sim.t) + '  +' + dur(Math.max(0, sim.t));
  setHTML($('#tlLegend'), `<div><i style="background:#5aa9ff" class="sev"></i> network avg delay <b class="mono" style="color:var(--text)">${f1(sim.series.length ? sim.series[sim.series.length - 1].net : 0)}m</b></div><div><i class="sev" style="background:#8a96a8"></i> baseline</div><div><i class="sev" style="background:#b18cff"></i> scenario window</div>`);
}
let scrub = false, scrubT = 0;
TL.addEventListener('pointerdown', e => { scrub = true; TL.setPointerCapture(e.pointerId); const r = TL.getBoundingClientRect(); scrubT = (e.clientX - r.left) / r.width * HORIZON; });
TL.addEventListener('pointermove', e => { if (!scrub) return; const r = TL.getBoundingClientRect(); scrubT = clamp((e.clientX - r.left) / r.width * HORIZON, 0, HORIZON); });
TL.addEventListener('pointerup', () => { if (!scrub) return; scrub = false; seek(scrubT); });
$('#bPlay').onclick = () => { if (S.sim.t >= HORIZON) seek(0); S.playing = !S.playing; $('#bPlay').textContent = S.playing ? '❚❚' : '▶'; };
$('#bRestart').onclick = () => { seek(0); S.playing = true; $('#bPlay').textContent = '❚❚'; };
$('#spd').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.speed = +b.dataset.s / 60; $$('#spd button').forEach(x => x.classList.toggle('on', x === b)); };

/* ---------- navigation ---------- */
function setView(v) {
  S.view = v; $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v)); $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $('#zoomc').style.display = v === 'net' ? 'flex' : 'none'; if (v === 'net' && cam.s < 8.5) fitUS(); CV.style.cursor = v === 'sfc' ? 'default' : 'grab'; refreshPanels(true);
  try { history.replaceState(null, '', '#' + v); } catch (e) { }
}
$('#zoomc').onclick = e => { const b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'fit') { ZM.s = null; fitUS(); } else zoomBy(b.dataset.z === 'in' ? 2 : 0.5); };
$('#nav').onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); };
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['net', 'sfc', 'lab', 'deg', 'alr'].includes(v)) setView(v); });
addEventListener('resize', () => { resize(); });
addEventListener('keydown', e => { if (e.key === 'Escape') S.pick = null; });
