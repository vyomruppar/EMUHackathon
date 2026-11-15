## Inspiration

Less than 72 hours ago, a total ATC communications collapse grounded flights across the US. It shocked us, because aviation is regarded as one of the safest forms of travel, yet incidents like this still happen. Officials even said the air traffic control system is outdated, so we decided to put our own twist on it.

## What it does

AeroFlo is an AI-assisted air traffic operations platform that tracks flights across the US, monitors airport operations, and flags bottlenecks, conflicts and unreliable data. It also lets users simulate emergencies like communications outages, runway closures and infrastructure failures, and see how a disruption at one airport spreads through the wider network. An AI assistant explains what is on screen, proposes scenarios, and reads alerts aloud so a controller can keep their eyes on the traffic.

## How we built it

We started by researching what an air traffic controller actually does, and found plenty of room for improvement. Controllers manage huge amounts of flight information, control the flow of aircraft around congested airports, spot anomalies, and respond to disruptions all at once. So we built a centralized dashboard with flight tracking, airport operations and a simulation engine using Claude Code, with a React and TypeScript frontend. We used Groq as the language model behind a small server that validates what the model sees and checks its scenario proposals against a strict schema. We connected ElevenLabs so the assistant speaks with a realistic human voice, which makes it easier for a controller to use.

## Challenges we ran into

The biggest challenge was making the AI trustworthy, since a confident wrong answer is dangerous in aviation. We limited what the model can see, forced its output into a fixed structure, and required a person to review every proposed scenario before it runs. We also had to be honest about data, so we built a clearly labelled synthetic traffic model instead of pretending it was live.

## Accomplishments that we're proud of

We built a complete workspace covering the map, airport surface, what-if lab and alerts that works end to end, and an AI assistant with real guardrails. We're also proud that spoken alerts make it genuinely usable for someone whose eyes are busy.

## What we learned

In safety-critical tools, the interface has to make clear what is real, what is simulated and what is estimated. We also learned that guardrails and human review matter more than model size.

## What's next for AeroFlo

We want to connect live data from OpenSky, ground the assistant in aviation rules, training guides and past incident reports using retrieval, and add a training mode so students and new controllers can practice responding to disruptions.
