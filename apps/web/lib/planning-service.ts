import { ensureBuiltinKnowledge } from "./builtin-knowledge";
import { approvedReferences } from "./reference-service";
import { randomUUID } from "node:crypto";
import {
  planSchema,
  editPlanSchema,
  sectionSchema,
  type ShootPlan,
} from "@framecraft/shared/planning";
import type {
  SourceReference,
  KnowledgeHit,
} from "@framecraft/shared/knowledge";
import { fingerprint, sameReference } from "@framecraft/knowledge";
import {
  textPlanner,
  type PlannerInput,
  type TextPlanner,
} from "@framecraft/ai";
import { withShoot, InputError } from "./input-repository";
import {
  validateSources,
  takeKnowledgeLease,
  releaseKnowledgeLease,
} from "./knowledge-service";
import type { InputState, Subject } from "@framecraft/shared/inputs";
import type { Shoot } from "@framecraft/shared";
export function planInputHash(shoot: Shoot, state: InputState) {
  const subjects = state.subjects.map(({ consent, consentHistory, ...s }) => {
    void consent;
    void consentHistory;
    return s;
  });
  return fingerprint(
    Buffer.from(
      JSON.stringify({
        shoot,
        subjects,
        equipment: state.cameraKit ?? null,
        references: approvedReferences(state),
      }),
    ),
  );
}
export function allReferences(plan: ShootPlan): SourceReference[] {
  return [
    ...plan.poses.flatMap((p) => [
      ...p.sourceReferences,
      ...p.sourceNotes.map((n) => n.reference),
    ]),
    ...plan.lighting.flatMap((l) => l.sourceReferences),
  ];
}
export function validateGenerated(
  plan: ShootPlan,
  input: PlannerInput,
  context: KnowledgeHit[],
) {
  const expected = input.subjects
    .map((s) => s.id)
    .sort()
    .join(",");
  for (const p of plan.poses) {
    if (
      p.subjectIds.slice().sort().join(",") !== expected ||
      new Set(p.subjectIds).size !== p.subjectIds.length
    )
      throw new InputError(
        "SUBJECT_COUNT_INVALID",
        "Provider output does not match the selected people.",
      );
    for (const note of p.sourceNotes) {
      if (
        !context.some(
          (h) =>
            sameReference(h.sourceReference, note.reference) &&
            h.summary === note.summary,
        )
      )
        throw new InputError(
          "CITATION_INVALID",
          "Provider invented or changed source guidance.",
        );
    }
    if (
      p.sourceReferences.length !== p.sourceNotes.length ||
      p.sourceReferences.some(
        (ref) =>
          !p.sourceNotes.some((note) => sameReference(note.reference, ref)),
      )
    )
      throw new InputError(
        "CITATION_INVALID",
        "Citations must match reviewed guidance notes.",
      );
    if (p.guidanceKind === "REVIEWED_SOURCE_GUIDANCE" && !p.sourceNotes.length)
      throw new InputError(
        "CITATION_INVALID",
        "Source guidance needs a reviewed source.",
      );
  }
  if (
    allReferences(plan).some(
      (ref) => !context.some((h) => sameReference(h.sourceReference, ref)),
    )
  )
    throw new InputError(
      "CITATION_INVALID",
      "Only actual retrieved chunks may be cited.",
    );
  if (
    new Set(plan.poses.map((p) => p.id)).size !== plan.poses.length ||
    new Set(plan.shotList.map((s) => s.id)).size !== plan.shotList.length ||
    plan.shotList.some(
      (s) => s.poseId && !plan.poses.some((p) => p.id === s.poseId),
    )
  )
    throw new InputError(
      "PLAN_LINKS_INVALID",
      "Pose and shot identifiers are inconsistent.",
    );
  if (
    plan.shotList.reduce((total, s) => total + s.estimatedMinutes, 0) >
    (input.shoot.durationMinutes ?? 480)
  )
    throw new InputError(
      "DURATION_EXCEEDED",
      "Shot sequence exceeds the planned duration.",
    );
  const minor = input.subjects.some(
    (s) =>
      !["ADULT", "SENIOR"].includes(s.ageGroup) ||
      (s.ageYears !== undefined && s.ageYears < 18),
  );
  // Narrowly reject dangerous positive directions; never use raw source instructions as direction text.
  const directions = plan.poses
    .flatMap((p) => p.stepByStepDirections)
    .join(" ");
  if (
    minor &&
    /\b(suspend|hang the baby|unsupported infant|balance (the )?(baby|toddler)|stand on a chair)\b/i.test(
      directions,
    )
  )
    throw new InputError(
      "UNSAFE_DIRECTION",
      "Provider returned an unsafe age-related direction.",
    );
}
async function plannerInput(
  owner: string,
  shootId: string,
  poseCount: number,
  knowledgeOnly = false,
  referenceScope: "PLAN" | "POSES" = "PLAN",
): Promise<Omit<PlannerInput, "context">> {
  return withShoot(owner, shootId, (state, shoot) => {
    const count = state.subjects.length;
    if (
      count &&
      shoot.subjectCount !== undefined &&
      count !== shoot.subjectCount
    )
      throw new InputError(
        "SUBJECT_COUNT_MISMATCH",
        "Match the brief count to the subject profiles before generating.",
        422,
      );
    const genericFallback = !count;
    return {
      shoot,
      subjects: state.subjects.map((s) => ({
        ...s,
        consent: undefined,
        consentHistory: [],
      })) as Subject[],
      equipment: state.cameraKit,
      referenceInsights: (knowledgeOnly
        ? []
        : approvedReferences(
            state,
            shoot.workflowKind === "POSES" ? "POSES" : referenceScope,
          )
      ).map((r) => ({
        ...r.analysis,
        referenceKind: state.media.find((a) => a.id === r.assetId)?.kind,
      })),
      poseCount,
      inputHash: planInputHash(shoot, state),
      genericFallback,
    };
  });
}
export async function generatePlan(
  owner: string,
  shootId: string,
  jobId: string,
  options: {
    poseCount: number;
    useKnowledgeBase: boolean;
    knowledgeOnly?: boolean;
    referenceScope?: "PLAN" | "POSES";
    baseVersion?: number;
    section?: string;
  },
  provider?: TextPlanner,
) {
  const previous = await withShoot(owner, shootId, (state) =>
    state.plans?.find((p) => p.jobId === jobId),
  );
  if (previous) return { planId: previous.id, version: previous.version };
  if (options.section) {
    const base = (await listPlans(owner, shootId)).at(-1);
    if (base?.referenceScope)
      options = { ...options, referenceScope: base.referenceScope };
    if (base?.knowledgeOnly)
      options = { ...options, knowledgeOnly: true, useKnowledgeBase: true };
  }
  if (options.knowledgeOnly) await ensureBuiltinKnowledge(owner);
  const activeProvider = provider ?? textPlanner();
  const input = await plannerInput(
    owner,
    shootId,
    options.poseCount,
    options.knowledgeOnly,
    options.referenceScope,
  );
  let context: KnowledgeHit[] = [];
  try {
    if (options.useKnowledgeBase)
      context = await takeKnowledgeLease(owner, jobId, {
        query: `${input.shoot.settings.sceneCategory} ${input.shoot.settings.occasion} ${input.subjects.length > 1 ? "family group portrait" : "individual portrait"} posing comfort`,
        filters: {
          environment: input.shoot.shootType,
          subjectCount: input.subjects.length || input.shoot.subjectCount,
          ageGroups: input.subjects.map((s) => s.ageGroup),
          topics: ["POSE", "COMPOSITION", "SAFETY"],
        },
        maxResults: 8,
      });
    const value = await Promise.race([
      activeProvider.generateStructuredPlan({ ...input, context }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new InputError(
                "PROVIDER_TIMEOUT",
                "Planner timed out. Retry generation.",
                503,
              ),
            ),
          60000,
        );
        timer.unref();
      }),
    ]);
    const generated = planSchema.parse(value);
    generated.knowledgeOnly = options.knowledgeOnly === true;
    generated.referenceScope =
      input.shoot.workflowKind === "POSES"
        ? "POSES"
        : (options.referenceScope ?? "PLAN");
    if (Buffer.byteLength(JSON.stringify(generated)) > 128 * 1024)
      throw new InputError("PLAN_SIZE", "Planner output is too large.");
    const old = options.section
      ? (await listPlans(owner, shootId)).at(-1)
      : undefined;
    if (old && !(await validateSources(owner, allReferences(old))))
      throw new InputError(
        "CITATION_INVALID",
        "Preserved sections have unavailable citations; regenerate the full plan.",
      );
    validateGenerated(generated, { ...input, context }, context);
    if (!(await validateSources(owner, allReferences(generated))))
      throw new InputError(
        "CITATION_INVALID",
        "Source provenance changed before save.",
      );
    return await withShoot(owner, shootId, (state, shoot) => {
      if (planInputHash(shoot, state) !== input.inputHash)
        throw new InputError(
          "INPUT_CHANGED",
          "The brief or profiles changed during generation. Retry.",
          409,
        );
      state.plans ??= [];
      const current = state.plans.at(-1);
      let next = generated;
      if (options.section) {
        const section = sectionSchema.parse(options.section);
        if (!current || current.version !== options.baseVersion)
          throw new InputError(
            "CONFLICT",
            "Plan changed during regeneration. Reload and retry.",
            409,
          );
        if (current.lockedSections.includes(section))
          throw new InputError(
            "SECTION_LOCKED",
            "Unlock this section before regenerating.",
            409,
          );
        next = {
          ...current,
          [section]: generated[section],
          status: "READY",
          editedSections: current.editedSections.filter((s) => s !== section),
        };
        const preserved: KnowledgeHit[] = current.poses.flatMap((p) =>
          p.sourceNotes.map((n) => ({
            id: n.reference.chunkId,
            summary: n.summary,
            sourceReference: n.reference,
            relevanceScore: 1,
            permissions: { derivedUse: true, originalDisplay: false },
            taxonomy: {
              environments: [],
              ageGroups: [],
              minSubjects: 1,
              maxSubjects: 20,
              topics: ["POSE"],
            },
          })),
        );
        const allContext = [...context, ...preserved];
        validateGenerated(next, { ...input, context: allContext }, allContext);
      }
      const saved = planSchema.parse({
        ...next,
        id: randomUUID(),
        jobId,
        shootId,
        version: (current?.version ?? 0) + 1,
        createdAt: new Date().toISOString(),
        inputHash: input.inputHash,
      });
      state.plans.push(saved);
      return { planId: saved.id, version: saved.version };
    });
  } finally {
    if (options.useKnowledgeBase) await releaseKnowledgeLease(owner, jobId);
  }
}
export async function listPlans(owner: string, shootId: string) {
  const plans = await withShoot(owner, shootId, (state) =>
    structuredClone(state.plans ?? []),
  );
  return Promise.all(
    plans.map(async (p) => ({
      ...p,
      citationStatus: (await validateSources(owner, allReferences(p)))
        ? ("VALID" as const)
        : ("SOURCE_UNAVAILABLE" as const),
    })),
  );
}
export async function editPlan(
  owner: string,
  shootId: string,
  planId: string,
  raw: unknown,
) {
  const input = editPlanSchema.parse(raw);
  return withShoot(owner, shootId, (state) => {
    state.plans ??= [];
    const base = state.plans.at(-1);
    if (!base || base.id !== planId || base.version !== input.baseVersion)
      throw new InputError(
        "CONFLICT",
        "Reload the latest plan before saving.",
        409,
      );
    const edited = new Set(base.editedSections);
    const poses = structuredClone(base.poses);
    if (input.poseEdits) {
      if (base.lockedSections.includes("poses"))
        throw new InputError(
          "SECTION_LOCKED",
          "Unlock poses before editing.",
          409,
        );
      for (const edit of input.poseEdits) {
        const pose = poses.find((p) => p.id === edit.id);
        if (!pose)
          throw new InputError("INVALID_POSE", "Choose an existing pose.");
        Object.assign(pose, edit, {
          guidanceKind: "USER_EDITED",
          sourceReferences: [],
          sourceNotes: [],
        });
      }
      edited.add("poses");
    }
    if (input.creativeBrief) {
      if (base.lockedSections.includes("creativeBrief"))
        throw new InputError("SECTION_LOCKED", "Unlock the brief first.", 409);
      edited.add("creativeBrief");
    }
    if (input.shotList) {
      if (base.lockedSections.includes("shotList"))
        throw new InputError(
          "SECTION_LOCKED",
          "Unlock the shot list first.",
          409,
        );
      if (
        input.shotList.some(
          (s) =>
            !base.shotList.some((b) => b.id === s.id) ||
            (s.poseId && !poses.some((p) => p.id === s.poseId)),
        )
      )
        throw new InputError(
          "INVALID_SHOT",
          "Use existing shot and pose identifiers.",
        );
      edited.add("shotList");
    }
    const next = planSchema.parse({
      ...base,
      id: randomUUID(),
      version: base.version + 1,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
      poses,
      creativeBrief: input.creativeBrief ?? base.creativeBrief,
      shotList: input.shotList ?? base.shotList,
      lockedSections: input.lockedSections ?? base.lockedSections,
      editedSections: [...edited],
    });
    state.plans.push(next);
    return next;
  });
}
export async function approvePlan(
  owner: string,
  shootId: string,
  planId: string,
  baseVersion: number,
) {
  const latest = (await listPlans(owner, shootId)).at(-1);
  if (!latest || latest.id !== planId || latest.version !== baseVersion)
    throw new InputError("CONFLICT", "Reload the latest version.", 409);
  if (latest.citationStatus !== "VALID")
    throw new InputError(
      "CITATION_INVALID",
      "A source is unavailable. Regenerate before approval.",
      409,
    );
  return withShoot(owner, shootId, (state) => {
    const current = state.plans?.at(-1);
    if (!current || current.id !== planId)
      throw new InputError("CONFLICT", "Plan changed.", 409);
    const next = planSchema.parse({
      ...current,
      id: randomUUID(),
      version: current.version + 1,
      status: "APPROVED",
      createdAt: new Date().toISOString(),
    });
    state.plans!.push(next);
    return next;
  });
}
