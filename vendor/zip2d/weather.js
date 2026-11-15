'use strict';
/* ============================================================
   AIRSPACE — synthetic weather shown on the Network map, kept quiet:
   a faint haze (rain/snow areas), a dashed cold-front line, rings on airports whose
   flying weather is worse than normal, and a weather line for the selected airport.
   Weather scenarios from the simulation strengthen all of it near the affected airports.
   Synthetic and deterministic: not a real forecast.
   ============================================================ */
const WX = { hf: 4, spd: 2.2 }; // the front crosses the NYC metro ~4 h into the run; speed is stylized (deg/h) so the motion is visible
const CAT_COL = { VFR: '#3ddc97', MVFR: '#5aa9ff', IFR: '#ff4d5e', LIFR: '#e879f9' };
const CAT_TXT = { VFR: 'Good flying weather', MVFR: 'Marginal: lower ceilings or visibility', IFR: 'Poor: instrument conditions', LIFR: 'Very poor: low instrument conditions' };
const wxFrontLon = (h, lat) => -73.9 + (h - WX.hf) * WX.spd + 0.9 * (lat - 41);

const wxSig = x => 1 / (1 + Math.exp(-x));
function wxCells(h, fw) { // thunderstorm cells embedded along the front, plus any Thunderstorm scenario at an airport
  const out = [];
  for (let k = 0; k < 9; k++) { const lat = 27 + k * 2.7, e = Math.min(1, (lat - 24) / 5, (51 - lat) / 4), inten = e * (0.5 + 0.5 * Math.sin(k * 2.7 + h * 0.6 + 1)); if (inten < 0.3) continue;
    out.push({ lon: wxFrontLon(h, lat) + 1.6 * Math.sin(k * 1.9 + h * 0.5) - 0.5, lat: lat + 0.6 * Math.cos(k * 2.2 + h * 0.4), k: inten }); }
  for (const [id, w] of Object.entries(fw)) if (w.type === 'Thunderstorms') { const a = AP[id]; out.push({ lon: a.lon, lat: a.lat, k: Math.min(1, 0.5 + w.sev * w.f) }); }
  return out;
}
function wxBlobs(h, fw) {
  const bl = [];
  for (let la = 25; la <= 50; la += 1.6) { const e = Math.min(1, (la - 24) / 6, (51 - la) / 4); bl.push([wxFrontLon(h, la), la, 1.35, 0.55 * e * (0.65 + 0.35 * Math.sin(la * 1.3 + h * 0.1))]); }
  for (let la = 30; la <= 48; la += 2.4) bl.push([wxFrontLon(h, la) - 15 + 0.6 * (la - 41) - 0.9 * (la - 41), la, 1.7, 0.28 * (0.6 + 0.4 * Math.sin(la * 0.9))]);
  for (const [id, w] of Object.entries(fw)) { const a = AP[id]; bl.push([a.lon, a.lat, 0.6 + 0.7 * w.sev, 0.8 * w.sev * w.f]); }
  for (const c of wxCells(h, fw)) bl.push([c.lon, c.lat, 0.55, 0.55 * c.k]);
  return bl;
}
function wxV(lon, lat, h, bl, ph = 0) {
  let v = 0; for (const b of bl) { const dx = (lon - b[0]) * 0.77, dy = lat - b[1]; v += b[3] * Math.exp(-(dx * dx + dy * dy) / (2 * b[2] * b[2] * 0.5)); }
  return v * (0.7 + 0.5 * (0.5 + 0.5 * Math.sin(lon * 1.9 + h * 0.9 + ph) * Math.sin(lat * 2.3 - h * 0.6 + ph * 0.7))) - 0.12;
}

/* ---------- winds aloft (cruise altitude, kt): jet stream across the northern US, bending around the front ---------- */
function wxAloft(lon, lat, h) {
  const d = lon - wxFrontLon(h, lat), a = wxSig(d / 2.5); // 1 ahead (east) of the front, 0 behind it
  return { dir: 305 - 55 * a + 12 * Math.sin(lon * 0.13 + h * 0.2), spd: 28 + 78 * Math.exp(-(((lat - 41 - 3 * Math.sin(lon * 0.15 + h * 0.1)) / 7) ** 2)) + 14 * Math.exp(-((d / 5) ** 2)) };
}

