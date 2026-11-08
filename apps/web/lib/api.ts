import { workflowRoutes } from "./workflow-routes";
import { referenceRoutes } from "./reference-routes";
import { applicationOrigin } from "./application-origin";
import { readiness } from "./readiness";
import { artifactRoutes } from "./artifact-routes";
import { randomUUID } from "node:crypto";
import { stylingRoutes } from "./styling-routes";
import { knowledgeRoutes } from "./knowledge-routes";
import { inputRoutes } from "./inputs-routes";
import { inputs } from "./inputs-service";
import { InputError } from "./input-repository";
import { maxUploadBytes } from "./image-intake";
import { z } from "zod";
import { shootSchema } from "@framecraft/shared";
import { store, Conflict } from "./store";
import { hashPassword, verifyPassword, token, identity, authKey } from "./auth";
const credentials = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
function response(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(
    { data, error: null, meta: {} },
    { status, headers: { "Cache-Control": "private, no-store", ...headers } },
  );
}
function error(
  code: string,
  message: string,
  status: number,
  fields?: unknown,
) {
  return Response.json(
    { data: null, error: { code, message, fields }, meta: {} },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
async function readJson(request: Request): Promise<unknown> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 16384)
    throw error("PAYLOAD_TOO_LARGE", "Request is too large.", 413);
  return JSON.parse(raw);
}
const attempts = new Map<string, { count: number; until: number }>();
async function handleRequest(request: Request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace("/api/v1/", "").split("/");
    if (parts.length > 6) return error("NOT_FOUND", "Not found", 404);
    if (parts.length === 1 && parts[0] === "ready" && request.method === "GET")
      return readiness();
    if (parts[0] === "health" && request.method === "GET")
      return response({ status: "ok" });
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      const allowed = applicationOrigin();
      if (origin !== allowed)
        return error(
          "ORIGIN_REJECTED",
          "The request origin does not match the server URL. Check WEB_BASE_URL in the server settings.",
          403,
        );
      const binaryUpload =
        parts[0] === "shoots" &&
        parts[2] === "uploads" &&
        parts.length === 4 &&
        request.method === "PUT";
      if (
        Number(request.headers.get("content-length") ?? 0) >
        (binaryUpload
          ? maxUploadBytes()
          : parts[0] === "admin" &&
              request.method === "POST" &&
              parts.length === 3
            ? 11 * 1024 * 1024
            : 16384)
      )
        return error("PAYLOAD_TOO_LARGE", "Request is too large.", 413);
    }
    if (parts[0] === "auth" && parts.length === 2) {
      if (parts[1] === "logout" && request.method === "POST")
        return response(null, 200, {
          "Set-Cookie":
            "fc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        });
      if (
        request.method !== "POST" ||
        !["login", "register"].includes(parts[1])
      )
        return error("NOT_FOUND", "Not found", 404);
      const input = credentials.safeParse(await readJson(request));
      if (!input.success)
        return error(
          "VALIDATION",
          "Enter a valid email and password of 12–128 characters.",
          400,
        );
      // Fail before any account write when the deployment cannot issue sessions.
      authKey();
      const key = input.data.email;
      if (attempts.size >= 10000) {
        for (const [email, attempt] of attempts)
          if (attempt.until < Date.now()) attempts.delete(email);
        if (attempts.size >= 10000)
          return error("RATE_LIMIT", "Please try again later.", 429);
      }
      const current = attempts.get(key);
      if (current && current.until > Date.now() && current.count >= 10)
        return error(
          "RATE_LIMIT",
          "Too many attempts. Try again in 15 minutes.",
          429,
        );
      if (!current || current.until < Date.now())
        attempts.set(key, { count: 1, until: Date.now() + 900000 });
      else current.count++;
      let user = await store.user(key);
      if (parts[1] === "register") {
        if (user)
          return error(
            "AUTH_FAILED",
            "Unable to register with these details. Try signing in.",
            400,
          );
        user = await store.createUser(key, hashPassword(input.data.password));
      } else if (
        !user ||
        !verifyPassword(input.data.password, user.passwordHash)
      )
        return error("AUTH_FAILED", "Email or password is incorrect.", 401);
      return response({ id: user.id, email: user.email }, 200, {
        "Set-Cookie": `fc_session=${await token(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      });
    }
    const owner = await identity(request);
    if (!owner) return error("UNAUTHORIZED", "Sign in to continue.", 401);
    const workflow = await workflowRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (workflow) return workflow;
    const references = await referenceRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (references) return references;
    const artifacts = await artifactRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (artifacts) return artifacts;
    const styling = await stylingRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (styling) return styling;
    const knowledge = await knowledgeRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (knowledge) return knowledge;
    const nested = await inputRoutes(request, parts, owner, {
      ok: response,
      readJson,
    });
    if (nested) return nested;
    if (parts.length > 2) return error("NOT_FOUND", "Not found", 404);
    if (parts[0] !== "shoots") return error("NOT_FOUND", "Not found", 404);
    const id = parts[1];
    if (request.method === "GET") {
      const list = await store.list(owner);
      if (!id) return response(list.filter((s) => !s.workflowKind));
      const shoot = list.find((s) => s.id === id);
      return shoot
        ? response(shoot)
        : error("NOT_FOUND", "Shoot not found.", 404);
    }
    if (request.method === "DELETE" && id) {
      if (!(await inputs.purge(owner, id)))
        return error(
          "DELETION_PENDING",
          "Access is blocked, but private storage cleanup failed. Retry deletion.",
          503,
        );
      return (await store.remove(owner, id))
        ? response({ deleted: true })
        : error("NOT_FOUND", "Shoot not found.", 404);
    }
    if (
      (request.method === "POST" && !id) ||
      (request.method === "PATCH" && id)
    ) {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body))
        return error("VALIDATION", "Expected a shoot object.", 400);
      const { revision, ...data } = body as Record<string, unknown>;
      const input = shootSchema.safeParse(data);
      if (!input.success)
        return error(
          "VALIDATION",
          "Check the shoot details.",
          400,
          input.error.flatten(),
        );
      if (id && (!Number.isInteger(revision) || (revision as number) < 1))
        return error("VALIDATION", "A revision is required.", 400);
      const saved = await store.save(
        owner,
        input.data,
        id,
        revision as number | undefined,
      );
      return saved
        ? response(saved, id ? 200 : 201)
        : error("NOT_FOUND", "Shoot not found.", 404);
    }
    return error("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof InputError) return error(e.code, e.message, e.status);
    if (e instanceof z.ZodError)
      return error(
        "VALIDATION",
        "Check the highlighted input fields.",
        400,
        e.flatten(),
      );
    if (e instanceof Conflict)
      return error(
        "CONFLICT",
        "This shoot changed elsewhere. Reopen it before editing.",
        409,
      );
    if (e instanceof SyntaxError)
      return error("INVALID_JSON", "Invalid JSON request.", 400);
    console.error(
      "API request failed",
      e instanceof Error ? e.name : "unknown",
    );
    return error(
      "INTERNAL",
      "Unable to complete this request. Please retry.",
      500,
    );
  }
}

export async function handle(request: Request) {
  const requestId = randomUUID();
  const started = performance.now();
  const result = await handleRequest(request);
  result.headers.set("X-Request-ID", requestId);
  if (process.env.NODE_ENV !== "test")
    console.info(
      JSON.stringify({
        event: "http_request",
        requestId,
        method: request.method,
        status: result.status,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  return result;
}
