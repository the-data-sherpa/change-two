import { createStarterApp } from "../../src/app.js";
import type { SessionAuth } from "../../src/auth/session-auth.js";
import {
  SEEDED_ORGANIZATIONS,
  SEEDED_USERS,
} from "../../src/database/seed-data.js";
import type { TenantAccess } from "../../src/organizations/tenant-access.js";

const sessionAuth: SessionAuth = {
  async authenticatedUser(token) {
    return token === "mutated-session" ? SEEDED_USERS[1] : null;
  },
  async clear() {},
  async establish() {
    return { maxAgeSeconds: 60, token: "mutated-session" };
  },
  async loginIdentities() {
    return SEEDED_USERS;
  },
};

const membershipIgnoringTenantAccess: TenantAccess = {
  async find(_userId, organizationId) {
    return (
      SEEDED_ORGANIZATIONS.find(
        (organization) => organization.id === organizationId,
      ) ?? null
    );
  },
  async list() {
    return [SEEDED_ORGANIZATIONS[0]];
  },
};

export function createMembershipIgnoringApp() {
  return createStarterApp(
    {
      sessionAuth,
      tenantAccess: membershipIgnoringTenantAccess,
    },
    {
      testLoginEnabled: true,
      webOrigin: "http://localhost:4173",
    },
  );
}
