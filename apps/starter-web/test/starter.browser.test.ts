import { expect, test } from "@playwright/test";

const ALEX_ID = "00000000-0000-4000-8000-000000000101";
const BLAIR_ID = "00000000-0000-4000-8000-000000000102";

test.beforeEach(async ({ context, page }) => {
  await context.clearCookies();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Select a test identity" }),
  ).toBeVisible();
});

test("identity selection creates a session and shows only its Organizations", async ({
  page,
}) => {
  await page.getByTestId(`identity-${ALEX_ID}`).click();

  await expect(page.getByText("Alex Rivera", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your Organizations" }),
  ).toBeVisible();
  const alexOrganizations = page.locator(".organization-list").getByRole("button");
  await expect(alexOrganizations).toHaveText([
    "Harbor Helpdesk",
    "Northstar Support",
  ]);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Select a test identity" }),
  ).toBeVisible();

  await page.getByTestId(`identity-${BLAIR_ID}`).click();
  await expect(page.getByText("Blair Chen", { exact: true })).toBeVisible();
  const blairOrganizations = page.locator(".organization-list").getByRole("button");
  await expect(blairOrganizations).toHaveText(["Northstar Support"]);
  await expect(
    page.getByRole("button", { name: "Harbor Helpdesk" }),
  ).toHaveCount(0);
});
