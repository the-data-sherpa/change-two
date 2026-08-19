import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const cliPath = resolve(repositoryRoot, "packages/evidence/src/cli.ts");
const tsxLoader = import.meta.resolve("tsx");
const acceptedCapture = "fixtures/evidence/accepted/capture.jsonl";
const scratchRoot = mkdtempSync(join(tmpdir(), "change-two-evidence-"));

test.after(() => rmSync(scratchRoot, { force: true, recursive: true }));

function runCli(...arguments_: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliPath, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function materialize(name: string): string {
  const bundle = join(scratchRoot, name);
  const result = runCli("materialize", acceptedCapture, bundle);
  assert.equal(result.status, 0, result.stderr);
  return bundle;
}

function files(root: string, directory = root): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...files(root, absolute));
    } else {
      paths.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  return paths.sort();
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

test("replay is byte-equivalent and preserves provenance and unavailable usage", () => {
  const first = join(scratchRoot, "replay-first");
  const second = join(scratchRoot, "replay-second");
  const firstResult = runCli("replay", acceptedCapture, first);
  const secondResult = runCli("replay", acceptedCapture, second);

  assert.equal(firstResult.status, 0, firstResult.stderr);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  assert.deepEqual(files(first), files(second));
  for (const path of files(first)) {
    assert.deepEqual(readFileSync(join(first, path)), readFileSync(join(second, path)), path);
  }

  const trajectory = readFileSync(join(first, "trajectory.jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const message = trajectory.find((event) => event.eventId === "event:message");
  assert.deepEqual(
    (message?.source as Record<string, unknown>).providerFields,
    { native_unknown: { retained: true }, usage: null },
  );
  const costs = json(join(first, "costs.json"));
  const usage = (costs.usage as readonly Record<string, unknown>[])[0];
  assert.equal(usage?.measurement, "unavailable");
  assert.equal(usage?.inputTokens, null);
  assert.equal(usage?.outputTokens, null);
  assert.equal(usage?.totalTokens, null);
});

test("every bundle file and external artifact is declared by checksums", () => {
  const bundle = materialize("all-checksums");
  const checksums = json(join(bundle, "checksums.json"));
  const declared = (checksums.entries as readonly Record<string, unknown>[])
    .map((entry) => entry.path as string)
    .sort();
  assert.deepEqual(declared, files(bundle));
  assert.ok(declared.includes("artifacts/visible-reproduction.txt"));
  assert.ok(declared.includes("checksums.json"));
});

test("capture validation rejects duplicate and skipped sequences independently of timestamps", () => {
  for (const fixture of ["duplicate-sequence", "skipped-sequence"]) {
    const result = runCli(
      "materialize",
      `fixtures/evidence/failure/${fixture}/capture.jsonl`,
      join(scratchRoot, fixture),
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[sequence\] must be contiguous/);
  }
});

test("materialization rejects broken artifact references and invalid schemas", () => {
  const broken = runCli(
    "materialize",
    "fixtures/evidence/failure/broken-artifact/capture.jsonl",
    join(scratchRoot, "broken-artifact"),
  );
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /\[reference\] missing artifact/);

  const invalid = runCli(
    "materialize",
    "fixtures/evidence/failure/invalid-schema/capture.jsonl",
    join(scratchRoot, "invalid-capture-schema"),
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /inputTokens/);
  assert.match(invalid.stderr, /\[const\]/);
});

test("materialization rejects unresolved summary evidence links", () => {
  const result = runCli(
    "materialize",
    "fixtures/evidence/failure/unresolved-summary/capture.jsonl",
    join(scratchRoot, "unresolved-summary"),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /evidenceLinks/);
  assert.match(result.stderr, /does not resolve 'event:does-not-exist'/);
});

test("verification rejects missing files and undeclared extras", () => {
  const missing = materialize("missing-file");
  unlinkSync(join(missing, "requirement.md"));
  const missingResult = runCli("verify", missing);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /\[missing\]/);

  const extra = materialize("extra-file");
  writeFileSync(join(extra, "undeclared.txt"), "undeclared\n", "utf8");
  const extraResult = runCli("verify", extra);
  assert.equal(extraResult.status, 1);
  assert.match(extraResult.stderr, /\[undeclared\] extra file/);
});

test("verification rejects invalid materialized schemas and changed checksums", () => {
  const invalid = materialize("invalid-bundle-schema");
  const manifest = json(join(invalid, "manifest.json"));
  manifest.status = "not-a-status";
  writeFileSync(join(invalid, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  const invalidResult = runCli("verify", invalid);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /\/status \[enum\]/);

  const changed = materialize("changed-checksum");
  appendFileSync(join(changed, "requirement.md"), "changed\n", "utf8");
  const changedResult = runCli("verify", changed);
  assert.equal(changedResult.status, 1);
  assert.match(changedResult.stderr, /\[checksum\] file checksum mismatch/);
});

test("verification rejects a broken materialized artifact reference", () => {
  const bundle = materialize("broken-materialized-reference");
  unlinkSync(join(bundle, "artifacts/visible-reproduction.txt"));
  const result = runCli("verify", bundle);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[reference\] missing 'artifacts\/visible-reproduction.txt'/);
});

test("correction preserves prior bytes, links checksum sets, and refuses revision overwrite", () => {
  const previous = materialize("revision-1");
  const priorFiles = files(previous);
  const priorBytes = new Map(priorFiles.map((path) => [path, readFileSync(join(previous, path))]));
  const next = join(scratchRoot, "revision-2");
  const result = runCli(
    "correct",
    "fixtures/evidence/correction/capture.jsonl",
    previous,
    next,
    "fixtures/evidence/correction/request.json",
  );
  assert.equal(result.status, 0, result.stderr);

  assert.deepEqual(files(previous), priorFiles);
  for (const [path, bytes] of priorBytes) {
    assert.deepEqual(readFileSync(join(previous, path)), bytes, path);
  }
  const priorChecksums = json(join(previous, "checksums.json"));
  const nextChecksums = json(join(next, "checksums.json"));
  const revision = json(join(next, "revision.json"));
  assert.equal(revision.revisionId, "revision:fixture-2");
  assert.equal(revision.supersededRevisionId, "revision:fixture-1");
  assert.equal(revision.supersededContentSetSha256, priorChecksums.contentSetSha256);
  assert.equal(revision.currentContentSetSha256, nextChecksums.contentSetSha256);
  assert.ok((revision.changedArtifacts as readonly string[]).includes("submitted.patch"));
  assert.equal(runCli("verify", next).status, 0);

  const overwrite = runCli(
    "correct",
    "fixtures/evidence/correction/capture.jsonl",
    previous,
    next,
    "fixtures/evidence/correction/request.json",
  );
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /\[immutable\] bundle directory already exists/);
});

test("verification rejects checksum manifests copied from another bundle revision", () => {
  const original = materialize("manifest-original");
  const changed = materialize("manifest-substitute");
  cpSync(join(original, "checksums.json"), join(changed, "checksums.json"));
  appendFileSync(join(changed, "submitted.patch"), "substitution\n", "utf8");
  const result = runCli("verify", changed);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[checksum\]/);
});
