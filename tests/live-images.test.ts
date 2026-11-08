import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject } from "../packages/shared/src/inputs";
import type { TaskJob } from "../packages/shared/src/knowledge";
import type { VisualTarget } from "../packages/shared/src/visuals";
import { store } from "../apps/web/lib/store";
import { withShoot } from "../apps/web/lib/input-repository";
import { generatePlan, listPlans } from "../apps/web/lib/planning-service";
import { changeStyling } from "../apps/web/lib/styling-service";
import {
  createRecommendationVisual,
  downloadVisual,
  matchingVisual,
  listVisuals,
} from "../apps/web/lib/visual-service";
import {
  OpenAIRecommendationImages,
  OpenAIPlanner,
  MockPlanner,
  textPlanner,
  recommendationImages,
} from "../packages/ai/src/index";
import { LocalObjectStore } from "../apps/web/lib/object-store";
let dir: string, owner: string, png: Buffer;
const review = (subjectCount: number) => ({
  subjectCount,
  ageBandsMatch: true,
  safeSupportedPose: true,
  matchesRequestedScene: true,
  matchesRequestedOutfit: true,
  notes: "Fixture review: correct fictional people and safe arrangement.",
});
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-live-images-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_DIR = path.join(dir, "objects");
  process.env.AI_TEXT_PROVIDER = "mock";
  owner = (
    await store.createUser(`images-${randomUUID()}@example.com`, "unused")
  ).id;
  png = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "#446688" },
  })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function fixture(count = 1) {
  const shoot = (await store.save(owner, {
    ...defaults,
    portraitCategory: "PORTFOLIO",
    name: "Original image session",
    subjectCount: count,
  }))!;
  await withShoot(owner, shoot.id, (s) => {
    s.subjects = Array.from({ length: count }, (_, i) => ({
      ...blankSubject,
      id: randomUUID(),
      label: `Participant ${i + 1}`,
      ageGroup: i < 2 ? "ADULT" : "CHILD",
      consentHistory: [],
    }));
  });
  return shoot.id;
}
function job(id: string, target: VisualTarget): TaskJob {
  return {
    id: randomUUID(),
    ownerId: owner,
    shootId: id,
    kind: "VISUAL",
    status: "RUNNING",
    progress: 10,
    attempts: 1,
    input: { target },
    idempotencyKey: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
it("sends live image and independent review requests to fixed OpenAI endpoints without URL downloads", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        requests.length === 1
          ? { data: [{ b64_json: png.toString("base64") }] }
          : { choices: [{ message: { content: JSON.stringify(review(1)) } }] },
      );
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await new OpenAIRecommendationImages("test-only-key").generate(
    {
      kind: "POSE",
      subjects: [{ ageGroup: "ADULT" }],
      context: { scene: "Garden" },
      guidance: { pose: "Comfortable seated portrait" },
    },
  );
  expect(result.bytes).toEqual(png);
  expect(requests.map((r) => r.url)).toEqual([
    "https://api.openai.com/v1/images/generations",
    "https://api.openai.com/v1/chat/completions",
  ]);
  expect(requests[0].body).toMatchObject({
    n: 1,
    output_format: "png",
    model: "gpt-image-1",
  });
  expect(JSON.stringify(requests[0].body)).toContain("exactly 1 people");
});
it("rejects count/safety mismatch, provider failures and oversized responses without a dummy fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ b64_json: png.toString("base64") }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...review(1), subjectCount: 2 }),
              },
            },
          ],
        }),
      ),
  );
  await expect(
    new OpenAIRecommendationImages("test-only-key").generate({
      kind: "POSE",
      subjects: [{ ageGroup: "ADULT" }],
      context: {},
      guidance: {},
    }),
  ).rejects.toThrow("IMAGE_REVIEW_FAILED");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("credential-bearing upstream response", { status: 401 }),
    ),
  );
  await expect(
    new OpenAIRecommendationImages("test-only-key").generate({
      kind: "LIGHTING",
      subjects: [],
      context: {},
      guidance: {},
    }),
  ).rejects.toThrow("PROVIDER_AUTH");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          headers: { "content-length": String(30 * 1024 * 1024) },
        }),
    ),
  );
  await expect(
    new OpenAIRecommendationImages("test-only-key").generate({
      kind: "LIGHTING",
      subjects: [],
      context: {},
      guidance: {},
    }),
  ).rejects.toThrow("PROVIDER_SIZE");
});
it("uses real structured text planning and overrides untrusted provider metadata", async () => {
  const id = await fixture();
  const shoot = (await store.list(owner)).find((s) => s.id === id)!;
  const subjects = await withShoot(owner, id, (s) => s.subjects);
  const input = {
    shoot,
    subjects,
    equipment: undefined,
    context: [],
    poseCount: 2,
    inputHash: "test-input",
    genericFallback: false,
  };
  const output = await new MockPlanner().generateStructuredPlan(input);
  output.provider = "untrusted-provider-label";
  const fetcher = vi.fn(async () =>
    Response.json({
      choices: [{ message: { content: JSON.stringify(output) } }],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await new OpenAIPlanner(
    "test-only-key",
  ).generateStructuredPlan(input);
  expect(result.provider).toBe("openai-text:gpt-4.1");
  expect(result.id).not.toBe(output.id);
  expect(fetcher.mock.calls).toHaveLength(1);
});
it("blocks production mock text and image modes and missing credentials", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AI_TEXT_PROVIDER", "mock");
  vi.stubEnv("AI_IMAGE_PROVIDER", "mock");
  expect(() => textPlanner()).toThrow("LIVE_PROVIDER_REQUIRED");
  expect(() => recommendationImages()).toThrow("LIVE_PROVIDER_REQUIRED");
  vi.stubEnv("AI_TEXT_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AI_API_KEY", "");
  expect(() => textPlanner()).toThrow("OPENAI_NOT_CONFIGURED");
});
it("stores immutable private images, isolates owners, and reuses unchanged outfit guidance across lock revisions", async () => {
  const id = await fixture();
  let style = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: 0,
  });
  const look = style.latest!.wardrobe!.looks[0];
  const target: VisualTarget = {
    kind: "WARDROBE",
    stylingRevision: 1,
    subjectId: look.subjectId,
    candidateId: look.selectedId,
  };
  const provider = {
    name: "fixture-image-provider",
    generate: vi.fn(async () => ({ bytes: png, review: review(1) })),
  };
  const task = job(id, target);
  await createRecommendationVisual(owner, task, provider);
  await createRecommendationVisual(owner, task, provider);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  const item = (await listVisuals(owner, id))[0];
  expect(item).not.toHaveProperty("storageKey");
  const downloaded = await downloadVisual(owner, id, item.id);
  expect(downloaded.bytes.subarray(0, 8)).toEqual(png.subarray(0, 8));
  await expect(downloadVisual(randomUUID(), id, item.id)).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
  style = await changeStyling(owner, id, {
    action: "SELECT",
    baseRevision: 1,
    subjectId: look.subjectId,
    candidateId: look.selectedId,
    locked: true,
  });
  const nextTarget = { ...target, stylingRevision: style.latest!.revision };
  expect((await matchingVisual(owner, id, nextTarget))?.id).toBe(item.id);
  await createRecommendationVisual(owner, job(id, nextTarget), provider);
  expect(provider.generate).toHaveBeenCalledTimes(1);
});
it("does not publish count-mismatched images or images generated against changed inputs", async () => {
  const id = await fixture(4);
  await generatePlan(owner, id, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: false,
  });
  const plan = (await listPlans(owner, id))[0];
  const target: VisualTarget = {
    kind: "POSE",
    planId: plan.id,
    poseId: plan.poses[0].id,
  };
  const put = vi.spyOn(LocalObjectStore.prototype, "put");
  await expect(
    createRecommendationVisual(owner, job(id, target), {
      name: "bad-count",
      generate: async () => ({ bytes: png, review: review(3) }),
    }),
  ).rejects.toMatchObject({ code: "IMAGE_REVIEW_FAILED" });
  expect(put).not.toHaveBeenCalled();
  await expect(
    createRecommendationVisual(owner, job(id, target), {
      name: "changed-input",
      generate: async () => {
        await withShoot(owner, id, (s) => {
          s.subjects[0].fitComfort = "Changed while provider ran";
        });
        return { bytes: png, review: review(4) };
      },
    }),
  ).rejects.toMatchObject({ code: "STALE_INPUTS" });
  expect(put).not.toHaveBeenCalled();
  expect(await listVisuals(owner, id)).toHaveLength(0);
});
it("renders infant wardrobe as a people-free flat lay and requires caregivers for infant pose images", async () => {
  const id = await fixture();
  await withShoot(owner, id, (s) => {
    s.subjects[0].ageGroup = "BABY";
  });
  const style = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: 0,
  });
  const look = style.latest!.wardrobe!.looks[0];
  const provider = {
    name: "fixture-flatlay",
    generate: vi.fn(async () => ({ bytes: png, review: review(0) })),
  };
  await createRecommendationVisual(
    owner,
    job(id, {
      kind: "WARDROBE",
      stylingRevision: 1,
      subjectId: look.subjectId,
      candidateId: look.selectedId,
    }),
    provider,
  );
  expect(provider.generate.mock.calls).toHaveLength(1);
  const input = (provider.generate as ReturnType<typeof vi.fn>).mock
    .calls[0][0];
  expect(input.guidance.renderMode).toBe("FLAT_LAY");
  expect(input.subjects).toEqual([]);
  await generatePlan(owner, id, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: false,
  });
  const plan = (await listPlans(owner, id))[0];
  await expect(
    createRecommendationVisual(
      owner,
      job(id, { kind: "POSE", planId: plan.id, poseId: plan.poses[0].id }),
      provider,
    ),
  ).rejects.toMatchObject({ code: "CAREGIVER_REQUIRED" });
});

