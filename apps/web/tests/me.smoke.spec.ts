import { expect, test } from "@playwright/test";

// Step-5 "My library" view: a contributed item shows up under both "In my care"
// and "Contributed by me".
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("my library lists items in my care and contributed by me", async ({ page }) => {
  const title = `MyLib ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "Contribute an item" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Photos").setInputFiles({
    name: "i.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await page.getByRole("button", { name: "Add to the library" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("link", { name: "My library" }).click();
  await expect(page.getByRole("heading", { name: "My library" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In my care" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contributed by me" })).toBeVisible();
  // The freshly contributed item appears (it's both in my care and contributed by me).
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
