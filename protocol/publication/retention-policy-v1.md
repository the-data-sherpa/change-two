# Retention Policy 1.0.0

Keep each unsanitized Evidence Bundle in restricted local storage for no more than 30 days after sanitized publication approval.

Access is limited to the operator, sanitizer reviewer, and incident reviewer. Do not use restricted bundles as results-site inputs. Record creation time, approved publication checksum, scheduled deletion time, deletion confirmation, and any Incident Hold.

At the deadline, destroy the restricted bundle and its local copies. Preserve only the sanitized immutable publication, checksums, and administrative deletion record.

An Incident Hold under Incident Hold Policy 1.0.0 pauses deletion only for the named bundle and stated reason. When the hold closes, delete the bundle immediately if its original deadline has passed; otherwise keep the original deadline.
