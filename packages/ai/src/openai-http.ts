/** Fixed endpoints only; never forward provider bodies, keys, or signed URLs in errors. */
export function openAIKey() {
  const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!key || key === "replace_me") throw new Error("OPENAI_NOT_CONFIGURED");
  return key;
}
export async function boundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "PROVIDER_RATE_LIMIT"
        : response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH"
          : "PROVIDER_FAILED",
    );
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("PROVIDER_SIZE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("PROVIDER_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("PROVIDER_SIZE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("PROVIDER_RESPONSE");
  }
}
export async function openAIJson(
  key: string,
  messages: unknown[],
  model: string,
  maxTokens = 7000,
  timeout = 45000,
): Promise<unknown> {
  const raw = (await boundedJson(
    await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        max_tokens: maxTokens,
        messages,
      }),
    }),
    256 * 1024,
  )) as { choices?: { message?: { content?: string; refusal?: string } }[] };
  const message = raw.choices?.[0]?.message;
  if (
    message?.refusal ||
    typeof message?.content !== "string" ||
    message.content.length > 128000
  )
    throw new Error("PROVIDER_RESPONSE");
  try {
    return JSON.parse(message.content);
  } catch {
    throw new Error("PROVIDER_RESPONSE");
  }
}
export function liveProviderMode(variable: string) {
  const mode =
    process.env[variable] ??
    (process.env.DATA_MODE === "mock" && process.env.NODE_ENV !== "production"
      ? "mock"
      : "openai");
  if (process.env.NODE_ENV === "production" && mode === "mock")
    throw new Error("LIVE_PROVIDER_REQUIRED");
  return mode;
}
