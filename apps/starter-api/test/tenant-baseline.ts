import type { FastifyInstance } from "fastify";

import { SEEDED_ORGANIZATIONS, SEEDED_USERS } from "../src/database/seed-data.js";

export async function assertCrossOrganizationDenied(
  app: FastifyInstance,
): Promise<void> {
  const login = await app.inject({
    method: "POST",
    payload: { userId: SEEDED_USERS[1].id },
    url: "/test/session",
  });
  if (login.statusCode !== 201) {
    throw new Error(`Tenant baseline could not establish a session (HTTP ${login.statusCode}).`);
  }
  const cookie = login.headers["set-cookie"];
  if (cookie === undefined) {
    throw new Error("Tenant baseline did not receive a server session cookie.");
  }

  const response = await app.inject({
    headers: {
      cookie,
      "x-organization-id": SEEDED_ORGANIZATIONS[1].id,
      "x-user-id": SEEDED_USERS[0].id,
    },
    method: "GET",
    query: {
      organizationId: SEEDED_ORGANIZATIONS[1].id,
      userId: SEEDED_USERS[0].id,
    },
    url: `/organizations/${SEEDED_ORGANIZATIONS[1].id}`,
  });
  if (response.statusCode !== 403) {
    throw new Error(
      `Tenant baseline expected HTTP 403 for cross-Organization access but received HTTP ${response.statusCode}.`,
    );
  }
}
