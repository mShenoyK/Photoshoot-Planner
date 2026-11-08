# FrameCraft AI

Responsive photography workspace with accounts, private shoot briefs, autosaving wizard, mixed-age profiles, consent-gated photo intake, camera kits, private knowledge retrieval and versioned mock planning, original SVG Lighting Lab and no-photo Wardrobe Stylist (FC-001–016). On-demand original SVG schematics and private PDF/Markdown/CSV/SVG/ZIP exports are implemented; live deployment and photographer pilot validation remain open. See docs/MILESTONES.md and the root product specification.

## Local development

Use Node 22+ and pnpm 10.28.2. Run `pnpm install --frozen-lockfile` then `pnpm db:generate` for PostgreSQL. The mock workflow can run without engine generation.

For a no-service demo: `DATA_MODE=mock pnpm dev`. Register with your own test email and a password of 12+ characters. Data persists in apps/web/.data/framecraft.json; do not use real personal data. Production blocks demo mode.

For PostgreSQL: `docker compose up -d`, then export DATABASE_URL from .env.example into your shell, run `pnpm db:migrate` and `pnpm db:seed`. Set AUTH_SECRET to a random value of 32+ characters, WEB_BASE_URL=http://localhost:3000, DATA_MODE=postgres, and run `pnpm dev`. Environment values are shell variables; Next.js can alternatively read apps/web/.env.local (ignored). Root Prisma CLI requires exported DATABASE_URL. Seed uses SEED_EMAIL/SEED_PASSWORD, creates no account if omitted, and never changes an existing password.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Browser checks: `pnpm exec playwright install chromium` then `pnpm test:e2e`; browser tests start an isolated demo server and save screenshots outside the source tree. PostgreSQL integration: `DATABASE_URL=... TEST_DATABASE=1 pnpm test` (use a disposable DB). Run `pnpm start` after build with PostgreSQL and AUTH_SECRET configured.

## Deployment status

Render and GitHub deployments have not been configured or tested. This checkout retains its existing GitHub origin; no replacement repository, remote writes or branch protection has been created. CI/Render templates are scaffolding only. See docs/DEPLOYMENT.md and docs/ARCHITECTURE.md for explicit limitations.

## This managed cloud workspace

The image supplies pnpm 11 while this project pins pnpm 10. Use a pnpm 10 installation (for example `npm_config_cache=/workspace/.npm npx --yes pnpm@10.28.2 dev`) rather than the image fallback. In restricted filesystem sessions, put package caches under /workspace. Chromium is already installed: `CHROMIUM_PATH=/usr/bin/chromium pnpm test:e2e` avoids a browser download.

Prisma client generation currently requires allowing `binaries.prisma.sh` in environment settings. A domain-addition draft is saved, but it has not been applied or published. Do not disable checksum/TLS verification. See docs/PHASE_1_REPORT.md for exact validation limits.

## People, consent, photos and camera kits (FC-006–009)

After saving a brief, open **People, photos & equipment**. Add mixed-age profiles, record permission (guardian details for minors/unconfirmed ages), declare everyone in an image, then upload an optional reference. No photos are required. Refusal/revocation blocks intake and removes linked photo access. Photos can be deleted individually. Downloads contain sanitized metadata-free WebP copies; private originals are not served.

The Canon portrait preset includes EOS R6 Mark II, RF 24–105mm f/4, two flashes and a 90 cm gridded octabox. Save/select a kit for each shoot; reusable kit changes retain existing shoot snapshots.

Mock mode defaults to a private local object directory. For production set STORAGE_DRIVER=s3 and configure the .env.example storage variables securely, with a private bucket and least-privilege credentials. S3 transport has been tested only with mocks. PostgreSQL is for records, not photo blobs. Run `pnpm db:check` only with a secure DATABASE_URL runtime binding and working TCP route; it performs verified TLS and read-only SQL, never migration/seed. See docs/DATABASE_CONNECTIVITY.md and docs/PHASE_2_SECURITY_REPORT.md.

Optional SQL integration tests use a disposable local database whose name starts framecraft_test_: set TEST_SQL_DATABASE_URL in the shell, then run `pnpm exec vitest run tests/postgres-inputs.test.ts`. These tests refuse external hosts and create tables only in the disposable local target. Default tests skip this optional suite when not configured; browser tests use synthetic images and the local mock store.

