import {
  visualRequestSchema,
  visualTargetSchema,
  visualKey,
} from "@framecraft/shared/visuals";
import { imageProviderStatus } from "@framecraft/ai";
import {
  listVisuals,
  matchingVisual,
  assertVisualRequest,
  downloadVisual,
} from "./visual-service";
import { enqueue, publicJob } from "./job-queue";
import { withJobs } from "./knowledge-repository";
import { InputError } from "./input-repository";
import type { InputHttp } from "./inputs-routes";
export async function visualRoutes(
  request: Request,
  p: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const [root, id, section, visualId, action] = p;
  if (root !== "shoots" || !id || section !== "visuals") return null;
  if (p.length === 3 && request.method === "GET") {
    const items = await listVisuals(owner, id);
    const rawTarget = new URL(request.url).searchParams.get("target");
    const matchingItem = rawTarget
      ? await matchingVisual(
          owner,
          id,
          visualTargetSchema.parse(JSON.parse(rawTarget)),
        )
      : null;
    const jobs = await withJobs(owner, (all) =>
      all
        .filter((j) => j.shootId === id && j.kind === "VISUAL")
        .map((j) => ({
          targetKey: visualKey(
            visualRequestSchema.parse({
              ...j.input,
              idempotencyKey: j.idempotencyKey,
            }).target,
          ),
          job: publicJob(j),
        })),
    );
    return http.ok({
      items,
      jobs,
      matchingItem,
      provider: imageProviderStatus(),
    });
  }
  if (p.length === 3 && request.method === "POST") {
    const body = visualRequestSchema.parse(await http.readJson(request));
    await assertVisualRequest(owner, id, body.target);
    const provider = imageProviderStatus();
    if (!provider.configured)
      throw new InputError(
        "IMAGE_NOT_CONFIGURED",
        "Live image generation needs AI_IMAGE_PROVIDER=openai and a server-side OPENAI_API_KEY. No dummy image will be returned.",
        503,
      );
    return http.ok(
      publicJob(
        await enqueue(
          owner,
          "VISUAL",
          body.idempotencyKey,
          { target: body.target, force: body.force },
          id,
        ),
      ),
      202,
    );
  }
  if (p.length === 5 && action === "download" && request.method === "GET") {
    const { record, bytes } = await downloadVisual(owner, id, visualId);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `inline; filename="${record.target.kind.toLowerCase()}-${record.id}.png"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }
  return null;
}
