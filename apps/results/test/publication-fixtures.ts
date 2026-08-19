import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type FailureFixture = "changed-checksum" | "dangling-reference" | "invalid-approval" | "undeclared-artifact";

export function createFailureFixture(failure: FailureFixture): { readonly directory: string; readonly remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), "change-two-results-fixture-"));
  const directory = join(root, "publication");
  cpSync(resolve("fixtures/publications/approved-practice/practice-fixture"), directory, { recursive: true });

  if (failure === "invalid-approval") {
    replace(join(directory, "publication-approval.json"), '"decision": "approved"', '"decision": "rejected"');
  } else if (failure === "changed-checksum") {
    replace(join(directory, "bundle/environment.json"), '"platform":"linux/amd64"', '"platform":"linux/arm64"');
  } else if (failure === "dangling-reference") {
    replace(join(directory, "bundle/summary.json"), '"event:message"', '"event:does-not-exist"');
  } else {
    writeFileSync(join(directory, "bundle/artifacts/undeclared.txt"), "undeclared\n");
  }

  return { directory, remove: () => rmSync(root, { force: true, recursive: true }) };
}

function replace(path: string, source: string, replacement: string): void {
  const content = readFileSync(path, "utf8");
  if (!content.includes(source)) throw new Error(`Fixture source '${source}' is absent from ${path}`);
  writeFileSync(path, content.replace(source, replacement));
}
