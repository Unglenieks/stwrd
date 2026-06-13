import { expect, test, type Page } from "@playwright/test";

// Step-3 stewardship UI against the live backend: watch an item, withdraw the
// listing, propose retirement (photo required), and approve it (the admin is the
// sole approver) → the item is RETIRED and the ledger records the lifecycle.
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function openItem(page: Page, title: string) {
  await page.goto("/items");
  await page.getByPlaceholder("Search the catalog…").fill(title);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("watch, withdraw, propose + approve retirement", async ({ page }) => {
  const title = `Steward ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });

  // Contribute an item (custodian = admin).
  await page.getByRole("link", { name: "Contribute an item" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Photos").setInputFiles({
    name: "i.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await page.getByRole("button", { name: "Add to the library" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  await openItem(page, title);

  // Watch toggle.
  await page.getByRole("button", { name: "☆ Watch" }).click();
  await expect(page.getByRole("button", { name: "★ Watching" })).toBeVisible();

  // Withdraw the listing → IN_CUSTODY (holder controls).
  await page.getByRole("button", { name: "Withdraw listing" }).click();
  await expect(page.getByText("In care", { exact: true })).toBeVisible();

  // Propose retirement (reason + photo required).
  await page.getByPlaceholder("Why is this beyond economical repair?").fill("Cracked frame.");
  await page.locator('input[type="file"]').setInputFiles({
    name: "r.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await page.getByRole("button", { name: "Propose retirement" }).click();

  // Approver card appears; approve it (admin is the sole approver).
  await expect(page.getByRole("heading", { name: "Retirement proposed" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Approve" }).click();

  // Item is RETIRED; the ledger shows the lifecycle. (Both the state badge and
  // the ledger label read "Retired", so scope to the first match.)
  await expect(page.getByText("Retired", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Retirement proposed").first()).toBeVisible();
});
