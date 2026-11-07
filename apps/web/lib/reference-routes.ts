import {
  readReferences,
  analyzeReference,
  approveReference,
  publicReferenceReview,
} from "./reference-service";
import { InputError } from "./input-repository";
import { z } from "zod";
import type { InputHttp } from "./inputs-routes";
export async function referenceRoutes(
  r: Request,
  p: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const [root, id, section, item, action] = p;
  if (root !== "shoots" || !id || section !== "references") return null;
  if (p.length === 3 && r.method === "GET")
    return http.ok(await readReferences(owner, id));
  if (p.length === 5 && action === "analyze" && r.method === "POST") {
    const b = z
      .object({ acknowledged: z.boolean() })
      .strict()
      .parse(await http.readJson(r));
    if (!b.acknowledged)
      throw new InputError(
        "ACKNOWLEDGEMENT_REQUIRED",
        "Confirm photo analysis before continuing.",
      );
    try {
      return http.ok(
        publicReferenceReview(await analyzeReference(owner, id, item)),
        201,
      );
    } catch (e) {
      if (e instanceof Error && e.message === "VISION_NOT_CONFIGURED")
        throw new InputError(
          "VISION_NOT_CONFIGURED",
          "Configure OpenAI vision credentials on the server, or select mock mode for an example review.",
          503,
        );
      throw e;
    }
  }
  if (p.length === 4 && r.method === "PATCH")
    return http.ok(
      publicReferenceReview(
        await approveReference(owner, id, item, await http.readJson(r)),
      ),
    );
  return null;
}
