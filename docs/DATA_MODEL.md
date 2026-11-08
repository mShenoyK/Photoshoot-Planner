# Foundation data model

User: UUID, unique normalized email, scrypt passwordHash, createdAt.
Shoot: UUID, owner foreign key with cascading delete, indexed ownerId/updatedAt, name, validated input JSON, positive revision, timestamps and nullable deletedAt.

API validates all JSON before persistence. Read/write/delete always scope by ownerId. Future data models follow specification section 11 and are introduced with their features rather than inert tables. Migration review: apply additive SQL with migrate deploy; back up production before migration. Rollback this initial migration only on disposable local databases (drop Shoot before User); for production use a reviewed forward migration, never migrate reset.

## FC-006–009 input state

ShootWorkspace: shootId primary/foreign key with cascading deletion, validated JSON aggregate of subject profiles, current/history consent, upload intents, media metadata, selected kit snapshot and pending object-deletion keys, plus updatedAt. Owning Shoot row is locked while mutating this aggregate; PostgreSQL parameter binding is used for every SQL value. Per-record shoot membership and consent referential checks live in the service contracts. Subject/ConsentRecord/MediaAsset are typed records inside this aggregate rather than independent relational tables at this milestone.

CameraKit: UUID, owner foreign key/index, name, validated equipment JSON. Shoot snapshots deliberately survive reusable kit edits/deletion.

The additive migration 202611070002_inputs was applied with the initial schema to a disposable local PostgreSQL database. Actual Prisma migration deployment and generated client verification are blocked by engine download access. Rollback on a disposable database: drop ShootWorkspace and CameraKit; for any real user database, back up and review a forward migration rather than dropping data.

## FC-010–014 knowledge and jobs

KnowledgeWorkspace stores the private corpus, review revisions and short-lived source-generation leases under an owning User foreign key. KnowledgeSearchIndex stores only derived-use-permitted approved summaries and metadata, with an owner/chunk primary key and generated English tsvector plus GIN index. Optional mock vectors persist as JSON; no native vector extension is silently provisioned. Source chunks and document records are validated typed entries in the corpus aggregate, not separate normalized tables.

TaskJob stores an owner-scoped durable record plus status/kind/idempotency columns, optional Shoot foreign key and unique (ownerId,kind,idempotencyKey). Redis transports only job and owner IDs. ShootWorkspace plans are append-only strict structured snapshots; plan job IDs prevent duplicate committed versions on recovery. Reindexing advances source review revisions instead of reusing old citation versions. Existing plans report unavailable source citations after rights/source changes.

The third additive migration was applied successfully in the disposable local PostgreSQL suite. Do not run reset/drop operations on the user's external database. A real migration rollout requires the previously documented connectivity, backups and review gates.

## FC-015–016 styling

ShootWorkspace.styling is an optional array of strict Styling snapshots: revision, timestamp, input hash, separate lighting/wardrobe input hashes, optional lighting and wardrobe. Old workspaces need no destructive migration. Scene coordinates include meter bounds, camera direction/height, exact subject IDs, light kind/modifier/direction/height/purpose and backdrop. Heights are illustrative face markers, not inferred measurements. Each wardrobe look has exactly three validated candidates, a selected ID and lock flag; editable observations are explicitly USER_REPORTED. Original photos are never part of styling inputs. Every mutation checks optimistic baseRevision while holding the owning Shoot lock; competing requests cannot silently replace a version. History remains private and is removed with its shoot; snapshot growth needs retention/normalized artifacts in a later production milestone.

## FC-017–019 artifacts

ShootWorkspace.artifacts stores strict append-only records with job UUID, shoot/plan/version, optional pose and styling revision, format, safe generated filename, MIME, bytes, SHA-256, private storage key, provider and timestamp. Public serialization omits the key. No database reset/migration is needed because the existing aggregate and TaskJob.kind text support these additive records/kinds. ILLUSTRATE/EXPORT job idempotency and committed artifact job IDs prevent duplicate publication. Object writes are create-only; an identical recovery object can be reused, while different bytes fail closed. Output metadata is removed and its keys are queued before deletion attempts, preserving retryability during storage outages. Large histories and object/SQL crash reconciliation remain production hardening tasks.

Standalone tool sessions reuse the owner-scoped Shoot/ShootWorkspace persistence container with optional `workflowKind` (POSES/LIGHTING/WARDROBE). They are listed through `/workflows`, excluded from the shoot list, and have no plan prerequisite. Media metadata adds optional workflowScope and referenceView; legacy unscoped media remains PLAN-only. Styling reference fingerprints are computed independently per tool; knowledge-only wardrobe fingerprints exclude image observations. New wardrobe looks can retain all source asset/review IDs for multi-view provenance. Built-in private knowledge records explicitly use REVIEWED_NOTES representation, original PDF fingerprint/page count and approved original-summary chunks; original bytes are not installed. Complete-plan records link a plan ID to an immutable styling revision and the input fingerprint/reference IDs used.