/* ---------- haze layer (same 0.5-degree grid as the sector layer: 118 x 52, lon -125..-66, lat 50..24) ---------- */
const WXN = { cv: null, d: null, cc: null, cd: null, key: '', at: 0 };
function wxNetImage(t) {
  const fw = S.sim.fx.wx, key = Object.keys(fw).map(k => k + (fw[k].sev * fw[k].f).toFixed(1)).join(), now = performance.now();
  if (WXN.cv && WXN.key === key && now - WXN.at < 90) return WXN.cv; // refresh ~11x/s so everything keeps drifting even at 1x or paused
  const ph = now / 1000 * 0.45, GW = 118, GH = 52;
  if (!WXN.cv) { for (const [c, d] of [['cv', 'd'], ['cc', 'cd']]) { WXN[c] = document.createElement('canvas'); WXN[c].width = GW; WXN[c].height = GH; WXN[d] = WXN[c].getContext('2d').createImageData(GW, GH); } }
  WXN.key = key; WXN.at = now; const d = WXN.d.data, cd = WXN.cd.data, h = t / 60, bl = wxBlobs(h, fw), snow = Object.values(fw).some(w => w.type === 'Snow / ice');
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const lon = -125 + (gx + .5) * .5, lat = 50 - (gy + .5) * .5, v = wxV(lon, lat, h, bl, ph), i = (gy * GW + gx) * 4;
    // rain / snow: standard radar colors
    if (v < 0.02) d[i + 3] = 0; else { const c = snow ? [215, 235, 255] : v < 0.25 ? [70, 200, 110] : v < 0.5 ? [235, 215, 70] : v < 0.75 ? [255, 140, 50] : [240, 60, 70]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.min(120, 22 + v * 130); }
    // cloud cover: a high-cloud shield ahead of the front, low cloud behind it, thick over rain
    const d0 = lon - wxFrontLon(h, lat), e = Math.min(1, (lat - 24) / 6, (51 - lat) / 4), nz = 0.5 + 0.5 * Math.sin(lon * 1.3 + h * 0.5 + ph * 0.6) * Math.sin(lat * 1.7 - h * 0.4);
    let cc = e * (0.55 * Math.exp(-(((d0 - 3.5) / 5.5) ** 2)) + 0.5 * Math.exp(-(((d0 + 4.5) / 6.5) ** 2)) + 0.12) + 1.2 * Math.max(0, v); cc = Math.min(1, cc * (0.7 + 0.5 * nz));
    cd[i] = 214; cd[i + 1] = 221; cd[i + 2] = 232; cd[i + 3] = Math.min(80, cc * cc * 100 + cc * 10);
  }
  WXN.cv.getContext('2d').putImageData(WXN.d, 0, 0); WXN.cc.getContext('2d').putImageData(WXN.cd, 0, 0); return WXN.cv;
}
const wxCloudImage = t => { wxNetImage(t); return WXN.cc; };

