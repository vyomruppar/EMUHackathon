// Groq credentials are server-only. Never rename this to a VITE_ variable.
function getApiKey() {
  let key = process.env.GROQ_API_KEY?.trim() ?? "";
  for (let pass = 0; pass < 4; pass += 1) {
    const previous = key;
    key = key.trim().replace(/^Bearer\s+/i, "").replace(/^GROQ_API_KEY\s*=\s*/i, "").trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1).trim();
    }
    if (key === previous) break;
  }
  return key;
}

export const groqProvider = {
  name: "Groq API",
  configured() {
    const key = getApiKey();
    return Boolean(key && !key.startsWith("your_"));
  },
  async structuredReply({ instructions, input, schema }) {
    const apiKey = getApiKey();
    const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
    const request = async (response_format, systemInstructions = instructions) => {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(25_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: input },
          ],
          response_format,
          max_completion_tokens: 1200,
          temperature: 0.2,
        }),
      });
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      return { response, payload };
    };

    const readText = ({ response, payload }) => {
      if (!response.ok) return null;
      const text = payload.choices?.[0]?.message?.content;
      return typeof text === "string" && text.trim() ? text : null;
    };
    const strictFormat = {
      type: "json_schema",
      json_schema: { name: "airspace_assistant_reply", strict: true, schema },
    };
    let result = await request(strictFormat);
    const strictText = readText(result);
    if (strictText) return strictText;

    const providerMessage = typeof result.payload?.error?.message === "string"
      ? result.payload.error.message
      : "";
    const schemaFailure = result.response.status === 400
      && /generated json does not match|failed_generation|json.?schema|structured output|response_format/i.test(providerMessage);

    // Some project model overrides or transient Groq schema checks can reject a
    // strict response. JSON Object Mode still guarantees valid JSON syntax; the
    // caller validates and normalizes every field before returning it to a user.
    if (schemaFailure) {
      const fallbackInstructions = `${instructions}\n\nReturn exactly one valid JSON object matching this schema. Include every required property, including empty arrays and null values when appropriate. Schema: ${JSON.stringify(schema)}`;
      result = await request({ type: "json_object" }, fallbackInstructions);
      const fallbackText = readText(result);
      if (fallbackText) return fallbackText;
      throw createProviderError(result.response.status, result.payload?.error?.message, true);
    }

    throw createProviderError(result.response.status, providerMessage, false);
  },
};

function createProviderError(status, providerMessage, schemaFailure) {
  let message;
  if (status === 401 || status === 403) {
    message = "Groq rejected the Production API key. Replace GROQ_API_KEY with an active raw key without quotes, a Bearer prefix, or a GROQ_API_KEY= label, then redeploy.";
  } else if (status === 429) {
    message = "Groq is rate limited. Try again later or check the limits for this API key.";
  } else if (schemaFailure) {
    message = "Groq could not format a complete response. Retry once, then check that GROQ_MODEL is supported.";
  } else if (status === 400 || status === 404) {
    message = "Groq rejected the model or request. Check that GROQ_MODEL is a supported model.";
  } else {
    message = "Groq is unavailable. Check the API status and try again.";
  }
  const error = new Error(message);
  error.providerStatus = status;
  error.publicMessage = message;
  error.schemaFailure = schemaFailure;
  // Keep provider diagnostics out of browser responses and logs. This flag
  // intentionally records only whether the response contained an API error.
  error.providerReturnedError = Boolean(providerMessage);
  return error;
}
