import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AboutThisNumber } from "@/components/AboutThisNumber";
import { FreshnessDot } from "@/components/FreshnessDot";
import { SourceBadge } from "@/components/SourceBadge";
import type { Catalog, Geography } from "@/lib/types";

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
        s.typical_lag_days === null ? "lag n/a" : `lag ~${s.typical_lag_days} days`,
      );
      expect(text).toContain("Vintage 2026-01-03");
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
    expect(screen.getByText(/First seen 2026-01-02/)).toBeInTheDocument();
    expect(screen.queryByText(/Released/)).toBeNull();
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
  it("has an accessible label", () => {
    const f = {
      last_period_end: "2026-01-01",
      last_release_date: null,
      last_ingest_at: null,
      frequency: "monthly" as const,
      typical_lag_days: 0,
    };
    render(<FreshnessDot freshness={f} today={new Date("2026-01-10T00:00:00Z")} />);
    expect(screen.getByLabelText("Fresh")).toBeInTheDocument();
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

  it("shows the Oct 2025 CPI flag text", () => {
    open("ST:36", ["cpi_carry_forward_2025_10"]);
    expect(screen.getByText(/carried forward from April 2025/)).toBeInTheDocument();
  });

  it("shows non-disclosure note for ST:48 only", () => {
    open("ST:48");
    expect(screen.getByText(/Non-disclosure state/)).toBeInTheDocument();
  });

  it("omits non-disclosure note for a disclosing geography", () => {
    open("ST:36");
    expect(screen.queryByText(/Non-disclosure state/)).toBeNull();
  });
});
