import { enqueue } from "../apps/web/lib/job-queue";
import {
  createArtifact,
  downloadArtifact,
  listArtifacts,
} from "../apps/web/lib/artifact-service";
import { generatePlan } from "../apps/web/lib/planning-service";
import { defaults } from "../packages/shared/src/shoot";
import { changeStyling, readStyling } from "../apps/web/lib/styling-service";
import { beforeAll, afterAll, it, expect, describe, vi } from "vitest";
import pg from "pg";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as foundation from "../apps/web/lib/store";
import {
  withShoot,
  listKits,
  saveKit,
  type SqlTransaction,
} from "../apps/web/lib/input-repository";
import { inputs } from "../apps/web/lib/inputs-service";
import {
  ingestSource,
  processIngestion,
  documentDetail,
  reviewChunk,
  searchKnowledge,
} from "../apps/web/lib/knowledge-service";
import { blankSubject, canonPreset } from "../packages/shared/src/inputs";
// This suite deliberately refuses the user's external DB. It creates tables only in a disposable local test DB.
const connection = process.env.TEST_SQL_DATABASE_URL;
const suite = connection ? describe : describe.skip;
suite(
  "PostgreSQL input repository (real SQL; pg transport substituted for blocked Prisma engine)",
  () => {
    let pool: pg.Pool;
    let temp: string;
    const owner = randomUUID(),
      other = randomUUID(),
      shoot = randomUUID();
    function sql(client: pg.Pool | pg.PoolClient): SqlTransaction {
      function text(strings: TemplateStringsArray) {
        return strings.reduce(
          (all, part, i) => all + (i ? "$" + i : "") + part,
          "",
        );
      }
      return {
        $queryRaw: async <T>(
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => (await client.query(text(strings), values)).rows as T,
        $executeRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => (await client.query(text(strings), values)).rowCount ?? 0,
      };
    }
    beforeAll(async () => {
      const url = new URL(connection!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.pathname.startsWith("/framecraft_test_")
      )
        throw new Error(
          "Requires a disposable local framecraft_test_* database",
        );
      pool = new pg.Pool({ connectionString: connection, max: 4 });
      for (const name of [
        "202611070001_foundation",
        "202611070002_inputs",
        "202611070003_knowledge_plans",
      ])
        await pool.query(
          await readFile(
            `packages/database/prisma/migrations/${name}/migration.sql`,
            "utf8",
          ),
        );
      await pool.query(
        'INSERT INTO "User" ("id","email","passwordHash") VALUES ($1,$2,$3),($4,$5,$3)',
        [
          owner,
          "sql-a@example.com",
          "test-only-unusable-hash",
          other,
          "sql-b@example.com",
        ],
      );
      await pool.query(
        'INSERT INTO "Shoot" ("id","ownerId","name","data","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
        [shoot, owner, "SQL test", "{}"],
      );
      temp = await mkdtemp(path.join(tmpdir(), "framecraft-sql-"));
      process.env.DATA_MODE = "postgres";
      process.env.KNOWLEDGE_ADMIN_EMAILS = "sql-a@example.com";
      process.env.STORAGE_DRIVER = "local";
      process.env.STORAGE_LOCAL_DIR = path.join(temp, "objects");
      const adapter = {
        ...sql(pool),
        $transaction: async <T>(
          callback: (tx: SqlTransaction) => Promise<T>,
        ) => {
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const result = await callback(sql(client));
            await client.query("COMMIT");
            return result;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          } finally {
            client.release();
          }
        },
      };
      vi.spyOn(foundation, "database").mockReturnValue(
        adapter as ReturnType<typeof foundation.database>,
      );
    });
    afterAll(async () => {
      vi.restoreAllMocks();
      if (pool) await pool.end();
      if (temp) await rm(temp, { recursive: true, force: true });
    });
    it("persists mixed-age subjects through parameterized SQL and denies foreign owners", async () => {
      await inputs.saveSubject(owner, shoot, {
        ...blankSubject,
        label: "Parent",
        ageGroup: "ADULT",
      });
      await inputs.saveSubject(owner, shoot, {
        ...blankSubject,
        label: "Child",
        ageGroup: "CHILD",
      });
      expect(
        (await inputs.read(owner, shoot)).subjects.map((s) => s.ageGroup),
      ).toEqual(["ADULT", "CHILD"]);
      await expect(inputs.read(other, shoot)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        inputs.saveSubject(other, shoot, {
          ...blankSubject,
          label: "Intruder",
          ageGroup: "ADULT",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("serializes concurrent consent transactions on the shoot row", async () => {
      let release!: () => void;
      let entered!: () => void;
      let secondStarted = false;
      const latch = new Promise<void>((resolve) => (release = resolve));
      const start = new Promise<void>((resolve) => (entered = resolve));
      const first = withShoot(owner, shoot, async (state) => {
        entered();
        await latch;
        state.subjects[0].fitComfort = "First transaction persisted";
      });
      await start;
      const second = withShoot(owner, shoot, (state) => {
        secondStarted = true;
        expect(state.subjects[0].fitComfort).toBe(
          "First transaction persisted",
        );
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(secondStarted).toBe(false);
      release();
      await Promise.all([first, second]);
    });
    it("ingests reviewed private guidance into real PostgreSQL full-text search and isolates other owners", async () => {
      const metadata = {
        title: "Local SQL portrait guide",
        licenseStatus: "OWNED",
        ingestionPermitted: true,
        allowDerivedUse: true,
        allowPrivateReview: true,
        allowPrivateVision: false,
        taxonomy: {
          environments: ["OUTDOOR"],
          ageGroups: [],
          minSubjects: 1,
          maxSubjects: 6,
          topics: ["POSE"],
        },
      };
      const result = await ingestSource(
        owner,
        metadata,
        Buffer.from(
          "# Comfortable family portraits\nKeep young children secure and allow space around seated relatives while composing the photograph.",
        ),
        "sql-guide.md",
        "text/markdown",
      );
      await processIngestion(owner, result.document.id);
      const doc = await documentDetail(owner, result.document.id);
      const chunk = doc.chunks[0];
      await reviewChunk(owner, doc.id, chunk.id, {
        summary:
          "For outdoor family portraits, prioritize comfortable support and a clear view of every person.",
        reviewStatus: "APPROVED",
        baseRevision: chunk.revision,
        taxonomy: chunk.taxonomy,
      });
      const hits = await searchKnowledge(owner, {
        query: "family portraits",
        filters: { environment: "OUTDOOR", subjectCount: 4 },
      });
      expect(hits[0].sourceReference.documentId).toBe(doc.id);
      expect(hits[0].relevanceScore).toBeGreaterThan(0);
      expect(
        await searchKnowledge(other, { query: "family portraits" }),
      ).toEqual([]);
      const rows = await pool.query(
        'SELECT "chunkId" FROM "KnowledgeSearchIndex" WHERE "searchVector" @@ plainto_tsquery(\'english\', $1) AND "ownerId"=$2',
        ["family portrait", owner],
      );
      expect(rows.rowCount).toBe(1);
    });
    it("isolates equipment and snapshots it into the authorized shoot", async () => {
      const kit = await saveKit(owner, canonPreset);
      expect(await listKits(other)).toEqual([]);
      await inputs.selectKit(owner, shoot, kit.id);
      expect((await inputs.read(owner, shoot)).cameraKit?.body).toBe(
        "Canon EOS R6 Mark II",
      );
      await expect(
        inputs.selectKit(other, shoot, kit.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
    it("persists styling versions and serializes competing revisions through the SQL row lock", async () => {
      await pool.query('UPDATE "Shoot" SET "data"=$1::jsonb WHERE "id"=$2', [
        JSON.stringify({
          ...defaults,
          subjectCount: 2,
          portraitCategory: "PORTRAIT_GROUP",
        }),
        shoot,
      ]);
      const a = await changeStyling(owner, shoot, {
        action: "WARDROBE",
        baseRevision: 0,
      });
      expect(a.latest!.wardrobe!.looks).toHaveLength(2);
      const results = await Promise.allSettled([
        changeStyling(owner, shoot, {
          action: "LIGHTING",
          baseRevision: 1,
          recipe: "CONTEXT",
        }),
        changeStyling(owner, shoot, { action: "WARDROBE", baseRevision: 1 }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await readStyling(owner, shoot)).versions).toHaveLength(2);
      await expect(readStyling(other, shoot)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    it("persists immutable artifact metadata with actual SQL and rejects foreign downloads", async () => {
      const generated = await generatePlan(owner, shoot, randomUUID(), {
        poseCount: 2,
        useKnowledgeBase: false,
      });
      const id = randomUUID();
      const job = {
        id,
        ownerId: owner,
        shootId: shoot,
        kind: "EXPORT" as const,
        status: "RUNNING" as const,
        progress: 10,
        attempts: 1,
        input: { planId: generated.planId, format: "MARKDOWN" },
        idempotencyKey: randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await createArtifact(owner, job);
      await createArtifact(owner, job);
      expect(await listArtifacts(owner, shoot)).toHaveLength(1);
      expect(
        Buffer.from(
          (await downloadArtifact(owner, shoot, id)).bytes,
        ).toString(),
      ).toContain("Creative brief");
      await expect(downloadArtifact(other, shoot, id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    it("executes durable SQL-backed plans inline without a Redis worker", async () => {
      const prior = process.env.QUEUE_DRIVER;
      process.env.QUEUE_DRIVER = "inline";
      try {
        const job = await enqueue(
          owner,
          "PLAN",
          randomUUID(),
          { poseCount: 2, useKnowledgeBase: false },
          shoot,
        );
        expect(job.status).toBe("SUCCEEDED");
        expect(job.result?.planId).toBeTruthy();
      } finally {
        if (prior === undefined) delete process.env.QUEUE_DRIVER;
        else process.env.QUEUE_DRIVER = prior;
      }
    });
  },
);
