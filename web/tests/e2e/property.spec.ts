import { expect, test } from "@playwright/test";

test("analyze a pasted listing, save it, and open a share link", async ({ page, browser }) => {
  await page.goto("/property");
  await page.getByText("Paste a listing's text").click();
  await page
    .getByLabel(/Copy the text of a listing/)
    .fill("$800,000\n3 bd | 2 ba | 1,600 sqft\n1 Test St, Austin, TX 78704");
  await page.getByRole("button", { name: "Fill in from text" }).click();

  const value = page.getByRole("row", { name: /Zillow typical home value, 3 bedrooms/ });
  await expect(value).toContainText("-8.8%");
  await expect(page.getByRole("list", { name: "Deal checks" })).toContainText(
    "below the typical value",
  );

  await page.getByRole("radio", { name: "Rent it out" }).check();
  await expect(page.getByRole("heading", { name: "As a rental" })).toBeVisible();
  await expect(page.getByText("Monthly cash flow")).toBeVisible();

  await page.getByLabel(/^Address/).fill("1 Test St");
  await page.getByRole("button", { name: "Save to this browser" }).click();
  await page.reload();
  const saved = page.getByRole("table", { name: "Saved properties side by side" });
  await expect(saved.getByRole("rowheader", { name: /1 Test St/ })).toBeVisible();
  await expect(saved).toContainText("Rental");

  // a share link opened directly (fresh page, no client-side navigation) restores the inputs
  const fresh = await browser.newPage();
  await fresh.goto("/property?z=78704&p=800000&bd=3&sf=1600&m=flip");
  await expect(fresh.getByRole("heading", { name: "As a flip" })).toBeVisible();
  await expect(fresh.getByLabel(/ZIP code/)).toHaveValue("78704");
  await fresh.close();
});
