import { expect, test, type Page } from "@playwright/test";

// The marquee Step-4 flow against the live backend: a holder (admin) contributes
// an item and invites a second member; that member accepts, claims the item, and
// the two complete the two-party handoff (giver confirm + receiver photo) →
// custody moves. Uses two browser contexts (two real accounts).
const ADMIN_EMAIL = "admin@lot.test";
const ADMIN_PASSWORD = "correct-horse-battery";
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

async function signInAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Signed in as/i)).toBeVisible({ timeout: 15_000 });
}

async function openItem(page: Page, title: string) {
  await page.goto("/items");
  await page.getByPlaceholder("Search the catalog…").fill(title);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("two-party handoff moves custody (C-06)", async ({ browser }) => {
  const title = `Handoff ${Date.now()}`;
  const claimantEmail = `claimant${Date.now()}@lot.test`;

  // ── Holder (admin): contribute + invite a member ──
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signInAdmin(admin);

  await admin.getByRole("link", { name: "Contribute an item" }).click();
  await admin.getByLabel("Title").fill(title);
  await admin.getByLabel("Category").selectOption({ index: 1 });
  await admin.getByLabel("Photos").setInputFiles({
    name: "i.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await admin.getByRole("button", { name: "Add to the library" }).click();
  await expect(admin.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  await admin.getByLabel("Name", { exact: true }).fill("Claimant");
  await admin.getByLabel("Email", { exact: true }).fill(claimantEmail);
  await admin.getByRole("button", { name: "Create invite" }).click();
  const inviteUrl = await admin.getByTestId("invite-link").textContent();
  expect(inviteUrl).toContain("/invite/");

  // ── Member: accept the invite (creates the account + session) ──
  const memberCtx = await browser.newContext();
  const member = await memberCtx.newPage();
  const path = new URL(inviteUrl!).pathname;
  await member.goto(path);
  await member.getByLabel("Password", { exact: true }).fill("claimant-password-1");
  await member.getByLabel("Confirm password").fill("claimant-password-1");
  await member.getByRole("button", { name: "Create account" }).click();
  await expect(member.getByText(/Signed in as/i)).toBeVisible({ timeout: 20_000 });

  // ── Member claims the item ──
  await openItem(member, title);
  await member.getByRole("button", { name: "Claim to borrow" }).click();
  await expect(member.getByText("Handoff in progress")).toBeVisible({ timeout: 10_000 });

  // ── Holder confirms the giver slot ──
  await openItem(admin, title);
  await expect(admin.getByText("Handoff in progress")).toBeVisible({ timeout: 10_000 });
  await admin.getByRole("button", { name: "I handed it off" }).click();

  // ── Member confirms receipt with a photo + condition ──
  await member.locator('input[type="file"]').setInputFiles({
    name: "received.png", mimeType: "image/png", buffer: Buffer.from(PNG_1x1, "base64"),
  });
  await member.getByRole("button", { name: "Confirm receipt" }).click();

  // ── Custody has moved: the item page reactively shows the new state ──
  // (Once the claim completes it leaves the live set, so the checklist gives way
  // to the durable item view: "In care" + the handoff_completed ledger entry.)
  await expect(member.getByText("Handoff completed")).toBeVisible({ timeout: 20_000 }); // timeline
  await expect(member.getByText("In care", { exact: true })).toBeVisible();
  // The "In the care of" row now names the claimant.
  await expect(member.getByText("In the care of").locator("..")).toContainText("Claimant");

  await adminCtx.close();
  await memberCtx.close();
});
