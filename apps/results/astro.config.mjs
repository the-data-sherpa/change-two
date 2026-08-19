import { defineConfig } from "astro/config";

export default defineConfig({
  build: {
    format: "directory",
  },
  outDir: process.env.RESULTS_OUT_DIR ?? "./dist",
  output: "static",
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
});
