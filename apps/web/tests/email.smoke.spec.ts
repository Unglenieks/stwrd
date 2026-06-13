import { expect, test } from "@playwright/test";

// Verifies the real SMTP path (spec §13): configure SMTP via the admin settings
// UI, send a test email through the Node sender action, and confirm a local mail
// catcher (mailpit, on the backend's docker network) received it.
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";
const MAILPIT = "http://localhost:8025/api/v1";

test("SMTP config + test email is delivered", async ({ page, request }) => {
  // Start from a clean mailbox.
  await request.delete(`${MAILPIT}/messages`);

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });

  await page.goto("/admin/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Host").fill("mailpit");
  await page.getByLabel("Port").fill("1025");
  await page.getByLabel("Username").fill("test");
  await page.getByLabel("Password").fill("test");
  await page.getByLabel("From address").fill("library@lot.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.getByRole("button", { name: "Send test email" }).click();
  await expect(page.getByText("Test email sent.")).toBeVisible({ timeout: 15_000 });

  // Mailpit should now hold the test message.
  await expect
    .poll(async () => (await (await request.get(`${MAILPIT}/messages`)).json()).messages_count, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const messages = await (await request.get(`${MAILPIT}/messages`)).json();
  expect(messages.messages[0].Subject).toContain("SMTP test");

  // Restore state: with SMTP configured, the full-permission admin would then be
  // forced into 2FA (§6.2), which would break the password-login fixtures. Remove
  // the email config so the rest of the suite logs in with password only.
  await page.getByRole("button", { name: "Remove email config" }).click();
  await expect(page.getByText("Email configuration removed.")).toBeVisible();
});
