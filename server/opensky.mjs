const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";
const US_BOUNDS = [24.5, -125, 49.5, -66.5];
const MAX_HISTORY_MS = 60 * 60 * 1000;
const MAX_TRAIL_MS = 30 * 60 * 1000;
const cache = new Map();
let token = null, tokenExpires = 0, remainingCredits = null, rateLimitedUntil = 0;

function validNumber(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function optionalNumber(value, min, max) { return value == null ? null : validNumber(value, min, max); }
export function normalizeState(row) {
  if (!Array.isArray(row) || typeof row[0] !== "string" || !/^[0-9a-f]{6}$/i.test(row[0])) return null;
  const latitude = optionalNumber(row[6], -90, 90);
  const longitude = optionalNumber(row[5], -180, 180);
  const positionTime = optionalNumber(row[3], 0, 4_000_000_000);
  return {
    id: row[0].toLowerCase(),
    callsign: typeof row[1] === "string" && row[1].trim() ? row[1].trim() : null,
    originCountry: typeof row[2] === "string" && row[2].trim() ? row[2] : null,
    latitude, longitude,
    baroAltitudeM: optionalNumber(row[7], -2000, 50000),
    geoAltitudeM: optionalNumber(row[13], -2000, 50000),
    groundSpeedMs: optionalNumber(row[9], 0, 1500),
    trackDeg: optionalNumber(row[10], 0, 360),
    verticalRateMs: optionalNumber(row[11], -200, 200),
    onGround: typeof row[8] === "boolean" ? row[8] : null,
    positionTime: latitude !== null && longitude !== null ? positionTime : null,
    lastContact: optionalNumber(row[4], 0, 4_000_000_000),
    positionSource: [0, 1, 2, 3].includes(row[16]) ? ["ADS-B", "ASTERIX", "MLAT", "FLARM"][row[16]] : null,
    source: "OpenSky Network",
    kind: "live",
  };
}
export function areaFromQuery(params) {
  if (params.get("area") === "us") return { key: "us", label: "Contiguous United States", bounds: US_BOUNDS, intervalMs: 180_000 };
  const lat = Number(params.get("lat") ?? 40.6413), lon = Number(params.get("lon") ?? -73.7781);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 24 || lat > 50 || lon < -125 || lon > -66) throw new Error("Choose a location in the contiguous United States.");
  const snappedLat = Math.round(lat * 5) / 5, snappedLon = Math.round(lon * 5) / 5;
  return { key: `local:${snappedLat}:${snappedLon}`, label: "Local airspace", bounds: [Math.max(24, snappedLat - 1.2), Math.max(-125, snappedLon - 1.8), Math.min(50, snappedLat + 1.2), Math.min(-66, snappedLon + 1.8)], intervalMs: 90_000 };
}
function entry(area) {
  if (!cache.has(area.key)) cache.set(area.key, { latest: null, lastSuccess: null, error: null, frames: [], trails: new Map(), inFlight: null, nextPollAt: 0 });
  return cache.get(area.key);
}
async function timeoutFetch(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
}
async function accessToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.OPENSKY_CLIENT_ID, client_secret: process.env.OPENSKY_CLIENT_SECRET });
  const response = await timeoutFetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(response.status === 400 || response.status === 401 ? "OpenSky authentication failed. Check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in the server environment." : "OpenSky authentication is unavailable. Try again later.");
  let data;
  try { data = await response.json(); } catch { throw new Error("OpenSky did not return a usable access token."); }
  if (typeof data.access_token !== "string") throw new Error("OpenSky did not return a usable access token.");
  token = data.access_token;
  tokenExpires = Date.now() + Math.min(Number(data.expires_in) || 1800, 1800) * 1000;
  return token;
}
async function statesRequest(area, retry = true) {
  const p = new URLSearchParams({ lamin: String(area.bounds[0]), lomin: String(area.bounds[1]), lamax: String(area.bounds[2]), lomax: String(area.bounds[3]) });
  const response = await timeoutFetch(`${STATES_URL}?${p}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const rawCredits = response.headers.get("X-Rate-Limit-Remaining");
  if (rawCredits !== null && /^\d+$/.test(rawCredits)) remainingCredits = Number(rawCredits);
  if (response.status === 401 && retry) { token = null; return statesRequest(area, false); }
  if (response.status === 401 || response.status === 403) throw new Error("OpenSky rejected access. Check your OAuth2 client credentials and account permissions.");
  if (response.status === 429) {
    const retryAfter = Math.max(60, Number(response.headers.get("X-Rate-Limit-Retry-After-Seconds")) || 300);
    rateLimitedUntil = Date.now() + retryAfter * 1000;
    throw new Error(`OpenSky rate limit reached. Retrying after ${Math.ceil(retryAfter / 60)} minute(s).`);
  }
  if (!response.ok) throw new Error(response.status >= 500 ? "OpenSky is temporarily unavailable." : `OpenSky request failed (HTTP ${response.status}).`);
  let data;
  try { data = await response.json(); } catch { throw new Error("OpenSky returned an unreadable response. No new positions were used."); }
  if (!data || !(data.states === null || Array.isArray(data.states)) || !Number.isFinite(data.time)) throw new Error("OpenSky returned an unexpected response. No new positions were used.");
  return { aircraft: (data.states ?? []).map(normalizeState).filter(Boolean), snapshotTime: data.time * 1000 };
}
function updateHistory(current, snapshot) {
  const now = Date.now();
  current.frames.push({ timestamp: snapshot.snapshotTime, aircraft: snapshot.aircraft });
  current.frames = current.frames.filter(f => now - f.timestamp <= MAX_HISTORY_MS).slice(-42);
  const seen = new Set();
  for (const a of snapshot.aircraft) {
    if (a.latitude === null || a.longitude === null || a.positionTime === null) continue;
    seen.add(a.id);
    const trail = current.trails.get(a.id) ?? [];
    if (trail.at(-1)?.time !== a.positionTime) trail.push({ latitude: a.latitude, longitude: a.longitude, altitudeM: a.geoAltitudeM ?? a.baroAltitudeM, time: a.positionTime });
    current.trails.set(a.id, trail.filter(p => now - p.time * 1000 <= MAX_TRAIL_MS).slice(-22));
  }
  for (const id of current.trails.keys()) if (!seen.has(id)) current.trails.delete(id);
}
async function refresh(area, current) {
  const started = Date.now();
  try {
    const snapshot = await statesRequest(area);
    current.latest = snapshot;
    current.lastSuccess = Date.now();
    current.error = null;
    updateHistory(current, snapshot);
  } catch (error) {
    const causeCode = typeof error?.cause?.code === "string" && /^[A-Z0-9_]{2,40}$/.test(error.cause.code) ? error.cause.code : null;
    current.error = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? "OpenSky did not respond before the server timeout. Showing the last successful response if available."
      : error?.message === "fetch failed"
        ? `The AIRSPACE server could not connect to OpenSky${causeCode ? ` (${causeCode})` : ""}. Check server network access and OpenSky availability; showing the last successful response if available.`
        : error?.message ?? "OpenSky could not be reached.";
  } finally {
    const lowCredits = remainingCredits !== null && remainingCredits < 1000;
    current.nextPollAt = Math.max(started + area.intervalMs * (lowCredits ? 3 : 1), rateLimitedUntil);
    current.inFlight = null;
  }
}
export async function getLive(area) {
  const current = entry(area);
  const configured = Boolean(process.env.OPENSKY_CLIENT_ID?.trim() && process.env.OPENSKY_CLIENT_SECRET?.trim()
    && !process.env.OPENSKY_CLIENT_ID.startsWith("your_") && !process.env.OPENSKY_CLIENT_SECRET.startsWith("your_"));
  if (!configured) {
    return { state: "not_configured", configured: false, source: "OpenSky Network", area: area.label, bounds: area.bounds, aircraft: [], returnedCount: 0, positionedCount: 0, snapshotTime: null, lastSuccess: null, stale: false, error: "OpenSky is not configured. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to the server environment, then restart or redeploy.", nextPollAt: null, remainingCredits: null, trails: {} };
  }
  if (remainingCredits !== null && remainingCredits <= 100) {
    current.error = "OpenSky credit reserve reached. Polling paused to protect the daily allowance.";
    current.nextPollAt = Date.now() + 3_600_000;
  } else if (Date.now() >= current.nextPollAt && !current.inFlight) {
    current.inFlight = refresh(area, current);
  }
  if (current.inFlight) await current.inFlight;
  const latest = current.latest;
  const trails = {};
  for (const [id, points] of current.trails) if (points.length > 1) trails[id] = points;
  const stale = Boolean(current.error && latest);
  return {
    state: current.error ? (stale ? "stale" : "error") : latest ? "connected" : "loading",
    configured: true, source: "OpenSky Network", area: area.label, bounds: area.bounds,
    aircraft: latest?.aircraft ?? [], returnedCount: latest?.aircraft.length ?? 0,
    positionedCount: latest?.aircraft.filter(a => a.latitude !== null && a.longitude !== null).length ?? 0,
    snapshotTime: latest?.snapshotTime ?? null, lastSuccess: current.lastSuccess,
    stale, error: current.error, nextPollAt: current.nextPollAt,
    remainingCredits, trails,
  };
}
export function getReplay(area) { return { source: "OpenSky Network", frames: entry(area).frames }; }
