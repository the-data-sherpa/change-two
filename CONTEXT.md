# Change Two Experiment

Change Two compares how implementations of the same application evolve through a sealed sequence of product changes. This glossary defines the experiment's canonical language.

## Protocol

**Season**:
A sealed experiment protocol and the complete set of Rounds and publications conducted under it.
_Avoid_: Study, campaign

**Round**:
The set of comparable Runs in which every eligible Lineage receives the same Change.
_Avoid_: Stage, phase

**Change**:
One versioned product requirement delivered to every eligible Lineage in a Round.
_Avoid_: Task, prompt

**Lineage**:
The ordered chain of submitted repository states produced by one implementation workflow across Rounds.
_Avoid_: Variant, branch, implementation

**Run**:
One Lineage's attempt at one Change from a specified starting commit under one Policy and Budget.
_Avoid_: Session, attempt

**Policy**:
The sealed rules governing permitted human involvement in a Run.
_Avoid_: Mode, workflow rules

**Budget**:
The sealed limits on wall-clock time, human active time, recovery attempts, and model spend for a Run.
_Avoid_: Allowance, quota

**Protocol Deviation**:
A documented departure between a sealed protocol and actual execution.
_Avoid_: Exception, variance

## Execution

**Submission**:
The evaluable repository state and patch finalized when a Run ends. It advances the Lineage unless the Run is Invalid.
_Avoid_: Solution, final answer

**Intervention**:
A timestamped human action that can influence a Run and is classified under its Policy.
_Avoid_: Feedback, message

**Recovery Cycle**:
One opportunity to continue implementation after runner-owned Visible Verification fails.
_Avoid_: Retry, repair attempt

**Visible Check**:
An executable verification available to the implementer during a Run.
_Avoid_: Public test

**Hidden Check**:
A precommitted executable verification withheld from the implementer until its scheduled release.
_Avoid_: Secret test, private test

**Outcome**:
The protocol-defined classification assigned to a Run from its submitted evidence and evaluation.
_Avoid_: Score, grade

**Invalid Run**:
A Run that cannot be evaluated fairly because of a verified failure independent of its Lineage.
_Avoid_: Failed run, void run

## Evidence

**Capture Event**:
An append-only, ordered record of an observed message, tool action, intervention, usage report, verification action, or lifecycle transition during a Run.
_Avoid_: Log line, telemetry point

**Evidence Bundle**:
The versioned materialized files that make a Run's environment, trajectory, Submission, costs, verification, findings, and summary inspectable and reproducible.
_Avoid_: Report, export

**Bundle Revision**:
An immutable published version of an Evidence Bundle that either originates or explicitly supersedes another revision.
_Avoid_: Update, overwrite

**Criterion**:
A stable, observable requirement statement mapped to one or more Visible Checks or Hidden Checks.
_Avoid_: Test case, feature

**Finding**:
A reproduced or expert-validated observation produced during evaluation or review.
_Avoid_: Alert, opinion
