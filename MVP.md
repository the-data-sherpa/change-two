# Change Two: MVP

**Status:** Draft for review  
**Product type:** Public longitudinal coding-agent experiment  
**Tagline:** Anyone can generate version one. What happens next?

## 1. Product summary

Change Two follows several implementations of the same application through a fixed sequence of product changes. Each implementation is a **lineage**. It starts from the same starter repository, receives the same requirements, and retains every prior technical decision.

For one four-change pilot season, the MVP will publish requirements, agent trajectories, interventions, patches, costs, verification results, and confirmed defects.

The product is the experiment and its evidence. The website exists to make that evidence understandable.

## 2. Problem

Coding-agent demonstrations and benchmarks primarily measure whether an agent can complete an isolated task. That misses the defining property of production software: it must continue changing.

Two implementations can pass the same initial tests while creating very different futures. One may establish coherent domain and authorization boundaries. Another may scatter rules across routes and UI components. Their difference often becomes observable only when a later requirement crosses those boundaries.

Teams therefore lack evidence for a practical purchasing and workflow decision:

> Which coding-agent workflows produce software that remains correct, secure, and economical as requirements evolve?

## 3. MVP objective

Run and publish one credible pilot season that determines whether longitudinal comparison reveals meaningful differences that isolated first-pass results conceal.

The MVP succeeds if it produces an evidence-backed answer to this narrower question:

> Across four application changes, how do minimal-intervention and actively reviewed lineages differ in correctness, security, human effort, and cumulative change cost?

The MVP is not intended to establish a universal ranking of models.

## 4. Audience

### Primary

- Developers using coding agents for real applications
- Engineering leads deciding how much review and verification agent work requires
- AI-tool builders studying agent failure and recovery
- Technical creators covering coding-agent capabilities

### Secondary

- Security engineers reviewing generated software
- Researchers designing software-engineering benchmarks
- Model and harness vendors

## 5. Product principles

1. **Trajectories over snapshots.** Preserve the history of every lineage. Never reset between changes.
2. **Evidence over judgment.** Every result links to requirements, patches, trajectories, and executable verification.
3. **Observable contracts over style preferences.** Evaluate behavior, security invariants, cost, and change surface, not preferred file layouts.
4. **Raw facts before aggregate scores.** Publish measurements and calculation rules. Avoid a synthetic quality number in the MVP.
5. **Precommit before execution.** Freeze requirements, hidden checks, budgets, and classifications before running lineages.
6. **Case study before generalization.** Describe pilot findings as results under this protocol, not universal model truths.
7. **Public by default, secrets never.** Treat every captured artifact as publishable. Use isolated credentials and sanitize artifacts before release.

## 6. Season 0 experiment

### 6.1 Application

The pilot application is a multi-tenant customer-support inbox.

It is suitable because it is visually understandable while exercising data modeling, state transitions, authorization, concurrency, migrations, and incident diagnosis.

### 6.2 Starter repository

The shared starter repository will provide:

- Web application shell
- Database and migration tooling
- Authentication with deterministic local test identities
- `User` and `Organization` models
- Organization membership
- Seed data
- Unit, integration, and browser-test harnesses
- Local containerized runtime
- Exact build, type-check, and targeted-test commands
- Empty feature area for the support inbox

The starter will not provide conversation, message, assignment, team, audit, or notification domain models.

Verify the starter before the experiment starts. If infrastructure defects appear after lineage creation, they invalidate affected runs unless the lineage caused them.

### 6.3 Change sequence

Agents cannot access future changes before their round starts.

#### Change 0: Support inbox

Allow an organization to receive customer conversations. Organization members can view the inbox, open a conversation, reply, and mark it resolved.

Key pressure:

- Initial domain model
- Tenant isolation
- Message ordering
- Conversation state
- Validation and tests

#### Change 1: Assignment

Allow conversations to be assigned to an organization member. Add `Assigned to me`, `Unassigned`, and `All` views.

Key pressure:

- Query composition
- Ownership representation
- State updates
- Concurrent assignment behavior

#### Change 2: Teams and scoped access

Allow organizations to create teams. Conversations belong to a team. Members can view only teams they have joined. Existing conversations must migrate without data loss.

