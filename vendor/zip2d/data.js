'use strict';
/* ============================================================
   AIRSPACE — data layer
   Data classes used throughout the UI:
   PUBLIC     airport locations, runway designators, facility names
   SYNTHETIC  generated traffic, schedules, rotations
   ESTIMATED  queue/ETA/capacity predictions derived from the model
   SIMULATED  anything produced by a scenario (failures, weather)
   ============================================================ */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const COSLAT = Math.cos(38 * Math.PI / 180);
const lon2x = lon => (lon + 125) * COSLAT;
const lat2y = lat => 50 - lat;

// id, name, lon, lat, modeled hourly rate (each of arr/dep), traffic weight, ARTCC, TRACON
const AIRPORTS = [
  ['JFK', 'John F. Kennedy Intl', -73.78, 40.64, 44, 3, 'ZNY', 'N90'],
  ['LGA', 'LaGuardia', -73.87, 40.78, 40, 2, 'ZNY', 'N90'],
  ['EWR', 'Newark Liberty', -74.17, 40.69, 45, 2.5, 'ZNY', 'N90'],
  ['PHL', 'Philadelphia', -75.24, 39.87, 50, 2.2, 'ZNY', null],
  ['BOS', 'Boston Logan', -71.01, 42.36, 50, 2.7, 'ZBW', null],
  ['DCA', 'Reagan National', -77.04, 38.85, 35, 1.8, 'ZDC', null],
  ['IAD', 'Washington Dulles', -77.46, 38.95, 50, 1.8, 'ZDC', null],
  ['BWI', 'Baltimore/Washington', -76.67, 39.18, 40, 1.5, 'ZDC', null],
  ['PIT', 'Pittsburgh', -80.23, 40.49, 30, 1, 'ZOB', null],
  ['CLE', 'Cleveland Hopkins', -81.85, 41.41, 35, 1, 'ZOB', null],
  ['DTW', 'Detroit Metro', -83.35, 42.21, 60, 2.7, 'ZOB', null],
  ['ORD', "Chicago O'Hare", -87.90, 41.98, 100, 5, 'ZAU', null],
  ['MSP', 'Minneapolis–St Paul', -93.22, 44.88, 60, 2.7, 'ZMP', null],
  ['STL', 'St. Louis Lambert', -90.37, 38.75, 35, 1.2, 'ZKC', null],
  ['MCI', 'Kansas City Intl', -94.71, 39.30, 35, 1, 'ZKC', null],
  ['BNA', 'Nashville Intl', -86.68, 36.12, 40, 1.6, 'ZME', null],
  ['ATL', 'Atlanta Hartsfield-Jackson', -84.43, 33.64, 110, 6, 'ZTL', null],
  ['CLT', 'Charlotte Douglas', -80.94, 35.21, 70, 3.5, 'ZTL', null],
  ['MIA', 'Miami Intl', -80.29, 25.79, 55, 3, 'ZMA', null],
  ['MCO', 'Orlando Intl', -81.31, 28.43, 55, 3, 'ZJX', null],
  ['DFW', 'Dallas/Fort Worth', -97.04, 32.90, 100, 5, 'ZFW', null],
  ['IAH', 'Houston Intercontinental', -95.34, 29.98, 70, 3.3, 'ZHU', null],
  ['DEN', 'Denver Intl', -104.67, 39.86, 90, 4, 'ZDV', null],
  ['SLC', 'Salt Lake City', -111.98, 40.79, 55, 2, 'ZLC', null],
  ['PHX', 'Phoenix Sky Harbor', -112.01, 33.43, 60, 3, 'ZAB', null],
  ['LAS', 'Las Vegas Harry Reid', -115.15, 36.08, 60, 3, 'ZLA', null],
  ['LAX', 'Los Angeles Intl', -118.41, 33.94, 80, 4.5, 'ZLA', null],
  ['SFO', 'San Francisco Intl', -122.38, 37.62, 50, 3, 'ZOA', null],
  ['SEA', 'Seattle–Tacoma', -122.31, 47.45, 50, 3, 'ZSE', null],
  ['PDX', 'Portland Intl', -122.60, 45.59, 35, 1.3, 'ZSE', null],
].map(a => ({ id: a[0], name: a[1], lon: a[2], lat: a[3], cap: a[4], w: a[5], ctr: a[6], tracon: a[7], x: lon2x(a[2]), y: lat2y(a[3]) }));
const AP = Object.fromEntries(AIRPORTS.map(a => [a.id, a]));

