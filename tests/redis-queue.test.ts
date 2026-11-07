import { SchematicIllustrator } from "../packages/ai/src/index";
import { inputs } from "../apps/web/lib/inputs-service";
import { listArtifacts } from "../apps/web/lib/artifact-service";
import { blankSubject } from "../packages/shared/src/inputs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { store } from "../apps/web/lib/store";
import { defaults } from "../packages/shared/src/shoot";
import { MockPlanner } from "../packages/ai/src/index";
import { enqueue, runTask, QUEUE_NAME } from "../apps/web/lib/job-queue";
import { getJob } from "../apps/web/lib/knowledge-repository";
import { listPlans } from "../apps/web/lib/planning-service";
const run = process.env.TEST_REDIS_URL ? describe : describe.skip;
run("real local Redis / BullMQ queue", () => {
  let temp: string;
  let owner: string;
  let connection: IORedis;
  let worker: Worker;
  const created: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.TEST_REDIS_URL!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Use a disposable local Redis test target");
    temp = await mkdtemp(path.join(tmpdir(), "framecraft-redis-"));
    process.env.DATA_MODE = "mock";
    process.env.MOCK_DATA_FILE = path.join(temp, "db.json");
    process.env.QUEUE_DRIVER = "bullmq";
    process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.AI_TEXT_PROVIDER = "mock";
    process.env.AI_IMAGE_PROVIDER = "mock";
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = path.join(temp, "objects");
    owner = (
      await store.createUser(
        `redis-${randomUUID()}@example.com`,
        "test-only-unusable-hash",
      )
    ).id;
    connection = new IORedis(process.env.TEST_REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
    worker = new Worker<{ ownerId: string; jobId: string }>(
      QUEUE_NAME,
      async (job) => runTask(job.data.ownerId, job.data.jobId),
      { connection, concurrency: 1 },
    );
    worker.on("error", () => {});
    await worker.waitUntilReady();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (worker) await worker.close();
    if (connection) {
      const queue = new Queue(QUEUE_NAME, { connection });
      for (const id of created) {
        const job = await queue.getJob(id);
        if (job) await job.remove();
      }
      await queue.close();
      connection.disconnect();
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  it("delivers a durable task through Redis and automatically retries a provider failure", async () => {
    const shoot = await store.save(owner, {
      ...defaults,
      name: "Redis worker smoke",
    });
    const original = MockPlanner.prototype.generateStructuredPlan;
    let failed = false;
    vi.spyOn(
      MockPlanner.prototype,
      "generateStructuredPlan",
    ).mockImplementation(async function (this: MockPlanner, input) {
      if (!failed) {
        failed = true;
        throw new Error("SIMULATED_PROVIDER_FAILURE");
      }
      return original.call(this, input);
    });
    const job = await enqueue(
      owner,
      "PLAN",
      "redis-retry-" + randomUUID(),
      { poseCount: 2, useKnowledgeBase: false },
      shoot!.id,
    );
    created.push(job.id);
    await expect
      .poll(async () => (await getJob(owner, job.id)).status, {
        timeout: 15000,
      })
      .toBe("SUCCEEDED");
    expect((await getJob(owner, job.id)).attempts).toBe(2);
    expect(await listPlans(owner, shoot!.id)).toHaveLength(1);
  });
  it("retries original illustration failure through real Redis then commits an export", async () => {
    const shoot = await store.save(owner, {
      ...defaults,
      name: "Redis original artifact",
    });
    await inputs.saveSubject(owner, shoot!.id, {
      ...blankSubject,
      label: "Adult",
      ageGroup: "ADULT",
    });
    const planning = await enqueue(
      owner,
      "PLAN",
      randomUUID(),
      { poseCount: 1, useKnowledgeBase: false },
      shoot!.id,
    );
    created.push(planning.id);
    await expect
      .poll(async () => (await getJob(owner, planning.id)).status, {
        timeout: 15000,
      })
      .toBe("SUCCEEDED");
    const p = (await listPlans(owner, shoot!.id))[0];
    const original = SchematicIllustrator.prototype.generate;
    let failed = false;
    vi.spyOn(SchematicIllustrator.prototype, "generate").mockImplementation(
      async function (this: SchematicIllustrator, input) {
        if (!failed) {
          failed = true;
          throw new Error("SIMULATED_IMAGE_OUTAGE");
        }
        return original.call(this, input);
      },
    );
    const image = await enqueue(
      owner,
      "ILLUSTRATE",
      randomUUID(),
      { planId: p.id, format: "ILLUSTRATION", poseId: p.poses[0].id },
      shoot!.id,
    );
    created.push(image.id);
    await expect
      .poll(async () => (await getJob(owner, image.id)).status, {
        timeout: 15000,
      })
      .toBe("SUCCEEDED");
    expect((await getJob(owner, image.id)).attempts).toBe(2);
    const exported = await enqueue(
      owner,
      "EXPORT",
      randomUUID(),
      { planId: p.id, format: "ZIP" },
      shoot!.id,
    );
    created.push(exported.id);
    await expect
      .poll(async () => (await getJob(owner, exported.id)).status, {
        timeout: 15000,
      })
      .toBe("SUCCEEDED");
    expect(await listArtifacts(owner, shoot!.id)).toHaveLength(2);
  });
});
