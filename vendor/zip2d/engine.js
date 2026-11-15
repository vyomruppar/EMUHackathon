'use strict';
/* ============================================================
   AIRSPACE — simulation engine (pure, no DOM)
   Synthetic traffic: ~720 aircraft rotate between 30 airports on a
   schedule. Capacity tokens at each airport are scaled by effects
   from scenarios (comms/data loss, weather, runway closures).
   Delays propagate through aircraft rotation (late arrival -> late
   next departure) which produces the network ripple.
   1 step = 1 simulated minute. Deterministic for a given seed.
   ============================================================ */
const RANK = { ok: 0, degraded: 1, lost: 2 };
const evCache = new WeakMap();

function distNm(a, b) {
  const R = 3440.065, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const newCfg = () => ({ stack: [], mit: {} });
const mitBase = cfg => cfg.stack.length ? Math.min(...cfg.stack.map(s => s.start)) : 0;
function mitOn(cfg, key, t) { const m = cfg.mit[key]; return !!(m && m.on && t >= mitBase(cfg) + (m.at || 0)); }

function instEvents(inst) {
  let e = evCache.get(inst); if (e) return e;
  const S = SCEN[inst.sid]; e = S ? (S.events ? S.events(inst.p || {}, inst.dur) : (S.staticEvents || [])) : [];
  evCache.set(inst, e); return e;
}

function computeFx(cfg, t) {
  const fx = { src: {}, wx: {}, rwy: {}, cap: {}, taxi: new Set(), active: [], any: false };
  for (const inst of cfg.stack) {
    const end = inst.start + inst.dur, evs = instEvents(inst);
    for (const e of evs) {
      const a = inst.start + (e.at || 0), b = e.len != null ? a + e.len : end;
      let on = t >= a && t < b, restoring = false;
      if (!on && e.k === 'src' && t >= b && t < b + (inst.restore || 0)) { restoring = true; }
      if (!on && !restoring) continue;
      fx.any = true;
      if (e.k === 'src') {
        const st = restoring ? (e.st === 'lost' ? 'degraded' : 'ok') : e.st; if (st === 'ok') continue;
        const key = e.fac + '|' + e.src, cur = fx.src[key];
        if (!cur || RANK[st] > RANK[cur.st]) fx.src[key] = { st, restoring, onset: a, end: b, inst: inst.uid };
      } else if (e.k === 'wx') {
        const f = on ? Math.min(1, (t - a) / 15 + 0.2) * Math.min(1, (b - t) / 20 + 0.2) : 0; if (f <= 0) continue;
        const cur = fx.wx[e.ap]; if (!cur || e.sev * f > cur.sev * cur.f) fx.wx[e.ap] = { type: e.type, sev: e.sev, f };
      } else if (e.k === 'rwy' && on) {
        (fx.rwy[e.ap] = fx.rwy[e.ap] || {})[e.rwy] = Math.min(a, (fx.rwy[e.ap] || {})[e.rwy] ?? 1e9);
      } else if (e.k === 'cap' && on) { fx.cap[e.ap] = Math.min(fx.cap[e.ap] ?? 1, e.m); }
      else if (e.k === 'taxi' && on) fx.taxi.add(e.id);
      if (on) fx.active.push({ inst, e });
    }
  }
  return fx;
}

const CS_PREFIX = ['DAL', 'UAL', 'AAL', 'JBU', 'SWA', 'ASA', 'NKS', 'FFT', 'DAL', 'AAL', 'UAL', 'JBU'];

class Sim {
  constructor(cfg, opts = {}) {
    this.cfg = cfg || newCfg(); this.seed = opts.seed || 11; this.rng = mulberry32(this.seed);
    this.warm = opts.warm ?? 240; this.t = -this.warm; this.N = opts.tails || 720; this.pJFK = opts.pJFK ?? 0.15;
    this.ids = AIRPORTS.map(a => a.id);
    this.A = {};
    for (const a of AIRPORTS) this.A[a.id] = { id: a.id, ap: a, aar: a.cap, adr: a.cap, arrM: 1, depM: 1, base: 1, arrTok: 1, depTok: 1, q: [], h: [], ev: [], rip: [], peak: 0, nextSlot: 0 };
    // destination weight matrix
    this.W = {};
    for (const o of AIRPORTS) {
      let tot = 0; const row = [];
      for (const d of AIRPORTS) { if (d.id === o.id) continue; const dist = distNm(o, d); if (dist < 150) continue; const g = Math.exp(-(((dist - 950) / 1000) ** 2)) + 0.12; const w = d.w * g; tot += w; row.push([d.id, w]); }
      let c = 0; this.W[o.id] = row.map(([id, w]) => [id, c += w / tot]);
    }
    this.stats = { dep: 0, late: 0, holdLong: 0, div: 0, jfkDepDelay: 0, jfkDepN: 0, jfkHold: 0, jfkHoldN: 0, gdpHeld: 0, gdpMin: 0, gsHeld: 0 };
    this.series = []; this.gev = []; this.incons = []; this.ledger = []; this.jfkOps = []; this.rwyOps = {};
    this.jfk = { cfg: 'SW', closedKnown: new Set(), closedTrue: new Set(), rr: { dep: 0, arr: 0 } };
    this.rwyRR = { dep: 0, arr: 0 }; this.nextUid = 1; this.onset = {};
    this.tails = [];
    for (let i = 0; i < this.N; i++) {
      const o = this.pickW(); const r = this.t + this.rng() * 60;
      this.tails.push({ id: i, cs: this.makeCs(i), o, d: null, st: 'turn', ready: r, sched: r, plan: 0, nextSched: r, qEnter: 0, dep: 0, dur: 0, hold0: 0, tin: 0, lin: false, hop: 9, prop: 0, rwy: '', gdp: null, div: false, flag: 0 });
    }
    this.fx = computeFx(this.cfg, this.t);
    while (this.t < 0) this.step();
  }
  makeCs(i) { const p = CS_PREFIX[Math.floor(this.rng() * CS_PREFIX.length)]; return p + (100 + Math.floor(this.rng() * 2899)); }
  pickW() { let tot = 0; for (const a of AIRPORTS) tot += a.w; let r = this.rng() * tot; for (const a of AIRPORTS) { r -= a.w; if (r <= 0) return a.id; } return 'ATL'; }
  pickDest(o) {
    const r = this.rng();
    if (o !== 'JFK') { if (r < this.pJFK) return 'JFK'; if (r < this.pJFK + 0.05 && o !== 'EWR' && o !== 'LGA' && o !== 'PHL') return 'EWR'; if (r < this.pJFK + 0.09 && o !== 'EWR' && o !== 'LGA' && o !== 'BOS') return 'LGA'; }
    const row = this.W[o], x = this.rng(); for (const [id, c] of row) if (x <= c) return id; return row[row.length - 1][0];
  }
  legMin(o, d) { return Math.max(42, distNm(AP[o], AP[d]) * 60 / 430 + 22) + this.rng() * 5; }
  mit(key, t) { return mitOn(this.cfg, key, t); }

  /* ---- capacity model ---- */
  pen(fac, src, t) {
    const s = this.fx.src[fac + '|' + src]; if (!s) return 0; let p = 1 - IMPACT[src][s.st];
    if ((src === 'VOICE' || src === 'DATALINK') && this.mit('backupComms', t)) p *= 0.5;
    if ((src === 'RADAR' || src === 'ADSB' || src === 'FLIGHTDATA' || src === 'NETWORK') && this.mit('manualProc', t)) p *= 0.55;
    return p;
  }
  facM(fac, t) { let m = 1; for (const s of SRCS) m *= 1 - this.pen(fac, s, t); return m; }
  updateMult(t) {
    const fx = this.fx;
    for (const id of this.ids) {
      const A = this.A[id], a = A.ap; let m = this.facM(id + '_TWR', t);
      if (a.tracon) m *= Math.pow(this.facM(a.tracon, t), 0.7);
      m *= Math.pow(this.facM(a.ctr, t), 0.4);
      const w = fx.wx[id]; if (w) m *= 1 - WX_LOSS[w.type] * w.sev * w.f * (this.mit('rwycfg', t) && id === 'JFK' ? 0.7 : 1);
      if (id === 'JFK' && fx.rwy.JFK) { let loss = 0; for (const r in fx.rwy.JFK) loss += RWY_LOSS[r]; m *= 1 - Math.min(0.65, loss) * (this.mit('rwycfg', t) ? 0.85 : 1); }
      if (fx.cap[id] != null) m *= fx.cap[id];
      A.base = m;
    }
    const j = this.A.JFK.base;
    for (const [id, k] of [['EWR', 0.3], ['LGA', 0.3], ['PHL', 0.1]]) this.A[id].base *= 1 - k * (1 - j);   // metroplex coupling
    for (const id of this.ids) {
      const A = this.A[id]; A.arrM = A.depM = A.base;
      if (id === 'JFK') {
        A.depM *= Math.pow(this.facM('JFK_GND', t), 0.5) * Math.max(0.5, 1 - 0.18 * fx.taxi.size);
        if (this.mit('spacing', t)) { A.arrM *= 0.92; A.depM *= 0.92; }
      }
      A.arrM = clamp(A.arrM, 0.04, 1); A.depM = clamp(A.depM, 0.04, 1);
    }
  }
  /* ---- JFK runway data (for surface view + consistency checks) ---- */
  updateJfkRunways(t) {
    const J = this.jfk, fx = this.fx, cl = fx.rwy.JFK || {};
    J.closedTrue = new Set(Object.keys(cl));
    const worst = Math.max(RANK[(fx.src['JFK_TWR|FLIGHTDATA'] || { st: 'ok' }).st], RANK[(fx.src['JFK_TWR|NETWORK'] || { st: 'ok' }).st], RANK[(fx.src['N90|NETWORK'] || { st: 'ok' }).st], RANK[(fx.src['N90|FLIGHTDATA'] || { st: 'ok' }).st]);
    J.lag = [0, 6, 18][worst];
    J.closedKnown = new Set(Object.keys(cl).filter(r => t >= cl[r] + J.lag));
    let best = J.cfg, bs = 1e9;
    for (const k of Object.keys(CFG_RWY)) { const c = CFG_RWY[k]; const s = [...c.arr, ...c.dep].filter(e => J.closedKnown.has(END2PHYS[e])).length * 10 + (k === J.cfg ? 0 : 1) - (this.mit('rwycfg', t) && k === 'NE' && fx.wx.JFK ? 0.5 : 0); if (s < bs) { bs = s; best = k; } }
    J.cfg = best;
    const open = e => !J.closedKnown.has(END2PHYS[e]);
    J.dep = CFG_RWY[J.cfg].dep.filter(open); J.arr = CFG_RWY[J.cfg].arr.filter(open);
    if (!J.dep.length) J.dep = Object.keys(END2PHYS).filter(e => open(e) && !J.closedTrue.has(END2PHYS[e])).slice(0, 2);
    if (!J.arr.length) J.arr = J.dep.slice();
  }
  noteIncons(t, kind, sev, cs, detail, srcs, unc) { this.incons.push({ t, kind, sev, cs, detail, srcs, unc }); if (this.incons.length > 200) this.incons.shift(); }
  surveillanceQuality(t) { return (1 - this.pen('JFK_TWR', 'RADAR', t)) * (1 - this.pen('JFK_TWR', 'ADSB', t)) * (1 - this.pen('N90', 'RADAR', t)); }
  commsQuality(t) { return (1 - this.pen('JFK_TWR', 'VOICE', t)) * (1 - this.pen('JFK_TWR', 'DATALINK', t)); }

  /* ---- one simulated minute ---- */
  step() {
    const t = this.t, fx = this.fx = computeFx(this.cfg, t);
    for (const k in fx.src) if (this.onset[k] == null) this.onset[k] = t;
    this.updateMult(t); this.updateJfkRunways(t);
    const J = this.jfk;
    for (const id of this.ids) { const A = this.A[id]; A.arrTok = Math.min(A.arrTok + A.aar * A.arrM / 60, 3); A.depTok = Math.min(A.depTok + A.adr * A.depM / 60, 3); }
    // state transitions
    for (const f of this.tails) {
      if (f.st === 'enroute' && t >= f.dep + f.dur) { f.st = 'hold'; f.hold0 = t; this.A[f.d].h.push(f); }
      else if (f.st === 'taxiin' && t >= f.tin) f.st = 'turn';
      if (f.st === 'turn' && t >= f.ready) {
        f.d = this.pickDest(f.o); f.plan = this.legMin(f.o, f.d); f.qEnter = t; f.st = 'queued'; f.gdp = null; f.prop = Math.max(0, t - f.sched); f.flag = 0;
        if (f.prop <= 3) f.lin = false;
        this.A[f.o].q.push(f);
      }
    }
    // arrivals / landings / diversions
    for (const id of this.ids) {
      const A = this.A[id];
      for (const f of A.h.slice()) {
        const w = t - f.hold0, lim = (id === 'JFK' && this.mit('divert', t)) ? 20 : 55;
        if (w > lim) { A.h.splice(A.h.indexOf(f), 1); this.divert(f, A, t); }
      }
      while (A.h.length && A.arrTok >= 1) {
        const f = A.h.shift(); A.arrTok -= 1; const w = t - f.hold0;
        A.ev.push({ t, v: w, k: 'arr' }); if (w > 10) this.stats.holdLong++;
        if (id === 'JFK') { this.stats.jfkHold += w; this.stats.jfkHoldN++; this.jfkOps.push(t); this.assignArr(f, t); if (w >= 8) { f.lin = true; f.hop = 0; } }
        const taxi = id === 'JFK' ? 6 + Math.min(14, 0.18 * A.q.length) + (fx.taxi.size ? 5 : 0) : 5;
        f.st = 'taxiin'; f.tin = t + taxi; f.o = id;
        if (f.div) { f.nextSched = f.tin + 40; f.ready = f.nextSched; f.div = false; f.sched = f.nextSched; f.lin = false; }
        else { f.nextSched = f.sched + f.plan + 45; f.ready = Math.max(f.nextSched, f.tin + 28 + this.rng() * 8); }
        f.sched = f.nextSched; f.d = null;
        if (f.lin) f.hop = Math.min(f.hop + 1, 9);
      }
    }
    // departures
    for (const id of this.ids) {
      const A = this.A[id]; if (!A.q.length) continue;
      const used = new Set(); let relFam = null, keep = [];
      for (const f of A.q) {
        if (A.depTok < 1) { keep.push(f); continue; }
        if (f.d === 'JFK') {
          if (this.mit('gstop', t) && t < mitBase(this.cfg) + this.cfg.mit.gstop.at + (this.cfg.mit.gstop.dur || 40)) { keep.push(f); this.stats.gsHeld++; continue; }
          if (this.mit('gdp', t)) {
            const J2 = this.A.JFK;
            if (f.gdp == null) { const eta = t + f.plan + 8, slot = Math.max(eta, J2.nextSlot, t + f.plan); J2.nextSlot = slot + 60 / (J2.aar * J2.arrM * 0.97); f.gdp = t + Math.min(180, Math.max(0, slot - (t + f.plan))); this.stats.gdpMin += Math.max(0, f.gdp - t); }
            if (t < f.gdp) { keep.push(f); continue; }
          }
        }
        let rw = null;
        if (id === 'JFK') {
          const towOk = !fx.src['JFK_TWR|VOICE'] && !fx.src['JFK_TWR|NETWORK'];
          rw = J.dep[J.rr.dep % J.dep.length]; const fam = FAM[END2PHYS[rw]];
          if (relFam && relFam !== fam) {
            if (towOk) { keep.push(f); continue; }
            this.noteIncons(t, 'conflict', 'warning', f.cs, `Two departures released in the same minute on intersecting runways (${rw} and ${used.values().next().value}).`, ['VOICE', 'NETWORK'], 'Coordination link or voice degraded; cannot confirm which clearance was issued first.');
          }
          relFam = fam; used.add(rw); J.rr.dep++;
          this.checkInstr(f, rw, t, 'DEP');
        }
        A.depTok -= 1; f.st = 'enroute'; f.from = id; f.dep = t; f.dur = f.plan + (this.rng() - 0.4) * 6; f.rwy = rw || '';
        const qw = t - f.qEnter, dd = t - f.sched; A.ev.push({ t, v: dd, k: 'dep', q: qw }); this.gev.push({ t, v: dd }); this.stats.dep++; if (dd > 15) this.stats.late++;
        if (id === 'JFK') { this.stats.jfkDepDelay += dd; this.stats.jfkDepN++; this.jfkOps.push(t); if (qw >= 8) { f.lin = true; f.hop = 0; } }
        else if (f.lin && f.prop > 3) A.rip.push({ t, v: f.prop, hop: f.hop, o: id, d: f.d });
        if (id === 'JFK' && f.lin) A.rip.push({ t, v: f.prop + qw, hop: 0, o: id, d: f.d });
      }
      A.q = keep;
    }
    // observational incidents (off-route) — more likely when surveillance is degraded
    const sq = this.surveillanceQuality(t);
    if (t >= 0 && this.rng() < 0.05 + 0.5 * (1 - sq)) {
      const air = this.tails.filter(f => f.st === 'enroute' && (f.d === 'JFK' || f.o === 'JFK' || f.rwy)); if (air.length) {
        const f = air[Math.floor(this.rng() * air.length)]; f.flag = t;
        this.noteIncons(t, 'offroute', sq < 0.9 ? 'warning' : 'info', f.cs, `Observed track ~${8 + Math.floor(this.rng() * 14)} nm from filed route between ${f.o} and ${f.d}.`, sq < 0.9 ? ['ADSB', 'RADAR'] : ['ADSB'], sq < 0.9 ? 'Position data aged / partial — may be a stale track rather than a real deviation.' : 'Could be a weather deviation approved by a controller; no clearance record to compare.');
      }
    }
    // prune + record
    for (const id of this.ids) { const A = this.A[id]; while (A.ev.length && A.ev[0].t < t - 60) A.ev.shift(); while (A.rip.length && A.rip[0].t < t - 120) A.rip.shift(); A.delay60 = A.ev.length ? A.ev.reduce((s, e) => s + e.v, 0) / A.ev.length : 0; if (t >= 0) A.peak = Math.max(A.peak, A.delay60); }
    while (this.gev.length && this.gev[0].t < t - 60) this.gev.shift();
    while (this.jfkOps.length && this.jfkOps[0] < t - 60) this.jfkOps.shift();
    for (const r in this.rwyOps) while (this.rwyOps[r].length && this.rwyOps[r][0] < t - 60) this.rwyOps[r].shift();
    if (t >= 0) this.record(t);
    this.t++;
  }
  divert(f, A, t) {
    let best = null, bs = -1;
    const cand = A.id === 'JFK' ? ['EWR', 'PHL', 'BOS', 'BWI', 'LGA'] : this.ids.filter(i => i !== A.id).sort((a, b) => distNm(AP[A.id], AP[a]) - distNm(AP[A.id], AP[b])).slice(0, 4);
    for (const c of cand) { const B = this.A[c], s = B.arrM / (1 + B.h.length / 8); if (s > bs) { bs = s; best = c; } }
    f.from = A.id; f.d = best; f.st = 'enroute'; f.dep = t; f.dur = 12 + this.rng() * 8; f.div = true; f.hop = f.lin ? 1 : 9; this.stats.div++;
    this.noteIncons(t, 'divert', 'info', f.cs, `${f.cs} diverted from ${A.id} to ${best} after ${Math.round(t - f.hold0)} min holding.`, ['FLIGHTDATA'], 'Estimated alternate chosen by modeled headroom; fuel state not modeled.');
  }
  assignArr(f, t) {
    const J = this.jfk, rw = J.arr[J.rr.arr++ % J.arr.length]; f.rwy = rw;
    (this.rwyOps[END2PHYS[rw]] = this.rwyOps[END2PHYS[rw]] || []).push(t);
    this.ledgerAdd(t, f, 'ARR', rw, rw, J.closedTrue.has(END2PHYS[rw]));
  }
  checkInstr(f, rw, t, type) {
    const J = this.jfk, phys = END2PHYS[rw];
    (this.rwyOps[phys] = this.rwyOps[phys] || []).push(t);
    let obs = rw, bad = false;
    const sq = this.surveillanceQuality(t), cq = this.commsQuality(t);
    if (J.closedTrue.has(phys)) { // stale runway-status data: instruction on a runway that is actually closed
      bad = true; this.noteIncons(t, 'closed', 'critical', f.cs, `Instruction assigns ${f.cs} to runway ${rw}, which the simulated NOTAM shows as closed.`, ['FLIGHTDATA', 'NETWORK'], `Runway-status feed lag is ~${J.lag} min; the closure may not have reached all positions yet.`);
    } else if (this.rng() < 0.01 + 0.25 * (1 - cq)) {
      const other = J.dep.find(r => r !== rw) || rw; obs = other;
      if (other !== rw) { bad = true; this.noteIncons(t, 'mismatch', 'warning', f.cs, `Instructed runway ${rw} but observed lining up on ${other}.`, ['VOICE', 'RADAR'], 'Read-back not confirmed on degraded voice; surface surveillance may be misattributing the track.'); }
    }
    this.ledgerAdd(t, f, type, rw, sq < 0.7 && !bad ? '— (unverified)' : obs, bad);
  }
  ledgerAdd(t, f, type, instr, obs, bad) { this.ledger.push({ t, cs: f.cs, type, instr, obs, bad, d: f.d, o: f.o }); if (this.ledger.length > 60) this.ledger.shift(); }

  record(t) {
    const J = this.A.JFK, h = J.h.length, q = J.q.length;
    const net = this.gev.length ? this.gev.reduce((s, e) => s + e.v, 0) / this.gev.length : 0;
    const cs = this.commsQuality(t) * this.surveillanceQuality(t);
    const wxs = this.fx.wx.JFK ? this.fx.wx.JFK.sev * this.fx.wx.JFK.f : 0;
    let risk = 100 * (0.40 * (1 - cs) + 0.25 * clamp(q / 40, 0, 1) + 0.22 * clamp(h / 10, 0, 1) + 0.13 * wxs);
    if (this.mit('spacing', t)) risk *= 0.75; if (this.mit('backupComms', t)) risk *= 0.9;
    this.risk = clamp(risk, 0, 100);
    this.series.push({ t, q, h, thr: this.jfkOps.length, net, risk: this.risk, cap: Math.round(J.aar * J.arrM) });
  }
  /* ---- derived values used by UI ---- */
  jfkQueueWait() { const J = this.A.JFK; return J.q.length / Math.max(1, J.adr * J.depM / 60); }
  ripple() {
    const out = {};
    for (const id of this.ids) { if (id === 'JFK') continue; const A = this.A[id]; if (!A.rip.length) continue; out[id] = { sum: A.rip.reduce((x, e) => x + e.v, 0), n: A.rip.length, hop: Math.min(...A.rip.map(e => e.hop)), inb: 0 }; }
    // aircraft already late and still en route will deliver the delay downstream
    for (const f of this.tails) if (f.lin && f.st === 'enroute' && f.d !== 'JFK' && f.hop <= 3) {
      const late = f.dep + f.dur - (f.sched + f.plan); if (late < 8) continue;
      const o = out[f.d] || (out[f.d] = { sum: 0, n: 0, hop: f.hop + 1, inb: 0 }); o.sum += late * 0.6; o.inb++; o.hop = Math.min(o.hop, f.hop + 1);
    }
    return out;
  }
  result() {
    const S = this.series, sc = this.cfg.stack; const a = sc.length ? Math.min(...sc.map(s => s.start)) : 0, b = sc.length ? Math.max(...sc.map(s => s.start + s.dur)) : 0;
    const win = S.filter(s => s.t >= a && s.t <= b + 60), W = win.length ? win : S;
    const mean = (arr, k) => arr.length ? arr.reduce((x, e) => x + e[k], 0) / arr.length : 0;
    let rec = null; if (sc.length) { for (const s of S) if (s.t >= b && s.q <= 6 && s.h <= 2) { rec = s.t - b; break; } }
    const impacted = AIRPORTS.filter(x => x.id !== 'JFK' && this.A[x.id].peak > 15).length;
    const st = this.stats;
    return {
      avgJfkDep: st.jfkDepN ? st.jfkDepDelay / st.jfkDepN : 0, avgJfkHold: st.jfkHoldN ? st.jfkHold / st.jfkHoldN : 0, avgNet: mean(W, 'net'),
      peakQ: Math.max(...S.map(s => s.q)), peakH: Math.max(...S.map(s => s.h)), thr: mean(W, 'thr'), peakRisk: Math.max(...S.map(s => s.risk)),
      late: st.late, diverted: st.div, impacted, recovery: rec, dep: st.dep, groundMin: Math.round(st.gdpMin), longHolds: st.holdLong, windowStart: a, windowEnd: b,
    };
  }
}
function runHeadless(cfg, horizon = 360, seed = 11) {
  const s = new Sim(cfg, { seed }); while (s.t < horizon) s.step();
  return { result: s.result(), series: s.series };
}
if (typeof module !== 'undefined') module.exports = { Sim, runHeadless, newCfg, computeFx };
