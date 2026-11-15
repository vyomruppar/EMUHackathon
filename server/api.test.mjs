import test from "node:test";
import assert from "node:assert/strict";
import { askAssistant } from "./ai.mjs";
import { handleApi } from "./index.mjs";

function responseHarness() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}

test("status is limited to server and AI provider state", async () => {
  const res = responseHarness();
  await handleApi({ method: "GET", url: "/api/status" }, res);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.server, "ok");
  assert.equal("openskyConfigured" in body, false);
});

test("removed flight data routes do not return a feed", async () => {
  for (const url of ["/api/live?area=us", "/api/replay"]) {
    const res = responseHarness();
    await handleApi({ method: "GET", url }, res);
    assert.equal(res.status, 404);
  }
});

test("Groq returns a validated proposal using the synthetic demo source", async () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGroqModel = process.env.GROQ_MODEL;
  const oldFetch = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = "test_groq_key";
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test_groq_key");
      const request = JSON.parse(options.body);
      assert.equal(request.response_format.type, "json_schema");
      assert.equal(request.response_format.json_schema.strict, true);
      const output = {
        kind: "proposal", answer: "A synthetic JFK closure scenario is ready for review.",
        evidence: ["The current map shows synthetic demo tracks."],
        assumptions: ["Only synthetic aircraft are affected."],
        proposal: { locationId: "JFK", eventType: "runway_closure", durationMinutes: 30,
          syntheticAircraftCount: 12, description: "Hypothetical capacity reduction for 30 minutes." },
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
    };
    const response = await askAssistant({ message: "What if JFK closes for 30 minutes?", context: { mode: "demo", dataState: "synthetic demo", sourceTimestamp: null, aircraft: [] } });
    assert.equal(response.status, 200);
    assert.equal(response.body.kind, "proposal");
    assert.equal(response.body.proposal.locationId, "JFK");
    assert.equal(response.body.proposal.latitude, 40.6413);
    assert.equal(response.body.proposal.syntheticAircraftCount, 12);
    assert.equal(response.body.source, "AeroFlo synthetic traffic demo");
    assert.equal("liveAircraft" in response.body, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGroqModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldGroqModel;
  }
});

test("Groq schema mismatch falls back safely and forces a complete hypothetical proposal", async () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGroqModel = process.env.GROQ_MODEL;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.GROQ_API_KEY = "test_groq_key";
    delete process.env.GROQ_MODEL;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const request = JSON.parse(options.body);
      if (calls === 1) {
        assert.equal(request.response_format.type, "json_schema");
        assert.equal(request.response_format.json_schema.strict, true);
        return new Response(JSON.stringify({ error: { message: "Generated JSON does not match the expected schema; failed_generation omitted required fields." } }), { status: 400 });
      }
      if (calls === 2) {
        assert.deepEqual(request.response_format, { type: "json_object" });
        assert.match(request.messages[0].content, /Include every required property/);
        // A valid JSON object can still be incomplete in Groq's JSON Object Mode.
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "answer", answer: "The closure could increase modeled delays." }) } }] }), { status: 200 });
      }
      assert.equal(request.response_format.type, "json_schema");
      assert.deepEqual(request.response_format.json_schema.schema.properties.kind.enum, ["proposal"]);
      assert.equal(request.response_format.json_schema.schema.properties.proposal.type, "object");
      const output = {
        kind: "proposal", answer: "Review this hypothetical JFK runway closure setup.",
        evidence: ["The map is using synthetic traffic."], assumptions: ["Only synthetic traffic is affected."],
        proposal: { locationId: "JFK", eventType: "runway_closure", durationMinutes: 30,
          syntheticAircraftCount: 12, description: "Model a 30 minute runway closure at JFK." },
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
    };

    const response = await askAssistant({
      message: "What might happen during a 30 minute JFK runway closure?",
      context: { view: "us", mode: "simulation", selectedAirport: "JFK", sourceTimestamp: null, aircraft: [] },
    });
    assert.equal(calls, 3);
    assert.equal(response.status, 200);
    assert.equal(response.body.kind, "proposal");
    assert.equal(response.body.proposal.eventType, "runway_closure");
    assert.equal(response.body.proposal.durationMinutes, 30);
    assert.equal(response.body.proposal.syntheticAircraftCount, 12);
    assert.deepEqual(response.body.assumptions, ["Only synthetic traffic is affected."]);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGroqModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldGroqModel;
  }
});

test("Groq schema errors are sanitized if JSON fallback also fails", async () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldFetch = globalThis.fetch;
  let calls = 0;
  try {
    process.env.GROQ_API_KEY = "test_groq_key";
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: "Generated JSON does not match the expected schema." } }), { status: 400 });
      return new Response(JSON.stringify({ error: { message: "failed_generation: private provider detail" } }), { status: 400 });
    };
    const response = await askAssistant({ message: "Explain the map.", context: { view: "us", aircraft: [] } });
    assert.equal(response.status, 502);
    assert.match(response.body.error, /Groq could not format a complete response/);
    assert.doesNotMatch(response.body.error, /failed_generation|private provider detail/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldGroqKey;
  }
});

test("Groq strips common copy-and-paste wrappers from its key", async () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGroqModel = process.env.GROQ_MODEL;
  const oldFetch = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = '"Bearer GROQ_API_KEY=test_groq_key"';
    process.env.GROQ_MODEL = "openai/gpt-oss-20b";
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer test_groq_key");
      const output = { kind: "answer", answer: "The visible network uses synthetic data.", evidence: [], assumptions: [], proposal: null };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }), { status: 200 });
    };
    const response = await askAssistant({ message: "Explain the map.", context: { view: "us", aircraft: [] } });
    assert.equal(response.status, 200);
    assert.equal(response.body.kind, "answer");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGroqModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = oldGroqModel;
  }
});
