import { test, expect } from "@playwright/test";

test("public landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TraceBox/i);
});

test("login exposes accessible credential controls", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("protected dashboard redirects anonymous visitors", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard|\/login\?next=\/dashboard/);
});