const CENTERS = [
  ['ZBW', 'Boston Center', -71.5, 42.8], ['ZNY', 'New York Center', -74.5, 41.0], ['ZDC', 'Washington Center', -77.5, 38.8],
  ['ZOB', 'Cleveland Center', -81.5, 41.2], ['ZTL', 'Atlanta Center', -84.2, 33.5], ['ZMA', 'Miami Center', -80.8, 26.5],
  ['ZJX', 'Jacksonville Center', -82.0, 30.5], ['ZID', 'Indianapolis Center', -86.0, 39.5], ['ZAU', 'Chicago Center', -88.5, 41.8],
  ['ZMP', 'Minneapolis Center', -94.0, 45.0], ['ZKC', 'Kansas City Center', -94.5, 38.5], ['ZME', 'Memphis Center', -89.8, 35.0],
  ['ZFW', 'Fort Worth Center', -97.0, 32.8], ['ZHU', 'Houston Center', -95.3, 30.2], ['ZDV', 'Denver Center', -105.0, 39.8],
  ['ZLC', 'Salt Lake Center', -112.0, 40.8], ['ZAB', 'Albuquerque Center', -106.5, 34.8], ['ZLA', 'Los Angeles Center', -117.5, 34.5],
  ['ZOA', 'Oakland Center', -121.5, 38.0], ['ZSE', 'Seattle Center', -121.5, 47.0],
].map(c => ({ id: c[0], name: c[1], lon: c[2], lat: c[3], x: lon2x(c[2]), y: lat2y(c[3]) }));
const CTR = Object.fromEntries(CENTERS.map(c => [c.id, c]));

// Facilities: every airport tower, JFK ground/ramp, N90 TRACON, every ARTCC
const FACILITIES = [
  ...AIRPORTS.map(a => ({ id: a.id + '_TWR', name: a.id + ' Tower', kind: 'tower', ap: a.id })),
  { id: 'JFK_GND', name: 'JFK Ground / Ramp', kind: 'ground', ap: 'JFK' },
  { id: 'N90', name: 'New York TRACON (N90)', kind: 'tracon', ap: 'JFK' },
  ...CENTERS.map(c => ({ id: c.id, name: c.name, kind: 'center' })),
];
const FAC = Object.fromEntries(FACILITIES.map(f => [f.id, f]));

const SRCS = ['VOICE', 'DATALINK', 'RADAR', 'ADSB', 'FLIGHTDATA', 'WX', 'NETWORK', 'POWER'];
const SRC_LABEL = { VOICE: 'Voice radio', DATALINK: 'Datalink (CPDLC)', RADAR: 'Radar', ADSB: 'ADS-B', FLIGHTDATA: 'Flight plan data', WX: 'Weather data', NETWORK: 'Inter-facility link', POWER: 'Facility power' };
const SRC_SHORT = { VOICE: 'VOICE', DATALINK: 'CPDLC', RADAR: 'RADAR', ADSB: 'ADS-B', FLIGHTDATA: 'FLT DATA', WX: 'WX', NETWORK: 'LINK', POWER: 'POWER' };
// modeled capacity multiplier when a source is degraded / lost at a facility
const IMPACT = {
  VOICE: { degraded: 0.75, lost: 0.35 }, DATALINK: { degraded: 0.95, lost: 0.85 }, RADAR: { degraded: 0.85, lost: 0.6 },
  ADSB: { degraded: 0.95, lost: 0.85 }, FLIGHTDATA: { degraded: 0.9, lost: 0.75 }, WX: { degraded: 0.95, lost: 0.85 },
  NETWORK: { degraded: 0.9, lost: 0.65 }, POWER: { degraded: 0.8, lost: 0.2 },
};
const WX_LOSS = { 'Thunderstorms': 0.6, "Nor'easter": 0.65, 'Low visibility / fog': 0.45, 'Snow / ice': 0.5, 'High crosswind': 0.4 };

