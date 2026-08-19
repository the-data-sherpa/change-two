# Change Two: Initial Build

**Status:** Approved build contract  
**Product source:** [`MVP.md`](./MVP.md)  
**Boundary:** Protocol freeze through one accepted, unmeasured Change 0 dry run

## 1. Purpose and authority

This document converts the Change Two MVP into executable construction work for a coding agent operating under human review. It defines the initial system, build order, gates, and proof required before measured Season 0 execution.

`MVP.md` remains authoritative for product purpose, experiment protocol, scope, and claims. This document is authoritative for implementation choices, component boundaries, repository topology, work packages, and build verification. Resolve contradictions by amending the document that owns the concern; do not silently choose one.

This document is a stable build contract, not a live issue tracker. Track transient task status elsewhere. Amend a disproved assumption with a dated decision; do not accumulate progress notes here.

## 2. Initial-build boundary

### Included

The initial build delivers:

- A frozen Season 0 protocol and versioned manifest schemas
- A verified support-inbox starter application
- Separate visible and dry-run hidden evaluation suites
- Direct runner integrations for Claude Code and Codex CLI
- Disposable, isolated run workspaces
- Structured trajectory, intervention, usage, verification, and repository-state capture
- Versioned evidence bundles and append-only corrections
- Fail-closed automated and human sanitization
- A static public results site built from validated evidence
- One disposable, unmeasured Change 0 practice lineage through the complete pipeline
- Reproduction of the dry-run evaluation in a second clean environment

### Excluded

The initial build does not include:

- Measured Season 0 runs
- The Season 0 hidden evaluation suite in any agent-accessible repository
- Changes 1–3 execution
- A public harness plugin API
- User accounts, community submissions, or a production database for the results site
- A universal leaderboard or composite quality score
- Calendar estimates

### Completion demonstration

The initial build is accepted only when one disposable practice lineage:

1. Starts from the frozen starter commit.
2. Receives Change 0 without future requirements or measured hidden checks.
3. Runs under a declared policy and budget in an isolated workspace.
4. Produces a complete captured submission and evidence bundle.
5. Is evaluated in a fresh environment using a separate dry-run hidden suite.
6. Passes publication sanitization, including detection of seeded synthetic credentials and private paths.
7. Renders on the results site from validated normalized evidence.
8. Reproduces the reported evaluation on a second machine or clean container.

Practice evidence must remain private or carry an unmistakable `practice` designation. It must never appear as a measured Season 0 result.

## 3. Frozen technical decisions

### Application stack

- Node.js LTS, pinned in the runtime image
- pnpm workspaces, pinned through Corepack
- TypeScript with strict checking
- React client built with Vite
- Fastify API
- PostgreSQL
- Drizzle ORM and inspectable SQL migrations
- Vitest for unit and integration checks
- Playwright for browser checks
- Docker Compose for the local multi-service runtime

The separate browser and API boundary is intentional. Change 3 tests stale browser state and server authorization; the system must not obscure which side enforces access.

### Authentication

Use deterministic local test identities selected through a test-only login surface. The server establishes the authenticated identity and session. Client-provided user, organization, membership, or team identifiers are never authentication evidence.

External identity providers and production credential flows are outside the experiment.

### Agent harnesses

The runner directly integrates:

- Claude Code
- Codex CLI

Exact harness versions, model snapshots, system instructions, enabled tools, and permissions are required freeze-time manifest values. The architecture must not hard-code transient model identifiers.

### Results publishing

- Astro static site
- React islands only where trajectory or patch interaction requires them
- No production application database
- Small manifests, schemas, checksums, and normalized summaries stored in Git
- Complete immutable evidence bundles published as GitHub Release assets
- Every published bundle linked by repository commit, release URL, and checksum

## 4. Domain and repository boundaries

Canonical experiment language is defined in [`CONTEXT.md`](./CONTEXT.md).

Use two repositories:

### Public `change-two` monorepo

Contains:

- Starter client and API
- Released requirements and visible checks
- Public protocol and evidence schemas
- Runner and harness adapters
- Sanitizer
- Results site
- Released normalized summaries, manifests, and checksums
- Released evaluation material after its embargo ends

