import { createDatabaseBackedApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to start the starter API.");
}

const server = createDatabaseBackedApp({
  databaseUrl,
  logger: true,
  testLoginEnabled: process.env.TEST_LOGIN_ENABLED === "true",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:4173",
});

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