const RWY = ['4L/22R', '4R/22L', '13L/31R', '13R/31L'];
const RWY_LOSS = { '4L/22R': 0.3, '4R/22L': 0.2, '13L/31R': 0.2, '13R/31L': 0.32 };
const FAM = { '4L/22R': 'NE', '4R/22L': 'NE', '13L/31R': 'NW', '13R/31L': 'NW' };
const END2PHYS = { '4L': '4L/22R', '22R': '4L/22R', '4R': '4R/22L', '22L': '4R/22L', '13L': '13L/31R', '31R': '13L/31R', '13R': '13R/31L', '31L': '13R/31L' };
const CFG_RWY = {
  SW: { name: '22 / 31 flow', arr: ['22L', '31R'], dep: ['22R', '31L'] },
  NE: { name: '4 / 13 flow', arr: ['4L', '13L'], dep: ['4R', '13R'] },
};

const FAC_GROUPS = {
  'JFK facilities': ['JFK_TWR', 'JFK_GND', 'N90'],
  'NY metro': ['JFK_TWR', 'JFK_GND', 'N90', 'ZNY', 'LGA_TWR', 'EWR_TWR'],
  'Northeast': ['JFK_TWR', 'JFK_GND', 'N90', 'ZNY', 'LGA_TWR', 'EWR_TWR', 'ZBW', 'ZDC', 'BOS_TWR', 'PHL_TWR', 'DCA_TWR', 'BWI_TWR', 'IAD_TWR'],
  'Nationwide': FACILITIES.map(f => f.id),
};
const WX_SCOPE = {
  'JFK only': { JFK: 1 },
  'NY metro': { JFK: 1, LGA: 0.95, EWR: 0.9, PHL: 0.5 },
  'Northeast': { JFK: 1, LGA: 0.95, EWR: 0.9, PHL: 0.8, BOS: 0.8, BWI: 0.6, DCA: 0.6, IAD: 0.5, PIT: 0.3 },
};

// US outline (simplified, lon/lat) — drawn as schematic base map
const US_POLY = [[-124.7, 48.4], [-123.0, 48.3], [-122.8, 49.0], [-95.2, 49.0], [-94.6, 48.7], [-93.0, 48.6], [-91.5, 48.1], [-89.6, 48.0], [-92.0, 46.7], [-90.4, 46.6], [-88.0, 47.4], [-87.5, 46.5], [-84.4, 46.5], [-83.5, 45.3], [-83.9, 43.9], [-82.5, 43.0], [-83.1, 42.3], [-83.5, 41.7], [-82.7, 41.5], [-81.7, 41.5], [-80.5, 42.0], [-79.0, 42.7], [-79.0, 43.3], [-77.5, 43.3], [-76.2, 43.6], [-76.3, 44.1], [-75.0, 45.0], [-71.5, 45.0], [-71.0, 45.3], [-70.3, 46.0], [-70.0, 46.7], [-69.2, 47.45], [-68.2, 47.35], [-67.8, 47.05], [-67.8, 45.7], [-67.4, 45.2], [-67.0, 44.8], [-68.5, 44.3], [-70.2, 43.6], [-70.7, 43.0], [-70.8, 42.6], [-70.6, 41.8], [-70.0, 41.7], [-70.6, 41.5], [-71.4, 41.4], [-72.9, 41.25], [-73.7, 40.9], [-72.0, 41.1], [-71.9, 40.98], [-73.9, 40.55], [-74.0, 40.4], [-74.1, 39.7], [-74.9, 38.9], [-75.1, 38.4], [-75.2, 38.0], [-75.9, 37.1], [-76.0, 36.9], [-75.5, 35.3], [-76.5, 34.7], [-77.9, 33.9], [-79.2, 33.2], [-80.9, 32.0], [-81.4, 30.7], [-81.3, 29.8], [-80.5, 28.4], [-80.0, 26.8], [-80.1, 25.8], [-80.4, 25.2], [-81.1, 25.15], [-81.8, 26.1], [-82.7, 27.7], [-82.8, 29.0], [-83.7, 29.9], [-84.3, 30.0], [-85.3, 29.7], [-86.5, 30.4], [-88.0, 30.3], [-89.4, 30.2], [-89.2, 29.0], [-90.3, 29.1], [-91.8, 29.5], [-93.8, 29.7], [-94.8, 29.3], [-96.5, 28.3], [-97.2, 27.6], [-97.4, 26.0], [-99.1, 26.4], [-99.5, 27.5], [-100.6, 29.1], [-101.4, 29.8], [-102.4, 29.8], [-103.2, 29.0], [-104.5, 29.7], [-104.9, 30.6], [-106.5, 31.75], [-108.2, 31.78], [-108.2, 31.33], [-111.1, 31.33], [-114.8, 32.5], [-117.1, 32.5], [-117.3, 33.1], [-118.4, 33.75], [-119.2, 34.1], [-120.6, 34.5], [-121.9, 36.6], [-122.5, 37.5], [-123.0, 38.0], [-123.8, 39.4], [-124.4, 40.4], [-124.2, 41.8], [-124.5, 42.8], [-124.1, 44.0], [-124.0, 46.2]];

