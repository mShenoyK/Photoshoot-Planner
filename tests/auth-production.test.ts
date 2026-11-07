import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { handle } from "../apps/web/lib/api";
import { store } from "../apps/web/lib/store";
import { hashPassword, identity } from "../apps/web/lib/auth";
const origin = "https://photoshoot-planner.onrender.com";
const password = "test-production-password-123";
const user = {
  id: randomUUID(),
  email: "production-test@example.com",
  passwordHash: hashPassword(password),
};
function request(
  route: string,
  requestOrigin = origin,
  body: unknown = { email: user.email, password },
) {
  return handle(
    new Request("http://internal:10000/api/v1/" + route, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATA_MODE", "postgres");
  vi.stubEnv("WEB_BASE_URL", undefined);
  vi.stubEnv("RENDER_EXTERNAL_URL", origin);
  vi.stubEnv(
    "AUTH_SECRET",
    "test-only-production-session-key-with-32-plus-characters",
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("registers behind Render's proxy using its trusted URL fallback and issues a secure usable session", async () => {
  vi.spyOn(store, "user").mockResolvedValue(null);
  const create = vi.spyOn(store, "createUser").mockResolvedValue(user);
  const r = await request("auth/register", origin, {
    email: "  PRODUCTION-TEST@example.com  ",
    password,
  });
  expect(r.status).toBe(200);
  expect(create.mock.calls[0][0]).toBe(user.email);
  const cookie = r.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Secure");
  expect(
    await identity(
      new Request(origin, { headers: { cookie: cookie.split(";")[0] } }),
    ),
  ).toBe(user.id);
});
it("normalizes a configured URL with a trailing slash and permits login without creating an account", async () => {
  vi.stubEnv("WEB_BASE_URL", origin + "/");
  vi.spyOn(store, "user").mockResolvedValue(user);
  const create = vi.spyOn(store, "createUser");
  const r = await request("auth/login");
  expect(r.status).toBe(200);
  expect(create).not.toHaveBeenCalled();
  expect(r.headers.get("set-cookie")).toContain("fc_session=");
});
it("rejects foreign origins even when a request spoofs the host header", async () => {
  const lookup = vi.spyOn(store, "user");
  const r = await handle(
    new Request("https://evil.invalid/api/v1/auth/register", {
      method: "POST",
      headers: { origin: "https://evil.invalid", host: "evil.invalid" },
      body: JSON.stringify({ email: user.email, password }),
    }),
  );
  expect(r.status).toBe(403);
  expect((await r.json()).error.code).toBe("ORIGIN_REJECTED");
  expect(lookup).not.toHaveBeenCalled();
});
it("checks the signing secret before registration can save a partial account", async () => {
  vi.stubEnv("AUTH_SECRET", undefined);
  const lookup = vi.spyOn(store, "user");
  const create = vi.spyOn(store, "createUser");
  const r = await request("auth/register");
  expect(r.status).toBe(503);
  expect((await r.json()).error.code).toBe("AUTH_NOT_CONFIGURED");
  expect(create).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
});
it("rejects short signing secrets and reports missing origin configuration without trusting request URL", async () => {
  vi.stubEnv("AUTH_SECRET", "short");
  expect((await request("auth/login")).status).toBe(503);
  vi.stubEnv("RENDER_EXTERNAL_URL", undefined);
  const r = await request("auth/register");
  expect(r.status).toBe(503);
  expect((await r.json()).error.code).toBe("APP_ORIGIN_NOT_CONFIGURED");
});
it("keeps explicit custom-domain configuration authoritative and rejects non-HTTPS production URLs", async () => {
  vi.stubEnv("WEB_BASE_URL", "https://custom.example/");
  expect((await request("auth/login")).status).toBe(403);
  vi.stubEnv("WEB_BASE_URL", "http://custom.example");
  expect((await request("auth/login", "http://custom.example")).status).toBe(
    503,
  );
});
it("reports missing auth configuration in readiness before attempting a database connection", async () => {
  vi.stubEnv("AUTH_SECRET", undefined);
  const r = await handle(new Request(origin + "/api/v1/ready"));
  expect(r.status).toBe(503);
  expect((await r.json()).error.code).toBe("AUTH_NOT_CONFIGURED");
});
it("still rejects incorrect login passwords", async () => {
  vi.spyOn(store, "user").mockResolvedValue(user);
  const r = await request("auth/login", origin, {
    email: user.email,
    password: "incorrect-password-123",
  });
  expect(r.status).toBe(401);
  expect(r.headers.has("set-cookie")).toBe(false);
});
