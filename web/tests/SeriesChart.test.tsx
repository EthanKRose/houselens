import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const setOption = vi.fn();
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: () => ({ setOption, dispose: vi.fn() }),
  format: { encodeHTML: (s: string) => s },
}));

import { SeriesChart } from "@/components/SeriesChart";
import type { SeriesMeta } from "@/lib/types";

const meta = { series_id: "a" } as SeriesMeta;
const pt = (end: string, value: number, flags: string[] = []) => ({
  start: end,
  end,
  value,
  flags,
});

describe("SeriesChart", () => {
  it("uses a second y-axis for a second unit and marks flagged points", () => {
    render(
      <SeriesChart
        series={[
          {
            meta,
            label: "A",
            unit: "usd",
            points: [pt("2026-01-31", 1), pt("2026-02-28", 2, ["f"])],
          },
          { meta, label: "B", unit: "pct", points: [pt("2026-01-31", 3)] },
        ]}
        knownEvents={{ f: "Flag text" }}
      />,
    );
    const opt = setOption.mock.calls[0][0];
    expect(opt.yAxis).toHaveLength(2);
    expect(opt.series.map((s: { yAxisIndex: number }) => s.yAxisIndex)).toEqual([0, 1]);
    expect(opt.series[0].data[0].symbol).toBe("none");
    expect(opt.series[0].data[1].symbol).not.toBe("none");
    const tip = opt.tooltip.formatter([
      { seriesName: "A", data: opt.series[0].data[1], seriesIndex: 0 },
    ]);
    expect(tip).toContain("Flag text");
    expect(tip).toContain("2026-02-28");
  });
});
