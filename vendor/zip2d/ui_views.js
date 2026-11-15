'use strict';
/* ============================================================
   AIRSPACE — UI views: alerts, tasks, panels, What-If Lab
   ============================================================ */
const NYSET = ['JFK_TWR', 'JFK_GND', 'N90', 'ZNY', 'LGA_TWR', 'EWR_TWR'];
const ST_RANK = { ok: 0, degraded: 1, lost: 2 };
const SRC_RECS = {
  VOICE: ['Review backup / contingency communication options per the facility-approved procedure', 'Consider asking an adjacent facility to relay time-critical instructions', 'Consider reducing the acceptance rate until voice is reliable'],
  DATALINK: ['Plan to use voice for clearances; flag datalink-equipped flights', 'Check for uplinks that may not have been delivered'],
  RADAR: ['Cross-check against the remaining surveillance source', 'Consider increased spacing until picture confidence is restored'],
  ADSB: ['Mark ADS-B-only tracks as unverified and cross-check with radar', 'Check position-data age on affected tracks'],
  FLIGHTDATA: ['Consider manual strip handling per facility procedure', 'Request a flight-plan refresh from an adjacent facility'],
  WX: ['Obtain weather from an alternate source (ATIS, pilot reports, adjacent facility)'],
  NETWORK: ['Open an alternate coordination path (phone / landline) with adjacent facilities', 'Assign a liaison for manual releases and handoffs'],
  POWER: ['Confirm backup-power status and remaining runtime with Tech Ops', 'Pre-brief next steps in case further systems degrade'],
};
const SRC_UNC = {
  VOICE: 'Cannot tell whether the failure is the radio, the console or the facility link; aircraft may still hear us.',
  DATALINK: 'Delivery status of recent uplinks is unknown.', RADAR: 'Displayed tracks may be frozen or coasting; accuracy of any remaining picture is reduced.',
  ADSB: 'Position age is unknown; aircraft without ADS-B Out are invisible on this source.', FLIGHTDATA: 'Flight plans and amendments may be missing or stale.',
  WX: 'Weather picture may be outdated; actual conditions could be worse than displayed.', NETWORK: 'Handoffs and releases may not have been received by the neighbouring facility.',
  POWER: 'Runtime on backup is an estimate; downstream systems may fail without warning.',
};
const TASK_T = {
  VOICE: ['Switch to backup / contingency frequencies per approved procedure', 'Assign a coordinator to relay critical instructions via an adjacent facility', 'Notify traffic management of reduced acceptance rate'],
  DATALINK: ['Fall back to voice for clearances; list datalink-equipped flights', 'Confirm which pending uplinks were not delivered'],
  RADAR: ['Switch surveillance display source (ADS-B / adjacent-facility feed)', 'Apply increased spacing until the picture is verified'],
  ADSB: ['Cross-check ADS-B-only tracks against radar; mark unverified tracks'],
  FLIGHTDATA: ['Switch to manual flight-strip handling', 'Request flight-plan refresh from adjacent facility'],
  WX: ['Obtain weather from an alternate source (ATIS / pilot reports)'],
  NETWORK: ['Open phone / alternate coordination path with adjacent facilities', 'Assign a liaison to relay releases and handoffs manually'],
  POWER: ['Confirm backup-power runtime with Tech Ops', 'Pre-brief next steps if further systems degrade'],
};
const OWNERS = ['Unassigned', 'Operations supervisor', 'Traffic management (TMU)', 'Tower lead', 'Ground control', 'TRACON lead', 'Tech Ops', 'Airline liaison'];

