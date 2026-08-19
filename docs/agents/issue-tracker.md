# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues for `the-data-sherpa/change-two`. Use the `gh` CLI for all operations.

## Conventions

- Create an issue with `gh issue create`.
- Read an issue and its comments with `gh issue view <number> --comments`.
- List issues with `gh issue list`.
- Comment with `gh issue comment <number>`.
- Apply or remove labels with `gh issue edit <number>`.
- Close an issue with `gh issue close <number>`.

Run commands inside the repository clone so that `gh` resolves the remote.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares one number space across issues and pull requests. If a reference is ambiguous, try `gh pr view <number>` and then `gh issue view <number>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `the-data-sherpa/change-two`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

A wayfinding map is one issue with linked child issues.

- Label the map `wayfinder:map`.
- Label each child `wayfinder:<type>`.
- Use GitHub sub-issues and native issue dependencies when available.
- If those features are unavailable, use a task list in the map and a `Blocked by: #<number>` line in each dependent issue.
- A child becomes available when all blocking issues close.
- Claim a child by assigning it to the current GitHub user.
- Resolve a child by recording the result, closing it, and updating the map.
