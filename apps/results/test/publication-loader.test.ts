import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { evidenceHref, loadPublications, rawBundleHref } from "../src/lib/publications.js";
import { createFailureFixture } from "./publication-fixtures.js";

const fixtures = resolve("fixtures/publications");

test("loads the approved practice envelope through the Evidence Bundle verifier", () => {
  const [publication] = loadPublications(resolve(fixtures, "approved-practice/practice-fixture"));
  assert.ok(publication);
  assert.equal(publication.approval.evidenceClass, "practice");
  assert.equal(publication.verification.revisionId, "revision:fixture-2");
  assert.equal(publication.run.summary.results.length, 1);
  assert.equal(
    evidenceHref(publication, "visible-result:visible-check"),
    "/runs/run-fixture/#visible-visible-check",
  );
  assert.equal(
    rawBundleHref(publication, "manifest.json"),
    "/bundles/revision-fixture-2/manifest.json",
  );
});

for (const [fixture, expected] of [
  ["invalid-approval", "must be 'approved'"],
  ["changed-checksum", "checksum"],
  ["dangling-reference", "does not resolve"],
  ["undeclared-artifact", "undeclared"],
] as const) {
  test(`rejects the ${fixture} publication before rendering`, () => {
    const generated = createFailureFixture(fixture);
    try {
      assert.throws(
        () => loadPublications(generated.directory),
        (error: unknown) => error instanceof Error && error.message.includes(expected),
      );
    } finally {
      generated.remove();
    }
  });
}
