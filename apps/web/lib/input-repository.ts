import type { Shoot, ShootInput } from "@framecraft/shared";
import { randomUUID } from "node:crypto";
import {
  emptyInputs,
  type InputState,
  type CameraKit,
  equipmentSchema,
} from "@framecraft/shared/inputs";
import { database, local, mockMode } from "./store";
import type { z } from "zod";
export class InputError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type SqlTransaction = {
  $queryRaw<T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
};
export async function withShoot<T>(
  owner: string,
  shootId: string,
  fn: (state: InputState, shoot: Shoot) => Promise<T> | T,
  allowDeleting = false,
): Promise<T> {
  const run = async (state: InputState, shoot: Shoot) => {
    if (state.deleting && !allowDeleting)
      throw new InputError("NOT_FOUND", "Shoot not found.", 404);
    return fn(state, shoot);
  };
  if (mockMode())
    return local(async (d) => {
      if (!d.shoots.some((s) => s.id === shootId && s.ownerId === owner))
        throw new InputError("NOT_FOUND", "Shoot not found.", 404);
      d.workspaces ??= {};
      const state = (d.workspaces[shootId] ??= emptyInputs());
      return run(
        state,
        d.shoots.find((s) => s.id === shootId && s.ownerId === owner)!,
      );
    });
  return database().$transaction(
    async (tx: SqlTransaction) => {
      const found = await tx.$queryRaw<
        {
          id: string;
          ownerId: string;
          data: ShootInput;
          revision: number;
          createdAt: Date;
          updatedAt: Date;
        }[]
      >`SELECT "id","ownerId","data","revision","createdAt","updatedAt" FROM "Shoot" WHERE "id"=${shootId} AND "ownerId"=${owner} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!found.length)
        throw new InputError("NOT_FOUND", "Shoot not found.", 404);
      const rows = await tx.$queryRaw<
        { data: InputState }[]
      >`SELECT "data" FROM "ShootWorkspace" WHERE "shootId"=${shootId}`;
      const state = rows[0]?.data ?? emptyInputs();
      const row = found[0];
      const result = await run(state, {
        ...row.data,
        id: row.id,
        ownerId: row.ownerId,
        revision: row.revision,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      await tx.$executeRaw`INSERT INTO "ShootWorkspace" ("shootId","data","updatedAt") VALUES (${shootId},${JSON.stringify(state)}::jsonb,NOW()) ON CONFLICT ("shootId") DO UPDATE SET "data"=EXCLUDED."data","updatedAt"=NOW()`;
      return result;
    },
    { timeout: 60000 },
  );
}
export async function listKits(owner: string): Promise<CameraKit[]> {
  if (mockMode())
    return local((d) => (d.kits ?? []).filter((k) => k.ownerId === owner));
  const rows = (await database()
    .$queryRaw`SELECT "id","ownerId","data" FROM "CameraKit" WHERE "ownerId"=${owner}`) as {
    id: string;
    ownerId: string;
    data: z.infer<typeof equipmentSchema>;
  }[];
  return rows.map((r) => ({ ...r.data, id: r.id, ownerId: r.ownerId }));
}
export async function saveKit(
  owner: string,
  input: z.infer<typeof equipmentSchema>,
  id?: string,
): Promise<CameraKit> {
  const kit = { ...input, id: id ?? randomUUID(), ownerId: owner };
  if (mockMode())
    return local((d) => {
      d.kits ??= [];
      if (id && !d.kits.some((k) => k.id === id && k.ownerId === owner))
        throw new InputError("NOT_FOUND", "Camera kit not found.", 404);
      d.kits = d.kits.filter((k) => k.id !== kit.id);
      d.kits.push(kit);
      return kit;
    });
  if (id) {
    const count = await database()
      .$executeRaw`UPDATE "CameraKit" SET "name"=${input.name},"data"=${JSON.stringify(input)}::jsonb WHERE "id"=${id} AND "ownerId"=${owner}`;
    if (!count) throw new InputError("NOT_FOUND", "Camera kit not found.", 404);
  } else
    await database()
      .$executeRaw`INSERT INTO "CameraKit" ("id","ownerId","name","data") VALUES (${kit.id},${owner},${input.name},${JSON.stringify(input)}::jsonb)`;
  return kit;
}
export async function deleteKit(owner: string, id: string) {
  if (mockMode())
    return local((d) => {
      const k = d.kits?.find((k) => k.id === id && k.ownerId === owner);
      if (!k) throw new InputError("NOT_FOUND", "Camera kit not found.", 404);
      d.kits = d.kits!.filter((k) => k.id !== id);
      return { deleted: true };
    });
  const n = await database()
    .$executeRaw`DELETE FROM "CameraKit" WHERE "id"=${id} AND "ownerId"=${owner}`;
  if (!n) throw new InputError("NOT_FOUND", "Camera kit not found.", 404);
  return { deleted: true };
}
