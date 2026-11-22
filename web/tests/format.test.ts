import { describe, expect, it } from "vitest";
import { formatDate, provenanceText } from "@/lib/format";
import type { SeriesMeta, Source } from "@/lib/types";

const source = { name: "FHFA House Price Index" } as Source;
const series = {
  method_family: "repeat_sales",
  seasonal_adj: false,
  release_date_kind: "first_seen",
  typical_lag_days: null,
} as SeriesMeta;

describe("provenanceText", () => {
  it("joins every provenance field", () => {
    expect(provenanceText(series, source, null, "2026-11-01", "2026-06-30")).toBe(
      "FHFA House Price Index · Repeat-sales index · Not seasonally adjusted · Period ending Jun 30, 2026 · First seen by HouseLens (date unknown) · Usual delay unknown · Data version from Nov 1, 2026",
    );
    expect(
      provenanceText(
        { ...series, seasonal_adj: true, release_date_kind: "published", typical_lag_days: 60 },
        source,
        "2026-08-26",
        "2026-11-01",
        "2026-06-30",
      ),
    ).toContain(
      "· Seasonally adjusted · Period ending Jun 30, 2026 · Published on Aug 26, 2026 · Usually published about 60 days after the period ends ·",
    );
  });

  it("labels the dates as the latest point's when asked", () => {
    expect(provenanceText(series, source, "2026-08-26", "2026-11-01", "2026-06-30", true)).toBe(
      "FHFA House Price Index · Repeat-sales index · Not seasonally adjusted · Period ending Jun 30, 2026 · Latest point first seen by HouseLens on Aug 26, 2026 · Usual delay unknown · Latest data version from Nov 1, 2026",
    );
  });
});

describe("formatDate", () => {
  it("writes ISO dates in words, in UTC, and passes anything else through", () => {
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatDate("2025-12-31")).toBe("Dec 31, 2025");
    expect(formatDate("p")).toBe("p");
  });
});
