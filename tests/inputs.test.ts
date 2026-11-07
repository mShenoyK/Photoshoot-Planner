import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { handle } from "../apps/web/lib/api";
import { imageIntake } from "../apps/web/lib/image-intake";
import {
  LocalObjectStore,
  S3ObjectStore,
  safeKey,
} from "../apps/web/lib/object-store";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  blankSubject,
  canonPreset,
  subjectSchema,
  requiresGuardian,
  type InputState,
} from "../packages/shared/src/inputs";
import { defaults } from "../packages/shared/src/shoot";
const origin = "http://localhost:3000";
let temp: string;
let owner: string;
let outsider: string;
let shoot: string;
let sibling: string;
let photo: Buffer;
const uploadTokens = new Map<string, string>();
async function req(
  route: string,
  method = "GET",
  body?: unknown,
  cookie = owner,
) {
  const intentId = route.split("/uploads/")[1]?.split(/[/?]/)[0];
  return handle(
    new Request(
      origin + (route.startsWith("/api") ? route : "/api/v1/" + route),
      {
        method,
        headers: {
          origin,
          cookie,
          ...(method === "PUT" && intentId
            ? { Authorization: `Bearer ${uploadTokens.get(intentId) ?? ""}` }
            : {}),
          "Content-Type": Buffer.isBuffer(body)
            ? "image/jpeg"
            : "application/json",
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? new Uint8Array(body)
              : JSON.stringify(body),
      },
    ),
  );
}
async function data(
  route: string,
  method = "GET",
  body?: unknown,
  cookie = owner,
) {
  const response = await req(route, method, body, cookie);
  const json = await response.json();
  expect(response.status, JSON.stringify(json.error)).toBeLessThan(300);
  return json.data;
}
async function profile(ageGroup = "ADULT", shootId = shoot) {
  return data(`shoots/${shootId}/subjects`, "POST", {
    ...blankSubject,
    label: "Test " + ageGroup,
    ageGroup,
  });
}
async function grant(
  id: string,
  shootId = shoot,
  extra: Record<string, unknown> = {},
) {
  return data(`shoots/${shootId}/subjects/${id}/consents`, "POST", {
    status: "GRANTED",
    acknowledged: true,
    confirmedAuthority: true,
    ...extra,
  });
}
async function intent(
  subjectIds: string[],
  shootId = shoot,
  extra: Record<string, unknown> = {},
) {
  const result = await data(`shoots/${shootId}/upload-intents`, "POST", {
    fileName: "synthetic.jpg",
    mime: "image/jpeg",
    bytes: photo.length,
    kind: "SUBJECT_PHOTO",
    subjectIds,
    ...extra,
  });
  uploadTokens.set(result.id, result.uploadToken);
  return result;
}
async function asset(shootId = shoot) {
  const s = await profile("ADULT", shootId);
  await grant(s.id, shootId);
  const i = await intent([s.id], shootId);
  await data(i.uploadUrl, "PUT", photo);
  const a = await data(
    `shoots/${shootId}/uploads/${i.id}/complete`,
    "POST",
    {},
  );
  return { s, i, a };
}
beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "framecraft-inputs-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(temp, "db.json");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = path.join(temp, "objects");
  process.env.AUTH_SECRET = "test-inputs-secret-longer-than-32-characters";
  for (const n of [1, 2]) {
    const r = await req(
      "auth/register",
      "POST",
      {
        email: `inputs-${n}-${Date.now()}@example.com`,
        password: "private-test-password",
      },
      "",
    );
    expect(r.status).toBe(200);
    const c = r.headers.get("set-cookie")!.split(";")[0];
    if (n === 1) owner = c;
    else outsider = c;
  }
  shoot = (
    await data("shoots", "POST", {
      ...defaults,
      name: "Family inputs",
      portraitCategory: "PORTRAIT_GROUP",
      subjectCount: undefined,
    })
  ).id;
  sibling = (
    await data("shoots", "POST", { ...defaults, name: "Separate shoot" })
  ).id;
  photo = await sharp({
    create: { width: 512, height: 768, channels: 3, background: "#a7b2bd" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Synthetic test fixture" } } })
    .toBuffer();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});
describe("FC-006 mixed-age subject contracts", () => {
  it("allows mixed families, voluntarily stated preferences and unspecified count", async () => {
    for (const ageGroup of [
      "BABY",
      "TODDLER",
      "CHILD",
      "TEEN",
      "ADULT",
      "SENIOR",
      "UNSPECIFIED",
    ]) {
      const s = await profile(ageGroup);
      expect(s.ageGroup).toBe(ageGroup);
    }
    const list = await data(`shoots/${shoot}/subjects`);
    expect(list).toHaveLength(7);
    expect((await data(`shoots/${shoot}`)).subjectCount).toBeUndefined();
  });
  it("rejects conflicting ages and ownership injection; unknown age needs guardian", () => {
    expect(
      subjectSchema.safeParse({
        ...blankSubject,
        label: "Child",
        ageGroup: "ADULT",
        ageYears: 8,
      }).success,
    ).toBe(false);
    expect(
      subjectSchema.safeParse({
        ...blankSubject,
        label: "Person",
        ownerId: "attacker",
      }).success,
    ).toBe(false);
    expect(requiresGuardian({ ...blankSubject, label: "Unknown" })).toBe(true);
  });
});
describe("FC-008 consent before any image processing", () => {
  it("denies intake without consent, on refusal, and without guardian details", async () => {
    const inspect = vi.spyOn(imageIntake, "inspect");
    const child = await profile("CHILD");
    const body = {
      fileName: "child.jpg",
      mime: "image/jpeg",
      bytes: photo.length,
      kind: "SUBJECT_PHOTO",
      subjectIds: [child.id],
    };
    expect(
      (await req(`shoots/${shoot}/upload-intents`, "POST", body)).status,
    ).toBe(403);
    expect(
      (
        await req(`shoots/${shoot}/subjects/${child.id}/consents`, "POST", {
          status: "GRANTED",
          acknowledged: true,
          confirmedAuthority: true,
        })
      ).status,
    ).toBe(400);
    await data(`shoots/${shoot}/subjects/${child.id}/consents`, "POST", {
      status: "REFUSED",
    });
    expect(
      (await req(`shoots/${shoot}/upload-intents`, "POST", body)).status,
    ).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
    await grant(child.id, shoot, {
      guardianName: "Test guardian",
      guardianRelationship: "Parent",
    });
    expect((await intent([child.id])).id).toBeTruthy();
  });
  it("requires every person in a group photo to consent", async () => {
    const adult = await profile();
    const child = await profile("TODDLER");
    await grant(adult.id);
    expect(
      (
        await req(`shoots/${shoot}/upload-intents`, "POST", {
          fileName: "family.jpg",
          mime: "image/jpeg",
          bytes: photo.length,
          kind: "SUBJECT_PHOTO",
          subjectIds: [adult.id, child.id],
        })
      ).status,
    ).toBe(403);
  });
  it("rejects replay after revocation before decoding bytes", async () => {
    const s = await profile();
    await grant(s.id);
    const i = await intent([s.id]);
    await data(`shoots/${shoot}/subjects/${s.id}/consents`, "POST", {
      status: "REVOKED",
    });
    const inspect = vi.spyOn(imageIntake, "inspect");
    expect((await req(i.uploadUrl, "PUT", photo)).status).toBe(409);
    expect(inspect).not.toHaveBeenCalled();
    await grant(s.id);
    expect((await req(i.uploadUrl, "PUT", photo)).status).toBe(409);
  });
});
describe("FC-007 private upload, quality validation and IDOR", () => {
  it("uploads real synthetic image, strips EXIF from copies, hides keys and prevents replay", async () => {
    const { i, a } = await asset();
    expect(a.originalKey).toBeUndefined();
    expect(a.derivativeKey).toBeUndefined();
    expect(a.warnings.join(" ")).toContain("Low resolution");
    const r = await req(`shoots/${shoot}/media/${a.id}/download`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect((await req(i.uploadUrl, "PUT", photo)).status).toBe(409);
    const persisted = JSON.parse(
      await readFile(process.env.MOCK_DATA_FILE!, "utf8"),
    ) as { workspaces: Record<string, InputState> };
    const original = persisted.workspaces[shoot].media.find(
      (m) => m.id === a.id,
    )!;
    expect(
      original.originalKey.startsWith(`shoots/${shoot}/inputs/subject-photos/`),
    ).toBe(true);
    expect(
      (
        await sharp(
          await readFile(
            path.join(process.env.STORAGE_LOCAL_DIR!, original.originalKey),
          ),
        ).metadata()
      ).exif,
    ).toBeDefined();
  });
  it("blocks all cross-account and same-account cross-project record substitutions", async () => {
    const { s, i, a } = await asset();
    for (const cookie of [outsider]) {
      for (const route of [
        `shoots/${shoot}/inputs`,
        `shoots/${shoot}/subjects`,
        `shoots/${shoot}/media/${a.id}/download`,
      ])
        expect((await req(route, "GET", undefined, cookie)).status).toBe(404);
      expect(
        (
          await req(
            `shoots/${shoot}/subjects/${s.id}`,
            "PATCH",
            { ...blankSubject, label: "Stolen", ageGroup: "ADULT" },
            cookie,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await req(
            `shoots/${shoot}/subjects/${s.id}/consents`,
            "POST",
            { status: "REVOKED" },
            cookie,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await req(
            `shoots/${shoot}/media/${a.id}`,
            "DELETE",
            undefined,
            cookie,
          )
        ).status,
      ).toBe(404);
      expect((await req(i.uploadUrl, "PUT", photo, cookie)).status).toBe(403);
      expect(
        (
          await req(
            `shoots/${shoot}/uploads/${i.id}/complete`,
            "POST",
            {},
            cookie,
          )
        ).status,
      ).toBe(404);
    }
    expect(
      (
        await req(`shoots/${sibling}/subjects/${s.id}/consents`, "POST", {
          status: "GRANTED",
          acknowledged: true,
          confirmedAuthority: true,
        })
      ).status,
    ).toBe(404);
    expect((await req(`shoots/${sibling}/media/${a.id}/download`)).status).toBe(
      404,
    );
    expect(
      (await req(`shoots/${sibling}/uploads/${i.id}/complete`, "POST", {}))
        .status,
    ).toBe(409);
    expect(
      (
        await req(`shoots/${sibling}/upload-intents`, "POST", {
          fileName: "x.jpg",
          mime: "image/jpeg",
          bytes: photo.length,
          kind: "SUBJECT_PHOTO",
          subjectIds: [s.id],
        })
      ).status,
    ).toBe(404);
  });
  it("binds upload tokens to endpoint and rejects using them as session cookies", async () => {
    const s = await profile();
    await grant(s.id);
    const i = await intent([s.id]);

    expect(
      (await req("shoots", "GET", undefined, "fc_session=" + i.uploadToken))
        .status,
    ).toBe(401);
    expect(
      (await req(i.uploadUrl.replace(shoot, sibling), "PUT", photo)).status,
    ).toBe(403);
    expect((await req(i.uploadUrl + "x", "PUT", photo)).status).toBe(403);
    uploadTokens.set(i.id, i.uploadToken + "invalid");
    expect((await req(i.uploadUrl, "PUT", photo)).status).toBe(403);
    uploadTokens.set(i.id, i.uploadToken);
  });
  it("rejects path traversal, oversize files, mismatched signatures and tiny images", async () => {
    expect(() => safeKey("shoots/../../secret")).toThrow();
    expect(
      () =>
        new LocalObjectStore(path.resolve("apps/web/public/private-objects")),
    ).toThrow();
    const s = await profile();
    await grant(s.id);
    const base = {
      fileName: "fake.jpg",
      mime: "image/jpeg",
      bytes: photo.length,
      kind: "SUBJECT_PHOTO",
      subjectIds: [s.id],
    };
    expect(
      (
        await req(`shoots/${shoot}/upload-intents`, "POST", {
          ...base,
          fileName: "../secret.jpg",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req(`shoots/${shoot}/upload-intents`, "POST", {
          ...base,
          bytes: 16 * 1024 * 1024,
        })
      ).status,
    ).toBe(413);
    const fake = Buffer.from("<svg><script>alert(1)</script></svg>");
    const i = await intent([s.id], shoot, { bytes: fake.length });
    expect((await req(i.uploadUrl, "PUT", fake)).status).toBe(400);
    const tiny = await sharp({
      create: { width: 128, height: 128, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const t = await intent([s.id], shoot, { bytes: tiny.length });
    expect((await req(t.uploadUrl, "PUT", tiny)).status).toBe(400);
  });
  it("requires completion and rechecks consent on every read", async () => {
    const s = await profile();
    await grant(s.id);
    const i = await intent([s.id]);
    expect(
      (await req(`shoots/${shoot}/uploads/${i.id}/complete`, "POST", {}))
        .status,
    ).toBe(409);
    await data(i.uploadUrl, "PUT", photo);
    const a = await data(
      `shoots/${shoot}/uploads/${i.id}/complete`,
      "POST",
      {},
    );
    await data(`shoots/${shoot}/subjects/${s.id}/consents`, "POST", {
      status: "REVOKED",
    });
    expect((await req(`shoots/${shoot}/media/${a.id}/download`)).status).toBe(
      404,
    );
    expect(
      (await req(`shoots/${shoot}/uploads/${i.id}/complete`, "POST", {}))
        .status,
    ).toBe(409);
  });
  it("commits revocation even if physical deletion fails and supports cleanup retry", async () => {
    const { s, a } = await asset();
    const failed = vi
      .spyOn(LocalObjectStore.prototype, "remove")
      .mockRejectedValue(new Error("Simulated storage outage"));
    await data(`shoots/${shoot}/subjects/${s.id}/consents`, "POST", {
      status: "REVOKED",
    });
    expect((await req(`shoots/${shoot}/media/${a.id}/download`)).status).toBe(
      404,
    );
    const state = await data(`shoots/${shoot}/inputs`);
    expect(
      state.subjects.find((x: { id: string }) => x.id === s.id).consent.status,
    ).toBe("REVOKED");
    expect(state.deletionPending).toBeGreaterThan(0);
    failed.mockRestore();
    expect(
      (await req(`shoots/${shoot}/media-cleanup`, "POST", {}, outsider)).status,
    ).toBe(404);
    await data(`shoots/${shoot}/media-cleanup`, "POST", {});
    expect((await data(`shoots/${shoot}/inputs`)).deletionPending).toBe(0);
  });
  it("profile edits withdraw old consent and remove linked media", async () => {
    const { s, a } = await asset();
    await data(`shoots/${shoot}/subjects/${s.id}`, "PATCH", {
      ...blankSubject,
      label: "Corrected profile",
      ageGroup: "ADULT",
    });
    expect(
      (await data(`shoots/${shoot}/subjects`)).find(
        (x: { id: string }) => x.id === s.id,
      ).consent,
    ).toBeUndefined();
    expect((await req(`shoots/${shoot}/media/${a.id}/download`)).status).toBe(
      404,
    );
  });
  it("allows explicit people-free scene references without inventing consent", async () => {
    const i = await intent([], shoot, {
      kind: "SCENE_REFERENCE",
      noIdentifiablePeople: true,
    });
    await data(i.uploadUrl, "PUT", photo);
    expect(
      (await data(`shoots/${shoot}/uploads/${i.id}/complete`, "POST", {}))
        .subjectIds,
    ).toEqual([]);
  });
  it("S3 adapter uses private server-side operations and immutable keys (mock transport)", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    } as never);
    const storage = new S3ObjectStore(
      "private-bucket",
      "https://storage.example.invalid",
      "test-region",
    );
    await storage.put(
      "shoots/test/inputs/reference.webp",
      new Uint8Array([1, 2, 3]),
      "image/webp",
    );
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[0][0] as PutObjectCommand).input).toMatchObject({
      Bucket: "private-bucket",
      IfNoneMatch: "*",
    });
    await storage.get("shoots/test/inputs/reference.webp");
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetObjectCommand);
    await storage.remove("shoots/test/inputs/reference.webp");
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
describe("intake concurrency and deletion", () => {
  it("serializes revocation with in-flight image validation and invalidates completion", async () => {
    const s = await profile();
    await grant(s.id);
    const i = await intent([s.id]);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const latch = new Promise<void>((resolve) => (release = resolve));
    const original = imageIntake.inspect;
    vi.spyOn(imageIntake, "inspect").mockImplementation(async (...args) => {
      enter();
      await latch;
      return original(...args);
    });
    const uploading = req(i.uploadUrl, "PUT", photo);
    await entered;
    let revoked = false;
    const revoking = req(`shoots/${shoot}/subjects/${s.id}/consents`, "POST", {
      status: "REVOKED",
    }).then((r) => {
      revoked = true;
      return r;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(revoked).toBe(false);
    release();
    expect((await uploading).status).toBe(200);
    expect((await revoking).status).toBe(200);
    expect(
      (await req(`shoots/${shoot}/uploads/${i.id}/complete`, "POST", {}))
        .status,
    ).toBe(409);
  });
  it("keeps a deleting shoot inaccessible when storage cleanup fails, then retries safely", async () => {
    const target = (
      await data("shoots", "POST", {
        ...defaults,
        name: "Delete inputs safely",
      })
    ).id;
    const { a } = await asset(target);
    const failure = vi
      .spyOn(LocalObjectStore.prototype, "remove")
      .mockRejectedValue(new Error("Simulated outage"));
    expect((await req(`shoots/${target}`, "DELETE")).status).toBe(503);
    expect((await req(`shoots/${target}/media/${a.id}/download`)).status).toBe(
      404,
    );
    failure.mockRestore();
    expect((await req(`shoots/${target}`, "DELETE")).status).toBe(200);
    expect((await req(`shoots/${target}`)).status).toBe(404);
  });
});
describe("FC-009 equipment", () => {
  it("provides exact Canon preset, owner-only CRUD and per-shoot selection", async () => {
    const kit = await data("equipment/canon-preset", "POST", {});
    expect(kit).toMatchObject(canonPreset);
    expect(kit).toMatchObject({
      body: "Canon EOS R6 Mark II",
      lens: "RF 24–105mm f/4",
      flashCount: 2,
      modifiers: "90 cm gridded octabox",
    });
    expect(await data("equipment", "GET", undefined, outsider)).toEqual([]);
    expect(
      (await req("equipment/" + kit.id, "PATCH", canonPreset, outsider)).status,
    ).toBe(404);
    expect(
      (await req("equipment/" + kit.id, "DELETE", undefined, outsider)).status,
    ).toBe(404);
    expect(
      (
        await req(
          `shoots/${shoot}/equipment`,
          "PATCH",
          { kitId: kit.id },
          outsider,
        )
      ).status,
    ).toBe(404);
    await data(`shoots/${shoot}/equipment`, "PATCH", { kitId: kit.id });
    expect((await data(`shoots/${shoot}/inputs`)).cameraKit.sourceKitId).toBe(
      kit.id,
    );
    await data("equipment/" + kit.id, "DELETE");
    expect((await data(`shoots/${shoot}/inputs`)).cameraKit.body).toBe(
      "Canon EOS R6 Mark II",
    );
  });
});
