import { test, expect, loginAs, requireJourney } from "./helpers";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Phase 14 protected journeys", () => {
  test("creates a workspace and first project", async ({ authenticatedPage: page }, testInfo) => {
    requireJourney(testInfo, "workspace/project fixture", ["PLAYWRIGHT_TEST_EMAIL", "PLAYWRIGHT_TEST_PASSWORD"]);
    await page.goto("/onboarding?create=1");
    const suffix = Date.now().toString().slice(-8);
    await page.getByLabel(/workspace name/i).fill(`E2E workspace ${suffix}`);
    await page.getByRole("button", { name: /create workspace|continue/i }).click();
    await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
    await page.getByLabel("Project name").fill(`E2E project ${suffix}`);
    await page.getByLabel("Key").fill(`E${suffix.slice(-3)}`);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("accepts an invitation as a second user", async ({ page }, testInfo) => {
    requireJourney(testInfo, "invitation fixture", ["PLAYWRIGHT_INVITE_TOKEN", "PLAYWRIGHT_SECOND_EMAIL", "PLAYWRIGHT_SECOND_PASSWORD"]);
    await loginAs(page, process.env.PLAYWRIGHT_SECOND_EMAIL!, process.env.PLAYWRIGHT_SECOND_PASSWORD!);
    await page.goto(`/invite/${process.env.PLAYWRIGHT_INVITE_TOKEN}`);
    await page.getByRole("button", { name: /accept|join/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("creates, edits, assigns, and transitions an issue", async ({ authenticatedPage: page }, testInfo) => {
    requireJourney(testInfo, "issue fixture", ["PLAYWRIGHT_PROJECT_KEY", "PLAYWRIGHT_ASSIGNEE_LABEL", "PLAYWRIGHT_INITIAL_STATUS", "PLAYWRIGHT_TRANSITION_TARGET"]);
    const createdTitle = `E2E issue ${Date.now()}`;
    const editedTitle = `E2E edited ${Date.now()}`;
    await page.goto("/dashboard/issues");
    await page.getByRole("link", { name: /create issue/i }).click();
    await page.getByLabel("Title", { exact: true }).fill(createdTitle);
    await page.getByLabel("Description", { exact: true }).fill("Created by the committed Playwright issue lifecycle journey.");
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(process.env.PLAYWRIGHT_PROJECT_KEY!)));
    await page.getByRole("button", { name: "Edit issue" }).click();
    await page.getByLabel("Title", { exact: true }).last().fill(editedTitle);
    await page.getByLabel("Assignee", { exact: true }).last().selectOption({ label: process.env.PLAYWRIGHT_ASSIGNEE_LABEL! });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`^${process.env.PLAYWRIGHT_INITIAL_STATUS!}`) }).click();
    await page.getByRole("menuitem", { name: new RegExp(process.env.PLAYWRIGHT_TRANSITION_TARGET!, "i") }).click();
    await expect(page.getByText(/Status changed to/i)).toBeVisible();
  });

  test("comments produce visible activity and a mention notification", async ({ browser }, testInfo) => {
    requireJourney(testInfo, "comment fixture", ["PLAYWRIGHT_TEST_EMAIL", "PLAYWRIGHT_TEST_PASSWORD", "PLAYWRIGHT_SECOND_EMAIL", "PLAYWRIGHT_SECOND_PASSWORD", "PLAYWRIGHT_SECOND_DISPLAY_NAME", "PLAYWRIGHT_ISSUE_KEY"]);
    const primaryContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const primary = await primaryContext.newPage();
    const second = await secondContext.newPage();
    const comment = `E2E mention ${Date.now()}`;
    try {
      await loginAs(primary, process.env.PLAYWRIGHT_TEST_EMAIL!, process.env.PLAYWRIGHT_TEST_PASSWORD!);
      await primary.goto(`/dashboard/issues/${process.env.PLAYWRIGHT_ISSUE_KEY}`);
      const composer = primary.getByLabel("Comment body");
      await composer.fill(`@${process.env.PLAYWRIGHT_SECOND_DISPLAY_NAME} ${comment}`);
      await primary.getByRole("option", { name: new RegExp(escapeRegExp(process.env.PLAYWRIGHT_SECOND_DISPLAY_NAME!), "i") }).click();
      await primary.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(primary.getByText(new RegExp(comment))).toBeVisible();
      await loginAs(second, process.env.PLAYWRIGHT_SECOND_EMAIL!, process.env.PLAYWRIGHT_SECOND_PASSWORD!);
      await second.goto("/dashboard/notifications");
      await expect(second.locator("body")).toContainText(new RegExp(escapeRegExp(process.env.PLAYWRIGHT_ISSUE_KEY!), "i"));
    } finally {
      await primaryContext.close();
      await secondContext.close();
    }
  });

  test("second user observes a realtime issue update", async ({ browser }, testInfo) => {
    requireJourney(testInfo, "realtime fixture", ["PLAYWRIGHT_TEST_EMAIL", "PLAYWRIGHT_TEST_PASSWORD", "PLAYWRIGHT_SECOND_EMAIL", "PLAYWRIGHT_SECOND_PASSWORD", "PLAYWRIGHT_ISSUE_KEY"]);
    const primaryContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const primary = await primaryContext.newPage();
    const second = await secondContext.newPage();
    try {
      await loginAs(primary, process.env.PLAYWRIGHT_TEST_EMAIL!, process.env.PLAYWRIGHT_TEST_PASSWORD!);
      await loginAs(second, process.env.PLAYWRIGHT_SECOND_EMAIL!, process.env.PLAYWRIGHT_SECOND_PASSWORD!);
      await primary.goto(`/dashboard/issues/${process.env.PLAYWRIGHT_ISSUE_KEY}`);
      await second.goto(`/dashboard/issues/${process.env.PLAYWRIGHT_ISSUE_KEY}`);
      const realtimeTitle = `Realtime edit ${Date.now()}`;
      await primary.getByRole("button", { name: "Edit issue" }).click();
      await primary.getByLabel("Title", { exact: true }).last().fill(realtimeTitle);
      await primary.getByRole("button", { name: "Save changes" }).click();
      await expect(second.getByRole("heading", { name: realtimeTitle })).toBeVisible({ timeout: 15_000 });
    } finally {
      await primaryContext.close();
      await secondContext.close();
    }
  });

  test("second user cannot view a restricted issue", async ({ page }, testInfo) => {
    requireJourney(testInfo, "restricted issue fixture", ["PLAYWRIGHT_RESTRICTED_ISSUE_KEY", "PLAYWRIGHT_SECOND_EMAIL", "PLAYWRIGHT_SECOND_PASSWORD"]);
    await loginAs(page, process.env.PLAYWRIGHT_SECOND_EMAIL!, process.env.PLAYWRIGHT_SECOND_PASSWORD!);
    await page.goto(`/dashboard/issues/${process.env.PLAYWRIGHT_RESTRICTED_ISSUE_KEY}`);
    await expect(page.locator("body")).toContainText(/not found|not authorized|access denied|restricted/i);
  });

  test("attachment upload and authorized download work", async ({ authenticatedPage: page }, testInfo) => {
    requireJourney(testInfo, "attachment fixture", ["PLAYWRIGHT_RESTRICTED_ISSUE_KEY"]);
    await page.goto(`/dashboard/issues/${process.env.PLAYWRIGHT_RESTRICTED_ISSUE_KEY}`);
    const input = page.locator('input[type="file"]');
    await input.setInputFiles("playwright/fixtures/attachment.txt");
    const attachment = page.getByText("attachment.txt", { exact: true }).last();
    await expect(attachment).toBeVisible();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      attachment.locator("xpath=ancestor::li").getByRole("button", { name: "Download" }).click(),
    ]);
    await expect(popup).toHaveURL(/\/storage\/v1\/object\/sign\/issue-attachments\//);
    await popup.close();
  });

  test("API token can be created, used, and revoked", async ({ authenticatedPage: page }, testInfo) => {
    requireJourney(testInfo, "API token fixture", ["PLAYWRIGHT_PROJECT_KEY"]);
    await page.goto("/dashboard/settings/api");
    const tokenName = `Playwright ${Date.now()}`;
    await page.getByLabel("Token name").fill(tokenName);
    await page.getByLabel("Scope preset").selectOption("read");
    await page.getByRole("button", { name: "Create token" }).click();
    const token = await page.locator("code").filter({ hasText: /^tbx_/ }).textContent();
    expect(token).toBeTruthy();
    const response = await page.request.get("/api/v1/projects", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.ok()).toBeTruthy();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByText(tokenName, { exact: true }).locator("xpath=ancestor::li").getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText(tokenName, { exact: true })).toHaveCount(0);
    const revoked = await page.request.get("/api/v1/projects", { headers: { Authorization: `Bearer ${token}` } });
    expect(revoked.status()).toBe(401);
  });
});
