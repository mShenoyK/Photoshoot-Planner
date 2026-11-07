# FC-015–016 implementation and acceptance report

Scope stops at Lighting Lab and Wardrobe Stylist. Existing auth, consent/photo intake, equipment, knowledge, queue and AI plan flows are preserved. No commits, pushes, environment publication or deployment were performed.

## Delivered behavior and files

- `packages/shared/src/styling.ts`: strict scene, lighting, outfit, observation, revision and action contracts; `lighting-svg.ts`: original deterministic vector top view and side elevation. Only escaped text and validated numbers enter SVG; no book illustrations, external URLs, scripts or user photos.
- `apps/web/lib/styling-rules.ts`: bounded context-aware lighting, specialized monochrome recipe, natural/window/open-shade/backlight guidance, flash inventory and modifier checks, optional second fill, mixed ambient/WB/spill advice. Settings are unmetered starting points. Face heights and distances are illustrative, with supported seating, guardian support and face-plane checks.
- The wardrobe rules produce exactly three original garment/accessory choices per manual subject. They use stated colors, avoided colors, fit/size/comfort, budget, cultural/style and mobility notes, scene, occasion and light. Palette color weight varies across people. No personality, identity, measurements, skin undertone or photo-derived traits are inferred. Uncertain user-reported colors/fabrics/fit are editable; rebalance applies them. Locked looks remain byte-for-byte intact; a swapped unlocked hero can anchor the group. Preferences conflicting with retained colors require correction.
- `styling-service.ts` and `styling-routes.ts`: owner-scoped transactional append-only snapshots, optimistic conflicts, exact subject membership, per-section staleness and authenticated SVG attachments. Existing approved plan snapshots are untouched; styling revisions are independently selected. Existing ShootWorkspace JSON stores these validated records; no schema reset/migration is needed.
- `components/styling-studio.tsx`, lighting/wardrobe pages, wizard/plan links and responsive CSS: loading/error/empty/busy states, accessible labels, keyboard controls, revision selector, coordinate editor, three-choice cards, observations, hero and lock/swap/rebalance. Browser/unload guards protect unsaved edits. Historical revisions are read-only.

## Source provenance and acceptance boundary

A workspace search found the main implementation specification, but not the separate `stacked_family_portrait_lighting_guide.md` or `AI_Apparel_Recommendation_Workflow(1).md`. The implementation follows their recipe/workflow as explicitly recorded in specification §§7–8. The curated monochrome recipe uses M, ISO 100, f/8, 1/160 s, 85–105 mm when the recorded lens supports it, a gridded key, optional weak fill and dark backdrop. This is a spec-derived reconstruction, not verified original lighting. The UI records that provenance, without fabricated document/page/chunk citations. Verifying/ingesting the actual two guides remains an open acceptance item.

## Test and security evidence

- Default unit/integration suite: 56 passed; 6 opt-in infrastructure checks skipped without local environment variables.
- Disposable local PostgreSQL suite: 5 passed using real parameterized SQL/transactions and a pg transport stand-in for the unavailable generated Prisma engine. Includes styling persistence, cross-owner denial and competing same-revision mutations: exactly one commits. The test database was dropped afterward. This does not establish external Render connectivity or a real Prisma client integration.
- Full Playwright suite: 15 passed, including new four-person mixed-adult/child no-photo scenarios at 375 px and 1440 px. Assertions cover eight subject markers across two views, recipe settings, persisted coordinate revision, actual SVG download event, 12 outfit cards, selection/lock/rebalance, editable comfort notes, reload persistence, zero photo assets and no horizontal overflow.
- Styling tests additionally exercise deterministic escaped SVG, exact IDs, natural/window/mixed fallbacks, absent equipment, malformed bounds, excess flashes, immutable old versions, stale sections, hero retention, color conflicts and foreign owner/subject access to read/write/download endpoints.
- Lint, strict typecheck and production build pass. Existing photo consent/guardian/revocation tests continue to pass. Styling does not invoke a vision provider, read an image or bypass consent to process identifiable bytes; manual observations are the local fallback.

Screenshots from actual browser runs (synthetic manual profiles only):

- `/tmp/framecraft-lighting-375.png`, `/tmp/framecraft-lighting-1440.png`
- `/tmp/framecraft-wardrobe-375.png`, `/tmp/framecraft-wardrobe-1440.png`

## Configuration and limitations

No new credentials are required for these local deterministic features. PostgreSQL, private S3, Redis/worker and production auth setup retain their previously documented configuration/verification gates. The user's external database and live providers remain unverified; no credentials were added to source.

No automated photo observation/vision, retailer inventory, purchase links or body/personality inference is provided. Garment suggestions are editable through manual preferences/notes and selection; a free-form outfit garment editor is not included. Real wardrobe/lighting quality still needs photographer/stylist review, practical room measurements, lens/flash sync validation and test exposures. Side elevation projects lateral position and height and intentionally omits depth. SVG coordinates can be edited as JSON; drag-and-drop is FC-023. The wardrobe uses deterministic palettes rather than a trained optimization model.

Styling history is stored in the same private shoot aggregate; a later retention/normalization strategy is needed for very long histories. Full PDF/MD/ZIP exports and immutable version-addressed file artifacts remain FC-018–019. No deployment, GitHub remote CI or external integration is claimed.

Local functional/security gates pass. Guide-specific source verification and production/photographer validation remain open. Next issues: FC-017, FC-018, FC-019; stop before implementing them.

## Subsequent source review (2026-11-07)

Both missing Markdown guides were subsequently attached and read in full as reference data. Their task checklists and later commerce/research proposals do not expand the user's implementation scope. Original attachments remain outside tracked source. SHA-256 fingerprints:

- `stacked_family_portrait_lighting_guide.md`: `5a3c120f55e4f3e479b39fc05f566c559c64161879372ca5f4ec53f6860e1f39`
- `AI_Apparel_Recommendation_Workflow.md`: `047e3740b5e7dda378aa48cf0f46692f9016fa6e78a3db7942a2606cca5cbab6`

The monochrome diagram now starts with a key 10–20° camera-left, approximately 0.9–1.2 m from the group plane, and optional near-axis fill. Guidance adds above-face/downward tilt, 1.5–2 stops weaker diffused fill, second-flash-OFF and ambient-only checks, RAW, optional f/7.1 after depth-of-field checks, backdrop separation, grid coverage and restrained monochrome processing. The source example has **three faces**; four-person support-and-spacing geometry is clearly labeled as an adaptation requiring coverage checks. Both output provenance strings identify the reviewed source and sections. No ingested document/chunk/page IDs are invented: owner-authorized ingestion/rights review remains separate from this human source review.

A targeted regression verifies the key angle/distance and the three-face adaptation notice. After this correction lint/typecheck/build and 57 tests passed (6 infrastructure tests skipped by default). Later milestone reports supersede totals.
