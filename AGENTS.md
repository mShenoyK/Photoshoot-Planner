# FrameCraft working rules

Read FrameCraft_AI_Codex_Implementation_Plan.md and docs/ARCHITECTURE.md first. Work only on the current milestone. Each cloud task is isolated: use this checkout; do not create worktrees unless requested.

Use strict TypeScript, shared Zod schemas, semantic HTML, accessible labels and design tokens. Authorize every record by authenticated owner. Never trust a supplied ownerId. Preserve API envelopes and optimistic concurrency. Keep provider credentials server-side. Never commit photos, source PDFs, ingestion originals, .env files, or credentials. Mock external services in tests and label generated guidance honestly. Citations must resolve to ingested documents/chunks. Consent must precede image processing; no sensitive inference.

Run pnpm lint, pnpm typecheck, pnpm test, pnpm build and relevant Playwright tests. Review migrations; never reset a non-test database. Summarize changed files, evidence, limitations, configuration needs and next issue IDs. Do not claim deployments, CI or remote integrations work without testing them.
