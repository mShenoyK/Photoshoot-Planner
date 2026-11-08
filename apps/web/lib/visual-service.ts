import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  visualRequestSchema,
  visualSchema,
  imageReviewSchema,
  type VisualTarget,
  type RecommendationVisual,
} from "@framecraft/shared/visuals";
import type { SourceReference, TaskJob } from "@framecraft/shared/knowledge";
import type { InputState } from "@framecraft/shared/inputs";
import type { Shoot } from "@framecraft/shared";
import {
  recommendationImages,
  type RecommendationImageProvider,
  type RecommendationImageInput,
} from "@framecraft/ai";
import { withShoot, InputError } from "./input-repository";
import { approvedReferences, analysisPermission } from "./reference-service";
import { stylingInputHash } from "./styling-service";
import { allReferences, planInputHash } from "./planning-service";
import { objectStore } from "./object-store";
import {
  takeKnowledgeLease,
  releaseKnowledgeLease,
  validateSources,
} from "./knowledge-service";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const publicVisual = ({
  storageKey,
  inputHash,
  referenceIds,
  sourceAssetIds,
  ...record
}: RecommendationVisual) => {
  void storageKey;
  void inputHash;
  void referenceIds;
  void sourceAssetIds;
  return record;
};
function snapshot(state: InputState, shoot: Shoot, target: VisualTarget) {
  let people = state.subjects;
  let refs = approvedReferences(state);
  let sources: SourceReference[] = [];
  let guidance: Record<string, unknown>;
  if (target.kind === "POSE") {
    const plan = state.plans?.find((p) => p.id === target.planId);
    const pose = plan?.poses.find((p) => p.id === target.poseId);
    if (!plan || !pose)
      throw new InputError("NOT_FOUND", "Pose version not found.", 404);
    if (plan.genericFallback || plan.inputHash !== planInputHash(shoot, state))
      throw new InputError(
        "STALE_INPUTS",
        "Confirm people profiles and regenerate this guide before creating images.",
        409,
      );
    people = pose.subjectIds.map((id) =>
      state.subjects.find((p) => p.id === id)!,
    );
    if (!people.length || people.some((p) => !p))
      throw new InputError(
        "PROFILES_REQUIRED",
        "Add exact people profiles before creating a pose image.",
        409,
      );
    refs = plan.knowledgeOnly
      ? []
      : approvedReferences(
          state,
          plan.referenceScope ??
            (shoot.workflowKind === "POSES" ? "POSES" : "PLAN"),
        );
    sources = allReferences(plan);
    guidance = {
      title: pose.title,
      arrangement: pose.subjectArrangement,
      directions: pose.stepByStepDirections,
      framing: pose.framing,
      cameraHeight: pose.cameraHeight,
      safety: pose.ageSafetyNotes,
    };
  } else {
    const styling = state.styling?.find(
      (s) => s.revision === target.stylingRevision,
    );
    if (!styling)
      throw new InputError("NOT_FOUND", "Styling version not found.", 404);
    if (target.kind === "LIGHTING") {
      if (!styling.lighting)
        throw new InputError("NOT_READY", "Generate lighting first.", 409);
      if (
        styling.lightingInputHash !== stylingInputHash(state, shoot, "LIGHTING")
      )
        throw new InputError(
          "STALE_INPUTS",
          "Regenerate lighting after changing inputs.",
          409,
        );
      refs = approvedReferences(state, "LIGHTING");
      guidance = {
        title: styling.lighting.title,
        scene: styling.lighting.scene,
        settings: styling.lighting.settings,
        notes: styling.lighting.notes,
      };
    } else {
      const wardrobe = styling.wardrobe;
      const look = wardrobe?.looks.find(
        (l) => l.subjectId === target.subjectId,
      );
      const candidate = look?.candidates.find(
        (c) => c.id === target.candidateId,
      );
      const subject = people.find((p) => p.id === target.subjectId);
      if (!wardrobe || !candidate || !subject)
        throw new InputError("NOT_FOUND", "Outfit version not found.", 404);
      if (
        styling.wardrobeInputHash !==
        stylingInputHash(state, shoot, "WARDROBE", wardrobe.knowledgeOnly)
      )
        throw new InputError(
          "STALE_INPUTS",
          "Regenerate wardrobe after changing inputs.",
          409,
        );
      people = [subject];
      refs = wardrobe.knowledgeOnly
        ? []
        : approvedReferences(state, "WARDROBE");
      sources = (wardrobe.sourceNotes ?? []).map((n) => n.reference);
      guidance = {
        outfit: candidate,
        palette: wardrobe.palette,
        fitComfort: subject.fitComfort,
        mobility: subject.mobilityNotes,
        preferences: subject.stylePreferences,
        declaredAgeGroup: subject.ageGroup,
      };
    }
  }
  for (const r of refs) {
    const asset = state.media.find((a) => a.id === r.assetId)!;
    analysisPermission(state, asset);
    if (
      asset.subjectIds.some(
        (id) =>
          !state.subjects.find((p) => p.id === id)?.consent?.allowGeneration,
      )
    )
      throw new InputError(
        "GENERATION_CONSENT_REQUIRED",
        "Enable image-generation permission for every person whose reference observations guide this image. Changing consent removes old references; reattach and review them afterward.",
        403,
      );
  }
  if (people.some((p) => p.ageGroup === "UNSPECIFIED"))
    throw new InputError(
      "AGE_PROFILE_REQUIRED",
      "Choose each person's age band before generating images; age is never inferred from photographs.",
      422,
    );
  const young = (p: (typeof people)[number]) =>
    ["BABY", "TODDLER"].includes(p.ageGroup) ||
    (p.ageYears !== undefined && p.ageYears < 3);
  if (
    target.kind !== "WARDROBE" &&
    people.some(young) &&
    !people.some(
      (p) =>
        ["ADULT", "SENIOR"].includes(p.ageGroup) &&
        (p.ageYears === undefined || p.ageYears >= 18),
    )
  )
    throw new InputError(
      "CAREGIVER_REQUIRED",
      "Include a declared adult caregiver for a safe baby/toddler pose image.",
      422,
    );
  if (target.kind === "WARDROBE" && people.some(young)) {
    guidance.renderMode = "FLAT_LAY";
    people = [];
  }
  const input: RecommendationImageInput = {
    kind: target.kind,
    subjects: people.map(({ ageGroup, ageYears }) => ({ ageGroup, ageYears })),
    context: {
      environment: shoot.shootType,
      scene: shoot.settings.sceneCategory,
      surroundings: shoot.settings.sceneDetails,
      occasion: shoot.settings.occasion,
      lightMode: shoot.settings.lightMode,
      equipment: state.cameraKit
        ? {
            camera: state.cameraKit.body,
            lens: state.cameraKit.lens,
            flashes: state.cameraKit.flashCount,
            modifiers: state.cameraKit.modifiers,
          }
        : null,
    },
    guidance,
  };
  // Only saved textual guidance is sent; no photo bytes or source-book illustrations enter the image provider.
  return {
    generationHash: digest(
      Buffer.from(
        JSON.stringify({ input, sources, referenceIds: refs.map((r) => r.id) }),
      ),
    ),
    input,
    hash: stylingInputHash(state, shoot),
    referenceIds: refs.map((r) => r.id),
    sourceAssetIds: refs.map((r) => r.assetId),
    sources,
  };
}
export const assertVisualRequest = (
  owner: string,
  id: string,
  target: VisualTarget,
) =>
  withShoot(owner, id, (state, shoot) => {
    snapshot(state, shoot, target);
    return true;
  });
