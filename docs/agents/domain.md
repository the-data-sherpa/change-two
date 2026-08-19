# Domain Docs

This repository uses a single-context domain layout.

## Before exploring

Read:

- `CONTEXT.md`
- ADRs under `docs/adr/` that affect the work

If either location is absent, continue without creating placeholder documents.

## Use canonical language

Use the terms from `CONTEXT.md` in issue titles, specifications, tests, and implementation discussions.

Do not replace canonical terms with synonyms that the glossary marks under `Avoid`.

If a required concept is absent, reconsider whether the concept belongs to the domain. If it does, use the domain-modeling process to define it.

## Respect ADRs

Surface any conflict with an accepted ADR. Do not silently override the decision.

## Layout

The domain glossary lives at the repository root:

- `CONTEXT.md`

System-level architectural decisions live under:

- `docs/adr/`
