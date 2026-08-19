---
id: 01M0CFQ9GFRWGZBW08HDAC24VS
type: semantic
provenance_class: direct-user-statement
volatility: slow
valid_from: '2026-08-19'
evidence:
- file:/home/cowen/Projects/change-two/INITIAL-BUILD.md
- file:/home/cowen/Projects/change-two/docs/adr/0001-separate-private-evaluator.md
- file:/home/cowen/Projects/change-two/docs/adr/0002-append-only-evidence-provenance.md
- user:accepted grilling recommendations on 2026-08-19
status: confirmed
workspace: /home/cowen/Projects/change-two
recorded_at: '2026-08-19T07:45:40.367Z'
---

Change Two initial build decisions accepted on 2026-08-19: build through one end-to-end unmeasured Change 0 dry run; keep MVP.md authoritative for product/protocol and INITIAL-BUILD.md for implementation; use Node LTS/pnpm, React+Vite, Fastify, PostgreSQL+Drizzle, Vitest, Playwright, Docker Compose, Claude Code and Codex CLI adapters, and an Astro static results site; keep public components in one monorepo and sealed future requirements/measured hidden evaluation in a private evaluator repository; use append-only capture events plus immutable versioned materialized evidence bundles; publication sanitization is fail-closed and unsanitized evidence has a 30-day default retention window.
