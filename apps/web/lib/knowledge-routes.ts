import {
  completePlanSnapshot,
  completePlanInputs,
} from "./complete-plan-service";
import { z } from "zod";
import { generationSchema, sectionSchema } from "@framecraft/shared/planning";
import {
  ingestSource,
  listDocuments,
  documentDetail,
  reviewChunk,
  searchKnowledge,
  privateThumbnail,
  visualPageReview,
  addVisualChunk,
  deleteDocument,
  findDocument,
  updateDocumentRights,
} from "./knowledge-service";
import { enqueue, retryTask, publicJob } from "./job-queue";
import {
  getJob,
  withCorpus,
  assertKnowledgeAdmin,
} from "./knowledge-repository";
import { listPlans, editPlan, approvePlan } from "./planning-service";
import type { InputHttp } from "./inputs-routes";
import { InputError, withShoot } from "./input-repository";
import { boundedBody } from "./image-intake";
export async function knowledgeRoutes(
  request: Request,
  p: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const method = request.method;
  const [root, id, section, item, action, detail] = p;
  if (root === "jobs" && p.length === 2 && method === "GET")
    return http.ok(publicJob(await getJob(owner, id)));
  if (
    root === "jobs" &&
    p.length === 3 &&
    section === "retry" &&
    method === "POST"
  )
    return http.ok(publicJob(await retryTask(owner, id)), 202);
  if (root === "knowledge" && id === "search" && method === "POST")
    return http.ok(await searchKnowledge(owner, await http.readJson(request)));
  if (root === "admin" && id === "knowledge" && section === "documents") {
    if (p.length === 3 && method === "GET")
      return http.ok(await listDocuments(owner));
    if (p.length === 3 && method === "POST") {
      await assertKnowledgeAdmin(owner);
      const type = request.headers.get("content-type") ?? "";
      if (!type.startsWith("multipart/form-data"))
        throw new InputError(
          "CONTENT_TYPE",
          "Use a multipart document upload.",
        );
      // Bound the entire multipart body before invoking the platform parser.
      const bytes = await boundedBody(request, 11 * 1024 * 1024);
      const form = await new Request("http://private-upload", {
        method: "POST",
        headers: { "content-type": type },
        body: new Uint8Array(bytes),
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new InputError(
          "FILE_REQUIRED",
          "Choose a Markdown or PDF source.",
        );
      if (!/\.(md|markdown|pdf)$/i.test(file.name))
        throw new InputError(
          "DOCUMENT_TYPE",
          "Choose a .md, .markdown or .pdf source.",
        );
      let metadata: unknown;
      try {
        metadata = JSON.parse(String(form.get("metadata")));
      } catch {
        throw new InputError("VALIDATION", "Invalid document metadata.");
      }
      const result = await ingestSource(
        owner,
        metadata,
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "text/markdown",
      );
      const job = result.duplicate
        ? undefined
        : await enqueue(owner, "INGEST", `ingest-${result.document.id}`, {
            documentId: result.document.id,
          });
      return http.ok(
        { ...result, jobId: job?.id },
        result.duplicate ? 200 : 202,
      );
    }
    if (p.length === 4 && method === "GET")
      return http.ok(await documentDetail(owner, item));
    if (p.length === 4 && method === "PATCH")
      return http.ok(
        await updateDocumentRights(owner, item, await http.readJson(request)),
      );
    if (p.length === 4 && method === "DELETE")
      return http.ok(await deleteDocument(owner, item));
    if (p.length === 5 && action === "reindex" && method === "POST") {
      await assertKnowledgeAdmin(owner);
      await withCorpus(owner, (c) => findDocument(c.documents, item));
      return http.ok(
        publicJob(
          await enqueue(owner, "INGEST", `reindex-${item}-${Date.now()}`, {
            documentId: item,
          }),
        ),
        202,
      );
    }
    if (p.length === 5 && action === "embeddings" && method === "POST") {
      await assertKnowledgeAdmin(owner);
      return http.ok(
        publicJob(
          await enqueue(owner, "EMBED", `embed-${item}-${Date.now()}`, {
            documentId: item,
          }),
        ),
        202,
      );
    }
    if (p.length === 6 && action === "chunks" && method === "PATCH")
      return http.ok(
        await reviewChunk(owner, item, detail, await http.readJson(request)),
      );
    if (p.length === 6 && action === "pages" && method === "GET") {
      const bytes = await privateThumbnail(owner, item, Number(detail));
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (p.length === 6 && action === "vision" && method === "POST")
      return http.ok(await visualPageReview(owner, item, Number(detail)));
    if (p.length === 5 && action === "visual-cards" && method === "POST") {
      const body = z
        .object({
          page: z.number().int().positive(),
          summary: z.string().trim().min(12).max(800),
        })
        .strict()
        .parse(await http.readJson(request));
      return http.ok(
        await addVisualChunk(owner, item, body.page, body.summary),
        201,
      );
    }
  }
  if (
    root === "shoots" &&
    id &&
    section === "complete-plan" &&
    p.length === 3
  ) {
    if (method === "GET") return http.ok(await completePlanSnapshot(owner, id));
    if (method === "POST") {
      const body = generationSchema.parse(await http.readJson(request));
      if (body.knowledgeOnly)
        throw new InputError(
          "USE_INDIVIDUAL_TOOL",
          "Choose knowledge-only mode inside Posing guide or Wardrobe Stylist.",
          422,
        );
      const snapshot = await completePlanInputs(owner, id);
      return http.ok(
        publicJob(
          await enqueue(
            owner,
            "PLAN",
            body.idempotencyKey,
            {
              poseCount: body.poseCount,
              useKnowledgeBase: body.useKnowledgeBase,
              knowledgeOnly: body.knowledgeOnly,
              referenceScope: body.referenceScope,
              complete: true,
              ...snapshot,
            },
            id,
          ),
        ),
        202,
      );
    }
  }
  if (root === "shoots" && id && section === "plans") {
    if (p.length === 3 && method === "GET")
      return http.ok(await listPlans(owner, id));
    if (p.length === 3 && method === "POST") {
      const body = generationSchema.parse(await http.readJson(request));
      await withShoot(owner, id, () => true);
      return http.ok(
        publicJob(
          await enqueue(
            owner,
            "PLAN",
            body.idempotencyKey,
            {
              poseCount: body.poseCount,
              useKnowledgeBase: body.useKnowledgeBase,
              knowledgeOnly: body.knowledgeOnly,
              referenceScope: body.referenceScope,
            },
            id,
          ),
        ),
        202,
      );
    }
    if (p.length === 4 && method === "GET") {
      const plan = (await listPlans(owner, id)).find(
        (plan) => plan.id === item,
      );
      if (!plan) throw new InputError("NOT_FOUND", "Plan not found.", 404);
      return http.ok(plan);
    }
    if (p.length === 4 && method === "PATCH")
      return http.ok(
        await editPlan(owner, id, item, await http.readJson(request)),
      );
    if (p.length === 5 && action === "approve" && method === "POST") {
      const body = z
        .object({ baseVersion: z.number().int().positive() })
        .strict()
        .parse(await http.readJson(request));
      return http.ok(await approvePlan(owner, id, item, body.baseVersion));
    }
    if (
      p.length === 5 &&
      action === "regenerate-section" &&
      method === "POST"
    ) {
      const body = z
        .object({
          baseVersion: z.number().int().positive(),
          section: sectionSchema,
          idempotencyKey: z.string().min(8).max(100),
        })
        .strict()
        .parse(await http.readJson(request));
      const latest = (await listPlans(owner, id)).at(-1);
      if (!latest || latest.id !== item || latest.version !== body.baseVersion)
        throw new InputError("CONFLICT", "Reload the latest plan.", 409);
      if (latest.lockedSections.includes(body.section))
        throw new InputError(
          "SECTION_LOCKED",
          "Unlock this section first.",
          409,
        );
      return http.ok(
        publicJob(
          await enqueue(
            owner,
            "REGENERATE",
            body.idempotencyKey,
            {
              poseCount: latest.poses.length,
              useKnowledgeBase: true,
              baseVersion: body.baseVersion,
              section: body.section,
            },
            id,
          ),
        ),
        202,
      );
    }
  }
  return null;
}
