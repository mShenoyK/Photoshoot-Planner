import { z } from "zod";
const text = z.string().trim().max(6000);
const note = z.string().trim().max(1000);
const point = z
  .object({
    x: z.number().min(0).max(12),
    y: z.number().min(0).max(12),
    heightM: z.number().min(0).max(4),
  })
  .strict();
export const sceneSchema = z
  .object({
    units: z.literal("meters"),
    bounds: z
      .object({
        width: z.number().min(3).max(12),
        height: z.number().min(3).max(12),
      })
      .strict(),
    camera: point.extend({ directionDeg: z.number().min(0).max(360) }),
    subjects: z
      .array(
        point.extend({ id: z.string().max(100), label: z.string().max(100) }),
      )
      .min(1)
      .max(20),
    lights: z
      .array(
        point.extend({
          id: z.string().max(100),
          kind: z.enum(["FLASH", "WINDOW", "SHADE"]),
          purpose: z.enum(["KEY", "FILL"]),
          modifier: text,
          directionDeg: z.number().min(0).max(360),
        }),
      )
      .min(1)
      .max(3),
    backdrop: z
      .object({
        kind: z.enum(["BLACK", "SCENE"]),
        y: z.number().min(0).max(12),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const p of [s.camera, ...s.subjects, ...s.lights])
      if (p.x > s.bounds.width || p.y > s.bounds.height)
        ctx.addIssue({
          code: "custom",
          message: "Positions must fit inside scene bounds.",
        });
    if (s.backdrop.y > s.bounds.height)
      ctx.addIssue({
        code: "custom",
        message: "Backdrop must fit inside bounds.",
      });
    if (
      new Set(s.subjects.map((p) => p.id)).size !== s.subjects.length ||
      new Set(s.lights.map((p) => p.id)).size !== s.lights.length
    )
      ctx.addIssue({ code: "custom", message: "Scene IDs must be unique." });
  });
export const lightingSchema = z
  .object({
    recipe: z.enum(["CONTEXT", "STACKED_MONOCHROME"]),
    title: text,
    scene: sceneSchema,
    settings: z
      .object({
        mode: text,
        iso: text,
        aperture: text,
        shutter: text,
        focalLength: text,
        focus: text,
        whiteBalance: text,
      })
      .strict(),
    notes: z.array(text).max(30),
    provenance: text,
  })
  .strict();
export const observationSchema = z
  .object({
    subjectId: z.string().uuid(),
    visibleColors: note,
    fabricNotes: note,
    fitNotes: note,
    uncertainty: note,
    source: z.literal("USER_REPORTED"),
  })
  .strict();
export const outfitSchema = z
  .object({
    id: z.string().max(100),
    name: text,
    color: z.string().max(300),
    garments: z.array(text).min(1).max(8),
    accessories: z.array(text).max(8),
    rationale: text,
    suitability: text,
    comfort: text,
    alternatives: text,
  })
  .strict();
export const lookSchema = z
  .object({
    subjectId: z.string().uuid(),
    label: z.string().max(100),
    candidates: z.array(outfitSchema).length(3),
    selectedId: z.string(),
    locked: z.boolean(),
  })
  .strict();
export const wardrobeSchema = z
  .object({
    palette: z.array(z.string().max(300)).min(1).max(20),
    heroSubjectId: z.string().uuid().optional(),
    looks: z.array(lookSchema).max(20),
    observations: z.array(observationSchema).max(20),
    rationale: text,
    provenance: text,
  })
  .strict();
export const stylingSchema = z
  .object({
    revision: z.number().int().positive(),
    createdAt: z.string().datetime(),
    inputHash: z.string(),
    lightingInputHash: z.string().optional(),
    wardrobeInputHash: z.string().optional(),
    lighting: lightingSchema.optional(),
    wardrobe: wardrobeSchema.optional(),
  })
  .strict();
export const stylingActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("LIGHTING"),
      baseRevision: z.number().int().nonnegative(),
      recipe: z.enum(["CONTEXT", "STACKED_MONOCHROME"]),
      fill: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal("SCENE"),
      baseRevision: z.number().int().nonnegative(),
      scene: sceneSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("WARDROBE"),
      baseRevision: z.number().int().nonnegative(),
      heroSubjectId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("OBSERVATION"),
      baseRevision: z.number().int().nonnegative(),
      observation: observationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("SELECT"),
      baseRevision: z.number().int().nonnegative(),
      subjectId: z.string().uuid(),
      candidateId: z.string().max(100),
      locked: z.boolean(),
    })
    .strict(),
]);
export type Scene = z.infer<typeof sceneSchema>;
export type Lighting = z.infer<typeof lightingSchema>;
export type Wardrobe = z.infer<typeof wardrobeSchema>;
export type Styling = z.infer<typeof stylingSchema>;
export type StylingAction = z.infer<typeof stylingActionSchema>;
