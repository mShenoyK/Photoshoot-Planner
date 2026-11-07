import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Shoot, ShootInput } from "@framecraft/shared";
type User = { id: string; email: string; passwordHash: string };
export type Data = {
  corpora?: Record<string, import("@framecraft/shared/knowledge").Corpus>;
  jobs?: import("@framecraft/shared/knowledge").TaskJob[];
  users: User[];
  shoots: Shoot[];
  workspaces?: Record<string, import("@framecraft/shared/inputs").InputState>;
  kits?: import("@framecraft/shared/inputs").CameraKit[];
};
const globalDb = globalThis as typeof globalThis & { prisma?: PrismaClient };
export function database(): PrismaClient {
  return (globalDb.prisma ??= new PrismaClient());
}
export function mockMode() {
  const mock = process.env.DATA_MODE === "mock";
  if (mock && process.env.NODE_ENV === "production")
    throw new Error("Demo persistence is forbidden in production");
  return mock;
}
const file = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.MOCK_DATA_FILE ??
      ".data/framecraft.json",
  );
let pending: Promise<unknown> = Promise.resolve();
export async function local<T>(fn: (d: Data) => T | Promise<T>): Promise<T> {
  const run = pending.then(async () => {
    let d: Data;
    try {
      d = JSON.parse(
        await readFile(/* turbopackIgnore: true */ file(), "utf8"),
      ) as Data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      d = { users: [], shoots: [] };
    }
    const result = await fn(d);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(d), { mode: 0o600 });
    await rename(file() + ".tmp", file());
    return result;
  });
  pending = run.catch(() => {});
  return run;
}
export class Conflict extends Error {}
export const store = {
  async user(email: string) {
    return mockMode()
      ? local((d) => d.users.find((u) => u.email === email) ?? null)
      : database().user.findUnique({ where: { email } });
  },
  async createUser(email: string, passwordHash: string) {
    if (mockMode())
      return local((d) => {
        if (d.users.some((u) => u.email === email)) throw new Conflict();
        const u = { id: randomUUID(), email, passwordHash };
        d.users.push(u);
        return u;
      });
    return database().user.create({ data: { email, passwordHash } });
  },
  async list(ownerId: string): Promise<Shoot[]> {
    if (mockMode())
      return local((d) =>
        d.shoots
          .filter((s) => s.ownerId === ownerId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    const rows = await database().shoot.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(
      (r: {
        data: unknown;
        id: string;
        ownerId: string;
        revision: number;
        createdAt: Date;
        updatedAt: Date;
      }) => ({
        ...(r.data as ShootInput),
        id: r.id,
        ownerId: r.ownerId,
        revision: r.revision,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }),
    );
  },
  async save(
    ownerId: string,
    input: ShootInput,
    id?: string,
    revision?: number,
  ): Promise<Shoot | null> {
    if (mockMode())
      return local((d) => {
        const old = id
          ? d.shoots.find((s) => s.id === id && s.ownerId === ownerId)
          : undefined;
        if (id && !old) return null;
        if (old && old.revision !== revision) throw new Conflict();
        const s = {
          ...input,
          id: old?.id ?? randomUUID(),
          ownerId,
          revision: (old?.revision ?? 0) + 1,
          createdAt: old?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        d.shoots = d.shoots.filter((s) => s.id !== old?.id);
        d.shoots.push(s);
        return s;
      });
    if (id) {
      const result = await database().shoot.updateMany({
        where: { id, ownerId, revision, deletedAt: null },
        data: { name: input.name, data: input, revision: { increment: 1 } },
      });
      if (!result.count) {
        const exists = await database().shoot.findFirst({
          where: { id, ownerId, deletedAt: null },
        });
        if (exists) throw new Conflict();
        return null;
      }
    } else {
      const r = await database().shoot.create({
        data: { ownerId, name: input.name, data: input },
      });
      id = r.id;
    }
    return (await this.list(ownerId)).find((s) => s.id === id) ?? null;
  },
  async remove(ownerId: string, id: string) {
    if (mockMode())
      return local((d) => {
        const exists = d.shoots.some(
          (s) => s.ownerId === ownerId && s.id === id,
        );
        d.shoots = d.shoots.filter(
          (s) => !(s.ownerId === ownerId && s.id === id),
        );
        if (d.workspaces) delete d.workspaces[id];
        return exists;
      });
    return (
      (
        await database().shoot.updateMany({
          where: { id, ownerId, deletedAt: null },
          data: { deletedAt: new Date() },
        })
      ).count > 0
    );
  },
};
