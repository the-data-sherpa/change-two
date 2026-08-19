import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createFailureFixture } from "./publication-fixtures.js";

const astro = resolve("node_modules/astro/bin/astro.mjs");
const fixtures = resolve("fixtures/publications");

function build(publicationInput: string) {
  const outDir = mkdtempSync(resolve(".test-output-"));
  const result = spawnSync(process.execPath, [astro, "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      RESULTS_OUT_DIR: outDir,
      RESULTS_PUBLICATIONS_DIR: publicationInput,
    },
  });
  rmSync(outDir, { force: true, recursive: true });
  return result;
}

test("static build accepts the approved practice publication", () => {
  const result = build(resolve(fixtures, "approved-practice"));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

for (const [fixture, expected] of [
  ["invalid-approval", "must be 'approved'"],
  ["changed-checksum", "checksum"],
  ["dangling-reference", "does not resolve"],
  ["undeclared-artifact", "undeclared"],
] as const) {
  test(`static build fails closed for ${fixture}`, () => {
    const generated = createFailureFixture(fixture);
    try {
      const result = build(generated.directory);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, "iu"));
    } finally {
      generated.remove();
    }
  });
}
