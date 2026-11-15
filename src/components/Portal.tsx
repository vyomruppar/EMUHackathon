import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, CircleHelp, FlaskConical, Gauge, List, Map as MapIcon, MapPin, Plane, PlaneTakeoff, RotateCcw, Search, Settings, ShieldAlert, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import { Assistant } from "./Assistant";
import { createAlertVoice, readMuted, saveMuted, type AlertSeverity } from "../alertVoice";
import { locations } from "../data/locations";
import { GROQ_API_KEYS_URL, isLocalDevelopment, VERCEL_ENVIRONMENT_SETTINGS_URL } from "../data/setup";
import type { Mode, ScenarioProposal } from "../types";

type Panel = "overview" | "flights" | "assistant" | "status" | "help";
type ZipView = "net" | "sfc" | "lab" | "deg" | "alr";
type ZipAircraft = {
  id: string; callsign: string | null; latitude: number; longitude: number;
  altitudeM: null; groundSpeedMs: number | null; trackDeg: number | null;
  status: string; originAirport: string | null; destinationAirport: string | null;
  source: string; positionKind: "synthetic_demo";
};
type Zip2DSnapshot = {
  mode: Mode; mapView: string; selectedAirport: string; currentMinute: number;
  visibleCount: number; returnedCount: number; positionedCount: number;
  aircraft: ZipAircraft[]; altitudeAvailability: string;
  activeScenario: Array<{ id: string; name: string; startMinute: number; durationMinutes: number; restorationMinutes: number }>;
  assumptions: string[]; receivedAt: number;
};
type ServerStatus = { server: string; ai: { configured: boolean; state: string; provider: string }; voice?: { configured: boolean; provider: string } };
type ProposalHandoff = {
  requestId: string;
  proposal: ScenarioProposal;
  startMinute: number;
};
type ProposalHandoffState = { key: string; status: "pending" | "loaded" | "error"; message: string };

function proposalKey(proposal: ScenarioProposal) {
  return JSON.stringify([proposal.locationId, proposal.eventType, proposal.durationMinutes, proposal.syntheticAircraftCount, proposal.description]);
}

const initialQuery = new URLSearchParams(window.location.search);
// The simulator always runs in simulation mode: it is a superset of the old
// synthetic demo and is the only mode that accepts assistant proposals.
const mode: Mode = "simulation";
const initialPanel: Panel = initialQuery.get("panel") === "status" ? "status" : initialQuery.get("panel") === "help" ? "help" : initialQuery.get("panel") === "assistant" ? "assistant" : "overview";
const initialZipView: ZipView = initialQuery.get("mode") === "simulation" ? "lab" : "net";
const viewLabel: Record<ZipView, string> = { net: "Network map", sfc: "Surface", lab: "What-if lab", deg: "Degraded ops", alr: "Alerts & checks" };
const viewIcon: Record<ZipView, typeof MapIcon> = { net: MapIcon, sfc: PlaneTakeoff, lab: FlaskConical, deg: ShieldAlert, alr: TriangleAlert };
const views: ZipView[] = ["net", "sfc", "lab", "deg", "alr"];
type AlertCounts = { critical: number; warning: number; total: number };
// Airports with a modeled surface layout. The focus airport drives the surface view,
// queues, runways, scenarios and alerts in the simulator.
const FOCUS_AIRPORTS = ["JFK", "LGA", "EWR"] as const;
type FocusAirport = (typeof FOCUS_AIRPORTS)[number];
type Place = (typeof locations)[number];
function matchPlaces(list: Place[], query: string) {
  const value = query.trim().toLowerCase();
  if (!value) return [];
  const exact = list.filter(place => place.id.toLowerCase() === value || place.city.toLowerCase() === value);
  const partial = list.filter(place => !exact.includes(place) && `${place.id} ${place.city} ${place.name}`.toLowerCase().includes(value));
  return [...exact, ...partial];
}

