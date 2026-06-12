import { expect, test } from "@playwright/test";

// Exercises the full Step-2 contribution flow against the live backend: client
// image processing (downscale + EXIF strip via canvas) → upload to Convex
// storage → items.contribute action (which re-verifies the photo server-side).
// Assumes the local dev fixture (server manager + ≥1 category seeded).
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";

// A tiny valid 1×1 PNG (base64) — the canvas re-encodes it to a clean WebP.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });
}

test("contribute an item end-to-end", async ({ page }) => {
  await signIn(page);

  await page.getByRole("link", { name: "Contribute an item" }).click();
  await expect(page.getByRole("heading", { name: "Contribute an item" })).toBeVisible();

  await page.getByLabel("Title").fill("Playwright Drill");
  await page.getByLabel("Description").fill("A test contribution.");
  // Category select is populated from the live backend (≥1 seeded category).
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Tags (comma-separated)").fill("test, drill");

  await page.getByLabel("Photos").setInputFiles({
    name: "item.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await expect(page.getByText(/photo selected/i)).toBeVisible();

  await page.getByRole("button", { name: "Add to the library" }).click();

  // On success the app navigates back to the signed-in home.
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });
});
