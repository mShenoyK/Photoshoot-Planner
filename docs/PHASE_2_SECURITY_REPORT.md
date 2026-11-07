# FC-006–009 implementation and security review

## Scope delivered

- Mixed-age subject profiles for babies through seniors, voluntarily stated age/gender, sizes, comfort, preferred/avoided colors, style, mobility and optional budget. Subject count remains optional in the brief; the UI distinguishes planned count from actual profiles and warns on mismatch.
- Per-person versioned consent records with actor, timestamp, guardian name/relationship, refusal/revocation, purposes, retention notice and separate future analysis/generation permissions. Unknown age requires guardian details unless an adult age is explicitly stated. Guardian identity/authority is attested by the owner, not independently verified.
- Consent-gated image intake: authenticated owner-only, five-minute signed upload permissions bound to owner/shoot/intent; all declared people require consent. Separate completion and authorized sanitized downloads. Raw originals stay private.
- True JPEG/PNG/WebP signature checks, bounded 15 MB default (configurable 1–30), stream deadline, decode validation, 40 MP input cap, minimum 256px dimensions and animated-image rejection. Original metadata never appears in download derivatives; copies are rotated/resized and re-encoded to WebP. Download checks derivative checksum.
- Quality warnings for low resolution and low contrast. Blur, color cast, occlusion and perspective checks are user guidance, not unsupported model claims. No image is sent to an AI service.
- Private local development object adapter and S3-compatible server adapter. No public object URLs/keys are returned; downloads check ownership and live consent before streaming with no-store/nosniff/attachment headers. Bucket ACLs, provider encryption, CORS and real IAM remain unverified.
- Reusable owner-scoped camera kits; exact preset: Canon EOS R6 Mark II, RF 24–105mm f/4, two flashes, 90 cm gridded octabox. Choosing a kit saves a per-shoot snapshot; editing/removing the reusable kit does not silently change shoots.

## Authorization and lifecycle

Every nested operation checks the route shoot owner. Subject IDs, intent IDs and asset IDs must belong to that shoot, including substitutions between two shoots owned by the same account. Client-supplied owner/storage-key fields are rejected. Camera kits are owner-scoped. Upload permissions travel in an Authorization header, not a query string, to avoid access-log/referrer exposure. Upload JWTs have a different audience from session JWTs and cannot authenticate API sessions. Older foundation sessions without issuer/audience must sign in again.

PostgreSQL uses a ShootWorkspace JSON aggregate plus CameraKit table. This is a deliberate scoped-input architecture decision: subjects, consent history, upload intents and media metadata are committed together while SELECT FOR UPDATE locks the owning Shoot row. It prevents permission changes racing image intake/completion. The development file repository serializes the same operations. These aggregates are not yet normalized Subject/ConsentRecord/MediaAsset tables; future indexing/reporting may require additive normalization.

Refusal, revocation, subject edits/deletion and photo deletion invalidate uploads and remove related media access. A group photo is removed if any linked person's permission is withdrawn. Profile edits deliberately withdraw permission because the declared person/age may have changed; the UI confirms this before saving. Consent replacement removes photos tied to the previous permission. No processing of image bytes starts before the intake permission check.

Physical deletion failures do not roll back withdrawal of consent. Object keys are retained privately for deletion retry, while API access is blocked immediately. Shoot deletion remains pending/inaccessible until cleanup succeeds. On a database commit failure after an object write, an inaccessible orphan may remain: production needs scheduled reconciliation/lifecycle cleanup. Owners cannot access such objects through this API.

## Evidence and limits

See test files tests/inputs.test.ts and tests/postgres-inputs.test.ts, plus responsive browser scenarios in tests/e2e/inputs.spec.ts. Synthetic generated solid-color fixtures are used; no real person photographs or user credentials were added to source.

API tests cover refusal/guardian validation before the image validator is called, every declared person in group photos, revoked/regranted token replay, signature/size/dimension errors, metadata removal, completion, session-token audience separation, cross-owner and cross-shoot IDOR, storage-outage revocation, profile edits, concurrent intake/revocation, safe delete retry, and equipment isolation. S3 transport is mocked; it is not a provider connection test.

A separate local PostgreSQL suite executes the actual parameterized SQL and real concurrent row locks. It substitutes a pg transaction transport because Prisma's engine host is blocked, so it does not prove generated Prisma client/runtime compatibility. Both additive migration SQL files were applied successfully to a disposable PostgreSQL 16 database. No user Render schema was altered.

Runtime SQL access, Prisma generation/migrate/seed, real S3 bucket/IAM and production deployment are still unverified. See DATABASE_CONNECTIVITY.md. Local media and file persistence are explicitly forbidden in production. The current local mock backend is for development and one process only.

## Before public use

- Finish live Prisma/PostgreSQL and S3 validation with secure runtime bindings, plus migration review/backups.
- Add durable deletion/orphan cleanup, provider backup retention policy, malware-scanning/quarantine strategy, per-account storage/rate budgets and operational monitoring.
- Images containing undeclared identifiable people cannot be detected without processing them. The intake contract requires the owner's truthful declaration of every identifiable person or a people-free reference attestation. Do not claim independent verification of consent or guardianship.
- Any future AI analysis/generation boundary must separately enforce its recorded permission at execution time; this milestone only performs consented storage/quality processing and implements no AI jobs.
- Retain foundation auth hardening requirements (recovery, email verification, shared throttling, immediate session revocation/managed identity review), and perform full assistive-technology/security review before pilot launch.

Stopped at FC-006–009. Knowledge ingestion, planning jobs, lighting rendering, wardrobe generation and exports were not implemented.

## Final acceptance evidence

- Frozen pnpm install, lint, strict typecheck and Next.js production build: passed.
- Default Vitest run: 26 passed, optional local SQL suite 3 skipped when its test URL is absent.
- Explicit disposable local PostgreSQL run: those 3 SQL tests passed, including ownership and real concurrent row-lock assertions. The test database was then removed.
- Full Playwright suite: 10 passed (foundation and input flows). After upload-header/cleanup changes, the two input scenarios passed again at 375 and 1440px, including the pending-delete retry control. Screenshots are /tmp/framecraft-inputs-375.png and /tmp/framecraft-inputs-1440.png.
- Read-only database checker: rejected an untrusted local certificate, accepted the explicitly trusted local certificate, and confirmed transaction_read_only=on. This was a local PostgreSQL 16 check, not a connection to Render.
- Targeted source scan found no copy of the supplied external database credential marker. No real subject photos were used.

| Gate                             | Result                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| FC-006 profiles/mixed groups     | Pass in local workflow; persists voluntarily stated fields, flexible profiles and optional brief count                        |
| FC-007 private intake/storage    | Local adapter and mocked S3 contract pass; real S3/IAM and Prisma runtime remain pending                                      |
| FC-008 consent/quality/isolation | Pass in tested local paths: guardian/refusal/revocation, no decoder invocation before permission, IDOR and concurrency checks |
| FC-009 equipment                 | Pass in local workflow and real SQL repository tests; exact Canon preset, owner CRUD and shoot snapshot                       |

Production acceptance remains open for live Prisma/PostgreSQL and S3 validation, identity-provider hardening and the operational controls above. The supplied Render DB was not authenticated or modified. The environment draft contains only a name requirement for DATABASE_URL; its value was not saved or applied. External database connectivity is blocked by the current execution network path, independently of app tests. Next implementation IDs are FC-010–FC-014 after this review gate; they were not started.