Key pressure:

- Cross-cutting authorization
- Schema evolution
- Centralized versus scattered access rules
- Backward-compatible migration

#### Change 3: Incident response

Provide a reproducible report of a member accessing a conversation outside their permitted team after switching browser tabs. Diagnose and repair the root cause without losing data or weakening organization isolation.

Key pressure:

- Diagnosis under uncertainty
- Security-boundary comprehension
- Cache and stale-state behavior
- Root-cause repair
- Regression-test quality

The protocol reserves an audit-history change and a requirement reversal for a later season. Four changes keep the pilot bounded while still exposing cumulative effects.

### 6.4 Lineages

The MVP uses four lineages:

| ID | Implementation workflow | Purpose |
|---|---|---|
| `agent-a-minimal` | Frontier coding agent with minimal intervention | Vibe-coding condition |
| `agent-a-reviewed` | Same agent and model with active human review | Isolate the value and cost of review |
| `agent-b-minimal` | Second coding agent with minimal intervention | Check whether observations are agent-specific |
| `human-baseline` | Experienced developer using ordinary non-agent tooling. The developer may use autocomplete only if they record it. | Reference trajectory |

The exact agents, models, versions, and operator identities must be frozen in the season manifest before Change 0.

One run per lineage is acceptable for the pilot. Label the results as case studies. Do not make statistical significance claims.

### 6.5 Intervention policies

#### Minimal intervention

The operator may only intervene when:

- The agent explicitly requests information unavailable in the repository or requirement
- Authentication, provider, or runner infrastructure fails independently of the lineage
- Continuing would expose credentials, affect external systems, or damage files outside the isolated workspace

The operator may not suggest an implementation, identify a defect, request additional tests, or redirect exploration.

#### Active review

The reviewer may:

- Challenge or reject the plan
- Point out a missed requirement or unsupported assumption
- Request investigation, tests, or a smaller patch
- Reject an architectural decision or completed patch
- Ask for an explanation before accepting work

The reviewer may not write production code. Every intervention must record its timestamp, category, text, and active human time.

#### Human baseline

The developer receives the same requirement and visible checks. The developer cannot access hidden evaluation or future requirements. Include research, documentation, and ordinary development tools in active-time reporting.

### 6.6 Budgets

Each agent round receives:

- Maximum wall-clock time: 90 minutes
- Maximum operator active time in minimal condition: 5 minutes, limited to permitted interventions
- Maximum active reviewer time in reviewed condition: 30 minutes
- Maximum recovery attempts after visible verification failure: 3
- Model-spend ceiling: set in the signed season manifest after a dry run

The human baseline receives a four-hour active-time ceiling per change.

If a lineage reaches a budget, the runner ends the round. Evaluation uses the current repository state as submitted. Budget values may change before the season is sealed. They cannot change after the first measured run starts.

## 7. Evaluation

### 7.1 Evaluation layers

Each round has three distinct verification layers:

1. **Agent-visible checks:** Documented commands and acceptance scenarios available during implementation.
2. **Hidden automated checks:** Functional, regression, migration, and security scenarios unavailable to the implementer.
3. **Blinded review:** A reviewer evaluates selected final patches without knowing the lineage identity.

Hidden checks must test observable requirements and invariants. They must not require a preferred architecture, symbol name, file layout, or implementation technique.

### 7.2 Primary measures

#### Correctness

- Visible checks passed
- Hidden checks passed
- Prior checks regressed
- Acceptance criteria fully, partially, or not implemented
- Recovery attempts required

#### Confirmed security defects

- Cross-organization access
- Cross-team access
- Missing object-level authorization
- Unauthorized mutation
- Unsafe migration or data loss
- Security regression introduced by the current change

Report automated scanner alerts separately. They do not count as confirmed defects without reproduction or expert validation.

#### Cost

- Model and tool spend
- Wall-clock duration
- Human active time
- Reviewer active time
- Number of agent turns
- Failed verification cycles

Human time and model spend remain separate in the MVP. No invented conversion rate combines them.

#### Change surface

- Files changed
- Production lines added and removed
- Test lines added and removed
- Schema migrations
- Unrelated components modified
- Repeatedly modified hotspots

