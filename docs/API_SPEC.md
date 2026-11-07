# Phase 1 API

All paths below start /api/v1. Envelope: {data,error,meta}; errors contain stable code/message/optional fields. JSON bodies are limited to 16 KiB. Cookies identify owners. Mutations require Origin equal to WEB_BASE_URL (or request origin locally). GET health is public; registration/login are public POST endpoints; everything else requires a valid session.

- POST auth/register or auth/login: {email,password}; password 12–128 characters. Sets HttpOnly cookie.
- POST auth/logout: clears cookie.
- GET health: {status:"ok"}; liveness only, not database readiness.
- GET shoots: owner-only nondeleted briefs, newest first. Pagination is deferred.
- POST shoots: shared shootSchema input, returns 201 Shoot.
- GET shoots/:id: owner-only Shoot, 404 also for another owner.
- PATCH shoots/:id: complete ShootInput plus revision integer, atomically increments revision; stale updates return 409 CONFLICT.
- DELETE shoots/:id: PostgreSQL soft deletion, mock removal; owner check required.

Shoot returned fields include id, ownerId, revision, createdAt, updatedAt plus validated input. UI must strip server metadata before writes. Request ownerId is rejected by strict validation. No media, generation, export or knowledge endpoints exist yet.

## FC-006–009 additions

All routes below use the same authenticated /api/v1 envelope and exact Origin checks on mutations. All IDs are scoped to the route shoot; only generated sanitized download filenames are used.

- GET shoots/:shootId/inputs: subjects/current consent/history, completed sanitized media metadata, camera-kit snapshot and pending deletion count; no object keys or upload tokens.
- GET/POST shoots/:shootId/subjects; PATCH/DELETE shoots/:shootId/subjects/:subjectId. Full validated subject input on write; profile changes withdraw prior photo permission and delete linked photos.
- POST shoots/:shootId/subjects/:subjectId/consents: status GRANTED/REFUSED/REVOKED, acknowledgment, authority attestation, guardian fields when required, optional future analysis/generation flags. Purpose/retention policy version is server-controlled.
- POST shoots/:shootId/upload-intents: fileName, MIME, byte count, kind, subjectIds, noIdentifiablePeople. Returns an upload URL, five-minute uploadToken and intent ID only after consent checks. Send the token as an Authorization Bearer header; never put it in a query string.
- PUT shoots/:shootId/uploads/:intentId (Authorization: Bearer uploadToken): authenticated raw image body matching declared MIME and bytes. Header JWT is owner/shoot/intent bound; one upload only. Validates and stores private original plus metadata-free copy.
- POST shoots/:shootId/uploads/:intentId/complete: verifies stored objects and current consent; repeat completion is idempotent while consent remains valid.
- GET shoots/:shootId/media/:assetId/download: sanitized WebP attachment only, live owner/consent/completion/checksum checks, private no-store.
- DELETE shoots/:shootId/media/:assetId: blocks access and deletes both objects; pending physical deletion count is returned on outage.
- GET/POST equipment; PATCH/DELETE equipment/:id: owner-only reusable kits. POST equipment/canon-preset adds the exact Canon portrait preset.
- PATCH shoots/:shootId/equipment: {kitId: UUID | null} copies or clears the owner's kit snapshot.
- DELETE shoots/:shootId now invalidates/purges input media before soft deletion. Cleanup failure returns DELETION_PENDING/503 and blocks input access; retry deletion after storage recovery.

- POST shoots/:shootId/media-cleanup: owner-only retry for pending physical deletions; does not remove active media or alter consent. Returns deletionPending count.

## FC-010–014 knowledge and planning

All routes remain /api/v1, authenticated and owner-scoped. Knowledge administration additionally requires a configured production admin email; local mock accounts administer their own private libraries. Source IDs cannot select another owner's corpus.

- GET/POST admin/knowledge/documents: list private metadata, or upload multipart file + JSON metadata. POST returns 202 {document,duplicate:false,jobId}; a same-owner checksum duplicate returns 200 and the existing document. Source limit 10 MB, PDF cap 150 pages. Metadata includes explicit rights and taxonomy, not client-chosen scope/storage keys.
- GET/PATCH/DELETE admin/knowledge/documents/:id: private detail and conditional text preview; update allowDerivedUse/allowPrivateReview/allowPrivateVision; remove source. No public original-source route exists. Withdrawing page review must also withdraw private vision.
- PATCH admin/knowledge/documents/:id/chunks/:chunkId: {summary,reviewStatus,baseRevision,taxonomy}. Approval requires derived-use permission and original paraphrasing. Revision conflicts return 409.
- POST admin/knowledge/documents/:id/reindex or /embeddings: durable extraction/indexing tasks. Optional embeddings require ENABLE_EMBEDDINGS=true.
- GET admin/knowledge/documents/:id/pages/:page: permission-gated private thumbnail, no-store. POST /vision/:page: separately permission-gated review aid; current provider is explicitly mock.
- POST admin/knowledge/documents/:id/visual-cards: {page,summary}; creates a pending original guidance card tied to a real PDF page. Manual approval is a separate action.
- POST knowledge/search: {query,filters:{environment?,subjectCount?,ageGroups?,topics?},maxResults?}; returns only approved rights-permitted summaries, exact source references and scores. No raw passages or object URLs.
- GET jobs/:id; POST jobs/:id/retry: owner-only progress/results and bounded failure retry. Job responses omit raw input, owner metadata and worker leases.
- GET/POST shoots/:shootId/plans: history, or {poseCount?,useKnowledgeBase?,idempotencyKey} returning 202 durable job metadata. Conflicting profile counts reject generation; no profiles produce an explicitly generic plan. Text planning never reads subject photographs.
- GET/PATCH shoots/:shootId/plans/:planId: owner-only version, or append a new version with {baseVersion,creativeBrief?,poseEdits?,shotList?,lockedSections?}. Strict fields and known pose/shot IDs only. Edited pose text loses automatic citations.
- POST shoots/:shootId/plans/:planId/approve: {baseVersion}; append an approved version only with currently valid citations.
- POST shoots/:shootId/plans/:planId/regenerate-section: {baseVersion,section,idempotencyKey}; append a new version changing only the selected unlocked section. Stale/locked operations return 409.

