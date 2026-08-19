import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  reporter: "line",
  testDir: "./test/browser",
  use: {
    baseURL: process.env.RESULTS_SITE_URL ?? "http://127.0.0.1:4321",
    trace: "retain-on-failure",
  },
  ...(process.env.RESULTS_SITE_URL === undefined ? {
    webServer: {
      command: "astro dev --host 127.0.0.1 --port 4321",
      env: {
        RESULTS_PUBLICATIONS_DIR: "./fixtures/publications/approved-practice",
      },
      reuseExistingServer: false,
      url: "http://127.0.0.1:4321",
    },
  } : {}),
});
