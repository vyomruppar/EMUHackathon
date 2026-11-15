/* Same-origin bridge for parent map focus. Traffic and scenario playback stay in
   the original ZIP simulation engine, preserving its full synthetic network. */
addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === 'airspace-zip-scenario-proposal') {
    const { requestId, proposal } = event.data;
    const rejectProposal = () => parent.postMessage({ type: 'airspace-zip-proposal-result', requestId, status: 'error' }, location.origin);
    if (new URLSearchParams(location.search).get('mode') !== 'simulation' || S.view !== 'lab'
      || typeof requestId !== 'string' || requestId.length > 100 || !proposal || typeof proposal !== 'object') {
      rejectProposal(); return;
    }
    if (S.aiProposalRequests.has(requestId)) {
      parent.postMessage({ type: 'airspace-zip-proposal-result', requestId, status: 'loaded' }, location.origin);
      return;
    }
    const locationId = String(proposal.locationId || '').toUpperCase();
    const eventType = String(proposal.eventType || '');
    const duration = Math.round(Number(proposal.durationMinutes));
    const aircraftCount = Math.round(Number(proposal.syntheticAircraftCount));
    if (!AP[locationId] || !['runway_closure', 'weather_delay', 'traffic_surge', 'generic_disruption'].includes(eventType)
      || !Number.isInteger(duration) || duration < 5 || duration > 240
      || !Number.isInteger(aircraftCount) || aircraftCount < 1 || aircraftCount > 40) {
      rejectProposal(); return;
    }
    const start = Math.max(0, Math.min(HORIZON - duration, Math.floor(Number(proposal.startMinute) || 0)));
    const description = String(proposal.description || 'AI-prepared hypothetical scenario.').slice(0, 220);
    let staticEvents, modelNote;
    if (eventType === 'runway_closure' && locationId === FOC) {
      const runway = RWY.includes('13R/31L') ? '13R/31L' : RWY[0];
      staticEvents = [{ k: 'rwy', ap: FOC, rwy: runway }];
      modelNote = `Assumption: runway ${runway} is used as the closure example.`;
    } else if (eventType === 'weather_delay') {
      staticEvents = [{ k: 'wx', ap: locationId, type: 'Thunderstorms', sev: 0.65 }];
      modelNote = 'Weather impact is represented by the model’s synthetic thunderstorm capacity effect.';
    } else if (eventType === 'traffic_surge') {
      staticEvents = [{ k: 'cap', ap: locationId, m: 0.82 }];
      modelNote = 'The ZIP model keeps a fixed traffic volume, so a traffic surge is approximated as an 18% airport capacity stress; it does not add aircraft.';
    } else if (eventType === 'runway_closure') {
      staticEvents = [{ k: 'cap', ap: locationId, m: 0.7 }];
      modelNote = `The model has runway-specific closure effects only for the focus airport (${FOC}); this other-airport closure is approximated as a 30% capacity reduction.`;
    } else {
      staticEvents = [{ k: 'cap', ap: locationId, m: 0.65 }];
      modelNote = 'Generic disruption is represented as a 35% airport capacity reduction.';
    }
    const scenarioId = `ai_${Date.now()}_${S.uid++}`;
    const scenarioName = `AI proposal · ${locationId} ${eventType.replaceAll('_', ' ')}`;
    reg({
      id: scenarioId, name: scenarioName, cat: 'AI proposal', start, dur: duration, restore: 0,
      blurb: `${description} Assistant request: ${aircraftCount} synthetic-aircraft focus. This model applies effects to its full fixed synthetic network. ${modelNote}`,
      params: [], staticEvents, custom: true,
    });
    S.cfg.stack.push(mkInst(scenarioId, { start, dur: duration, restore: 0 }));
    S.aiProposalRequests.add(requestId);
    renderLab();
    parent.postMessage({ type: 'airspace-zip-proposal-result', requestId, status: 'loaded' }, location.origin);
    return;
  }
  if (event.data?.type === 'airspace-zip-view' && ['net', 'sfc', 'lab', 'deg', 'alr'].includes(event.data.view)) {
    setView(event.data.view);
    return;
  }
  if (event.data?.type === 'airspace-zip-set-focus') {
    if (['JFK', 'LGA', 'EWR'].includes(event.data.id)) setFocus(event.data.id);
    else tellParent({ type: 'airspace-zip-focus-changed', id: FOC });
    return;
  }
  if (event.data?.type === 'airspace-zip-reset') {
    resetToStart();
    return;
  }
  if (event.data?.type === 'airspace-zip-guide') {
    $('#guide').click();
    return;
  }
  if (event.data?.type === 'airspace-zip-preview-zoom') {
    if (PREVIEW_MODE && Number.isFinite(event.data.factor) && event.data.factor >= 0.5 && event.data.factor <= 2) zoomBy(event.data.factor);
    return;
  }
  if (event.data?.type === 'airspace-zip-select') {
    const hit = LASTHIT.find(item => `zip2d-${item.f.id}` === event.data.id);
    if (hit) { setView('net'); S.pick = hit.f; refreshPanels(true); }
    return;
  }
  if (event.data?.type === 'airspace-zip-focus-aircraft') {
    const hit = LASTHIT.find(item => `zip2d-${item.f.id}` === event.data.id);
    if (hit) { setView('net'); S.pick = hit.f; cam.x = hit.p[0]; cam.y = hit.p[1]; cam.s = Math.max(cam.s, 45); refreshPanels(true); }
    return;
  }
  if (event.data?.type !== 'airspace-zip-focus') return;
  const id = String(event.data.id || '');
  if (AP[id]) {
    S.sel = id;
    focusAp(id);
    refreshPanels(true);
  } else if (Number.isFinite(event.data.longitude) && Number.isFinite(event.data.latitude)) {
    cam.x = lon2x(event.data.longitude);
    cam.y = lat2y(event.data.latitude);
    cam.s = Math.max(cam.s, 40);
  }
});

