# Change Two

> Anyone can generate version one. What happens next?

Change Two is a public experiment about how coding-agent software changes over time. It follows several implementations of the same application through the same sequence of product changes.

Each implementation starts from one verified repository commit. It retains every technical decision from earlier changes. The experiment records requirements, agent trajectories, human interventions, patches, costs, verification results, and confirmed defects.

The website will make this evidence understandable. The repository commits and evidence bundles remain the source of truth.

## Research question

Season 0 asks:

> Across four application changes, how do minimal-intervention and actively reviewed lineages differ in correctness, security, human effort, and cumulative change cost?

Season 0 is a case-study pilot. It will not produce a universal model ranking or claim statistical significance.

## Experiment outline

The pilot application is a multi-tenant customer-support inbox. Four changes apply increasing pressure to its design:

1. **Support inbox:** Add conversations, replies, resolution state, and tenant isolation.
2. **Assignment:** Add conversation ownership and filtered inbox views.
3. **Teams and scoped access:** Add team membership, schema migration, and cross-cutting authorization.
4. **Incident response:** Reproduce and repair a stale-state access defect without weakening tenant isolation.

The pilot compares four Lineages:

- One coding agent with minimal intervention
- The same agent and model with active human review
- A second coding agent with minimal intervention
- An experienced human developer as a reference Lineage

Every eligible Lineage receives the same Change in the same Round. Future Changes and Hidden Checks stay sealed until their scheduled release.

## Evidence

Each Run will publish a sanitized Evidence Bundle that includes:

- The requirement and environment
- The captured trajectory and human interventions
- The submitted patch and repository state
- Model usage, cost, wall-clock time, and human active time
- Visible and Hidden Check results
- Reviewer findings and artifact checksums

Published bundle bytes are immutable. A correction creates a new Bundle Revision and preserves the previous revision and checksums.

Automated scanner alerts do not count as confirmed security defects without reproduction or expert validation.

## Current status

The deterministic workspace and starter runtime are implemented. No measured Season 0 Run has started.

The initial build ends after one accepted, unmeasured Change 0 dry run. That dry run must exercise the runner, evaluator, evidence pipeline, sanitizer, and static results site in clean environments.

The next work package is **WP2: Protocol schemas and evaluation matrix** in [`INITIAL-BUILD.md`](./INITIAL-BUILD.md).

## Local setup

The repository pins Node.js, pnpm, and runtime container images. The repository commands require Docker, Bash, and standard POSIX utilities.

```bash
./change-two bootstrap
./change-two starter up
```

The starter is available at:

- Web: `http://localhost:4173`
- API health: `http://localhost:4300/health`
- PostgreSQL: `localhost:55432`

Stop the runtime with:

```bash
./change-two starter down
```

Copy `.env.example` to `.env` only when you need different host ports. The example contains no credentials.

## Repository commands

```text
./change-two bootstrap
./change-two starter up|down|status|logs
./change-two check
./change-two package starter-api|starter-web build|typecheck
./change-two verify starter|reproducible-build
```

`check` runs strict TypeScript checks and production builds in a clean container. `verify starter` exercises the running web, API, empty feature surface, and PostgreSQL. `verify reproducible-build` runs two uncached clean builds and compares their application artifacts.

## Architecture

The public repository uses or will add:

- Node.js LTS and pnpm workspaces
- React and Vite for the starter client
- Fastify for the starter API
- PostgreSQL and Drizzle for data and migrations
- Vitest and Playwright for visible verification
- Docker Compose for the local runtime
- Direct Claude Code and Codex CLI runner adapters
- Astro for the static results site

A separate private evaluator repository will hold future requirements, measured Hidden Checks, and defect fixtures. Those files must never enter an agent workspace or public artifact before release.

## Documentation

- [`MVP.md`](./MVP.md) defines the product, protocol, scope, and success criteria.
- [`INITIAL-BUILD.md`](./INITIAL-BUILD.md) defines the implementation boundary, architecture, work packages, and acceptance gates.
- [`CONTEXT.md`](./CONTEXT.md) defines the canonical experiment language.
- [`docs/adr/0001-separate-private-evaluator.md`](./docs/adr/0001-separate-private-evaluator.md) records the repository secrecy boundary.
- [`docs/adr/0002-append-only-evidence-provenance.md`](./docs/adr/0002-append-only-evidence-provenance.md) records the evidence provenance model.

## Public repository safety

Treat every committed file, path, fixture, prompt, transcript, and generated artifact as public.

Do not commit:

- Credentials or provider authentication material
- Local `.env` files
- Private user paths or unrelated session history
- Future requirements
- Unreleased Hidden Checks or evaluator fixtures
- Unsanitized trajectories or quarantined evidence

The `.gitignore` blocks common local and restricted paths. It is not a security control. Review staged content before each public commit.

## Contributing

The protocol must remain stable once measured execution starts. Before that point, changes should preserve the product question and update the owning document.

Implementation changes must satisfy the work-package acceptance criteria in `INITIAL-BUILD.md`. Hidden checks must test observable behavior and security invariants, not preferred file names, symbols, or architecture.

Run `./change-two check` before submitting a change. Use the package diagnostic commands only to isolate failures. The repository commands remain the acceptance seam.

## License

No project license has been selected. Until a license file is added, copyright law reserves all rights.
