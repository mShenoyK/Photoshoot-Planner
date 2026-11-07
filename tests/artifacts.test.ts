import {
  ingestSource,
  processIngestion,
  documentDetail,
  reviewChunk,
  deleteDocument,
} from "../apps/web/lib/knowledge-service";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject, canonPreset } from "../packages/shared/src/inputs";
import { store } from "../apps/web/lib/store";
import { withShoot } from "../apps/web/lib/input-repository";
import { generatePlan } from "../apps/web/lib/planning-service";
import { changeStyling } from "../apps/web/lib/styling-service";
import {
  createArtifact,
  downloadArtifact,
  listArtifacts,
} from "../apps/web/lib/artifact-service";
import { digest, exportBytes, shotCsv } from "../apps/web/lib/exporters";
import { enqueue, runTask, retryTask } from "../apps/web/lib/job-queue";
import { getJob } from "../apps/web/lib/knowledge-repository";
import { SchematicIllustrator } from "../packages/ai/src/index";
import { validateIllustration } from "../apps/web/lib/pose-svg";
import { LocalObjectStore } from "../apps/web/lib/object-store";
import { inputs } from "../apps/web/lib/inputs-service";
import { handle } from "../apps/web/lib/api";
import { token } from "../apps/web/lib/auth";
import type { ShootPlan } from "../packages/shared/src/planning";
import type { TaskJob } from "../packages/shared/src/knowledge";
let dir: string,
  owner: string,
  shootId: string,
  plan: ShootPlan,
  ids: string[],
  illustrationId: string;
