import { z } from "zod";
import { defaults, shootSchema } from "@framecraft/shared";
import { inputs } from "./inputs-service";
import { store } from "./store";
import type { InputHttp } from "./inputs-routes";
import { InputError } from "./input-repository";
const createSchema = z
  .object({
    kind: z.enum(["POSES", "LIGHTING", "WARDROBE"]),
    name: z.string().trim().min(3).max(120),
    environment: z.enum(["INDOOR", "OUTDOOR"]),
    scene: z.string().trim().min(1).max(120),
    occasion: z.string().max(200),
    lightMode: z.enum(["NATURAL", "ARTIFICIAL", "MIXED"]),
  })
  .strict();
export async function workflowRoutes(
  request: Request,
  parts: string[],
  owner: string,
  http: InputHttp,
): Promise<Response | null> {
  if (parts[0] !== "workflows" || parts.length > 2) return null;
  if (request.method === "GET") {
    const list = (await store.list(owner)).filter((s) => s.workflowKind);
    if (!parts[1]) return http.ok(list);
    const workspace = list.find((s) => s.id === parts[1]);
    if (!workspace)
      throw new InputError("NOT_FOUND", "Workflow not found.", 404);
    return http.ok(workspace);
  }
  if (parts[1] && ["PATCH", "DELETE"].includes(request.method)) {
    const workspace = (await store.list(owner)).find(
      (s) => s.id === parts[1] && s.workflowKind,
    );
    if (!workspace)
      throw new InputError("NOT_FOUND", "Workflow not found.", 404);
    if (request.method === "DELETE")
      return http.ok(await inputs.purge(owner, workspace.id));
    const data = createSchema
      .omit({ kind: true })
      .extend({ baseRevision: z.number().int().positive() })
      .parse(await http.readJson(request));
    const { id, ownerId, revision, createdAt, updatedAt, ...current } =
      workspace;
    void ownerId;
    void revision;
    void createdAt;
    void updatedAt;
    return http.ok(
      await store.save(
        owner,
        {
          ...current,
          name: data.name,
          shootType: data.environment,
          settings: {
            ...current.settings,
            sceneCategory: data.scene,
            occasion: data.occasion,
            lightMode: data.lightMode,
          },
        },
        id,
        data.baseRevision,
      ),
    );
  }
  if (request.method === "POST" && parts.length === 1) {
    const data = createSchema.parse(await http.readJson(request));
    const workspace = await store.save(
      owner,
      shootSchema.parse({
        ...defaults,
        workflowKind: data.kind,
        name: data.name,
        shootType: data.environment,
        portraitCategory: "PORTFOLIO",
        subjectCount: undefined,
        settings: {
          ...defaults.settings,
          sceneCategory: data.scene,
          occasion: data.occasion,
          lightMode: data.lightMode,
        },
      }),
    );
    return http.ok(workspace, 201);
  }
  return null;
}