### Private `change-two-evaluator` repository

Contains:

- Future unreleased requirements
- Measured Season 0 hidden checks
- Dry-run hidden checks
- Defect fixtures and known-correct references
- Evaluation orchestration
- Invalidation and reviewer records not yet cleared for publication

Future requirements and hidden checks must never be copied into an agent workspace, container layer, mounted parent directory, prompt, retained harness session, or public build artifact. The private evaluator checks submitted commits out into fresh disposable environments and never repairs them.

## 5. System architecture and data flow

```text
sealed protocol + starting commit
                |
                v
        runner prepares workspace
                |
                v
 agent harness -> append-only capture -> submitted commit/patch
                |                         |
                |                         v
                |                 fresh hidden evaluator
                |                         |
                +-------------------------+
                              |
                              v
                  materialized evidence bundle
                              |
                              v
                 quarantine -> sanitize -> review
                              |
                              v
                  immutable release + static site
```

### Source of truth

Repository commits, append-only capture events, immutable referenced artifacts, and released bundle bytes are authoritative. Bundle JSON files are versioned materialized views. The results site is a consumer, never the source of truth.

### Runner responsibilities

The runner must:

- Resolve the required starting commit and verify its checksum
- Create a disposable container and writable workspace
- Apply the declared harness, model, instructions, tools, policy, and budget
- Restrict mounts, credentials, network access, and resources
- Deliver only the current requirement and visible checks
- Capture ordered events, artifacts, usage, interventions, and repository state
- Execute the documented visible verification after agent completion
- Return visible failures only while recovery attempts remain
- Finalize the submitted commit and patch without repairing them
- Materialize the initial quarantined evidence bundle

### Evaluator responsibilities

The evaluator must:

- Run outside the agent-accessible repository and workspace
- Check out the exact submitted commit in a fresh environment
- Verify environment and artifact provenance before execution
- Run functional, migration, regression, and security checks
- Capture deterministic reproduction artifacts
- Produce normalized hidden results without modifying the submission
- Distinguish failed checks from evaluator errors

### Sanitizer responsibilities

The sanitizer must:

- Scan structured fields and referenced artifacts
- Detect credentials, authentication material, private paths, unrelated session history, and unreleased checks
- Apply deterministic redaction where safe
- Quarantine uncertain content rather than publishing it
- Record every transformation and the source-artifact checksum
- Require a human publication review

Restricted unsanitized evidence is retained for 30 days after sanitized publication, then destroyed unless a documented incident hold applies. Record destruction or hold in administrative metadata.

## 6. Security and experimental-integrity invariants

The build is unacceptable if any invariant below is unverified:

1. **Future-material isolation:** agents cannot access future requirements or measured hidden checks.
2. **Fresh evaluation:** hidden evaluation runs from the submitted commit in a new environment.
3. **Submission immutability:** evaluation never repairs or alters lineage state.
4. **Tenant authority:** authenticated server state determines identity and organization membership.
5. **Credential isolation:** run credentials are scoped, disposable, and absent from public artifacts.
6. **Fail-closed publication:** uncertain sanitization blocks publication.
7. **Evidence traceability:** every summary fact resolves to captured evidence and checksums.
8. **Policy traceability:** every human intervention has text, category, timing, and policy basis where required.
9. **Budget honesty:** enforcement and measurement coverage are stated, not inferred.
10. **Comparable ordering:** the season uses a precommitted balanced lineage order and records its generation seed.

Network access for hosted model providers and dependency retrieval may prevent full determinism. Allow only named endpoints where technically practical and record actual access or coverage gaps.

## 7. Public monorepo layout

```text
change-two/
├── apps/
│   ├── starter-web/
│   ├── starter-api/
│   └── results/
├── packages/
│   ├── evidence/
│   ├── protocol/
│   ├── runner/
│   └── sanitizer/
├── requirements/
│   └── released/
├── evidence/
│   └── released/
├── schemas/
├── docs/
│   └── adr/
├── CONTEXT.md
├── INITIAL-BUILD.md
├── MVP.md
├── pnpm-workspace.yaml
└── package.json
```

