export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith("auth/"))
      window.location.assign("/");
    throw new Error(json.error?.message ?? "Request failed. Please retry.");
  }
  return json.data as T;
}
export function human(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (s) => s.toUpperCase());
}

export function providerFailure(code?: string) {
  if (
    [
      "OPENAI_NOT_CONFIGURED",
      "TEXT_PROVIDER_NOT_CONFIGURED",
      "IMAGE_NOT_CONFIGURED",
    ].includes(code ?? "")
  )
    return "Configure the server-side OPENAI_API_KEY and select OpenAI providers in Render. No sample result was substituted.";
  if (["LIVE_PROVIDER_REQUIRED", "LIVE_IMAGE_REQUIRED"].includes(code ?? ""))
    return "Set AI_TEXT_PROVIDER, AI_VISION_PROVIDER and AI_IMAGE_PROVIDER to openai for live production results.";
  if (code === "STORAGE_NOT_CONFIGURED")
    return "Configure private object-storage credentials on the server before generating images. No paid image request was made.";
  if (code === "STALE_INPUTS")
    return "Inputs or permissions changed. Regenerate the saved guide or styling before creating another image.";
  if (code === "PROVIDER_AUTH")
    return "OpenAI rejected the credentials or model access. Check the server key and access to the configured model.";
  if (code === "PROVIDER_RATE_LIMIT")
    return "OpenAI rate or billing limit reached. Check provider quota, then retry.";
  if (code === "IMAGE_REVIEW_FAILED")
    return "The generated image failed count, age, scene, outfit or safety review. It was not published. Retry or refine the saved guidance.";
  return code
    ? `${human(code)}. Your saved guidance is retained; retry is available.`
    : "Generation failed. Retry is available.";
}
