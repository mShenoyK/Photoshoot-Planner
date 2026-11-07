import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeHit,
  SearchInput,
  SourceReference,
} from "@framecraft/shared/knowledge";
export const fingerprint = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
type Extracted = {
  text: string;
  headingPath: string[];
  pageStart?: number;
  pageEnd?: number;
  lineStart?: number;
  lineEnd?: number;
};
function split(text: string) {
  const words = text.trim().split(/\s+/);
  const result: string[] = [];
  for (let i = 0; i < words.length; i += 340) {
    const segment = words.slice(i, i + 400).join(" ");
    for (let k = 0; k < segment.length; k += 5000)
      if (segment.slice(k, k + 5000).trim())
        result.push(segment.slice(k, k + 5000));
    if (i + 400 >= words.length) break;
  }
  return result;
}
export function extractMarkdown(bytes: Uint8Array): Extracted[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0")) throw new Error("INVALID_MARKDOWN");
  const lines = text.split(/\r?\n/);
  const sections: Extracted[] = [];
  let headings: string[] = [];
  let start = 1;
  let buffer: string[] = [];
  let fenced = false;
  function flush(end: number) {
    for (const value of split(buffer.join("\n")))
      sections.push({
        text: value,
        headingPath: [...headings],
        lineStart: start,
        lineEnd: end,
      });
    buffer = [];
  }
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced ? line.match(/^(#{1,6})\s+(.+)$/) : null;
    if (heading) {
      flush(i);
      headings = headings.slice(0, heading[1].length - 1);
      headings[heading[1].length - 1] = heading[2];
      start = i + 1;
    }
    buffer.push(line);
  });
  flush(lines.length);
  return sections;
}
async function openPdf(bytes: Uint8Array) {
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
    throw new Error("INVALID_PDF");
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return pdf.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
    wasmUrl: path.join(root, "wasm") + path.sep,
    maxImageSize: 12000000,
    stopAtErrors: true,
  }).promise;
}
export async function extractPdf(
  bytes: Uint8Array,
): Promise<{ sections: Extracted[]; pages: number; imageOnlyPages: number[] }> {
  const document = await openPdf(bytes);
  try {
    if (document.numPages > 150) throw new Error("PDF_PAGE_LIMIT");
    const sections: Extracted[] = [];
    const imageOnlyPages: number[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      if (!text) imageOnlyPages.push(n);
      for (const value of split(text))
        sections.push({
          text: value,
          headingPath: [],
          pageStart: n,
          pageEnd: n,
        });
      page.cleanup();
    }
    return { sections, pages: document.numPages, imageOnlyPages };
  } finally {
    await document.destroy();
  }
}
export async function renderThumbnail(bytes: Uint8Array, pageNumber: number) {
  const document = await openPdf(bytes);
  try {
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    )
      throw new Error("INVALID_PAGE");
    const page = await document.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(600 / base.width, 840 / base.height, 1.5),
    });
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await document.destroy();
  }
}
export function chunksFor(
  document: KnowledgeDocument,
  sections: Extracted[],
): KnowledgeChunk[] {
  if (
    sections.length > 1000 ||
    sections.reduce((n, s) => n + s.text.length, 0) > 2000000
  )
    throw new Error("CHUNK_LIMIT");
  return sections.map((s, index) => ({
    ...s,
    id: fingerprint(
      Buffer.from(
        `${document.sha256}:${s.pageStart ?? "md"}:${s.lineStart ?? 0}:${index}`,
      ),
    ),
    documentId: document.id,
    summary: "",
    reviewStatus: "PENDING",
    revision: 1,
    taxonomy: document.taxonomy,
  }));
}
export function reference(
  doc: KnowledgeDocument,
  chunk: KnowledgeChunk,
): SourceReference {
  return {
    documentId: doc.id,
    documentTitle: doc.title,
    chunkId: chunk.id,
    chunkRevision: chunk.revision,
    ...(chunk.pageStart
      ? { pageStart: chunk.pageStart, pageEnd: chunk.pageEnd }
      : {}),
    ...(chunk.lineStart
      ? { lineStart: chunk.lineStart, lineEnd: chunk.lineEnd }
      : {}),
  };
}
export const words = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function isNearCopy(summary: string, source: string) {
  const tokens = words(summary);
  const original = words(source).join(" ");
  if (tokens.length < 12) return false;
  for (let i = 0; i <= tokens.length - 12; i++)
    if (original.includes(tokens.slice(i, i + 12).join(" "))) return true;
  return false;
}
export function vector(text: string) {
  const result = Array.from({ length: 64 }, () => 0);
  for (const token of words(text)) {
    const hash = createHash("sha256").update(token).digest();
    result[hash[0] % 64] += 1;
  }
  const norm = Math.hypot(...result) || 1;
  return result.map((n) => n / norm);
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  return (
    a.reduce((n, v, i) => n + v * b[i], 0) /
    (Math.hypot(...a) * Math.hypot(...b) || 1)
  );
}
export function eligible(doc: KnowledgeDocument, chunk: KnowledgeChunk) {
  return (
    doc.status === "READY" &&
    doc.allowDerivedUse &&
    doc.licenseStatus !== "UNVERIFIED" &&
    chunk.reviewStatus === "APPROVED"
  );
}
export function hybridSearch(
  documents: KnowledgeDocument[],
  input: SearchInput,
  embedding?: number[],
  sqlRanks?: Record<string, number>,
): KnowledgeHit[] {
  const terms = [...new Set(words(input.query))];
  const rows = documents
    .flatMap((doc) =>
      doc.chunks.filter((c) => eligible(doc, c)).map((c) => ({ doc, c })),
    )
    .filter(({ c }) => {
      const f = input.filters,
        t = c.taxonomy;
      return (
        (!f.environment ||
          !t.environments.length ||
          t.environments.includes(f.environment)) &&
        (!f.subjectCount ||
          (f.subjectCount >= t.minSubjects &&
            f.subjectCount <= t.maxSubjects)) &&
        (!f.ageGroups?.length ||
          !t.ageGroups.length ||
          f.ageGroups.some((a) => t.ageGroups.includes(a))) &&
        (!f.topics?.length || f.topics.some((a) => t.topics.includes(a)))
      );
    });
  return rows
    .map(({ doc, c }) => {
      const tokens = words(
        `${doc.title} ${c.summary} ${c.taxonomy.topics.join(" ")}`,
      );
      const lexical = sqlRanks
        ? Number(sqlRanks[c.id] ?? 0)
        : terms.reduce((score, term) => {
            const frequency = tokens.filter((t) => t === term).length;
            const df = rows.filter((r) =>
              words(r.c.summary + " " + r.doc.title).includes(term),
            ).length;
            return (
              score +
              (Math.log(1 + (rows.length - df + 0.5) / (df + 0.5)) *
                frequency *
                2.2) /
                (frequency + 1.2 * (0.25 + (0.75 * tokens.length) / 80))
            );
          }, 0);
      const semantic =
        embedding && c.embedding
          ? Math.max(0, cosine(embedding, c.embedding))
          : 0;
      return {
        id: c.id,
        summary: c.summary,
        sourceReference: reference(doc, c),
        relevanceScore: Math.round((lexical + 0.3 * semantic) * 10000) / 10000,
        permissions: {
          derivedUse: true as const,
          originalDisplay: false as const,
        },
        taxonomy: c.taxonomy,
      };
    })
    .filter((r) => r.relevanceScore > 0)
    .sort(
      (a, b) => b.relevanceScore - a.relevanceScore || a.id.localeCompare(b.id),
    )
    .slice(0, input.maxResults);
}
export function validReference(
  ref: SourceReference,
  docs: KnowledgeDocument[],
) {
  const doc = docs.find((d) => d.id === ref.documentId);
  const chunk = doc?.chunks.find((c) => c.id === ref.chunkId);
  return (
    !!doc &&
    !!chunk &&
    eligible(doc, chunk) &&
    sameReference(reference(doc, chunk), ref)
  );
}

export function sameReference(a: SourceReference, b: SourceReference) {
  const keys = [
    "documentId",
    "documentTitle",
    "chunkId",
    "chunkRevision",
    "pageStart",
    "pageEnd",
    "lineStart",
    "lineEnd",
  ] as const;
  return keys.every((key) => a[key] === b[key]);
}
