import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, ChevronDown, CircleHelp, Clock3, Database, FlaskConical, Globe2, Info, Layers3, ListFilter, MapPin, Minus, Pause, Plane, Play, Plus, RotateCcw, Search, Settings2, Sparkles, X } from "lucide-react";
import { CesiumMap, type MapHandle } from "./CesiumMap";
import { Assistant } from "./Assistant";
import { JFK, findLocation, locations } from "../data/locations";
import { altitudeM, displayLivePosition, POSITION_UPDATE_INTERVAL_MS } from "../data/flightMath";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import { customScenario, presets, scenarioEstimate, scenarioFromProposal, simulationAircraft, simulationTrails } from "../sim/engine";
import type { Aircraft, AssetStatus, EventType, LiveResponse, Location, MapKind, Mode, ReplayFrame, Scenario, ScenarioProposal, Trails } from "../types";

type Panel = "overview" | "details" | "flights" | "simulation" | "assistant" | "status" | "help";
type ServerStatus = { server: string; ai: { configured: boolean; state: string; provider: string }; openskyConfigured: boolean };
const eventLabels: Record<EventType, string> = { none: "No event", runway_closure: "Hypothetical runway closure", weather_delay: "Hypothetical weather delay", traffic_surge: "Synthetic traffic surge", generic_disruption: "Generic disruption" };
const formatTime = (value: number | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Unavailable";
const formatAge = (value: number | null, now = Date.now()) => value ? `${Math.max(0, Math.round((now - value) / 1000))}s ago` : "Unavailable";
const areaCacheKey = (kind: MapKind, place: Location) => kind === "us" ? "us" : `local:${Math.round(place.lat * 5) / 5}:${Math.round(place.lon * 5) / 5}`;
const areaQuery = (kind: MapKind, place: Location) => kind === "us" ? "area=us" : `area=local&lat=${Math.round(place.lat * 5) / 5}&lon=${Math.round(place.lon * 5) / 5}`;
const defaultAssets: AssetStatus = { imagery: "loading", terrain: "loading", buildings: "loading", model: "loading", message: null };
const initialQuery = new URLSearchParams(window.location.search);

function replayTrails(frames: ReplayFrame[]): Trails {
  const trails: Trails = {};
  for (const frame of frames) for (const aircraft of frame.aircraft) {
    if (aircraft.latitude === null || aircraft.longitude === null) continue;
    const points = trails[aircraft.id] ??= [];
    const previous = points.at(-1);
    if (!previous || previous.latitude !== aircraft.latitude || previous.longitude !== aircraft.longitude) {
      points.push({ latitude: aircraft.latitude, longitude: aircraft.longitude, altitudeM: aircraft.geoAltitudeM ?? aircraft.baroAltitudeM, time: frame.timestamp / 1000 });
      if (points.length > 22) points.shift();
    }
  }
  return trails;
}

function keepLastGood(previous: LiveResponse | null, current: LiveResponse): LiveResponse {
  if (!previous || previous.snapshotTime === null || !["error", "not_configured"].includes(current.state)) return current;
  return { ...previous, state: "stale", stale: true, error: current.error, nextPollAt: current.nextPollAt ?? previous.nextPollAt };
}

export function Portal() {
  const initialMode: Mode = initialQuery.get("mode") === "simulation" ? "simulation" : "live";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mapKind, setMapKind] = useState<MapKind>(initialQuery.get("view") === "us" ? "us" : "local");
  const [panel, setPanel] = useState<Panel>(initialQuery.get("panel") === "status" ? "status" : initialQuery.get("panel") === "help" ? "help" : initialMode === "simulation" ? "simulation" : "overview");
  const [location, setLocation] = useState<Location>(JFK);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [polling, setPolling] = useState("idle");
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [assets, setAssets] = useState<AssetStatus>(defaultAssets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paths, setPaths] = useState<"all" | "selected" | "off">("selected");
  const [clock, setClock] = useState(Date.now());
  const [replay, setReplay] = useState(false);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>(presets);
  const [scenario, setScenario] = useState<Scenario>(presets[0]);
  const [compareId, setCompareId] = useState<string>(presets[2].id);
  const [simElapsed, setSimElapsed] = useState(0);
  const [simRunning, setSimRunning] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [customOpen, setCustomOpen] = useState(false);
  const [customLocation, setCustomLocation] = useState("JFK");
  const [customEvent, setCustomEvent] = useState<EventType>("runway_closure");
  const [customDuration, setCustomDuration] = useState(30);
  const [customCount, setCustomCount] = useState(10);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [visibleIds, setVisibleIds] = useState<string[] | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const zipFrameRef = useRef<HTMLIFrameElement>(null);
  const capturedFramesRef = useRef(new Map<string, ReplayFrame[]>());
  useEffect(() => {
    if (mapKind !== "us" || mode !== "live") return;
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-live", aircraft: live?.aircraft ?? [], trails: live?.trails ?? {}, state: live?.state ?? "loading", error: live?.error ?? null, snapshotTime: live?.snapshotTime ?? null, returnedCount: live?.returnedCount ?? 0 }, window.location.origin);
  }, [mapKind, mode, live]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === zipFrameRef.current?.contentWindow && event.data?.type === "airspace-zip-selected" && typeof event.data.id === "string") setSelectedId(event.data.id);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    fetch("/api/status").then(r => r.json()).then(setServerStatus).catch(() => setServerStatus(null));
    const timer = window.setInterval(() => setClock(Date.now()), POSITION_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (mode !== "live" || replay) { setPolling(mode === "simulation" ? "paused · simulation active" : "paused · replay active"); return; }
    let cancelled = false, timer: number | undefined;
    const area = areaQuery(mapKind, location);
    const cacheKey = areaCacheKey(mapKind, location);
    async function load() {
      if (cancelled || document.hidden) return;
      setPolling("requesting OpenSky through local server");
      try {
        const response = await fetch(`/api/live?${area}`, { cache: "no-store" });
        const data = await response.json() as LiveResponse;
        if (!response.ok || !Array.isArray(data.aircraft) || !data.state) throw new Error("The local flight API returned an invalid response.");
        if (!cancelled) {
          setLive(previous => keepLastGood(previous, data));
          if (data.state === "connected" && typeof data.snapshotTime === "number") {
            const frames = capturedFramesRef.current.get(cacheKey) ?? [];
            if (!frames.some(frame => frame.timestamp === data.snapshotTime)) {
              const cutoff = Date.now() - 60 * 60 * 1000;
              const frameLimit = mapKind === "us" ? 12 : 42;
              frames.push({ timestamp: data.snapshotTime, aircraft: data.aircraft });
              capturedFramesRef.current.set(cacheKey, frames.filter(frame => frame.timestamp >= cutoff).slice(-frameLimit));
            }
          }
          setPolling(data.state === "connected" ? "active" : data.state === "not_configured" ? "paused · credentials missing" : data.state === "stale" ? "paused · last good response retained" : "waiting to retry");
        }
        const wait = Math.max(mapKind === "us" ? 180_000 : 90_000, data.nextPollAt ? data.nextPollAt - Date.now() : 0);
        if (!cancelled) timer = window.setTimeout(load, wait);
      } catch {
        if (!cancelled) { setPolling("local API unavailable"); timer = window.setTimeout(load, 90_000); }
      }
    }
    const visibility = () => { if (document.hidden) { if (timer) window.clearTimeout(timer); setPolling("paused · tab hidden"); } else { if (timer) window.clearTimeout(timer); void load(); } };
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [mode, replay, mapKind, location.lat, location.lon]);
  useEffect(() => {
    if (!replay || !replayPlaying || frames.length < 2) return;
    const timer = window.setInterval(() => setFrameIndex(index => Math.min(frames.length - 1, index + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [replay, replayPlaying, frames.length]);
  useEffect(() => { if (replay && frameIndex >= frames.length - 1) setReplayPlaying(false); }, [replay, frameIndex, frames.length]);
  useEffect(() => {
    if (!simRunning || mode !== "simulation") return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!document.hidden) setSimElapsed(value => Math.min(scenario.durationMinutes * 60, value + (now - previous) * simSpeed / 1000));
      previous = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [simRunning, simSpeed, mode, scenario.durationMinutes]);
  useEffect(() => { if (simElapsed >= scenario.durationMinutes * 60 && simRunning) setSimRunning(false); }, [simElapsed, simRunning, scenario.durationMinutes]);

  const simulationPositionTime = Math.floor(simElapsed / (POSITION_UPDATE_INTERVAL_MS / 1000)) * (POSITION_UPDATE_INTERVAL_MS / 1000);
  const currentFrame = frames[frameIndex];
  const aircraft = useMemo(() => mode === "simulation"
    ? simulationAircraft(scenario, simulationPositionTime)
    : replay ? (currentFrame?.aircraft ?? []).map(a => ({ ...a, positionKind: "historical" as const }))
      : (live?.aircraft ?? []).map(a => displayLivePosition(a, clock, Boolean(live?.stale))),
  [mode, scenario, simulationPositionTime, replay, currentFrame, live, clock]);
  const trails: Trails = useMemo(() => mode === "simulation" ? simulationTrails(scenario, simulationPositionTime)
    : replay && currentFrame ? replayTrails(frames.slice(0, frameIndex + 1))
      : live?.trails ?? {}, [mode, scenario, simulationPositionTime, replay, currentFrame, frameIndex, frames, live]);
  const positioned = aircraft.filter(a => a.latitude !== null && a.longitude !== null);
  const visible = visibleIds ? positioned.filter(a => visibleIds.includes(a.id)) : bounds ? positioned.filter(a => a.latitude! >= bounds[0] && a.longitude! >= bounds[1] && a.latitude! <= bounds[2] && a.longitude! <= bounds[3]) : positioned;
  const selected = aircraft.find(a => a.id === selectedId) ?? null;
  const sourceText = mode === "simulation" ? "AIRSPACE simulation" : "OpenSky Network";
  const snapshotTime = mode === "simulation" ? null : replay ? currentFrame?.timestamp ?? null : live?.snapshotTime ?? null;
  const dataState = mode === "simulation" ? "simulation" : replay ? "historical" : live?.state ?? "loading";
  const searchMatches = searchText.trim() ? locations.filter(place => `${place.id} ${place.city} ${place.name}`.toLowerCase().includes(searchText.trim().toLowerCase())).slice(0, 6) : [];

  function changeMode(next: Mode) { setMode(next); setSelectedId(null); setReplay(false); setReplayPlaying(false); setPanel(mapKind === "us" ? "details" : next === "simulation" ? "simulation" : "overview"); }
  function chooseLocation(place: Location) { setLocation(place); setSearchText(""); setSearchOpen(false); setSearchError(null); mapRef.current?.flyTo(place); zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus", id: place.id, latitude: place.lat, longitude: place.lon }, window.location.origin); }
  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const known = findLocation(searchText);
    if (known) { chooseLocation(known); return; }
    try {
      const result = await mapRef.current?.search(searchText);
      if (!result) throw new Error("Map search is not ready yet.");
      setLocation({ id: result.label, name: result.label, city: result.label, lat: result.latitude, lon: result.longitude });
      setSearchText(""); setSearchOpen(false); setSearchError(null);
    } catch (error) { setSearchError(error instanceof Error ? error.message : "Search failed."); }
  }
  function go(panelName: Panel, view?: MapKind) {
    if (view) { setMapKind(view); setBounds(null); setPanel("details"); return; }
    if (mapKind === "us") setMapKind("local");
    if (panelName === "simulation") { setMode("simulation"); setSelectedId(null); setReplay(false); setReplayPlaying(false); setPanel("simulation"); }
    else setPanel(panelName);
  }
  async function enterReplay() {
    if (replay) { setReplay(false); setReplayPlaying(false); return; }
    setReplayMessage("Loading locally captured frames…");
    try {
      const area = areaQuery(mapKind, location);
      const cacheKey = areaCacheKey(mapKind, location);
      let serverFrames: ReplayFrame[] = [];
      try {
        const response = await fetch(`/api/replay?${area}`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok && Array.isArray(data.frames)) serverFrames = data.frames;
      } catch { /* Browser-captured frames also support serverless deployments. */ }
      const cutoff = Date.now() - 60 * 60 * 1000;
      const mergedFrames = new Map<number, ReplayFrame>();
      for (const frame of [...serverFrames, ...(capturedFramesRef.current.get(cacheKey) ?? [])]) {
        if (Number.isFinite(frame?.timestamp) && frame.timestamp >= cutoff && Array.isArray(frame.aircraft)) mergedFrames.set(frame.timestamp, frame);
      }
      const frameLimit = mapKind === "us" ? 12 : 42;
      const availableFrames = [...mergedFrames.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-frameLimit);
      if (availableFrames.length < 2) {
        setReplayMessage("Replay needs two successful live updates for this area. Keep Live Data open for a few minutes.");
        return;
      }
      setFrames(availableFrames); setFrameIndex(availableFrames.length - 1); setReplay(true); setReplayPlaying(false);
      setReplayMessage(`${availableFrames.length} captured updates available for this browser and server session.`);
    } catch { setReplayMessage("Replay is unavailable. Check the live feed and try again."); }
  }
  function selectScenario(next: Scenario) { setScenario(next); setSimElapsed(0); setSimRunning(false); setSelectedId(null); const place = locations.find(x => x.id === next.locationId) ?? JFK; setLocation(place); if (next.pattern === "cross_country") setMapKind("us"); else setMapKind("local"); }
  function runProposal(proposal: ScenarioProposal) { const next = scenarioFromProposal(proposal); setScenarios(previous => [...previous, next]); selectScenario(next); setMode("simulation"); setPanel("simulation"); }
  function createCustom(event: React.FormEvent) { event.preventDefault(); const next = customScenario({ locationId: customLocation, eventType: customEvent, durationMinutes: customDuration, syntheticAircraftCount: customCount }); setScenarios(previous => [...previous, next]); selectScenario(next); setMode("simulation"); setPanel("simulation"); setCustomOpen(false); }
  const aiContext = { mode, view: mapKind, location: `${location.name} (${location.id})`, sourceTimestamp: snapshotTime, dataState, visibleCount: visible.length, aircraft: visible.slice(0, 30).map(a => ({ id: a.id, callsign: a.callsign, latitude: a.latitude, longitude: a.longitude, altitudeM: a.geoAltitudeM ?? a.baroAltitudeM, groundSpeedMs: a.groundSpeedMs, trackDeg: a.trackDeg, positionTime: a.positionTime, positionKind: a.positionKind })) };
  const currentEstimate = scenarioEstimate(scenario);
  const comparison = scenarios.find(x => x.id === compareId && x.id !== scenario.id) ?? scenarios.find(x => x.id !== scenario.id)!;
  const comparisonEstimate = scenarioEstimate(comparison);
  const scenarioLocation = locations.find(place => place.id === scenario.locationId) ?? JFK;

  return <div className="portal">
    <aside className="portal-sidebar"><a className="portal-brand" href="/"><span className="brand-glyph"><Plane size={20} fill="currentColor"/></span><span>AIRSPACE</span></a><div className="sidebar-caption">FLIGHT RESEARCH PORTAL</div><nav aria-label="Portal navigation"><button className={panel === "overview" ? "active" : ""} onClick={() => go("overview")}><Activity/> Overview</button><button className={mapKind === "local" && panel === "details" ? "active" : ""} onClick={() => go("details", "local")}><Layers3/> Local 3D</button><button className={mapKind === "us" && panel === "details" ? "active" : ""} onClick={() => go("details", "us")}><Globe2/> US 2D</button><button className={panel === "flights" ? "active" : ""} onClick={() => go("flights")}><Plane/> Flights</button><button className={panel === "simulation" ? "active" : ""} onClick={() => go("simulation")}><FlaskConical/> Simulation</button><button className={panel === "assistant" ? "active" : ""} onClick={() => go("assistant")}><Sparkles/> AI Assistant</button><button className={panel === "status" ? "active" : ""} onClick={() => go("status")}><Database/> Data Status</button></nav><div className="sidebar-bottom"><button onClick={() => go("help")}><CircleHelp size={17}/> Setup & help</button><a href="/"><ArrowLeft size={16}/> Landing page</a></div></aside>
    <div className="portal-main"><header className="portal-header"><div className="mobile-brand">AIRSPACE</div><form className="portal-search" onSubmit={submitSearch}><Search size={18}/><input aria-label="Search airport or city" placeholder="Search airport or city · JFK, New York…" value={searchText} onChange={event => { setSearchText(event.target.value); setSearchOpen(true); setSearchError(null); }}/><button type="submit" aria-label="Search location"><ArrowRight size={17}/></button>{searchOpen && searchMatches.length > 0 && <div className="search-menu">{searchMatches.map(place => <button key={place.id} type="button" onClick={() => chooseLocation(place)}><MapPin size={16}/><span><strong>{place.id}</strong> {place.name}<small>{place.city}</small></span></button>)}</div>}</form><div className="mode-switch" role="group" aria-label="Data mode"><button aria-pressed={mode === "live"} onClick={() => changeMode("live")}><span className="status-dot good"/> Live Data</button><button aria-pressed={mode === "simulation"} onClick={() => changeMode("simulation")}><FlaskConical size={15}/> Simulation</button></div><button className="top-assistant" onClick={() => setPanel(panel === "assistant" ? "details" : "assistant")} aria-label={panel === "assistant" ? "Close AI assistant" : "Open AI assistant"}><Sparkles size={18}/><span>Assistant</span></button></header>
      {searchError && <div className="search-error" role="alert">{searchError}<button onClick={() => setSearchError(null)} aria-label="Dismiss search error"><X size={15}/></button></div>}
      {mapKind === "us" ? <iframe key={mode} ref={zipFrameRef} className="zip2d-frame" title="Original ZIP 2D flight workspace" src={`/zip2d/airspace.html?mode=${mode}`} onLoad={() => { if (mode === "live") zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-live", aircraft: live?.aircraft ?? [], trails: live?.trails ?? {}, state: live?.state ?? "loading", error: live?.error ?? null, snapshotTime: live?.snapshotTime ?? null, returnedCount: live?.returnedCount ?? 0 }, window.location.origin); }}/> : <div className="portal-content"><main className="map-column"><div className="map-shell"><CesiumMap ref={mapRef} kind="local" location={location} aircraft={aircraft} trails={trails} selectedId={selectedId} paths={paths} animatePositions={!replay} motionRate={mode === "simulation" ? (simRunning ? simSpeed : 0) : 1} onSelect={id => { setSelectedId(id); setPanel("details"); }} onStatus={setAssets} onBounds={setBounds} onVisibleIds={setVisibleIds}/><div className="map-top-left"><span className="eyeline">LOCAL AIRSPACE / 3D</span><h1>{`${location.city} · ${location.id}`}</h1><span className="map-subline">{mode === "simulation" ? <><span className="status-dot purple"/> SIMULATION · synthetic traffic</> : replay ? <><Clock3 size={14}/> HISTORICAL · locally captured</> : <><span className={`status-dot ${live?.state === "connected" ? "good" : "amber"}`}/> {sourceText} · {live?.state === "connected" ? "connected" : live?.state?.replaceAll("_", " ") ?? "connecting"}</>}</span></div><div className="map-top-right"><div><strong>{visible.length}</strong><span>aircraft in view</span></div><button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={18}/></button><button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={18}/></button><button aria-label="Reset map view" onClick={() => mapRef.current?.reset()}><RotateCcw size={17}/></button></div>{mode === "simulation" && <span className="map-sim-watermark">SIMULATION</span>}{mode === "live" && !replay && (live?.state === "not_configured" || live?.state === "error" || !live && polling === "local API unavailable") && <div className="map-alert"><AlertTriangle size={20}/><div><strong>{live?.state === "not_configured" ? "OpenSky setup needed" : "Flight feed unavailable"}</strong><span>{live?.error ?? "Start the local API with npm run dev."}</span><button onClick={() => setPanel("help")}>View setup <ArrowRight size={14}/></button></div></div>}{assets.message && <div className="map-asset-note" role="status"><Info size={15}/>{assets.message}</div>}<div className="map-attribution-note">{assets.imagery === "ion" ? "Cesium aerial imagery" : assets.imagery === "osm" ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · street map</a> : assets.imagery === "fallback" ? "Natural Earth fallback · no street detail" : assets.imagery === "error" ? "Imagery unavailable" : "Imagery loading"}{mapKind === "local" && <> · {assets.terrain === "ion" ? "world terrain" : "ellipsoid"}</>}</div></div>
          <div className="map-lower"><div className="map-data-strip"><div><span className="strip-label">SOURCE</span><strong>{sourceText}</strong></div><div><span className="strip-label">{mode === "simulation" ? "SCENARIO TIME" : "LAST UPDATE"}</span><strong>{mode === "simulation" ? `${Math.floor(simElapsed / 60).toString().padStart(2, "0")}:${Math.floor(simElapsed % 60).toString().padStart(2, "0")}` : formatTime(snapshotTime)}</strong></div><div><span className="strip-label">{mode === "simulation" ? "STATE" : "AGE"}</span><strong>{mode === "simulation" ? simRunning ? "Running" : simElapsed ? "Paused" : "Ready" : formatAge(snapshotTime, clock)}</strong></div><div><span className="strip-label">POLLING</span><strong>{polling}</strong></div></div><div className="map-legend"><span><Plane size={15}/> Aircraft</span><span><i className="legend-line"/> Path</span><span><i className="legend-dot amber"/> Stale / estimated</span><span><i className="legend-dot purple"/> Simulated</span><span><i className="legend-dot lime"/> Selected</span><div className="path-control"><span>Paths</span><button aria-pressed={paths === "all"} onClick={() => setPaths("all")}>All</button><button aria-pressed={paths === "selected"} onClick={() => setPaths("selected")}>Selected</button><button aria-pressed={paths === "off"} onClick={() => setPaths("off")}>Off</button></div></div>
            {mode === "simulation" ? <div className="timeline"><span className="sim-tag">SIMULATION</span><button className="timeline-play" onClick={() => setSimRunning(value => !value)} aria-label={simRunning ? "Pause simulation" : simElapsed ? "Resume simulation" : "Start simulation"}>{simRunning ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}</button><input type="range" aria-label="Simulation time" min={0} max={scenario.durationMinutes * 60} step={1} value={simElapsed} onChange={event => { setSimElapsed(Number(event.target.value)); setSimRunning(false); }}/><span className="timeline-time">{Math.floor(simElapsed / 60)} / {scenario.durationMinutes} min</span><select aria-label="Simulation speed" value={simSpeed} onChange={event => setSimSpeed(Number(event.target.value))}>{[0.5, 1, 2, 4, 8].map(x => <option key={x} value={x}>{x}×</option>)}</select><button onClick={() => { setSimElapsed(0); setSimRunning(false); }} aria-label="Reset simulation"><RotateCcw size={17}/></button></div> : <div className="timeline"><button className="replay-toggle" aria-pressed={replay} onClick={() => void enterReplay()}><Clock3 size={15}/>{replay ? "Exit replay" : "Replay captured updates"}</button>{replay && frames.length > 1 && <><button className="timeline-play" aria-label={replayPlaying ? "Pause replay" : "Play replay"} onClick={() => { if (frameIndex === frames.length - 1) setFrameIndex(0); setReplayPlaying(value => !value); }}>{replayPlaying ? <Pause size={16}/> : <Play size={16} fill="currentColor"/>}</button><input type="range" aria-label="Replay frame" min={0} max={frames.length - 1} value={frameIndex} onChange={event => { setFrameIndex(Number(event.target.value)); setReplayPlaying(false); }}/><span className="timeline-time">{formatTime(currentFrame?.timestamp ?? null)}</span></>}{replayMessage && <span className="replay-message">{replayMessage}</span>}</div>}
          </div><div className="operational-note">Public flight data and simulations for education and research. Not for operational use.</div></main>
          <aside className="inspector" aria-label="Portal information panel"><div className="inspector-top"><span className="eyeline">{panel === "assistant" ? "RESEARCH COMPANION" : panel === "simulation" ? "SCENARIO LAB" : panel === "status" ? "CONNECTIONS" : panel === "flights" ? "AIRCRAFT LIST" : panel === "help" ? "SETUP GUIDE" : "AIRSPACE / INSPECTOR"}</span><button onClick={() => setPanel("overview")} title="Overview" aria-label="Show overview"><Settings2 size={16}/></button></div>
            {panel === "assistant" ? <Assistant configured={Boolean(serverStatus?.ai.configured)} providerState={serverStatus?.ai.state ?? "unverified"} context={aiContext} onRunProposal={runProposal} onProviderChange={state => setServerStatus(previous => previous ? { ...previous, ai: { ...previous.ai, state } } : previous)}/>
            : panel === "simulation" ? <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><FlaskConical size={18}/></span><div><span className="eyeline">SYNTHETIC ONLY</span><h2>Simulation lab</h2></div></div><p className="panel-intro">Set a scenario, run its synthetic traffic, then compare model estimates.</p><span className="sim-tag">SIMULATION · NO LIVE CHANGES</span><label className="field-label" htmlFor="scenario-select">Scenario</label><select id="scenario-select" className="field" value={scenario.id} onChange={event => selectScenario(scenarios.find(x => x.id === event.target.value) ?? presets[0])}>{scenarios.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><div className="scenario-description">{scenario.description}</div><div className="scenario-stats"><div><strong>{scenario.syntheticAircraftCount}</strong><span>synthetic aircraft</span></div><div><strong>{scenario.durationMinutes}m</strong><span>event window</span></div></div><div className="scenario-event"><strong>{eventLabels[scenario.eventType]}</strong><span>{scenarioLocation.name} · {scenarioLocation.id}</span></div><div className="sim-panel-controls"><button className="button-primary" onClick={() => setSimRunning(value => !value)}>{simRunning ? <Pause size={16}/> : <Play size={16} fill="currentColor"/>}{simRunning ? "Pause" : simElapsed ? "Resume" : "Start simulation"}</button><button className="button-subtle" onClick={() => { setSimElapsed(0); setSimRunning(false); }}><RotateCcw size={16}/> Reset</button></div><button className="disclosure" onClick={() => setCustomOpen(value => !value)} aria-expanded={customOpen}><Plus size={17}/> Create custom event <ChevronDown size={16}/></button>{customOpen && <form className="custom-form" onSubmit={createCustom}><label>Location<select className="field" value={customLocation} onChange={event => setCustomLocation(event.target.value)}>{locations.map(x => <option key={x.id} value={x.id}>{x.id} · {x.city}</option>)}</select></label><label>Event type<select className="field" value={customEvent} onChange={event => setCustomEvent(event.target.value as EventType)}>{Object.entries(eventLabels).filter(([key]) => key !== "none").map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label><div className="form-pair"><label>Duration · min<input className="field" type="number" min={5} max={240} value={customDuration} onChange={event => setCustomDuration(Number(event.target.value))}/></label><label>Aircraft<input className="field" type="number" min={1} max={40} value={customCount} onChange={event => setCustomCount(Number(event.target.value))}/></label></div><button className="button-primary full" type="submit">Create & load scenario</button></form>}<div className="panel-divider"/><div className="compare-heading"><BarChart3 size={18}/><h3>Compare simulations</h3></div><label className="field-label" htmlFor="compare-select">Compare with</label><select id="compare-select" className="field" value={comparison.id} onChange={event => setCompareId(event.target.value)}>{scenarios.filter(x => x.id !== scenario.id).map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select><div className="compare-results"><div><span>{scenario.name}</span><strong>{currentEstimate.affectedCount} affected</strong><small>{currentEstimate.aggregateDelayMinutes} synthetic aggregate delay min</small><i style={{ width: `${Math.min(100, currentEstimate.aggregateDelayMinutes / Math.max(1, scenario.durationMinutes * scenario.syntheticAircraftCount) * 100)}%` }}/></div><div><span>{comparison.name}</span><strong>{comparisonEstimate.affectedCount} affected</strong><small>{comparisonEstimate.aggregateDelayMinutes} synthetic aggregate delay min</small><i style={{ width: `${Math.min(100, comparisonEstimate.aggregateDelayMinutes / Math.max(1, comparison.durationMinutes * comparison.syntheticAircraftCount) * 100)}%` }}/></div></div><p className="microcopy">SIMULATION model estimates. Delay is an abstract progress deficit, not a predicted airport delay.</p><details className="assumptions"><summary>Model assumptions</summary><strong>{scenario.name}</strong>{scenario.assumptions.map((x, i) => <p key={i}>• {x}</p>)}<strong>{comparison.name}</strong>{comparison.assumptions.map((x, i) => <p key={i}>• {x}</p>)}</details></div>
            : panel === "status" ? <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><Database size={18}/></span><div><span className="eyeline">DATA STATUS</span><h2>Source health</h2></div></div><p className="panel-intro">The source of every map layer and aircraft stays visible here.</p><div className="status-table"><StatusRow label="Cesium imagery" value={assets.imagery === "ion" ? "Aerial imagery loaded" : assets.imagery === "osm" ? "OpenStreetMap street map" : assets.imagery === "fallback" ? "Natural Earth fallback" : assets.imagery} good={assets.imagery === "ion"}/><StatusRow label="3D terrain" value={assets.terrain === "ion" ? "World Terrain loaded" : "Ellipsoid only"} good={assets.terrain === "ion"}/><StatusRow label="3D buildings" value={assets.buildings === "ion" ? "OSM Buildings loaded" : assets.buildings === "not_requested" ? "Not used in this view" : assets.buildings} good={assets.buildings === "ion"}/><StatusRow label="Aircraft model" value={assets.model === "ready" ? "Original GLB ready" : assets.model === "fallback" ? "Symbol fallback" : "Loading"} good={assets.model === "ready"}/><StatusRow label="OpenSky" value={live?.state === "connected" ? "Connected" : live?.state?.replaceAll("_", " ") ?? "Not checked"} good={live?.state === "connected"}/><StatusRow label="AI provider" value={serverStatus?.ai.configured ? serverStatus.ai.state === "working" ? "Checked · working" : "Configured · unverified" : "Not configured"} good={serverStatus?.ai.state === "working"}/></div><div className="detail-list"><Detail label="Last successful flight update" value={formatTime(live?.lastSuccess ?? null)}/><Detail label="Data age" value={formatAge(live?.snapshotTime ?? null, clock)}/><Detail label="Polling state" value={polling}/><Detail label="Displayed records" value={dataState}/><Detail label="Returned / positioned" value={`${live?.returnedCount ?? 0} / ${live?.positionedCount ?? 0}`}/><Detail label="Remaining OpenSky credits" value={live?.remainingCredits === null || live?.remainingCredits === undefined ? "Unavailable" : String(live.remainingCredits)}/></div>{(assets.message || live?.error) && <div className="setup-card"><strong>Needs attention</strong>{assets.message && <p>{assets.message}</p>}{live?.error && <p>{live.error}</p>}</div>}<p className="microcopy">OpenSky coverage can be incomplete. These state vectors are not certified surveillance.</p><button className="text-button" onClick={() => setPanel("help")}>Open setup guide <ArrowRight size={16}/></button></div>
            : panel === "help" ? <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><CircleHelp size={18}/></span><div><span className="eyeline">{isLocalDevelopment() ? "LOCAL SETUP" : "VERCEL SETUP"}</span><h2>Setup & help</h2></div></div>
              {isLocalDevelopment() ? <>
                <p className="panel-intro">AIRSPACE works locally with a Vite frontend and private API server.</p>
                <div className="help-step"><span>01</span><div><strong>Install and start</strong><code>npm install<br/>npm run dev</code></div></div>
                <div className="help-step"><span>02</span><div><strong>Configure Cesium</strong><p>Add <code>VITE_CESIUM_ION_TOKEN</code> to <code>.env.local</code>. This is a public-client token; restrict its allowed assets, scope, and URLs.</p></div></div>
                <div className="help-step"><span>03</span><div><strong>Configure OpenSky</strong><p>Add these server-only variables to <code>.env.local</code>, then restart the local server:</p><code>OPENSKY_CLIENT_ID=your_client_id<br/>OPENSKY_CLIENT_SECRET=your_client_secret</code><p>Do not paste credentials into this page or chat.</p></div></div>
                <div className="help-step"><span>04</span><div><strong>Enable AI if wanted</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>. Put it in your local <code>.env.local</code> file:</p><code>GROQ_API_KEY=your_groq_api_key</code><p>Restart AIRSPACE and ask a question to check provider access. Keep this key on the server; don’t paste it into this page or chat.</p></div></div>
              </> : <>
                <p className="panel-intro">Add keys in your Vercel project settings. AIRSPACE never collects or displays their values.</p>
                <div className="help-step"><span>01</span><div><strong>Open environment settings</strong><p>Add each variable for the Production environment, then redeploy.</p><a className="text-button setup-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open Vercel environment settings</a></div></div>
                <div className="help-step"><span>02</span><div><strong>Cesium ion</strong><p>Add <code>VITE_CESIUM_ION_TOKEN</code> as <b>Config</b>. It is a public-client token embedded in the browser build; restrict its assets, scope, and allowed URLs.</p></div></div>
                <div className="help-step"><span>03</span><div><strong>OpenSky live data</strong><p>Add <code>OPENSKY_CLIENT_ID</code> and <code>OPENSKY_CLIENT_SECRET</code> as <b>Secret</b>. These remain server-side.</p></div></div>
                <div className="help-step"><span>04</span><div><strong>Optional AI assistant</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>, then add it as <code>GROQ_API_KEY</code> in Vercel. Keep it server-only. The assistant stays unavailable until a deployment includes it.</p></div></div>
                <p className="microcopy">Never paste API keys into AIRSPACE or chat. Vercel applies changed variables to new deployments.</p>
              </>}
              <p className="microcopy">More details and service terms are in the project README.</p><button className="text-button" onClick={() => setPanel("status")}>Check data status <ArrowRight size={16}/></button></div>
            : panel === "flights" ? <FlightList aircraft={aircraft} selectedId={selectedId} onSelect={id => { setSelectedId(id); setPanel("details"); }}/>
            : panel === "details" ? <AircraftDetails aircraft={selected} now={clock} onClose={() => setSelectedId(null)} mode={mode} onFlights={() => setPanel("flights")} onFocus={() => { if (selected) mapRef.current?.focusAircraft(selected); }}/>
            : <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><Activity size={18}/></span><div><span className="eyeline">OVERVIEW</span><h2>Airspace at a glance</h2></div></div><p className="panel-intro">Explore the map, inspect an aircraft, or start a clearly separate simulation.</p><div className="overview-total"><strong>{visible.length}</strong><span>positioned aircraft in the current view</span></div><div className="detail-list"><Detail label="Mode" value={mode === "live" ? replay ? "Historical replay" : "Live Data" : "SIMULATION"}/><Detail label="Area" value={`${location.city} · ${location.id}`}/><Detail label="Source" value={sourceText}/><Detail label="Last update" value={formatTime(snapshotTime)}/></div><div className="panel-divider"/><h3 className="subheading">Where to next?</h3><button className="action-row" onClick={() => go("details", "local")}><Layers3 size={19}/><span>Explore local 3D<small>Orbit around {location.id}</small></span><ArrowRight size={17}/></button><button className="action-row" onClick={() => go("details", "us")}><Globe2 size={19}/><span>Open U.S. 2D<small>Zoom and pan nationally</small></span><ArrowRight size={17}/></button><button className="action-row" onClick={() => changeMode("simulation")}><FlaskConical size={19}/><span>Try a simulation<small>Synthetic traffic only</small></span><ArrowRight size={17}/></button>{mode === "live" && live?.state !== "connected" && <div className="setup-card"><strong>{live?.state === "not_configured" ? "Add OpenSky credentials" : "Waiting for a flight update"}</strong><p>{live?.error ?? "The local API will return observed traffic when available."}</p></div>}</div>}
          </aside></div>}
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>; }
function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) { return <div className="status-row"><span>{label}</span><strong><i className={`status-dot ${good ? "good" : "amber"}`}/>{value}</strong></div>; }
function AircraftDetails({ aircraft, now, onClose, mode, onFlights, onFocus }: { aircraft: Aircraft | null; now: number; onClose: () => void; mode: Mode; onFlights: () => void; onFocus: () => void }) {
  if (!aircraft) return <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><Plane size={18}/></span><div><span className="eyeline">AIRCRAFT INSPECTOR</span><h2>Select an aircraft</h2></div></div><p className="panel-intro">Click any aircraft on the map or choose one from the flight list to see its source and available fields.</p><div className="inspector-empty"><Plane size={47}/><span>No aircraft selected</span></div><button className="text-button" onClick={onFlights}>Browse aircraft <ArrowRight size={16}/></button></div>;
  const simulated = mode === "simulation" || aircraft.kind === "simulated";
  const positionAge = aircraft.positionTime ? formatAge(aircraft.positionTime * 1000, now) : "Unavailable";
  return <div className="panel-content"><div className="detail-top"><div><span className="eyeline">SELECTED AIRCRAFT</span><h2>{aircraft.callsign ?? aircraft.id.toUpperCase()}</h2><span className={simulated ? "sim-tag" : "live-tag"}>{simulated ? "SIMULATION" : aircraft.positionKind === "historical" ? "HISTORICAL" : aircraft.positionKind === "stale" ? "STALE LAST GOOD POSITION" : aircraft.positionKind === "estimated" ? "ESTIMATED BETWEEN UPDATES" : "MEASURED POSITION"}</span></div><button aria-label="Close aircraft details" onClick={onClose}><X size={18}/></button></div><div className="aircraft-identity"><Plane size={36} fill="currentColor"/><div><span>{aircraft.id.toUpperCase()}</span><small>{simulated ? "Synthetic aircraft" : "ICAO 24-bit address"}</small></div></div><button className="button-subtle full focus-aircraft" disabled={aircraft.latitude === null || aircraft.longitude === null} onClick={onFocus}><MapPin size={15}/> Focus aircraft on map</button><dl className="detail-list"><Detail label="Callsign" value={aircraft.callsign ?? "Unavailable"}/><Detail label="ICAO address" value={simulated ? "Synthetic ID" : aircraft.id.toUpperCase()}/><Detail label="Position" value={aircraft.latitude === null || aircraft.longitude === null ? "Unavailable" : `${aircraft.latitude.toFixed(4)}°, ${aircraft.longitude.toFixed(4)}°`}/><Detail label="Geometric altitude" value={aircraft.geoAltitudeM === null ? "Unavailable" : `${Math.round(aircraft.geoAltitudeM * 3.28084).toLocaleString()} ft`}/><Detail label="Barometric altitude" value={aircraft.baroAltitudeM === null ? "Unavailable" : `${Math.round(aircraft.baroAltitudeM * 3.28084).toLocaleString()} ft`}/><Detail label="Ground speed" value={aircraft.groundSpeedMs === null ? "Unavailable" : `${Math.round(aircraft.groundSpeedMs * 1.94384)} kt`}/><Detail label="Track" value={aircraft.trackDeg === null ? "Unavailable" : `${Math.round(aircraft.trackDeg)}°`}/><Detail label="Vertical rate" value={aircraft.verticalRateMs === null ? "Unavailable" : `${Math.round(aircraft.verticalRateMs * 196.85)} ft/min`}/><Detail label="On ground" value={aircraft.onGround === null ? "Unavailable" : aircraft.onGround ? "Yes" : "No"}/><Detail label="Position source" value={simulated ? "Synthetic model" : aircraft.positionSource ?? "Unavailable"}/><Detail label="Position age" value={simulated ? "Simulation time" : positionAge}/><Detail label="Last contact" value={simulated ? "Not applicable" : aircraft.lastContact ? formatTime(aircraft.lastContact * 1000) : "Unavailable"}/><Detail label="Source" value={aircraft.source}/><Detail label="Airline / type" value="Unavailable"/><Detail label="Origin / destination" value="Unavailable"/></dl><div className="detail-disclaimer"><Info size={16}/><span>{simulated ? "This aircraft and its route are synthetic. No real aircraft are affected." : aircraft.positionKind === "stale" ? "OpenSky is unavailable. This is the last successful observed position, and its age is shown above." : aircraft.positionKind === "estimated" ? "Position is estimated from the last reported location, speed, and track. It is not a new observation." : "OpenSky state vectors can omit fields and do not provide a certified operational picture."}</span></div></div>;
}
function FlightList({ aircraft, selectedId, onSelect }: { aircraft: Aircraft[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const list = aircraft.filter(a => `${a.callsign ?? ""} ${a.id}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 600);
  return <div className="panel-content"><div className="panel-heading"><span className="panel-heading-icon"><ListFilter size={18}/></span><div><span className="eyeline">CURRENT AREA</span><h2>Flights</h2></div></div><p className="panel-intro">{aircraft.length} records returned. Select a row to inspect the same aircraft on the map.</p><div className="flight-filter"><Search size={16}/><input aria-label="Filter flights" placeholder="Filter by callsign or ICAO" value={filter} onChange={event => setFilter(event.target.value)}/></div><div className="flight-list">{list.length ? list.map(a => <button className={selectedId === a.id ? "active" : ""} key={a.id} onClick={() => onSelect(a.id)}><Plane size={17}/><span><strong>{a.callsign ?? a.id.toUpperCase()}</strong><small>{a.id.toUpperCase()} · {a.source}</small></span><span className="flight-alt">{a.geoAltitudeM !== null || a.baroAltitudeM !== null ? `${Math.round(altitudeM(a) * 3.28084).toLocaleString()} ft` : "—"}</span></button>) : <div className="flight-empty">{aircraft.length ? "No flights match that filter." : "No aircraft are available for this area yet."}</div>}</div>{aircraft.length > 600 && <p className="microcopy">Showing the first 600 rows for list performance. All positioned aircraft remain on the map.</p>}</div>;
}
