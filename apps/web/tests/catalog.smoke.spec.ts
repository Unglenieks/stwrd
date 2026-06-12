import { expect, test } from "@playwright/test";

// Exercises Step 3 against the live backend: contribute a uniquely-titled item,
// then browse → search the catalog → open the item page and see its ledger
// timeline (the `contributed` genesis entry).
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("catalog: contribute, browse, search, and view the ledger timeline", async ({ page }) => {
  const title = `Catalog Item ${Date.now()}`;

  // Sign in.
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });

  // Contribute a uniquely-titled item.
  await page.getByRole("link", { name: "Contribute an item" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Tags (comma-separated)").fill("catalogtest");
  await page.getByLabel("Photos").setInputFiles({
    name: "item.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await page.getByRole("button", { name: "Add to the library" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  // Browse the catalog and search for it.
  await page.getByRole("link", { name: "Browse catalog" }).click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.getByPlaceholder("Search the catalog…").fill(title);
  await page.getByRole("button", { name: "Search" }).click();

  const card = page.getByText(title, { exact: true });
  await expect(card).toBeVisible({ timeout: 10_000 });

  // Open the item page and confirm the ledger timeline shows the genesis entry.
  await card.click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Available")).toBeVisible();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect(page.getByText("Contributed")).toBeVisible();
});