/* ---------- alerts ---------- */
function raise(key, o) {
  const t = S.sim.t; let a = S.alertByKey[key];
  if (!a) { a = { id: S.alertSeq++, key, t, first: t, status: 'new', active: true, ...o }; S.alerts.unshift(a); S.alertByKey[key] = a; S.alertVer++; if (S.alerts.length > 120) { const x = S.alerts.pop(); delete S.alertByKey[x.key]; } }
  else { const ch = a.sev !== o.sev; Object.assign(a, o); if (!a.active) { a.active = true; a.t = t; a.status = 'new'; a.resolved = null; S.alertVer++; } else if (ch) S.alertVer++; }
  a.seen = t;
}
function onMinute() {
  const sim = S.sim, t = sim.t, fx = sim.fx, J = sim.A.JFK;
  // congestion
  const q = J.q.length, wait = sim.jfkQueueWait(), eff = Math.round(J.adr * J.depM);
  if (q >= 8 && wait >= 15) raise('jfk-queue', { sev: wait >= 45 ? 'critical' : wait >= 30 ? 'warning' : 'watch', cat: 'Congestion', cls: 'ESTIMATED', title: `JFK departure queue: ${q} aircraft (~${f0(wait)} min wait)`, trigger: `Modeled queue of ${q} aircraft against an effective departure rate of ${eff}/hr (published ${J.adr}/hr).`, sources: ['Surface surveillance (synthetic)', 'Flight plan data'], unc: 'Wait assumes a steady release rate; real waits vary with runway crossings, gate holds and de-icing.', recs: ['Consider departure metering / gate holds to shift queue time off the taxiways', 'Review whether a different runway configuration would raise the departure rate', 'Check whether a surface bottleneck (blocked taxiway) explains the rate'] });
  if (J.h.length >= 6) { const mx = Math.max(...J.h.map(f => t - f.hold0)); raise('jfk-hold', { sev: J.h.length >= 16 || mx > 35 ? 'critical' : J.h.length >= 10 ? 'warning' : 'watch', cat: 'Congestion', cls: 'ESTIMATED', title: `JFK arrivals holding: ${J.h.length} aircraft (longest ${f0(mx)} min)`, trigger: `Arrival demand exceeds the effective arrival rate of ${f0(J.aar * J.arrM)}/hr (published ${J.aar}/hr).`, sources: ['ADS-B (synthetic)', 'Flight plan data'], unc: 'Fuel state is not modeled; actual diversion thresholds depend on each flight.', recs: ['Consider a ground delay program for JFK-bound flights to move delay to the ground', 'Consider advising long-holding flights to divert to the best alternate', 'Review spacing / metering on the arrival streams'] }); }
  // data / infrastructure
  const others = {};
  for (const k in fx.src) {
    const [fac, src] = k.split('|'), s = fx.src[k];
    if (NYSET.includes(fac)) {
      raise('src:' + k + ':' + s.st + (s.restoring ? 'r' : ''), { sev: s.st === 'lost' && ['VOICE', 'RADAR', 'POWER'].includes(src) ? 'critical' : s.st === 'lost' ? 'warning' : 'watch', cat: ['VOICE', 'DATALINK', 'POWER'].includes(src) ? 'Infrastructure' : 'Data feed', cls: 'SIMULATED', title: `${FAC[fac].name}: ${SRC_LABEL[src]} ${s.restoring ? 'restoring (degraded)' : s.st}`, trigger: `Source monitor reports ${SRC_LABEL[src]} ${s.st} since ${clock(s.onset)} (simulated). Modeled capacity effect at this facility: ×${IMPACT[src][s.st].toFixed(2)}.`, sources: [SRC_LABEL[src] + ' monitor', 'Status feed age'], unc: SRC_UNC[src], recs: SRC_RECS[src] });
    } else { const g = src + '|' + s.st; (others[g] = others[g] || []).push(fac); }
  }
  for (const g in others) { const [src, st] = g.split('|'), L = others[g]; raise('agg:' + g, { sev: st === 'lost' ? 'warning' : 'watch', cat: 'Data feed', cls: 'SIMULATED', title: `${L.length} other facilities: ${SRC_LABEL[src]} ${st}`, trigger: `Source monitors report ${SRC_LABEL[src]} ${st} at ${L.length} facilities outside the NY metro (e.g., ${L.slice(0, 4).map(f => FAC[f].name.replace(' Tower', '')).join(', ')}).`, sources: [SRC_LABEL[src] + ' monitors'], unc: SRC_UNC[src] + ' Impact elsewhere in the network is modeled, not confirmed.', recs: ['Expect reduced acceptance rates at affected facilities and plan traffic management accordingly'] }); }
  // weather
  const w = fx.wx.JFK; if (w && w.f > 0.3) raise('wx-jfk', { sev: w.sev * w.f > 0.7 ? 'critical' : w.sev * w.f > 0.45 ? 'warning' : 'watch', cat: 'Weather', cls: 'SIMULATED', title: `${w.type} affecting JFK (severity ${f0(w.sev * 100)}%)`, trigger: `Simulated weather severity ${w.sev.toFixed(2)} at JFK; modeled capacity ×${sim.A.JFK.base.toFixed(2)}.`, sources: ['Weather data (simulated)'], unc: 'Timing and movement of weather are uncertain; capacity effect is an estimate.', recs: ['Review runway configuration for the current wind / visibility', 'Consider a ground delay program if the reduced rate is expected to persist', 'Brief downstream facilities on the expected acceptance rate'] });
  // runways
  for (const r in (fx.rwy.JFK || {})) raise('rwy:' + r, { sev: 'warning', cat: 'Infrastructure', cls: 'SIMULATED', title: `JFK runway ${r} closed`, trigger: `Runway closure active since ${clock(fx.rwy.JFK[r])} (simulated NOTAM). Runway data feed lag: ${sim.jfk.lag} min.`, sources: ['Runway status feed', 'NOTAM data'], unc: sim.jfk.lag ? `Feed is lagging, so some positions may still show ${r} as open.` : 'Reopening time unknown.', recs: ['Confirm all positions show the closure and the active configuration', 'Review the runway configuration with the remaining runways'] });
  // throughput gap
  if (t >= 10) { const base = S.runs[0] && S.runs[0].series[t], exp = base ? base.thr : 0, obs = sim.jfkOps.length; if (exp > 20 && obs < exp * 0.7 && q >= 6) {
    const known = [Object.keys(fx.src).some(k => NYSET.includes(k.split('|')[0])) && 'data / comms degradation', fx.wx.JFK && 'weather', fx.rwy.JFK && 'runway closure'].filter(Boolean);
    raise('thr-gap', { sev: obs < exp * 0.5 ? 'critical' : 'warning', cat: 'Consistency', cls: 'ESTIMATED', title: `Observed JFK throughput ${obs}/hr vs expected ~${exp}/hr (${f0((obs / exp - 1) * 100)}%)`, trigger: `Rolling 60-min runway operations count is well below the expected profile while ${q} aircraft wait to depart.`, sources: ['Runway operations (synthetic)', 'Expected profile (modeled baseline)'], unc: known.length ? `Known contributing factors: ${known.join(', ')}.` : 'No active alert or source flag explains the gap — consider checking the surface (e.g., a blocked taxiway or crossing).', recs: known.length ? ['Compare against the active alerts above to confirm they explain the shortfall'] : ['Open the JFK Surface view and check taxiway congestion', 'Ask ground control / ramp for any blockage not yet reported'] });
  } }
  // ripple
  if (t % 3 === 0) { const rp = sim.ripple(); Object.entries(rp).sort((a, b) => b[1].sum - a[1].sum).slice(0, 3).forEach(([id, r]) => { if (r.sum > 90) raise('rip:' + id, { sev: r.sum > 400 ? 'warning' : 'watch', cat: 'Network ripple', cls: 'ESTIMATED', title: `Delay from JFK propagating to ${id} (hop ${r.hop})`, trigger: `${r.n} departures from ${id} in the last 2 h were late because their aircraft arrived late from JFK-linked legs, and ${r.inb || 0} more late aircraft are inbound (${f0(r.sum)} delay-min total, estimated).`, sources: ['Flight schedules (synthetic)', 'Aircraft rotation model'], unc: 'Rotation links are modeled from synthetic tail assignments; real aircraft swaps would change this.', recs: [`Anticipate reduced departure punctuality at ${id}`, 'Consider swapping aircraft or re-sequencing the affected rotation'] }); }); }
  // consistency findings from the engine
  while (S.incIdx < sim.incons.length) {
    const e = sim.incons[S.incIdx++]; if (e.t < 0) continue;
    if (e.kind === 'offroute' && e.sev === 'info' && t - (S.lastIncAt.offroute ?? -99) < 20) continue; S.lastIncAt[e.kind] = t;
    const T = { closed: 'Instruction conflicts with runway closure', mismatch: 'Instructed vs observed runway differ', conflict: 'Potentially conflicting instructions', offroute: 'Unexpected aircraft behavior', divert: 'Diversion' }[e.kind];
    raise('inc:' + e.kind + ':' + e.cs + ':' + e.t, { sev: e.sev, cat: 'Consistency', cls: 'SIMULATED', title: `${T} — ${e.cs}`, trigger: e.detail, sources: e.srcs.map(s => SRC_LABEL[s] || s), unc: e.unc, recs: e.kind === 'divert' ? ['Confirm alternate acceptance rate and gate / ramp availability'] : ['Verify the instruction and the aircraft\'s actual position by an independent means before acting', 'Record the discrepancy for post-event review'], once: true });
  }
  // resolve
  for (const a of S.alerts) if (a.active && a.seen < t && !a.once) { a.active = false; a.resolved = t; S.alertVer++; } else if (a.once && a.active && t - a.seen > 25) { a.active = false; a.resolved = t; S.alertVer++; }
  if (t % 5 === 0) S.alertVer++;
  evalTasks(sim);
}
const facLabel = L => { const n = L.map(f => FAC[f].name.replace(' Tower', ' TWR').replace('New York ', 'NY ').replace(' (N90)', '')); return n.length > 3 ? n.slice(0, 3).join(', ') + ` +${n.length - 3}` : n.join(', '); };
function evalTasks(sim) {
  const t = sim.t, fx = sim.fx, act = {};
  const mk = (key, text, fac, src, prio) => { const ex = S.taskKeys[key]; if (ex) { ex.fac = fac; return; } const k = { id: S.uid++, key, text, fac, src, prio, owner: 'Unassigned', status: 'Open', t0: t, done: null }; S.tasks.push(k); S.taskKeys[key] = k; S.taskVer++; };
  let other = 0;
  for (const k in fx.src) {
    const [fac, src] = k.split('|'), x = fx.src[k];
    if (!NYSET.includes(fac)) { other++; continue; }
    const g = act[src] || (act[src] = { src, facs: [], st: 'degraded', onset: 1e9, end: 0, restoring: true, inst: x.inst });
    g.facs.push(fac); if (ST_RANK[x.st] > ST_RANK[g.st]) g.st = x.st; g.onset = Math.min(g.onset, x.onset); g.end = Math.max(g.end, x.end); g.restoring = g.restoring && x.restoring;
  }
  S.act = act; S.seenSrc = S.seenSrc || {};
  for (const src in act) { const g = act[src], lbl = facLabel(g.facs); (TASK_T[src] || []).slice(0, g.st === 'lost' ? 9 : 1).forEach((tx, i) => mk(src + '|' + g.st + '|' + i, tx, lbl, src, g.st === 'lost' ? 'High' : 'Medium')); S.seenSrc[src] = g.facs; }
  if (other) mk('others|' + Math.floor(other / 20), `Coordinate with other affected facilities outside the NY metro (${other} source(s) affected): agree acceptance rates and manual handoffs`, null, 'NETWORK', 'High');
  for (const src in S.seenSrc) if (!act[src]) { const facs = S.seenSrc[src]; delete S.seenSrc[src]; const key = src + '|verify|' + t; mk(key, `Verify ${SRC_LABEL[src]} at ${facLabel(facs)} is restored and reliable before resuming normal operations`, facLabel(facs), src, 'High'); S.restored[src + t] = { t, src, facs, key }; }
}

/* ---------- panel skeletons (static; created once) ---------- */
const scenQuick = () => Object.values(SCEN).map(s => `<button data-q="${s.id}">${esc(s.name)}</button>`).join('');
$('#netL').innerHTML = `
  <div id="nlSel"></div>
  <div class="sec"><h3>Layers</h3><div class="tog" id="nlLayers">${['jfk:JFK · LGA · EWR flights only', 'sectors:ARTCC sectors', 'wx:Rain & snow', 'cloud:Clouds', 'wind:Winds aloft', 'storm:Storm cells', 'xw:Airport weather', 'routes:All routes', 'aircraft:Aircraft', 'rings:Ripple', 'labels:Labels'].map(x => { const [k, l] = x.split(':'); return `<button data-l="${k}" class="${S.layers[k] ? 'on' : ''}">${l}</button>`; }).join('')}</div><label class="row" style="margin-top:8px;gap:8px;font-size:11.5px;color:var(--mut)">Weather strength<input id="wxAmt" type="range" min="0" max="1" step="0.05" value="${S.wxAmt}" style="flex:1"></label><div class="wxkey2"><div><i class="hz"></i><span><b>Rain &amp; snow</b>: <b style="color:#46c86e">green</b> light, <b style="color:#ebd746">yellow</b> moderate, <b style="color:#ff8c32">orange</b> and <b style="color:#f03c46">red</b> heavy.</span></div><div><i class="cl"></i><span><b>Clouds</b>: grey-white. Thicker means more cover.</span></div><div><i class="wd"></i><span><b>Winds aloft</b>: moving streaks at cruise altitude. Longer and warmer is faster; speeds in kt appear when zoomed in.</span></div><div><i class="st"></i><span><b>Storm cells</b>: ring with a bolt marks a severe thunderstorm.</span></div><div><i class="xa"></i><span><b>Airport weather</b> (standard station plot): circle fill = cloud cover, ring color = flight category, barb points to where the wind comes from (flag 50 kt, line 10, half 5), number = °F, symbol = rain, snow, fog or T-storm. <b style="color:#ff4d5e">XW</b> = crosswind.</span></div><div><i class="fr"></i><span><b>Blue line with triangles</b>: cold front, moving east.</span></div></div></div>
  <div class="sec"><h3>View</h3><div class="row"><button class="btn sm" data-v="us">Fit US</button><button class="btn sm" data-v="ny">NY metro</button><button class="btn sm" data-v="sel">Selected</button></div><div class="muted" style="font-size:10.5px;margin-top:6px">Zoom: scroll, double-click, + / − buttons or keys.</div></div>
  <div class="sec"><h3>Data classes</h3><div class="list" style="gap:5px;font-size:11.5px;color:var(--mut)">
    <div>${tag('PUBLIC')} airport locations, runway names, facilities</div><div>${tag('SYNTHETIC')} generated flights &amp; rotations</div>
    <div>${tag('ESTIMATED')} queues, ETAs, capacity, ripple</div><div>${tag('SIMULATED')} scenario failures &amp; weather</div></div></div>
  <div class="note">Map is a schematic. Sector regions are nearest-centre approximations, not official ARTCC boundaries.</div>`;
