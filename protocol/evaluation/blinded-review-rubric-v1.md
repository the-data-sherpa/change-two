# Blinded Review Rubric 1.0.0

Review all four final-round submitted patches as one shuffled set. Include the surrounding repository state needed to understand each patch. Remove Lineage identifiers, trajectory data, model and harness details, costs, and Intervention records. Do not claim that blinding conceals implementation style or model fingerprints.

The blinded reviewer must not be a builder, operator, or independent protocol reviewer for the Season.

## Review procedure

For each patch:

1. Trace changed behavior from external request or user action to persisted state and response.
2. Inspect authorization at the server boundary. Do not credit client-side checks as authorization.
3. Inspect migrations and deterministic seed behavior for loss, duplication, and repeatability.
4. Inspect concurrency and stale-state paths where the requirement names them.
5. Run only the released verification available to the reviewer. Do not inspect Hidden Checks.
6. Record findings under the categories below. State the observed code path and risk. Do not guess the Lineage.

## Categories

- **comprehensibility**: The behavior, authority boundary, state transitions, and failure paths can or cannot be followed without reconstructing hidden conventions.
- **extension-risk**: The design makes the next stated Change safer or riskier. Name the coupling, duplicated rule, migration constraint, or state ownership that creates the risk.
- **suspected-defect**: A specific observable behavior may violate a requirement or invariant. State a reproduction scenario. Do not report style preferences as defects.

Encode findings with `schemas/protocol/v1/review-record.schema.json`. An empty findings list means the reviewer found no reportable item; it does not certify correctness. Review findings inform interpretation and defect investigation but do not replace executable Check results.