export function Portal() {
  const [zipView, setZipView] = useState<ZipView>(initialZipView);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusAirport, setFocusAirport] = useState<FocusAirport>("JFK");
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [snapshot, setSnapshot] = useState<Zip2DSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposalHandoff, setProposalHandoff] = useState<ProposalHandoffState | null>(null);
  const [alerts, setAlerts] = useState<AlertCounts>({ critical: 0, warning: 0, total: 0 });
  const [scenarioNames, setScenarioNames] = useState<string[]>([]);
  const [muted, setMuted] = useState(readMuted);
  const mutedRef = useRef(muted);
  const serverVoiceRef = useRef(false);
  const voiceRef = useRef<ReturnType<typeof createAlertVoice> | null>(null);
  voiceRef.current ??= createAlertVoice({ useServerVoice: () => serverVoiceRef.current, isMuted: () => mutedRef.current });
  const zipFrameRef = useRef<HTMLIFrameElement>(null);
  const zipFrameReadyRef = useRef(false);
  const pendingProposalRef = useRef<ProposalHandoff | null>(null);

  // Search only appears where it does something: the network map (pan to any modeled
  // airport) and the surface view (switch between the three airports with surface layouts).
  const searchScope: "network" | "surface" | null = zipView === "net" ? "network" : zipView === "sfc" ? "surface" : null;
  const searchable = useMemo(() => searchScope === "surface" ? locations.filter(place => (FOCUS_AIRPORTS as readonly string[]).includes(place.id)) : locations, [searchScope]);
  const searchMatches = useMemo(() => matchPlaces(searchable, searchText).slice(0, 6), [searchable, searchText]);
  useEffect(() => { setSearchText(""); setSearchOpen(false); setSearchError(null); }, [zipView]);

  useEffect(() => { serverVoiceRef.current = Boolean(serverStatus?.voice?.configured); }, [serverStatus]);
  useEffect(() => () => voiceRef.current?.stop(), []);

  useEffect(() => {
    fetch("/api/status").then(response => response.json()).then(setServerStatus).catch(() => setServerStatus(null));
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== zipFrameRef.current?.contentWindow) return;
      if (event.data?.type === "airspace-zip-proposal-result") {
        const pending = pendingProposalRef.current;
        if (!pending || event.data.requestId !== pending.requestId) return;
        const key = proposalKey(pending.proposal);
        const loaded = event.data.status === "loaded";
        setProposalHandoff({
          key,
          status: loaded ? "loaded" : "error",
          message: loaded
            ? `The ${pending.proposal.eventType.replaceAll("_", " ")} proposal for ${pending.proposal.locationId} is in the Simulation stack. Review its assumptions and settings before running it.`
            : "The proposal could not be added to the Simulation stack. Check that its location and event are supported, then try again.",
        });
        pendingProposalRef.current = null;
        return;
      }
      if (event.data?.type === "airspace-zip-view-changed" && views.includes(event.data.view)) {
        setZipView(event.data.view);
        return;
      }
      if (event.data?.type === "airspace-zip-alerts") {
        const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? value as number : 0;
        setAlerts({ critical: count(event.data.critical), warning: count(event.data.warning), total: count(event.data.total) });
        return;
      }
      if (event.data?.type === "airspace-zip-alert-raised") {
        const sev = event.data.sev as AlertSeverity;
        if (["critical", "warning", "watch", "info"].includes(sev) && typeof event.data.title === "string" && Number.isInteger(event.data.id)) {
          voiceRef.current?.announce({ id: event.data.id, sev, title: event.data.title.slice(0, 200) });
        }
        return;
      }
      if (event.data?.type === "airspace-zip-focus-changed" && FOCUS_AIRPORTS.includes(event.data.id)) {
        setFocusAirport(event.data.id);
        return;
      }
      if (event.data?.type === "airspace-zip-scenario" && Array.isArray(event.data.names)) {
        setScenarioNames(event.data.names.filter((name: unknown): name is string => typeof name === "string").slice(0, 6));
        return;
      }
      if (event.data?.type === "airspace-zip-selected" && (typeof event.data.id === "string" || event.data.id === null)) {
        setSelectedId(event.data.id);
      }
      const data = event.data;
      if (data?.type !== "airspace-zip-snapshot" || data.dataKind !== "synthetic_model"
        || (data.mode !== "demo" && data.mode !== "simulation")
        || !Number.isFinite(data.currentMinute) || !Number.isInteger(data.visibleCount)
        || !Number.isInteger(data.returnedCount) || !Number.isInteger(data.positionedCount)
        || !Array.isArray(data.aircraft) || data.aircraft.length > 60
        || !data.aircraft.every((plane: ZipAircraft) => typeof plane.id === "string"
          && Number.isFinite(plane.latitude) && plane.latitude >= -90 && plane.latitude <= 90
          && Number.isFinite(plane.longitude) && plane.longitude >= -180 && plane.longitude <= 180
          && (plane.groundSpeedMs === null || Number.isFinite(plane.groundSpeedMs)))
        || !Array.isArray(data.activeScenario) || !Array.isArray(data.assumptions)) return;
      setSnapshot({ ...data, receivedAt: Date.now() } as Zip2DSnapshot);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  function showView(view: ZipView) {
    setZipView(view);
    setPanel("overview");
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-view", view }, window.location.origin);
  }
  function toggleMuted() {
    const next = !muted;
    setMuted(next); mutedRef.current = next; saveMuted(next);
    if (next) voiceRef.current?.stop();
    else voiceRef.current?.announce({ id: 0, sev: "info", title: "Voice alerts on" });
  }
  function resetToStart() {
    voiceRef.current?.stop();
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-reset" }, window.location.origin);
  }
  function openGuide() {
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-guide" }, window.location.origin);
  }
  function chooseFocusAirport(id: FocusAirport) {
    setFocusAirport(id);
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-set-focus", id }, window.location.origin);
  }
  function chooseLocation(place: Place) {
    setSearchText(""); setSearchOpen(false); setSearchError(null);
    if (searchScope === "surface") { chooseFocusAirport(place.id as FocusAirport); return; }
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus", id: place.id, latitude: place.lat, longitude: place.lon }, window.location.origin);
  }
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const place = searchMatches[0];
    if (!place) {
      setSearchOpen(false);
      setSearchError(searchScope === "surface"
        ? "Surface layouts exist for JFK, LGA and EWR. Use the Network map to find other airports."
        : "No modeled airport matches that. Try a code like ATL or a city like Denver.");
      return;
    }
    chooseLocation(place);
  }
  function go(panelName: Panel) {
    if (panelName === panel) { setPanel("overview"); return; }
    if (panelName === "flights") { showView("net"); setPanel("flights"); return; }
    setPanel(panelName);
  }
  function runProposal(proposal: ScenarioProposal) {
    const handoff: ProposalHandoff = {
      requestId: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      proposal,
      startMinute: snapshot?.mode === "simulation" ? Math.max(0, Math.floor(snapshot.currentMinute)) : 0,
    };
    pendingProposalRef.current = handoff;
    setProposalHandoff({ key: proposalKey(proposal), status: "pending", message: "Adding the reviewed proposal to the Simulation stack…" });
    showView("lab"); setPanel("assistant");
    if (zipFrameReadyRef.current) {
      zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-scenario-proposal", ...handoff }, window.location.origin);
    }
  }
  function selectFlight(id: string) {
    setSelectedId(id); setPanel("flights");
    zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-focus-aircraft", id }, window.location.origin);
  }

  const selected = snapshot?.aircraft.find(plane => plane.id === selectedId) ?? null;
  const aiContext = {
    mode, view: "us", location: `${snapshot?.selectedAirport ?? "JFK"} · U.S. network`, sourceTimestamp: null,
    dataState: "ZIP 2D synthetic model", visibleCount: snapshot?.visibleCount ?? 0,
    returnedCount: snapshot?.returnedCount ?? 0, positionedCount: snapshot?.positionedCount ?? 0,
    selectedAircraftId: selectedId, selectedAirport: snapshot?.selectedAirport ?? "JFK",
    mapView: snapshot?.mapView ?? zipView, modelMinute: snapshot?.currentMinute ?? null,
    altitudeAvailability: snapshot?.altitudeAvailability ?? "not modeled by the ZIP simulation engine",
    activeScenario: snapshot?.activeScenario ?? [], assumptions: snapshot?.assumptions ?? [],
    aircraft: snapshot?.aircraft.slice(0, 30) ?? [],
  };
  const updatedAt = snapshot?.receivedAt ? new Date(snapshot.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting for map data";

  return <div className="portal">
    <aside className="portal-sidebar">
      <a className="portal-brand" href="/"><span className="brand-glyph"><Plane size={20} fill="currentColor"/></span><span>AeroFlo</span></a>
      <div className="sidebar-caption">Focus airport</div>
      <div className="focus-switch" role="radiogroup" aria-label="Focus airport">
        {FOCUS_AIRPORTS.map(id => <button key={id} role="radio" aria-checked={focusAirport === id} className={focusAirport === id ? "on" : ""} onClick={() => chooseFocusAirport(id)}
          title={`Focus the queue, runways, surface view, scenarios and alerts on ${id}`}>{id}</button>)}
      </div>
      <div className="sidebar-caption">Views</div>
      <nav aria-label="Simulator views">
        {views.map(view => {
          const Icon = viewIcon[view];
          const badge = view === "alr" && alerts.total > 0;
          return <button key={view} className={zipView === view ? "active" : ""} aria-current={zipView === view ? "page" : undefined} onClick={() => showView(view)}>
            <Icon size={16}/><span className="nav-text">{viewLabel[view]}</span>
            {badge && <span className={`nav-badge ${alerts.critical ? "critical" : alerts.warning ? "warning" : "info"}`} aria-label={`${alerts.total} active alerts`}>{alerts.critical || alerts.warning || alerts.total}</span>}
          </button>;
        })}
      </nav>
      <div className="sidebar-caption">Tools</div>
      <nav aria-label="Tools">
        <button className={panel === "flights" ? "active" : ""} aria-pressed={panel === "flights"} onClick={() => go("flights")}><List size={16}/><span className="nav-text">Flights</span></button>
        <button className={panel === "assistant" ? "active" : ""} aria-pressed={panel === "assistant"} onClick={() => go("assistant")}><Bot size={16}/><span className="nav-text">AI assistant</span></button>
        <button className={panel === "status" ? "active" : ""} aria-pressed={panel === "status"} onClick={() => go("status")}><Gauge size={16}/><span className="nav-text">Data status</span></button>
      </nav>
      <div className="sidebar-status" aria-live="polite">
        <span className="sidebar-status-label">Running</span>
        <strong>{scenarioNames.length ? scenarioNames.join(" + ") : "Baseline, no scenario"}</strong>
        <button className="reset-button" onClick={resetToStart} title="Clear every scenario and advisory response and restart the clock at minute 0. Saved comparison runs are kept.">
          <RotateCcw size={14}/><span>Reset to start</span>
        </button>
        <span className="sidebar-advisory" title="AeroFlo never issues clearances, directs aircraft or activates procedures.">Advisory only · synthetic traffic</span>
        <button className={`voice-toggle ${muted ? "muted" : ""}`} aria-pressed={!muted} onClick={toggleMuted}
          title={muted ? "Alerts are silent. Click to have new alerts read aloud." : "New alerts are read aloud. Click to mute."}>
          {muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
          <span>{muted ? "Voice alerts muted" : "Voice alerts on"}</span>
        </button>
      </div>
      <div className="sidebar-bottom">
        <button onClick={openGuide}><CircleHelp size={16}/> How it works</button>
        <button className={panel === "help" ? "active" : ""} onClick={() => go("help")}><Settings size={16}/> Setup & help</button>
        <a href="/"><ArrowLeft size={16}/> Landing page</a>
      </div>
    </aside>
    <div className={`portal-main ${searchScope ? "" : "no-header"}`}>
      {searchScope && <header className="portal-header">
        <div className="mobile-brand">AeroFlo</div>
        <form className="portal-search" role="search" onSubmit={submitSearch}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchOpen(false); }}
          onKeyDown={event => { if (event.key === "Escape") setSearchOpen(false); }}>
          <Search size={18}/>
          <input aria-label={searchScope === "surface" ? "Switch surface airport" : "Search airports on the map"} autoComplete="off"
            placeholder={searchScope === "surface" ? "Switch airport · JFK, LGA or EWR" : "Search 30 airports · ATL, Denver…"}
            value={searchText} onFocus={() => setSearchOpen(true)} onChange={event => { setSearchText(event.target.value); setSearchOpen(true); setSearchError(null); }}/>
          <button type="submit" aria-label={searchScope === "surface" ? "Switch airport" : "Show on map"}><ArrowRight size={17}/></button>
          {searchOpen && searchText.trim() && <div className="search-menu">{searchMatches.length
            ? searchMatches.map(place => <button key={place.id} type="button" onClick={() => chooseLocation(place)}><MapPin size={16}/><span><strong>{place.id}</strong> {place.name}<small>{place.city}{searchScope === "surface" && place.id === focusAirport ? " · showing now" : ""}</small></span></button>)
            : <div className="search-empty">{searchScope === "surface" ? "Surface layouts exist for JFK, LGA and EWR." : "No modeled airport matches."}</div>}</div>}
        </form>
        {searchScope === "surface" && <span className="header-context">Showing <strong>{focusAirport}</strong> surface</span>}
      </header>}
      {searchError && <div className="search-error" role="alert">{searchError}<button onClick={() => setSearchError(null)} aria-label="Dismiss search error"><X size={15}/></button></div>}
      <iframe ref={zipFrameRef} className="zip2d-frame" title="AeroFlo U.S. 2D flight workspace" src={`/zip2d/airspace.html?mode=${mode}&embed=1#${zipView}`} onLoad={() => {
        zipFrameReadyRef.current = true;
        zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-view", view: zipView }, window.location.origin);
        const pending = pendingProposalRef.current;
        if (pending) zipFrameRef.current?.contentWindow?.postMessage({ type: "airspace-zip-scenario-proposal", ...pending }, window.location.origin);
      }}/>
      {panel !== "overview" && <aside className={`portal-drawer ${panel === "assistant" ? "portal-drawer-assistant" : ""}`} aria-label={`${panel} panel`}>
        {panel === "assistant" ? <Assistant
          configured={Boolean(serverStatus?.ai.configured)}
          providerState={serverStatus?.ai.state ?? "unverified"}
          context={aiContext}
          proposalHandoff={proposalHandoff}
          onRunProposal={runProposal}
          onProviderChange={state => setServerStatus(previous => previous ? { ...previous, ai: { ...previous.ai, state } } : previous)}
          onClose={() => setPanel("overview")}
        /> : <>
          <div className="inspector-top"><span className="eyeline">{panel === "status" ? "DATA STATUS" : panel === "help" ? "SETUP & HELP" : "FLIGHT RECORDS"}</span><button onClick={() => setPanel("overview")} aria-label="Close panel">Close</button></div>
          {panel === "flights" ? <FlightList aircraft={snapshot?.aircraft ?? []} selectedId={selectedId} onSelect={selectFlight} selected={selected}/>
            : panel === "status" ? <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">2D MODEL HEALTH</span><h2>Source status</h2></div></div><p className="panel-intro">The U.S. 2D workspace runs its bundled model locally in your browser.</p><div className="status-table"><StatusRow label="Map" value={snapshot ? "Loaded · U.S. 2D" : "Loading"} good={Boolean(snapshot)}/><StatusRow label="Traffic" value={snapshot ? "Synthetic model" : "Waiting for iframe"} good={Boolean(snapshot)}/><StatusRow label="Voice alerts" value={muted ? "Muted" : serverStatus?.voice?.configured ? "ElevenLabs voice" : "Browser voice (no ElevenLabs key)"} good={!muted && Boolean(serverStatus?.voice?.configured)}/><StatusRow label="AI provider" value={serverStatus?.ai.configured ? serverStatus.ai.state === "working" ? "Checked · working" : "Configured · unverified" : "Not configured"} good={serverStatus?.ai.state === "working"}/></div><div className="detail-list"><Detail label="Last model update" value={updatedAt}/><Detail label="View" value={viewLabel[zipView]}/><Detail label="Aircraft in view" value={String(snapshot?.visibleCount ?? 0)}/><Detail label="Model time" value={snapshot ? `${Math.floor(snapshot.currentMinute)} min` : "Unavailable"}/><Detail label="Active scenario events" value={String(snapshot?.activeScenario.length ?? 0)}/></div><p className="microcopy">Flight records and scenario outcomes in this map are model-generated. Coverage and route positions are illustrative.</p></div>
            : <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">{isLocalDevelopment() ? "LOCAL SETUP" : "VERCEL SETUP"}</span><h2>Setup & help</h2></div></div><p className="panel-intro">The 2D map does not require a map token. Configure the optional AI provider on the server.</p>{isLocalDevelopment() ? <><div className="help-step"><span>01</span><div><strong>Install and start</strong><code>npm install<br/>npm run dev</code></div></div><div className="help-step"><span>02</span><div><strong>Enable AI if wanted</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>. Put it in your local <code>.env.local</code> file.</p><code>GROQ_API_KEY=your_groq_api_key</code><p>Restart the server. Keep this key server-side; do not paste it into this page or chat.</p></div></div><div className="help-step"><span>03</span><div><strong>Spoken alerts if wanted</strong><p>Put an ElevenLabs key in the same <code>.env.local</code> file and restart. Without it, alerts use the browser's built-in voice.</p><code>ELEVENLABS_API_KEY=your_elevenlabs_key</code></div></div></> : <><div className="help-step"><span>01</span><div><strong>Open environment settings</strong><p>Add server variables for Production, then create a new deployment.</p><a className="text-button setup-link" href={VERCEL_ENVIRONMENT_SETTINGS_URL} target="_blank" rel="noreferrer">Open Vercel environment settings</a></div></div><div className="help-step"><span>02</span><div><strong>Optional AI assistant</strong><p><a href={GROQ_API_KEYS_URL} target="_blank" rel="noreferrer">Create a Groq API key</a>, then add it as <code>GROQ_API_KEY</code>. Keep it server-only.</p></div></div><div className="help-step"><span>03</span><div><strong>Optional spoken alerts</strong><p>Add an ElevenLabs key as <code>ELEVENLABS_API_KEY</code>. Without it, alerts use the browser's built-in voice.</p></div></div></>}<p className="microcopy">More details and service terms are in the project README.</p></div>}
        </>}
      </aside>}
    </div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>; }