Do not add empty packages or placeholder abstractions. Create each path only when its first accepted work package requires it.

The repository CLI must expose explicit orchestration commands equivalent to:

```text
bootstrap
starter up
check
run prepare
run execute
evaluate
sanitize
bundle verify
site build
```

Names may follow the implemented CLI convention, but the behaviors must remain distinct and scriptable. Keep lower-level package commands available for diagnosis.

## 8. Protocol and evidence contracts

### Protocol identifiers

Use stable, machine-readable identifiers for seasons, rounds, lineages, runs, policies, budgets, requirements, acceptance criteria, checks, artifacts, and bundle revisions.

Every acceptance criterion receives an identifier such as `C0-AC-03`. Every visible and hidden check declares the criteria or invariant it covers. A versioned evaluation matrix must detect:

- Acceptance criteria with no check
- Checks with no declared criterion or invariant
- Severity-blocking criteria covered only by structural assertions
- Duplicate or unstable identifiers

### Capture model

The provenance layer is an append-only event stream plus immutable referenced artifacts. Events require:

- Schema version and event identifier
- Run identifier
- Ordered monotonic sequence
- Wall-clock timestamp and monotonic elapsed time
- Source and event type
- Sanitization classification
- Inline payload or artifact reference
- Usage provenance when available

Provider-native events may be retained as referenced artifacts, but normalized events must preserve their provenance and must not claim fields the provider did not supply.

### Materialized bundle

Each run produces the bundle required by `MVP.md`:

```text
runs/<season>/<lineage>/<change>/
├── manifest.json
├── requirement.md
├── environment.json
├── trajectory.jsonl
├── interventions.jsonl
├── submitted.patch
├── repository-state.json
├── costs.json
├── visible-results.json
├── hidden-results.json
├── reviewer-findings.json
├── summary.json
└── checksums.json
```

Each file has an independent versioned JSON Schema where applicable. `checksums.json` covers every file and externally referenced artifact. Bundle verification rejects missing, extra undeclared, invalid, or checksum-mismatched material.

### Corrections

Published bytes are immutable. A correction creates a new Bundle Revision containing:

- New revision identifier and checksum
- Superseded revision identifier and checksum
- Correction reason
- Author and timestamp
- Changed artifacts

The results site displays the latest accepted revision and exposes the revision history. Never overwrite or conceal a released bundle.

### Costs and budgets

Represent each budget dimension with a measurement mode:

- `enforced`
- `estimated`
- `observed-after-run`
- `unavailable`

Enforce wall-clock and explicit human timers automatically. Use provider-reported spend and usage where available; otherwise use a documented conservative estimate and manual hard-stop procedure. A manual stop is an Intervention.

Human active time uses explicit monotonic start/stop intervals tied to interventions. Corrections append a record; they do not overwrite the original interval. Human time, model spend, subscription costs, and wall-clock time remain separate.

## 9. Execution semantics

### Lineage advancement

Every evaluable Submission advances its Lineage, including a Degraded result. A Blocked Run advances its unchanged starting commit unless it produced an explicit evaluable Submission. Human repair between rounds is prohibited.

An Invalid Run may be rerun from the same starting commit after reviewer approval because its failure was independent of the Lineage. Agent mistakes, agent-selected dependencies, budget exhaustion, and failure to diagnose are not invalidation grounds.

### Visible verification and recovery

After the agent declares completion, the runner executes the documented visible suite once. If it fails and recovery attempts remain, return the visible output to the agent and increment the recovery counter. Submission occurs after a passing final visible run or after budget/recovery exhaustion. Hidden results are never returned to the Lineage.

### Starter defects

A starter defect discovered after measured execution begins pauses the affected Round. Assess whether it materially affects comparability or acceptance:

- Material defect: invalidate every affected Run and restart from a newly sealed starter revision.
- Immaterial defect: preserve submissions and record a Protocol Deviation and rationale.

Never silently patch Lineage repositories.

### Run order

Precommit a balanced order that rotates early and late execution positions across Lineages. Store the generation algorithm and seed in the Season Manifest.