/* ---------- per-airport conditions (synthetic) ---------- */
function wxAirport(id, t) {
  const a = AP[id], h = t / 60, fw = S.sim.fx.wx, bl = wxBlobs(h, fw), v = Math.max(0, wxV(a.lon, a.lat, h, bl));
  const hp = WX.hf + (a.lon + 73.9 - 0.9 * (a.lat - 41)) / WX.spd, post = 1 / (1 + Math.exp(-(h - hp) / 0.8)), hod = ((8 + h) % 24 + 24) % 24;
  let temp = 47 + 6 * Math.sin(2 * Math.PI * (hod - 9.5) / 24) - 0.9 * (a.lat - 41) - 9 * post, wind = 7 + 10 * Math.exp(-(((h - hp) / 2.5) ** 2)), dir = 215 + 95 * post;
  const x = Math.min(1, v * 1.7); let vis = Math.max(0.5, 10 - 9 * x), ceil = Math.max(300, 9000 * (1 - Math.min(1, v * 1.5)) + 300), type = null;
  const w = fw[id];
  if (w) { const s = w.sev * w.f; type = w.type;
    if (type === 'Low visibility / fog') { vis = Math.min(vis, 0.1 + 1.6 * (1 - s)); ceil = Math.min(ceil, 100 + 500 * (1 - s)); wind = Math.min(wind, 4); }
    else if (type === 'High crosswind') { wind = Math.max(wind, 16 + 16 * s); dir = 350; }
    else { vis = Math.min(vis, 2.8 - 1.8 * s); ceil = Math.min(ceil, 1500 - 800 * s); if (type === "Nor'easter") { wind = Math.max(wind, 16 + 20 * s); dir = 55; } if (type === 'Thunderstorms') wind = Math.max(wind, 12 + 10 * s); if (type === 'Snow / ice') temp = Math.min(temp, 31); } }
  const cat = (vis < 1 || ceil < 500) ? 'LIFR' : (vis < 3 || ceil < 1000) ? 'IFR' : (vis <= 5 || ceil <= 3000) ? 'MVFR' : 'VFR';
  const kts = wind * 0.869, gust = kts * (type === 'Thunderstorms' ? 1.9 : type === "Nor'easter" || type === 'High crosswind' ? 1.6 : 1.4);
  const xw = Math.min(...[40, 130].map(ax => Math.abs(kts * Math.sin((dir - ax) * Math.PI / 180)))); // best-runway crosswind: JFK's real axes (04/22, 13/31); assumed for other airports
  return { cat, temp, wind, dir, vis, ceil, type, pp: Math.min(100, v * 140), kts, gust, xw, xwg: xw * gust / Math.max(1, kts) };
}
const wxXwCol = x => x >= 22 ? '#ff4d5e' : x >= 15 ? '#f5b942' : 'rgba(215,222,235,.8)';
const WX_HDG = { '4L': 40, '4R': 40, '22L': 220, '22R': 220, '13L': 130, '13R': 130, '31L': 310, '31R': 310 };
function wxWindBlock() { // JFK runway-by-runway wind components, for the Surface view
  const w = wxAirport('JFK', S.sim.t), rows = RWY.map(r => { const [e1, e2] = r.split('/'), c = e => w.kts * Math.cos((w.dir - WX_HDG[e]) * Math.PI / 180), end = c(e1) >= c(e2) ? e1 : e2, hw = c(end), xw = Math.abs(w.kts * Math.sin((w.dir - WX_HDG[end]) * Math.PI / 180));
    return `<div class="row sb" style="font-size:11.5px;gap:6px;white-space:nowrap"><span class="mono">${r}</span><span class="mono muted">${end}: head ${Math.round(hw)} · <b style="color:${wxXwCol(xw)}">cross ${Math.round(xw)}</b> kt</span></div>`; }).join('');
  return `<div class="sec"><h3>Wind &amp; crosswind ${tag('SYNTHETIC')}</h3><div class="sub2" style="margin-bottom:6px">${wxDir(w.dir)} ${Math.round(w.kts)} kt, gusts ${Math.round(w.gust)} kt</div><div class="list" style="gap:5px">${rows}</div>
  <div class="note">Wind may favor changing runway configuration when crosswind on the active runways grows. Advisory only. Nothing here is a clearance.</div></div>`;
}
const wxDir = d => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
function wxLine(id) { // one compact weather row for the selected-airport panel
  const w = wxAirport(id, S.sim.t), kt = Math.round(w.wind * 0.869);
  return `<div style="margin-top:9px;padding-top:8px;border-top:1px solid var(--line)"><div class="row" style="gap:8px;align-items:center"><span class="mono" style="background:${CAT_COL[w.cat]};color:#06101f;font-weight:700;font-size:11px;padding:3px 7px;border-radius:5px">${w.cat}</span><span style="font-size:12px">${CAT_TXT[w.cat]}</span></div>
  <div class="muted mono" style="font-size:11px;margin-top:5px">${Math.round(w.temp)}°F · wind ${wxDir(w.dir)} ${kt} kt (gust ${Math.round(w.gust)}) · <span style="color:${wxXwCol(w.xw)}">crosswind ${Math.round(w.xw)} kt</span> · vis ${w.vis < 1 ? w.vis.toFixed(1) : Math.round(w.vis * 10) / 10} SM · ceiling ${w.ceil > 9000 ? 'unlimited' : Math.round(w.ceil / 100) * 100 + ' ft'}${w.type ? ' · ' + esc(w.type) : ''}</div>
  <div style="margin-top:5px">${tag('SYNTHETIC')} <span class="muted" style="font-size:11px">training weather, not a real forecast</span></div></div>`;
}

