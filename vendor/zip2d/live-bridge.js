/* AIRSPACE portal bridge. The ZIP app above remains intact in Simulation mode. */
addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'airspace-zip-focus') return;
  const id=String(event.data.id||'');
  if (AP[id]) { S.sel=id; focusAp(id); refreshPanels(true); }
  else if (Number.isFinite(event.data.longitude) && Number.isFinite(event.data.latitude)) { cam.x=lon2x(event.data.longitude); cam.y=lat2y(event.data.latitude); cam.s=Math.max(cam.s,40); }
});
if (new URLSearchParams(location.search).get('mode') === 'live') {
  S.playing = false;
  S.speed = 0;
  S.view = 'net';
  S.layers.jfk = 0;
  S.layers.wx = S.layers.cloud = S.layers.wind = S.layers.storm = S.layers.xw = S.layers.rings = S.layers.routes = 0;
  document.body.classList.add('portal-live');
  $('#scenChip').textContent = 'OPEN SKY · LIVE DATA';
  $('#advisory').textContent = 'EDUCATION & RESEARCH ONLY';
  $('#nav').querySelectorAll('button:not([data-view="net"])').forEach(button => button.remove());
  $('#guide').style.display = 'none';
  $('#tl').style.display = 'none';
  const feed = { aircraft: [], trails: {}, state: 'loading', error: null, snapshotTime: null, stale: false, returnedCount: 0 };
  const seen = new Map();
  const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString() : 'Unavailable';
  const age = t => t ? `${Math.max(0, Math.round((Date.now() - t) / 1000))}s ago` : 'Unavailable';
  const point = a => {
    const key = `${a.latitude}|${a.longitude}|${a.groundSpeedMs}|${a.trackDeg}|${a.positionTime}`;
    let previous = seen.get(a.id);
    if (!previous || previous.key !== key) { previous = { key, start: performance.now(), lat: a.latitude, lon: a.longitude }; seen.set(a.id, previous); }
    if (a.positionKind !== 'estimated' || !Number.isFinite(a.groundSpeedMs) || !Number.isFinite(a.trackDeg)) return [a.longitude, a.latitude];
    const seconds = Math.min(10, (performance.now() - previous.start) / 1000);
    const heading = a.trackDeg * Math.PI / 180, meters = a.groundSpeedMs * seconds;
    return [previous.lon + Math.sin(heading) * meters / (111320 * Math.cos(previous.lat * Math.PI / 180)), previous.lat + Math.cos(heading) * meters / 111320];
  };
  drawNet = function drawLiveNetwork() {
    ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
    ctx.fillStyle = '#090d14'; ctx.fill();
    if (S.layers.sectors) {
      if (SEC.key !== 'live') { SEC.key = 'live'; SEC.x.clearRect(0,0,118,52); SEC.x.fillStyle = 'rgba(90,169,255,.08)'; for (const cell of SECTOR_CELLS.cells) SEC.x.fillRect(cell.gx,51-cell.gy,1,1); }
      ctx.save(); ctx.clip(); const [sx0,sy0]=w2s(0,0), [sx1,sy1]=w2s(lon2x(-66),lat2y(24)); ctx.drawImage(SEC.cv,sx0,sy0,sx1-sx0,sy1-sy0); ctx.restore();
      ctx.strokeStyle = 'rgba(138,150,168,.13)'; ctx.lineWidth = .7; ctx.beginPath();
      for (const edge of SECTOR_CELLS.edges) { const [x0, y0] = w2s(edge[0], edge[1]), [x1, y1] = w2s(edge[2], edge[3]); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } ctx.stroke();
      if (cam.s > 14) { ctx.fillStyle = 'rgba(138,150,168,.5)'; ctx.font = '500 10px Geist Mono,monospace'; ctx.textAlign = 'center'; for (const center of CENTERS) { const [x,y] = w2s(center.x, center.y); ctx.fillText(center.id, x, y); } }
    }
    ctx.beginPath(); US_POLY.forEach(([lo, la], i) => { const [x, y] = w2s(lon2x(lo), lat2y(la)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.strokeStyle = '#2a3446'; ctx.lineWidth = 1.2; ctx.stroke();
    const hits = [];
    if (S.layers.aircraft) for (const a of feed.aircraft) {
      if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) continue;
      const [lon, lat] = point(a), [x, y] = w2s(lon2x(lon), lat2y(lat));
      if (x < -12 || y < -12 || x > W + 12 || y > H + 12) continue;
      const selected = S.pick?.id === a.id;
      if (selected && feed.trails[a.id]?.length > 1) { ctx.strokeStyle = '#dceefa'; ctx.lineWidth = 1.5; ctx.beginPath(); feed.trails[a.id].forEach((p, i) => { const [px,py] = w2s(lon2x(p.longitude), lat2y(p.latitude)); i ? ctx.lineTo(px,py) : ctx.moveTo(px,py); }); ctx.stroke(); }
      drawPlane(x, y, Number.isFinite(a.trackDeg) ? a.trackDeg * Math.PI / 180 - Math.PI / 2 : -Math.PI / 2, 12 * clamp(cam.s / 14, 1, 1.7), selected ? '#fff' : a.positionKind === 'stale' || a.positionKind === 'estimated' ? '#f5b942' : '#e6eefb');
      if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x,y,13,0,7); ctx.stroke(); }
      hits.push({ f: a, x, y });
    }
    LASTHIT = hits;
    for (const a of AIRPORTS) { const [x, y] = w2s(a.x, a.y); if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue; const r = a.id === 'JFK' ? 7 : NYAP.has(a.id) ? 5.5 : 2.4 + a.cap / 45; ctx.fillStyle = '#3ddc97'; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill(); if (a.id === S.sel) { ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.arc(x,y,r+8,0,7); ctx.stroke(); } if (S.layers.labels && (NYAP.has(a.id) || a.id === S.sel || cam.s > 12 || a.cap >= 70)) { ctx.fillStyle = '#eef2f7'; ctx.font = '500 11px Geist,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(a.id,x+r+6,y+3); } }
    const hit = hits.find(h => h.f.id === S.pick?.id);
    if (hit) { ctx.fillStyle = 'rgba(9,13,20,.94)'; ctx.strokeStyle = 'rgba(255,255,255,.22)'; const tx = Math.min(W-195,hit.x+16), ty = Math.min(H-88,hit.y+16); ctx.beginPath(); ctx.roundRect(tx,ty,180,69,9); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '600 12px Geist,sans-serif'; ctx.fillText(hit.f.callsign || hit.f.id.toUpperCase(),tx+10,ty+19); ctx.font = '11px Geist,sans-serif'; ctx.fillStyle = '#a9b6cc'; ctx.fillText(`${hit.f.source} · ${hit.f.positionKind || 'measured'}`,tx+10,ty+38); ctx.fillText(`Altitude ${fmt(hit.f.geoAltitudeM ?? hit.f.baroAltitudeM)} m`,tx+10,ty+55); }
  };
  refreshPanels = function refreshLivePanels() {
    const selected = feed.aircraft.find(a => a.id === S.pick?.id);
    setHTML($('#netL'), `<div class="sec"><h3>Live traffic <span class="sp"></span>${tag('PUBLIC')}</h3><h2>OpenSky Network</h2><div class="sub2">${esc(feed.state.replaceAll('_',' '))} · ${feed.aircraft.length} positioned / ${feed.returnedCount} returned</div><div class="kv" style="margin-top:10px"><div><label>Last update</label><b style="font-size:12px">${feed.snapshotTime ? esc(new Date(feed.snapshotTime).toLocaleTimeString()) : 'Unavailable'}</b></div><div><label>Data age</label><b style="font-size:12px">${age(feed.snapshotTime)}</b></div></div>${feed.error ? `<div class="note" style="color:var(--watch)">${esc(feed.error)}</div>` : ''}<div class="note">Public flight data for education and research. Not for operational use. Coverage can be incomplete.</div></div><div class="sec"><h3>Layers</h3><div class="tog" id="nlLayers">${['sectors:ARTCC sectors','aircraft:Aircraft','labels:Labels'].map(x=>{const [k,l]=x.split(':');return `<button data-l="${k}" class="${S.layers[k]?'on':''}">${l}</button>`}).join('')}</div></div><div class="sec"><h3>View</h3><div class="row"><button class="btn sm" data-v="us">Fit US</button><button class="btn sm" data-v="ny">NY metro</button><button class="btn sm" data-v="sel">Selected</button></div></div><div class="note">Map is a schematic. Sector regions are approximate, not official boundaries.</div>`);
    setHTML($('#netR'), `<div class="sec"><h3>Aircraft details</h3>${selected ? `<h2>${esc(selected.callsign || selected.id.toUpperCase())}</h2><div class="list" style="margin-top:10px"><div class="card">ICAO · ${esc(selected.id.toUpperCase())}</div><div class="card">Position · ${selected.latitude.toFixed(4)}°, ${selected.longitude.toFixed(4)}°</div><div class="card">Altitude · ${fmt(selected.geoAltitudeM ?? selected.baroAltitudeM)} m</div><div class="card">Ground speed · ${fmt(selected.groundSpeedMs)} m/s</div><div class="card">Track · ${fmt(selected.trackDeg)}°</div><div class="card">Position · ${esc(selected.positionKind || 'measured')}</div><div class="card">Source · ${esc(selected.source)}</div></div>` : '<div class="empty">Click an aircraft on the map or in the list to inspect its observed fields.</div>'}</div><div class="sec"><h3>Returned aircraft</h3><div class="list">${feed.aircraft.slice(0,120).map(a=>`<button class="btn sm" data-live-id="${esc(a.id)}" style="text-align:left">${esc(a.callsign || a.id.toUpperCase())} · ${esc(a.id.toUpperCase())}</button>`).join('') || '<div class="empty">No live aircraft available for this area.</div>'}</div>${feed.aircraft.length>120?'<div class="note">Showing first 120 rows; all positioned aircraft remain on the map.</div>':''}</div>`);
  };
  $('#netR').addEventListener('click', e => { const b=e.target.closest('[data-live-id]'); if (!b) return; S.pick=feed.aircraft.find(a=>a.id===b.dataset.liveId)||null; if (S.pick) parent.postMessage({ type:'airspace-zip-selected', id:S.pick.id }, location.origin); refreshPanels(); });
  CV.addEventListener('pointerup', () => { if (S.pick?.id) parent.postMessage({ type:'airspace-zip-selected', id:S.pick.id }, location.origin); });
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    if (event.data?.type !== 'airspace-zip-live') return;
    const data=event.data;
    feed.aircraft=Array.isArray(data.aircraft) ? data.aircraft.filter(a=>a && a.kind==='live' && Number.isFinite(a.latitude) && Number.isFinite(a.longitude)) : [];
    feed.trails=data.trails && typeof data.trails==='object' ? data.trails : {};
    feed.state=typeof data.state==='string'?data.state:'error'; feed.error=typeof data.error==='string'?data.error:null;
    feed.snapshotTime=Number.isFinite(data.snapshotTime)?data.snapshotTime:null; feed.returnedCount=Number.isFinite(data.returnedCount)?data.returnedCount:feed.aircraft.length;
    if (S.pick) S.pick=feed.aircraft.find(a=>a.id===S.pick.id)||null;
    refreshPanels();
  });
  refreshPanels();
}