it("explicit regeneration produces a new immutable image and whole-workspace deletion removes outputs", async () => {
  const { inputs } = await import("../apps/web/lib/inputs-service");
  const id = await fixture();
  const style = await changeStyling(owner, id, {
    action: "LIGHTING",
    baseRevision: 0,
    recipe: "CONTEXT",
  });
  const target: VisualTarget = {
    kind: "LIGHTING",
    stylingRevision: style.latest!.revision,
  };
  const provider = {
    name: "fixture-refresh",
    generate: vi.fn(async () => ({ bytes: png, review: review(1) })),
  };
  await createRecommendationVisual(owner, job(id, target), provider);
  const force = job(id, target);
  force.input.force = true;
  await createRecommendationVisual(owner, force, provider);
  expect(provider.generate).toHaveBeenCalledTimes(2);
  const items = await listVisuals(owner, id);
  expect(items).toHaveLength(2);
  const remove = vi.spyOn(LocalObjectStore.prototype, "remove");
  await inputs.purge(owner, id);
  expect(
    remove.mock.calls.some(([key]) => key.endsWith("recommendation.png")),
  ).toBe(true);
  await expect(listVisuals(owner, id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it("tailors live wardrobe text while preserving colors and rejects changed IDs or avoided garments", async () => {
  const { OpenAIWardrobeStylist } = await import("../packages/ai/src/index");
  const id = await fixture();
  const style = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: 0,
  });
  const shoot = (await store.list(owner)).find((s) => s.id === id)!;
  const subjects = await withShoot(owner, id, (s) => s.subjects);
  const wardrobe = style.latest!.wardrobe!;
  const response = {
    looks: wardrobe.looks.map((look) => ({
      subjectId: look.subjectId,
      candidates: look.candidates.map(({ color, ...candidate }) => {
        void color;
        return {
          ...candidate,
          name: "Garden linen separates",
          garments: ["Breathable linen shirt and relaxed trousers"],
        };
      }),
    })),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
    ),
  );
  const result = await new OpenAIWardrobeStylist("test-only-key").refine({
    shoot,
    subjects,
    wardrobe,
  });
  expect(result.provider).toBe("openai-wardrobe:gpt-4.1");
  expect(result.looks[0].candidates[0].color).toBe(
    wardrobe.looks[0].candidates[0].color,
  );
  expect(result.looks[0].candidates[0].name).toBe("Garden linen separates");
  response.looks[0].candidates[0].garments = ["Red blazer"];
  subjects[0].avoidedColors = "red";
  await expect(
    new OpenAIWardrobeStylist("test-only-key").refine({
      shoot,
      subjects,
      wardrobe,
    }),
  ).rejects.toThrow("WARDROBE_PREFERENCE_CONFLICT");
  response.looks[0].subjectId = randomUUID();
  await expect(
    new OpenAIWardrobeStylist("test-only-key").refine({
      shoot,
      subjects,
      wardrobe,
    }),
  ).rejects.toThrow("PROVIDER_RESPONSE");
});

it("runs durable live-image jobs inline and retries an upstream failure without changing the job ID", async () => {
  const { enqueue, retryTask } = await import("../apps/web/lib/job-queue");
  vi.stubEnv("QUEUE_DRIVER", "inline");
  vi.stubEnv("AI_IMAGE_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  const id = await fixture();
  await changeStyling(owner, id, {
    action: "LIGHTING",
    baseRevision: 0,
    recipe: "CONTEXT",
  });
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      if (fail) return new Response("not forwarded", { status: 401 });
      return String(url).includes("images/generations")
        ? Response.json({ data: [{ b64_json: png.toString("base64") }] })
        : Response.json({
            choices: [{ message: { content: JSON.stringify(review(1)) } }],
          });
    }),
  );
  const created = await enqueue(
    owner,
    "VISUAL",
    randomUUID(),
    { target: { kind: "LIGHTING", stylingRevision: 1 }, force: false },
    id,
  );
  expect(created.status).toBe("FAILED");
  expect(created.errorCode).toBe("PROVIDER_AUTH");
  expect(await listVisuals(owner, id)).toHaveLength(0);
  fail = false;
  const retried = await retryTask(owner, created.id);
  expect(retried.status).toBe("SUCCEEDED");
  expect(retried.id).toBe(created.id);
  expect(await listVisuals(owner, id)).toHaveLength(1);
});

