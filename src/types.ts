export type Mode = "live" | "simulation";
export type MapKind = "local" | "us";
export type PositionKind = "measured" | "estimated" | "stale" | "simulated" | "historical";
export type EventType = "none" | "runway_closure" | "weather_delay" | "traffic_surge" | "generic_disruption";

export interface Location {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}
export interface Aircraft {
  id: string;
  callsign: string | null;
  originCountry: string | null;
  latitude: number | null;
  longitude: number | null;
  baroAltitudeM: number | null;
  geoAltitudeM: number | null;
  groundSpeedMs: number | null;
  trackDeg: number | null;
  verticalRateMs: number | null;
  onGround: boolean | null;
  positionTime: number | null;
  lastContact: number | null;
  positionSource: string | null;
  source: string;
  kind: "live" | "simulated";
  positionKind?: PositionKind;
}
export interface TrailPoint { latitude: number; longitude: number; altitudeM: number | null; time: number }
export type Trails = Record<string, TrailPoint[]>;
export interface LiveResponse {
  state: "connected" | "stale" | "error" | "not_configured" | "loading";
  configured: boolean;
  source: string;
  area: string;
  bounds: number[];
  aircraft: Aircraft[];
  returnedCount: number;
  positionedCount: number;
  snapshotTime: number | null;
  lastSuccess: number | null;
  stale: boolean;
  error: string | null;
  nextPollAt: number | null;
  remainingCredits: number | null;
  trails: Trails;
}
export interface ReplayFrame { timestamp: number; aircraft: Aircraft[] }
export interface Scenario {
  id: string;
  name: string;
  locationId: string;
  eventType: EventType;
  durationMinutes: number;
  syntheticAircraftCount: number;
  description: string;
  seed: number;
  pattern: "local" | "cross_country";
  assumptions: string[];
}
export interface ScenarioProposal {
  locationId: string;
  locationName: string;
  latitude: number;
  longitude: number;
  eventType: Exclude<EventType, "none">;
  durationMinutes: number;
  syntheticAircraftCount: number;
  description: string;
}
export interface AiReply {
  kind: "answer" | "proposal";
  answer: string;
  evidence: string[];
  assumptions: string[];
  proposal: ScenarioProposal | null;
  source: string;
  sourceTimestamp: number | null;
  label: string;
}
export interface AssetStatus {
  imagery: "loading" | "ion" | "osm" | "fallback" | "error";
  terrain: "loading" | "ion" | "ellipsoid" | "error";
  buildings: "loading" | "ion" | "unavailable" | "not_requested";
  model: "loading" | "ready" | "fallback";
  message: string | null;
}
