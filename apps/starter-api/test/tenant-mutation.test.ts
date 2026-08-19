import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { createMembershipIgnoringApp } from "./mutations/ignore-membership.js";
import { assertCrossOrganizationDenied } from "./tenant-baseline.js";

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of openApps.splice(0)) {
    await app.close();
  }
});

describe("tenant-authority baseline sensitivity", () => {
  it("fails against a controlled adapter that ignores membership", async () => {
    const mutatedApp = createMembershipIgnoringApp();
    openApps.push(mutatedApp);
    await expect(assertCrossOrganizationDenied(mutatedApp)).rejects.toThrow(
      "expected HTTP 403",
    );
  });
});