$('#netR').innerHTML = `
  <div class="sec"><h3>Try a scenario <span class="sp"></span>${tag('SIMULATED')}</h3><div class="tog" id="nrQuick">${scenQuick()}</div><div class="note">Loads the scenario with default parameters into the live sim. Build and compare your own in the What-If Lab.</div></div>
  <div class="sec" id="nrRip"></div><div class="sec" id="nrAl"></div>
  <div class="sec"><button class="btn" id="nrOpenAl" style="width:100%">Open alerts &amp; consistency checks →</button></div>`;
$('#sfcL').innerHTML = `<div id="slA"></div><div id="slW"></div><div id="slB"></div><div id="slC"></div>`;
$('#sfcR').innerHTML = `<div id="srA"></div><div id="srB"></div><div class="note">Schematic, not to scale. Queue positions, runway assignments and taxi flows are synthetic or estimated. Nothing here is a clearance or instruction.</div>`;
$('#netL').addEventListener('click', e => {
  const l = e.target.closest('[data-l]'); if (l) { S.layers[l.dataset.l] ^= 1; l.classList.toggle('on', !!S.layers[l.dataset.l]); }
  const v = e.target.closest('[data-v]'); if (v) { v.dataset.v === 'us' ? fitUS() : v.dataset.v === 'ny' ? focusNY() : focusAp(S.sel); }
});
$('#wxAmt').oninput = e => { S.wxAmt = +e.target.value; };
$('#nrQuick').onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; const c = newCfg(); c.stack = [mkInst(b.dataset.q)]; S.cfg = c; newSim(c); toast('Loaded: ' + SCEN[b.dataset.q].name); };
$('#nrOpenAl').onclick = () => setView('alr');
function toast(msg) { const t = document.createElement('div'); t.className = 'chip'; t.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:60;color:var(--text);border-color:#3d6fb0'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

/* ---------- refresh (dynamic zones) ---------- */
function refreshPanels(force) {
  const sim = S.sim, v = S.view;
  const crit = S.alerts.filter(a => a.active && a.status !== 'rejected'), nc = crit.filter(a => a.sev === 'critical').length, nw = crit.filter(a => a.sev === 'warning').length, bell = $('#bell');
  bell.className = 'bell' + (nc ? ' show' : nw ? ' show w' : crit.length ? ' show i' : ''); bell.textContent = nc || nw || crit.length || '';
  if (v === 'net') { renderNetSel(sim); renderNetRip(sim); }
  else if (v === 'sfc') renderSurface(sim);
  else if (v === 'deg') renderDeg(sim, force);
  else if (v === 'alr') renderAlerts(sim, force);
  else if (v === 'lab' && (force || !$('#labMain')._built)) { renderLab(); }
}
function airportFacilityChips(id) {
  const a = AP[id], out = [];
  for (const f of [id + '_TWR', a.tracon, a.ctr, id === 'JFK' ? 'JFK_GND' : null].filter(Boolean)) for (const s of SRCS) { const r = S.sim.fx.src[f + '|' + s]; if (r) out.push(`<span class="cell ${r.restoring ? 'restoring' : r.st}">${esc(f.replace('_TWR', ''))} ${SRC_SHORT[s]}</span>`); }
  return out.length ? `<div class="tog" style="margin-top:8px;gap:4px">${out.slice(0, 10).join('')}</div>` : '';
}
function renderNetSel(sim) {
  const a = AP[S.sel], A = sim.A[a.id], eff = A.aar * A.arrM, effD = A.adr * A.depM;
  setHTML($('#nlSel'), `<div class="sec"><h3>Selected airport ${tag('PUBLIC')}</h3><h2>${a.id} <span class="muted" style="font-weight:400;font-size:13px">${esc(a.name)}</span></h2><div class="sub2" style="margin-bottom:9px">${a.ctr} · ${a.tracon || 'no TRACON modeled'} · click any airport on the map</div>
  <div class="kv"><div><label>Arrival rate</label><b>${f0(eff)}</b> <small>/ ${A.aar} hr</small></div><div><label>Departure rate</label><b>${f0(effD)}</b> <small>/ ${A.adr} hr</small></div>
  <div><label>Dep queue</label><b>${A.q.length}</b> <small>aircraft</small></div><div><label>Holding</label><b>${A.h.length}</b> <small>aircraft</small></div>
  <div><label>Avg delay 60m</label><b>${f1(A.delay60)}</b> <small>min</small></div><div><label>Capacity</label><b>${f0(A.arrM * 100)}%</b> <small>of normal</small></div></div>
  <div style="margin-top:6px">${tag('ESTIMATED')} <span class="muted" style="font-size:11px">rates, queue and delay are modeled</span></div>${airportFacilityChips(a.id)}${wxLine(a.id)}</div>`);
}
function renderNetRip(sim) {
  const rp = sim.ripple(), J = sim.A.JFK, ent = Object.entries(rp).sort((a, b) => b[1].sum - a[1].sum);
  const tot = ent.reduce((s, [, r]) => s + r.sum, 0), hops = [1, 2, 3].map(h => { const L = ent.filter(([, r]) => (h === 3 ? r.hop >= 3 : r.hop === h)); return { h, n: L.length, s: L.reduce((x, [, r]) => x + r.sum, 0) }; });
  const mx = Math.max(60, ...ent.map(([, r]) => r.sum));
  const P = sectorPressure(sim), top = Object.entries(P).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0.05).slice(0, 4);
  setHTML($('#nrRip'), `<h3>Ripple from JFK ${tag('ESTIMATED')}</h3>
  <div class="kv"><div><label>JFK queue wait</label><b>${f0(sim.jfkQueueWait())}</b> <small>min</small></div><div><label>Airports affected</label><b>${ent.length}</b> <small>downstream</small></div></div>
  ${ent.length ? `<div class="row" style="margin:9px 0 6px;gap:6px">${hops.map(h => `<div class="card grow" style="padding:6px 8px"><div class="muted" style="font-size:10px">HOP ${h.h}${h.h === 3 ? '+' : ''}</div><b class="mono">${h.n}</b> <span class="muted" style="font-size:11px">apts · ${f0(h.s)} min</span></div>`).join('')}</div>
  <div class="list" style="gap:5px">${ent.slice(0, 7).map(([id, r]) => `<div><div class="row sb" style="font-size:12px"><span><b>${id}</b> <span class="muted">hop ${r.hop} · ${r.n} late deps${r.inb ? ' · ' + r.inb + ' inbound late' : ''}</span></span><span class="mono">${f0(r.sum)} min</span></div><div class="bar ${sevOf(r.sum, 80, 250, 600)}"><i style="width:${r.sum / mx * 100}%"></i></div></div>`).join('')}</div>
  <div class="note">Delay-minutes from departures made late by an aircraft that arrived late from a JFK-affected leg, plus late aircraft still inbound. Delay reaches distant airports hours later. Orange arcs show the busiest links.</div>` : `<div class="empty">No measurable delay propagation from JFK right now. Load a scenario above (or scrub the timeline into a scenario window) to see how a JFK disruption spreads through aircraft rotations and connecting airports.</div>`}
  ${top.length ? `<h3 style="margin-top:14px">Sector (ARTCC) pressure</h3><div class="list" style="gap:5px">${top.map(([id, p]) => `<div class="row sb" style="font-size:12px"><span>${id} <span class="muted">${CTR[id].name.replace(' Center', '')}</span></span><span style="width:90px"><span class="bar ${sevOf(p, .1, .35, .65)}" style="display:block"><i style="width:${p * 100}%"></i></span></span></div>`).join('')}</div>` : ''}`);
  const act = S.alerts.filter(a => a.active).slice(0, 3);
  setHTML($('#nrAl'), `<h3>Latest active alerts</h3>${act.length ? `<div class="list">${act.map(a => `<div class="card ${a.sev === 'critical' ? 'crit' : a.sev === 'warning' ? 'warn' : ''}"><div class="row"><span class="sev ${a.sev}"></span><b style="font-size:12px">${esc(a.title)}</b></div><div class="muted" style="font-size:11px;margin-top:2px">${a.cat} · since ${clock(a.t)}</div></div>`).join('')}</div>` : '<div class="empty">No active alerts.</div>'}`);
}
function renderSurface(sim) {
  const J = sim.jfk, A = sim.A.JFK, cong = surfaceCong(sim), t = sim.t;
  const nom = 24, bars = RWY.map(r => { const n = (sim.rwyOps[r] || []).length, closed = J.closedTrue.has(r); return `<div><div class="row sb" style="font-size:12px"><span class="mono">${r} ${closed ? '<span class="up">CLOSED</span>' : ''}</span><span class="mono muted">${n} ops/hr</span></div><div class="bar ${closed ? 'crit' : sevOf(n / nom, .6, .9, 1.15)}"><i style="width:${clamp(n / nom, 0, 1) * 100}%"></i></div></div>`; }).join('');
  setHTML($('#slA'), `<div class="sec"><h3>Runway configuration ${tag('ESTIMATED')}</h3><h2>${CFG_RWY[J.cfg].name}</h2>
  <div class="sub2" style="margin:2px 0 8px">Arrivals <b style="color:var(--info)">${J.arr.join(', ')}</b> · Departures <b style="color:var(--watch)">${J.dep.join(', ')}</b></div>
  ${J.closedTrue.size ? `<div class="note" style="border-color:var(--crit)">Closed: ${[...J.closedTrue].join(', ')}${J.lag && [...J.closedTrue].some(r => !J.closedKnown.has(r)) ? ` — <span class="up">feed lag ${J.lag} min: closure not yet in configuration data</span>` : ''}</div>` : ''}
  <div class="kv"><div><label>Arrival rate</label><b>${f0(A.aar * A.arrM)}</b> <small>/ ${A.aar}</small></div><div><label>Departure rate</label><b>${f0(A.adr * A.depM)}</b> <small>/ ${A.adr}</small></div>
  <div><label>Dep queue</label><b>${A.q.length}</b> <small>~${f0(sim.jfkQueueWait())} min</small></div><div><label>Holding</label><b>${A.h.length}</b> <small>airborne</small></div></div></div>`);
  setHTML($('#slW'), wxWindBlock());
  setHTML($('#slB'), `<div class="sec"><h3>Runway utilization (60 min)</h3><div class="list" style="gap:7px">${bars}</div></div>`);
  setHTML($('#slC'), `<div class="sec"><h3>Taxiway congestion ${tag('ESTIMATED')}</h3><div class="list" style="gap:7px">${TWYS.map(w => { const c = cong[w.id]; return `<div><div class="row sb" style="font-size:12px"><span>${esc(w.id)}</span><span class="mono" style="color:${congCol(c)}">${f0(c * 100)}%</span></div><div class="bar"><i style="width:${c * 100}%;background:${congCol(c)}"></i></div></div>`; }).join('')}</div></div>`);
  const dq = A.q.slice(0, 11), inb = sim.tails.filter(f => f.d === 'JFK' && f.st === 'enroute').sort((a, b) => (a.dep + a.dur) - (b.dep + b.dur)).slice(0, 9);
  const holds = A.h.slice(0, 5);
  setHTML($('#srA'), `<div class="sec"><h3>Departure queue <span class="sp"></span>${tag('SYNTHETIC')}${tag('ESTIMATED')}</h3>${dq.length ? `<table><tr><th>Flight</th><th>To</th><th>Waiting</th><th>Rwy*</th></tr>${dq.map((f, i) => `<tr><td class="mono">${f.cs}</td><td class="mono">${f.d}</td><td class="mono" style="color:${t - f.qEnter > 25 ? 'var(--crit)' : t - f.qEnter > 10 ? 'var(--watch)' : 'inherit'}">${f0(t - f.qEnter)}m</td><td class="mono muted">${J.dep.length ? J.dep[i % J.dep.length] : '-'}</td></tr>`).join('')}</table><div class="muted" style="font-size:11px;margin-top:4px">${A.q.length > 11 ? `+${A.q.length - 11} more · ` : ''}*estimated runway split</div>` : '<div class="empty">No aircraft waiting.</div>'}</div>`);
  setHTML($('#srB'), `<div class="sec"><h3>Arrival flow <span class="sp"></span>${tag('ESTIMATED')}</h3><table><tr><th>Flight</th><th>From</th><th>ETA</th><th>Status</th></tr>${holds.map(f => `<tr><td class="mono">${f.cs}</td><td class="mono">${f.from || f.o}</td><td class="mono">—</td><td><span class="pillst prog">HOLD ${f0(t - f.hold0)}m</span></td></tr>`).join('')}${inb.map(f => `<tr><td class="mono">${f.cs}</td><td class="mono">${f.from || f.o}</td><td class="mono">${f0(f.dep + f.dur - t)}m</td><td><span class="pillst open">INBOUND</span></td></tr>`).join('')}</table></div>`);
}

