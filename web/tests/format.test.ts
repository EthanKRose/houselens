import { describe, expect, it } from "vitest";
import { provenanceText } from "@/lib/format";
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
      "FHFA House Price Index · repeat_sales · NSA · Period ending 2026-06-30 · First seen n/a · lag n/a · Vintage 2026-11-01",
    );
    expect(
      provenanceText(
        { ...series, seasonal_adj: true, release_date_kind: "published", typical_lag_days: 60 },
        source,
        "2026-08-26",
        "2026-11-01",
        "2026-06-30",
      ),
    ).toContain("SA · Period ending 2026-06-30 · Released 2026-08-26 · lag ~60 days");
  });
});
