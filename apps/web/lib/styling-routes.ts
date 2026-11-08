import { InputError } from "./input-repository";
import { readStyling, changeStyling } from "./styling-service";
import { renderLightingSvg } from "@framecraft/shared/lighting-svg";
import type { InputHttp } from "./inputs-routes";
export async function stylingRoutes(
  request: Request,
  parts: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  const [root, id, section, view] = parts;
  if (root !== "shoots" || !id || section !== "styling") return null;
  if (parts.length === 3 && request.method === "GET")
    return http.ok(await readStyling(owner, id));
  if (parts.length === 3 && request.method === "POST")
    return http.ok(
      await changeStyling(owner, id, await http.readJson(request)),
      201,
    );
  if (
    parts.length === 4 &&
    request.method === "GET" &&
    view === "export.json"
  ) {
    const data = await readStyling(owner, id);
    if (!data.latest)
      throw new InputError("NOT_READY", "Generate styling first.", 409);
    if (data.stale || !data.sourcesAvailable)
      throw new InputError(
        "STALE_INPUTS",
        "Regenerate current styling and source citations before exporting.",
        409,
      );
    return new Response(
      JSON.stringify(
        {
          schemaVersion: 1,
          styling: data.latest,
          exclusions: ["reference photos", "source books", "consent records"],
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=styling.json",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  if (
    parts.length === 4 &&
    request.method === "GET" &&
    ["top.svg", "side.svg"].includes(view)
  ) {
    const data = await readStyling(owner, id);
    if (!data.latest?.lighting) return http.ok(null, 404);
    return new Response(
      renderLightingSvg(
        data.latest.lighting.scene,
        view === "top.svg" ? "top" : "side",
      ),
      {
        headers: {
          "Content-Type": "image/svg+xml",
          "Content-Disposition": `attachment; filename="lighting-${view}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'none'; sandbox",
        },
      },
    );
  }
  return null;
}
