import { z } from "zod";
const text = z.string().trim().max(1500);
export const referenceAnalysisSchema = z
  .object({
    sceneSummary: text,
    lightingNotes: text,
    keySide: z.enum(["LEFT", "RIGHT", "FRONT", "UNCERTAIN"]),
    posingNotes: z.array(text).max(6),
    visibleColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8),
    visibleProportions: text,
    fitSuggestions: z.array(text).max(6),
    suggestedColors: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .min(1)
      .max(8),
    outfits: z
      .array(
        z
          .object({
            name: z.string().max(120),
            garments: z.array(text).min(1).max(6),
            rationale: text,
          })
          .strict(),
      )
      .length(3),
    caveats: z.array(text).min(1).max(8),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 12000)
      ctx.addIssue({
        code: "custom",
        message: "Keep the reference review concise (maximum 12 KB).",
      });
  });
export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>;
export type ReferenceReview = {
  id: string;
  assetId: string;
  subjectIds: string[];
  consentIds: Record<string, string>;
  analysis: ReferenceAnalysis;
  provider: string;
  approved: boolean;
  createdAt: string;
};
