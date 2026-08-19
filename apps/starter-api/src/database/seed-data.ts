export const SEEDED_USERS = [
  {
    displayName: "Alex Rivera",
    email: "alex@example.test",
    id: "00000000-0000-4000-8000-000000000101",
  },
  {
    displayName: "Blair Chen",
    email: "blair@example.test",
    id: "00000000-0000-4000-8000-000000000102",
  },
  {
    displayName: "Casey Morgan",
    email: "casey@example.test",
    id: "00000000-0000-4000-8000-000000000103",
  },
] as const;

export const SEEDED_ORGANIZATIONS = [
  {
    id: "00000000-0000-4000-8000-000000000201",
    name: "Northstar Support",
  },
  {
    id: "00000000-0000-4000-8000-000000000202",
    name: "Harbor Helpdesk",
  },
] as const;

export const SEEDED_MEMBERSHIPS = [
  {
    organizationId: SEEDED_ORGANIZATIONS[0].id,
    userId: SEEDED_USERS[0].id,
  },
  {
    organizationId: SEEDED_ORGANIZATIONS[1].id,
    userId: SEEDED_USERS[0].id,
  },
  {
    organizationId: SEEDED_ORGANIZATIONS[0].id,
    userId: SEEDED_USERS[1].id,
  },
  {
    organizationId: SEEDED_ORGANIZATIONS[1].id,
    userId: SEEDED_USERS[2].id,
  },
] as const;
