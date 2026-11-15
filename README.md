# AIRSPACE

An educational flight tracking and simulation portal. The landing page opens a portal with a CesiumJS Local 3D view, a self-contained U.S. 2D canvas view, and separate **Live Data** and **Simulation** modes. Live positions come only from OpenSky through the local server. Synthetic aircraft never enter the live feed.

> Public flight data and simulations for education and research. Not for operational use.

## Start locally

Use Node.js 22.12 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/). The portal is at `/portal`; the API runs on `127.0.0.1:8787` and is proxied by Vite. Edit `.env.local` on your own machine, then restart `npm run dev` after changing any setting. The example file contains placeholders, so a new install starts in clear setup states rather than trying to use them as credentials. The landing preview and Simulation Mode work before any account is configured.

To enable AI locally, create a Groq API key at [Groq Console](https://console.groq.com/keys), replace the `GROQ_API_KEY` placeholder in `.env.local`, and restart the server. The key is sent only from the backend to Groq; do not prefix it with `VITE_` or paste it into the website or chat.

| Setting | Where it is read | Purpose |
| --- | --- | --- |
| `VITE_CESIUM_ION_TOKEN` | Browser, through `import.meta.env.VITE_CESIUM_ION_TOKEN` | Cesium aerial imagery, terrain, buildings, and general place search. This is a **public-client token**, not a private server secret. Restrict its `assets:read` scope, allowed assets, and allowed URLs in Cesium ion. |
| `OPENSKY_CLIENT_ID` | API server only | OpenSky OAuth2 client credentials. |
| `OPENSKY_CLIENT_SECRET` | API server only | OpenSky OAuth2 client credentials. |
| `GROQ_API_KEY` | API server only | Optional Groq API key for the AI Assistant. |
| `GROQ_MODEL` | API server only | Optional Groq model override; defaults to `openai/gpt-oss-20b`. |

Do not use a `VITE_` prefix for OpenSky or AI credentials. `.env`, `.env.local`, and other local environment files are ignored by Git; `.env.example` is safe to share. The browser token is embedded in the client build by Vite, so do not use a broad or privileged ion token.

## Sharing this project

The share archive contains the full app source, the included 2D workspace, setup examples, and this guide. It intentionally excludes `.env.local`, other private environment files, `node_modules`, and generated build output. Each teammate should create their own `.env.local` from `.env.example` and use credentials issued to them or to the team. Do not send API keys in email/chat or commit them to source control.

The AIRSPACE landing page and Simulation Mode work without API credentials. Live OpenSky data, extended Cesium ion layers/search, and the Groq Assistant each require their own configuration. `GROQ_API_KEY`, `OPENSKY_CLIENT_ID`, and `OPENSKY_CLIENT_SECRET` are private server credentials. `VITE_CESIUM_ION_TOKEN` is intentionally included in browser code at build time; use a restricted public-client ion token and limit its allowed assets and URLs. The same variable names and visibility rules apply when configured in Vercel.

When a teammate changes environment variables in Vercel, they must create a new deployment before the running app uses the updated configuration. Never use AIRSPACE's Live Data view or its simulations for operational aviation decisions.

## Portal guide

- **Local 3D:** starts with the camera looking at JFK. Drag to pan and rotate, use the mouse wheel or map buttons to zoom, and tilt with Cesium's standard 3D controls. Select an aircraft and choose **Focus aircraft on map** to inspect its close-range 3D model. Search the included airport and city list without ion; an ion token enables wider geocoder search inside the contiguous U.S.
- **US 2D:** displays the supplied ZIP's complete standalone interface, assembled from its original source files in `vendor/zip2d/` and served as `public/zip2d/airspace.html`. Its Network, JFK Surface, What-If Lab, Degraded Ops, Alerts, layer switches, panels, timeline, map gestures, and styling are preserved. Its original schematic base map is self-contained and does not request a map API. In Live Data, a small same-origin bridge supplies AIRSPACE's OpenSky records and replaces the ZIP's synthetic flight display. In Simulation, the ZIP's original synthetic model and controls run inside the ZIP interface. The ZIP map's geography and sectors are schematic, not verified airspace boundaries.
- **Flights:** choose an aircraft in the map or list. The same selected ID is used in both map views. Unknown airline, type, origin, and destination stay **Unavailable**.
- **Replay:** captures successful OpenSky snapshots in the browser session while Live Data is active, with the API process cache as an additional source. It requires at least two captured updates for the area. The current browser keeps up to 42 local-area frames or 12 U.S.-wide frames for one hour, so replay works across serverless function instances without storing traffic in a shared service. Recent paths are built from those frames; replay does not call a historical OpenSky endpoint.
- **Simulation:** choose a preset, create a custom location/event/duration/count, or review an AI proposal. Start, pause, resume, reset, scrub time, and choose a speed from 0.5× to 8×. Aircraft position samples update every 10 seconds and the map animates between them from synthetic speed and track. Local sample speeds are 75–120 m/s; cross-country samples use 200–230 m/s. The comparison panel shows two synthetic scenarios and their assumptions. Its aggregate delay number is an abstract progress deficit, not a real airport delay forecast.
- **AI Assistant:** when configured, asks Groq about the visible map and can propose a synthetic scenario with a validated location, event type, duration, and traffic count. The proposal displays assumptions and waits for **Confirm & load simulation**. It cannot change the live feed, issue aircraft instructions, or start the scenario itself. When the key is absent, the panel links to Groq Console and says where to configure it.
- **Data Status:** reports the local 2D base map or 3D map layers and model, OpenSky connection, last success, snapshot age, polling, and AI provider check state. “Configured · unverified” means no successful AI request has been observed yet.

Live interpolation uses a reported position, ground speed, and track only when all are present, for up to 180 seconds after the position timestamp. Interpolated points are labeled **Estimated between updates** and the map moves them smoothly between 10-second display updates. Older reports are labeled **stale** and are not projected. This is client-side animation, not faster polling: OpenSky requests remain no more frequent than 90 seconds for a local area and 180 seconds for the U.S. If the API fails after a successful response, the browser retains that response and labels it **stale**. The app never substitutes simulation aircraft in Live Data Mode.

## Data and service limits

The [current OpenSky REST documentation](https://openskynetwork.github.io/opensky-api/rest.html) specifies OAuth2 client credentials, a 30-minute bearer token, and `GET /states/all` with WGS84 bounding box parameters. State vectors include ICAO24, callsign, position, altitudes, velocity, track, vertical rate, on-ground state, timestamps, and position source. They do **not** provide a verified airline, aircraft type, route, origin airport, or destination airport. OpenSky says coverage and data quality are not guaranteed.

OpenSky's documented standard-user allowance is 4,000 daily `/states/*` credits, with a 1–4 credit cost for `/states/all` depending on area; a U.S.-wide box costs 4. This app caches by area, requests no more often than 90 seconds for a local area and 180 seconds for the U.S., slows below 1,000 remaining credits, pauses near a 100-credit reserve, and honors the documented `429` retry header. On Vercel, `/api/live` responses are also cached at the CDN only until the next allowed poll time; the browser still receives `no-store`, and area coordinates are normalized so equivalent map views use the same cache key. Because CDN caches are regional, this reduces repeated requests but does not guarantee one global OpenSky request across every region. The browser pauses its requests when hidden and while Simulation or Replay is active. These are safeguards, not a guarantee of a particular account's allowance. The API shows errors and the last good response without hiding their age.

Read [OpenSky's terms](https://opensky-network.org/about/terms-of-use) before using live data. Its standard authorization is for non-profit education and research; commercial use and operational REST API use require a written license. The terms also restrict redistribution of received data. This project is intended for local educational use. Do not publish a public live-data deployment without resolving those license and distribution requirements with OpenSky.

Cesium ion is optional for using the portal, but **aerial imagery, World Terrain, and OSM Buildings require permitted ion assets**. When the token is absent or ion assets fail, the map labels the fallback: normal interactive [OpenStreetMap tiles](https://operations.osmfoundation.org/policies/tiles/) with visible attribution and an ellipsoid. If those tiles fail, Cesium's bundled Natural Earth map is shown and labeled. These fallbacks do not contain satellite imagery, measured airport geometry, or 3D buildings. The portal uses only tiles needed for the visible interactive map, without offline or bulk fetching. Check ion token scope, allowed assets, and allowed URLs if an ion layer is unavailable.

The airplane mesh is an [original, locally generated GLB](scripts/generate-aircraft.mjs) with a 39 m length and 36 m wingspan. Its smooth lofted fuselage, cambered swept wings, tail surfaces, engines, cockpit glazing, and cabin windows are drawn at real-world scale. The mesh uses glTF Y-up and +Z forward so Cesium can align its nose to the reported track. It is a neutral generic twin-jet model, not a claim about an aircraft's actual type or operator. Source and license are in [public/models/LICENSE.txt](public/models/LICENSE.txt). Cesium reuses the local GLB URL for aircraft entities. If it fails to load, aircraft remain selectable as labeled map symbols.

The AI service is optional and uses Groq's [Chat Completions API](https://console.groq.com/docs/api-reference) with strict JSON Schema output. Create a key in [Groq Console](https://console.groq.com/keys), then add `GROQ_API_KEY` to `.env.local` for local use or to the Vercel project environment for deployment. Its adapter in `server/providers/groq.mjs` calls Groq from the server only. The default model is `openai/gpt-oss-20b`; override it with `GROQ_MODEL` if needed. The assistant receives a bounded map summary, validates scenario proposals, and returns explicit evidence and assumptions. AI text is uncertain and educational. Keep the key server-only.

## Checks and troubleshooting

```bash
npm test
npm run build
npm run preview
```

`npm run preview` starts the API and the built Vite preview at [http://127.0.0.1:4173/](http://127.0.0.1:4173/). If a port is busy, stop the previous AIRSPACE process before starting another. The backend has `GET /api/status`, `GET /api/live?area=local&lat=40.6413&lon=-73.7781`, `GET /api/live?area=us`, `GET /api/replay`, and `POST /api/assistant`; API responses never include credential values. Network failures, bad OpenSky auth, rate limits, and missing AI or ion configuration appear in the portal's Data Status area.

For a blank Local 3D map, inspect Data Status first, then the browser console and Network panel. Confirm that `/Cesium/` assets are being served and that the chosen imagery source is reachable. The U.S. 2D map needs no map token or tile service. For no live planes, check `/api/status`, OpenSky OAuth2 client configuration, `/api/live`, the selected area, the returned/positioned counts, and the snapshot age. A zero count can be a valid response; OpenSky does not promise complete surveillance.

## Reference and license notes

The visual design is original AIRSPACE work inspired by product hierarchy and interaction patterns in PrepMind, Civello, Linear, and Ripple. The [2D flight demo](https://github.com/aaryanwadhwani1101/airspace-live-traffic) informed map, path, replay, and details behavior. The 2D workspace is copied from the user-provided `airspace-share_1.zip`; its `README.original.md` and source files are retained under `vendor/zip2d/`. Its live bridge only accepts messages from the AIRSPACE parent page on the same origin. The [Cesium JFK test](https://github.com/Jeetski2980/cesium-jfk-test) informed the Vite/Cesium asset setup and JFK starting view. The included 3D model has no third-party mesh or texture dependency. OpenStreetMap and Cesium content retain their displayed attributions in Local 3D; their separate service terms apply.

## Vercel deployment

The repository includes a Vercel catch-all Node function for `/api/*` and serves the built Vite client from `dist`. Import the private GitHub repository into Vercel; its default install and build settings are defined in `vercel.json`.

Configure these variables in Vercel Project Settings → Environment Variables, then redeploy:

- `VITE_CESIUM_ION_TOKEN` for browser imagery and terrain (a public-client token; restrict allowed assets, scope, and URLs).
- `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` for live data. Keep both server-side and do not use a `VITE_` prefix.
- `GROQ_API_KEY` for the optional Groq assistant.
- `GROQ_MODEL` if you want to override the default Groq model.

For the Cesium variable, choose **Config** in Vercel because the `VITE_` value is public in the browser build. Keep OpenSky and Groq variables as **Secret** and server-side. After changing production variables, redeploy to apply them. The portal and simulations work without provider credentials. Live OpenSky traffic and AI stay unavailable until their server variables are configured. Never commit `.env.local` or place server credentials in browser variables.