if (new URLSearchParams(location.search).get('mode') === 'demo') {
  document.body.classList.add('portal-demo');
  $('#scenChip').textContent = 'SYNTHETIC TRAFFIC DEMO';
}

/* Publish a bounded, synthetic-only snapshot to the same-origin portal AI. */
const zipMode = new URLSearchParams(location.search).get('mode');
if (zipMode === 'demo' || zipMode === 'simulation') {
  const rad = Math.PI / 180;
  const fromWorld = ([x, y]) => ({ latitude: 50 - y, longitude: x / COSLAT - 125 });
  const trackBetween = (a, b) => {
    const lat1 = a.lat * rad, lat2 = b.lat * rad, dLon = (b.lon - a.lon) * rad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) / rad + 360) % 360;
  };
  const makeSnapshot = () => {
    const sim = S.sim;
    if (!sim || !Array.isArray(LASTHIT)) return;
    const aircraft = LASTHIT.slice(0, 60).map(hit => {
      const f = hit.f, point = fromWorld(hit.p), origin = AP[f.from || f.o], destination = AP[f.d];
      const groundSpeedMs = origin && destination && Number.isFinite(f.dur) && f.dur > 0
        ? distNm(origin, destination) * 1852 / (f.dur * 60)
        : null;
      return {
        id: `zip2d-${f.id}`,
        callsign: f.cs || null,
        latitude: point.latitude,
        longitude: point.longitude,
        altitudeM: null,
        groundSpeedMs,
        trackDeg: origin && destination ? trackBetween(origin, destination) : null,
        status: f.st,
        originAirport: origin?.id ?? null,
        destinationAirport: destination?.id ?? null,
        source: 'AeroFlo ZIP 2D synthetic model',
        positionKind: 'synthetic_demo',
      };
    });
    const activeScenario = S.applied.stack.map(item => ({
      id: item.sid,
      name: SCEN[item.sid]?.name || item.sid,
      startMinute: item.start,
      durationMinutes: item.dur,
      restorationMinutes: item.restore,
    }));
    parent.postMessage({
      type: 'airspace-zip-snapshot',
      source: 'AeroFlo ZIP 2D synthetic model',
      dataKind: 'synthetic_model',
      mode: zipMode,
      mapView: S.view,
      selectedAirport: S.sel,
      currentMinute: sim.t + Math.min(0.999, S.acc),
      activeScenario,
      visibleCount: LASTHIT.length,
      returnedCount: sim.tails.length,
      positionedCount: LASTHIT.length,
      aircraft,
      altitudeAvailability: 'not modeled by the ZIP simulation engine',
      assumptions: [
        'Aircraft schedules, callsigns, and routes are generated deterministically by the ZIP simulation model.',
        'Enroute map positions interpolate linearly between modeled airport coordinates.',
        'Ground speed is estimated from modeled route distance and simulated leg duration.',
        'Altitude is not included in this model.',
      ],
    }, location.origin);
  };
  setInterval(makeSnapshot, 1000);
}
