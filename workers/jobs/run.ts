import { Worker } from "bullmq";
import IORedis from "ioredis";
import {
  runTask,
  QUEUE_NAME,
  drainLocalQueue,
  queueMode,
} from "../../apps/web/lib/job-queue";
async function main() {
  if (queueMode() === "mock") {
    await drainLocalQueue();
    if (process.argv.includes("--once")) return;
    const timer = setInterval(() => void drainLocalQueue(), 1000);
    process.on("SIGTERM", () => {
      clearInterval(timer);
      process.exit(0);
    });
    return;
  }
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required");
  const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  const worker = new Worker<{ ownerId: string; jobId: string }>(
    QUEUE_NAME,
    async (job) => runTask(job.data.ownerId, job.data.jobId),
    { connection, concurrency: 2 },
  );
  worker.on("failed", () => console.error("task_failed"));
  worker.on("error", () => console.error("worker_connection_error"));
  async function close() {
    await worker.close();
    connection.disconnect();
  }
  process.on("SIGTERM", () => void close());
  process.on("SIGINT", () => void close());
}
main().catch(() => {
  console.error("worker_start_failed");
  process.exitCode = 1;
});
