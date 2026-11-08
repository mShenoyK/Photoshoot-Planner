import { stylingSchema } from "@framecraft/shared/styling";
import { withShoot, InputError } from "./input-repository";
import { stylingInputHash } from "./styling-service";
import { lightingRules, wardrobeRules } from "./styling-rules";
import { approvedReferences } from "./reference-service";
import { generatePlan } from "./planning-service";

export const completePlanInputs = (owner: string, id: string) =>
  withShoot(owner, id, (state, shoot) => {
    // Validate the entire request before enqueueing or generating partial work.
    lightingRules(shoot, state, "CONTEXT", false);
    wardrobeRules(shoot, state, state.styling?.at(-1)?.wardrobe);
    return {
      inputHash: stylingInputHash(state, shoot),
      stylingRevision: state.styling?.at(-1)?.revision ?? 0,
    };
  });

export async function generateCompletePlan(
  owner: string,
  id: string,
  jobId: string,
  input: Record<string, unknown>,
) {
  const previous = await withShoot(owner, id, (state) =>
    state.completePlans?.find((p) => p.jobId === jobId),
  );
  if (previous) return { ...previous };
  const check = (hash: string, revision: number) => {
    if (input.inputHash !== hash || input.stylingRevision !== revision)
      throw new InputError(
        "STALE_INPUTS",
        "Shoot or styling changed. Generate a new complete plan.",
        409,
      );
  };
  const before = await completePlanInputs(owner, id);
  check(before.inputHash, before.stylingRevision);
  const plan = await generatePlan(owner, id, jobId, {
    poseCount: Number(input.poseCount),
    useKnowledgeBase: input.useKnowledgeBase === true,
  });
  return withShoot(owner, id, (state, shoot) => {
    const existing = state.completePlans?.find((p) => p.jobId === jobId);
    if (existing) return { ...existing };
    const hash = stylingInputHash(state, shoot);
    const old = state.styling?.at(-1);
    check(hash, old?.revision ?? 0);
    const styling = stylingSchema.parse({
      revision: (old?.revision ?? 0) + 1,
      createdAt: new Date().toISOString(),
      inputHash: hash,
      lightingInputHash: stylingInputHash(state, shoot, "LIGHTING"),
      wardrobeInputHash: stylingInputHash(state, shoot, "WARDROBE"),
      lighting: lightingRules(shoot, state, "CONTEXT", false),
      wardrobe: wardrobeRules(
        shoot,
        state,
        old?.wardrobe,
        old?.wardrobe?.heroSubjectId,
      ),
    });
    const record = {
      jobId,
      planId: plan.planId,
      stylingRevision: styling.revision,
      inputHash: hash,
      createdAt: styling.createdAt,
      referenceIds: approvedReferences(state)
        .filter(
          (r) =>
            (state.media.find((a) => a.id === r.assetId)?.workflowScope ??
              "PLAN") !== "POSES",
        )
        .map((r) => r.id),
    };
    (state.styling ??= []).push(styling);
    (state.completePlans ??= []).push(record);
    return { ...record };
  });
}

export const completePlanSnapshot = (owner: string, id: string) =>
  withShoot(owner, id, (state, shoot) => {
    const record = state.completePlans?.at(-1) ?? null;
    return {
      record,
      styling: record
        ? (state.styling?.find((s) => s.revision === record.stylingRevision) ??
          null)
        : null,
      stale:
        !!record &&
        (record.inputHash !== stylingInputHash(state, shoot) ||
          record.planId !== state.plans?.at(-1)?.id ||
          record.stylingRevision !== state.styling?.at(-1)?.revision),
      context: {
        environment: shoot.shootType,
        scene: shoot.settings.sceneCategory,
        surroundings: shoot.settings.sceneDetails,
        occasion: shoot.settings.occasion,
        lightMode: shoot.settings.lightMode,
      },
      subjects: state.subjects.map(({ id, label }) => ({ id, label })),
      referenceCount: state.media.length,
      approvedReferenceCount: approvedReferences(state).length,
    };
  });
