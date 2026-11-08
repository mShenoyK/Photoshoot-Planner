import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject, canonPreset } from "../packages/shared/src/inputs";
import { store } from "../apps/web/lib/store";
import { withShoot } from "../apps/web/lib/input-repository";
import {
  completePlanInputs,
  completePlanSnapshot,
  generateCompletePlan,
} from "../apps/web/lib/complete-plan-service";
import { changeStyling } from "../apps/web/lib/styling-service";
import { enqueue } from "../apps/web/lib/job-queue";
let dir: string, owner: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-complete-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  process.env.QUEUE_DRIVER = "inline";
  process.env.AI_TEXT_PROVIDER = "mock";
  owner = (
    await store.createUser(`complete-${randomUUID()}@example.com`, "unused")
  ).id;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function fixture(count: number, outdoor = false) {
  const shoot = (await store.save(owner, {
    ...defaults,
    name: "Complete direction",
    subjectCount: count,
    shootType: outdoor ? "OUTDOOR" : "INDOOR",
    settings: {
      ...defaults.settings,
      occasion: "Birthday",
      lightMode: outdoor ? "NATURAL" : "ARTIFICIAL",
      sceneDetails: outdoor ? "Shaded garden" : "Living room",
    },
  }))!;
  await withShoot(owner, shoot.id, (state) => {
    state.subjects = Array.from({ length: count }, (_, i) => ({
      ...blankSubject,
      id: randomUUID(),
      label: `Person ${i + 1}`,
      ageGroup: i < 2 ? "ADULT" : "CHILD",
      consentHistory: [],
    }));
    state.cameraKit = { ...canonPreset, sourceKitId: randomUUID() };
  });
  return shoot.id;
}
for (const [count, outdoor] of [
  [1, false],
  [2, true],
  [4, false],
] as const)
  it(`creates one consistent no-photo bundle for ${count} people ${outdoor ? "outdoors" : "indoors"}`, async () => {
    const id = await fixture(count, outdoor);
    const jobId = randomUUID();
    const input = {
      ...(await completePlanInputs(owner, id)),
      poseCount: 3,
      useKnowledgeBase: false,
      complete: true,
    };
    const job = await enqueue(owner, "PLAN", jobId, input, id);
    expect(job.status).toBe("SUCCEEDED");
    const snapshot = await completePlanSnapshot(owner, id);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.record?.referenceIds).toEqual([]);
    expect(snapshot.styling?.wardrobe?.looks).toHaveLength(count);
    expect(snapshot.styling?.lighting?.scene.subjects).toHaveLength(count);
    expect(
      snapshot.styling?.wardrobe?.looks.every((l) => l.candidates.length === 3),
    ).toBe(true);
    expect(
      snapshot.styling?.wardrobe?.looks[0].candidates[0].suitability,
    ).toContain("Birthday");
    expect(snapshot.styling?.lighting?.scene.lights[0].kind).toBe(
      outdoor ? "SHADE" : "FLASH",
    );
    const result = await generateCompletePlan(owner, id, job.id, input);
    expect(result.planId).toBe(snapshot.record?.planId);
    await withShoot(owner, id, (state) => {
      expect(state.plans).toHaveLength(1);
      expect(state.styling).toHaveLength(1);
      expect(state.completePlans).toHaveLength(1);
      expect(
        state.plans![0].poses.every((p) => p.subjectIds.length === count),
      ).toBe(true);
    });
  });
it("rejects changed inputs or styling rather than mixing versions", async () => {
  const id = await fixture(1);
  const input = {
    ...(await completePlanInputs(owner, id)),
    poseCount: 3,
    useKnowledgeBase: false,
  };
  await changeStyling(owner, id, {
    action: "LIGHTING",
    baseRevision: 0,
    recipe: "CONTEXT",
  });
  await expect(
    generateCompletePlan(owner, id, randomUUID(), input),
  ).rejects.toMatchObject({ code: "STALE_INPUTS" });
  await withShoot(owner, id, (s) => {
    expect(s.completePlans).toBeUndefined();
    expect(s.plans).toBeUndefined();
  });
});
it("reports staleness after manual edits and isolates every owner's bundle", async () => {
  const id = await fixture(1);
  const input = {
    ...(await completePlanInputs(owner, id)),
    poseCount: 3,
    useKnowledgeBase: false,
  };
  await generateCompletePlan(owner, id, randomUUID(), input);
  await withShoot(owner, id, (s) => {
    s.subjects[0].preferredColors = "blue";
  });
  expect((await completePlanSnapshot(owner, id)).stale).toBe(true);
  await expect(completePlanSnapshot(randomUUID(), id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    generateCompletePlan(randomUUID(), id, randomUUID(), input),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("rejects absent profiles before creating any partial plan", async () => {
  const shoot = (await store.save(owner, {
    ...defaults,
    name: "No people yet",
  }))!;
  await expect(completePlanInputs(owner, shoot.id)).rejects.toMatchObject({
    code: "SUBJECTS_REQUIRED",
  });
  await withShoot(owner, shoot.id, (s) => expect(s.plans).toBeUndefined());
});
