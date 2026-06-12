import { expect, test } from "@playwright/test";

// These smoke tests exercise the real Phase 1 auth flow end-to-end against the
// live Convex backend: HTTP /auth/login → Convex Auth signIn(credentials) →
// session → authed home. They assume the backend was bootstrapped with the
// server-manager account below (the local dev fixture).
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";

test("signed-out root redirects to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("setup route is closed once the instance is bootstrapped (C-01)", async ({ page }) => {
  await page.goto("/setup");
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("password sign-in lands on the signed-in home", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("wrong password surfaces an error and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill("definitely-not-it");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/Sign-in failed|sign in/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
