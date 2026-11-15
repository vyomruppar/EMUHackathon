// ElevenLabs text-to-speech for spoken simulation alerts.
// The key is server-only. Never rename it to a VITE_ variable.
// "Daniel – Steady Broadcaster", a premade voice that free ElevenLabs plans can use via the API.
const DEFAULT_VOICE_ID = "onwK4e9ZLuTAKqWW03F9";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const MAX_TEXT = 300;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
let recentRequests = [];

function cleanEnv(value, name) {
  let key = value?.trim() ?? "";
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = key;
    key = key.trim().replace(new RegExp(`^${name}\\s*=\\s*`, "i"), "").trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
    if (key === previous) break;
  }
  return key;
}
function apiKey() { return cleanEnv(process.env.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY"); }
function voiceId() {
  const id = cleanEnv(process.env.ELEVENLABS_VOICE_ID, "ELEVENLABS_VOICE_ID");
  return /^[A-Za-z0-9]{10,40}$/.test(id) ? id : DEFAULT_VOICE_ID;
}

export function voiceStatus() {
  const key = apiKey();
  const configured = Boolean(key && !key.startsWith("your_"));
  return { configured, provider: configured ? "ElevenLabs" : "Browser voice" };
}

/** Returns { status, audio } on success or { status, body } with an error. */
export async function speak(request) {
  if (!voiceStatus().configured) return { status: 503, body: { error: "ElevenLabs voice is not configured on the server." } };
  const text = typeof request?.text === "string"
    ? request.text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)
    : "";
  if (!text) return { status: 400, body: { error: "Send the alert text to read aloud." } };

  const now = Date.now();
  recentRequests = recentRequests.filter(time => now - time < WINDOW_MS);
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) return { status: 429, body: { error: "Too many voice requests. Try again in a minute." } };
  recentRequests.push(now);

  let response;
  try {
    response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId()}?output_format=mp3_44100_64`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": apiKey() },
      body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID }),
    });
  } catch {
    return { status: 502, body: { error: "ElevenLabs did not respond. The browser voice will be used instead." } };
  }
  if (!response.ok) {
    const reason = response.status === 401 ? "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY."
      : response.status === 402 ? "This ElevenLabs plan cannot use that voice. Set ELEVENLABS_VOICE_ID to a premade voice."
      : response.status === 429 ? "ElevenLabs quota or rate limit reached."
      : `ElevenLabs returned an error (${response.status}).`;
    return { status: 502, body: { error: reason } };
  }
  return { status: 200, audio: Buffer.from(await response.arrayBuffer()) };
}
