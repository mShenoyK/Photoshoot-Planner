import { z } from "zod";
import { ageGroups } from "./inputs";
export const taxonomySchema = z
  .object({
    environments: z
      .array(z.enum(["INDOOR", "OUTDOOR"]))
      .max(2)
      .default([]),
    ageGroups: z.array(z.enum(ageGroups)).max(7).default([]),
    minSubjects: z.number().int().min(1).max(20).default(1),
    maxSubjects: z.number().int().min(1).max(20).default(20),
    topics: z
      .array(z.enum(["POSE", "LIGHTING", "WARDROBE", "SAFETY", "COMPOSITION"]))
      .min(1)
      .max(5)
      .default(["POSE"]),
  })
  .strict()
  .refine(
    (t) => t.minSubjects <= t.maxSubjects,
    "Subject-count range is invalid",
  );
export const documentSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    author: z.string().max(160).default(""),
    edition: z.string().max(100).default(""),
    licenseStatus: z.enum([
      "OWNED",
      "LICENSED",
      "PUBLIC_DOMAIN",
      "PRIVATE_REFERENCE",
      "UNVERIFIED",
    ]),
    ingestionPermitted: z.literal(true),
    allowDerivedUse: z.boolean(),
    allowPrivateReview: z.boolean().default(false),
    allowPrivateVision: z.boolean().default(false),
    taxonomy: taxonomySchema,
  })
  .strict()
  .refine(
    (d) => d.licenseStatus !== "UNVERIFIED",
    "Assess source rights before ingesting.",
  )
  .refine(
    (d) => !d.allowPrivateVision || d.allowPrivateReview,
    "Private visual review permission is required.",
  );
export type DocumentInput = z.infer<typeof documentSchema>;
export type SourceReference = {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  chunkRevision: number;
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
};
export type KnowledgeChunk = {
  id: string;
  documentId: string;
  text: string;
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
  summary: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewerId?: string;
  reviewedAt?: string;
  revision: number;
  taxonomy: z.infer<typeof taxonomySchema>;
  embedding?: number[];
  embeddingModel?: string;
};
export type KnowledgeDocument = DocumentInput & {
  representation?: "REVIEWED_NOTES";
  id: string;
  ownerId: string;
  sha256: string;
  mime: "text/markdown" | "application/pdf";
  sourceFilename: string;
  storageKey: string;
  allowOriginalDisplay: false;
  scope: "PRIVATE_OWNER";
  status: "QUEUED" | "REVIEW_REQUIRED" | "READY" | "FAILED" | "DELETED";
  lastChunkRevision?: number;
  lastIngestJobId?: string;
  pages: number;
  imageOnlyPages: number[];
  chunks: KnowledgeChunk[];
  errorCode?: string;
  createdAt: string;
};
export type Corpus = {
  documents: KnowledgeDocument[];
  revision: number;
  leases: { jobId: string; expiresAt: number }[];
};
export const reviewSchema = z
  .object({
    summary: z.string().trim().min(12).max(800),
    reviewStatus: z.enum(["APPROVED", "REJECTED"]),
    baseRevision: z.number().int().positive(),
    taxonomy: taxonomySchema,
  })
  .strict();
export const searchSchema = z
  .object({
    query: z.string().trim().min(3).max(500),
    filters: z
      .object({
        environment: z.enum(["INDOOR", "OUTDOOR"]).optional(),
        subjectCount: z.number().int().min(1).max(20).optional(),
        ageGroups: z.array(z.enum(ageGroups)).max(7).optional(),
        topics: z
          .array(
            z.enum(["POSE", "LIGHTING", "WARDROBE", "SAFETY", "COMPOSITION"]),
          )
          .optional(),
      })
      .strict()
      .default({}),
    maxResults: z.number().int().min(1).max(20).default(8),
  })
  .strict();
export type SearchInput = z.infer<typeof searchSchema>;
export type KnowledgeHit = {
  id: string;
  summary: string;
  sourceReference: SourceReference;
  relevanceScore: number;
  permissions: { derivedUse: true; originalDisplay: false };
  taxonomy: z.infer<typeof taxonomySchema>;
};
export type TaskJob = {
  id: string;
  ownerId: string;
  shootId?: string;
  kind:
    | "INGEST"
    | "EMBED"
    | "PLAN"
    | "REGENERATE"
    | "ILLUSTRATE"
    | "EXPORT"
    | "VISUAL";
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: number;
  attempts: number;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorCode?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  leaseUntil?: number;
};
