# AeroFlo

AeroFlo is an aviation education and research portal built around a self-contained U.S. 2D traffic workspace. It includes a generated traffic demo, a separate synthetic scenario lab, aircraft inspection, replay, and an optional Groq-powered assistant. **It does not connect to OpenSky or show observed live flights.**

> Public flight data and simulations for education and research. Not for operational use.

## Start locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` if you want the AI assistant.
4. Add `GROQ_API_KEY` to `.env.local` (server only). `GROQ_MODEL` is optional.
5. Run `npm run dev` and open the local URL, normally `http://localhost:5173`.

The U.S. 2D map and synthetic simulation work without credentials. No map API key is needed. If the AI key is absent, the assistant shows its setup message while the rest of the portal keeps working.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | Local API server | Optional server-side key for the AI assistant. Never add a `VITE_` prefix. |
| `GROQ_MODEL` | Local API server | Optional Groq model override. Defaults to `openai/gpt-oss-20b`. |
| `ELEVENLABS_API_KEY` | Local API server | Optional server-side key for spoken alerts. Without it, alerts use the browser's built-in voice. |
| `ELEVENLABS_VOICE_ID` | Local API server | Optional ElevenLabs voice override. |

Keep credentials in `.env.local`. `.env.local`, `.env`, and other local secret files are ignored by Git. The browser never receives the Groq key. For Vercel, add `GROQ_API_KEY` and optional `GROQ_MODEL` to the project’s server environment variables and make a new deployment after changing them.

## What is included

- **U.S. 2D workspace:** the project’s supplied ZIP interface, bundled state outlines, pan and zoom, airport and surface views, flight selection, route traces, replay timeline, and filters.
- **Synthetic traffic demo:** deterministic illustrative traffic and a six-hour model timeline. It is not historical observed flight data.
- **Simulation:** hypothetical model scenarios, custom effects, playback, and comparison. Results are synthetic estimates, not operational guidance.
- **AI assistant:** when configured, Groq can explain a bounded snapshot of the visible 2D model and propose a hypothetical scenario. Proposals are labeled and must be reviewed before the What-If Lab is used.
- **Voice alerts:** each new or escalated simulation alert plays a short tone and is read aloud, through ElevenLabs when `ELEVENLABS_API_KEY` is set and the browser's speech voice otherwise. The **Voice alerts** button in the sidebar mutes or unmutes them, and the choice is remembered in the browser.
- **Data Status:** reports whether the 2D model is publishing snapshots and whether the optional AI provider is configured.

The map geometry is shared by the landing preview and portal. State boundaries use Natural Earth Admin-1 geography, with Michigan represented as separate polygons for its Upper Peninsula, Lower Peninsula, and detached islands. The Michigan multipart coordinates are adapted from the [PublicaMundi U.S. states GeoJSON](https://github.com/PublicaMundi/MappingAPI/blob/master/data/geojson/us-states.json). Sector regions remain schematic and are not official ARTCC boundaries. The supplied ZIP map source and its original README are retained in `vendor/zip2d/`.

## Useful commands

- `npm run dev` starts Vite and the local API server.
- `npm run build` packages the ZIP workspace and builds the frontend.
- `npm run preview` serves the production build with the local API.
- `npm run test` runs the existing server and data tests.

The local API exposes `GET /api/status`, `POST /api/assistant` and `POST /api/speak` (alert text in, MP3 audio out). It has no flight-data endpoint and makes no OpenSky requests. API responses do not include secret values.