function pointInPoly(lon, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// ARTCC "sector" regions: nearest-centre cells clipped to the US outline (schematic)
const SECTOR_CELLS = (() => {
  const step = 0.5, cells = [], grid = {};
  for (let lon = -125; lon < -66; lon += step) for (let lat = 24; lat < 50; lat += step) {
    const cx = lon + step / 2, cy = lat + step / 2;
    if (!pointInPoly(cx, cy, US_POLY)) continue;
    let best = null, bd = 1e9;
    for (const c of CENTERS) { const d = ((cx - c.lon) * COSLAT) ** 2 + (cy - c.lat) ** 2; if (d < bd) { bd = d; best = c.id; } }
    const cell = { x: lon2x(lon), y: lat2y(lat + step), w: step * COSLAT, h: step, c: best, gx: Math.round((lon + 125) / step), gy: Math.round((lat - 24) / step) };
    cells.push(cell); grid[cell.gx + ',' + cell.gy] = cell;
  }
  const edges = [];
  for (const c of cells) {
    const r = grid[(c.gx + 1) + ',' + c.gy], u = grid[c.gx + ',' + (c.gy + 1)];
    if (!r || r.c !== c.c) edges.push([c.x + c.w, c.y, c.x + c.w, c.y + c.h]);
    if (!u || u.c !== c.c) edges.push([c.x, c.y, c.x + c.w, c.y]);
  }
  return { cells, edges };
})();

/* ============================================================
   SCENARIO LIBRARY — data driven.
   To add a scenario once the team decides: call reg({...}) with
   params (UI is generated from them) and events(p, dur) which
   returns effect events:
     {k:'src',  fac, src, st:'degraded'|'lost', at?, len?}
     {k:'wx',   ap, sev(0..1), type}
     {k:'rwy',  ap:'JFK', rwy:'4L/22R'}
     {k:'cap',  ap, m}            capacity multiplier
     {k:'taxi', id}               surface bottleneck
   Users can also build scenarios in the UI (custom) and import/
   export them as JSON.
   ============================================================ */
const SCEN = {};
function reg(s) { SCEN[s.id] = s; return s; }
const sel = (key, label, options, def) => ({ key, label, type: 'select', options, def: def ?? options[0] });
const rng = (key, label, min, max, step, def) => ({ key, label, type: 'range', min, max, step, def });

reg({
  id: 'comms_tower', name: 'Tower communications loss', cat: 'Communications', start: 30, dur: 60, restore: 20,
  blurb: 'JFK tower loses voice and/or datalink with aircraft. Staff must rely on backup means and adjacent facilities.',
  params: [sel('mode', 'What is lost', ['Voice only', 'Voice + datalink', 'Voice + datalink + radar display']), sel('sev', 'Severity', ['Total loss', 'Degraded (intermittent)'])],
  events: p => { const st = p.sev.startsWith('Deg') ? 'degraded' : 'lost'; const e = [{ k: 'src', fac: 'JFK_TWR', src: 'VOICE', st }]; if (/datalink/.test(p.mode)) e.push({ k: 'src', fac: 'JFK_TWR', src: 'DATALINK', st }); if (/radar/.test(p.mode)) e.push({ k: 'src', fac: 'JFK_TWR', src: 'RADAR', st: 'degraded' }); return e; },
});
reg({
  id: 'comms_collapse', name: 'Regional / total comms collapse', cat: 'Communications', start: 30, dur: 90, restore: 30,
  blurb: 'Worst case: communications fail across a whole region up to the entire ATC network.',
  params: [sel('extent', 'Extent', ['JFK facilities', 'NY metro', 'Northeast', 'Nationwide'], 'NY metro'), sel('layers', 'What fails', ['Voice + datalink', 'Voice + datalink + coordination links', 'All comms + surveillance + flight data (worst case)'])],
  events: p => {
    const e = [], L = p.layers;
    for (const f of FAC_GROUPS[p.extent]) {
      e.push({ k: 'src', fac: f, src: 'VOICE', st: 'lost' }, { k: 'src', fac: f, src: 'DATALINK', st: 'lost' });
      if (/coordination|worst/.test(L)) e.push({ k: 'src', fac: f, src: 'NETWORK', st: 'lost' });
      if (/worst/.test(L)) e.push({ k: 'src', fac: f, src: 'RADAR', st: 'degraded' }, { k: 'src', fac: f, src: 'ADSB', st: 'lost' }, { k: 'src', fac: f, src: 'FLIGHTDATA', st: 'lost' });
    } return e;
  },
});
reg({
  id: 'weather', name: 'Severe weather', cat: 'Weather', start: 30, dur: 120, restore: 0,
  blurb: 'Weather reduces runway/airspace capacity and may drive a runway configuration change.',
  params: [sel('type', 'Type', Object.keys(WX_LOSS)), rng('sev', 'Severity', 0.2, 1, 0.05, 0.7), sel('scope', 'Area', Object.keys(WX_SCOPE), 'NY metro')],
  events: p => Object.entries(WX_SCOPE[p.scope]).map(([ap, w]) => ({ k: 'wx', ap, sev: clamp(p.sev * w, 0, 1), type: p.type })),
});
reg({
  id: 'runway', name: 'Runway closure', cat: 'Airport surface', start: 20, dur: 120, restore: 0,
  blurb: 'One or two JFK runways close (disabled aircraft, FOD, maintenance).',
  params: [sel('r1', 'Runway', RWY, '13R/31L'), sel('r2', 'Second runway', ['None', ...RWY])],
  events: p => { const e = [{ k: 'rwy', ap: 'JFK', rwy: p.r1 }]; if (p.r2 !== 'None' && p.r2 !== p.r1) e.push({ k: 'rwy', ap: 'JFK', rwy: p.r2 }); return e; },
});
reg({
  id: 'feed', name: 'Data-feed outage', cat: 'Data', start: 30, dur: 75, restore: 15,
  blurb: 'A surveillance, flight-plan, weather or coordination data source goes stale or disappears.',
  params: [sel('feed', 'Feed', ['ADS-B', 'Radar', 'Flight plan data', 'Weather data', 'Inter-facility link'], 'Inter-facility link'), sel('scope', 'Scope', ['JFK facilities', 'NY metro', 'Nationwide'], 'NY metro'), sel('sev', 'Severity', ['Total loss', 'Degraded (stale / partial)'])],
  events: p => { const src = { 'ADS-B': 'ADSB', 'Radar': 'RADAR', 'Flight plan data': 'FLIGHTDATA', 'Weather data': 'WX', 'Inter-facility link': 'NETWORK' }[p.feed]; const st = p.sev.startsWith('Deg') ? 'degraded' : 'lost'; return FAC_GROUPS[p.scope].map(f => ({ k: 'src', fac: f, src, st })); },
});
reg({
  id: 'power', name: 'Power failure cascade', cat: 'Infrastructure', start: 20, dur: 100, restore: 30,
  blurb: 'Facility power degrades, then communications, surveillance and coordination fail in stages.',
  params: [sel('depth', 'How far it cascades', ['Tower only', 'Tower + TRACON', 'Tower + TRACON + Center'], 'Tower + TRACON')],
  events: (p, d) => {
    const a = f => Math.round(f * d), e = [
      { k: 'src', fac: 'JFK_TWR', src: 'POWER', st: 'degraded', at: 0 },
      { k: 'src', fac: 'JFK_TWR', src: 'VOICE', st: 'degraded', at: a(0.25) }, { k: 'src', fac: 'JFK_TWR', src: 'DATALINK', st: 'degraded', at: a(0.25) },
      { k: 'src', fac: 'JFK_TWR', src: 'POWER', st: 'lost', at: a(0.5) }, { k: 'src', fac: 'JFK_TWR', src: 'RADAR', st: 'lost', at: a(0.5) }, { k: 'src', fac: 'JFK_GND', src: 'POWER', st: 'lost', at: a(0.5) },
    ];
    if (/TRACON/.test(p.depth)) e.push({ k: 'src', fac: 'N90', src: 'NETWORK', st: 'lost', at: a(0.3) }, { k: 'src', fac: 'N90', src: 'FLIGHTDATA', st: 'degraded', at: a(0.4) }, { k: 'src', fac: 'N90', src: 'RADAR', st: 'degraded', at: a(0.6) });
    if (/Center/.test(p.depth)) e.push({ k: 'src', fac: 'ZNY', src: 'NETWORK', st: 'degraded', at: a(0.55) }, { k: 'src', fac: 'ZNY', src: 'FLIGHTDATA', st: 'degraded', at: a(0.6) }, { k: 'src', fac: 'ZNY', src: 'VOICE', st: 'degraded', at: a(0.7) });
    return e;
  },
});
reg({
  id: 'surface', name: 'Surface incident / taxiway blockage', cat: 'Airport surface', start: 25, dur: 45, restore: 0,
  blurb: 'A blocked taxiway or runway crossing slows departures and arrival taxi-in. Not announced in alerts (tests consistency checks).',
  params: [sel('loc', 'Location', ['Taxiway B (north loop)', 'Taxiway K (south)', 'Runway 22R/4L crossing', 'Terminal 4 ramp']), rng('sev', 'Severity', 0.2, 1, 0.05, 0.6)],
  events: p => [{ k: 'taxi', id: p.loc }, { k: 'cap', ap: 'JFK', m: 1 - 0.6 * p.sev }],
});

const MITS = [
  { key: 'gdp', name: 'Ground delay program', desc: 'Hold JFK-bound flights at their origin to match modeled arrival slots (trades airborne holding for ground delay).' },
  { key: 'gstop', name: 'Ground stop (JFK-bound)', desc: 'Stop JFK-bound departures for a set time, then release.', extra: { dur: 40 } },
  { key: 'divert', name: 'Divert long holds', desc: 'Aircraft holding more than 20 min are advised to divert to the best alternate.' },
  { key: 'rwycfg', name: 'Runway configuration change', desc: 'Switch to the best available runway configuration; recovers part of the weather / closure loss.' },
  { key: 'backupComms', name: 'Activate backup communications', desc: 'Contingency radios / alternate frequencies per facility procedure; softens voice and datalink loss.' },
  { key: 'manualProc', name: 'Manual coordination procedures', desc: 'Paper strips and phone coordination; softens flight-data, surveillance and link loss.' },
  { key: 'spacing', name: 'Increase spacing', desc: 'Wider spacing lowers risk but cuts throughput ~8%.' },
];
