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

The deterministic workspace and infrastructure-only starter are implemented. No measured Season 0 Run has started.

The initial build ends after one accepted, unmeasured Change 0 dry run. That dry run must exercise the runner, evaluator, evidence pipeline, sanitizer, and static results site in clean environments.

The starter contains only deterministic Users, Organizations, memberships, and server-side sessions. Its support-inbox surface is intentionally empty.

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

### Starter database and Visible Checks

`starter up` applies the inspectable Drizzle migrations and deterministic seed before it starts the API. The same operations are available independently and are safe to repeat:

```bash
./change-two starter migrate
./change-two starter seed
```

Run the HTTP authorization and clean-seed checks, including the controlled tenant-authority mutation, with:

```bash
./change-two verify starter-http
```

Run the Playwright identity-selection and Organization visibility flow with:

```bash
./change-two verify starter-browser
```

The test login surface is enabled only by the local starter environment. It sets an opaque, HTTP-only cookie backed by a server-side session. Organization access is derived from that authenticated User on every request; client-supplied identity or membership fields provide no authority.

## Isolated runner

The runner prepares an exact detached Git commit in a disposable workspace, mounts only the declared Change as read-only input, and executes the selected harness in a resource-limited container. Claude Code and Codex use one harness interface; provider-native JSON remains attached to normalized Capture Events. The runner applies one total wall-clock Budget across execution and recovery, runs only declared Visible Checks, and finalizes the current patch without repair.

Run a versioned Run Plan and keep the resulting `capture.jsonl`, `submitted.patch`, `result.json`, and `run.json`:

```bash
./change-two runner execute path/to/run-plan.json runs/private/run-id
./change-two verify runner
```

Administrative commands append explicit operator or reviewer timer intervals, corrections, and policy-checked Interventions. `manual-budget-stop` records the Intervention before it stops the active harness container. Host environment variables reach the agent only when the Run Plan names them in `credentialEnvironment`.

## Repository commands

```text
./change-two bootstrap
./change-two starter up|down|status|logs|migrate|seed
./change-two protocol validate|validate-matrix <document.json>
./change-two protocol check-fixtures
./change-two evidence materialize <capture.jsonl> <bundle-dir>
./change-two evidence replay <capture.jsonl> <bundle-dir>
./change-two evidence verify <bundle-dir>
./change-two evidence correct <capture.jsonl> <previous-bundle-dir> <new-bundle-dir> <correction.json>
./change-two runner execute <plan.json> <output-dir>
./change-two runner timer-start|timer-stop|timer-correct|intervene ...
./change-two check
./change-two package starter-api|starter-web|protocol|evidence|runner build|typecheck|test
./change-two verify runner|starter|starter-http|starter-browser|reproducible-build
```

`check` runs strict TypeScript checks, production builds, and database-independent tests in a clean container. `verify runner` uses the pinned Node.js binary and real Docker daemon to exercise the repository CLI, workspace isolation, success, recovery, exhaustion, Adapter failure, hard wall-clock termination, manual Budget stop, policy validation, timers, corrections, provenance, and immutable Submission capture. `verify starter` exercises the running web, API, empty feature surface, and PostgreSQL. `verify starter-http` resets the observable PostgreSQL schemas, migrates, seeds repeatedly, checks session-backed tenant access, and proves the tenant baseline rejects a controlled membership defect. `verify starter-browser` runs the deterministic identity and Organization flow in Chromium. `verify reproducible-build` runs two uncached clean builds and compares their application artifacts.

## Protocol validation

Versioned JSON Schemas define Season, Round, Run, Lineage, Change, Policy, Budget, Criterion, Check, Outcome, Protocol Deviation, confidence, and review records.

Validate all accepted and rejected fixtures:

```bash
./change-two protocol check-fixtures
```

Validate a protocol document or evaluation matrix:

```bash
./change-two protocol validate fixtures/protocol/valid/season-manifest.json
./change-two protocol validate-matrix requirements/released/change-0/evaluation-matrix.json
```

Validation errors identify the failing JSON path and rule. The Change 0 matrix rejects missing coverage, broken references, duplicate identifiers, orphan Checks, and structural-only coverage for severity-blocking Criteria.

## Evidence bundles

Capture Events use independently versioned schemas under `schemas/evidence/v1`. Event sequence numbers must start at one and remain contiguous; wall-clock timestamps do not determine ordering. Artifact paths are relative to the capture and must remain under `artifacts/`.

Materialize or deterministically replay a capture, then verify the result:

```bash
./change-two evidence materialize fixtures/evidence/accepted/capture.jsonl /tmp/change-two-bundle
./change-two evidence replay fixtures/evidence/accepted/capture.jsonl /tmp/change-two-replay
./change-two evidence verify /tmp/change-two-bundle
```

Materialization and replay refuse to overwrite an existing directory. Verification rejects missing or undeclared files, invalid schemas, broken evidence links and artifact references, non-contiguous sequences, and checksum changes. `checksums.json` covers itself with the schema-defined `self-canonical` mode: verification hashes the canonical manifest with only its own digest zeroed.

Corrections require a new capture whose manifest declares the new revision identifier, a verified previous bundle, a new output directory, and correction metadata:

```bash
./change-two evidence correct fixtures/evidence/correction/capture.jsonl /tmp/change-two-bundle /tmp/change-two-bundle-r2 fixtures/evidence/correction/request.json
```

The generated `revision.json` links the superseded and current content checksum sets and lists changed artifacts. The correction command verifies but never writes the previous bundle.

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
- [`requirements/released/change-0/evaluation-matrix.json`](./requirements/released/change-0/evaluation-matrix.json) maps Change 0 Criteria and invariants to visible and sealed Hidden Checks.
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
