import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for Drizzle commands.");
}

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  out: "./drizzle",
  schema: "./src/database/schema.ts",
  strict: true,
});
