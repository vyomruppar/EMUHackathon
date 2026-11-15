export type Mode = "demo" | "simulation";
export type EventType = "none" | "runway_closure" | "weather_delay" | "traffic_surge" | "generic_disruption";

export interface Location {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
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
