import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject, canonPreset } from "../packages/shared/src/inputs";
import { store } from "../apps/web/lib/store";
import { inputs } from "../apps/web/lib/inputs-service";
import { withShoot } from "../apps/web/lib/input-repository";
import {
  analyzeReference,
  approveReference,
  readReferences,
} from "../apps/web/lib/reference-service";
import { LocalObjectStore } from "../apps/web/lib/object-store";
import {
  MockReferenceVision,
  OpenAIReferenceVision,
} from "../packages/ai/src/index";
import { generatePlan, listPlans } from "../apps/web/lib/planning-service";
import { changeStyling } from "../apps/web/lib/styling-service";
import { enqueue, retryTask } from "../apps/web/lib/job-queue";
import { getJob, withJobs } from "../apps/web/lib/knowledge-repository";
let dir: string, owner: string, image: Buffer;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-reference-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = path.join(dir, "objects");
  process.env.AUTH_SECRET = "test-reference-secret-with-at-least-32-characters";
  image = await sharp({
    create: { width: 512, height: 768, channels: 3, background: "#637eac" },
  })
    .jpeg()
    .toBuffer();
  owner = (await store.createUser(`ref-${randomUUID()}@example.com`, "unused"))
    .id;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function fixture(allowAnalysis = true, minor = false) {
  const shoot = (await store.save(owner, {
    ...defaults,
    name: "Photo-led portrait",
  }))!;
  const subject = await inputs.saveSubject(owner, shoot.id, {
    ...blankSubject,
    label: minor ? "Child" : "Participant",
    ageGroup: minor ? "CHILD" : "ADULT",
    avoidedColors: "red",
    fitComfort: "Soft waist and seated comfort",
  });
  await inputs.consent(owner, shoot.id, subject.id, {
    status: "GRANTED",
    acknowledged: true,
    confirmedAuthority: true,
    allowAnalysis,
    ...(minor
      ? { guardianName: "Guardian", guardianRelationship: "Parent" }
      : {}),
  });
  const i = await inputs.intent(owner, shoot.id, {
    fileName: "synthetic.jpg",
    mime: "image/jpeg",
    bytes: image.length,
    kind: "SUBJECT_PHOTO",
    subjectIds: [subject.id],
  });
  await inputs.upload(
    owner,
    shoot.id,
    i.id,
    new Request("http://localhost/upload", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${i.uploadToken}`,
        "Content-Type": "image/jpeg",
      },
      body: Uint8Array.from(image),
    }),
  );
  const asset = await inputs.complete(owner, shoot.id, i.id);
  await withShoot(owner, shoot.id, (s) => {
    s.cameraKit = { ...canonPreset, sourceKitId: randomUUID() };
  });
  return { shoot, subject, asset };
}
async function observed() {
  const a = await new MockReferenceVision().analyze();
  return {
    ...a,
    sceneSummary: "Reference garden with a clear background",
    lightingNotes: "Soft light from camera right, warm cast",
    keySide: "RIGHT" as const,
    visibleColors: ["#637EAC"],
    visibleProportions:
      "Shoulder line appears wider than the garment's waist; loose clothing and perspective make this uncertain.",
    fitSuggestions: [
      "Confirm a relaxed shoulder fit and comfortable waist with the participant.",
    ],
    suggestedColors: ["#FF0000", "#26374A", "#D9CCB6"],
    posingNotes: [
      "Turn slightly toward the reference's open side while keeping comfortable stable footing.",
    ],
  };
}
it("blocks photo processing without analysis permission before image access or provider invocation", async () => {
  const f = await fixture(false);
  const get = vi.spyOn(LocalObjectStore.prototype, "get");
  const analyze = vi.fn(async () => observed());
  await expect(
    analyzeReference(owner, f.shoot.id, f.asset.id, {
      name: "test-vision",
      analyze,
    }),
  ).rejects.toMatchObject({ code: "ANALYSIS_CONSENT_REQUIRED" });
  expect(get).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
});
it("requires review before photo observations can affect a plan, light geometry or wardrobe", async () => {
  const f = await fixture();
  const a = await observed();
  const r = await analyzeReference(owner, f.shoot.id, f.asset.id, {
    name: "test-vision",
    analyze: async () => a,
  });
  expect(r.approved).toBe(false);
  await generatePlan(owner, f.shoot.id, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: false,
  });
  expect(
    (
      await listPlans(owner, f.shoot.id)
    )[0].creativeBrief.venueConsiderations.join(" "),
  ).not.toContain(a.sceneSummary);
  const edited = {
    ...r.analysis,
    visibleProportions:
      "Participant confirmed preference for relaxed shoulder room.",
  };
  await approveReference(owner, f.shoot.id, r.id, {
    analysis: edited,
    approved: true,
  });
  await generatePlan(owner, f.shoot.id, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: false,
  });
  const plan = (await listPlans(owner, f.shoot.id)).at(-1)!;
  expect(plan.creativeBrief.venueConsiderations.join(" ")).toContain(
    a.sceneSummary,
  );
  expect(plan.poses[0].stepByStepDirections).toContain(a.posingNotes[0]);
  let v = await changeStyling(owner, f.shoot.id, {
    action: "LIGHTING",
    baseRevision: 0,
    recipe: "CONTEXT",
  });
  expect(v.latest!.lighting!.scene.lights[0].x).toBe(4.5);
  expect(v.latest!.lighting!.notes.join(" ")).toContain(a.lightingNotes);
  v = await changeStyling(owner, f.shoot.id, {
    action: "WARDROBE",
    baseRevision: 1,
  });
  const look = v.latest!.wardrobe!.looks[0];
  expect(look.candidates).toHaveLength(3);
  expect(look.candidates[0].comfort).toContain(edited.visibleProportions);
  expect(look.candidates.some((c) => c.color === "#FF0000")).toBe(false);
  expect(look.candidates[0].comfort).toContain("Soft waist");
  expect(
    (await readReferences(owner, f.shoot.id)).reviews[0],
  ).not.toHaveProperty("consentIds");
});
it("keeps guardian consent mandatory and removes cached review/locked photo-derived looks after revocation", async () => {
  const f = await fixture(true, true);
  const r = await analyzeReference(owner, f.shoot.id, f.asset.id, {
    name: "test-vision",
    analyze: observed,
  });
  await approveReference(owner, f.shoot.id, r.id, {
    analysis: r.analysis,
    approved: true,
  });
  let v = await changeStyling(owner, f.shoot.id, {
    action: "WARDROBE",
    baseRevision: 0,
  });
  const l = v.latest!.wardrobe!.looks[0];
  v = await changeStyling(owner, f.shoot.id, {
    action: "SELECT",
    baseRevision: 1,
    subjectId: f.subject.id,
    candidateId: l.selectedId,
    locked: true,
  });
  await inputs.consent(owner, f.shoot.id, f.subject.id, { status: "REVOKED" });
  expect((await readReferences(owner, f.shoot.id)).reviews).toHaveLength(0);
  await expect(
    analyzeReference(owner, f.shoot.id, f.asset.id),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  v = await changeStyling(owner, f.shoot.id, {
    action: "WARDROBE",
    baseRevision: 2,
  });
  expect(v.latest!.wardrobe!.looks[0].locked).toBe(false);
  expect(v.latest!.wardrobe!.looks[0].sourceReferenceId).toBeUndefined();
});
it("denies foreign owner and same-owner cross-shoot reference IDs", async () => {
  const f = await fixture();
  const other = (await store.save(owner, {
    ...defaults,
    name: "Other shoot",
  }))!;
  const call = vi.fn(async () => observed());
  await expect(
    analyzeReference(randomUUID(), f.shoot.id, f.asset.id, {
      name: "test",
      analyze: call,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    analyzeReference(owner, other.id, f.asset.id, {
      name: "test",
      analyze: call,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(call).not.toHaveBeenCalled();
});
it("rejects malformed provider output without persisting an observation", async () => {
  const f = await fixture();
  await expect(
    analyzeReference(owner, f.shoot.id, f.asset.id, {
      name: "bad",
      analyze: async () => ({ personality: "extrovert", weight: 90 }),
    }),
  ).rejects.toMatchObject({ code: "VISION_FAILED" });
  expect((await readReferences(owner, f.shoot.id)).reviews).toHaveLength(0);
});
it("OpenAI adapter sends only sanitized image bytes and declared context and validates returned JSON", async () => {
  const a = await observed();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json({ choices: [{ message: { content: JSON.stringify(a) } }] }),
    );
  vi.stubGlobal("fetch", fetch);
  const provider = new OpenAIReferenceVision(
    "synthetic-test-key",
    "test-vision-model",
  );
  const result = await provider.analyze({
    image: Uint8Array.from([1, 2, 3]),
    kind: "SUBJECT_PHOTO",
    subjectCount: 1,
    ageGroups: ["ADULT"],
  });
  expect(result).toEqual(a);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://api.openai.com/v1/chat/completions",
  );
  const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(body.messages[1].content[1].image_url.url).toBe(
    "data:image/webp;base64,AQID",
  );
  expect(JSON.stringify(body)).not.toContain("Participant's real name");
});
it("processes durable plans inline without Redis and retries provider failures without duplicate versions", async () => {
  const f = await fixture();
  vi.stubEnv("QUEUE_DRIVER", "inline");
  vi.stubEnv("REDIS_URL", undefined);
  vi.stubEnv("AI_TEXT_PROVIDER", "not-configured");
  let j = await enqueue(
    owner,
    "PLAN",
    randomUUID(),
    { poseCount: 2, useKnowledgeBase: false },
    f.shoot.id,
  );
  expect(j.status).toBe("FAILED");
  expect(j.errorCode).toBe("TEXT_PROVIDER_NOT_CONFIGURED");
  vi.stubEnv("AI_TEXT_PROVIDER", "mock");
  j = await retryTask(owner, j.id);
  expect(j.status).toBe("SUCCEEDED");
  expect(await listPlans(owner, f.shoot.id)).toHaveLength(1);
  expect((await getJob(owner, j.id)).attempts).toBe(2);
});
it("can resume an abandoned pre-worker queued job in inline mode", async () => {
  const f = await fixture();
  vi.stubEnv("QUEUE_DRIVER", "mock");
  vi.stubEnv("MOCK_QUEUE_AUTO_RUN", "false");
  const j = await enqueue(
    owner,
    "PLAN",
    randomUUID(),
    { poseCount: 1, useKnowledgeBase: false },
    f.shoot.id,
  );
  await withJobs(owner, (jobs) => {
    jobs.find((x) => x.id === j.id)!.updatedAt = new Date(
      Date.now() - 120000,
    ).toISOString();
  });
  vi.stubEnv("QUEUE_DRIVER", "inline");
  expect((await retryTask(owner, j.id)).status).toBe("SUCCEEDED");
});
it("preserves an explicitly locked photo-based look when the same consented photo is re-reviewed", async () => {
  const f = await fixture();
  let r = await analyzeReference(owner, f.shoot.id, f.asset.id, {
    name: "test-vision",
    analyze: observed,
  });
  await approveReference(owner, f.shoot.id, r.id, {
    analysis: r.analysis,
    approved: true,
  });
  let v = await changeStyling(owner, f.shoot.id, {
    action: "WARDROBE",
    baseRevision: 0,
  });
  const look = v.latest!.wardrobe!.looks[0];
  v = await changeStyling(owner, f.shoot.id, {
    action: "SELECT",
    baseRevision: 1,
    subjectId: f.subject.id,
    candidateId: look.selectedId,
    locked: true,
  });
  const locked = structuredClone(v.latest!.wardrobe!.looks[0]);
  r = await analyzeReference(owner, f.shoot.id, f.asset.id, {
    name: "test-vision",
    analyze: observed,
  });
  await approveReference(owner, f.shoot.id, r.id, {
    analysis: r.analysis,
    approved: true,
  });
  v = await changeStyling(owner, f.shoot.id, {
    action: "WARDROBE",
    baseRevision: 2,
  });
  expect(v.latest!.wardrobe!.looks[0]).toEqual(locked);
});

it("does not attribute body proportions from a pose/scene reference to the participant", async () => {
  const f = await fixture();
  await withShoot(owner, f.shoot.id, (s) => {
    s.media.find((a) => a.id === f.asset.id)!.kind = "POSE_REFERENCE";
  });
  const r = await analyzeReference(owner, f.shoot.id, f.asset.id, {
    name: "test-vision",
    analyze: observed,
  });
  expect(r.analysis.visibleProportions).toContain("not attributed");
});
