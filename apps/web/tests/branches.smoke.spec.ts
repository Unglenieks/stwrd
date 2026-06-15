import { expect, test, type Page } from "@playwright/test";

// Phase-4 branches UI against the live backend: register a branch, list an item
// at it (markAvailable branch mode → atBranchId), and see it on the branch page.
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

test("register a branch and list an item there", async ({ page }) => {
  const branchName = `Branch ${Date.now()}`;
  const itemTitle = `BItem ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });

  // Register a branch. Submitting is retried because the single shared dev
  // backend can transiently drop a mutation under full-suite load; isolated runs
  // create on the first try. The feature itself is covered by convex-test
  // (convex/phase4.test.ts).
  await page.getByRole("link", { name: "Branches", exact: true }).click();
  await page.getByLabel("Location (free text)").fill("blue shed behind the co-op");
  await page.getByLabel("Access notes").fill("combo 4312");
  await expect(async () => {
    await page.getByLabel("Name").fill(branchName);
    await page.getByRole("button", { name: "Register branch" }).click();
    await expect(page.getByText(branchName)).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 30_000 });

  // Contribute an item, then list it at the branch.
  await page.goto("/contribute");
  await page.getByLabel("Title").fill(itemTitle);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Photos").setInputFiles({
    name: "i.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await page.getByRole("button", { name: "Add to the library" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  await openItem(page, itemTitle);
  await page.getByRole("button", { name: "Withdraw listing" }).click();
  await expect(page.getByText("In care", { exact: true })).toBeVisible();

  // Choose the branch in the holder controls and list it there.
  await page.locator("select").filter({ hasText: "a branch…" }).selectOption({ label: branchName });
  await page.getByRole("button", { name: "List at branch" }).click();
  await expect(page.getByText("At branch", { exact: true })).toBeVisible({ timeout: 10_000 });

  // The branch page now lists the item.
  await page.goto("/branches");
  await page.getByText(branchName).click();
  await expect(page.getByRole("heading", { name: branchName })).toBeVisible();
  await expect(page.getByText(itemTitle, { exact: true })).toBeVisible();
});
