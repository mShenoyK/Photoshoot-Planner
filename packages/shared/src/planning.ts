import { z } from "zod";
const text = z.string().trim().min(1).max(2000);
const strings = z.array(text).max(30);
export const sourceSchema = z
  .object({
    documentId: z.string().uuid(),
    documentTitle: z.string().min(1).max(160),
    chunkId: z.string().regex(/^[a-f0-9]{64}$/),
    chunkRevision: z.number().int().positive(),
    pageStart: z.number().int().positive().optional(),
    pageEnd: z.number().int().positive().optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  })
  .strict();
export const creativeBriefSchema = z
  .object({
    concept: text,
    mood: strings,
    narrative: text,
    compositionGoals: strings,
    venueConsiderations: strings,
  })
  .strict();
export const poseSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: text,
    subjectIds: z.array(z.string().uuid()).max(20),
    subjectArrangement: text,
    stepByStepDirections: strings.min(1),
    ageSafetyNotes: strings.min(1),
    expressionsAndInteractions: strings,
    framing: text,
    cameraHeight: text,
    lensGuidance: text,
    estimatedMinutes: z.number().int().min(1).max(60),
    whyItWorks: text,
    guidanceKind: z.enum([
      "GENERATED_GUIDANCE",
      "REVIEWED_SOURCE_GUIDANCE",
      "USER_EDITED",
    ]),
    sourceReferences: z.array(sourceSchema).max(8),
    sourceNotes: z
      .array(z.object({ reference: sourceSchema, summary: text }).strict())
      .max(8),
  })
  .strict();
export const shotSchema = z
  .object({
    id: z.string().min(1).max(100),
    priority: z.enum(["MUST", "SHOULD", "OPTIONAL"]),
    poseId: z.string().optional(),
    description: text,
    estimatedMinutes: z.number().int().min(1).max(60),
    completed: z.boolean(),
  })
  .strict();
export const sectionSchema = z.enum(["creativeBrief", "poses", "shotList"]);
export const planSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid().optional(),
    shootId: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(["DRAFT", "READY", "APPROVED"]),
    creativeBrief: creativeBriefSchema,
    poses: z.array(poseSchema).min(1).max(12),
    lighting: z
      .array(
        z
          .object({
            id: text,
            title: text,
            scenario: text,
            keyPosition: text,
            fillPosition: text.optional(),
            modifierNotes: strings,
            backgroundControl: strings,
            cameraStartingPoints: z.object({ rationale: text }).strict(),
            sourceReferences: z.array(sourceSchema),
          })
          .strict(),
      )
      .max(12),
    wardrobe: z
      .object({
        sharedPalette: strings,
        backgroundHarmonyExplanation: text,
        subjectLooks: z
          .array(
            z
              .object({
                subjectId: z.string(),
                candidates: z.array(z.unknown()).max(0),
              })
              .strict(),
          )
          .max(0),
      })
      .strict(),
    shotList: z.array(shotSchema).min(1).max(40),
    equipmentChecklist: strings,
    contingencyPlan: strings,
    limitations: strings,
    createdAt: z.string().datetime(),
    provider: z.string().max(100),
    inputHash: z.string(),
    genericFallback: z.boolean(),
    lockedSections: z.array(sectionSchema).max(3),
    editedSections: z.array(sectionSchema).max(3),
  })
  .strict();
export type ShootPlan = z.infer<typeof planSchema>;
export const generationSchema = z
  .object({
    poseCount: z.number().int().min(1).max(12).default(6),
    useKnowledgeBase: z.boolean().default(true),
    idempotencyKey: z.string().min(8).max(100),
  })
  .strict();
export const editPlanSchema = z
  .object({
    baseVersion: z.number().int().positive(),
    creativeBrief: creativeBriefSchema.optional(),
    poseEdits: z
      .array(
        z
          .object({
            id: text,
            title: text,
            stepByStepDirections: strings.min(1),
            whyItWorks: text,
          })
          .strict(),
      )
      .max(12)
      .optional(),
    shotList: z.array(shotSchema).max(40).optional(),
    lockedSections: z.array(sectionSchema).max(3).optional(),
  })
  .strict();
