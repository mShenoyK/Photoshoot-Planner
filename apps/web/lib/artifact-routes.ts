import { artifactRequestSchema } from "@framecraft/shared/artifacts";
import { listArtifacts, downloadArtifact } from "./artifact-service";
import { withShoot, InputError } from "./input-repository";
import { enqueue, publicJob } from "./job-queue";
import type { InputHttp } from "./inputs-routes";
export async function artifactRoutes(
  request: Request,
  p: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const [root, id, section, item, action] = p;
  if (root !== "shoots" || !id || section !== "artifacts") return null;
  if (p.length === 3 && request.method === "GET")
    return http.ok(await listArtifacts(owner, id));
  if (p.length === 3 && request.method === "POST") {
    const req = artifactRequestSchema.parse(await http.readJson(request));
    await withShoot(owner, id, (s) => {
      const plan = s.plans?.find((v) => v.id === req.planId);
      if (!plan) throw new InputError("NOT_FOUND", "Plan not found.", 404);
      if (req.poseId && !plan.poses.some((p) => p.id === req.poseId))
        throw new InputError("NOT_FOUND", "Pose not found.", 404);
      if (
        req.stylingRevision &&
        !s.styling?.some((v) => v.revision === req.stylingRevision)
      )
        throw new InputError("NOT_FOUND", "Styling not found.", 404);
    });
    const { idempotencyKey, ...input } = req;
    return http.ok(
      publicJob(
        await enqueue(
          owner,
          req.format === "ILLUSTRATION" ? "ILLUSTRATE" : "EXPORT",
          idempotencyKey,
          input,
          id,
        ),
      ),
      202,
    );
  }
  if (p.length === 5 && action === "download" && request.method === "GET") {
    const { artifact: a, bytes } = await downloadArtifact(owner, id, item);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": a.mime,
        "Content-Disposition": `attachment; filename="${a.fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ETag: `"${a.sha256}"`,
      },
    });
  }
  return null;
}
