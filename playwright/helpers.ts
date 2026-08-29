import { expect, type Page, test as base } from "@playwright/test";

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, provide, testInfo) => {
    const email = process.env.PLAYWRIGHT_TEST_EMAIL;
    const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
    testInfo.annotations.push({ type: "fixture", description: email ? "configured account" : "missing PLAYWRIGHT_TEST_EMAIL/PASSWORD" });
    if (!email || !password) { testInfo.skip(true, "Set PLAYWRIGHT_TEST_EMAIL and PLAYWRIGHT_TEST_PASSWORD for authenticated journeys"); return; }
    await loginAs(page, email, password);
    await provide(page);
  },
});

export { expect };

/** Skip a protected journey unless the caller deliberately opted into real fixtures. */
export function requireJourney(testInfo: { skip: (condition: boolean, description?: string) => void }, name: string, vars: string[] = []) {
  const missing = vars.filter((key) => !process.env[key]);
  testInfo.skip(process.env.PLAYWRIGHT_FULL_JOURNEYS !== "1" || missing.length > 0, `${name} requires PLAYWRIGHT_FULL_JOURNEYS=1${missing.length ? ` and ${missing.join(", ")}` : ""}`);
}
