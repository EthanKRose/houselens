import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const setOption = vi.fn();
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: () => ({ setOption, dispose: vi.fn(), resize: vi.fn() }),
  format: { encodeHTML: (s: string) => s },
}));

import { SeriesChart, type ChartSeries } from "@/components/SeriesChart";
import type { SeriesMeta, Source } from "@/lib/types";

const meta = {
  series_id: "a",
  method_family: "repeat_sales",
  seasonal_adj: true,
  release_date_kind: "published",
  typical_lag_days: 60,
} as SeriesMeta;
const source = { name: "FHFA House Price Index" } as Source;
const pt = (end: string, value: number, flags: string[] = []) => ({
  start: end,
  end,
  value,
  flags,
});
const line = (label: string, unit: ChartSeries["unit"], points: ChartSeries["points"]) => ({
  meta,
  source,
  label,
  unit,
  points,
  releaseDate: "2026-03-10",
  vintageDate: "2026-03-11",
});

describe("SeriesChart", () => {
  it("uses a second y-axis for a second unit, marks flags and shows provenance", () => {
    render(
      <SeriesChart
        series={[
          line("A", "usd", [pt("2026-01-31", 1), pt("2026-02-28", 2, ["f"])]),
          line("B", "pct", [pt("2026-01-31", 3)]),
        ]}
        knownEvents={{ f: "Flag text" }}
      />,
    );
    const opt = setOption.mock.calls[0][0];
    expect(opt.yAxis).toHaveLength(2);
    expect(opt.series.map((s: { yAxisIndex: number }) => s.yAxisIndex)).toEqual([0, 1]);
    expect(opt.series[0].data[0].symbol).toBe("none");
    expect(opt.series[0].data[1].symbol).not.toBe("none");
    // A lone unflagged point still gets a visible symbol.
    expect(opt.series[1].data[0].symbol).not.toBe("none");
    const tip = opt.tooltip.formatter([
      { seriesName: "A", data: opt.series[0].data[1], seriesIndex: 0 },
    ]);
    expect(tip).toContain("Flag text");
    expect(tip).toContain(
      "FHFA House Price Index · repeat_sales · SA · Period ending 2026-02-28 · Released 2026-03-10 · lag ~60 days · Vintage 2026-03-11",
    );
  });
});
