# Change 0: Organization support inbox

Implement the first support-inbox behavior in the starter application. The completed change must preserve the starter's server-established session and Organization membership authority.

## Scope

The deterministic seed is the receipt mechanism for Change 0. Seeded Conversations represent customer Conversations already received by an Organization. An external customer-intake route, webhook, email transport, queue, or other intake transport is out of scope.

Add only the Conversation and Message behavior required below. Assignment, teams, notifications, external identity, and production intake are out of scope.

## Deterministic seed

Migration and seed commands must remain repeatable from a clean database and must produce the same records on every run.

The following fixture identifiers are fixed:

- Northstar Organization: `00000000-0000-4000-8000-000000000201`
- Harbor Organization: `00000000-0000-4000-8000-000000000202`
- Blair User: `00000000-0000-4000-8000-000000000102`

Blair is a member of Northstar only. Preserve all existing Users, Organizations, memberships, and their identifiers. Seed at least one Conversation that Blair can access in Northstar and at least one Harbor-private Conversation. Seeded Conversation and Message identifiers, content, timestamps, and status must be stable across repeated clean seeds.

## Domain behavior

A Conversation belongs to exactly one Organization and has a stable identifier, creation time, and status. Status is exactly `open` or `resolved`.

A Message belongs to exactly one Conversation and has a stable identifier, non-empty content, and creation time. Return Messages in ascending `createdAt` order, breaking equal timestamps by ascending stable Message identifier.

Resolving an open Conversation changes its status to `resolved`. Resolving an already resolved Conversation may remain idempotently resolved.

## Member HTTP interface

Every route below requires the existing server session. Organization authority must be derived from that session and the server-side membership records; request fields are not identity or membership evidence.

- `GET /organizations/:organizationId/conversations`
  - `200` response: `{ "conversations": [...] }`
  - Return only Conversations belonging to the requested Organization.
- `GET /organizations/:organizationId/conversations/:conversationId`
  - `200` response: `{ "conversation": {...}, "messages": [...] }`
  - The Conversation must belong to the path Organization.
- `POST /organizations/:organizationId/conversations/:conversationId/replies`
  - JSON body: `{ "content": "..." }`
  - Successful response: `{ "message": {...} }`
  - Reject missing, non-string, empty, or whitespace-only content with `400` and do not insert a Message.
- `POST /organizations/:organizationId/conversations/:conversationId/resolve`
  - Successful response: `{ "conversation": {...} }`

Unauthenticated requests retain the starter's existing unauthorized response. A member request for another Organization's Conversation list, detail, reply, or resolve operation must return `403` or `404`. The response must not disclose private Conversation or Message content, and a denied mutation must not change stored data. A Conversation identifier from one Organization must not become authorized by placing another Organization identifier in the path.

## Browser behavior

After the existing test identity flow establishes a session, the member can:

1. select one of their Organizations;
2. see that Organization's Conversations;
3. open a Conversation and read its Messages;
4. submit a non-empty reply and see it in the Conversation;
5. resolve the Conversation and see its resolved status.

The UI must not offer or reveal Conversations from an Organization the authenticated User cannot access. Keep controls accessible by their visible labels or accessible names so the behavior can be exercised through a browser rather than implementation internals.

## Visible verification

The released visible bundle contains exactly these Checks:

- `check:c0-visible-01` — receive and list seeded Conversations (`criterion:c0-ac-01`, `criterion:c0-ac-02`)
- `check:c0-visible-02` — open, reply to, and resolve an authorized Conversation (`criterion:c0-ac-03`, `criterion:c0-ac-04`, `criterion:c0-ac-05`)
- `check:c0-visible-03` — deterministic Message ordering, invalid reply rejection, and the member browser flow (`criterion:c0-ac-08`, `criterion:c0-ac-09`)

From the public repository root, run the trusted visible verification seam with a new output path:

```bash
./change-two verification execute <workspace> requirements/released/change-0/visible-checks <output.json>
```

The command verifies a copied workspace in isolated services. It does not make the Check bundle available to submitted application processes and does not modify the supplied workspace.
