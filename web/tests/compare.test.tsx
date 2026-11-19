import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => "/compare",
}));
vi.mock("@/components/SeriesChart", () => ({ SeriesChart: () => null }));
vi.mock("@/lib/csv", async (orig) => {
  const actual = await orig<typeof import("@/lib/csv")>();
  return { ...actual, toCsv: vi.fn(actual.toCsv) };
});

import ComparePage from "@/app/compare/page";
import { toCsv } from "@/lib/csv";

const AUSTIN = "geo=CBSA:12420";

beforeEach(() => {
  replace.mockClear();
  vi.mocked(toCsv).mockClear();
  vi.stubGlobal("fetch", async (path: string) => ({
    ok: true,
    json: async () => JSON.parse(readFileSync(`public${path}`, "utf8")),
  }));
});

const page = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ComparePage />
  </QueryClientProvider>
);
const show = (q: string) => {
  search = q;
  return render(page());
};
const box = (id: string) =>
  screen.findByRole("checkbox", { name: new RegExp(id.replaceAll(".", "\\.")) });

describe("compare", () => {
  it("disables Case-Shiller metro on Austin with the reason", async () => {
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa,fhfa.hpi.at.q.nsa`);
    const cs = await box("fred.cs.metro.sa");
    expect(cs).toBeDisabled();
    expect(cs).toHaveAccessibleName(/Case-Shiller covers 20 metros only/);
    expect(await box("zillow.zhvi.all.mid.sa")).toBeChecked();
  });

  it("disables FHFA metro on a CBSA with divisions", async () => {
    show("geo=CBSA:35620");
    expect(await box("fhfa.hpi.at.q.nsa")).toHaveAccessibleName(
      /FHFA publishes divisions, not the whole metro/,
    );
  });

  it("labels a Realtor.com series as listing data", async () => {
    show(`${AUSTIN}&s=realtor.median_list_price.all.nsa`);
    const row = await screen.findByRole("row", { name: /realtor\.median_list_price/ });
    expect(within(row).getByText("Listing data (asking prices), not sales")).toBeVisible();
  });

  it("blocks a 7th selection", async () => {
    const six = [
      "zillow.zhvi.all.mid.sa",
      "zillow.zori.all.sa",
      "realtor.median_list_price.all.nsa",
      "realtor.active_listings.all.nsa",
      "realtor.dom.all.nsa",
      "realtor.price_reduced_share.all.nsa",
    ];
    show(`${AUSTIN}&s=${six.join(",")}`);
    const seventh = await box("fhfa.hpi.at.q.nsa");
    fireEvent.click(seventh);
    expect(seventh).not.toBeChecked();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/At most 6 series/);
  });

  it("exports CSV with provenance columns and attribution", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x") }));
    URL.revokeObjectURL = vi.fn();
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa,fred.cpi.rent.sa&t=yoy`);
    fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    const csv = vi.mocked(toCsv).mock.results[0].value as string;
    expect(csv).toContain(
      "series_id,source,method_family,seasonal_adj,geo_id,period_start,period_end,value,transform,vintage_date,release_date,quality_flags",
    );
    expect(csv).toContain("# Data: Zillow Research");
    expect(csv).toContain("# Data: FRED");
    expect(csv).toMatch(/^zillow\.zhvi\.all\.mid\.sa,Zillow Research Data,.*,CBSA:12420,.*,yoy,/m);
    expect(csv).toMatch(/^fred\.cpi\.rent\.sa,.*,US,.*,yoy,/m);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });

  it("labels PMMS (US) when selected on Austin", async () => {
    const view = show(AUSTIN);
    const pmms = await box("fred.pmms.30y.nsa");
    expect(pmms).toHaveAccessibleName(/\(US\)/);
    expect(pmms).toBeEnabled();
    fireEvent.click(pmms);
    expect(replace).toHaveBeenCalledWith("/compare?geo=CBSA:12420&s=fred.pmms.30y.nsa");
    search = "geo=CBSA:12420&s=fred.pmms.30y.nsa";
    view.rerender(page());
    expect(
      await screen.findByRole("row", { name: /30-year fixed mortgage rate.*\(US\)/ }),
    ).toBeInTheDocument();
  });

  it("rebases with a note when 3+ units are selected", async () => {
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa,fhfa.hpi.at.q.nsa,realtor.dom.all.nsa`);
    expect(await screen.findByText(/Rebased to 100 because the selection mixes 3\+ units/));
    expect(screen.getByRole("combobox", { name: "Transform" })).toHaveValue("level");
  });

  it("shows an error when data fails to load", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500 }));
    show(AUSTIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(/load/i);
  });
});
