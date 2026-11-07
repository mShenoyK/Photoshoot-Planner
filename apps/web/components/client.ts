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