function task(format: string, extra: Record<string, unknown> = {}): TaskJob {
  return {
    id: randomUUID(),
    ownerId: owner,
    shootId,
    kind: format === "ILLUSTRATION" ? "ILLUSTRATE" : "EXPORT",
    status: "RUNNING",
    progress: 10,
    attempts: 1,
    input: { planId: plan.id, format, ...extra },
    idempotencyKey: randomUUID(),
    createdAt: "2026-11-07T10:00:00.000Z",
    updatedAt: "2026-11-07T10:00:00.000Z",
  };
}
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-artifacts-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = path.join(dir, "objects");
  process.env.MOCK_QUEUE_AUTO_RUN = "false";
  process.env.QUEUE_DRIVER = "mock";
  process.env.AI_IMAGE_PROVIDER = "mock";
  owner = (
    await store.createUser(`export-${randomUUID()}@example.com`, "unused")
  ).id;
  shootId = (await store.save(owner, {
    ...defaults,
    name: "Original family brief",
    portraitCategory: "PORTRAIT_GROUP",
    subjectCount: 4,
  }))!.id;
  ids = Array.from({ length: 4 }, () => randomUUID());
  await withShoot(owner, shootId, (s) => {
    s.subjects = ids.map((id, i) => ({
      ...blankSubject,
      id,
      label: `Person ${i + 1}`,
      ageGroup: i < 2 ? "ADULT" : i === 2 ? "CHILD" : "BABY",
      consentHistory: [],
    }));
    s.cameraKit = { ...canonPreset, sourceKitId: randomUUID() };
  });
  await generatePlan(owner, shootId, randomUUID(), {
    poseCount: 3,
    useKnowledgeBase: false,
  });
  plan = (await withShoot(owner, shootId, (s) => s.plans!.at(-1)))!;
  await changeStyling(owner, shootId, {
    action: "LIGHTING",
    recipe: "CONTEXT",
    baseRevision: 0,
  });
  await changeStyling(owner, shootId, { action: "WARDROBE", baseRevision: 1 });
});
afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.AI_IMAGE_PROVIDER;
  delete process.env.MOCK_QUEUE_AUTO_RUN;
  await rm(dir, { recursive: true, force: true });
});
it("creates on-demand four-person original schematic, verifies caregivers and never reads photos", async () => {
  const get = vi.spyOn(LocalObjectStore.prototype, "get");
  const job = task("ILLUSTRATION", { poseId: plan.poses[0].id });
  await createArtifact(owner, job);
  illustrationId = job.id;
  expect(get).not.toHaveBeenCalled();
  get.mockRestore();
  const { bytes, artifact } = await downloadArtifact(owner, shootId, job.id);
  const svg = Buffer.from(bytes).toString();
  expect(svg.match(/data-subject=/g)).toHaveLength(4);
  expect(svg).toContain("Caregiver support");
  expect(artifact.provider).toBe("original-schematic-mock-v1");
  expect(svg).not.toContain("<image");
  const before = await listArtifacts(owner, shootId);
  await createArtifact(owner, job);
  expect(await listArtifacts(owner, shootId)).toEqual(before);
});
it("rejects wrong counts, duplicate people, missing caregivers and unsafe young-child support", async () => {
  const input = {
    pose: plan.poses[0],
    subjects: ids.map((id, i) => ({
      id,
      ageGroup: i === 3 ? "BABY" : "ADULT",
    })),
  };
  const scene = await new SchematicIllustrator().generate(input);
  expect(() =>
    validateIllustration({ ...scene, figures: scene.figures.slice(1) }, input),
  ).toThrow();
  expect(() =>
    validateIllustration(
      {
        ...scene,
        figures: [
          scene.figures[0],
          scene.figures[0],
          ...scene.figures.slice(2),
        ],
      },
      input,
    ),
  ).toThrow();
  expect(() =>
    validateIllustration(
      {
        ...scene,
        figures: scene.figures.map((f, i) =>
          i === 3 ? { ...f, support: "SEATED" } : f,
        ),
      },
      input,
    ),
  ).toThrow();
  const unsupported = {
    ...input,
    subjects: [{ id: ids[3], ageGroup: "BABY" }],
  };
  expect(() =>
    validateIllustration(
      {
        figures: [
          { subjectId: ids[3], x: 70, y: 210, support: "CAREGIVER_SUPPORTED" },
        ],
      },
      unsupported,
    ),
  ).toThrow();
});
it("exports parseable deterministic ZIP with hashed allowlisted files and no subject uploads", async () => {
  // A deliberately inaccessible synthetic upload must never be fetched or packed.
  await withShoot(owner, shootId, (s) => {
    s.media.push({
      id: randomUUID(),
      kind: "SUBJECT_PHOTO",
      fileName: "PRIVATE-PHOTO.jpg",
      mime: "image/jpeg",
      bytes: 10,
      width: 500,
      height: 500,
      sha256: "a".repeat(64),
      subjectIds: ids,
      consentIds: {},
      originalKey: `shoots/${shootId}/inputs/private-photo.jpg`,
      derivativeKey: `shoots/${shootId}/inputs/private-photo.webp`,
      warnings: [],
      createdAt: new Date().toISOString(),
    });
  });
  const job = task("ZIP", { stylingRevision: 2 });
  await createArtifact(owner, job);
  const { bytes } = await downloadArtifact(owner, shootId, job.id);
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      "shoot-plan.md",
      "shot-list.csv",
      "shoot-plan.pdf",
      "lighting-top.svg",
      "lighting-side.svg",
      "lighting-scene.json",
      "manifest.json",
    ]),
  );
  expect(
    Object.keys(files).some(
      (f) => f.includes("PRIVATE") || /\.(jpg|webp)$/i.test(f),
    ),
  ).toBe(false);
  expect(
    Object.keys(files).filter((f) => f.startsWith("illustrations/")),
  ).toHaveLength(1);
  for (const file of manifest.files) {
    expect(digest(files[file.name])).toBe(file.sha256);
    expect(files[file.name].length).toBe(file.bytes);
  }
  expect(manifest.exclusions).toContain("subject photographs");
  expect(manifest.planVersion).toBe(plan.version);
  expect(manifest.stylingRevision).toBe(2);
  expect(
    (await PDFDocument.load(files["shoot-plan.pdf"])).getPageCount(),
  ).toBeGreaterThan(2);
  expect(strFromU8(files["shoot-plan.md"])).toContain("Person 4");
  await createArtifact(owner, job);
  expect((await downloadArtifact(owner, shootId, job.id)).bytes).toEqual(bytes);
});
it("escapes spreadsheet formulas and Markdown HTML without losing CSV quoting or Unicode", async () => {
  const p = structuredClone(plan);
  p.shotList[0].description =
    '  =HYPERLINK("https://evil.invalid","click")\n你好';
  p.creativeBrief.narrative = '<script>alert("x")</script>';
  const csv = shotCsv(p);
  expect(csv).toContain(
    '"\'  =HYPERLINK(""https://evil.invalid"",""click"")\n你好"',
  );
  const md = Buffer.from(
    await exportBytes(
      { plan: p, title: "Safe", createdAt: "2026-11-07T00:00:00Z" },
      "MARKDOWN",
    ),
  ).toString();
  expect(md).not.toContain("<script>");
  expect(md).toContain("&lt;script&gt;");
  const pdf = await exportBytes(
    { plan: p, title: "Unicode 你好", createdAt: "2026-11-07T00:00:00Z" },
    "PDF",
  );
  expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
});
it("validates each export format, freezes old versions and refuses missing styling for SVG", async () => {
  for (const format of ["PDF", "MARKDOWN", "CSV", "SVG"]) {
    const job = task(format, { stylingRevision: 2 });
    await createArtifact(owner, job);
    expect(
      (await downloadArtifact(owner, shootId, job.id)).artifact.format,
    ).toBe(format);
  }
  await expect(createArtifact(owner, task("SVG"))).rejects.toMatchObject({
    code: "LIGHTING_REQUIRED",
  });
  const items = await listArtifacts(owner, shootId);
  expect(new Set(items.map((a) => a.id)).size).toBe(items.length);
  expect(items.every((a) => !("storageKey" in a))).toBe(true);
});
it("fails closed on image provider errors and retries a durable job without duplicate artifacts", async () => {
  process.env.AI_IMAGE_PROVIDER = "unconfigured";
  let j = await enqueue(
    owner,
    "ILLUSTRATE",
    randomUUID(),
    { planId: plan.id, format: "ILLUSTRATION", poseId: plan.poses[1].id },
    shootId,
  );
  await expect(runTask(owner, j.id)).rejects.toMatchObject({
    code: "IMAGE_PROVIDER_NOT_CONFIGURED",
  });
  expect((await getJob(owner, j.id)).status).toBe("FAILED");
  expect((await getJob(owner, j.id)).errorCode).toBe(
    "IMAGE_PROVIDER_NOT_CONFIGURED",
  );
  process.env.AI_IMAGE_PROVIDER = "mock";
  j = await retryTask(owner, j.id);
  await runTask(owner, j.id);
  expect((await getJob(owner, j.id)).status).toBe("SUCCEEDED");
  expect((await getJob(owner, j.id)).attempts).toBe(2);
  await runTask(owner, j.id);
  expect(
    (await listArtifacts(owner, shootId)).filter((a) => a.jobId === j.id),
  ).toHaveLength(1);
});
it("protects downloads and creation across owners and same-owner shoots; attaches trace IDs", async () => {
  const other = (await store.save(owner, {
    ...defaults,
    name: "Other private shoot",
  }))!.id;
  const cookie = `fc_session=${await token(owner)}`;
  const alien = `fc_session=${await token(randomUUID())}`;
  for (const [id, c] of [
    [shootId, alien],
    [other, cookie],
  ]) {
    const r = await handle(
      new Request(
        `http://localhost:3000/api/v1/shoots/${id}/artifacts/${illustrationId}/download`,
        { headers: { cookie: c } },
      ),
    );
    expect(r.status).toBe(404);
    expect(r.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  }
  const r = await handle(
    new Request(`http://localhost:3000/api/v1/shoots/${other}/artifacts`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:3000" },
      body: JSON.stringify({
        planId: plan.id,
        format: "ZIP",
        idempotencyKey: randomUUID(),
      }),
    }),
  );
  expect(r.status).toBe(404);
  const own = await handle(
    new Request(
      `http://localhost:3000/api/v1/shoots/${shootId}/artifacts/${illustrationId}/download`,
      { headers: { cookie } },
    ),
  );
  expect(own.status).toBe(200);
  expect(own.headers.get("cache-control")).toContain("no-store");
  expect(own.headers.get("content-security-policy")).toContain("sandbox");
});
it("blocks old downloads and new exports after cited source deletion", async () => {
  const source = await ingestSource(
    owner,
    {
      title: "Owned synthetic export guide",
      licenseStatus: "OWNED",
      ingestionPermitted: true,
      allowDerivedUse: true,
      allowPrivateReview: true,
      taxonomy: { topics: ["POSE"] },
    },
    Buffer.from(
      "# Original synthetic guidance\nArrange family portraits with comfortable supports and inspect backgrounds before choosing a stable composition.",
    ),
    "synthetic.md",
    "text/markdown",
  );
  await processIngestion(owner, source.document.id);
  const doc = await documentDetail(owner, source.document.id);
  const chunk = doc.chunks[0];
  await reviewChunk(owner, doc.id, chunk.id, {
    summary:
      "Keep family members at rest in a secure layout and evaluate framing before asking for small adjustments.",
    reviewStatus: "APPROVED",
    baseRevision: chunk.revision,
    taxonomy: chunk.taxonomy,
  });
  const generated = await generatePlan(owner, shootId, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: true,
  });
  const grounded = await withShoot(owner, shootId, (s) =>
    s.plans!.find((p) => p.id === generated.planId)!,
  );
  expect(grounded.poses[0].sourceReferences).toHaveLength(1);
  const job = task("MARKDOWN", { planId: grounded.id });
  await createArtifact(owner, job);
  expect(
    (await downloadArtifact(owner, shootId, job.id)).bytes.length,
  ).toBeGreaterThan(0);
  await deleteDocument(owner, doc.id);
  await expect(downloadArtifact(owner, shootId, job.id)).rejects.toMatchObject({
    code: "SOURCE_UNAVAILABLE",
  });
  await expect(
    createArtifact(owner, task("MARKDOWN", { planId: grounded.id })),
  ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
});
it("does not publish provider output with incorrect subjects", async () => {
  const before = await listArtifacts(owner, shootId);
  const put = vi.spyOn(LocalObjectStore.prototype, "put");
  await expect(
    createArtifact(owner, task("ILLUSTRATION", { poseId: plan.poses[0].id }), {
      name: "invalid-test-provider",
      generate: async () => ({
        figures: [{ subjectId: ids[0], x: 70, y: 210, support: "SEATED" }],
      }),
    }),
  ).rejects.toMatchObject({ code: "ILLUSTRATION_COUNT" });
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
  expect(await listArtifacts(owner, shootId)).toEqual(before);
});
it("retains cleanup work and blocks logical access before retrying failed private output deletion", async () => {
  const remove = vi
    .spyOn(LocalObjectStore.prototype, "remove")
    .mockRejectedValue(new Error("storage unavailable"));
  expect(await inputs.purge(owner, shootId)).toBe(false);
  await expect(listArtifacts(owner, shootId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  remove.mockRestore();
  const cleanup = await inputs.retryCleanup(owner, shootId).catch(() => null);
  expect(cleanup).toBe(null); // deleting shoots use the idempotent purge retry, not normal routes
  expect(await inputs.purge(owner, shootId)).toBe(true);
});
