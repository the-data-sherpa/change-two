import { fileURLToPath } from "node:url";

import { asc } from "drizzle-orm/sql/expressions/select";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseBackedApp } from "../src/app.js";
import {
  openDatabase,
  type StarterDatabaseHandle,
} from "../src/database/database.js";
import {
  SEEDED_MEMBERSHIPS,
  SEEDED_ORGANIZATIONS,
  SEEDED_USERS,
} from "../src/database/seed-data.js";
import { seedStarter } from "../src/database/seed.js";
import {
  organizationMemberships,
  organizations,
  users,
} from "../src/database/schema.js";
import { assertCrossOrganizationDenied } from "./tenant-baseline.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for starter HTTP integration checks.");
}

let app: FastifyInstance;
let database: StarterDatabaseHandle;

beforeAll(async () => {
  database = openDatabase(databaseUrl);
  await database.db.execute(
    "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  );
  const migrationsFolder = fileURLToPath(
    new URL("../drizzle", import.meta.url),
  );
  await migrate(database.db, { migrationsFolder });
  await migrate(database.db, { migrationsFolder });
  app = createDatabaseBackedApp({
    databaseUrl,
    testLoginEnabled: true,
    webOrigin: "http://localhost:4173",
  });
  await app.ready();
}, 30_000);

beforeEach(async () => {
  await seedStarter(database.db);
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("deterministic starter identity and tenant authority", () => {
  it("produces the same complete state when seeded repeatedly", async () => {
    const first = await seedSnapshot(database);
    await seedStarter(database.db);
    const second = await seedSnapshot(database);

    expect(second).toEqual(first);
    expect(second.users).toEqual(SEEDED_USERS);
    expect(second.organizations).toEqual(SEEDED_ORGANIZATIONS);
    expect(second.memberships).toHaveLength(SEEDED_MEMBERSHIPS.length);
  });

  it("establishes a server session and lists only its Organizations", async () => {
    const identities = await app.inject({ method: "GET", url: "/test/identities" });
    expect(identities.statusCode).toBe(200);
    expect(identities.json()).toEqual({ users: SEEDED_USERS });

    const alexCookie = await loginAs(SEEDED_USERS[0].id);
    const alexOrganizations = await app.inject({
      headers: { cookie: alexCookie },
      method: "GET",
      url: "/organizations",
    });
    expect(alexOrganizations.statusCode).toBe(200);
    expect(alexOrganizations.json()).toEqual({
      organizations: [SEEDED_ORGANIZATIONS[1], SEEDED_ORGANIZATIONS[0]],
    });

    const blairCookie = await loginAs(SEEDED_USERS[1].id);
    const blairOrganizations = await app.inject({
      headers: { cookie: blairCookie },
      method: "GET",
      url: "/organizations",
    });
    expect(blairOrganizations.json()).toEqual({
      organizations: [SEEDED_ORGANIZATIONS[0]],
    });
  });

  it("denies cross-Organization access despite forged client authority", async () => {
    await assertCrossOrganizationDenied(app);
  });

  it("invalidates the server session on logout", async () => {
    const cookie = await loginAs(SEEDED_USERS[0].id);
    const authenticated = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/session",
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ user: SEEDED_USERS[0] });

    const logout = await app.inject({
      headers: { cookie },
      method: "DELETE",
      url: "/session",
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/organizations",
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("keeps future support-inbox HTTP surfaces absent", async () => {
    for (const url of ["/support-inbox", "/conversations", "/messages"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
    }
  });
});

async function loginAs(userId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    payload: { userId },
    url: "/test/session",
  });
  expect(response.statusCode).toBe(201);
  const setCookie = response.headers["set-cookie"];
  expect(setCookie).toBeTypeOf("string");
  return (setCookie as string).split(";", 1)[0] ?? "";
}

async function seedSnapshot(handle: StarterDatabaseHandle) {
  return {
    memberships: await handle.db
      .select()
      .from(organizationMemberships)
      .orderBy(
        asc(organizationMemberships.organizationId),
        asc(organizationMemberships.userId),
      ),
    organizations: await handle.db
      .select()
      .from(organizations)
      .orderBy(asc(organizations.id)),
    users: await handle.db.select().from(users).orderBy(asc(users.id)),
  };
}
