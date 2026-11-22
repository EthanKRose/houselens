import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { createObjectURL, revokeObjectURL } = URL;
const fixture = async (path: string) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(`public${path}`, "utf8")),
});

beforeEach(() => {
  replace.mockClear();
  vi.mocked(toCsv).mockClear();
  vi.stubGlobal("fetch", fixture);
});

afterEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  vi.restoreAllMocks();
});

let client: QueryClient;
const page = () => (
  <QueryClientProvider client={client}>
    <ComparePage />
  </QueryClientProvider>
);
const show = (q: string) => {
  search = q;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(page());
  return {
    ...view,
    go: (next: string) => {
      search = next;
      view.rerender(page());
    },
  };
};
/** Stubs the Blob download and returns what it captured. */
const download = () => {
  const got = { name: "" };
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    got.name = this.download;
  });
  return got;
};
const lastCsv = () => vi.mocked(toCsv).mock.results.at(-1)!.value as string;
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

  it("says which picked series this geography lacks", async () => {
    show("geo=ST:48&s=zillow.zori.all.sa");
    expect(
      await screen.findByText(
        "Not shown for Texas: zillow.zori.all.sa (Not published for this geography).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Select up to 6/)).not.toBeInTheDocument();
  });

  it("disables FHFA metro on a CBSA with divisions", async () => {
    show("geo=CBSA:35620");
    expect(await box("fhfa.hpi.at.q.nsa")).toHaveAccessibleName(
      /FHFA publishes divisions, not the whole metro/,
    );
  });

  it("labels a Realtor.com series as listing data", async () => {
    show(`${AUSTIN}&s=realtor.median_list_price.all.nsa`);
    expect(await box("realtor.median_list_price.all.nsa")).toHaveAccessibleName(
      /Listing data \(asking prices\), not sales/,
    );
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

  it("exports CSV with provenance columns, values, flags and attribution", async () => {
    const got = download();
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa,realtor.dom.all.nsa,fred.cpi.rent.sa&t=yoy`);
    fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
    const csv = lastCsv();
    expect(csv).toContain(
      "series_id,source,method_family,seasonal_adj,geo_id,period_start,period_end,value,transform,vintage_date,release_date,quality_flags",
    );
    expect(csv).toContain("# Data: Zillow Research");
    expect(csv).toContain("# Data: FRED");
    expect(csv).toContain("# release_date/vintage_date apply to the latest point of each series");
    // dates only on each series' latest row: ZHVI yoy has many rows but one with a vintage date
    const zhvi = csv.split("\n").filter((l) => l.startsWith("zillow.zhvi.all.mid.sa,"));
    expect(zhvi.length).toBeGreaterThan(1);
    expect(zhvi.filter((l) => l.split(",").at(-3) !== "")).toHaveLength(1);
    expect(zhvi.at(-1)!.split(",").at(-3)).not.toBe("");
    // Austin ZHVI Oct 2026 vs Oct 2025 = -4.0856...%
    expect(csv).toMatch(
      /^zillow\.zhvi\.all\.mid\.sa,Zillow Research Data,.*,CBSA:12420,2026-10-01,2026-10-31,-4\.0856\d*,yoy,/m,
    );
    expect(csv).toMatch(/^realtor\.dom\.all\.nsa,.*,2026-10-31,.*,yoy,.*,realtor_quality_flag$/m);
    expect(csv).toMatch(/^fred\.cpi\.rent\.sa,.*,US,.*,yoy,/m);
    expect(got.name).toBe("houselens-CBSA_12420-yoy.csv");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x"));
  });

  it("labels PMMS (US) when selected on Austin", async () => {
    const view = show(AUSTIN);
    const pmms = await box("fred.pmms.30y.nsa");
    expect(pmms).toHaveAccessibleName(/\(US\)/);
    expect(pmms).toBeEnabled();
    fireEvent.click(pmms);
    expect(replace).toHaveBeenCalledWith("/compare?geo=CBSA:12420&s=fred.pmms.30y.nsa");
    view.go("geo=CBSA:12420&s=fred.pmms.30y.nsa");
    expect(
      await screen.findByRole("row", { name: /30-year fixed mortgage rate.*\(US\)/ }),
    ).toBeInTheDocument();
  });

  it("rebases 3+ units to 100 at a common base date, with a note", async () => {
    const got = download();
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa,fhfa.hpi.at.q.nsa,realtor.dom.all.nsa`);
    expect(await screen.findByText(/Rebased to 100 because the selection mixes 3\+ units/));
    expect(screen.getByRole("combobox", { name: "Transform" })).toHaveValue("level");
    // Latest series start is 2025-09-01; FHFA's base is its nearest earlier point (2025-07-01).
    expect(screen.getByRole("columnheader", { name: "Latest (rebased, 100 = 2025-09-01)" }));
    const value = (id: string) =>
      within(screen.getByRole("row", { name: new RegExp(id.replaceAll(".", "\\.")) })).getAllByRole(
        "cell",
      )[0];
    expect(value("zillow.zhvi.all.mid.sa")).toHaveTextContent("95.7");
    expect(value("fhfa.hpi.at.q.nsa")).toHaveTextContent("100.3");
    expect(value("realtor.dom.all.nsa")).toHaveTextContent("106.3");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(lastCsv()).toMatch(/^zillow\.zhvi\.all\.mid\.sa,.*,2025-09-01,2025-09-30,100,rebased,/m);
    expect(got.name).toBe("houselens-CBSA_12420-rebased.csv");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x"));
  });

  it("keeps FilterBar mounted across a geo change", async () => {
    const view = show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa`);
    await screen.findByRole("row", { name: /zillow\.zhvi/ });
    const zhvi = await box("zillow.zhvi.all.mid.sa");
    zhvi.focus();
    view.go("geo=CBSA:35620&s=zillow.zhvi.all.mid.sa");
    expect(await box("zillow.zhvi.all.mid.sa")).toBe(zhvi);
    expect(zhvi).toHaveFocus();
    expect(await screen.findByRole("row", { name: /zillow\.zhvi/ })).toBeInTheDocument();
  });

  it("shows a geo-file error while FilterBar stays usable", async () => {
    vi.stubGlobal("fetch", async (path: string) =>
      path.includes("/geo/CBSA_12420") ? { ok: false, status: 500 } : fixture(path),
    );
    show(AUSTIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(/load/i);
    fireEvent.click(await box("zillow.zhvi.all.mid.sa"));
    expect(replace).toHaveBeenCalledWith("/compare?geo=CBSA:12420&s=zillow.zhvi.all.mid.sa");
  });

  it("edits a custom range", async () => {
    show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa&r=2026-01-01..2026-06-30`);
    expect(await screen.findByRole("combobox", { name: "Range" })).toHaveValue("custom");
    fireEvent.change(screen.getByLabelText("Range start"), { target: { value: "2026-03-01" } });
    expect(replace).toHaveBeenLastCalledWith(
      "/compare?geo=CBSA:12420&s=zillow.zhvi.all.mid.sa&r=2026-03-01..2026-06-30",
    );
    fireEvent.change(screen.getByLabelText("Range end"), { target: { value: "2026-09-30" } });
    expect(replace).toHaveBeenLastCalledWith(
      "/compare?geo=CBSA:12420&s=zillow.zhvi.all.mid.sa&r=2026-01-01..2026-09-30",
    );
  });

  it("switches to a custom range from a preset", async () => {
    show(AUSTIN);
    expect(screen.queryByLabelText("Range start")).toBeNull();
    fireEvent.change(await screen.findByRole("combobox", { name: "Range" }), {
      target: { value: "custom" },
    });
    expect(replace.mock.lastCall![0]).toMatch(/&r=\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/);
  });

  it("sets a rebase date when rebased", async () => {
    const view = show(`${AUSTIN}&s=zillow.zhvi.all.mid.sa`);
    await screen.findByRole("combobox", { name: "Transform" });
    expect(screen.queryByLabelText("Rebase date")).toBeNull();
    view.go(`${AUSTIN}&s=zillow.zhvi.all.mid.sa&t=rebased`);
    fireEvent.change(await screen.findByLabelText("Rebase date"), {
      target: { value: "2026-10-01" },
    });
    expect(replace).toHaveBeenLastCalledWith(
      "/compare?geo=CBSA:12420&s=zillow.zhvi.all.mid.sa&t=rebased&b=2026-10-01",
    );
    view.go(`${AUSTIN}&s=zillow.zhvi.all.mid.sa&t=rebased&b=2026-10-01`);
    expect(await screen.findByRole("columnheader", { name: "Latest (rebased, 100 = 2026-10-01)" }));
    expect(screen.getByRole("row", { name: /zillow\.zhvi/ })).toHaveTextContent("100.0");
  });

  it("shows an error when data fails to load", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500 }));
    show(AUSTIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(/load/i);
  });
});
