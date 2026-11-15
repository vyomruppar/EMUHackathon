## Inspiration

When air traffic control communications failed across the U.S., flights were grounded nationwide. Aviation is among the safest ways to travel, yet incidents like this still happen, and officials described the system as outdated. We asked a simple question: **what would it look like if a controller could rehearse the worst day before it happens?**

## What it does

AeroFlo is an AI-assisted air traffic operations workspace. It gives a controller one place to:

- **See the whole network.** A U.S. map with aircraft, routes, state outlines, airport surface views for multiple airports, filters, and a replay timeline.
- **Spot trouble early.** An Alerts & Checks view surfaces bottlenecks, conflicts and unreliable data, ranked as warning or critical.
- **Stress-test the system.** A What-If Lab simulates communications outages, runway closures, weather delays, traffic surges and infrastructure failures. Users can set the timing and restoration, then compare outcomes side by side.
- **Plan degraded operations.** A dedicated view shows how a disruption spreads from one airport to the wider airspace network.
- **Ask in plain language.** An AI assistant explains what is on screen and proposes a scenario. A proposal is labelled hypothetical and a human must review it before it runs.
- **Hear what matters.** Every new or escalated alert plays a tone and is read aloud (ElevenLabs when configured, browser voice otherwise), so a controller doesn't have to look away from the traffic.

Every number is clearly labelled **synthetic** or **estimated**. AeroFlo is an education and research tool, not operational guidance.

## How we built it

We started by researching what a controller actually juggles at once: huge volumes of flight information, congestion at airports, anomaly detection, and unpredictable disruptions. We then built:

- **Frontend:** React and TypeScript on Vite, wrapping a custom 2D traffic engine with a deterministic six-hour model timeline.
- **Simulation engine:** hypothetical scenarios with custom effects, playback and comparison.
- **AI assistant:** Groq (`openai/gpt-oss-20b`) behind a small Node API. The server validates and size-caps everything sent to the model, and constrains scenario proposals to a strict JSON schema with allowed airports and event types. The API key never reaches the browser.
- **Voice:** ElevenLabs for realistic spoken alerts, with a graceful fallback to the browser's built-in voice.
- **Safety by design:** if no AI key is set, the rest of the portal still works. A Data Status panel states plainly what is and isn't connected.
- **Deployment:** Vercel serverless API, plus automated tests for the server and voice layer.

## Challenges we ran into

- **Making AI trustworthy in a safety-adjacent setting.** A chatbot that confidently invents things is worse than none. We bounded what the model sees, forced structured output, and required human review before any AI-proposed scenario runs.
- **Honest data.** Real flight feeds are rate-limited and incomplete, so we built a deterministic synthetic model and labelled everything, rather than imply something is live when it isn't.
- **Realistic geography.** State outlines needed correct multipart shapes, for example Michigan's two peninsulas and islands.
- **Alerts without noise.** Voice alerts had to be useful, not exhausting, so only new or escalated alerts speak, with a mute toggle that remembers its setting.

## Accomplishments that we're proud of

- A complete workspace (map, surface, what-if lab, degraded ops, alerts) that works end to end without any API keys.
- An AI assistant that can't run away: its inputs are bounded, its outputs are schema-checked, and a human approves every proposal.
- Spoken alerts designed for a controller's eyes-busy workflow.
- A tool that is transparent about its limits.

## What we learned

- In safety-critical settings, the interface must say what is real, what is simulated and what is estimated.
- Guardrails (validation, schemas, human review) matter more than model size.
- Rehearsal is powerful: seeing a failure cascade across a network teaches more than reading about it.

## What's next for AeroFlo

- **Live data:** connect an observed feed such as OpenSky alongside the synthetic model, with clear provenance on every aircraft.
- **Retrieval-augmented assistant:** ground the AI in aviation rules, ATC training material and past incident reports, with citations on every answer.
- **Richer scenarios:** replay real historical disruptions and score response plans.
- **Training mode:** guided exercises for students and new controllers.
- **Collaboration:** multi-user sessions so a team can run a drill together.
