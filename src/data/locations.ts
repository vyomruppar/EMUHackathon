import raw from "../../shared/locations.json";
import type { Location } from "../types";

export const locations: Location[] = raw;
export const JFK = locations[0];
export function findLocation(query: string): Location | null {
  const value = query.trim().toLowerCase();
  if (!value) return null;
  return locations.find(place => place.id.toLowerCase() === value)
    ?? locations.find(place => place.city.toLowerCase() === value)
    ?? locations.find(place => `${place.name} ${place.city} ${place.id}`.toLowerCase().includes(value))
    ?? null;
}