## Knowledge and planning (FC-010–014)

Open **Private knowledge library** from the dashboard to ingest permitted Markdown/PDF sources and review original paraphrases. Only approved, rights-permitted guidance enters retrieval. Private PDF thumbnails and page review cards support image-only workbooks; the mock vision aid performs no OCR or actual visual understanding. Originals are never pose illustrations or export assets.

A saved brief now links to **Plan & Pose Studio**. Generate a schema-validated mock plan, edit its brief/poses/shot list, save new versions, approve and lock sections. The planner uses manual profiles without reading subject photos. Exact profiles are checked; omitted profiles produce a labeled generic fallback. Source IDs, page/chunk references and review revisions are validated.

The default mock UI needs no Redis, AI keys or external services. Production requires QUEUE_DRIVER=bullmq, a separate `pnpm worker`, shared database/storage settings and KNOWLEDGE_ADMIN_EMAILS. Optional mock embeddings require ENABLE_EMBEDDINGS=true. See docs/KNOWLEDGE_AND_PLANNING.md and docs/PHASE_3_REPORT.md for commands, tests, security boundaries and unverified external integrations. FC-015 onward remains unimplemented.

## Lighting and wardrobe (FC-015–016)

Open a saved brief → Lighting Lab or Wardrobe Stylist. Add manual people and select an equipment kit under People, photos & equipment; no photo or AI service is required. Lighting supports context-aware defaults and the spec-derived stacked monochrome recipe (indoor, flash, 90 cm gridded octabox required). Save JSON coordinate edits as new revisions and download original top/side SVGs. Wardrobe offers three choices per person, editable uncertain observations, hero selection, lock/unlock, swap and rebalance. Avoided colors override preferences; locked conflicts require correction. Existing plan approvals are preserved; styling has its own version selector. See docs/PHASE_4_REPORT.md for source availability and acceptance evidence.

## Original schematics and exports (FC-017–022)

Open a saved plan → Original illustrations & exports, or Files & exports from the brief. Select an immutable plan version, optional styling revision and export format. Request original schematics explicitly; the free mock provider uses exact manual subject IDs and requires adult caregiver support for baby/toddler figures. Files are private, immutable and hash-verified. ZIPs exclude all original uploads/photos/books and include a provenance manifest, selected styling and already-requested original schematics. They may still contain identifying participant labels and manual notes; review before sharing. Unsupported paid image providers fail closed. See docs/PHASE_5_REPORT.md and docs/DEPLOYMENT.md for current evidence, credentials and actual deployment gates.

## Refreshed reference-image workspace

The interface now uses spacious system typography, neutral surfaces, pill controls and shared shoot navigation. A visible Posing guide includes original face-spacing schematics and readable direction steps. Reference images are central to the plan, lighting and wardrobe screens: request a review, edit the observations, then confirm them before generation. Approved observations feed scene/pose directions, light-side starting geometry and three per-subject looks/palettes; manual inputs remain available. Photo-based body impressions are uncertain and editable, never precise measurements or personality inferences.

`AI_VISION_PROVIDER=openai` + secure OPENAI_API_KEY enables the optional OpenAI vision adapter. The default mock review explicitly does not analyze image content. Real images need private S3 storage and purpose consent. Small/free production web deployments can use `QUEUE_DRIVER=inline` with PostgreSQL instead of a separate worker; BullMQ/Redis remains available for scale. See docs/UI_REFERENCE_REPORT.md and the latest DEPLOYMENT.md section for exact setup, tests and limitations.

Independent creative tools are available at `/tools`: start posing, lighting or wardrobe without creating a photoshoot plan. Upload references directly inside each active tool, or use the separate knowledge-only posing/wardrobe modes. See [standalone tools and PDF-source evidence](docs/STANDALONE_TOOLS_REPORT.md) for scope rules, curated-library coverage and remaining external verification gates.

Live recommendation images and the private-intake enablement fix are documented in [LIVE_RECOMMENDATIONS_REPORT.md](docs/LIVE_RECOMMENDATIONS_REPORT.md). Existing Render services must explicitly select the OpenAI text/vision/image providers and configure OPENAI_API_KEY securely. Missing configuration shows an error instead of substituting a dummy image.