export const listVisuals = (owner: string, id: string) =>
  withShoot(owner, id, (state) => (state.visuals ?? []).map(publicVisual));
export async function createRecommendationVisual(
  owner: string,
  job: TaskJob,
  provider?: RecommendationImageProvider,
): Promise<Record<string, unknown>> {
  if (!job.shootId) throw new InputError("INVALID_JOB", "Missing workspace.");
  const id = job.shootId;
  const { target, force } = visualRequestSchema.parse({
    ...job.input,
    idempotencyKey: job.idempotencyKey,
  });
  const prior = await withShoot(owner, id, (state) =>
    state.visuals?.find((v) => v.jobId === job.id),
  );
  if (prior) return { visual: publicVisual(prior) };
  const current = await withShoot(owner, id, (state, shoot) =>
    snapshot(state, shoot, target),
  );
  const cached = await withShoot(owner, id, (state) =>
    state.visuals?.find(
      (v) =>
        v.generationHash === current.generationHash &&
        v.inputHash === current.hash,
    ),
  );
  if (!force && cached && (await validateSources(owner, current.sources)))
    return { visual: publicVisual(cached) };
  const storage = objectStore(); // Validate private-storage configuration before a paid provider request.
  const adapter = provider ?? recommendationImages();
  await takeKnowledgeLease(owner, job.id, {
    query: "image source provenance",
    filters: {},
    maxResults: 1,
  });
  try {
    if (!(await validateSources(owner, current.sources)))
      throw new InputError(
        "SOURCE_UNAVAILABLE",
        "Regenerate with current knowledge sources before creating an image.",
        409,
      );
    const generated = await adapter.generate(current.input);
    const review = imageReviewSchema.parse(generated.review);
    if (
      review.subjectCount !== current.input.subjects.length ||
      !review.ageBandsMatch ||
      !review.safeSupportedPose ||
      !review.matchesRequestedScene ||
      (target.kind === "WARDROBE" && !review.matchesRequestedOutfit)
    )
      throw new InputError(
        "IMAGE_REVIEW_FAILED",
        "Generated image failed count, age, outfit or safety review. No image was published; retry generation.",
        422,
      );
    if (
      generated.bytes.length > 20 * 1024 * 1024 ||
      !Buffer.from(generated.bytes)
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new InputError(
        "IMAGE_RESPONSE",
        "Provider did not return a bounded PNG image.",
        502,
      );
    const decoded = sharp(generated.bytes, { limitInputPixels: 16000000 });
    const meta = await decoded.metadata();
    if (
      !meta.width ||
      !meta.height ||
      meta.width < 256 ||
      meta.height < 256 ||
      (meta.pages ?? 1) !== 1
    )
      throw new InputError(
        "IMAGE_RESPONSE",
        "Provider image dimensions are invalid.",
        502,
      );
    const bytes = await decoded.png().toBuffer();
    const record = visualSchema.parse({
      id: job.id,
      jobId: job.id,
      shootId: id,
      target,
      inputHash: current.hash,
      generationHash: current.generationHash,
      referenceIds: current.referenceIds,
      sourceAssetIds: current.sourceAssetIds,
      storageKey: `shoots/${id}/outputs/${job.id}/recommendation.png`,
      mime: "image/png",
      bytes: bytes.length,
      sha256: digest(bytes),
      provider: adapter.name,
      createdAt: job.createdAt,
      review,
    });
    return await withShoot(owner, id, async (state, shoot) => {
      const latest = snapshot(state, shoot, target);
      if (latest.hash !== current.hash)
        throw new InputError(
          "STALE_INPUTS",
          "Inputs changed while creating the image. Generate again from current inputs.",
          409,
        );
      const existing = state.visuals?.find((v) => v.jobId === job.id);
      if (existing) return { visual: publicVisual(existing) };
      try {
        await storage.put(record.storageKey, bytes, record.mime);
      } catch (e) {
        const existingBytes = await storage
          .get(record.storageKey)
          .catch(() => null);
        if (!existingBytes || digest(existingBytes) !== record.sha256) throw e;
      }
      (state.visuals ??= []).push(record);
      return { visual: publicVisual(record) };
    });
  } finally {
    await releaseKnowledgeLease(owner, job.id);
  }
}
export async function downloadVisual(
  owner: string,
  id: string,
  visualId: string,
) {
  const current = await withShoot(owner, id, (state, shoot) => {
    const record = state.visuals?.find((v) => v.id === visualId);
    if (!record) throw new InputError("NOT_FOUND", "Image not found.", 404);
    const input = snapshot(state, shoot, record.target);
    if (input.hash !== record.inputHash)
      throw new InputError(
        "STALE_INPUTS",
        "This image belongs to changed inputs. Regenerate before viewing or sharing.",
        409,
      );
    return { record, sources: input.sources };
  });
  const lease = randomUUID();
  await takeKnowledgeLease(owner, lease, {
    query: "image download provenance",
    filters: {},
    maxResults: 1,
  });
  try {
    if (!(await validateSources(owner, current.sources)))
      throw new InputError(
        "SOURCE_UNAVAILABLE",
        "Image source provenance is unavailable.",
        409,
      );
    return await withShoot(owner, id, async (state, shoot) => {
      const record = state.visuals?.find((v) => v.id === visualId);
      if (!record) throw new InputError("NOT_FOUND", "Image not found.", 404);
      const verified = snapshot(state, shoot, record.target);
      if (verified.hash !== record.inputHash)
        throw new InputError(
          "STALE_INPUTS",
          "Image inputs or permissions changed. Regenerate before sharing.",
          409,
        );
      const bytes = await objectStore().get(record.storageKey);
      if (digest(bytes) !== record.sha256)
        throw new InputError(
          "INTEGRITY_FAILED",
          "Image integrity check failed.",
          409,
        );
      return { record: publicVisual(record), bytes };
    });
  } finally {
    await releaseKnowledgeLease(owner, lease);
  }
}

export const matchingVisual = (
  owner: string,
  id: string,
  target: VisualTarget,
) =>
  withShoot(owner, id, (state, shoot) => {
    const current = snapshot(state, shoot, target);
    const match = state.visuals
      ?.filter(
        (v) =>
          v.generationHash === current.generationHash &&
          v.inputHash === current.hash,
      )
      .at(-1);
    return match ? publicVisual(match) : null;
  });