## 10. Implementation work packages

Work packages are ordered by dependency. Packages at the same level may proceed in parallel only when their interfaces below are frozen.

### WP1 — Workspace and deterministic toolchain

**Produces:** pinned Node and pnpm setup, workspace configuration, local dependency services, common check commands, reproducible container image.  
**Depends on:** none.

**Acceptance:**

- A clean checkout bootstraps using one documented command.
- Lockfile and image inputs are pinned.
- Repeated clean builds produce the same application and schema outputs, excluding documented nondeterministic metadata.
- No starter feature domain is introduced.

### WP2 — Protocol schemas and evaluation matrix

**Produces:** Season, Run, policy, budget, requirement, criterion, check, outcome, and deviation schemas; validation CLI; Change 0 criterion matrix.  
**Depends on:** WP1.

**Acceptance:**

- Valid examples pass and malformed boundary cases fail.
- Every Change 0 criterion maps to a visible or dry-run hidden check.
- No check requires a preferred symbol, file layout, or architecture.
- Freeze-time fields cannot be omitted from a sealed manifest.

### WP3 — Starter client, API, and deterministic identity

**Produces:** application shells, PostgreSQL migrations, `User`, `Organization`, and membership model, seed data, deterministic login, empty support-inbox feature area.  
**Depends on:** WP1 and the identity contract in WP2.

**Acceptance:**

- Two organizations and multiple memberships can be selected deterministically.
- Server sessions establish identity without trusting client identity fields.
- Cross-organization fixture access is denied at the server boundary.
- Repeated seeding yields stable identifiers and state.
- No conversation, message, assignment, team, audit, or notification model exists.

### WP4 — Starter verification harness

**Produces:** unit, integration, and Playwright harnesses; exact build, type-check, and targeted-check commands; clean-environment baseline.  
**Depends on:** WP3.

**Acceptance:**

- The starter passes repeatedly from a clean database and container environment.
- A deliberate tenant-boundary defect fails the corresponding baseline check.
- Browser checks use deterministic identities and seed data.

### WP5 — Append-only capture and evidence library

**Produces:** normalized event schema, artifact store contract, independent bundle schemas, materializer, checksum and revision verifier.  
**Depends on:** WP1 and WP2.

**Acceptance:**

- Replaying one captured fixture produces an equivalent normalized bundle.
- Unknown provider fields remain attributable without being invented as normalized facts.
- Missing artifacts, sequence violations, schema violations, and checksum changes fail verification.
- A correction preserves and links the superseded revision.

### WP6 — Isolated runner core

**Produces:** workspace preparation, container policy, requirement delivery, timers, budget state machine, visible-verification recovery loop, submission finalization, administrative CLI.  
**Depends on:** WP2, WP4, and WP5.

**Acceptance:**

- A fixture Run receives only its declared requirement and visible checks.
- Forbidden parent paths and credentials are unavailable inside the workspace.
- Timeout and recovery exhaustion finalize the current state without repair.
- Declared and actual starting/submitted commits are captured.
- Each budget dimension reports its real measurement mode.

### WP7 — Harness adapters

**Produces:** direct Claude Code and Codex CLI adapters implementing one runner-owned lifecycle and capture contract.  
**Depends on:** WP6.

**Acceptance:**

- Each exact pinned harness completes the same synthetic task through the runner.
- Messages, tool events, usage coverage, termination, and final repository state normalize without losing source provenance.
- Adapter-specific failures remain distinguishable from Lineage failures.
- Unsupported usage fields are reported as unavailable, not zero.

### WP8 — Intervention and active-time capture

**Produces:** intervention UI or CLI, explicit timers, policy validation, correction records, operator and reviewer attribution.  
**Depends on:** WP2 and WP6.

**Acceptance:**

- Minimal-condition interventions require an allowed category and justification.
- Active review records exact sanitized text, category, and monotonic active seconds.
- A timer correction appends history and preserves the original.
- A manual budget stop is represented as an Intervention.

### WP9 — Dry-run hidden evaluator

