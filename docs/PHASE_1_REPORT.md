# Phase 1 review — FC-001 through FC-005

## Assessment

The existing Photoshoot-Planner checkout had no tracked files or commits. No unrelated application code was overwritten. The supplied implementation specification is copied unchanged to the repository root. Existing GitHub origin is preserved; no remote repository was created, pushed, or deployed.

## Delivered

- Four-project pnpm workspace (root, web, shared contracts, database), pinned package manager and lockfile, Next.js/React, strict TypeScript, Tailwind v4, ESLint, Vitest and Playwright.
- Mobile/desktop editorial shell, light/dark tokens, labeled forms, loading/empty/error states and accessible step names.
- Account registration/login/logout and signed cookie sessions; owner-scoped API CRUD and revision conflict protection.
- PostgreSQL Prisma User/Shoot schema, initial migration SQL, optional idempotent seed, Docker Compose and persistent development-only mock store.
- Four-step foundation wizard: basics/schedule, people, environment/light/direction, review. Debounced autosave, serialized client saves, stale-write protection, retry and reload/reopen persistence.
- PWA manifest, original SVG icon, service worker and static offline notice without caching private responses.
- AGENTS.md, architecture/API/data/security/design/deployment docs, .env.example, FC-001–022 roadmap, CI and Render templates.

## Verified in this instance

- Frozen pnpm 10.28.2 install: passed.
- ESLint: passed.
- Strict TypeScript: passed against currently installed dependencies. Generated Prisma client types remain unverified until generation succeeds.
- Vitest: 9 passed; includes auth/login, schema rules, owner isolation, CRUD, stale revisions and token tampering using mock persistence.
- Next.js production build: passed, with no build warnings in final run.
- Playwright with installed /usr/bin/chromium: 8 passed. Create/autosave/edit/reopen and overflow assertions at 375, 768, 1280, 1440px; protected routes; save failure/retry and in-app navigation guard; offline fallback; indoor portfolio fields with an omitted subject count.
- Dashboard screenshots: /tmp/framecraft-dashboard-{375,768,1280,1440}.png.
- Wizard screenshots: /tmp/framecraft-review-{375,768,1280,1440}.png and /tmp/framecraft-wizard-{375,768,1280,1440}.png. Phone and tablet screenshots visually inspected. These generated review artifacts are outside Git.
- Initial migration SQL applied successfully to disposable PostgreSQL 16 database, then that scratch database was removed.

## Blocking FC-004 acceptance

The cloud proxy denies binaries.prisma.sh with HTTP 403. Prisma generate/migrate engine downloads cannot finish. Checksum and TLS verification remain enabled. No unverified engine is used. A network draft adding only that hostname has been saved; current runtime policy still has no custom host allowance. Save the network change in environment settings, refresh runtime status, then rerun:

```sh
pnpm db:generate
DATABASE_URL=postgresql://framecraft:localdev@localhost:5432/framecraft pnpm db:migrate
DATABASE_URL=postgresql://framecraft:localdev@localhost:5432/framecraft pnpm db:seed
# Repeat seed with your own SEED_EMAIL and SEED_PASSWORD in the shell to verify idempotency.
DATABASE_URL=postgresql://framecraft:localdev@localhost:5432/framecraft TEST_DATABASE=1 pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use only disposable local test data. A local PostgreSQL container named framecraft-db is running on port 5432. Reuse or stop it before docker compose up to avoid port conflicts. Migration deployment, idempotent seed and Prisma-backed API checks have NOT run successfully, so Phase 1 is not fully accepted. Review/save draft changes in environment settings; publish only after outstanding verification is complete.

## Limits and next work

Authentication is foundation scaffolding, using scrypt and jose rather than Auth.js/managed identity. Recovery, email verification, shared rate limiting, immediate revocation and identity-provider integration remain launch blockers. Mock files support one process and are forbidden in production. The production build does not prove database connectivity. Manual screen-reader/contrast and PWA install/device audits remain pilot checks.

No private storage, queue, ingestion, AI generation, lighting, wardrobe or exports are implemented yet. Their mockable implementations arrive in the mapped milestones, rather than simulated integration claims. No actual credentials or user media were added. CI and Render templates are unverified remotely. Configure production database, AUTH_SECRET and WEB_BASE_URL through provider settings before attempting deployment; Redis/S3/AI secrets are not needed for this foundation.

Next: close FC-004 verification, then FC-006, FC-007, FC-008 and FC-009. Stop at this review gate before expanding scope.

## FC-001–005 acceptance gates

| Issue  | Result                             | Evidence / remaining work                                                                                                                                            |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FC-001 | Pass for local foundation          | Four workspace projects; frozen install, strict TypeScript, lint, unit/API tests, production build                                                                   |
| FC-002 | Pass for responsive automated gate | Dashboard/wizard screenshots and no-overflow checks at all four widths, semantic labels, focus tokens, loading/error/empty states                                    |
| FC-003 | Pass for auth scaffolding          | Registration/login/logout, protected pages, session tampering and cross-owner read/write/delete tests; production identity hardening remains documented              |
| FC-004 | Pending                            | Schema and initial SQL exist; SQL applied successfully to disposable PostgreSQL. Prisma generation/migrate/seed and Prisma API tests blocked by engine-host HTTP 403 |
| FC-005 | Pass with local mock backend       | Required fields, optional count/date/time, autosave/reload/reopen, stale-write protection, failed-save retry and navigation protection                               |

Stopped at FC-001–005. No features from FC-006 onward were implemented in this follow-up. The existing CI/Render templates remain scaffolding only.
