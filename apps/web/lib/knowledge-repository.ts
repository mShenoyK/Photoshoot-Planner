import type { Corpus, TaskJob } from "@framecraft/shared/knowledge";
import { eligible, reference } from "@framecraft/knowledge";
import { database, local, mockMode } from "./store";
import { InputError, type SqlTransaction } from "./input-repository";
export async function assertKnowledgeAdmin(owner: string) {
  const user = mockMode()
    ? await local((d) => d.users.find((u) => u.id === owner))
    : (
        (await database()
          .$queryRaw`SELECT "email" FROM "User" WHERE "id"=${owner}`) as {
          email: string;
        }[]
      )[0];
  if (!user) throw new InputError("UNAUTHORIZED", "Sign in to continue.", 401);
  const allowed = (process.env.KNOWLEDGE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (!mockMode() && !allowed.includes(user.email.toLowerCase()))
    throw new InputError(
      "ADMIN_REQUIRED",
      "Private knowledge ingestion requires a configured administrator.",
      403,
    );
}
export async function withCorpus<T>(
  owner: string,
  fn: (corpus: Corpus, tx?: SqlTransaction) => T | Promise<T>,
  write = false,
): Promise<T> {
  if (mockMode())
    return local(async (d) => {
      if (!d.users.some((u) => u.id === owner))
        throw new InputError("UNAUTHORIZED", "Sign in to continue.", 401);
      d.corpora ??= {};
      const c = (d.corpora[owner] ??= {
        documents: [],
        revision: 0,
        leases: [],
      });
      const result = await fn(c);
      if (write) c.revision++;
      return result;
    });
  return database().$transaction(
    async (tx: SqlTransaction) => {
      const users = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "User" WHERE "id"=${owner} FOR UPDATE`;
      if (!users.length)
        throw new InputError("UNAUTHORIZED", "Sign in to continue.", 401);
      const rows = await tx.$queryRaw<
        { data: Corpus }[]
      >`SELECT "data" FROM "KnowledgeWorkspace" WHERE "ownerId"=${owner}`;
      const c = rows[0]?.data ?? { documents: [], revision: 0, leases: [] };
      const result = await fn(c, tx);
      if (write) {
        c.revision++;
        await tx.$executeRaw`INSERT INTO "KnowledgeWorkspace" ("ownerId","data") VALUES (${owner},${JSON.stringify(c)}::jsonb) ON CONFLICT ("ownerId") DO UPDATE SET "data"=EXCLUDED."data"`;
        const index = c.documents.flatMap((doc) =>
          doc.chunks
            .filter((chunk) => eligible(doc, chunk))
            .map((chunk) => ({
              ownerId: owner,
              chunkId: chunk.id,
              documentId: doc.id,
              summary: `${doc.title} ${chunk.summary}`,
              metadata: reference(doc, chunk),
              vector: chunk.embedding ?? null,
            })),
        );
        await tx.$executeRaw`DELETE FROM "KnowledgeSearchIndex" WHERE "ownerId"=${owner}`;
        if (index.length)
          await tx.$executeRaw`INSERT INTO "KnowledgeSearchIndex" ("ownerId","chunkId","documentId","summary","metadata","vector") SELECT r."ownerId",r."chunkId",r."documentId",r."summary",r."metadata",r."vector" FROM jsonb_to_recordset(${JSON.stringify(index)}::jsonb) AS r("ownerId" text,"chunkId" text,"documentId" text,"summary" text,"metadata" jsonb,"vector" jsonb)`;
      }
      return result;
    },
    { timeout: 60000 },
  );
}
export function assertCorpusMutable(c: Corpus) {
  c.leases = c.leases.filter((l) => l.expiresAt > Date.now());
  if (c.leases.length)
    throw new InputError(
      "KNOWLEDGE_BUSY",
      "A plan is using this knowledge snapshot. Retry after generation finishes.",
      409,
    );
}
export async function withJobs<T>(
  owner: string,
  fn: (jobs: TaskJob[]) => T | Promise<T>,
): Promise<T> {
  if (mockMode())
    return local(async (d) => {
      d.jobs ??= [];
      const own = d.jobs.filter((j) => j.ownerId === owner);
      const result = await fn(own);
      d.jobs = [...d.jobs.filter((j) => j.ownerId !== owner), ...own];
      return result;
    });
  return database().$transaction(async (tx: SqlTransaction) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${owner} FOR UPDATE`;
    const rows = await tx.$queryRaw<
      { data: TaskJob }[]
    >`SELECT "data" FROM "TaskJob" WHERE "ownerId"=${owner}`;
    const jobs = rows.map((r) => r.data);
    const result = await fn(jobs);
    for (const job of jobs)
      await tx.$executeRaw`INSERT INTO "TaskJob" ("id","ownerId","shootId","kind","idempotencyKey","status","data") VALUES (${job.id},${owner},${job.shootId ?? null},${job.kind},${job.idempotencyKey},${job.status},${JSON.stringify(job)}::jsonb) ON CONFLICT ("id") DO UPDATE SET "status"=EXCLUDED."status","data"=EXCLUDED."data"`;
    return result;
  });
}
export async function queuedJobs(): Promise<TaskJob[]> {
  if (mockMode())
    return local((d) =>
      (d.jobs ?? []).filter(
        (j) =>
          j.status === "QUEUED" ||
          (j.status === "RUNNING" && (j.leaseUntil ?? 0) < Date.now()),
      ),
    );
  const rows = (await database()
    .$queryRaw`SELECT "data" FROM "TaskJob" WHERE "status" IN ('QUEUED','RUNNING')`) as {
    data: TaskJob;
  }[];
  return rows
    .map((r) => r.data)
    .filter((j) => j.status === "QUEUED" || (j.leaseUntil ?? 0) < Date.now());
}
export async function getJob(owner: string, id: string) {
  return withJobs(owner, (jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) throw new InputError("NOT_FOUND", "Job not found.", 404);
    return structuredClone(job);
  });
}
