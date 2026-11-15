## Inspiration

When air traffic control communications failed across the U.S., flights were grounded nationwide. Aviation is regarded as one of the safest forms of travel, yet incidents like this still happen, and officials described the system as outdated. That shocked us, so we asked a simple question: what would it look like if a controller could rehearse the worst day before it happens?

## What it does

AeroFlo is an AI-assisted air traffic operations workspace that gives a controller one place to see the whole network, spot trouble early, and test how the system would respond to a failure. A U.S. map shows aircraft, routes and airport surface views, with filters and a replay timeline. An Alerts and Checks view surfaces bottlenecks, conflicts and unreliable data, ranked as warnings or critical issues.

The What-If Lab lets users simulate communications outages, runway closures, weather delays, traffic surges and infrastructure failures. Users can set when each disruption starts and how long it takes to restore, then compare outcomes side by side. A Degraded Operations view shows how a problem at one airport spreads through the wider airspace network.

An AI assistant explains what is on screen and can propose a scenario in plain language. Every proposal is labelled as hypothetical, and a person must review it before it runs. Each new or escalated alert is also read aloud, so a controller does not have to look away from the traffic. Every number in AeroFlo is clearly labelled as synthetic or estimated, because it is an education and research tool and not operational guidance.

## How we built it

We started by researching what an air traffic controller actually does, and we found many places where the job could be easier. A controller has to manage huge amounts of flight information, control the flow of aircraft around congested airports, identify anomalies and respond to unpredictable disruptions, all at the same time. We built a centralized dashboard around those needs, using Claude Code to develop it.

The frontend is written in React and TypeScript on Vite and wraps a custom 2D traffic engine with a deterministic six-hour model timeline. A simulation engine runs the hypothetical scenarios and handles playback and comparison.

For the assistant, we used Groq as the language model behind a small Node API. The server validates and size-limits everything it sends to the model, and it constrains scenario proposals to a strict schema with approved airports and event types. The API key stays on the server and never reaches the browser. To make the assistant easier to use in a busy control room, we connected ElevenLabs so that alerts are spoken in a realistic human voice, and the app falls back to the browser's built-in voice when no key is set.

We designed the app to degrade gracefully, so the whole portal still works if the AI key is missing, and a Data Status panel states plainly what is and is not connected. We deployed the API on Vercel and added automated tests for the server and voice layer.

## Challenges we ran into

The hardest challenge was making AI trustworthy in a setting where mistakes matter. A chatbot that confidently invents answers is worse than no chatbot, so we limited what the model can see, forced its output into a fixed structure, and required human review before any AI-proposed scenario runs.

We also had to be honest about data. Real flight feeds are rate-limited and incomplete, so we built a deterministic synthetic model and labelled it clearly rather than imply that anything was live when it was not. Getting the geography right took extra work too, because states like Michigan need multiple shapes for their two peninsulas and islands.

Finally, we had to keep voice alerts useful instead of exhausting. We solved this by speaking only new or escalated alerts and by adding a mute button that remembers the user's choice.

## Accomplishments that we're proud of

We are proud that AeroFlo is a complete workspace, covering the map, airport surface, what-if lab, degraded operations and alerts, and that it works end to end without any API keys. We are also proud of an AI assistant that cannot run away, because its inputs are bounded, its outputs are checked against a schema, and a human approves every proposal. The spoken alerts suit a controller whose eyes are busy, and the whole tool is transparent about its own limits.

## What we learned

We learned that in safety-critical settings the interface must say what is real, what is simulated and what is estimated. We learned that guardrails such as validation, schemas and human review matter more than the size of the model. We also learned that rehearsal is powerful, because watching a failure cascade across a network teaches more than reading about it.

## What's next for AeroFlo

Next, we want to connect an observed live data source such as OpenSky alongside the synthetic model, with clear provenance on every aircraft. We plan to ground the assistant in aviation rules, ATC training material and past incident reports using retrieval, so that every answer cites its source. We also want to replay real historical disruptions and score response plans, add a guided training mode for students and new controllers, and support multi-user sessions so a team can run a drill together.
