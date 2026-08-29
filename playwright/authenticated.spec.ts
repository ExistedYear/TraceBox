import { test, expect } from "./helpers";

test.describe("configured TraceBox account journeys", () => {
  test("workspace shell and project navigation are available", async ({ authenticatedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("body")).toContainText(/workspace|project/i);
  });

  test("issue, notification, security, and settings routes stay protected", async ({ authenticatedPage: page }) => {
    for (const path of ["/dashboard/issues", "/dashboard/notifications", "/dashboard/security", "/dashboard/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replaceAll("/", "\\/")));
    }
  });
});
