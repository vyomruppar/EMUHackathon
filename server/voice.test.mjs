import test from "node:test";
import assert from "node:assert/strict";
import { speak, voiceStatus } from "./voice.mjs";

function withEnv(values, run) {
  const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const oldFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("without an ElevenLabs key, speech reports setup needed and never calls the provider", () => withEnv({ ELEVENLABS_API_KEY: "your_elevenlabs_api_key" }, async () => {
  globalThis.fetch = async () => { throw new Error("provider must not be called"); };
  assert.equal(voiceStatus().configured, false);
  const result = await speak({ text: "Critical alert." });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /not configured/);
}));

test("ElevenLabs speech sends the key server-side and returns MP3 audio", () => withEnv({ ELEVENLABS_API_KEY: "test_eleven_key", ELEVENLABS_VOICE_ID: "x" }, async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/onwK4e9ZLuTAKqWW03F9\?/);
    assert.equal(options.headers["xi-api-key"], "test_eleven_key");
    assert.equal(JSON.parse(options.body).text, "Warning. JFK runway closed.");
    return new Response(new Uint8Array([73, 68, 51]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };
  assert.equal(voiceStatus().configured, true);
  const result = await speak({ text: "  Warning.\n JFK runway closed. " });
  assert.equal(result.status, 200);
  assert.deepEqual([...result.audio], [73, 68, 51]);
}));

test("speech rejects empty text and maps a bad key to a clear error", () => withEnv({ ELEVENLABS_API_KEY: "test_eleven_key" }, async () => {
  globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
  assert.equal((await speak({ text: "   " })).status, 400);
  const result = await speak({ text: "Watch. Weather." });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /rejected the API key/);
}));
