import { expect, test } from "@playwright/test";

test("navigates Season, Lineage, Change, and Run evidence with explicit practice labeling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Practice evidence — not measured").first()).toBeVisible();
  await page.getByRole("link", { name: "season:0" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "season:0" })).toBeVisible();

  await page.getByRole("link", { name: "lineage:fixture" }).click();
  await expect(page.getByRole("heading", { name: "Submission history" })).toBeVisible();
  await page.getByRole("link", { name: /change:0 · run:fixture/u }).click();
  await expect(page.getByRole("heading", { level: 1, name: "run:fixture" })).toBeVisible();
  await expect(page.getByText("Practice evidence — not measured")).toBeVisible();

  await page.getByRole("link", { name: "visible-result:visible-check" }).click();
  await expect(page.locator("#visible-visible-check")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bundle Revision history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "revision:fixture-1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "revision:fixture-2" })).toBeVisible();
});

test("exposes evidence links and immutable raw bundle files", async ({ page }) => {
  await page.goto("/runs/run-fixture/");
  const sourceEvent = page.getByRole("link", { name: "event:message" }).first();
  await sourceEvent.click();
  await expect(page.locator("#event-event-message")).toBeVisible();

  await page.getByRole("link", { name: "manifest.json", exact: true }).click();
  await expect(page.locator("body")).toContainText('"runId":"run:fixture"');
});

test("links from the Season overview to the Change comparison", async ({ page }) => {
  await page.goto("/seasons/season-0/");
  await page.getByRole("link", { name: "change:0 comparison" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "change:0" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Visible Checks" })).toBeVisible();
});