it("exports generated JPEG copies with provenance while excluding original inputs", async () => {
  const { createArtifact, downloadArtifact } =
    await import("../apps/web/lib/artifact-service");
  const { unzipSync } = await import("fflate");
  const id = await fixture();
  await generatePlan(owner, id, randomUUID(), {
    poseCount: 2,
    useKnowledgeBase: false,
  });
  const plan = (await listPlans(owner, id))[0];
  const target: VisualTarget = {
    kind: "POSE",
    planId: plan.id,
    poseId: plan.poses[0].id,
  };
  await createRecommendationVisual(owner, job(id, target), {
    name: "fixture-private-image",
    generate: async () => ({ bytes: png, review: review(1) }),
  });
  const exportJob: TaskJob = {
    ...job(id, target),
    kind: "EXPORT",
    input: { planId: plan.id, format: "ZIP" },
  };
  await createArtifact(owner, exportJob);
  const exported = await downloadArtifact(owner, id, exportJob.id);
  const files = unzipSync(exported.bytes);
  expect(
    Object.keys(files).some(
      (name) => name.startsWith("illustrations/pose-") && name.endsWith(".jpg"),
    ),
  ).toBe(true);
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  expect(manifest.generatedImages[0].provider).toBe("fixture-private-image");
  expect(
    Object.keys(files).some((name) => /inputs|original|consent/.test(name)),
  ).toBe(false);
});
