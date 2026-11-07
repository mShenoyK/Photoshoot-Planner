import { z } from "zod";
import { inputs } from "./inputs-service";
import { canonPreset, equipmentSchema } from "@framecraft/shared/inputs";
import { listKits, saveKit, deleteKit } from "./input-repository";
export type InputHttp = {
  ok: (data: unknown, status?: number, headers?: HeadersInit) => Response;
  readJson: (r: Request) => Promise<unknown>;
};
export async function inputRoutes(
  request: Request,
  parts: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const method = request.method;
  const [root, shootId, section, id, action] = parts;
  if (root === "equipment") {
    if (parts.length > 2) return null;
    if (method === "GET" && !shootId) return http.ok(await listKits(owner));
    if (method === "POST" && shootId === "canon-preset")
      return http.ok(await saveKit(owner, canonPreset), 201);
    if (method === "POST" && !shootId)
      return http.ok(
        await saveKit(
          owner,
          equipmentSchema.parse(await http.readJson(request)),
        ),
        201,
      );
    if (method === "PATCH" && shootId)
      return http.ok(
        await saveKit(
          owner,
          equipmentSchema.parse(await http.readJson(request)),
          shootId,
        ),
      );
    if (method === "DELETE" && shootId)
      return http.ok(await deleteKit(owner, shootId));
    return null;
  }
  if (root !== "shoots" || !shootId || parts.length > 5) return null;
  // IDs are checked before any storage work; every nested action is scoped to its route shoot.
  if (section === "inputs" && parts.length === 3 && method === "GET")
    return http.ok(await inputs.read(owner, shootId));
  if (section === "media-cleanup" && parts.length === 3 && method === "POST")
    return http.ok(await inputs.retryCleanup(owner, shootId));
  if (section === "subjects") {
    if (parts.length === 3 && method === "GET")
      return http.ok((await inputs.read(owner, shootId)).subjects);
    if (parts.length === 3 && method === "POST")
      return http.ok(
        await inputs.saveSubject(owner, shootId, await http.readJson(request)),
        201,
      );
    if (parts.length === 4 && method === "PATCH")
      return http.ok(
        await inputs.saveSubject(
          owner,
          shootId,
          await http.readJson(request),
          id,
        ),
      );
    if (parts.length === 4 && method === "DELETE")
      return http.ok(await inputs.removeSubject(owner, shootId, id));
    if (parts.length === 5 && action === "consents" && method === "POST")
      return http.ok(
        await inputs.consent(owner, shootId, id, await http.readJson(request)),
      );
  }
  if (section === "upload-intents" && parts.length === 3 && method === "POST")
    return http.ok(
      await inputs.intent(owner, shootId, await http.readJson(request)),
      201,
    );
  if (section === "uploads" && parts.length === 4 && method === "PUT")
    return http.ok(await inputs.upload(owner, shootId, id, request));
  if (
    section === "uploads" &&
    parts.length === 5 &&
    action === "complete" &&
    method === "POST"
  )
    return http.ok(await inputs.complete(owner, shootId, id));
  if (section === "media" && parts.length === 4 && method === "DELETE")
    return http.ok(await inputs.removeMedia(owner, shootId, id));
  if (
    section === "media" &&
    parts.length === 5 &&
    action === "download" &&
    method === "GET"
  ) {
    const file = await inputs.download(owner, shootId, id);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }
  if (section === "equipment" && parts.length === 3 && method === "PATCH") {
    const { kitId } = z
      .object({ kitId: z.string().uuid().nullable() })
      .strict()
      .parse(await http.readJson(request));
    return http.ok(await inputs.selectKit(owner, shootId, kitId));
  }
  return null;
}
