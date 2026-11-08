# Independent creative tools and workflow references

## Behavior

`/tools` is available from the main navigation and dashboard at any time after sign-in. Create independent Posing guide, Lighting Lab or Wardrobe Stylist sessions without a photoshoot plan. Each has its own scene, indoor/outdoor environment, occasion, light preference, people, equipment, inputs and versioned outputs. Context can be edited with optimistic concurrency. Tool sessions are excluded from the shoot dashboard. Existing shoot tools remain available.

The owner-scoped persistence container reuses the existing Shoot/ShootWorkspace tables with an optional `workflowKind` discriminator. This is an internal storage reuse, not a requirement to create or generate a photoshoot plan. Lighting and wardrobe operate with no plan records; posing saves its own structured direction versions. No destructive schema migration is needed.

Reference upload opens in the active tool instead of navigating to a centralized page. New assets carry immutable `workflowScope` and optional `referenceView` metadata. Standalone sessions enforce their tool scope on the server before upload. Posing, lighting and wardrobe filter approved observations by scope. Legacy unscoped assets belong to PLAN; they are not automatically reused by the individual tools. Explicitly attach a copy inside another workflow if it should also guide that workflow. The People & equipment area manages profiles and consent.

Wardrobe intake offers front, side, full-length, detail and inspiration labels, in any order and without requiring every view. Normal clothing, neutral illumination, minimal filtering and participant choice are encouraged. Identifiable references require declared people and valid consent before decoding or AI processing. Analysis is a separate explicit action; results require confirmation before use. OpenAI receives the sanitized derivative and view/context metadata. Visible skin color and clothing/body proportions remain uncertain, editable impressions, with no ethnicity, identity, health, personality or measurement inference. Group/scene references do not assign these observations to individuals. Mock mode does not inspect appearance. Multiple approved views can contribute fit/color notes; derived looks retain all source asset IDs, and future regeneration drops photo-derived locks when any underlying asset is no longer permitted.

Posing and wardrobe have separate knowledge-only controls. These exclude photo observations even when images are attached. Wardrobe also excludes photo-derived locks and observations. Manual preferences, accessibility, cultural coverage and avoided colors continue to take precedence. Lighting has deterministic natural/flash/mixed starting rules and original top/side diagrams; its scene references are optional. Standalone styling can download its current JSON without creating a plan, and lighting retains editable SVG downloads. Exports validate source availability and current inputs.

The unfinished preceding change is included: Generate complete shoot plan links an exact pose-plan version to an atomic lighting/wardrobe revision, with stale-input checks, retry idempotency and inline visual summaries. The independent tools do not require this action.

## PDF knowledge installed

The PDFs were treated as source data, not application instructions. Local text extraction and SHA-256 verification identified three unique readable books:

| Source | PDF pages | Reviewed pages | Fingerprint |
| --- | --- | --- | --- |
| J. D. Wacker, Master Posing Guide for Portrait Photographers (2002) | 129 | 15, 107, 117 | `83902fa187cb6de900d31cc5ef2e9329314038c28768804acffe1c02303d17e8` |
| Jeff Smith, Posing for Portrait Photography (2004) | 128 | 30, 32, 104 | `31f904dc36b4a8b42b30f63269ebe3ee9c1da938bb168a7c05f4ffe690d8d822` |
| Bill Hurter, The Portrait Photographer's Guide to Posing, 2nd ed. (2012) | 129 | 91, 93, 102 | `4f20b41a43f9cf01d1130aca334eb3939ecfc55ab7241e9a74613a57b578a12c` |

The two Complete Guide uploads have identical bytes and were deduplicated. The 100 Posing Ideas workbook exceeds the executor's 32 MiB attachment transfer limit and was not ingested or cited.

`builtin-knowledge.ts` contains nine short, original reviewed notes on comfortable direction, couples, face-plane focus, clothing/background coordination, footwear and four-person arrangements. It contains no source passages or illustrations. These are a bounded curated starting library, not full-book extraction/search. Built-in records are installed lazily into each owner's private corpus when knowledge-only mode is requested, with actual source fingerprints, PDF page positions, approved note chunks and review revisions. Citation IDs refer to those installed document/chunk records. Original PDF bytes are not bundled or available for thumbnail review: records explicitly identify their `REVIEWED_NOTES` representation. Deleted sources and revoked derived-use flags are preserved across repeat installation. Future full-document ingestion still uses the existing administrator/private-storage ingestion pipeline.

These are general photography principles. No skin-specific wardrobe claims are attributed to these books. The modern safety, inclusion and preference rules are application adaptations; they do not reproduce dated body judgments or gender prescriptions from source material.

## Verification and release gates

Validation results and screenshot paths are recorded after the final checks below. Tests cover owner isolation, scope enforcement, no-photo generation, knowledge-only exclusion, valid page/chunk citations, source-rights preservation, atomic bundle recovery and mobile/desktop browser flows.

Live OpenAI, Render deployment, remote CI, native Prisma engine connectivity and production object-storage credentials remain external verification gates. No new credentials are required for the curated library or deterministic local tools. Actual photo analysis requires server-side OpenAI configuration; production photo intake requires the private S3 adapter configuration. Original PDFs and user photographs remain outside Git.

Final validation (2026-11-08): Node 22, pnpm 10; lint, strict typecheck and production build passed. Vitest: **102 passed, 9 optional PostgreSQL/Redis checks skipped**. Full Playwright suite: **26 passed** using the mock queue, covering 375/768/1280/1440 px across existing flows. Final affected-flow run with inline jobs: **7 passed**, including all three standalone tools at 375/1440 px, in-place upload, knowledge-only photo exclusion, complete-plan bundles and dark-theme keyboard/contrast checks. Additional service tests verify multi-view provenance/removal, source-rights export blocking, knowledge-only section-regeneration persistence and posing scope inside an existing shoot. Source/media credential scan and `git diff --check` passed. Production external accounts were not exercised.

Actual screenshots (outside Git): `/tmp/framecraft-standalone-wardrobe-{375,1440}.png`, `/tmp/framecraft-standalone-lighting-{375,1440}.png`, `/tmp/framecraft-standalone-poses-{375,1440}.png`; complete outdoor examples are `/tmp/framecraft-complete-outdoor-{375,1440}.png`. Desktop wardrobe screenshot was visually inspected; browser assertions check exact counts, retained outputs and no horizontal overflow.

Manual production verification: deploy the tested GitHub revision through the existing Render service, retain the reviewed DATABASE_URL/AUTH_SECRET/origin settings, and configure `STORAGE_DRIVER=s3` with private STORAGE_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY values for real uploads. Configure `AI_VISION_PROVIDER=openai`, `AI_VISION_MODEL` and secure `OPENAI_API_KEY` for actual analysis; mock mode remains explicitly labeled. The curated library and deterministic tools need none of those paid-provider keys. Smoke-test upload/consent/review and each `/tools` flow after deployment. No live deployment, bucket connection or paid OpenAI request is claimed here.
