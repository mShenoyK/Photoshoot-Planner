import { InputError } from "./input-repository";

/** Only trusted server configuration determines the allowed browser origin. */
export function applicationOrigin(): string {
  const raw =
    process.env.WEB_BASE_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    (process.env.NODE_ENV !== "production"
      ? "http://localhost:3000"
      : undefined);
  if (!raw)
    throw new InputError(
      "APP_ORIGIN_NOT_CONFIGURED",
      "The server URL is not configured. Set WEB_BASE_URL to the application's public HTTPS URL.",
      503,
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError(
      "APP_ORIGIN_NOT_CONFIGURED",
      "The configured server URL is invalid. Check WEB_BASE_URL.",
      503,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (process.env.NODE_ENV === "production" && url.protocol !== "https:")
  )
    throw new InputError(
      "APP_ORIGIN_NOT_CONFIGURED",
      "Configure the application's public HTTPS URL in WEB_BASE_URL.",
      503,
    );
  return url.origin;
}
