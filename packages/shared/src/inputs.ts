import { z } from "zod";
export const ageGroups = [
  "BABY",
  "TODDLER",
  "CHILD",
  "TEEN",
  "ADULT",
  "SENIOR",
  "UNSPECIFIED",
] as const;
export const subjectSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    ageGroup: z.enum(ageGroups),
    ageYears: z.number().min(0).max(120).optional(),
    selfDescribedGender: z.string().max(100).default(""),
    clothingSize: z.string().max(100).default(""),
    fitComfort: z.string().max(1000).default(""),
    preferredColors: z.string().max(300).default(""),
    avoidedColors: z.string().max(300).default(""),
    stylePreferences: z.string().max(1000).default(""),
    mobilityNotes: z.string().max(1000).default(""),
    budget: z.number().nonnegative().max(1000000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("INR"),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      s.ageYears !== undefined &&
      ((["ADULT", "SENIOR"].includes(s.ageGroup) && s.ageYears < 18) ||
        (["BABY", "TODDLER", "CHILD", "TEEN"].includes(s.ageGroup) &&
          s.ageYears >= 18))
    )
      c.addIssue({
        code: "custom",
        path: ["ageYears"],
        message:
          "Age and age band disagree. Please correct the stated profile.",
      });
  });
export type SubjectInput = z.infer<typeof subjectSchema>;
export function requiresGuardian(s: SubjectInput) {
  return s.ageYears !== undefined
    ? s.ageYears < 18
    : !["ADULT", "SENIOR"].includes(s.ageGroup);
}
export const consentSchema = z
  .object({
    status: z.enum(["GRANTED", "REFUSED", "REVOKED"]),
    acknowledged: z.boolean().default(false),
    confirmedAuthority: z.boolean().default(false),
    guardianName: z.string().trim().max(120).default(""),
    guardianRelationship: z.string().trim().max(120).default(""),
    allowAnalysis: z.boolean().default(false),
    allowGeneration: z.boolean().default(false),
  })
  .strict();
export type Consent = {
  id: string;
  actorUserId: string;
  subjectId: string;
  status: "GRANTED" | "REFUSED" | "REVOKED";
  policyVersion: string;
  recordedAt: string;
  guardianName: string;
  guardianRelationship: string;
  allowAnalysis: boolean;
  allowGeneration: boolean;
};
export type Subject = SubjectInput & {
  id: string;
  consent?: Consent;
  consentHistory: Consent[];
};
export const mediaKinds = [
  "SCENE_REFERENCE",
  "POSE_REFERENCE",
  "SUBJECT_PHOTO",
  "WARDROBE_REFERENCE",
  "OTHER",
] as const;
export const referenceScopes = [
  "PLAN",
  "POSES",
  "LIGHTING",
  "WARDROBE",
] as const;
export type ReferenceScope = (typeof referenceScopes)[number];
export const referenceViews = [
  "FRONT",
  "SIDE",
  "FULL_LENGTH",
  "DETAIL",
  "INSPIRATION",
  "OTHER",
] as const;
export const uploadIntentSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (v) =>
          !/[\\/]/.test(v) &&
          !Array.from(v).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          ),
        "Use a plain file name",
      ),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    bytes: z.number().int().positive(),
    kind: z.enum(mediaKinds),
    workflowScope: z.enum(referenceScopes).optional(),
    referenceView: z.enum(referenceViews).optional(),
    subjectIds: z.array(z.string().uuid()).max(20),
    noIdentifiablePeople: z.boolean().default(false),
  })
  .strict()
  .superRefine((s, c) => {
    if (new Set(s.subjectIds).size !== s.subjectIds.length)
      c.addIssue({
        code: "custom",
        path: ["subjectIds"],
        message: "Choose each subject once.",
      });
    if (
      !s.subjectIds.length &&
      (s.kind === "SUBJECT_PHOTO" || !s.noIdentifiablePeople)
    )
      c.addIssue({
        code: "custom",
        path: ["subjectIds"],
        message:
          "Declare every identifiable person, or confirm this reference contains none.",
      });
  });
export type UploadInput = z.infer<typeof uploadIntentSchema>;
export type UploadIntent = UploadInput & {
  id: string;
  expiresAt: number;
  consentIds: Record<string, string>;
  status: "PENDING" | "UPLOADED" | "COMPLETE" | "INVALID";
  assetId?: string;
};
export type MediaAsset = {
  workflowScope?: ReferenceScope;
  referenceView?: (typeof referenceViews)[number];
  id: string;
  kind: UploadInput["kind"];
  fileName: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  subjectIds: string[];
  consentIds: Record<string, string>;
  originalKey: string;
  derivativeKey: string;
  warnings: string[];
  createdAt: string;
};
export const equipmentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(160),
    sensorFormat: z.string().max(80).default("Full frame"),
    lens: z.string().max(200),
    flashCount: z.number().int().min(0).max(20),
    modifiers: z.string().max(500),
    notes: z.string().max(1000).default(""),
  })
  .strict();
export type CameraKit = z.infer<typeof equipmentSchema> & {
  id: string;
  ownerId: string;
};
export const canonPreset: z.infer<typeof equipmentSchema> = {
  name: "Canon portrait kit",
  body: "Canon EOS R6 Mark II",
  sensorFormat: "Full frame",
  lens: "RF 24–105mm f/4",
  flashCount: 2,
  modifiers: "90 cm gridded octabox",
  notes:
    "Starting equipment inventory only. Exposure and light placement depend on the actual scene.",
};
export type CompletePlanRecord = {
  jobId: string;
  planId: string;
  stylingRevision: number;
  inputHash: string;
  createdAt: string;
  referenceIds: string[];
};
export type InputState = {
  completePlans?: CompletePlanRecord[];
  referenceReviews?: import("./references").ReferenceReview[];
  artifacts?: import("./artifacts").Artifact[];
  styling?: import("./styling").Styling[];
  plans?: import("./planning").ShootPlan[];
  subjects: Subject[];
  intents: UploadIntent[];
  media: MediaAsset[];
  cameraKit?: z.infer<typeof equipmentSchema> & { sourceKitId: string };
  pendingDeletionKeys?: string[];
  deleting?: boolean;
};
export function emptyInputs(): InputState {
  return { subjects: [], intents: [], media: [] };
}
export const blankSubject: SubjectInput = {
  label: "",
  ageGroup: "UNSPECIFIED",
  selfDescribedGender: "",
  clothingSize: "",
  fitComfort: "",
  preferredColors: "",
  avoidedColors: "",
  stylePreferences: "",
  mobilityNotes: "",
  currency: "INR",
};
