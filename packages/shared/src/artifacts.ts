import { z } from "zod";
export const artifactFormat = z.enum([
  "MARKDOWN",
  "PDF",
  "CSV",
  "SVG",
  "ZIP",
  "ILLUSTRATION",
]);
export const artifactSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    shootId: z.string().uuid(),
    planId: z.string().uuid(),
    planVersion: z.number().int().positive(),
    stylingRevision: z.number().int().positive().optional(),
    poseId: z.string().max(100).optional(),
    format: artifactFormat,
    fileName: z.string().max(120),
    mime: z.string().max(100),
    bytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    storageKey: z.string(),
    createdAt: z.string().datetime(),
    provider: z.string().max(100),
  })
  .strict();
export type Artifact = z.infer<typeof artifactSchema>;
export const artifactRequestSchema = z
  .object({
    planId: z.string().uuid(),
    stylingRevision: z.number().int().positive().optional(),
    format: artifactFormat,
    poseId: z.string().max(100).optional(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.format === "ILLUSTRATION" && !v.poseId)
      c.addIssue({ code: "custom", message: "Select a pose." });
    if (v.format !== "ILLUSTRATION" && v.poseId)
      c.addIssue({
        code: "custom",
        message: "poseId is only accepted for illustrations.",
      });
  });
export const illustrationSceneSchema = z
  .object({
    figures: z
      .array(
        z
          .object({
            subjectId: z.string().uuid(),
            x: z.number().min(30).max(970),
            y: z.number().min(80).max(400),
            support: z.enum(["SEATED", "CAREGIVER_SUPPORTED"]),
            guardianId: z.string().uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type IllustrationScene = z.infer<typeof illustrationSceneSchema>;
