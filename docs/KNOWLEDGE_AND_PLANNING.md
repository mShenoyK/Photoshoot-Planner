# Run and review the knowledge / plan milestone

## No-service local workflow

```sh
pnpm install --frozen-lockfile
DATA_MODE=mock pnpm dev
```

Register a test account, create a brief, then use **Private knowledge library** from the dashboard. Only ingest sources you have assessed permission to use. Check derived-use permission if you intend reviewed original guidance to enter plans. Approve a paraphrased chunk; merely uploading a source does not make its text eligible. For PDFs without text, explicitly permit private page review, open a thumbnail, write an original page-linked card and approve it. The mock vision button supplies a review reminder, not OCR or invented visual observations.

Open **Plan & Pose Studio** from a saved brief. Create actual profiles for exact-person plans; missing profiles get a labeled generic fallback, and a stated count that conflicts with profile count is rejected. All current generation uses manual profiles, not photographs. Generate, edit, save a new version, approve, lock a section and regenerate another. Old versions remain available through history. Pose Studio filters by title, framing and written direction.

## Optional local vectors

Set ENABLE_EMBEDDINGS=true and AI_EMBEDDINGS_PROVIDER=mock, then queue indexing for approved summaries. Local mock vectors are deterministic hash features, not a paid semantic model. Keyword retrieval remains available with the flag off. No native pgvector extension is required or automatically installed by the application.

## Production worker prerequisites

Set DATA_MODE=postgres, QUEUE_DRIVER=bullmq, a working DATABASE_URL/REDIS_URL, the private S3 settings and KNOWLEDGE_ADMIN_EMAILS. Use a protected/TLS Redis connection as appropriate for your provider. Apply reviewed migrations only after verifying database connectivity and backups; the user-supplied Render database has not been migrated by this task.

Run web and `pnpm worker` as separate services. API and worker must use the same database, queue and storage settings. Unsupported real AI provider names fail closed; implementing/injecting a provider behind the interfaces is required before claiming a real integration. No credentials belong in source, prompts, CLI arguments or chat.

Local proof services started during development are named framecraft-db and framecraft-redis, on 5432 and 6379. These are development containers, not Render services. They are not assumed to survive publication or a new task. The default mock UI needs neither container. A separate mock recovery worker must run only when the mock web process is stopped, since the file backend supports one writer process.

## Commands and outcomes

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` cover the ordinary checks.
- `CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e` uses the preinstalled browser in this environment.
- `TEST_REDIS_URL=redis://localhost:6379 pnpm exec vitest run tests/redis-queue.test.ts` exercises a real local BullMQ worker and automatic retry. It refuses external Redis hosts and removes its own queue jobs afterward.
- `TEST_SQL_DATABASE_URL=... pnpm exec vitest run tests/postgres-inputs.test.ts` requires a fresh disposable local database whose name starts framecraft_test_. It applies all three local migrations and tests owner isolation, row locks and actual PostgreSQL full-text retrieval. It refuses the external user database. Remove the disposable test database afterward.

Optional SQL/Redis suites are skipped by the default test command when their explicit test URLs are absent. Treat those skips separately from passed checks.