Change surface is descriptive evidence, not an automatic quality judgment.

### 7.3 Secondary measures

- Agent self-detection of defects
- Root-cause repair versus symptom patch
- Quality of regression tests
- Reviewer intervention categories
- Operator confidence before hidden evaluation
- Confidence calibration against observed results
- Blinded reviewer assessment of comprehensibility and extension risk

### 7.4 Outcome labels

Every lineage-change pair receives one outcome:

- **Clean pass:** Requirement and all severity-blocking hidden checks pass within budget.
- **Recovered:** Initial submitted work failed visible verification but was repaired within budget and passes final evaluation.
- **Degraded:** Main feature works, but a confirmed regression, security defect, or unmet acceptance criterion remains.
- **Blocked:** The lineage cannot produce an evaluable implementation within budget.
- **Invalid run:** Independent infrastructure or provider failure prevents a fair result.

The result page must show the raw facts behind the label.

### 7.5 Cumulative season result

The season overview reports, per lineage:

- Changes cleanly passed
- Changes recovered
- Changes degraded or blocked
- Confirmed security defects
- Cumulative model spend
- Cumulative human active time
- Cumulative wall-clock time
- Cumulative files and lines changed

The MVP will not publish a single weighted `0–100` score.

## 8. Precommitment and reproducibility

Before Change 0, create a signed or hash-addressed season manifest containing:

- Starter repository commit
- Full change documents
- Hashes of hidden evaluation artifacts
- Lineage definitions
- Agent, model, and harness versions
- System and repository instructions
- Enabled tools and permissions
- Runtime image and dependency versions
- Budgets
- Intervention policies
- Evaluation rules
- Outcome classification rules
- Known limitations

Only the manifest and hashes need to be public before execution. Future requirement contents and hidden tests remain sealed. Publish the sealed contents after the relevant round or season concludes.

A run manifest records the actual environment. Display deviations from the season manifest prominently.

## 9. Evidence contract

Each measured run produces an immutable evidence bundle:

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

Minimum field requirements:

### `manifest.json`

- Season, lineage, and change identifiers
- Starting and ending repository commits
- Agent, model, and harness versions
- Policy and budget identifiers
- Start and end timestamps
- Run status

### `trajectory.jsonl`

- Ordered timestamped events
- Event source
- Tool or message type
- Redacted payload or artifact reference
- Provider usage when available

### `interventions.jsonl`

- Timestamp
- Intervention category
- Exact sanitized intervention text
- Human active seconds
- Policy justification for minimal-condition interventions

### `costs.json`

- Provider-reported token usage
- Provider-reported or calculated model cost
- Tool subscription costs excluded from per-run cost, but disclosed at season level
- Human active seconds by role
- Wall-clock seconds
- Cost-source provenance and coverage gaps

### `hidden-results.json`

- Check identifier
- Requirement or invariant covered
- Pass, fail, skipped, or error
- Reproduction artifact
- Severity
- Whether the check existed before execution

Public bundles must never include credentials, provider authentication material, private user paths, or unrelated session history. Do not include hidden checks before their scheduled release.

## 10. Public product

### 10.1 Required pages

#### Season overview

- Experiment question and protocol
- Lineage comparison table
- Cumulative results
- Change timeline
- Disclosures and limitations
- Download links for season manifest and evidence bundles

#### Lineage timeline

- Repository evolution across changes
- Outcome for each change
- Cumulative cost and human time
- Confirmed defects
- Important technical decisions and their later consequences

#### Change comparison

- Requirement
- Side-by-side lineage outcomes
- Patches and change surface
- Costs
- Hidden-check results after release
- Human interventions
- Blinded review findings

#### Run evidence viewer

- Sanitized trajectory timeline
- Commands and verification events
- Intervention markers
- Submitted patch
- Raw result files
- Artifact checksums

### 10.2 Signature editorial element

Every completed change should identify a **decision that mattered later** when evidence supports one.

Example:

> Change 0 placed tenant filtering in a client-side query helper. Change 2 introduced a server route that bypassed that helper, producing a reproducible cross-tenant access defect.

This statement must link to the originating patch, later patch, and failing evaluation. If causality is uncertain, label it as reviewer interpretation rather than fact.