/* ---------- Degraded ops ---------- */
const CAPS = [
  { n: 'Controller–pilot voice', s: ['VOICE'], fb: 'Backup / contingency frequencies, relay through an adjacent facility (per approved procedure).' },
  { n: 'Digital clearances (CPDLC)', s: ['DATALINK'], fb: 'Voice for clearances; track undelivered uplinks.' },
  { n: 'Surveillance picture', s: ['RADAR', 'ADSB'], all: true, fb: 'Use the remaining source, mark unverified tracks, increase spacing.' },
  { n: 'Flight plan & strip data', s: ['FLIGHTDATA'], fb: 'Manual strips; refresh from an adjacent facility.' },
  { n: 'Weather picture', s: ['WX'], fb: 'ATIS, pilot reports, adjacent-facility weather.' },
  { n: 'Inter-facility coordination', s: ['NETWORK'], fb: 'Alternate landline / cell coordination; assign a liaison.' },
  { n: 'Traffic flow management', s: ['FLIGHTDATA', 'NETWORK'], fb: 'Manual metering by phone with wider spacing.' },
  { n: 'Facility power', s: ['POWER'], fb: 'Backup-power runtime check; pre-brief next steps.' },
];
function worstSt(sim, srcs, all) {
  const rs = srcs.map(s => Math.max(...['JFK_TWR', 'N90', 'ZNY'].map(f => ST_RANK[(sim.fx.src[f + '|' + s] || { st: 'ok' }).st])));
  const mx = Math.max(...rs), mn = Math.min(...rs); if (all) return mn === 2 ? 'lost' : mx > 0 ? 'degraded' : 'ok'; return ['ok', 'degraded', 'lost'][mx];
}
function renderDeg(sim, force) {
  const fx = sim.fx, t = sim.t, rows = ['JFK_TWR', 'JFK_GND', 'N90', 'ZNY', 'LGA_TWR', 'EWR_TWR', 'ZBW', 'ZDC'];
  const cell = (fac, src) => { const r = fx.src[fac + '|' + src]; if (!r) return `<td><div class="cell ok">OK</div></td>`; const age = Math.max(0, t - r.onset); return `<td><div class="cell ${r.restoring ? 'restoring' : r.st}">${r.restoring ? 'RESTORING' : r.st === 'lost' ? 'LOST' : 'DEGRADED'}<br><span style="opacity:.75">${f0(age)}m</span></div></td>`; };
  const rest = FACILITIES.filter(f => !rows.includes(f.id)), agg = src => { const L = rest.filter(f => fx.src[f.id + '|' + src]); const lost = L.filter(f => fx.src[f.id + '|' + src].st === 'lost').length; return `<td><div class="cell ${L.length ? (lost ? 'lost' : 'degraded') : 'ok'}">${L.length ? L.length + ' fac.' : 'OK'}</div></td>`; };
  setHTML($('#degMat'), `<h3>Information sources by facility <span class="sp"></span>${tag('SIMULATED')}<span class="muted" style="text-transform:none;letter-spacing:0">age = minutes since the status changed</span></h3>
  <table><tr><th>Facility</th>${SRCS.map(s => `<th style="text-align:center">${SRC_SHORT[s]}</th>`).join('')}</tr>${rows.map(f => `<tr><td style="white-space:nowrap">${esc(FAC[f].name)}</td>${SRCS.map(s => cell(f, s)).join('')}</tr>`).join('')}<tr><td class="muted">All other (${rest.length} facilities)</td>${SRCS.map(agg).join('')}</tr></table>`);
  const unrel = [], avail = [];
  for (const s of SRCS) { const w = worstSt(sim, [s]); (w === 'ok' ? avail : unrel).push(w === 'ok' ? SRC_LABEL[s] : `${SRC_LABEL[s]} <span class="${w === 'lost' ? 'up' : 'muted'}">(${w})</span>`); }
  const open = S.tasks.filter(k => k.status !== 'Done').length;
  setHTML($('#degCap'), `<h3>What still works at JFK ${tag('ESTIMATED')}</h3><div class="list" style="gap:6px">${CAPS.map(c => { const w = worstSt(sim, c.s, c.all); const p = w === 'ok' ? ['avail', 'AVAILABLE'] : w === 'degraded' ? ['limited', 'LIMITED'] : ['unavail', 'UNAVAILABLE']; return `<div class="card" style="padding:7px 10px"><div class="row sb"><b style="font-size:12px">${c.n}</b><span class="pillst ${p[0]}">${p[1]}</span></div>${w !== 'ok' ? `<div class="muted" style="font-size:11px;margin-top:3px">Fallback to consider: ${c.fb}</div>` : ''}</div>`; }).join('')}</div>
  <div class="note"><b>Reliable:</b> ${avail.join(', ') || 'none'}<br><b>Unreliable / missing:</b> ${unrel.join(', ') || 'none'}<br><b>Human attention needed:</b> ${open} open task${open === 1 ? '' : 's'}. Fallbacks are generic; use facility-approved procedures.</div>`);
  // tasks (only rebuild when changed)
  const tb = $('#degTask'); if (force || tb._v !== S.taskVer || !tb._built) { tb._v = S.taskVer; tb._built = true; renderTasks(); }
  $$('[data-age]', tb).forEach(el => el.textContent = dur(Math.max(0, t - +el.dataset.age)));
  // recovery (grouped by source)
  const act = Object.values(S.act || {}), rec = Object.values(S.restored), done = rec.filter(r => S.taskKeys[r.key] && S.taskKeys[r.key].status === 'Done').length, total = act.length + rec.length;
  setHTML($('#degRec'), `<h3>Recovery &amp; restoration ${tag('SIMULATED')}</h3>
  ${total ? `<div class="row sb" style="font-size:12px"><span>Sources verified restored</span><span class="mono">${done} / ${total}</span></div><div class="bar ok" style="margin:3px 0 10px"><i style="width:${done / total * 100}%"></i></div>` : '<div class="empty">No failed sources in the NY metro. Apply a communications or data scenario to track recovery here.</div>'}
  <div class="list" style="gap:6px">${act.map(g => { const inst = S.applied.stack.find(x => x.uid === g.inst) || {}, endR = g.end + (inst.restore || 0); const pr = g.restoring ? clamp((t - g.end) / Math.max(1, inst.restore || 1), 0, 1) * 0.5 + 0.5 : clamp((t - g.onset) / Math.max(1, g.end - g.onset), 0, 1) * 0.5; return `<div class="card" style="padding:7px 10px"><div class="row sb"><b style="font-size:12px">${SRC_LABEL[g.src]}</b><span class="pillst ${g.restoring ? 'open' : g.st === 'lost' ? 'unavail' : 'limited'}">${g.restoring ? 'RESTORING' : g.st === 'lost' ? 'FAILED' : 'DEGRADED'}</span></div><div class="muted" style="font-size:11px">${esc(facLabel(g.facs))}</div><div class="bar ${g.restoring ? '' : 'warn'}" style="margin:5px 0 3px"><i style="width:${pr * 100}%"></i></div><div class="muted" style="font-size:11px">Est. full restoration in ~${Math.max(0, f0(endR - t))} min (simulated ETR; real ETRs come from Tech Ops)</div></div>`; }).join('')}
  ${rec.map(r => { const k = S.taskKeys[r.key], ok = k && k.status === 'Done'; return `<div class="card" style="padding:7px 10px"><div class="row sb"><b style="font-size:12px">${SRC_LABEL[r.src]}</b><span class="pillst ${ok ? 'done' : 'prog'}">${ok ? 'VERIFIED' : 'RESTORED – VERIFY'}</span></div><div class="muted" style="font-size:11px">${esc(facLabel(r.facs))} · back since ${clock(r.t)}</div><div class="muted" style="font-size:11px;margin-top:2px">${ok ? 'Human verification completed.' : 'Feed is back, but a person must verify it before normal operations resume (see task board).'}</div></div>`; }).join('')}</div>`);
}
function renderTasks() {
  const el = $('#degTask'), order = { Open: 0, 'In progress': 1, Blocked: 2, Done: 3 };
  const tasks = [...S.tasks].sort((a, b) => order[a.status] - order[b.status] || (a.prio === 'High' ? -1 : 1) || a.t0 - b.t0);
  const cls = { Open: 'open', 'In progress': 'prog', Blocked: 'blocked', Done: 'done' };
  el.innerHTML = `<h3>Human task board <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">${S.tasks.filter(k => k.status !== 'Done').length} open</span></h3>
  <div class="row" style="margin-bottom:8px"><input id="tkNew" class="grow" placeholder="Add a task…"><button class="btn sm" id="tkAdd">Add</button></div>
  <div class="list">${tasks.length ? tasks.map(k => `<div class="card" style="padding:8px 10px;${k.status === 'Done' ? 'opacity:.55' : ''}"><div class="row" style="align-items:flex-start;gap:8px"><span class="pillst ${cls[k.status]}">${k.prio === 'High' ? '!' : '·'}</span><div class="grow" style="font-size:12px">${esc(k.text)}<div class="muted" style="font-size:10.5px;margin-top:2px">${k.fac ? esc(k.fac) + ' · ' : ''}opened <span data-age="${k.t0}"></span> ago</div></div></div>
  <div class="row" style="margin-top:6px"><select data-tk="${k.id}" data-f="owner" class="grow">${OWNERS.map(o => `<option${o === k.owner ? ' selected' : ''}>${o}</option>`).join('')}</select><select data-tk="${k.id}" data-f="status">${['Open', 'In progress', 'Blocked', 'Done'].map(o => `<option${o === k.status ? ' selected' : ''}>${o}</option>`).join('')}</select></div></div>`).join('') : '<div class="empty">No tasks yet. Tasks are generated when a source degrades or fails, and a verification task appears when it comes back.</div>'}</div>`;
}
$('#degTask').addEventListener('change', e => { const s = e.target.closest('[data-tk]'); if (!s) return; const k = S.tasks.find(x => x.id === +s.dataset.tk); if (!k) return; k[s.dataset.f] = s.value; if (s.dataset.f === 'status') { k.done = s.value === 'Done' ? S.sim.t : null; S.taskVer++; setTimeout(() => refreshPanels(true), 0); } });
$('#degTask').addEventListener('click', e => { if (e.target.id === 'tkAdd') { const i = $('#tkNew'); if (!i.value.trim()) return; const k = { id: S.uid++, key: 'u' + S.uid, text: i.value.trim(), fac: null, src: null, prio: 'Medium', owner: 'Unassigned', status: 'Open', t0: S.sim.t }; S.tasks.push(k); S.taskKeys[k.key] = k; S.taskVer++; refreshPanels(true); } });