**Produces:** private evaluation orchestration, separate Change 0 practice checks, fresh-environment execution, defect fixtures, known-correct reference, normalized hidden results.  
**Depends on:** WP2, WP4, and WP5.

**Acceptance:**

- Every severity-blocking check passes against the known-correct reference.
- Every severity-blocking check fails against at least one plausible defective fixture.
- Evaluation leaves the submitted repository byte-for-byte unchanged.
- Evaluator errors cannot be misreported as Lineage failures.
- No measured hidden check is present in the dry-run workspace or artifacts.

### WP10 — Fail-closed sanitization

**Produces:** classification rules, scanners, redaction records, quarantine state, human approval gate, retention and destruction records.  
**Depends on:** WP5.

**Acceptance:**

- Seeded synthetic API keys, authentication material, private paths, unrelated history, and unreleased check text prevent publication.
- Safe deterministic redaction retains evidence references and source checksums.
- Ambiguous findings remain quarantined.
- Publication cannot proceed without recorded human approval.

### WP11 — Static results site

**Produces:** Astro site, evidence ingestion and validation, season/run/change/lineage routes required for the dry-run surface, trajectory and patch viewers, revision history, raw artifact links.  
**Depends on:** WP2 and WP5.

**Acceptance:**

- The site builds only from schema-valid released evidence.
- Invalid schemas, broken checksums, and dangling references fail the build.
- Every rendered outcome and measure links to supporting evidence.
- Practice runs are visually and semantically distinct from measured results.
- The site needs no runtime database or application server.

### WP12 — Season 0 protocol freeze

**Produces:** signed or hash-addressed Season Manifest, sealed requirements, criterion matrix, balanced run order, publication policy, named roles, exact versions and budgets.  
**Depends on:** WP2, WP4, WP7, WP9, and WP10.

**Acceptance:**

- Every freeze-time value in Section 14 is concrete.
- Future requirements and measured hidden artifacts are sealed outside the public repository.
- Hashes can be verified without exposing sealed content.
- Builder and reviewer approve the freeze independently.

### WP13 — End-to-end practice lineage

**Produces:** one complete unmeasured Change 0 Run, evaluation, sanitized bundle, static publication build, and reproduction report.  
**Depends on:** WP7–WP12.

**Acceptance:** all completion-demonstration steps in Section 2 pass, and the dry-run gate in Section 12 is approved.

## 11. Verification matrix

| Contract | Required proof |
|---|---|
| Toolchain reproducibility | Bootstrap and build in two clean containers |
| Starter stability | Repeated clean baseline runs |
| Identity boundary | Server-side cross-organization denial scenario |
| Criterion coverage | Evaluation-matrix validator output |
| Hidden-check sensitivity | Known-correct and defective fixture results |
| Workspace isolation | Attempted forbidden file, mount, and credential access |
| Recovery semantics | Synthetic visible failure through attempt exhaustion |
| Evidence integrity | Replay, schema, sequence, artifact, and checksum verification |
| Correction integrity | New revision retaining superseded bytes and links |
| Sanitization | Seeded secret/path/history/unreleased-content quarantine |
| Static publication | Clean site build from released bundle only |
| Reproducibility | Evaluation repeated on second clean environment |

Tests must defend observable contracts and fail against plausible defects. Compilation, snapshots of source text, and assertions about preferred structure are insufficient proof.

## 12. Stage gates and human review

### Gate A — Starter accepted

Requires WP1–WP4 proof and reviewer confirmation that the starter contains infrastructure only, exposes exact commands, and is stable in clean environments.

### Gate B — Evidence pipeline accepted

Requires WP5, WP6, and WP8 proof. The reviewer verifies that reported facts remain traceable, unavailable usage is honest, and policies cannot be bypassed silently.

### Gate C — Evaluator accepted

Requires WP9 proof. The reviewer inspects criterion coverage, known-correct behavior, defective fixtures, fresh-environment execution, and submission immutability.

### Gate D — Publication safety accepted

Requires WP10 and WP11 proof. Automated scans and a human reviewer must both approve publication behavior.

### Gate E — Protocol frozen

Requires WP12 proof. No measured execution may begin after a partial freeze or while a required value is unresolved.

