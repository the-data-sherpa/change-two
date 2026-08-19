import { sql } from "drizzle-orm/sql";

import type { StarterDatabase } from "./database.js";
import {
  SEEDED_MEMBERSHIPS,
  SEEDED_ORGANIZATIONS,
  SEEDED_USERS,
} from "./seed-data.js";
import {
  organizationMemberships,
  organizations,
  users,
} from "./schema.js";

export async function seedStarter(database: StarterDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`TRUNCATE TABLE sessions, organization_memberships, organizations, users`,
    );
    await transaction.insert(users).values([...SEEDED_USERS]);
    await transaction.insert(organizations).values([...SEEDED_ORGANIZATIONS]);
    await transaction
      .insert(organizationMemberships)
      .values([...SEEDED_MEMBERSHIPS]);
  });
}
