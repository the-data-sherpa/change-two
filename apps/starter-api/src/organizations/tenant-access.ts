import { and, eq } from "drizzle-orm/sql/expressions/conditions";
import { asc } from "drizzle-orm/sql/expressions/select";

import type { StarterDatabase } from "../database/database.js";
import {
  organizationMemberships,
  organizations,
} from "../database/schema.js";

export interface AccessibleOrganization {
  readonly id: string;
  readonly name: string;
}

export interface TenantAccess {
  find(userId: string, organizationId: string): Promise<AccessibleOrganization | null>;
  list(userId: string): Promise<readonly AccessibleOrganization[]>;
}

export function createTenantAccess(database: StarterDatabase): TenantAccess {
  return {
    async find(userId, organizationId) {
      const [organization] = await database
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .innerJoin(
          organizationMemberships,
          eq(organizationMemberships.organizationId, organizations.id),
        )
        .where(
          and(
            eq(organizationMemberships.userId, userId),
            eq(organizations.id, organizationId),
          ),
        )
        .limit(1);
      return organization ?? null;
    },

    async list(userId) {
      return database
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .innerJoin(
          organizationMemberships,
          eq(organizationMemberships.organizationId, organizations.id),
        )
        .where(eq(organizationMemberships.userId, userId))
        .orderBy(asc(organizations.name));
    },
  };
}
