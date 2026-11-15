import { locations, JFK } from "../data/locations";
import { movePosition } from "../data/flightMath";
import type { Aircraft, Scenario, ScenarioProposal, TrailPoint, Trails } from "../types";

export const presets: Scenario[] = [
  { id: "jfk-flow", name: "JFK local flow", locationId: "JFK", eventType: "none", durationMinutes: 45, syntheticAircraftCount: 9, description: "A small synthetic traffic sample around JFK.", seed: 1207, pattern: "local", assumptions: ["All aircraft are synthetic generic jets.", "Each follows a simple straight-line path at constant speed."] },
  { id: "coast-to-coast", name: "Coast-to-coast sample", locationId: "JFK", eventType: "none", durationMinutes: 120, syntheticAircraftCount: 8, description: "Synthetic east-to-west routes across the U.S.", seed: 831, pattern: "cross_country", assumptions: ["Routes are illustrative straight lines, not filed flight plans.", "All positions and timing are generated locally."] },
  { id: "jfk-closure", name: "Hypothetical JFK closure", locationId: "JFK", eventType: "runway_closure", durationMinutes: 30, syntheticAircraftCount: 12, description: "A hypothetical 30-minute capacity reduction for synthetic JFK traffic.", seed: 4242, pattern: "local", assumptions: ["No runway designation or real closure is asserted.", "65% of synthetic traffic progresses at 55% of baseline during the event.", "This toy model does not represent real airport procedures."] },
];
export function scenarioFromProposal(proposal: ScenarioProposal): Scenario {
  return { id: `ai-${Date.now()}`, name: `${proposal.locationId} hypothetical ${proposal.eventType.replaceAll("_", " ")}`, locationId: proposal.locationId, eventType: proposal.eventType, durationMinutes: proposal.durationMinutes, syntheticAircraftCount: proposal.syntheticAircraftCount, description: proposal.description, seed: Math.abs([...proposal.description].reduce((n, c) => n * 31 + c.charCodeAt(0), 7)) % 100_000, pattern: "local", assumptions: ["All aircraft and paths are synthetic.", "Straight-line motion and fixed speeds are used.", "A generic capacity reduction stands in for the event; real procedures are not modeled."] };
}
export function customScenario(input: { locationId: string; eventType: Scenario["eventType"]; durationMinutes: number; syntheticAircraftCount: number }): Scenario {
  const location = locations.find(x => x.id === input.locationId) ?? JFK;
  return { id: `custom-${Date.now()}`, name: `${location.id} custom ${input.eventType.replaceAll("_", " ")}`, locationId: location.id, eventType: input.eventType, durationMinutes: Math.min(240, Math.max(5, input.durationMinutes)), syntheticAircraftCount: Math.min(40, Math.max(1, input.syntheticAircraftCount)), description: `Custom hypothetical ${input.eventType.replaceAll("_", " ")} near ${location.id}.`, seed: Date.now() % 100_000, pattern: "local", assumptions: ["All aircraft and paths are synthetic.", "Simple straight-line routes and constant speeds are used.", "Effects are illustrative model estimates only."] };
}
function hash(seed: number, index: number) {
  let n = (seed + index * 374761393) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}
function affected(scenario: Scenario, index: number) { return scenario.eventType !== "none" && hash(scenario.seed, index + 51) < (scenario.eventType === "traffic_surge" ? 0.8 : 0.65); }
function eventRate(scenario: Scenario, index: number) {
  if (!affected(scenario, index)) return 1;
  return scenario.eventType === "runway_closure" ? 0.55 : scenario.eventType === "weather_delay" ? 0.7 : scenario.eventType === "traffic_surge" ? 0.78 : 0.8;
}
function progressRate(scenario: Scenario, index: number, seconds: number) {
  return seconds >= scenario.durationMinutes * 60 ? 1 : eventRate(scenario, index);
}
function progressSeconds(scenario: Scenario, index: number, seconds: number) {
  if (!affected(scenario, index)) return seconds;
  const eventSeconds = Math.min(seconds, scenario.durationMinutes * 60);
  const multiplier = eventRate(scenario, index);
  return seconds - eventSeconds * (1 - multiplier);
}
export function simulationAircraft(scenario: Scenario, seconds: number): Aircraft[] {
  const origin = locations.find(x => x.id === scenario.locationId) ?? JFK;
  const time = Math.min(Math.max(seconds, 0), scenario.durationMinutes * 60);
  return Array.from({ length: scenario.syntheticAircraftCount }, (_, index) => {
    const h1 = hash(scenario.seed, index * 3 + 1), h2 = hash(scenario.seed, index * 3 + 2);
    const track = scenario.pattern === "cross_country" ? 245 + h1 * 40 : (index * 137.5 + h1 * 25) % 360;
    const baseSpeed = scenario.pattern === "cross_country" ? 200 + h2 * 30 : 75 + h2 * 45;
    const start = scenario.pattern === "cross_country"
      ? { latitude: 39 + h1 * 6, longitude: -72 - h2 * 4 }
      : movePosition(origin.lat, origin.lon, (track + 180) % 360, 3_000 + h1 * 13_000);
    const elapsed = progressSeconds(scenario, index, time) + (scenario.pattern === "cross_country" ? index * 950 : 0);
    const next = movePosition(start.latitude, start.longitude, track, elapsed * baseSpeed);
    const speed = baseSpeed * progressRate(scenario, index, time);
    const altitude = scenario.pattern === "cross_country" ? 8500 + Math.round(h1 * 2400) : 800 + Math.round(h1 * 4200);
    return {
      id: `SIM-${String(index + 1).padStart(3, "0")}`, callsign: `SIM${String(index + 1).padStart(3, "0")}`, originCountry: null,
      latitude: next.latitude, longitude: next.longitude, geoAltitudeM: altitude, baroAltitudeM: null,
      groundSpeedMs: speed, trackDeg: track, verticalRateMs: 0, onGround: false,
      positionTime: null, lastContact: null, positionSource: null, source: "AIRSPACE simulation",
      kind: "simulated", positionKind: "simulated",
    };
  });
}
export function simulationTrails(scenario: Scenario, seconds: number): Trails {
  const trails: Trails = {};
  if (seconds <= 0) return trails;
  const samples = Math.min(16, Math.max(2, Math.ceil(seconds / 120)));
  for (let step = 0; step <= samples; step++) {
    const time = seconds * step / samples;
    for (const aircraft of simulationAircraft(scenario, time)) {
      const point: TrailPoint = { latitude: aircraft.latitude!, longitude: aircraft.longitude!, altitudeM: aircraft.geoAltitudeM, time };
      (trails[aircraft.id] ??= []).push(point);
    }
  }
  return trails;
}
export function scenarioEstimate(scenario: Scenario) {
  const affectedCount = scenario.eventType === "none" ? 0 : Array.from({ length: scenario.syntheticAircraftCount }, (_, i) => affected(scenario, i)).filter(Boolean).length;
  const factor = scenario.eventType === "runway_closure" ? 0.45 : scenario.eventType === "weather_delay" ? 0.3 : scenario.eventType === "traffic_surge" ? 0.22 : scenario.eventType === "generic_disruption" ? 0.2 : 0;
  const aggregateDelayMinutes = Math.round(affectedCount * scenario.durationMinutes * factor);
  return { affectedCount, aggregateDelayMinutes, totalAircraft: scenario.syntheticAircraftCount, assumptions: scenario.assumptions };
}
