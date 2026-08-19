import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const cliPath = resolve(repositoryRoot, "packages/protocol/src/cli.ts");
const tsxLoader = import.meta.resolve("tsx");

function runCli(...arguments_: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("all valid fixtures pass and all invalid fixtures fail", () => {
  const result = runCli("check-fixtures");

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Fixture validation passed: 14 valid and 13 invalid fixture\(s\)\./,
  );
});

test("the released Change 0 evaluation matrix is complete", () => {
  const result = runCli(
    "validate-matrix",
    "requirements/released/change-0/evaluation-matrix.json",
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^VALID evaluation-matrix /);
});

test("validation reports a precise path and rule", () => {
  const result = runCli(
    "validate",
    "fixtures/protocol/invalid/matrix-broken-reference.json",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^INVALID /);
  assert.match(result.stderr, /\/checks\/0\/covers\/criterionIds \[reference\]/);
  assert.match(result.stderr, /criterion:c0-ac-99/);
});

test("matrix validation rejects a non-matrix protocol document", () => {
  const result = runCli(
    "validate-matrix",
    "fixtures/protocol/valid/criterion.json",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be 'evaluation-matrix'/);
});

test("validation reports malformed JSON without a stack trace", () => {
  const path = resolve(tmpdir(), `change-two-malformed-${process.pid}.json`);
  writeFileSync(path, "{not-json", "utf8");

  try {
    const result = runCli("validate", path);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^INVALID /);
    assert.match(result.stderr, /\/ \[parse\]/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  } finally {
    unlinkSync(path);
  }
});