/* ---------- Alerts & consistency ---------- */
let alrFilter = 'all';
function renderAlerts(sim, force) {
  const feed = $('#alrFeed'), t = sim.t;
  if (force || feed._v !== S.alertVer + alrFilter + S.alertSel || !feed._built) { feed._v = S.alertVer + alrFilter + S.alertSel; feed._built = true; renderFeed(); }
  // ledger (no controls inside: safe to refresh)
  const sq = sim.surveillanceQuality(t), cq = sim.commsQuality(t), base = S.runs[0] && S.runs[0].series[Math.max(0, t - 1)], exp = base ? base.thr : 0, obs = sim.jfkOps.length;
  const gauge = (l, v, c) => `<div><div class="row sb" style="font-size:12px"><span>${l}</span><span class="mono">${f0(v * 100)}%</span></div><div class="bar ${c}"><i style="width:${clamp(v, 0, 1) * 100}%"></i></div></div>`;
  const L = [...sim.ledger].reverse().slice(0, 14), inc = [...sim.incons].filter(e => e.t >= 0).reverse().slice(0, 6);
  setHTML($('#alrLedger'), `<h3>Instruction ↔ activity consistency ${tag('SIMULATED')}</h3>
  <div class="kv"><div><label>Throughput observed</label><b>${obs}</b> <small>/ ${exp || '—'} expected</small></div><div><label>Dep queue</label><b>${sim.A.JFK.q.length}</b> <small>aircraft</small></div></div>
  <div class="list" style="gap:7px;margin:10px 0">${gauge('Voice / datalink quality', cq, cq > 0.9 ? 'ok' : cq > 0.6 ? 'watch' : 'crit')}${gauge('Surveillance confidence', sq, sq > 0.9 ? 'ok' : sq > 0.65 ? 'watch' : 'crit')}</div>
  <h3>Recent JFK instructions vs observed ${tag('SYNTHETIC')}</h3>
  <table><tr><th>Time</th><th>Flight</th><th>Type</th><th>Instructed</th><th>Observed</th><th></th></tr>${L.map(r => `<tr class="${r.bad ? 'bad' : ''}"><td class="mono">${clock(r.t)}</td><td class="mono">${r.cs}</td><td class="mono muted">${r.type}</td><td class="mono">${r.instr}</td><td class="mono">${r.obs}</td><td>${r.bad ? '<span class="up">✗</span>' : /unverified/.test(r.obs) ? '<span class="muted">?</span>' : '<span class="down">✓</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Waiting for activity…</td></tr>'}</table>
  <h3 style="margin-top:14px">Discrepancy findings</h3>${inc.length ? `<div class="list">${inc.map(e => `<div class="card ${e.sev === 'critical' ? 'crit' : e.sev === 'warning' ? 'warn' : ''}" style="padding:7px 10px"><div class="row"><span class="sev ${e.sev}"></span><b style="font-size:12px">${e.cs}</b><span class="muted" style="font-size:11px">${clock(e.t)}</span></div><div style="font-size:12px;margin-top:2px">${esc(e.detail)}</div><div class="muted" style="font-size:11px;margin-top:2px">Uncertainty: ${esc(e.unc)}</div></div>`).join('')}</div>` : '<div class="empty">No discrepancies detected. Findings appear when comms or data degrade, or a runway closure is not yet reflected in the data feed.</div>'}`);
  const lg = $('#alrLog'); if (force || lg._v !== S.alertVer + ':' + S.alertSel + ':' + S.decisions.length || !lg._built) { lg._v = S.alertVer + ':' + S.alertSel + ':' + S.decisions.length; lg._built = true; renderDetail(); }
}
function renderFeed() {
  const flt = { all: () => true, active: a => a.active, critical: a => a.sev === 'critical' || a.sev === 'warning', consistency: a => a.cat === 'Consistency', data: a => a.cat === 'Data feed' || a.cat === 'Infrastructure', network: a => a.cat === 'Network ripple' };
  const L = S.alerts.filter(flt[alrFilter]).slice(0, 60);
  $('#alrFeed').innerHTML = `<h3>Alerts <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">${S.alerts.filter(a => a.active).length} active · ${S.alerts.length} total</span></h3>
  <div class="tog" id="alrF" style="margin-bottom:9px">${[['all', 'All'], ['active', 'Active'], ['critical', 'Warning+'], ['consistency', 'Consistency'], ['data', 'Infra / data'], ['network', 'Ripple']].map(([k, l]) => `<button data-f="${k}" class="${alrFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="list">${L.length ? L.map(a => `<div class="card ${S.alertSel === a.id ? 'sel' : ''} ${a.sev === 'critical' ? 'crit' : a.sev === 'warning' ? 'warn' : ''}" data-al="${a.id}" style="cursor:pointer;${a.active ? '' : 'opacity:.55'}"><div class="row"><span class="sev ${a.sev}"></span><b style="font-size:12.5px;flex:1">${esc(a.title)}</b></div><div class="row muted" style="font-size:11px;margin-top:3px;gap:6px">${tag(a.cls)} <span>${a.cat}</span> <span>· ${clock(a.t)}</span> ${a.active ? '' : '<span>· cleared</span>'} ${a.status !== 'new' ? `<span class="pillst ${a.status === 'accepted' ? 'done' : a.status === 'rejected' ? 'blocked' : 'prog'}">${a.status.toUpperCase()}</span>` : ''}</div></div>`).join('') : '<div class="empty">No alerts yet. The sim is running baseline traffic; alerts appear as conditions develop.</div>'}</div>`;
}
function renderDetail() {
  const a = S.alerts.find(x => x.id === S.alertSel) || null;
  $('#alrLog').innerHTML = `<h3>Alert detail</h3>${a ? `<div class="card ${a.sev === 'critical' ? 'crit' : a.sev === 'warning' ? 'warn' : ''}"><div class="row"><span class="sev ${a.sev}"></span><b>${esc(a.title)}</b></div><div class="row" style="margin:6px 0;gap:6px">${tag(a.cls)}<span class="muted" style="font-size:11px">${a.cat} · raised ${clock(a.first)}</span></div>
  <div class="field"><label>What triggered it</label><div style="font-size:12px">${esc(a.trigger)}</div></div><div class="field"><label>Sources it relies on</label><div style="font-size:12px">${a.sources.map(esc).join(' · ')}</div></div><div class="field"><label>Where uncertainty remains</label><div style="font-size:12px">${esc(a.unc)}</div></div>
  <div class="field"><label>Options for human review (advisory)</label>${a.recs.map((r, i) => `<div style="font-size:12px;margin:4px 0">• ${esc(r)}<div class="row" style="margin-top:3px"><button class="btn sm" data-d="accepted" data-i="${i}">Accept</button><button class="btn sm" data-d="deferred" data-i="${i}">Defer</button><button class="btn sm dng" data-d="rejected" data-i="${i}">Reject</button></div></div>`).join('')}</div>
  <div class="note">Accepting records a human decision only. AIRSPACE does not issue clearances, direct aircraft or activate procedures.</div></div>` : '<div class="empty">Select an alert to see what triggered it, which sources it uses and where uncertainty remains.</div>'}
  <h3 style="margin-top:14px">Human review log</h3>${S.decisions.length ? `<table>${S.decisions.slice(-12).reverse().map(d => `<tr><td class="mono">${clock(d.t)}</td><td><span class="pillst ${d.d === 'accepted' ? 'done' : d.d === 'rejected' ? 'blocked' : 'prog'}">${d.d.toUpperCase()}</span></td><td style="font-size:11.5px">${esc(d.rec)}<div class="muted">${esc(d.title)}</div></td></tr>`).join('')}</table>` : '<div class="empty">No decisions recorded.</div>'}`;
}
$('#alrFeed').addEventListener('click', e => { const f = e.target.closest('#alrF button'); if (f) { alrFilter = f.dataset.f; refreshPanels(true); return; } const c = e.target.closest('[data-al]'); if (c) { S.alertSel = +c.dataset.al; refreshPanels(true); } });
$('#alrLog').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (!b) return; const a = S.alerts.find(x => x.id === S.alertSel); if (!a) return; S.decisions.push({ t: S.sim.t, d: b.dataset.d, rec: a.recs[+b.dataset.i], title: a.title }); a.status = b.dataset.d; S.alertVer++; refreshPanels(true); });

/* ---------- What-If Lab ---------- */
function mkInst(sid, over) {
  const s = SCEN[sid], p = {}; for (const q of (s.params || [])) p[q.key] = q.def;
  return { uid: S.uid++, sid, p, start: s.start, dur: s.dur, restore: s.restore, ...(over || {}) };
}
function defMit() { const m = {}; for (const x of MITS) m[x.key] = { on: false, at: 10, dur: 40 }; return m; }
S.cfg.mit = defMit();
let labCat = 'All', runName = '';
function paramField(inst, q) {
  const v = inst.p[q.key];
  if (q.type === 'select') return `<div class="field"><label>${q.label}</label><select data-uid="${inst.uid}" data-p="${q.key}">${q.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  return `<div class="field"><label>${q.label}</label><div class="rv"><input type="range" min="${q.min}" max="${q.max}" step="${q.step}" value="${v}" data-uid="${inst.uid}" data-p="${q.key}" data-num="1"><span class="mono" style="width:38px">${(+v).toFixed(2)}</span></div></div>`;
}
const METRICS = [
  ['avgJfkDep', 'Avg JFK departure delay', v => f1(v) + ' min', 'lo'], ['avgJfkHold', 'Avg JFK airborne hold', v => f1(v) + ' min', 'lo'], ['avgNet', 'Network avg departure delay', v => f1(v) + ' min', 'lo'],
  ['peakQ', 'Peak JFK departure queue', v => f0(v), 'lo'], ['peakH', 'Peak JFK holding', v => f0(v), 'lo'], ['thr', 'JFK throughput in window', v => f0(v) + '/hr', 'hi'],
  ['late', 'Departures >15 min late', v => f0(v), 'lo'], ['longHolds', 'Arrivals held >10 min', v => f0(v), 'lo'], ['diverted', 'Diversions', v => f0(v), 'lo'], ['impacted', 'Other airports >15 min avg', v => f0(v), 'lo'],
  ['groundMin', 'Ground delay assigned (flight-hrs)', v => f0(v / 60), null], ['recovery', 'Time to recover after scenario', v => v == null ? '—' : f0(v) + ' min', 'lo'], ['peakRisk', 'Peak risk index (0–100)', v => f0(v), 'lo'],
];
function renderLab() {
  for (const m of MITS) if (!S.cfg.mit[m.key]) S.cfg.mit[m.key] = { on: false, at: 10, dur: 40 };
  const lib = $('#labLib'), main = $('#labMain'); main._built = true;
  const cats = ['All', ...new Set(Object.values(SCEN).map(s => s.cat))];
  lib.innerHTML = `<h3>Scenario library <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">${Object.keys(SCEN).length} scenarios</span></h3>
  <div class="note" style="margin-top:0">Templates with placeholder parameters — the team can add or replace scenarios at any time (build one below, import JSON, or add an entry in <span class="mono">scenarios</span>).</div>
  <div class="tog" id="labCats" style="margin:8px 0">${cats.map(c => `<button data-c="${c}" class="${c === labCat ? 'on' : ''}">${c}</button>`).join('')}</div>
  <div class="list">${Object.values(SCEN).filter(s => labCat === 'All' || s.cat === labCat).map(s => `<div class="card"><div class="row sb"><h4>${esc(s.name)}</h4><span class="tag SIMULATED">${esc(s.cat.toUpperCase())}</span></div><div class="muted" style="font-size:12px;margin:3px 0 7px">${esc(s.blurb || '')}</div><div class="row"><button class="btn sm pri" data-add="${s.id}">Add to stack</button><button class="btn sm" data-quick="${s.id}">Run alone</button>${s.custom ? `<button class="btn sm dng" data-del="${s.id}">Delete</button>` : ''}</div></div>`).join('')}</div>
  <div class="row" style="margin-top:12px;flex-wrap:wrap"><button class="btn" data-lib="new">+ New custom scenario</button><button class="btn" data-lib="io">Import / export JSON</button><button class="btn" data-lib="sweep">Run all templates</button></div>`;
  const cfg = S.cfg, base = cfg.stack.length ? Math.min(...cfg.stack.map(s => s.start)) : 0;
  main.innerHTML = `<h3>Scenario stack <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">scenarios run concurrently — stack several to model cascading failures</span></h3>
  <div class="list" id="labStack">${cfg.stack.length ? cfg.stack.map(inst => { const s = SCEN[inst.sid]; return `<div class="card"><div class="row sb"><h4>${esc(s.name)}</h4><button class="btn sm dng" data-rm="${inst.uid}">Remove</button></div>
    <div class="row" style="flex-wrap:wrap;gap:4px 14px;align-items:flex-start">${(s.params || []).map(q => paramField(inst, q)).join('')}
    <div class="field"><label>Starts at (min)</label><input type="number" min="0" max="340" value="${inst.start}" data-uid="${inst.uid}" data-n="start"></div><div class="field"><label>Lasts (min)</label><input type="number" min="5" max="300" value="${inst.dur}" data-uid="${inst.uid}" data-n="dur"></div><div class="field"><label>Restoration (min)</label><input type="number" min="0" max="120" value="${inst.restore}" data-uid="${inst.uid}" data-n="restore"></div></div></div>`; }).join('') : '<div class="empty">Empty stack = baseline traffic. Add scenarios from the library on the left.</div>'}</div>
  <h3 style="margin-top:16px">Advisory responses to test <span class="sp"></span><span class="muted" style="text-transform:none;letter-spacing:0">activation time is minutes after the first scenario starts</span></h3>
  <div class="list" style="gap:5px">${MITS.map(m => { const c = cfg.mit[m.key]; return `<div class="card" style="padding:7px 10px"><div class="row"><input type="checkbox" data-m="${m.key}" ${c.on ? 'checked' : ''}><div class="grow"><b style="font-size:12.5px">${m.name}</b><div class="muted" style="font-size:11px">${m.desc}</div></div><span class="muted" style="font-size:11px">at +</span><input type="number" min="0" max="300" value="${c.at}" data-ma="${m.key}" style="width:58px">${m.extra ? `<span class="muted" style="font-size:11px">for</span><input type="number" min="5" max="240" value="${c.dur}" data-md="${m.key}" style="width:58px">` : ''}</div></div>`; }).join('')}</div>
  <div class="row" style="margin:14px 0;flex-wrap:wrap"><input id="runName" placeholder="Name this run (optional)" value="${esc(runName)}" style="width:210px"><button class="btn pri" id="bRun">Run &amp; save for comparison</button><button class="btn" id="bApply">Apply to live sim</button><button class="btn" id="bClear">Clear stack</button><button class="btn" id="bCopy" title="Copy this configuration as JSON">Copy config</button></div>
  <h3>Compare runs <span class="sp"></span><select id="cmpM">${[['q', 'JFK departure queue'], ['h', 'JFK airborne holding'], ['thr', 'JFK ops per hour'], ['net', 'Network avg delay'], ['risk', 'Risk index']].map(([k, l]) => `<option value="${k}"${S.cmp === k ? ' selected' : ''}>${l}</option>`).join('')}</select></h3>
  <div style="height:190px;position:relative"><canvas id="labChart" style="width:100%;height:100%"></canvas></div>
  <div id="labTable" style="margin-top:10px;overflow:auto"></div>`;
  renderCompare();
}
function renderCompare() {
  const runs = S.runs, b = runs[0];
  const head = runs.map((r, i) => `<th style="min-width:104px"><div class="row" style="gap:5px"><i class="sev" style="background:${r.color}"></i><span style="text-transform:none;letter-spacing:0;color:var(--text);white-space:normal">${esc(r.name)}</span></div>${i ? `<div class="row" style="margin-top:4px"><button class="btn sm" data-load="${r.id}">Load live</button><button class="btn sm dng" data-run-del="${r.id}">✕</button></div>` : '<div class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">reference</div>'}</th>`).join('');
  const rows = METRICS.map(([k, l, fmt, dir]) => `<tr><td style="white-space:nowrap">${l}</td>${runs.map((r, i) => { const v = r.result[k]; let d = ''; if (i && dir && v != null && b.result[k] != null) { const df = v - b.result[k]; if (Math.abs(df) > 0.05 * Math.max(1, Math.abs(b.result[k]))) { const bad = dir === 'lo' ? df > 0 : df < 0; d = ` <span class="${bad ? 'up' : 'down'}" style="font-size:10.5px">${df > 0 ? '▲' : '▼'}${Math.abs(k === 'thr' || k.startsWith('avg') ? +df.toFixed(1) : f0(df))}</span>`; } } return `<td class="mono">${fmt(v)}${d}</td>`; }).join('')}</tr>`).join('');
  $('#labTable').innerHTML = `<table><tr><th>Metric</th>${head}</tr>${rows}</table><div class="note">${tag('SIMULATED')} ${tag('ESTIMATED')} Same synthetic traffic and random seed for every run, so differences come from the scenario and responses only. ▲/▼ = change vs baseline (red = worse). Risk index is a modeled composite, not an operational safety rating.</div>`;
  drawLabChart();
}
function drawLabChart() {
  const c = $('#labChart'); if (!c) return; const r = c.getBoundingClientRect(); c.width = r.width * DPR; c.height = r.height * DPR; const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const w = r.width, h = r.height, pl = 34, pb = 16, k = S.cmp; let mx = 1; for (const run of S.runs) for (const s of run.series) mx = Math.max(mx, s[k]); mx *= 1.08;
  g.font = '10px Geist Mono,monospace'; g.textAlign = 'right'; g.fillStyle = '#5b667a';
  for (let i = 0; i <= 4; i++) { const y = 4 + (h - pb - 8) * (1 - i / 4); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(pl, y, w - pl, 1); g.fillStyle = '#5b667a'; g.fillText(f0(mx * i / 4), pl - 5, y + 3); }
  g.textAlign = 'center'; for (let t = 0; t <= 360; t += 60) { const x = pl + (w - pl) * t / 360; g.fillStyle = '#5b667a'; g.fillText(clock(t), x, h - 3); }
  const last = S.runs[S.runs.length - 1]; if (last && last.cfg.stack.length) last.cfg.stack.forEach(s => { g.fillStyle = 'rgba(177,140,255,.12)'; g.fillRect(pl + (w - pl) * s.start / 360, 4, (w - pl) * s.dur / 360, h - pb - 8); });
  S.runs.forEach(run => { g.strokeStyle = run.color; g.lineWidth = run === S.runs[0] ? 1.2 : 1.8; g.beginPath(); run.series.forEach((s, i) => { const x = pl + (w - pl) * s.t / 360, y = 4 + (h - pb - 8) * (1 - s[k] / mx); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); });
}
function addRun(name, cfg) {
  const c = cloneCfg(cfg), r = runHeadless(c, HORIZON, SEED), id = ++S.runSeq;
  const auto = c.stack.length ? c.stack.map(s => SCEN[s.sid].name).join(' + ') : 'No scenario';
  S.runs.push({ id, name: name || `Run ${id} · ${auto}${Object.values(c.mit).some(m => m.on) ? ' + responses' : ''}`, color: RUN_COLORS[S.runs.length % RUN_COLORS.length], cfg: c, result: r.result, series: r.series });
}
function labClick(e) {
  const t = e.target;
  let b;
  if ((b = t.closest('[data-c]'))) { labCat = b.dataset.c; renderLab(); }
  else if ((b = t.closest('[data-add]'))) { S.cfg.stack.push(mkInst(b.dataset.add)); renderLab(); toast('Added to stack'); }
  else if ((b = t.closest('[data-quick]'))) { const c = newCfg(); c.mit = defMit(); c.stack = [mkInst(b.dataset.quick)]; addRun('', c); renderLab(); }
  else if ((b = t.closest('[data-del]'))) { delete SCEN[b.dataset.del]; saveCustom(); renderLab(); }
  else if ((b = t.closest('[data-rm]'))) { S.cfg.stack = S.cfg.stack.filter(s => s.uid !== +b.dataset.rm); renderLab(); }
  else if ((b = t.closest('[data-load]'))) { const r = S.runs.find(x => x.id === +b.dataset.load); S.cfg = cloneCfg(r.cfg); newSim(S.cfg); setView('net'); toast('Loaded into live sim: ' + r.name); }
  else if ((b = t.closest('[data-run-del]'))) { S.runs = S.runs.filter(x => x.id !== +b.dataset.runDel); renderCompare(); }
  else if ((b = t.closest('[data-lib]'))) { const k = b.dataset.lib; if (k === 'new') openBuilder(); else if (k === 'io') openIO(); else { b.disabled = true; b.textContent = 'Running…'; setTimeout(() => { for (const s of Object.values(SCEN)) { const c = newCfg(); c.stack = [mkInst(s.id)]; addRun(s.name, c); } renderLab(); }, 30); } }
  else if (t.id === 'bRun') { const nm = $('#runName').value.trim(); t.disabled = true; t.textContent = 'Running…'; setTimeout(() => { addRun(nm, S.cfg); runName = ''; renderLab(); }, 30); }
  else if (t.id === 'bApply') { newSim(S.cfg); setView('net'); toast('Applied to live simulation'); }
  else if (t.id === 'bClear') { S.cfg.stack = []; S.cfg.mit = defMit(); renderLab(); }
  else if (t.id === 'bCopy') { const txt = JSON.stringify(cloneCfg(S.cfg), null, 1); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Configuration copied'), () => openIO(txt)); }
}
function labInput(e) {
  const t = e.target;
  if (t.dataset.p) { const inst = S.cfg.stack.find(s => s.uid === +t.dataset.uid); if (!inst) return; inst.p[t.dataset.p] = t.dataset.num ? +t.value : t.value; evCacheClear(inst); if (t.dataset.num) t.nextElementSibling.textContent = (+t.value).toFixed(2); }
  else if (t.dataset.n) { const inst = S.cfg.stack.find(s => s.uid === +t.dataset.uid); if (inst) { inst[t.dataset.n] = +t.value; evCacheClear(inst); } }
  else if (t.dataset.m) S.cfg.mit[t.dataset.m].on = t.checked;
  else if (t.dataset.ma) S.cfg.mit[t.dataset.ma].at = +t.value;
  else if (t.dataset.md) S.cfg.mit[t.dataset.md].dur = +t.value;
  else if (t.id === 'cmpM') { S.cmp = t.value; drawLabChart(); }
  else if (t.id === 'runName') runName = t.value;
}
function evCacheClear(inst) { evCache.delete(inst); }
$('#labLib').addEventListener('click', labClick); $('#labMain').addEventListener('click', labClick);
$('#labMain').addEventListener('input', labInput); $('#labMain').addEventListener('change', labInput);

/* ---------- custom scenarios (builder + import/export) ---------- */
function saveCustom() { try { localStorage.setItem('airspace.custom', JSON.stringify(Object.values(SCEN).filter(s => s.custom).map(({ id, name, cat, blurb, start, dur, restore, staticEvents }) => ({ id, name, cat, blurb, start, dur, restore, staticEvents })))); } catch (e) { } }
function regCustom(d) { const id = d.id && !SCEN[d.id] ? d.id : 'custom_' + (S.uid++); return reg({ id, name: d.name || 'Custom scenario', cat: 'Custom', blurb: d.blurb || 'User-defined scenario.', start: d.start ?? 30, dur: d.dur ?? 60, restore: d.restore ?? 20, params: [], staticEvents: d.staticEvents || [], custom: true }); }
try { JSON.parse(localStorage.getItem('airspace.custom') || '[]').forEach(regCustom); } catch (e) { }
const EFF_TYPES = { src: 'Source outage', wx: 'Weather', rwy: 'Runway closed', cap: 'Capacity multiplier', taxi: 'Taxiway blockage' };
function effRow(type, v = {}) {
  const opt = (arr, sel) => arr.map(o => `<option${o === sel ? ' selected' : ''}>${o}</option>`).join('');
  let a = '', b = '', c = '';
  if (type === 'src') { a = `<select data-e="a">${FACILITIES.map(f => `<option value="${f.id}"${f.id === (v.fac || 'JFK_TWR') ? ' selected' : ''}>${f.name}</option>`).join('')}</select>`; b = `<select data-e="b">${SRCS.map(s => `<option value="${s}"${s === (v.src || 'VOICE') ? ' selected' : ''}>${SRC_LABEL[s]}</option>`).join('')}</select>`; c = `<select data-e="c">${opt(['lost', 'degraded'], v.st)}</select>`; }
  if (type === 'wx') { a = `<select data-e="a">${AIRPORTS.map(x => `<option${x.id === (v.ap || 'JFK') ? ' selected' : ''}>${x.id}</option>`).join('')}</select>`; b = `<select data-e="b">${opt(Object.keys(WX_LOSS), v.type)}</select>`; c = `<input type="range" data-e="c" min="0.1" max="1" step="0.05" value="${v.sev ?? 0.7}">`; }
  if (type === 'rwy') { a = `<select data-e="a">${opt(RWY, v.rwy)}</select>`; }
  if (type === 'cap') { a = `<select data-e="a">${AIRPORTS.map(x => `<option${x.id === (v.ap || 'JFK') ? ' selected' : ''}>${x.id}</option>`).join('')}</select>`; c = `<input type="range" data-e="c" min="0.1" max="1" step="0.05" value="${v.m ?? 0.6}">`; }
  if (type === 'taxi') { a = `<select data-e="a">${opt(TWYS.map(t => t.id), v.id)}</select>`; }
  return `<div class="effrow" data-type="${type}"><span style="font-size:11.5px">${EFF_TYPES[type]}</span>${a || '<span></span>'}${b || '<span></span>'}<input type="number" data-e="at" min="0" placeholder="at" title="Offset (min) from scenario start" value="${v.at ?? 0}" style="width:70px"><input type="number" data-e="len" min="1" placeholder="len" title="Length (min); blank = until scenario ends" value="${v.len ?? ''}" style="width:70px"><button class="btn sm dng" data-x="1">✕</button>${c ? `<div style="grid-column:2/7">${c}</div>` : ''}</div>`;
}
function openBuilder() {
  const m = $('#modal'); m.classList.add('on');
  m.innerHTML = `<div class="box"><div class="row sb"><h2>New custom scenario</h2><button class="btn sm" data-close="1">Close</button></div><div class="note">Combine effects to describe a scenario. Offsets are minutes after the scenario starts; leave length blank to apply until it ends.</div>
  <div class="field"><label>Name</label><input id="cbName" placeholder="e.g. Tower evacuation"></div><div class="field"><label>Description</label><input id="cbDesc" placeholder="One line on what happens"></div>
  <div class="row" style="gap:14px"><div class="field"><label>Default start (min)</label><input type="number" id="cbStart" value="30"></div><div class="field"><label>Default duration</label><input type="number" id="cbDur" value="60"></div><div class="field"><label>Restoration</label><input type="number" id="cbRest" value="20"></div></div>
  <h3>Effects</h3><div id="cbEff">${effRow('src')}</div><div class="row" style="margin:8px 0 14px;flex-wrap:wrap">${Object.entries(EFF_TYPES).map(([k, l]) => `<button class="btn sm" data-add-eff="${k}">+ ${l}</button>`).join('')}</div>
  <div class="row"><button class="btn pri" id="cbSave">Save to library</button></div></div>`;
}
function openIO(txt) {
  const m = $('#modal'); m.classList.add('on'); const cur = txt || JSON.stringify(Object.values(SCEN).filter(s => s.custom).map(({ id, name, blurb, start, dur, restore, staticEvents }) => ({ id, name, blurb, start, dur, restore, staticEvents })), null, 1);
  m.innerHTML = `<div class="box"><div class="row sb"><h2>Import / export scenarios</h2><button class="btn sm" data-close="1">Close</button></div><div class="note">Custom scenarios as JSON. Copy this to share with teammates, or paste a JSON array here and import.</div><textarea id="ioText">${esc(cur)}</textarea><div class="row" style="margin-top:10px"><button class="btn" id="ioCopy">Copy</button><button class="btn pri" id="ioImport">Import pasted JSON</button></div></div>`;
}
$('#modal').addEventListener('click', e => {
  const t = e.target;
  if (t === $('#modal') || t.closest('[data-close]')) { $('#modal').classList.remove('on'); return; }
  const add = t.closest('[data-add-eff]'); if (add) { $('#cbEff').insertAdjacentHTML('beforeend', effRow(add.dataset.addEff)); return; }
  if (t.closest('[data-x]')) { t.closest('.effrow').remove(); return; }
  if (t.id === 'cbSave') {
    const evs = $$('#cbEff .effrow').map(r => { const g = k => { const el = $(`[data-e="${k}"]`, r); return el ? el.value : null; }, ty = r.dataset.type, o = { k: ty, at: +g('at') || 0 }; const ln = g('len'); if (ln) o.len = +ln;
      if (ty === 'src') Object.assign(o, { fac: g('a'), src: g('b'), st: g('c') }); if (ty === 'wx') Object.assign(o, { ap: g('a'), type: g('b'), sev: +g('c') }); if (ty === 'rwy') Object.assign(o, { ap: 'JFK', rwy: g('a') }); if (ty === 'cap') Object.assign(o, { ap: g('a'), m: +g('c') }); if (ty === 'taxi') Object.assign(o, { id: g('a') }); return o; });
    if (!evs.length) { toast('Add at least one effect'); return; }
    regCustom({ name: $('#cbName').value.trim() || 'Custom scenario', blurb: $('#cbDesc').value.trim(), start: +$('#cbStart').value, dur: +$('#cbDur').value, restore: +$('#cbRest').value, staticEvents: evs });
    saveCustom(); $('#modal').classList.remove('on'); renderLab(); toast('Scenario saved to library');
  }
  if (t.id === 'ioCopy') { const v = $('#ioText').value; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('Copied'), () => { $('#ioText').select(); toast('Press Ctrl/Cmd+C to copy'); }); }
  if (t.id === 'ioImport') { try { let d = JSON.parse($('#ioText').value); if (!Array.isArray(d)) d = [d]; d.forEach(x => { if (x.staticEvents) regCustom({ ...x, id: null }); }); saveCustom(); $('#modal').classList.remove('on'); renderLab(); toast('Imported ' + d.length + ' scenario(s)'); } catch (err) { toast('Could not read JSON'); } }
});

/* ---------- guide ---------- */
$('#guide').onclick = () => { const m = $('#modal'); m.classList.add('on'); m.innerHTML = `<div class="box"><div class="row sb"><h2>AIRSPACE — how it works</h2><button class="btn sm" data-close="1">Close</button></div>
  <p class="muted" style="margin:8px 0 12px">A human-supervised decision-support and training tool for air traffic control teams, centered on JFK. It organizes information, flags developing problems and lets teams rehearse disruptions. It never issues clearances, directs aircraft or activates procedures.</p>
  <div class="list" style="gap:8px;font-size:12.5px">
  <div><b>Network</b> — synthetic nationwide traffic across 30 airports and 20 ARTCC regions. Click an airport; watch how a JFK problem ripples through aircraft rotations to connecting airports.</div>
  <div><b>JFK Surface</b> — runway configuration and utilization, taxiway congestion, departure queues and arrival flow.</div>
  <div><b>What-If Lab</b> — stack hypothetical failures, test advisory responses, run them against the same traffic and compare. Add or import your own scenarios any time.</div>
  <div><b>Degraded Ops</b> — which sources and capabilities remain, a human task board with owners, and restoration tracking.</div>
  <div><b>Weather layer</b> — faint rain and snow, clouds, moving winds aloft, storm cells, a cold-front line, crosswind arrows and rings on airports with poor flying weather (Network view, Layers; the JFK Surface view lists runway crosswinds). Click an airport for its conditions. Weather scenarios from the Lab strengthen it. Synthetic, not a real forecast.</div>
  <div><b>Alerts &amp; Checks</b> — every alert explains its trigger, sources and uncertainty; instruction-vs-observed checks flag inconsistencies. Decisions are logged for human review.</div></div>
  <div class="row" style="margin-top:14px;gap:6px;flex-wrap:wrap">${tag('PUBLIC')}${tag('SYNTHETIC')}${tag('ESTIMATED')}${tag('SIMULATED')}<span class="muted" style="font-size:11.5px">every panel labels what kind of data it shows. Drag the timeline to scrub; the scenario windows are shaded.</span></div></div>`; };

/* ---------- init ---------- */
(function init() {
  resize();
  // baseline reference run (no scenario) — used for "expected" values and comparisons
  const b = runHeadless(newCfg(), HORIZON, SEED);
  S.runs.push({ id: 0, name: 'Baseline (no scenario)', color: RUN_COLORS[0], cfg: newCfg(), result: b.result, series: b.series });
  newSim(newCfg()); fitUS();
  const h = location.hash.slice(1); if (['net', 'sfc', 'lab', 'deg', 'alr'].includes(h)) setView(h); else refreshPanels(true);
  requestAnimationFrame(frame);
  window.__S = S;
})();
