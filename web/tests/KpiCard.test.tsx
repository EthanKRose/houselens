import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Sparkline", () => ({ Sparkline: () => null }));

import { KpiCard } from "@/components/KpiCard";
import type { Catalog, Point } from "@/lib/types";

const catalog = JSON.parse(readFileSync("public/data/catalog.json", "utf8")) as Catalog;
const series = catalog.series.find((s) => s.series_id.startsWith("zillow.zhvi"))!;
const pt = (m: string, value: number): Point => ({
  start: `${m}-01`,
  end: `${m}-28`,
  value,
  flags: [],
});

const card = (points: Point[]) =>
  render(
    <KpiCard
      series={series}
      metric={catalog.metrics.find((m) => m.metric_id === series.metric_id)!}
      source={catalog.sources.find((s) => s.source_id === series.source_id)!}
      points={points}
      releaseDate="2026-01-02"
      vintageDate="2026-01-03"
      today={new Date("2026-01-10T00:00:00Z")}
      knownEvents={catalog.known_events}
      nonDisclosure={false}
    />,
  ).container.textContent!;

describe("KpiCard YoY", () => {
  it("shows YoY when the latest point has a year-ago partner", () => {
    expect(card([pt("2024-03", 100), pt("2025-03", 110)])).toContain(
      "Change from a year earlier +10.0%",
    );
  });

  it("shows n/a, not an older period's YoY, when the latest point lacks a partner", () => {
    // 2025-02 has a partner (2024-02) but the latest point 2025-03 does not
    expect(card([pt("2024-02", 100), pt("2025-02", 110), pt("2025-03", 111)])).toContain(
      "Change from a year earlier not available",
    );
  });
});