### 10.3 Publishing cadence

For each change:

1. Publish the current requirement and audience prediction prompt.
2. Execute all lineage runs before publishing comparative results.
3. Evaluate submitted repositories.
4. Sanitize and seal evidence bundles.
5. Publish the comparison and technical postmortem.
6. Update cumulative lineage timelines.

Controlled runs cannot accept implementation suggestions from livestream viewers or social-media responses.

## 11. MVP system design

The system has four components.

### Experiment repository

Contains:

- Starter application
- Public requirements after release
- Visible checks
- Season and run manifest schemas
- Evidence schemas
- Sanitization rules

### Runner

Responsibilities:

- Create an isolated workspace from the required commit
- Apply agent and tool configuration
- Enforce time and spend budgets where technically possible
- Capture trajectory, usage, interventions, and repository state
- Run visible verification
- Produce the initial evidence bundle

The MVP may support the selected two agent harnesses directly. It does not need a public plugin API.

### Hidden evaluator

Responsibilities:

- Evaluate the submitted commit in a fresh environment
- Run hidden functional, migration, regression, and security checks
- Capture reproducible outputs
- Produce `hidden-results.json`
- Never repair or alter the submitted lineage

### Results site

Responsibilities:

- Read normalized evidence bundles
- Render season, lineage, change, and run pages
- Link summaries to raw evidence
- Display coverage gaps and invalid runs honestly

The results site must not become the source of truth. Evidence bundles and repository commits are authoritative.

## 12. Scope boundaries

### Included

- One support-inbox starter application
- Four sequential changes
- Four lineages
- Two coding-agent harnesses
- One human baseline
- Visible and hidden executable evaluation
- Captured costs, time, interventions, patches, and trajectories
- Static or server-rendered public results site
- Downloadable evidence bundles
- One blinded review after the final change

### Explicitly excluded

- Universal coding-agent leaderboard
- User accounts
- Community-submitted experiments
- Arbitrary harness plugin system
- Live production deployment of lineage applications
- Automated architecture scoring
- LLM-as-judge as the sole evaluator
- Single composite quality score
- Statistical claims from the pilot sample
- Audit-history and requirement-reversal changes
- Monetization

## 13. Delivery plan

### Milestone 1: Protocol freeze

Deliverables:

- Final Season 0 question
- Lineages and intervention policies
- Budgets
- Change specifications
- Evaluation matrix
- Season manifest schema
- Publication and redaction policy

Exit criteria:

- Every acceptance criterion maps to at least one visible or hidden check.
- Hidden checks test behavior rather than implementation structure.
- Seal future changes before the first measured run.

### Milestone 2: Starter and evaluator

Deliverables:

- Verified starter repository
- Deterministic seed data
- Visible test harness
- Hidden evaluation repository
- Isolated evaluation command

Exit criteria:

- Starter passes its baseline checks repeatedly in a clean environment.
- Mutation tests or manual checks prove that each hidden check fails against a plausible defective implementation.
- No future requirement or hidden check is present in the agent workspace.

### Milestone 3: Capture and runner

Deliverables:

- Direct support for the two selected agent harnesses
- Run and intervention capture
- Budget enforcement or explicit manual controls
- Evidence-bundle generator
- Sanitization pass

Exit criteria:

- A dry run produces a complete evidence bundle.
- Replaying recorded verification commands reproduces the reported results.
- Sanitization removes credentials and private paths without destroying material evidence.

### Milestone 4: Dry-run season

Deliverables:

- One non-measured practice lineage
- Protocol corrections
- Frozen model-spend ceiling
- Final signed season manifest

Exit criteria:

- Runner, evaluator, and publishing pipeline complete one full change.
- Make all protocol changes before measured execution.

### Milestone 5: Measured execution

Deliverables:

- Four lineages through four changes
- Evaluation after every change
- Blinded final review
- Sanitized public evidence

Exit criteria:

- Every valid run has a complete bundle.
- Invalid runs have documented independent causes.
- Publish comparative results only after all lineages complete the same round.

### Milestone 6: Public launch

Deliverables:

- Season overview
- Four lineage timelines
- Four change comparisons
- Evidence viewer
- Methodology and limitations
- Technical postmortem

