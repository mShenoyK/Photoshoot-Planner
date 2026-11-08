import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  referenceAnalysisSchema,
  type ReferenceReview,
} from "@framecraft/shared/references";
import {
  requiresGuardian,
  type InputState,
  type MediaAsset,
  type ReferenceScope,
} from "@framecraft/shared/inputs";
import { referenceVision, type ReferenceVisionProvider } from "@framecraft/ai";
import { withShoot, InputError } from "./input-repository";
import { objectStore } from "./object-store";
import { CONSENT_POLICY } from "./inputs-service";
export function publicReferenceReview(r: ReferenceReview) {
  const { consentIds, ...publicReview } = r;
  void consentIds;
  return publicReview;
}
export function analysisPermission(s: InputState, a: MediaAsset) {
  if (!s.intents.some((i) => i.assetId === a.id && i.status === "COMPLETE"))
    throw new InputError(
      "UPLOAD_INCOMPLETE",
      "Complete the reference upload first.",
      409,
    );
  for (const id of a.subjectIds) {
    const p = s.subjects.find((p) => p.id === id);
    const c = p?.consent;
    if (
      !p ||
      !c ||
      c.id !== a.consentIds[id] ||
      c.status !== "GRANTED" ||
      c.policyVersion !== CONSENT_POLICY ||
      !c.allowAnalysis ||
      (requiresGuardian(p) && (!c.guardianName || !c.guardianRelationship))
    )
      throw new InputError(
        "ANALYSIS_CONSENT_REQUIRED",
        "Enable current photo-analysis consent for every person in the image, including guardian consent for minors.",
        403,
      );
  }
}
export function scopedInputs(s: InputState, scope: ReferenceScope): InputState {
  return {
    ...s,
    media: s.media.filter((a) => (a.workflowScope ?? "PLAN") === scope),
  };
}
export function approvedReferences(
  s: InputState,
  scope?: ReferenceScope,
): ReferenceReview[] {
  return (s.referenceReviews ?? []).filter((r) => {
    if (!r.approved) return false;
    const a = s.media.find((a) => a.id === r.assetId);
    if (!a || (scope && (a.workflowScope ?? "PLAN") !== scope)) return false;
    try {
      analysisPermission(s, a);
      return a.subjectIds.every((id) => r.consentIds[id] === a.consentIds[id]);
    } catch {
      return false;
    }
  });
}
function visionConfiguration() {
  const mode =
    process.env.AI_VISION_PROVIDER ??
    (process.env.DATA_MODE === "mock" && process.env.NODE_ENV !== "production"
      ? "mock"
      : "openai");
  const blocked = process.env.NODE_ENV === "production" && mode === "mock";
  return {
    provider: blocked ? "disabled" : mode,
    configured:
      !blocked &&
      (mode === "mock" ||
        (mode === "openai" &&
          !!(
            (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) &&
            (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) !==
              "replace_me"
          ))),
  };
}
export const readReferences = (owner: string, id: string) =>
  withShoot(owner, id, (s) => ({
    ...visionConfiguration(),
    reviews: (s.referenceReviews ?? [])
      .filter((r) => {
        const a = s.media.find((a) => a.id === r.assetId);
        if (!a) return false;
        try {
          analysisPermission(s, a);
          return a.subjectIds.every(
            (id) => r.consentIds[id] === a.consentIds[id],
          );
        } catch {
          return false;
        }
      })
      .map(publicReferenceReview),
  }));
export async function analyzeReference(
  owner: string,
  id: string,
  assetId: string,
  provider?: ReferenceVisionProvider,
) {
  return withShoot(owner, id, async (s, shoot) => {
    const asset = s.media.find((a) => a.id === assetId);
    if (!asset)
      throw new InputError(
        "NOT_FOUND",
        "Reference not found in this shoot.",
        404,
      );
    analysisPermission(s, asset); // Must precede image access, decoding and provider invocation.
    const adapter = provider ?? referenceVision();
    const image = await objectStore().get(asset.derivativeKey);
    if (createHash("sha256").update(image).digest("hex") !== asset.sha256)
      throw new InputError(
        "STORAGE_INTEGRITY",
        "Reference integrity check failed.",
        409,
      );
    const person =
      asset.kind === "SUBJECT_PHOTO" && asset.subjectIds.length === 1
        ? s.subjects.find((p) => p.id === asset.subjectIds[0])
        : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let analysis;
    try {
      analysis = referenceAnalysisSchema.parse(
        await Promise.race([
          adapter.analyze({
            image,
            kind: asset.kind,
            referenceView: asset.referenceView,
            workflowScope: asset.workflowScope,
            subjectCount: asset.subjectIds.length,
            preferences: person
              ? {
                  clothingSize: person.clothingSize,
                  fitComfort: person.fitComfort,
                  preferredColors: person.preferredColors,
                  avoidedColors: person.avoidedColors,
                  stylePreferences: person.stylePreferences,
                  mobilityNotes: person.mobilityNotes,
                }
              : undefined,
            shootContext: {
              environment: shoot.shootType,
              scene:
                shoot.settings.sceneDetails || shoot.settings.sceneCategory,
              lightMode: shoot.settings.lightMode,
              occasion: shoot.settings.occasion,
              plannedSubjectCount: shoot.subjectCount ?? s.subjects.length,
              plannedAgeGroups: s.subjects.map((p) => p.ageGroup),
            },
            ageGroups: asset.subjectIds.map(
              (id) => s.subjects.find((p) => p.id === id)!.ageGroup,
            ),
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("VISION_PROVIDER_TIMEOUT")),
              26000,
            );
          }),
        ]),
      );
    } catch (e) {
      const code =
        e instanceof Error &&
        [
          "VISION_NOT_CONFIGURED",
          "VISION_RATE_LIMIT",
          "VISION_PROVIDER_FAILED",
          "VISION_OUTPUT_INVALID",
        ].includes(e.message)
          ? e.message
          : "VISION_FAILED";
      throw new InputError(
        code,
        "Photo review failed. Check vision provider configuration or retry. Manual observations are still available.",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
    if (asset.kind !== "SUBJECT_PHOTO" || asset.subjectIds.length !== 1) {
      analysis.skinColorObservation =
        "Not attributed from a group, pose or scene reference.";
      analysis.visibleProportions =
        "Individual body proportions are not attributed from a group/scene image. Add an individual reference or enter fit preferences manually.";
    }
    const review: ReferenceReview = {
      id: randomUUID(),
      assetId,
      subjectIds: asset.subjectIds,
      consentIds: { ...asset.consentIds },
      analysis,
      provider: adapter.name,
      approved: false,
      createdAt: new Date().toISOString(),
    };
    s.referenceReviews ??= [];
    s.referenceReviews = s.referenceReviews.filter(
      (r) => r.assetId !== assetId,
    );
    s.referenceReviews.push(review);
    return review;
  });
}
export async function approveReference(
  owner: string,
  id: string,
  reviewId: string,
  body: unknown,
) {
  const input = z
    .object({ analysis: referenceAnalysisSchema, approved: z.boolean() })
    .strict()
    .parse(body);
  return withShoot(owner, id, (s) => {
    const review = s.referenceReviews?.find((r) => r.id === reviewId);
    const asset = s.media.find((a) => a.id === review?.assetId);
    if (!review || !asset)
      throw new InputError("NOT_FOUND", "Reference review not found.", 404);
    analysisPermission(s, asset);
    review.analysis = input.analysis;
    review.approved = input.approved;
    return review;
  });
}