/* ---------- map indicators (called from drawNet) ---------- */
function wxDrawFront(tt) { // dashed cold-front line with small triangles showing the direction it moves
  const h = tt / 60, a = Math.min(0.5, 0.18 + 0.4 * S.wxAmt), pts = [];
  for (let la = 25; la <= 49.5; la += 0.5) { const lo = wxFrontLon(h, la); if (lo > -124 && lo < -66.5) pts.push(w2s(lon2x(lo), lat2y(la))); }
  if (pts.length < 4) return;
  ctx.save(); ctx.strokeStyle = `rgba(110,165,255,${a + 0.25})`; ctx.fillStyle = `rgba(110,165,255,${a + 0.35})`; ctx.lineWidth = 1.3; ctx.setLineDash([7, 5]); ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 3; i < pts.length - 3; i += 7) { const [x, y] = pts[i], [x2, y2] = pts[i + 2], tx = x2 - x, ty = y2 - y, L = Math.hypot(tx, ty) || 1; let nx = -ty / L, ny = tx / L; if (nx < 0) { nx = -nx; ny = -ny; }
    ctx.beginPath(); ctx.moveTo(x - tx / L * 4, y - ty / L * 4); ctx.lineTo(x + tx / L * 4, y + ty / L * 4); ctx.lineTo(x + nx * 6, y + ny * 6); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function wxAirportMark(a, x, y, r, tt) { // ring only where flying weather is worse than normal
  const w = wxAirport(a.id, tt); if (w.cat === 'VFR') return;
  ctx.save(); ctx.strokeStyle = CAT_COL[w.cat]; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, 7); ctx.stroke();
  if (cam.s > 12 || a.id === S.sel || a.id === 'JFK') { ctx.fillStyle = CAT_COL[w.cat]; ctx.font = '600 9px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText(w.cat, x, y + r + 16); ctx.textAlign = 'left'; }
  ctx.restore();
}

// Moving streaks show winds aloft: longer and warmer color = faster. Speed labels (kt) appear when zoomed in.
const WXP = { p: [], last: 0 };
function wxSeed() {
  let x0 = 0, y0 = 0, x1 = lon2x(-66), y1 = 26; const [ax, ay] = s2w(0, 0), [bx, by] = s2w(W, H);
  x0 = Math.max(x0, ax); y0 = Math.max(y0, ay); x1 = Math.min(x1, bx); y1 = Math.min(y1, by); if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = lon2x(-66); y1 = 26; }
  return { lon: (x0 + Math.random() * (x1 - x0)) / COSLAT - 125, lat: 50 - (y0 + Math.random() * (y1 - y0)), age: Math.random() * 40, life: 70 + Math.random() * 70, tr: [] };
}
function wxDrawWind(tt) {
  const now = performance.now(), dt = Math.min(0.05, (now - WXP.last) / 1000 || 0.016), k = dt * 60, h = tt / 60, amt = Math.min(1.5, S.wxAmt / 0.6); WXP.last = now;
  if (!WXP.p.length) for (let i = 0; i < 480; i++) WXP.p.push(wxSeed());
  const [ax, ay] = s2w(-40, -40), [bx, by] = s2w(W + 40, H + 40);
  ctx.save(); ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.clip(); ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  for (const q of WXP.p) {
    const w = wxAloft(q.lon, q.lat, h), r = w.dir * Math.PI / 180;
    q.lon += -Math.sin(r) * w.spd * 0.00042 * k / Math.cos(q.lat * Math.PI / 180); q.lat += -Math.cos(r) * w.spd * 0.00042 * k; q.age += k; q.tr.push([q.lon, q.lat]); if (q.tr.length > 9) q.tr.shift();
    const wx = lon2x(q.lon), wy = lat2y(q.lat);
    if (q.age > q.life || q.lon > -65.5 || q.lon < -125.5 || q.lat < 24 || q.lat > 50.5 || wx < ax || wx > bx || wy < ay || wy > by) { Object.assign(q, wxSeed(), { tr: [] }); continue; }
    if (q.tr.length < 3) continue;
    const a = Math.min(1, q.age / 10, (q.life - q.age) / 14) * 0.34 * amt, c = w.spd > 95 ? '255,200,140' : w.spd > 60 ? '250,235,175' : '225,232,245', pts = q.tr.map(([lo, la]) => w2s(lon2x(lo), lat2y(la))), m = pts.length >> 1;
    ctx.strokeStyle = `rgba(${c},${a * 0.45})`; ctx.beginPath(); pts.slice(0, m + 1).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    ctx.strokeStyle = `rgba(${c},${a})`; ctx.beginPath(); pts.slice(m).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
  }
  if (cam.s > 24) { const st = cam.s > 70 ? 1.5 : cam.s > 40 ? 3 : 5; ctx.font = '500 9.5px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(225,232,245,${Math.min(0.55, 0.3 * amt)})`;
    for (let lo = -125; lo <= -66; lo += st) for (let la = 25; la <= 50; la += st) { const [x, y] = w2s(lon2x(lo), lat2y(la)); if (x < 0 || y < 0 || x > W || y > H) continue; ctx.fillText(Math.round(wxAloft(lo, la, h).spd) + ' kt', x, y); } ctx.textAlign = 'left'; }
  ctx.restore();
}
function wxDrawCells(tt) { // severe thunderstorm cells (ring + bolt); weaker cells show only as hot spots in the radar colors
  const cells = wxCells(tt / 60, S.sim.fx.wx), t = performance.now() / 1000;
  for (const c of cells) { if (c.k < 0.6) continue; const [x, y] = w2s(lon2x(c.lon), lat2y(c.lat)); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    ctx.strokeStyle = 'rgba(255,90,110,.65)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 8 + 4 * c.k + 1.8 * Math.sin(t * 3 + c.lon), 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,225,90,.95)'; ctx.beginPath(); ctx.moveTo(x + 1.5, y - 6); ctx.lineTo(x - 3.5, y + 0.8); ctx.lineTo(x - 0.3, y + 0.8); ctx.lineTo(x - 1.8, y + 6); ctx.lineTo(x + 3.5, y - 1.2); ctx.lineTo(x + 0.3, y - 1.2); ctx.closePath(); ctx.fill(); }
}
function wxAirportXw(a, x, y, r, tt) { // wind arrow blowing onto the airport; amber or red when the crosswind is strong
  const w = wxAirport(a.id, tt); if (w.xw < 12 && a.id !== 'JFK' && a.id !== S.sel) return;
  const to = (w.dir + 180) * Math.PI / 180, ux = Math.sin(to), uy = -Math.cos(to), L = 14 + Math.min(14, w.kts * 0.5), x1 = x - ux * (r + 6), y1 = y - uy * (r + 6), x0 = x - ux * (r + 6 + L), y0 = y - uy * (r + 6 + L), col = wxXwCol(w.xw);
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - ux * 6 - uy * 3.2, y1 - uy * 6 + ux * 3.2); ctx.lineTo(x1 - ux * 6 + uy * 3.2, y1 - uy * 6 - ux * 3.2); ctx.closePath(); ctx.fill();
  if (w.xw >= 15 || cam.s > 12 || a.id === S.sel || a.id === 'JFK') { ctx.font = '600 9px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillText('XW ' + Math.round(w.xw), x0 - ux * 8, y0 - uy * 8 + 3); }
  ctx.restore();
}

