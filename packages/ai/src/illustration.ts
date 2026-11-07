import {
  illustrationSceneSchema,
  type IllustrationScene,
} from "@framecraft/shared/artifacts";
export type IllustrationInput = {
  pose: {
    id: string;
    title: string;
    subjectArrangement: string;
    stepByStepDirections: string[];
  };
  subjects: { id: string; ageGroup: string; ageYears?: number }[];
};
export interface PoseIllustrationProvider {
  readonly name: string;
  generate(input: IllustrationInput): Promise<unknown>;
}
export class SchematicIllustrator implements PoseIllustrationProvider {
  readonly name = "original-schematic-mock-v1";
  async generate(input: IllustrationInput): Promise<IllustrationScene> {
    const adult = input.subjects.find(
      (s) =>
        ["ADULT", "SENIOR"].includes(s.ageGroup) &&
        (s.ageYears === undefined || s.ageYears >= 18),
    );
    return illustrationSceneSchema.parse({
      figures: input.subjects.map((s, i) => ({
        subjectId: s.id,
        x: 70 + (i * 860) / Math.max(1, input.subjects.length - 1),
        y: 210,
        support:
          ["BABY", "TODDLER"].includes(s.ageGroup) ||
          (s.ageYears !== undefined && s.ageYears < 3)
            ? "CAREGIVER_SUPPORTED"
            : "SEATED",
        ...((s.ageGroup === "BABY" ||
          s.ageGroup === "TODDLER" ||
          (s.ageYears !== undefined && s.ageYears < 3)) &&
        adult
          ? { guardianId: adult.id }
          : {}),
      })),
    });
  }
}
export function poseIllustrator(): PoseIllustrationProvider {
  if ((process.env.AI_IMAGE_PROVIDER ?? "mock") !== "mock")
    throw new Error("IMAGE_PROVIDER_NOT_CONFIGURED");
  return new SchematicIllustrator();
}
