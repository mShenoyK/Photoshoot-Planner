import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaults, shootSchema } from "../packages/shared/src/shoot";
import { handle } from "../apps/web/lib/api";
import { database } from "../apps/web/lib/store";
let temp: string;
let first: string;
let firstEmail: string;
let second: string;
let id: string;
let revision: number;
const origin = "http://localhost:3000";
function request(
  route: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
) {
  return handle(
    new Request(origin + "/api/v1/" + route, {
      method,
      headers: {
        origin,
        ...(cookie ? { cookie } : {}),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "framecraft-"));
  process.env.MOCK_DATA_FILE = path.join(temp, "db.json");
  process.env.DATA_MODE =
    process.env.TEST_DATABASE === "1" ? "postgres" : "mock";
  process.env.AUTH_SECRET = "test-secret-with-more-than-32-characters";
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
  if (process.env.TEST_DATABASE === "1") await database().$disconnect();
});
describe("shoot contracts", () => {
  it("validates individual, groups, optional counts, categories and zones", () => {
    expect(shootSchema.safeParse(defaults).success).toBe(true);
    expect(
      shootSchema.safeParse({
        ...defaults,
        portraitCategory: "PORTRAIT_GROUP",
        subjectCount: 4,
        subjectCategory: "FAMILY_MIXED",
      }).success,
    ).toBe(true);
    expect(
      shootSchema.safeParse({
        ...defaults,
        portraitCategory: "PORTRAIT_GROUP",
        subjectCount: undefined,
      }).success,
    ).toBe(true);
    for (const subjectCount of [0, 1, 21, 2.5])
      expect(
        shootSchema.safeParse({
          ...defaults,
          portraitCategory: "PORTRAIT_GROUP",
          subjectCount,
        }).success,
      ).toBe(false);
    expect(
      shootSchema.safeParse({ ...defaults, timezone: "not/a/zone" }).success,
    ).toBe(false);
    expect(shootSchema.safeParse({ ...defaults, name: "  " }).success).toBe(
      false,
    );
    expect(
      shootSchema.safeParse({ ...defaults, ownerId: "attacker" }).success,
    ).toBe(false);
  });
});
describe("authenticated API lifecycle and isolation", () => {
  it("rejects unauthenticated access and cross-origin mutation", async () => {
    expect((await request("shoots")).status).toBe(401);
    expect(
      (
        await handle(
          new Request(origin + "/api/v1/shoots", {
            method: "POST",
            headers: { origin: "https://evil.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("registers two users without exposing hashes", async () => {
    for (const n of [1, 2]) {
      const response = await request("auth/register", "POST", {
        email:
          n === 1
            ? (firstEmail = `test-${Date.now()}-${n}@example.com`)
            : `test-${Date.now()}-${n}@example.com`,
        password: "local-test-password",
      });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.passwordHash).toBeUndefined();
      const cookie = response.headers.get("set-cookie")!.split(";")[0];
      expect(cookie).toContain("fc_session=");
      if (n === 1) first = cookie;
      else second = cookie;
    }
  });
  it("signs in an existing account and rejects wrong passwords", async () => {
    const signedIn = await request("auth/login", "POST", {
      email: firstEmail,
      password: "local-test-password",
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-cookie")).toContain("HttpOnly");
    expect(
      (
        await request("auth/login", "POST", {
          email: firstEmail,
          password: "incorrect-password",
        })
      ).status,
    ).toBe(401);
  });
  it("creates, persists, and reopens a validated draft", async () => {
    const r = await request(
      "shoots",
      "POST",
      { ...defaults, name: "Family story" },
      first,
    );
    expect(r.status).toBe(201);
    const data = (await r.json()).data;
    id = data.id;
    revision = data.revision;
    expect(
      (await (await request("shoots/" + id, "GET", undefined, first)).json())
        .data.name,
    ).toBe("Family story");
  });
  it("blocks cross-owner reads, lists, updates, deletes", async () => {
    expect(
      (await request("shoots/" + id, "GET", undefined, second)).status,
    ).toBe(404);
    expect(
      (await (await request("shoots", "GET", undefined, second)).json()).data,
    ).toEqual([]);
    expect(
      (
        await request(
          "shoots/" + id,
          "PATCH",
          { ...defaults, revision },
          second,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request("shoots/" + id, "DELETE", undefined, second)).status,
    ).toBe(404);
  });
  it("updates atomically, rejects stale revisions and invalid input", async () => {
    expect(
      (
        await request(
          "shoots/" + id,
          "PATCH",
          { ...defaults, name: "Revised family", revision },
          first,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request("shoots/" + id, "PATCH", { ...defaults, revision }, first))
        .status,
    ).toBe(409);
    expect(
      (await request("shoots", "POST", { ...defaults, name: "x" }, first))
        .status,
    ).toBe(400);
  });
  it("rejects tampered tokens and logs out", async () => {
    expect(
      (await request("shoots", "GET", undefined, first + "bad")).status,
    ).toBe(401);
    const r = await request("auth/logout", "POST", {}, first);
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("deletes own draft and hides it from subsequent reads", async () => {
    expect(
      (await request("shoots/" + id, "DELETE", undefined, first)).status,
    ).toBe(200);
    expect(
      (await request("shoots/" + id, "GET", undefined, first)).status,
    ).toBe(404);
  });
});