// Station model, as on a METAR plot: circle filled by sky cover, wind barb pointing to where the wind comes FROM
// (half barb = 5 kt, full = 10, flag = 50), flight-category color, temperature, and a weather symbol (rain / snow / fog / T-storm).
function wxStation(a, x, y, r, tt) {
  const ny = NYAP.has(a.id), w = wxAirport(a.id, tt);
  if (!(ny || a.id === S.sel || w.cat !== 'VFR')) return;
  const col = CAT_COL[w.cat], R = ny ? 7.5 : 5.5, cover = w.ceil < 800 ? 1 : w.ceil < 2500 ? 0.75 : w.ceil < 6000 ? 0.5 : w.ceil < 9000 ? 0.25 : 0;
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = 1.4; ctx.strokeStyle = col; ctx.fillStyle = 'rgba(8,12,18,.88)';
  const rr = r + R + 2; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col; if (cover >= 1) { ctx.beginPath(); ctx.arc(0, 0, rr - 2, 0, 7); ctx.fill(); }
  else if (cover > 0) { ctx.beginPath(); ctx.moveTo(0, 0); const a0 = -Math.PI / 2; ctx.arc(0, 0, rr - 2, a0, a0 + cover * 2 * Math.PI); ctx.closePath(); ctx.fill(); }
  // wind barb
  const k = Math.round(w.kts / 5) * 5, fr = (w.dir - 90) * Math.PI / 180; ctx.rotate(fr); ctx.strokeStyle = '#e8eef9'; ctx.fillStyle = '#e8eef9'; ctx.lineWidth = 1.4;
  if (k < 3) { ctx.beginPath(); ctx.arc(0, 0, rr + 3, 0, 7); ctx.stroke(); }
  else { const L = 22; ctx.beginPath(); ctx.moveTo(rr, 0); ctx.lineTo(rr + L, 0); ctx.stroke(); let n = k, pos = rr + L;
    while (n >= 50) { ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos - 3, -9); ctx.lineTo(pos - 6, 0); ctx.closePath(); ctx.fill(); pos -= 7; n -= 50; }
    while (n >= 10) { ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos + 3, -9); ctx.stroke(); pos -= 4; n -= 10; }
    if (n >= 5) { if (pos === rr + L) pos -= 4; ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos + 1.5, -4.5); ctx.stroke(); } }
  ctx.rotate(-fr);
  // present weather to the left, temperature above-left, like a station plot
  const pp = w.pp, snow = w.temp <= 33 && pp > 8;
  ctx.font = '600 9.5px Geist Mono,monospace'; ctx.textAlign = 'right'; ctx.fillStyle = '#dfe7f5';
  if (ny || cam.s > 14 || a.id === S.sel) ctx.fillText(Math.round(w.temp), -rr - 3, -rr + 1);
  const sx = -rr - 8, sy = 8;
  if (w.type === 'Thunderstorms' || pp > 60 && w.cat !== 'VFR') { ctx.strokeStyle = '#ff5468'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx + 4, sy - 6); ctx.lineTo(sx - 2, sy); ctx.lineTo(sx + 2, sy); ctx.lineTo(sx - 4, sy + 7); ctx.stroke(); }
  else if (w.type === 'Low visibility / fog' || (w.vis < 2 && pp < 8)) { ctx.strokeStyle = '#c9d3e6'; ctx.lineWidth = 1.5; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(sx - 5, sy + i * 3.5); ctx.lineTo(sx + 5, sy + i * 3.5); ctx.stroke(); } }
  else if (snow) { ctx.strokeStyle = '#d7ebff'; ctx.lineWidth = 1.3; ctx.beginPath(); for (let i = 0; i < 3; i++) { const an = i * Math.PI / 3; ctx.moveTo(sx - Math.cos(an) * 5, sy - Math.sin(an) * 5); ctx.lineTo(sx + Math.cos(an) * 5, sy + Math.sin(an) * 5); } ctx.stroke(); }
  else if (pp > 8) { ctx.fillStyle = '#6fe08a'; const n = pp > 40 ? 3 : pp > 22 ? 2 : 1; for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(sx - (n - 1) * 3 + i * 6, sy, 2.2, 0, 7); ctx.fill(); } }
  if (w.xw >= 15) { ctx.font = '600 9px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = wxXwCol(w.xw); ctx.fillText('XW ' + Math.round(w.xw), 0, rr + 14); }
  else if (ny || a.id === S.sel || cam.s > 14) { ctx.font = '600 8.5px Geist Mono,monospace'; ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.fillText(w.cat, 0, rr + 13); }
  ctx.restore();
}
