import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt } from "drizzle-orm/sql/expressions/conditions";
import { asc } from "drizzle-orm/sql/expressions/select";

import type { StarterDatabase } from "../database/database.js";
import { sessions, users } from "../database/schema.js";

const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export interface AuthenticatedUser {
  readonly displayName: string;
  readonly email: string;
  readonly id: string;
}

export interface EstablishedSession {
  readonly maxAgeSeconds: number;
  readonly token: string;
}

export interface SessionAuth {
  authenticatedUser(token: string | undefined): Promise<AuthenticatedUser | null>;
  clear(token: string | undefined): Promise<void>;
  establish(userId: string): Promise<EstablishedSession>;
  loginIdentities(): Promise<readonly AuthenticatedUser[]>;
}

export class UnknownIdentityError extends Error {
  constructor(userId: string) {
    super(`No deterministic test identity exists for User '${userId}'.`);
    this.name = "UnknownIdentityError";
  }
}

export function createSessionAuth(database: StarterDatabase): SessionAuth {
  return {
    async authenticatedUser(token) {
      if (token === undefined) {
        return null;
      }
      const [row] = await database
        .select({
          displayName: users.displayName,
          email: users.email,
          id: users.id,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            eq(sessions.id, digestToken(token)),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async clear(token) {
      if (token !== undefined) {
        await database.delete(sessions).where(eq(sessions.id, digestToken(token)));
      }
    },

    async establish(userId) {
      const [identity] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (identity === undefined) {
        throw new UnknownIdentityError(userId);
      }

      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SESSION_LIFETIME_MS);
      await database.insert(sessions).values({
        createdAt,
        expiresAt,
        id: digestToken(token),
        userId: identity.id,
      });
      return {
        maxAgeSeconds: SESSION_LIFETIME_MS / 1000,
        token,
      };
    },

    async loginIdentities() {
      return database
        .select({
          displayName: users.displayName,
          email: users.email,
          id: users.id,
        })
        .from(users)
        .orderBy(asc(users.displayName));
    },
  };
}

function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
