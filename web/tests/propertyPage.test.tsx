import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

import PropertyPage from "@/app/property/page";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has no layout
  vi.stubGlobal("fetch", async (path: string) => {
    try {
      const body = readFileSync(`public${path}`, "utf8");
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const show = (q = "") => {
  search = q;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PropertyPage />
    </QueryClientProvider>,
  );
};
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("compares a property with its ZIP, same bedroom count first", async () => {
  show("z=78704&p=800000&bd=3&sf=1600");
  const row = (
    await screen.findByRole("rowheader", { name: /Zillow typical home value, 3 bedrooms/ })
  ).closest("tr")!;
  expect(within(row).getByText("$877,526")).toBeInTheDocument();
  expect(within(row).getByText("-8.8%")).toBeInTheDocument();
  const ppsf = screen.getByRole("rowheader", { name: /price per square foot/ }).closest("tr")!;
  expect(within(ppsf).getByText("$500/sq ft")).toBeInTheDocument();
  expect(within(ppsf).getByText("-2.3%")).toBeInTheDocument();
  const checks = screen.getByRole("list", { name: "Deal checks" });
  expect(
    within(checks).getByText(
      /9% below the typical value of homes with the same bedroom count in this ZIP/,
    ),
  ).toBeInTheDocument();
  expect(within(checks).getByText(/80 days: buyers have room to negotiate/)).toBeInTheDocument();
  expect(screen.getByText(/Typical value trend here/)).toBeInTheDocument();
});

it("switches to rental and flip figures", async () => {
  show("z=78704&p=400000&bd=2");
  await screen.findByRole("heading", { name: "As a home to live in" });
  fireEvent.click(screen.getByRole("radio", { name: "Rent it out" }));
  expect(screen.getByRole("heading", { name: "As a rental" })).toBeInTheDocument();
  // rent used defaults to the ZIP rent index
  expect(screen.getByText("Rent used").nextElementSibling).toHaveTextContent("$1,925/mo");
  expect(screen.getByText(/Monthly cash flow/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /flip/ }));
  expect(screen.getByText("Estimated profit")).toBeInTheDocument();
  // resale defaults to the 2-bedroom typical value
  expect(screen.getByText("Resale value used").nextElementSibling).toHaveTextContent("$540,994");
});

it("fills the form from pasted listing text", async () => {
  show();
  fireEvent.change(screen.getByLabelText(/Copy the text of a listing/), {
    target: { value: "$615,000 · 3 bd · 2 ba · 1,700 sqft · Austin, TX 78704" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Fill in from text" }));
  expect(screen.getByLabelText(/ZIP code/)).toHaveValue("78704");
  expect(screen.getByLabelText(/Asking price/)).toHaveValue("615000");
  expect(screen.getByRole("status")).toHaveTextContent(/Filled in: price, beds, baths, sqft, zip/);
  expect(await screen.findByRole("rowheader", { name: /3 bedrooms/ })).toBeInTheDocument();
});

it("saves to this browser and shows it after a reload", async () => {
  const view = show("z=78704&p=800000&bd=3&sf=1600");
  await screen.findByRole("heading", { name: "As a home to live in" });
  type(/^Address/, "1 Test St");
  fireEvent.click(screen.getByRole("button", { name: "Save to this browser" }));
  view.unmount();
  show();
  const saved = await screen.findByRole("table", { name: "Saved properties side by side" });
  expect(within(saved).getByRole("rowheader", { name: /1 Test St/ })).toBeInTheDocument();
  expect(within(saved).getByText("$500/sq ft")).toBeInTheDocument();
});

it("says when a ZIP has no data", async () => {
  show("z=99999&p=300000");
  expect(
    await screen.findByText("No data for ZIP 99999. Check the ZIP, or try a nearby one."),
  ).toBeInTheDocument();
});

it("asks for a ZIP and price before showing results", () => {
  show();
  expect(screen.getByText(/Enter a ZIP code and asking price/)).toBeInTheDocument();
});

it("falls back to the metro for a ZIP without its own figures, and labels it", async () => {
  show("z=78705&p=500000&bd=2");
  const row = (await screen.findByRole("rowheader", { name: /Zillow typical home value/ })).closest(
    "tr",
  )!;
  expect(row.nextElementSibling).toHaveTextContent(
    /Metro figure \(Austin-Round Rock-San Marcos, TX\)/,
  );
  expect(
    screen.getByRole("heading", { name: /Compared with ZIP 78705 · Travis County, TX/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Deal checks" })).toHaveTextContent(
    /the metro's typical home value/,
  );
});

it("says there is no data for a rural ZIP with no figures and no metro", async () => {
  show("z=03254&p=300000"); // a real Census ZIP outside any metro, with no ZIP figures in the fixtures
  expect(
    await screen.findByText("No data for ZIP 03254. Check the ZIP, or try a nearby one."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: /Area figures/ })).toBeNull();
});

it("shows Realtor.com's quality flag and the non-disclosure note", async () => {
  show("z=78704&p=800000&bd=3&sf=1600");
  const row = (await screen.findByRole("rowheader", { name: /Days on market/ })).closest("tr")!;
  expect(row.nextElementSibling).toHaveTextContent(/Flag: Realtor.com flags this value/);
  const zillow = screen.getByRole("rowheader", { name: /3 bedrooms/ }).closest("tr")!;
  expect(zillow.nextElementSibling).not.toHaveTextContent(/Flag:/);
  expect(screen.getByText(/Non-disclosure state: sale prices are not public/)).toBeInTheDocument();
});

it("keeps your own rent with the property it belongs to", async () => {
  const view = show("z=78704&p=400000&bd=2&m=rental");
  await screen.findByRole("heading", { name: "As a rental" });
  type(/Expected rent/, "3000");
  fireEvent.click(screen.getByRole("button", { name: "Save to this browser" }));
  view.unmount();
  show("z=78704&p=500000&bd=2&m=rental");
  await screen.findByRole("heading", { name: "As a rental" });
  type(/^Address/, "Other house");
  fireEvent.click(screen.getByRole("button", { name: "Save to this browser" }));
  type(/Expected rent/, "9999");
  // opening the first property brings back its own rent, not the one typed for the other house
  const saved = screen.getByRole("table", { name: "Saved properties side by side" });
  fireEvent.click(within(saved).getAllByRole("button", { name: /^Open/ })[0]);
  expect(await screen.findByText("Rent used")).toBeInTheDocument();
  expect(screen.getByText("Rent used").nextElementSibling).toHaveTextContent("$3,000/mo");
  // in live mode a typed rent no longer counts
  fireEvent.click(screen.getByRole("radio", { name: "Live in it" }));
  expect(screen.getByText(/Price-to-rent ratio/).nextElementSibling).toHaveTextContent(
    /17\.3 years/,
  );
});

it("updates an opened property instead of adding a copy", async () => {
  show("z=78704&p=800000&bd=3");
  await screen.findByRole("heading", { name: "As a home to live in" });
  fireEvent.click(screen.getByRole("button", { name: "Save to this browser" }));
  type(/^Notes/, "needs a roof");
  fireEvent.click(screen.getByRole("button", { name: "Update saved property" }));
  const saved = screen.getByRole("table", { name: "Saved properties side by side" });
  expect(within(saved).getAllByRole("row")).toHaveLength(2); // header + one property
  expect(within(saved).getByText("needs a roof")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save as new" }));
  expect(within(saved).getAllByRole("row")).toHaveLength(3);
});

it("does not lose a property saved in another tab", async () => {
  show("z=78704&p=800000&bd=3");
  await screen.findByRole("heading", { name: "As a home to live in" });
  // another tab saved a property after this one loaded
  localStorage.setItem(
    "houselens.properties.v1",
    JSON.stringify([{ id: "1", zip: "10001", price: 900000, mode: "live", savedAt: "2026-11-01" }]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save to this browser" }));
  const ids = JSON.parse(localStorage.getItem("houselens.properties.v1")!).map(
    (p: { zip: string }) => p.zip,
  );
  expect(ids).toEqual(["10001", "78704"]);
});
