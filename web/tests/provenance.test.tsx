import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AboutThisNumber } from "@/components/AboutThisNumber";
import { FreshnessDot } from "@/components/FreshnessDot";
import { SourceBadge } from "@/components/SourceBadge";
import type { Catalog, GeoFile, Geography } from "@/lib/types";

const read = <T,>(f: string) => JSON.parse(readFileSync(`public/data/${f}`, "utf8")) as T;
const catalog = read<Catalog>("catalog.json");
const geos = read<Geography[]>("geographies.json");
const src = (id: string) => catalog.sources.find((s) => s.source_id === id)!;

describe("SourceBadge", () => {
  it("shows source and lag for every catalog series", () => {
    for (const s of catalog.series) {
      const { container, unmount } = render(
        <SourceBadge
          series={s}
          source={src(s.source_id)}
          releaseDate="2026-01-02"
          vintageDate="2026-01-03"
          periodEnd="2025-12-31"
        />,
      );
      const text = container.textContent!;
      expect(text).toContain(src(s.source_id).name);
      expect(text).toContain(
        s.typical_lag_days === null
          ? "Usual delay unknown"
          : `Usually published about ${s.typical_lag_days} days after the period ends`,
      );
      expect(text).toContain("Data version from Jan 3, 2026");
      expect(text).not.toMatch(/\b[a-z]+_[a-z]+\b/); // no raw codes like repeat_sales
      expect(text).toContain(s.seasonal_adj ? "· Seasonally adjusted" : "Not seasonally adjusted");
      expect(text).toContain("Period ending Dec 31, 2025");
      expect(text).toContain(
        s.release_date_kind === "published"
          ? "Published on Jan 2, 2026"
          : "First seen by HouseLens on Jan 2, 2026",
      );
      if (s.release_date_kind === "published") expect(text).not.toContain("First seen");
      else expect(text).not.toContain("Published");
      unmount();
    }
  });

  it("labels first_seen as First seen, not Released", () => {
    const s = catalog.series.find((x) => x.release_date_kind === "first_seen")!;
    render(
      <SourceBadge
        series={s}
        source={src(s.source_id)}
        releaseDate="2026-01-02"
        vintageDate="v"
        periodEnd="p"
      />,
    );
    expect(screen.getByText(/First seen by HouseLens on Jan 2, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Published/)).toBeNull();
  });

  it("flags Realtor.com as listing data", () => {
    const s = catalog.series.find((x) => x.source_id === "realtor")!;
    render(
      <SourceBadge
        series={s}
        source={src("realtor")}
        releaseDate={null}
        vintageDate="v"
        periodEnd="p"
      />,
    );
    expect(screen.getByText("Listing data (asking prices), not sales")).toBeInTheDocument();
  });
});

describe("FreshnessDot", () => {
  const f = {
    last_period_end: "2026-01-01",
    last_release_date: null,
    last_ingest_at: null,
    frequency: "monthly" as const,
    typical_lag_days: 0,
  };
  it.each([
    ["Fresh", "2026-01-10"],
    ["Due", "2026-02-10"],
    ["Stale", "2026-04-01"],
  ])("labels %s accessibly", (label, today) => {
    render(<FreshnessDot freshness={f} today={new Date(`${today}T00:00:00Z`)} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });
});

describe("AboutThisNumber", () => {
  const zhvi = catalog.series.find((s) => s.series_id.startsWith("zillow.zhvi"))!;
  const open = (geoId: string, flags: string[] = []) => {
    const g = geos.find((x) => x.geo_id === geoId)!;
    render(
      <AboutThisNumber
        series={zhvi}
        source={src("zillow")}
        flags={flags}
        knownEvents={catalog.known_events}
        nonDisclosure={g.non_disclosure}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /about this number/i }));
  };

  it("shows the Oct 2025 flag text for the flagged CPI point", () => {
    const us = read<GeoFile>("geo/US.json");
    const cpi = catalog.series.find((x) => x.series_id === "fred.cpi.rent.sa")!;
    const flagged = us.series[cpi.series_id].points.find((p) => p[0] === "2025-10-01")!;
    expect(flagged[3]).toContain("cpi_carry_forward_2025_10");
    render(
      <AboutThisNumber
        series={cpi}
        source={src("fred")}
        flags={flagged[3]}
        knownEvents={catalog.known_events}
        nonDisclosure={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /about this number/i }));
    expect(
      screen.getByText(`Flag: ${catalog.known_events.cpi_carry_forward_2025_10}`),
    ).toBeInTheDocument();
  });

  it("shows non-disclosure note for ST:48 only", () => {
    open("ST:48");
    expect(screen.getByText(/Non-disclosure state/)).toBeInTheDocument();
  });

  it("shows the non-disclosure note for ZHVI on a Texas metro (CBSA:12420)", () => {
    open("CBSA:12420");
    expect(screen.getByText(/Non-disclosure state/)).toBeInTheDocument();
  });

  it("omits non-disclosure note for a disclosing geography", () => {
    open("ST:36");
    expect(screen.queryByText(/Non-disclosure state/)).toBeNull();
  });
});
