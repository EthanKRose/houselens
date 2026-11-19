"use client";

import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { formatValue, provenanceText } from "@/lib/format";
import type { Metric, Point, SeriesMeta, Source } from "@/lib/types";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

/** One plotted line: already transformed points in `unit`, plus its provenance. */
export type ChartSeries = {
  meta: SeriesMeta;
  source: Source;
  points: Point[];
  label: string;
  unit: Metric["unit"];
  releaseDate: string | null;
  vintageDate: string;
};

type Datum = { value: [string, number]; symbol: string; symbolSize: number; flags: string[] };

/**
 * Multi-series line chart, one y-axis per unit (at most two; the caller rebases 3+ units).
 * Flagged points get a marker and their explanation in the tooltip.
 * @param props - component props
 * @param props.series - lines to plot
 * @param props.knownEvents - catalog.known_events, flag id to explanation
 * @returns the chart container
 */
export function SeriesChart({
  series,
  knownEvents,
}: {
  series: ChartSeries[];
  knownEvents: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const units = [...new Set(series.map((s) => s.unit))];
    const esc = echarts.format.encodeHTML;
    const chart = echarts.init(ref.current);
    chart.setOption({
      grid: { left: 64, right: units.length > 1 ? 64 : 16, top: 40, bottom: 32 },
      legend: { type: "scroll" },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; seriesIndex: number; data: Datum }[]) =>
          params
            .map(({ seriesName, seriesIndex, data }) => {
              const s = series[seriesIndex];
              return [
                `<strong>${esc(seriesName)}</strong>: ${formatValue(data.value[1], s.unit)}`,
                // Dates are per series (latest point), so the tooltip must not imply they fit this point.
                esc(
                  provenanceText(
                    s.meta,
                    s.source,
                    s.releaseDate,
                    s.vintageDate,
                    data.value[0],
                    true,
                  ),
                ),
                ...data.flags.map((f) => `Flag: ${esc(knownEvents[f] ?? f)}`),
              ].join("<br/>");
            })
            .join("<br/>"),
      },
      xAxis: { type: "time" },
      yAxis: units.map((u) => ({
        type: "value",
        scale: true,
        axisLabel: { formatter: (v: number) => formatValue(v, u) },
      })),
      series: series.map((s) => ({
        type: "line",
        name: s.label,
        yAxisIndex: units.indexOf(s.unit),
        data: s.points.map((p): Datum => {
          // A lone point draws no line, so it needs a symbol to be visible at all.
          const lone = s.points.length <= 1;
          return {
            value: [p.end, p.value],
            symbol: p.flags.length ? "diamond" : lone ? "circle" : "none",
            symbolSize: p.flags.length ? 10 : lone ? 6 : 0,
            flags: p.flags,
          };
        }),
      })),
    });
    // jsdom has no ResizeObserver.
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => chart.resize());
    ro?.observe(ref.current);
    return () => {
      ro?.disconnect();
      chart.dispose();
    };
  }, [series, knownEvents]);
  return (
    <div
      ref={ref}
      className="h-96 w-full"
      role="img"
      aria-label={`Line chart of ${series.map((s) => s.label).join(", ")}; values are in the table below.`}
    />
  );
}
