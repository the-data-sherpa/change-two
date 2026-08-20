import { cpSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const workspace = "/verification-workspace";
mkdirSync(workspace, { recursive: true });
cpSync("/submission", workspace, { recursive: true, verbatimSymlinks: true });

const commonEnvironment = {
  ...process.env,
  DATABASE_URL: "postgresql://change_two@postgres:5432/change_two",
};
run("pnpm", ["install", "--frozen-lockfile"], workspace, process.env);
run("pnpm", ["--filter", "@change-two/starter-api", "db:migrate"], workspace, commonEnvironment);
run("pnpm", ["--filter", "@change-two/starter-api", "db:seed"], workspace, commonEnvironment);
const api = start("pnpm", ["--filter", "@change-two/starter-api", "dev"], workspace, {
  ...commonEnvironment,
  HOST: "0.0.0.0",
  PORT: "3000",
  TEST_LOGIN_ENABLED: "true",
  WEB_ORIGIN: "http://submission:4173",
});
await ready("http://127.0.0.1:3000/health", api, "API");
const web = start("pnpm", ["--filter", "@change-two/starter-web", "dev", "--host", "0.0.0.0", "--port", "4173"], workspace, {
  ...commonEnvironment,
  VITE_API_URL: "http://submission:3000",
  VITE_TEST_LOGIN_ENABLED: "true",
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: "submission",
});
await ready("http://127.0.0.1:4173", web, "web application");
console.log("CHANGE_TWO_VERIFIER_READY");

const completion = Promise.withResolvers();
for (const child of [api, web]) {
  child.once("exit", (code, signal) => completion.reject(new Error(`Service exited after readiness (${code ?? signal ?? "unknown"}).`)));
}
process.once("SIGTERM", () => {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  completion.resolve();
});
await completion.promise;

function run(command, arguments_, cwd, env) {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8", env, stdio: "inherit" });
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error(`${command} ${arguments_.join(" ")} failed (${result.status ?? result.signal ?? "unknown"}).`);
  }
}

function start(command, arguments_, cwd, env) {
  return spawn(command, arguments_, { cwd, env, stdio: "inherit" });
}

async function ready(url, child, label) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited before readiness (${child.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready.`);
}
