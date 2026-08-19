import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import {
  type AuthenticatedUser,
  createSessionAuth,
  type SessionAuth,
  UnknownIdentityError,
} from "./auth/session-auth.js";
import { openDatabase } from "./database/database.js";
import {
  createTenantAccess,
  type TenantAccess,
} from "./organizations/tenant-access.js";

const SESSION_COOKIE = "change_two_session";

interface StarterModules {
  readonly sessionAuth: SessionAuth;
  readonly tenantAccess: TenantAccess;
}

interface StarterAppOptions {
  readonly logger?: boolean;
  readonly testLoginEnabled: boolean;
  readonly webOrigin: string;
}

interface DatabaseBackedAppOptions extends StarterAppOptions {
  readonly databaseUrl: string;
}

interface SelectIdentityBody {
  readonly userId: string;
}

interface OrganizationParameters {
  readonly organizationId: string;
}

export function createStarterApp(
  modules: StarterModules,
  options: StarterAppOptions,
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  void app.register(cookie);
  void app.register(cors, {
    credentials: true,
    methods: ["DELETE", "GET", "POST"],
    origin: options.webOrigin,
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof Error &&
      "validation" in error &&
      error.validation !== undefined
    ) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: error.message,
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The starter API could not complete the request.",
      },
    });
  });

  app.get("/health", async () => ({
    service: "starter-api",
    status: "ok",
  }));

  if (options.testLoginEnabled) {
    app.get("/test/identities", async () => ({
      users: await modules.sessionAuth.loginIdentities(),
    }));

    app.post<{ Body: SelectIdentityBody }>(
      "/test/session",
      {
        schema: {
          body: {
            additionalProperties: false,
            properties: {
              userId: { format: "uuid", type: "string" },
            },
            required: ["userId"],
            type: "object",
          },
        },
      },
      async (request, reply) => {
        try {
          const session = await modules.sessionAuth.establish(request.body.userId);
          reply.setCookie(SESSION_COOKIE, session.token, {
            httpOnly: true,
            maxAge: session.maxAgeSeconds,
            path: "/",
            sameSite: "lax",
          });
          return reply.status(201).send({ established: true });
        } catch (error) {
          if (error instanceof UnknownIdentityError) {
            return reply.status(404).send({
              error: {
                code: "UNKNOWN_TEST_IDENTITY",
                message: error.message,
              },
            });
          }
          throw error;
        }
      },
    );
  }

  app.get("/session", async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, modules.sessionAuth);
    if (user === null) {
      return undefined;
    }
    return { user };
  });

  app.delete("/session", async (request, reply) => {
    await modules.sessionAuth.clear(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
    return reply.status(204).send();
  });

  app.get("/organizations", async (request, reply) => {
    const user = await requireAuthenticatedUser(request, reply, modules.sessionAuth);
    if (user === null) {
      return undefined;
    }
    return { organizations: await modules.tenantAccess.list(user.id) };
  });

  app.get<{ Params: OrganizationParameters }>(
    "/organizations/:organizationId",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            organizationId: { format: "uuid", type: "string" },
          },
          required: ["organizationId"],
          type: "object",
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuthenticatedUser(request, reply, modules.sessionAuth);
      if (user === null) {
        return undefined;
      }
      const organization = await modules.tenantAccess.find(
        user.id,
        request.params.organizationId,
      );
      if (organization === null) {
        return reply.status(403).send({
          error: {
            code: "FORBIDDEN_ORGANIZATION",
            message: `Authenticated User '${user.id}' does not have access to Organization '${request.params.organizationId}'.`,
          },
        });
      }
      return { organization };
    },
  );

  return app;
}

export function createDatabaseBackedApp(
  options: DatabaseBackedAppOptions,
): FastifyInstance {
  const database = openDatabase(options.databaseUrl);
  const app = createStarterApp(
    {
      sessionAuth: createSessionAuth(database.db),
      tenantAccess: createTenantAccess(database.db),
    },
    options,
  );
  app.addHook("onClose", async () => database.close());
  return app;
}

async function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionAuth: SessionAuth,
): Promise<AuthenticatedUser | null> {
  const user = await sessionAuth.authenticatedUser(
    request.cookies[SESSION_COOKIE],
  );
  if (user === null) {
    await reply.status(401).send({
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Select a deterministic test identity before accessing the starter.",
      },
    });
  }
  return user;
}
