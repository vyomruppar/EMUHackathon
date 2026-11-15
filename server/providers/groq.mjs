// Groq credentials are server-only. Never rename this to a VITE_ variable.
export const groqProvider = {
  name: "Groq API",
  configured() {
    const key = process.env.GROQ_API_KEY?.trim();
    return Boolean(key && !key.startsWith("your_"));
  },
  async structuredReply({ instructions, input, schema }) {
    const apiKey = process.env.GROQ_API_KEY.trim();
    const model = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b";
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
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "airspace_assistant_reply", strict: true, schema },
        },
        max_completion_tokens: 1200,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      let providerMessage = "";
      try {
        const payload = await response.json();
        providerMessage = typeof payload?.error?.message === "string" ? payload.error.message : "";
      } catch {
        // Keep the public error useful if Groq returns a non-JSON response.
      }
      const safeDetail = providerMessage
        .replaceAll(apiKey, "[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 240);
      const error = new Error(response.status === 401 || response.status === 403
        ? "Groq rejected the API key. Check GROQ_API_KEY and that the key is active."
        : response.status === 429
          ? "Groq is rate limited. Try again later or check the limits for this API key."
          : response.status === 400 || response.status === 404
            ? `Groq rejected the model or request. Check GROQ_MODEL is a supported model with JSON Schema output${safeDetail ? `: ${safeDetail}` : "."}`
            : "Groq is unavailable. Check the API status and try again.");
      error.providerStatus = response.status;
      throw error;
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new Error("Groq did not return a usable structured response.");
    }
    return text;
  },
};
