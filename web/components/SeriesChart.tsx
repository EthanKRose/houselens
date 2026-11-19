"use client";

import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { formatValue } from "@/lib/format";
import type { Metric, Point, SeriesMeta } from "@/lib/types";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

/** One plotted line: already transformed points in `unit`. */
export type ChartSeries = {
  meta: SeriesMeta;
  points: Point[];
  label: string;
  unit: Metric["unit"];
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
            .map(({ seriesName, seriesIndex, data }) =>
              [
                `${esc(seriesName)}: ${formatValue(data.value[1], series[seriesIndex].unit)} (period ending ${data.value[0]})`,
                ...data.flags.map((f) => `Flag: ${esc(knownEvents[f] ?? f)}`),
              ].join("<br/>"),
            )
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
        connectNulls: false,
        data: s.points.map((p): Datum => ({
          value: [p.end, p.value],
          symbol: p.flags.length ? "diamond" : "none",
          symbolSize: p.flags.length ? 10 : 0,
          flags: p.flags,
        })),
      })),
    });
    return () => chart.dispose();
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