function StatusRow({ label, value, good }: { label: string; value: string; good: boolean }) { return <div className="status-row"><span>{label}</span><strong><i className={`status-dot ${good ? "good" : "amber"}`}/>{value}</strong></div>; }
function FlightList({ aircraft, selectedId, onSelect, selected }: { aircraft: ZipAircraft[]; selectedId: string | null; onSelect: (id: string) => void; selected: ZipAircraft | null }) {
  const [filter, setFilter] = useState("");
  const list = aircraft.filter(plane => `${plane.callsign ?? ""} ${plane.id} ${plane.originAirport ?? ""} ${plane.destinationAirport ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="panel-content"><div className="panel-heading"><div><span className="eyeline">CURRENT MODEL VIEW</span><h2>Flights</h2></div></div><p className="panel-intro">{aircraft.length} positioned records in the latest model snapshot.</p><div className="flight-filter"><Search size={16}/><input aria-label="Filter flights" placeholder="Filter by callsign, ID or airport" value={filter} onChange={event => setFilter(event.target.value)}/></div><div className="flight-list">{list.length ? list.map(plane => <button className={selectedId === plane.id ? "active" : ""} key={plane.id} onClick={() => onSelect(plane.id)}><Plane size={17}/><span><strong>{plane.callsign ?? plane.id.toUpperCase()}</strong><small>{plane.originAirport ?? "Unavailable"} → {plane.destinationAirport ?? "Unavailable"}</small></span><span className="flight-alt">{plane.status}</span></button>) : <div className="flight-empty">{aircraft.length ? "No records match that filter." : "Waiting for the 2D model snapshot."}</div>}</div>{selected && <div className="detail-list"><Detail label="Position" value={`${selected.latitude.toFixed(3)}°, ${selected.longitude.toFixed(3)}°`}/><Detail label="Ground speed" value={selected.groundSpeedMs === null ? "Unavailable" : `${Math.round(selected.groundSpeedMs * 1.94384)} kt`}/><Detail label="Track" value={selected.trackDeg === null ? "Unavailable" : `${Math.round(selected.trackDeg)}°`}/><Detail label="Source" value={selected.source}/><Detail label="Data type" value="Synthetic model position"/></div>}</div>;
}