### Gate F — Dry run accepted

Requires WP13. The builder records commands, scenarios, artifacts, and observed results. The reviewer approves the complete path and all deviations. Protocol changes discovered by the practice run must be completed before Gate F; afterward, any change requires a new manifest revision and renewed approval.

The builder and reviewer are distinct roles. One person may fill both only when disclosed and when separate implementation and acceptance records are retained.

## 13. Dry-run procedure

1. Verify the frozen starter commit and practice manifests.
2. Create a disposable practice Lineage and isolated workspace.
3. Confirm future requirements, measured checks, unrelated credentials, and parent paths are inaccessible.
4. Start explicit wall-clock and human-time capture.
5. Deliver Change 0 and visible checks to one pinned harness.
6. Execute until submission, recovery exhaustion, or budget termination.
7. Finalize the submitted commit, patch, repository state, events, interventions, and costs.
8. Destroy the agent workspace after required quarantined capture is secured.
9. Evaluate the Submission in a fresh environment with the dry-run hidden suite.
10. Record operator and reviewer confidence before revealing hidden results.
11. Materialize and verify the evidence bundle.
12. Seed and exercise sanitization cases; retain the bundle in quarantine until automated and human review pass.
13. Publish the sanitized practice bundle to a non-measured release location or retain it privately with the same publication build inputs.
14. Build and inspect the static results surface from that bundle.
15. Reproduce evaluation and bundle verification on a second clean machine or container.
16. Record deviations and correct the protocol before accepting Gate F.

## 14. Required freeze-time values

Gate E cannot pass until the Season Manifest names:

- Starter repository commit
- Full hashes of all sealed requirement and hidden-evaluation artifacts
- Exact Claude Code and Codex CLI versions
- Exact model snapshots or provider identifiers
- System and repository instructions
- Enabled tools, permissions, and network policy
- Runtime image digest and dependency lockfile checksum
- Lineage definitions and operator identities
- Builder, operator, independent reviewer, and blinded reviewer roles
- Wall-clock, active-time, recovery, and model-spend budgets
- Budget measurement and enforcement modes
- Balanced Lineage order and generation seed
- Intervention policies and policy versions
- Evaluation matrix and outcome-classification version
- Confidence instrument version
- Publication, redaction, restricted-retention, and incident-hold policy versions
- GitHub repository and Release locations
- Known limitations and unavoidable provider drift

The dry run sets the model-spend ceiling. No measured Run may start until every value is concrete and the manifest is signed or hash-addressed.

## 15. Final-round blinded review contract

The initial build must support, but does not execute, a final-round blinded review of all four submitted patches with necessary surrounding repository state. Remove Lineage identifiers, trajectory data, costs, and interventions. Use a precommitted rubric for comprehensibility, extension risk, and suspected defects.

Implementation style or model fingerprints may remain recognizable; disclose that limitation rather than claiming perfect blinding.

## 16. Confidence instrument

Before hidden results are revealed, collect separately from the operator and active reviewer where applicable:

1. Probability that all acceptance criteria are satisfied.
2. Probability that no prior behavior regressed.
3. Probability that no severity-blocking authorization defect exists.
4. Expected number of hidden checks that will fail.
5. Free-text statement of the highest-risk assumption.

These answers are calibration evidence only. They do not affect evaluation or outcome classification.

## 17. Invalid runs and protocol deviations

A Run is Invalid only when a documented external failure prevents fair execution or evaluation, such as a provider outage, runner corruption, inaccessible required dependency, or verified starter defect. A reviewer must approve invalidation before rerun.

A Protocol Deviation records an actual departure from the sealed protocol, its cause, affected Runs, materiality assessment, reviewer decision, and remediation. Display material deviations prominently in public results.

## 18. Work-package completion records

For each work package, external tracking must record:

- Stable work-package identifier
- Status: `not-started`, `in-progress`, `blocked`, or `accepted`
- Dependencies satisfied
- Commands or scenarios exercised
- Artifact references
- Observed result
- Reviewer decision where required

A status assertion without its required proof cannot become `accepted`.