Citation references contain documentId/title, stable chunkId, monotonically increasing chunkRevision, exact PDF page or Markdown line range. Plan reads report citationStatus VALID or SOURCE_UNAVAILABLE. Removed/review-changed sources cannot silently validate old citations. Unknown provider output fields, invented references, mismatched subjects and inconsistent shot links are rejected before a plan is saved.

## FC-015–016 lighting and wardrobe

All endpoints below require the session owner and return private/no-store responses. Mutations require the configured Origin. Normal envelope and Zod errors apply.

- `GET /api/v1/shoots/:id/styling`: `{latest, versions, stale, subjects}`; no saved output returns latest null. `stale` remains true if either existing section's fingerprint differs from current manual shoot/profile/kit inputs.
- `POST /api/v1/shoots/:id/styling`: strict discriminated action plus `baseRevision` (0 initially). Returns the same view with an appended revision.
- `GET /api/v1/shoots/:id/styling/top.svg` and `side.svg`: authenticated latest original SVG attachment; CSP sandbox, no-store and nosniff. Historical versions are viewable in the UI; immutable artifact download identifiers are FC-018 work.

Actions:

| action      | Other fields                                                                                    | Behavior                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| LIGHTING    | recipe CONTEXT or STACKED_MONOCHROME; fill boolean (default false)                              | Recompute equipment-aware settings and geometry                                                                  |
| SCENE       | scene (shared sceneSchema)                                                                      | Edit bounded coordinates, exactly the shoot's subject IDs, flash count ≤ recorded kit                            |
| WARDROBE    | optional heroSubjectId                                                                          | Generate/rebalance unlocked looks; retain selected hero look and entire locked looks; omitted hero clears anchor |
| OBSERVATION | observation: subjectId, visibleColors, fabricNotes, fitNotes, uncertainty, source USER_REPORTED | Save editable uncertain manual notes; explicit rebalance applies them                                            |
| SELECT      | subjectId, candidateId, locked boolean                                                          | Swap an unlocked choice or lock/unlock the selected choice                                                       |

`CONFLICT` (409): outdated baseRevision. `STALE_INPUTS` (409): regenerate a section after inputs change; unlocking the existing choice remains possible. `LOCKED` (409): unlock before swapping. `LOCK_CONFLICT` (409): a retained color conflicts with current avoided colors; unlock/clear hero then rebalance. `COUNT_MISMATCH`, `SUBJECT_MISMATCH`, `RECIPE_EQUIPMENT`, `EQUIPMENT_MISMATCH`, `PALETTE_CONFLICT`, `SUBJECTS_REQUIRED`: correct inputs before retry. Foreign owner/shoot/subject/hero/candidate membership is rejected; raw owner IDs, object keys or photo bytes are never accepted by styling contracts.

## FC-017–019 original schematics and immutable artifacts

- `GET /api/v1/shoots/:id/artifacts`: owner-private immutable metadata, without storage keys.
- `POST /api/v1/shoots/:id/artifacts`: `{planId, format, stylingRevision?, poseId?, idempotencyKey}`. Formats MARKDOWN/PDF/CSV/SVG/ZIP/ILLUSTRATION. Only ILLUSTRATION accepts/requires poseId; styling is optional, but standalone SVG requires lighting. Server checks plan/pose/styling membership before enqueuing a durable ILLUSTRATE/EXPORT job (202).
- `GET /api/v1/shoots/:id/artifacts/:artifactId/download`: exact immutable version, private/no-store attachment with nosniff/CSP sandbox/ETag. Owner and shoot membership and SHA-256 verified; missing/withdrawn cited sources block new exports/downloads. Repeated creation with the same idempotency key returns the existing job; change parameters with a reused key fails. A different key creates a new artifact version, never replaces a file.
- Existing `GET /jobs/:id` and `POST /jobs/:id/retry` handle durable status and up to three attempts. Unsupported image providers fail with IMAGE_PROVIDER_NOT_CONFIGURED. Wrong count/age/support output is rejected before publication. Provider deadlines fail safely; no paid image call is made in mock mode.
- `GET /api/v1/ready`: PostgreSQL readiness (3-second response deadline), or explicitly labeled local mock mode. Liveness remains `/health`. No connection strings or stack traces are returned.

Export ZIP contains shoot-plan.md/pdf, shot-list.csv, available lighting top/side SVG + editable scene JSON, already-requested illustrations for that plan and manifest.json. Manifest lists plan/styling versions, valid source references, guidance provenance, exclusions, file sizes and SHA-256 hashes. Subject photographs, source documents/pages/thumbnails, consent records and credentials are excluded. User-entered brief/outfit text and participant labels may still identify people; review before sharing. CSV protects formula-leading values, and Markdown escapes raw HTML/markup in user fields. PDF has a documented standard-font fallback for unsupported Unicode glyphs; Markdown/CSV retain full Unicode.
