import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  documentSchema,
  reviewSchema,
  searchSchema,
  type KnowledgeDocument,
  type KnowledgeHit,
  type SearchInput,
} from "@framecraft/shared/knowledge";
import {
  fingerprint,
  extractMarkdown,
  extractPdf,
  chunksFor,
  renderThumbnail,
  isNearCopy,
  hybridSearch,
  validReference,
} from "@framecraft/knowledge";
import { MockVisualAnalyzer, embeddingProvider } from "@framecraft/ai";
import {
  withCorpus,
  assertCorpusMutable,
  assertKnowledgeAdmin,
} from "./knowledge-repository";
import { InputError } from "./input-repository";
import { objectStore } from "./object-store";
import { mockMode } from "./store";
export function publicDocument(doc: KnowledgeDocument) {
  return {
    id: doc.id,
    title: doc.title,
    mime: doc.mime,
    author: doc.author,
    edition: doc.edition,
    licenseStatus: doc.licenseStatus,
    allowDerivedUse: doc.allowDerivedUse,
    allowPrivateReview: doc.allowPrivateReview,
    allowPrivateVision: doc.allowPrivateVision,
    allowOriginalDisplay: false,
    status: doc.status,
    sha256: doc.sha256,
    pages: doc.pages,
    imageOnlyPages: doc.imageOnlyPages,
    chunkCount: doc.chunks.length,
    approvedChunks: doc.chunks.filter((c) => c.reviewStatus === "APPROVED")
      .length,
    taxonomy: doc.taxonomy,
    errorCode: doc.errorCode,
    createdAt: doc.createdAt,
  };
}
export async function ingestSource(
  owner: string,
  metadata: unknown,
  bytes: Uint8Array,
  fileName: string,
  mime: string,
) {
  await assertKnowledgeAdmin(owner);
  const data = documentSchema.parse(metadata);
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    throw new InputError(
      "DOCUMENT_SIZE",
      "Documents must be between 1 byte and 10 MB.",
      413,
    );
  if (!["application/pdf", "text/markdown"].includes(mime))
    throw new InputError("DOCUMENT_TYPE", "Choose a Markdown or PDF document.");
  if (
    mime === "application/pdf" &&
    Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
  )
    throw new InputError("INVALID_PDF", "The document signature is not PDF.");
  const sha = fingerprint(bytes);
  return withCorpus(
    owner,
    async (corpus) => {
      assertCorpusMutable(corpus);
      const duplicate = corpus.documents.find(
        (d) => d.sha256 === sha && d.status !== "DELETED",
      );
      if (duplicate)
        return { document: publicDocument(duplicate), duplicate: true };
      if (corpus.documents.filter((d) => d.status !== "DELETED").length >= 20)
        throw new InputError(
          "DOCUMENT_LIMIT",
          "This private library supports up to 20 source documents.",
          429,
        );
      const id = randomUUID();
      const doc: KnowledgeDocument = {
        ...data,
        id,
        ownerId: owner,
        sha256: sha,
        mime: mime as KnowledgeDocument["mime"],
        sourceFilename: fileName.replace(/[\\/]/g, "_").slice(0, 180),
        storageKey: `knowledge/${owner}/${id}/original.${mime === "application/pdf" ? "pdf" : "md"}`,
        allowOriginalDisplay: false,
        scope: "PRIVATE_OWNER",
        status: "QUEUED",
        pages: 0,
        imageOnlyPages: [],
        chunks: [],
        createdAt: new Date().toISOString(),
      };
      await objectStore().put(doc.storageKey, bytes, mime);
      corpus.documents.push(doc);
      return { document: publicDocument(doc), duplicate: false };
    },
    true,
  );
}
export async function processIngestion(
  owner: string,
  id: string,
  jobId?: string,
) {
  const doc = await withCorpus(owner, (c) =>
    structuredClone(findDocument(c.documents, id)),
  );
  if (jobId && doc.lastIngestJobId === jobId)
    return {
      documentId: id,
      chunkCount: doc.chunks.length,
      pages: doc.pages,
      imageOnlyPages: doc.imageOnlyPages,
    };
  const bytes = await objectStore().get(doc.storageKey);
  if (fingerprint(bytes) !== doc.sha256)
    throw new InputError(
      "SOURCE_INTEGRITY",
      "Stored source failed checksum verification.",
    );
  const extracted =
    doc.mime === "application/pdf"
      ? await extractPdf(bytes)
      : { sections: extractMarkdown(bytes), pages: 1, imageOnlyPages: [] };
  const chunks = chunksFor(doc, extracted.sections);
  await withCorpus(
    owner,
    (c) => {
      assertCorpusMutable(c);
      const target = findDocument(c.documents, id);
      if (
        c.documents
          .filter((d) => d.id !== id)
          .reduce((n, d) => n + d.chunks.length, 0) +
          chunks.length >
        4000
      )
        throw new InputError(
          "LIBRARY_CHUNK_LIMIT",
          "Private library chunk limit reached.",
        );
      const nextRevision =
        Math.max(
          target.lastChunkRevision ?? 0,
          ...target.chunks.map((c) => c.revision),
        ) + 1;
      target.lastChunkRevision = nextRevision;
      target.chunks = chunks.map((c) => ({ ...c, revision: nextRevision }));
      if (jobId) target.lastIngestJobId = jobId;
      target.pages = extracted.pages;
      target.imageOnlyPages = extracted.imageOnlyPages;
      target.status = "REVIEW_REQUIRED";
      delete target.errorCode;
    },
    true,
  );
  return {
    documentId: id,
    chunkCount: chunks.length,
    pages: extracted.pages,
    imageOnlyPages: extracted.imageOnlyPages,
  };
}
export function findDocument(docs: KnowledgeDocument[], id: string) {
  const doc = docs.find((d) => d.id === id && d.status !== "DELETED");
  if (!doc) throw new InputError("NOT_FOUND", "Private source not found.", 404);
  return doc;
}
export async function listDocuments(owner: string) {
  await assertKnowledgeAdmin(owner);
  return withCorpus(owner, (c) =>
    c.documents.filter((d) => d.status !== "DELETED").map(publicDocument),
  );
}
export async function documentDetail(owner: string, id: string) {
  await assertKnowledgeAdmin(owner);
  return withCorpus(owner, (c) => {
    const doc = findDocument(c.documents, id);
    return {
      ...publicDocument(doc),
      chunks: doc.chunks.map((chunk) => ({
        ...chunk,
        text: doc.allowPrivateReview ? chunk.text.slice(0, 600) : "",
        embedding: undefined,
      })),
    };
  });
}
export async function reviewChunk(
  owner: string,
  docId: string,
  chunkId: string,
  raw: unknown,
) {
  await assertKnowledgeAdmin(owner);
  const data = reviewSchema.parse(raw);
  return withCorpus(
    owner,
    (c) => {
      assertCorpusMutable(c);
      const doc = findDocument(c.documents, docId);
      const chunk = doc.chunks.find((k) => k.id === chunkId);
      if (!chunk)
        throw new InputError("NOT_FOUND", "Source chunk not found.", 404);
      if (chunk.revision !== data.baseRevision)
        throw new InputError(
          "CONFLICT",
          "This chunk changed. Reload before reviewing.",
          409,
        );
      if (
        data.reviewStatus === "APPROVED" &&
        (!doc.allowDerivedUse || isNearCopy(data.summary, chunk.text))
      )
        throw new InputError(
          "RIGHTS_OR_COPY",
          "Derived use must be permitted and the summary must be an original paraphrase.",
        );
      Object.assign(chunk, {
        summary: data.summary,
        reviewStatus: data.reviewStatus,
        taxonomy: data.taxonomy,
        reviewerId: owner,
        reviewedAt: new Date().toISOString(),
        revision:
          Math.max(
            doc.lastChunkRevision ?? 0,
            ...doc.chunks.map((c) => c.revision),
          ) + 1,
      });
      doc.lastChunkRevision = chunk.revision;
      delete chunk.embedding;
      delete chunk.embeddingModel;
      doc.status = doc.chunks.some((k) => k.reviewStatus === "APPROVED")
        ? "READY"
        : "REVIEW_REQUIRED";
      return {
        id: chunk.id,
        revision: chunk.revision,
        reviewStatus: chunk.reviewStatus,
      };
    },
    true,
  );
}
export async function embedDocument(owner: string, id: string) {
  await assertKnowledgeAdmin(owner);
  if (process.env.ENABLE_EMBEDDINGS !== "true")
    throw new InputError(
      "EMBEDDINGS_DISABLED",
      "Enable optional embeddings explicitly.",
    );
  if ((process.env.AI_EMBEDDINGS_PROVIDER ?? "mock") !== "mock")
    throw new InputError(
      "PROVIDER_UNAVAILABLE",
      "No real embedding provider is configured.",
      503,
    );
  return withCorpus(
    owner,
    async (c) => {
      assertCorpusMutable(c);
      const doc = findDocument(c.documents, id);
      let count = 0;
      for (const chunk of doc.chunks)
        if (chunk.reviewStatus === "APPROVED" && doc.allowDerivedUse) {
          chunk.embedding = (
            await embeddingProvider().embed([chunk.summary])
          )[0];
          chunk.embeddingModel = "mock-hash-64-v1";
          count++;
        }
      return { count, model: "mock-hash-64-v1" };
    },
    true,
  );
}
export async function searchKnowledge(
  owner: string,
  raw: unknown,
): Promise<KnowledgeHit[]> {
  const input = searchSchema.parse(raw);
  return withCorpus(owner, async (c, tx) => {
    let ranks: Record<string, number> | undefined;
    if (!mockMode()) {
      const rows = (await tx!
        .$queryRaw`SELECT "chunkId",ts_rank_cd("searchVector",plainto_tsquery('english',${input.query})) AS rank FROM "KnowledgeSearchIndex" WHERE "ownerId"=${owner}`) as {
        chunkId: string;
        rank: number;
      }[];
      ranks = Object.fromEntries(rows.map((r) => [r.chunkId, Number(r.rank)]));
    }
    return hybridSearch(
      c.documents,
      input,
      process.env.ENABLE_EMBEDDINGS === "true"
        ? (await embeddingProvider().embed([input.query]))[0]
        : undefined,
      ranks,
    );
  });
}
export async function privateThumbnail(
  owner: string,
  id: string,
  page: number,
) {
  await assertKnowledgeAdmin(owner);
  const doc = await withCorpus(owner, (c) =>
    structuredClone(findDocument(c.documents, id)),
  );
  if (doc.mime !== "application/pdf" || !doc.allowPrivateReview)
    throw new InputError(
      "PRIVATE_REVIEW_DISABLED",
      "Private page review is not permitted for this source.",
      403,
    );
  if (!Number.isInteger(page) || page < 1 || page > doc.pages)
    throw new InputError("INVALID_PAGE", "Choose an extracted source page.");
  return renderThumbnail(await objectStore().get(doc.storageKey), page);
}
export async function visualPageReview(
  owner: string,
  id: string,
  page: number,
) {
  await assertKnowledgeAdmin(owner);
  const doc = await withCorpus(owner, (c) =>
    structuredClone(findDocument(c.documents, id)),
  );
  if (!doc.allowPrivateVision)
    throw new InputError(
      "VISION_NOT_PERMITTED",
      "Explicit private vision permission is required.",
      403,
    );
  if ((process.env.AI_VISION_PROVIDER ?? "mock") !== "mock")
    throw new InputError(
      "PROVIDER_UNAVAILABLE",
      "No real vision provider is configured.",
      503,
    );
  const result = await new MockVisualAnalyzer().analyzePage({
    thumbnail: await privateThumbnail(owner, id, page),
    page,
    title: doc.title,
  });
  return { ...result, page, provider: "mock-vision-v1" };
}
export async function addVisualChunk(
  owner: string,
  id: string,
  page: number,
  summary: string,
) {
  await assertKnowledgeAdmin(owner);
  return withCorpus(
    owner,
    (c) => {
      assertCorpusMutable(c);
      const doc = findDocument(c.documents, id);
      if (
        !doc.allowPrivateReview ||
        page < 1 ||
        page > doc.pages ||
        !Number.isInteger(page)
      )
        throw new InputError(
          "INVALID_PAGE",
          "Private page review is required.",
        );
      const chunkId = fingerprint(Buffer.from(`${doc.sha256}:visual:${page}`));
      if (doc.chunks.some((k) => k.id === chunkId))
        throw new InputError(
          "DUPLICATE_REVIEW",
          "This page already has a visual review card.",
          409,
        );
      doc.chunks.push({
        id: chunkId,
        documentId: id,
        text: "",
        headingPath: ["Original private page review"],
        pageStart: page,
        pageEnd: page,
        summary,
        reviewStatus: "PENDING",
        revision: (doc.lastChunkRevision ?? 0) + 1,
        taxonomy: doc.taxonomy,
      });
      doc.lastChunkRevision = (doc.lastChunkRevision ?? 0) + 1;
      return { id: chunkId };
    },
    true,
  );
}
export async function deleteDocument(owner: string, id: string) {
  await assertKnowledgeAdmin(owner);
  return withCorpus(
    owner,
    async (c) => {
      assertCorpusMutable(c);
      const doc = findDocument(c.documents, id);
      await objectStore().remove(doc.storageKey);
      doc.status = "DELETED";
      doc.chunks = [];
      doc.allowDerivedUse = false;
      return { deleted: true };
    },
    true,
  );
}
export async function validateSources(
  owner: string,
  refs: import("@framecraft/shared/knowledge").SourceReference[],
) {
  return withCorpus(owner, (c) =>
    refs.every((ref) => validReference(ref, c.documents)),
  );
}
export async function takeKnowledgeLease(
  owner: string,
  jobId: string,
  query: SearchInput,
) {
  await withCorpus(
    owner,
    (c) => {
      c.leases = c.leases.filter((l) => l.expiresAt > Date.now());
      c.leases.push({ jobId, expiresAt: Date.now() + 300000 });
    },
    true,
  );
  return searchKnowledge(owner, query);
}
export async function releaseKnowledgeLease(owner: string, jobId: string) {
  await withCorpus(
    owner,
    (c) => {
      c.leases = c.leases.filter((l) => l.jobId !== jobId);
    },
    true,
  );
}

export async function updateDocumentRights(
  owner: string,
  id: string,
  raw: unknown,
) {
  await assertKnowledgeAdmin(owner);
  const data = z
    .object({
      allowDerivedUse: z.boolean().optional(),
      allowPrivateReview: z.boolean().optional(),
      allowPrivateVision: z.boolean().optional(),
    })
    .strict()
    .parse(raw);
  return withCorpus(
    owner,
    (c) => {
      assertCorpusMutable(c);
      const doc = findDocument(c.documents, id);
      const next = { ...doc, ...data };
      if (next.allowPrivateVision && !next.allowPrivateReview)
        throw new InputError(
          "RIGHTS_CONFLICT",
          "Disable private vision when withdrawing private page review.",
        );
      Object.assign(doc, data);
      return publicDocument(doc);
    },
    true,
  );
}
