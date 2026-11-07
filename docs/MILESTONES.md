# Implementation roadmap and acceptance gates

| Issues | Milestone                                    | Gate                                            |
| ------ | -------------------------------------------- | ----------------------------------------------- |
| FC-001 | pnpm monorepo, Next.js, strict TS, lint/test | Frozen install, lint, typecheck, tests, build   |
| FC-002 | Responsive design system/navigation/PWA      | Mobile/desktop shell, labels, focus and states  |
| FC-003 | Auth/session, owner-scoped API               | Login/logout, unauthorized + cross-owner tests  |
| FC-004 | PostgreSQL/Prisma models/migrations/seed     | Migrate fresh DB; idempotent seed               |
| FC-005 | Dashboard, wizard/autosave/reopen            | Browser create/edit/reload; revision conflicts  |
| FC-006 | Subject profiles/mixed families              | Flexible count and manual profiles              |
| FC-007 | Private object store/uploads                 | Authorized signed upload/view                   |
| FC-008 | Consent/photo quality                        | Refusal/revocation/guardian tests               |
| FC-009 | Camera kits                                  | CRUD and Canon preset                           |
| FC-010 | Private document ingestion                   | Markdown/PDF page sources and dedupe            |
| FC-011 | Hybrid retrieval/citations                   | Real chunk/page integrity                       |
| FC-012 | Mockable AI adapters                         | Deterministic schema-valid mock plans           |
| FC-013 | BullMQ workers/versioned plans               | Idempotent generation/retry/provenance          |
| FC-014 | Pose Studio                                  | Editable cited cards/safe exact counts          |
| FC-015 | Lighting rules/SVG                           | Diagram geometry matches scene                  |
| FC-016 | Wardrobe/group palettes                      | Locks/swaps/rebalance                           |
| FC-017 | Original illustrations                       | Explicit action, subject-count fallback         |
| FC-018 | Immutable artifacts                          | Versioning and private tenant isolation         |
| FC-019 | PDF/MD/CSV/SVG/ZIP exports                   | Parse/reopen/hash manifests                     |
| FC-020 | GitHub CI/Render                             | Real staging smoke test; templates insufficient |
| FC-021 | Security/privacy/observability               | Upload, consent, ownership, retries tests       |
| FC-022 | Pilot/responsive QA                          | Four widths, photographer quality rubric        |

Phase 1 is the current review gate. Phase 2 is FC-006–009; Phase 3 FC-010–014; Phase 4 FC-015–016; Phase 5 FC-017–022. Full MVP is not complete at the foundation gate.

## Phase 1 checklist

- [x] Frozen dependency install, lint/typecheck/tests/build
- [ ] PostgreSQL migration and repeatable seed
- [x] Account/session and owner isolation tests (local mock backend)
- [x] Autosave/create/edit/reopen at 375, 768, 1280, 1440 px
- [x] Screenshots and semantic label/focus implementation (manual assistive-technology audit deferred)
- [x] Document limitations and configuration

The Phase 1 gate remains open pending Prisma client/migrate/seed and PostgreSQL API validation; see PHASE_1_REPORT.md.

## FC-006–009 review gate

- [x] Flexible mixed-age profiles and optional subject count
- [x] Guardian consent, refusal/revocation, history and purpose/retention acknowledgment
- [x] Consent-gated private intake and sanitized authorized downloads
- [x] Signature, size, dimensions, decode checks and quality warnings
- [x] Local object adapter and mocked S3 contract
- [x] Exact Canon portrait preset, owner-scoped kits and shoot snapshots
- [x] IDOR, consent race, cleanup-failure and mobile/desktop checks
- [ ] Real S3 bucket/IAM and Prisma runtime verification
- [ ] External Render database connectivity (requires a supported TCP route and secure runtime binding)

See PHASE_2_SECURITY_REPORT.md for evidence, data-model tradeoffs and production limitations. No FC-010+ features were implemented.

## FC-010–014 review gate

- [x] Private Markdown/PDF fingerprinting, owner-local deduplication and page/line-aware extraction
- [x] Rights/taxonomy fields, approved original paraphrases, private thumbnails and manually reviewed image-page cards
- [x] Approved-summary lexical/SQL full-text retrieval, optional mock vectors and strict live citation provenance
- [x] Mockable AI contracts and schema-validated plans for 1, 2 and 4 mixed-age people
- [x] Durable/idempotent task records, separate BullMQ worker, actual local Redis retry and mock recovery entry point
- [x] Immutable plan versions, editable brief/poses/shot list, approvals, locks and selective regeneration
- [x] Mobile/desktop Pose Studio and source review tests/screenshots
- [ ] Native pgvector and real text/vision/embedding adapters validated
- [ ] Live generated Prisma client and external database/storage/Redis deployment validated

Evidence: PHASE_3_REPORT.md. Default tests passed 45 with 5 opt-in skips; those 4 SQL + 1 Redis tests passed separately. Full browser suite passed 13. Stop before FC-015–016.

## FC-015–016 review gate

- [x] Original deterministic top/side SVG from editable bounded meter coordinates
- [x] Natural/window/open-shade, artificial and mixed starting guidance; kit checks and optional fill
- [x] Spec-derived stacked monochrome family recipe, face-plane/child safety and unmetered exposure caveats
- [x] Three no-photo outfit choices per manual subject, scene/light rationale and comfort/preferences
- [x] Hero anchor, lock/unlock, swap and unlocked rebalance; uncertain editable observations
- [x] Private append-only revisions, conflicts/staleness, owner/subject isolation and SQL row-lock tests
- [x] Four-person mixed-age no-photo mobile/desktop browser assertions and screenshots
- [x] Separate lighting/apparel guides reviewed after attachment; recipe corrections and provenance recorded
- [ ] Owner-specific rights-reviewed ingestion/source citation IDs (not fabricated from filenames)
- [ ] Photographer/stylist pilot review and live production infrastructure verification

See PHASE_4_REPORT.md. Stop at FC-016; FC-017–019 are next (original illustrations and immutable export artifacts).

## FC-017–022 review gate

- [x] FC-017 explicit original schematic generation, exact subjects, caregiver constraints, mockable structured provider, durable failure/retry
- [x] FC-018 immutable create-only private output keys, hash-verified owner downloads, version metadata, deletion retry
- [x] FC-019 parseable PDF/Markdown/CSV/SVG/ZIP with provenance manifest; no photos/books in default shareable package
- [x] FC-020 GitHub Actions and separate Render web/worker templates, readiness and actual-target smoke command
- [x] FC-021 cross-owner/cross-shoot access, unsafe/malformed provider output, CSV injection, export integrity, log redaction and cleanup-failure checks
- [x] FC-022 automated responsive export/schematic checks at 375/768/1280/1440 px; controlled pilot rubric
- [x] Successful GitHub push to main, verified remote source commit c7c91b8
- [ ] Remote GitHub Actions run verified (CLI authentication remains unavailable)
- [ ] Actual Render release plus database/storage/Redis smoke tests and external connectivity
- [ ] Real editorial/personalized image provider, semantic fidelity and complete Unicode font coverage
- [ ] Photographer/stylist pilot, independent accessibility/security review and remaining auth hardening

See PHASE_5_REPORT.md and DEPLOYMENT.md. Template/code readiness is not deployed/validated infrastructure or a completed real-user pilot.
