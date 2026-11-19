"use client";

import { LineChart } from "echarts/charts";
import { GridComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([LineChart, GridComponent, CanvasRenderer]);

/**
 * Small decorative line chart; the value is always also shown as text.
 * @param props - component props
 * @param props.values - y values, oldest first
 * @returns the chart container
 */
export function Sparkline({ values }: { values: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: "category", show: false },
      yAxis: { type: "value", show: false, scale: true },
      series: [{ type: "line", data: values, showSymbol: false, lineStyle: { width: 1.5 } }],
    });
    return () => chart.dispose();
  }, [values]);
  return <div ref={ref} className="h-10 w-full" aria-hidden="true" />;
}
