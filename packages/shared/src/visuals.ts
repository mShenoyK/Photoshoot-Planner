import { z } from "zod";
export const visualTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("POSE"),
      planId: z.string().uuid(),
      poseId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("LIGHTING"),
      stylingRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("WARDROBE"),
      stylingRevision: z.number().int().positive(),
      subjectId: z.string().uuid(),
      candidateId: z.string().min(1).max(100),
    })
    .strict(),
]);
export type VisualTarget = z.infer<typeof visualTargetSchema>;
export const visualRequestSchema = z
  .object({
    target: visualTargetSchema,
    force: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(180),
  })
  .strict();
export const visualKey = (target: VisualTarget) =>
  target.kind === "POSE"
    ? `pose:${target.planId}:${target.poseId}`
    : target.kind === "LIGHTING"
      ? `lighting:${target.stylingRevision}`
      : `wardrobe:${target.stylingRevision}:${target.subjectId}:${target.candidateId}`;
export const imageReviewSchema = z
  .object({
    subjectCount: z.number().int().min(0).max(20),
    ageBandsMatch: z.boolean(),
    safeSupportedPose: z.boolean(),
    matchesRequestedScene: z.boolean(),
    matchesRequestedOutfit: z.boolean(),
    notes: z.string().max(1500),
  })
  .strict();
export type ImageReview = z.infer<typeof imageReviewSchema>;
export const imageProviderResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            b64_json: z
              .string()
              .min(1)
              .max(28 * 1024 * 1024),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();
export const visualSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    shootId: z.string().uuid(),
    target: visualTargetSchema,
    inputHash: z.string(),
    generationHash: z.string().regex(/^[a-f0-9]{64}$/),
    referenceIds: z.array(z.string().uuid()).max(100),
    sourceAssetIds: z.array(z.string().uuid()).max(100).default([]),
    storageKey: z.string(),
    mime: z.literal("image/png"),
    bytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.string().max(100),
    createdAt: z.string().datetime(),
    review: imageReviewSchema,
  })
  .strict();
export type RecommendationVisual = z.infer<typeof visualSchema>;
export type PublicVisual = Omit<
  RecommendationVisual,
  "storageKey" | "inputHash" | "referenceIds" | "sourceAssetIds"
>;
