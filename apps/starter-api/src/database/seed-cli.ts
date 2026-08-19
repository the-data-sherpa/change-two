import { openDatabase } from "./database.js";
import { seedStarter } from "./seed.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to seed the starter database.");
}

const database = openDatabase(databaseUrl);
try {
  await seedStarter(database.db);
} finally {
  await database.close();
}
