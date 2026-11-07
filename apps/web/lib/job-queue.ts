import { createArtifact } from "./artifact-service";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { TaskJob } from "@framecraft/shared/knowledge";
import {
  withJobs,
  getJob,
  queuedJobs,
  withCorpus,
} from "./knowledge-repository";
import {
  processIngestion,
  embedDocument,
  findDocument,
} from "./knowledge-service";
import { generatePlan } from "./planning-service";
import { InputError, withShoot } from "./input-repository";
import { mockMode } from "./store";
export const QUEUE_NAME = "framecraft-tasks";
export function queueMode() {
  const mode = process.env.QUEUE_DRIVER ?? (mockMode() ? "mock" : "inline");
  if (mode === "mock" && !mockMode())
    throw new InputError(
      "QUEUE_CONFIG",
      "In-process queue is restricted to local mock mode.",
      503,
    );
  if (!["mock", "bullmq", "inline"].includes(mode))
    throw new InputError("QUEUE_CONFIG", "Unknown queue driver.", 503);
  return mode;
}
export async function dispatch(job: TaskJob) {
  if (queueMode() === "inline") {
    try {
      await runTask(job.ownerId, job.id);
    } catch (e) {
      const recorded = await getJob(job.ownerId, job.id);
      if (recorded.status !== "FAILED") throw e;
    }
    return;
  }
  if (queueMode() === "mock") {
    if (process.env.MOCK_QUEUE_AUTO_RUN !== "false")
      setTimeout(() => {
        void runTask(job.ownerId, job.id).catch(() => {});
      }, 25);
    return;
  }
  if (!process.env.REDIS_URL)
    throw new InputError(
      "QUEUE_CONFIG",
      "Configure REDIS_URL for the worker queue.",
      503,
    );
  const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  connection.on("error", () => {});
  try {
    await connection.connect();
  } catch (error) {
    connection.disconnect();
    throw error;
  }
  const queue = new Queue(QUEUE_NAME, { connection });
  try {
    const existing = await queue.getJob(job.id);
    if (existing && (await existing.getState()) === "failed")
      await existing.retry();
    else if (!existing)
      await queue.add(
        "task",
        { ownerId: job.ownerId, jobId: job.id },
        {
          jobId: job.id,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      );
  } finally {
    await queue.close();
    connection.disconnect();
  }
}
export async function enqueue(
  owner: string,
  kind: TaskJob["kind"],
  idempotencyKey: string,
  input: Record<string, unknown>,
  shootId?: string,
) {
  if (shootId) await withShoot(owner, shootId, () => true);
  const result = await withJobs(owner, (jobs) => {
    const existing = jobs.find(
      (j) => j.kind === kind && j.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (
        existing.shootId !== shootId ||
        JSON.stringify(existing.input) !== JSON.stringify(input)
      )
        throw new InputError(
          "IDEMPOTENCY_CONFLICT",
          "Use a new key for a different request.",
          409,
        );
      return { job: structuredClone(existing), created: false };
    }
    if (
      jobs.filter((j) => ["QUEUED", "RUNNING"].includes(j.status)).length >=
        10 ||
      jobs.length >= 200
    )
      throw new InputError("JOB_LIMIT", "Too many jobs in this account.", 429);
    const job: TaskJob = {
      id: randomUUID(),
      ownerId: owner,
      shootId,
      kind,
      input,
      idempotencyKey,
      status: "QUEUED",
      progress: 0,
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    jobs.push(job);
    return { job: structuredClone(job), created: true };
  });
  if (result.created)
    try {
      await dispatch(result.job);
    } catch {
      await withJobs(owner, (jobs) => {
        const j = jobs.find((j) => j.id === result.job.id)!;
        j.status = "FAILED";
        j.errorCode = "QUEUE_UNAVAILABLE";
      });
      return getJob(owner, result.job.id);
    }
  return queueMode() === "inline" ? getJob(owner, result.job.id) : result.job;
}
export async function runTask(owner: string, id: string) {
  const claimed = await withJobs(owner, (jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (
      !job ||
      ["SUCCEEDED", "CANCELLED"].includes(job.status) ||
      job.attempts >= 3 ||
      (job.status === "RUNNING" && (job.leaseUntil ?? 0) > Date.now())
    )
      return null;
    job.status = "RUNNING";
    job.attempts++;
    job.progress = 10;
    job.leaseUntil = Date.now() + 300000;
    job.updatedAt = new Date().toISOString();
    delete job.errorCode;
    return structuredClone(job);
  });
  if (!claimed) return;
  try {
    let result: Record<string, unknown>;
    if (claimed.kind === "INGEST")
      result = await processIngestion(
        owner,
        String(claimed.input.documentId),
        claimed.id,
      );
    else if (claimed.kind === "EMBED")
      result = await embedDocument(owner, String(claimed.input.documentId));
    else if (claimed.kind === "ILLUSTRATE" || claimed.kind === "EXPORT")
      result = await createArtifact(owner, claimed);
    else {
      if (!claimed.shootId)
        throw new InputError("INVALID_JOB", "Missing shoot.");
      result = await generatePlan(owner, claimed.shootId, claimed.id, {
        poseCount: Number(claimed.input.poseCount),
        useKnowledgeBase: claimed.input.useKnowledgeBase === true,
        section:
          typeof claimed.input.section === "string"
            ? claimed.input.section
            : undefined,
        baseVersion:
          typeof claimed.input.baseVersion === "number"
            ? claimed.input.baseVersion
            : undefined,
      });
    }
    if (process.env.NODE_ENV !== "test")
      console.info(
        JSON.stringify({
          event: "task_complete",
          jobId: id,
          kind: claimed.kind,
          attempt: claimed.attempts,
        }),
      );
    await withJobs(owner, (jobs) => {
      const job = jobs.find((j) => j.id === id)!;
      job.status = "SUCCEEDED";
      job.progress = 100;
      job.result = result;
      job.updatedAt = new Date().toISOString();
      delete job.leaseUntil;
    });
  } catch (error) {
    const code =
      error instanceof InputError
        ? error.code
        : error instanceof Error &&
            [
              "TEXT_PROVIDER_NOT_CONFIGURED",
              "IMAGE_PROVIDER_NOT_CONFIGURED",
              "EXPORT_INPUT_LIMIT",
              "EXPORT_PAGE_LIMIT",
              "EMBEDDING_PROVIDER_NOT_CONFIGURED",
              "PDF_PAGE_LIMIT",
              "INVALID_MARKDOWN",
              "CHUNK_LIMIT",
              "INVALID_PDF",
            ].includes(error.message)
          ? error.message
          : "TASK_FAILED";
    if (process.env.NODE_ENV !== "test")
      console.warn(
        JSON.stringify({
          event: "task_failed",
          jobId: id,
          kind: claimed.kind,
          attempt: claimed.attempts,
          code,
        }),
      );
    await withJobs(owner, (jobs) => {
      const job = jobs.find((j) => j.id === id)!;
      job.status =
        queueMode() === "bullmq" && job.attempts < 3 ? "QUEUED" : "FAILED";
      job.errorCode = code;
      job.progress = 0;
      job.updatedAt = new Date().toISOString();
      delete job.leaseUntil;
    });
    if (claimed.kind === "INGEST" && code !== "KNOWLEDGE_BUSY")
      await withCorpus(
        owner,
        (c) => {
          try {
            const doc = findDocument(
              c.documents,
              String(claimed.input.documentId),
            );
            doc.status = "FAILED";
            doc.errorCode = code;
          } catch {
            /* The source may have been deleted while this job failed. */
          }
        },
        true,
      );
    throw new InputError(
      code,
      "Background task failed. Review inputs and retry.",
      503,
    );
  }
}
export async function retryTask(owner: string, id: string) {
  const job = await getJob(owner, id);
  const abandoned =
    queueMode() === "inline" &&
    ((job.status === "QUEUED" &&
      Date.now() - Date.parse(job.updatedAt) > 60000) ||
      (job.status === "RUNNING" && (job.leaseUntil ?? 0) < Date.now()));
  if ((!abandoned && job.status !== "FAILED") || job.attempts >= 3)
    throw new InputError(
      "RETRY_UNAVAILABLE",
      "Only failed jobs with attempts remaining can be retried.",
      409,
    );
  await withJobs(owner, (jobs) => {
    const j = jobs.find((j) => j.id === id)!;
    j.status = "QUEUED";
    j.progress = 0;
    delete j.errorCode;
  });
  const next = await getJob(owner, id);
  try {
    await dispatch(next);
  } catch {
    await withJobs(owner, (jobs) => {
      const j = jobs.find((j) => j.id === id)!;
      j.status = "FAILED";
      j.errorCode = "QUEUE_UNAVAILABLE";
    });
  }
  return getJob(owner, id);
}
export async function drainLocalQueue() {
  for (const job of await queuedJobs())
    await runTask(job.ownerId, job.id).catch(() => {});
}
export function publicJob(job: TaskJob) {
  const { input, ownerId, leaseUntil, ...data } = job;
  void input;
  void ownerId;
  void leaseUntil;
  return data;
}
