# Outcome Rules 1.0.0

Apply these rules after trusted Visible Checks, Hidden Checks, and review records are complete. Use only recorded evidence. Do not infer a pass from missing evidence.

## Precedence

Apply the first matching rule:

1. **invalid-run**: A documented failure outside the Lineage's control prevents fair execution or evaluation, and the independent reviewer approves invalidation. External causes include a provider outage, runner corruption, an inaccessible required dependency, or a verified starter defect. Agent errors, chosen dependencies, budget exhaustion, and failure to diagnose the application do not qualify.
2. **blocked**: Required information or infrastructure remains unavailable, no evaluable Submission exists, and invalidation was not approved. A blocked Run advances the Lineage with its unchanged starting commit.
3. **degraded**: The Submission is evaluable and any criterion is unmet, any severity-blocking Check fails, any prior regression Check fails, or evaluation confirms a security defect.
4. **recovered**: All criteria and Checks pass, no security defect is confirmed, and at least one runner-owned recovery attempt was used.
5. **clean-pass**: All criteria and Checks pass, no security defect is confirmed, and no runner-owned recovery attempt was used.

A manual stop or exhausted budget is not an invalidation cause. If it leaves an evaluable Submission, evaluate that Submission and apply the rules above.

## Required evidence

The Outcome must name:

- every unmet criterion ID;
- every failed prior regression Check ID;
- every confirmed security defect in factual language;
- the decisive rule and its evidence references.

Missing or errored severity-blocking Checks prevent acceptance. Checker, setup, provenance, or integrity errors are evaluator errors, not failed application Checks. Repair the evaluator or record an approved protocol deviation before assigning an Outcome.
