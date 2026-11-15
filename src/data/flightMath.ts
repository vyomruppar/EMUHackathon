import type { Aircraft } from "../types";

const EARTH_RADIUS_M = 6_371_000;
export const POSITION_UPDATE_INTERVAL_MS = 10_000;
const MAX_ESTIMATED_POSITION_AGE_SECONDS = 180;
// Cesium's default glTF correction points a +Z-forward model along local +X (east).
// HeadingPitchRoll rotates +X clockwise from east, while ADS-B track is clockwise from north.
export function cesiumHeadingFromTrackDeg(trackDeg: number) {
  const normalizedTrack = ((trackDeg % 360) + 360) % 360;
  return (normalizedTrack - 90) * Math.PI / 180;
}
export function movePosition(lat: number, lon: number, headingDeg: number, distanceM: number) {
  const bearing = headingDeg * Math.PI / 180;
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180;
  const angular = distanceM / EARTH_RADIUS_M;
  const nextLat = Math.asin(Math.sin(latitude) * Math.cos(angular) + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing));
  const nextLon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude), Math.cos(angular) - Math.sin(latitude) * Math.sin(nextLat));
  return { latitude: nextLat * 180 / Math.PI, longitude: ((nextLon * 180 / Math.PI + 540) % 360) - 180 };
}
export function displayLivePosition(aircraft: Aircraft, nowMs: number, stale: boolean): Aircraft {
  const age = aircraft.positionTime === null ? Infinity : nowMs / 1000 - aircraft.positionTime;
  if (stale) return { ...aircraft, positionKind: "stale" };
  if (aircraft.latitude === null || aircraft.longitude === null) {
    return { ...aircraft, positionKind: "measured" };
  }
  if (age > MAX_ESTIMATED_POSITION_AGE_SECONDS) return { ...aircraft, positionKind: "stale" };
  if (aircraft.groundSpeedMs === null || aircraft.trackDeg === null || age < 0) {
    return { ...aircraft, positionKind: "measured" };
  }
  const next = movePosition(aircraft.latitude, aircraft.longitude, aircraft.trackDeg, Math.max(0, age) * aircraft.groundSpeedMs);
  return { ...aircraft, ...next, positionKind: "estimated" };
}
export function altitudeM(aircraft: Aircraft) { return aircraft.geoAltitudeM ?? aircraft.baroAltitudeM ?? 0; }