Exit criteria:

- Every public claim links to supporting evidence.
- A third party can reproduce hidden results after their release.
- Costs and coverage gaps are explicit.

## 14. MVP acceptance criteria

The MVP is complete when:

1. Four lineages start from the same verified repository commit.
2. Each valid lineage receives all four requirements in the same order without access to future changes.
3. Every run records its environment, trajectory, interventions, patch, cost, visible results, and final repository state.
4. The evaluator runs every submitted change in a fresh environment with precommitted hidden checks.
5. Functional regressions and confirmed authorization defects are distinguishable from scanner alerts.
6. The report records human active time separately from model spend and wall-clock time.
7. Minimal and reviewed workflows follow documented intervention policies.
8. The public site compares cumulative trajectories and individual changes.
9. Every summary result links to a downloadable evidence bundle and repository commit.
10. The publication states the sample-size and generalization limits of the pilot.
11. At least one technical postmortem traces a later outcome to an earlier decision. Otherwise, report that the season produced no defensible causal trace.
12. A third party can reproduce the released evaluation from published code and artifacts.

## 15. Success and failure signals

### Strong success

- Later changes expose meaningful differences not visible after Change 0.
- Readers inspect trajectories and decision archaeology rather than only model rankings.
- Independent developers reproduce the released evaluation.
- The protocol produces credible discussion from developers, security reviewers, or agent vendors.
- Human-review data identifies specific interventions for later tests.

### Weak success

- The season is technically reproducible and attracts interest, but differences are mainly cost or speed rather than maintainability.

This still justifies a second season with stronger architectural pressure.

### Pivot signal

- Harness failures, provider instability, or ambiguous requirements dominate the results.
- Evidence capture consumes substantially more effort than evaluation and explanation.
- The audience engages only with a simplistic model leaderboard.

Pivot toward narrower controlled experiments rather than expanding the platform.

### Stop signal

Stop after the pilot only if both conditions apply:

- Longitudinal execution adds no explanatory value beyond ordinary isolated-task evaluation.
- No credible protocol change can fix that limitation.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Pilot is mistaken for a universal ranking | Label every result by protocol, version, date, and sample size. Prohibit universal claims. |
| Hidden tests favor a preferred architecture | Test only observable behavior and security invariants. Independently review checks before execution. |
| Operator unconsciously favors a lineage | Freeze policies. Log exact interventions. Run lineages in a fixed or randomized order. |
| Agent sees future requirements | Keep future documents and the evaluator in separate storage. Expose only hashes. |
| Security claims rely on noisy scanners | Require reproduction or expert confirmation. Report scanner alerts separately. |
| Model or provider changes mid-season | Pin snapshots where possible. Record exact identifiers. Disclose unavoidable drift. |
| Public trajectories leak secrets | Use isolated credentials, structured capture, automated scanning, and manual prepublication review. |
| Human baseline is incomparable | Report resources separately. Use it as a reference trajectory, not proof of parity. |
| Stochastic luck dominates one run | Call Season 0 a case-study pilot. Add repeated runs only after protocol validation. |
| Platform work delays the experiment | Use a minimal static results site and direct harness integrations |

## 17. Relationship to Runlight

Change Two and Runlight have separate product questions.

- **Runlight:** Can readers trust, reconcile, and trace coding-agent run evidence to its source?
- **Change Two:** What does longitudinal evidence show about how agent-built software evolves?

Season 0 should use a narrow evidence format for its two selected harnesses. It may adopt existing Runlight capture contracts. Change Two must not wait for a universal evidence platform or become a generic session dashboard.

A successful Change Two season can provide a demanding real-world consumer and validation case for Runlight. The products remain separate.

## 18. Decisions still required before implementation

1. Select the two coding-agent harnesses and exact model snapshots.
2. Select the web stack and database for the support-inbox starter.
3. Define the operator and independent reviewer roles.
4. Set the spend ceiling after one unmeasured dry run.
5. Decide whether agent runs are livestreamed after verifying that doing so cannot contaminate later lineages.
6. Choose the public artifact host and repository layout.
7. Define the exact confidence questions used before hidden evaluation.

These decisions affect execution but do not change the MVP thesis or scope.
