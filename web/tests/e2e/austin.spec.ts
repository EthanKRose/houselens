import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const ZHVI = "zillow.zhvi.all.mid.sa";
const FHFA = "fhfa.hpi.at.q.nsa";
const CASE_SHILLER = "fred.cs.metro.sa";
// Must match COLUMNS in lib/csv.ts.
const CSV_HEADER =
  "series_id,source,method_family,seasonal_adj,geo_id,period_start,period_end,value,transform,vintage_date,release_date,quality_flags";

const box = (page: Page, id: string) => page.getByRole("checkbox", { name: new RegExp(id) });

test("Austin compare: select, export CSV, share link", async ({ page, browser }) => {
  await page.goto("/compare");
  await page.getByRole("button", { name: "United States", exact: true }).first().click();
  await page.getByPlaceholder(/Search by name/).fill("Austin");
  await page
    .getByRole("option", { name: /Austin/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Austin/ })).toBeVisible();

  // click + expect, not check(): the checkbox is controlled by the URL, which updates async.
  for (const id of [ZHVI, FHFA]) {
    await box(page, id).click();
    await expect(box(page, id)).toBeChecked();
  }

  const cs = box(page, CASE_SHILLER);
  await expect(cs).toBeDisabled();
  await expect(page.getByText("Case-Shiller covers 20 metros only")).toBeVisible();

  // Real ECharts renders a canvas; unit tests mock it.
  await expect(
    page
      .getByRole("img", { name: /Line chart/ })
      .locator("canvas")
      .first(),
  ).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv.split("\n").find((l) => !l.startsWith("#"))).toBe(CSV_HEADER);
  const rows = csv.split("\n");
  // Per-row, so a national (US) series can't satisfy the Austin check.
  for (const id of [ZHVI, FHFA]) {
    expect(rows.find((l) => l.startsWith(`${id},`))).toContain(",CBSA:12420,");
  }

  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  try {
    await fresh.goto(page.url());
    await expect(box(fresh, ZHVI)).toBeChecked();
    await expect(box(fresh, FHFA)).toBeChecked();
    await expect(box(fresh, CASE_SHILLER)).not.toBeChecked();
  } finally {
    await ctx.close();
  }
});
