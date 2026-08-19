import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  reporter: "line",
  testDir: "./test",
  use: {
    baseURL: process.env.STARTER_WEB_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
});
