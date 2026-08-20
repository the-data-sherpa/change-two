# Redaction Policy 1.0.0

Publication is fail-closed. A bundle is not publishable until automated scans pass and a named human reviewer approves the exact sanitized checksum.

## Public content

A sanitized bundle may contain released requirements and checks, normalized trajectories, submitted patches, costs, timings, interventions, evaluations, reproduction artifacts, and review records.

## Prohibited content

Remove or replace:

- credentials, tokens, cookies, authorization headers, and secret-file contents;
- private evaluator paths, repository remotes, and host-specific paths;
- unreleased requirements, Hidden Checks, defect fixtures, and private evaluator diagnostics;
- personal data not required by the protocol;
- raw provider fields that cannot be classified safely.

Unknown captured content is prohibited. Do not publish it with a warning or automatic placeholder.

## Approval

The sanitizer produces a new publication directory and scan report. The reviewer inspects the report and sampled replacements, then signs the exact directory checksum. Any byte change invalidates approval. Published bytes are immutable. A correction creates a new Bundle Revision that identifies the superseded checksum and preserves both revisions.

Keep an unsanitized source bundle only in restricted storage under Retention Policy 1.0.0. The public results site must never depend on restricted storage.
