import { describe, expect, it } from "vitest";
import { applyTransform, filterRange } from "@/lib/transforms";
import type { Point } from "@/lib/types";

const p = (start: string, value: number, end = start): Point => ({ start, end, value, flags: [] });

describe("applyTransform", () => {
  it("level returns the points unchanged", () => {
    const pts = [p("2024-01-01", 1)];
    expect(applyTransform(pts, "level", "monthly")).toEqual(pts);
  });

  it("monthly YoY omits a month with no partner and computes the rest", () => {
    const pts = [
      p("2023-01-01", 100),
      p("2023-03-01", 200),
      p("2024-01-01", 105),
      p("2024-02-01", 1),
      p("2024-03-01", 210),
    ];
    const out = applyTransform(pts, "yoy", "monthly");
    expect(out.map((x) => x.start)).toEqual(["2024-01-01", "2024-03-01"]);
    expect(out[0].value).toBeCloseTo(5);
    expect(out[1].value).toBeCloseTo(5);
  });

  it("monthly MoM uses the previous calendar month, across a year boundary", () => {
    const out = applyTransform([p("2023-12-01", 100), p("2024-01-01", 110)], "mom", "monthly");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(10);
  });

  it("omits a point whose partner is zero", () => {
    expect(applyTransform([p("2023-01-01", 0), p("2024-01-01", 5)], "yoy", "monthly")).toEqual([]);
  });

  it("weekly YoY matches the point 364±3 days earlier, else omits", () => {
    const pts = [p("2023-01-05", 100), p("2024-01-01", 110), p("2024-02-15", 50)];
    // 2024-01-01 minus 364 days = 2023-01-02; 2023-01-05 is 3 days off (inside window).
    // 2024-02-15 has nothing within 364±3 days.
    const out = applyTransform(pts, "yoy", "weekly");
    expect(out.map((x) => x.start)).toEqual(["2024-01-01"]);
    expect(out[0].value).toBeCloseTo(10);
  });

  it("weekly YoY picks the closest partner and ignores one 4 days off", () => {
    const pts = [
      p("2023-01-02", 100),
      p("2023-01-03", 200),
      p("2024-01-01", 220),
      p("2024-01-08", 1),
    ];
    // 2024-01-08 - 364 = 2023-01-09; nearest candidate 2023-01-03 is 6 days off -> omitted.
    const out = applyTransform(pts, "yoy", "weekly");
    expect(out.map((x) => x.start)).toEqual(["2024-01-01"]);
    expect(out[0].value).toBeCloseTo(120);
  });

  it("weekly MoM matches 28±3 days earlier", () => {
    const out = applyTransform([p("2024-01-01", 100), p("2024-01-29", 90)], "mom", "weekly");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(-10);
  });

  it("quarterly YoY uses the same quarter of the previous year", () => {
    const pts = [p("2023-01-01", 100), p("2023-04-01", 200), p("2024-04-01", 220)];
    const out = applyTransform(pts, "yoy", "quarterly");
    expect(out.map((x) => x.start)).toEqual(["2024-04-01"]);
    expect(out[0].value).toBeCloseTo(10);
  });

  it("quarterly MoM uses the previous quarter", () => {
    const out = applyTransform([p("2023-10-01", 100), p("2024-01-01", 120)], "mom", "quarterly");
    expect(out[0].value).toBeCloseTo(20);
  });

  it("keeps the original start, end and flags", () => {
    const a = { start: "2023-01-01", end: "2023-01-31", value: 100, flags: [] };
    const b = { start: "2024-01-01", end: "2024-01-31", value: 110, flags: ["prelim"] };
    expect(applyTransform([a, b], "yoy", "monthly")[0]).toMatchObject({
      start: b.start,
      end: b.end,
      flags: ["prelim"],
    });
  });

  it("rebased = 100 at the rebase date", () => {
    const out = applyTransform(
      [p("2024-01-01", 50), p("2024-02-01", 100), p("2024-03-01", 150)],
      "rebased",
      "monthly",
      "2024-02-01",
    );
    expect(out.map((x) => x.value)).toEqual([50, 100, 150]);
  });

  it("rebased with no point on the date uses the nearest earlier point", () => {
    const out = applyTransform(
      [p("2024-01-01", 50), p("2024-03-01", 150)],
      "rebased",
      "monthly",
      "2024-02-15",
    );
    expect(out.map((x) => x.value)).toEqual([100, 300]);
  });

  it("rebased with no earlier point is empty", () => {
    expect(applyTransform([p("2024-01-01", 50)], "rebased", "monthly", "2023-06-01")).toEqual([]);
  });
});

describe("filterRange", () => {
  const today = new Date("2026-11-18T15:00:00Z");
  const pts = [
    p("2016-10-01", 1, "2016-10-31"),
    p("2016-11-01", 2, "2016-11-30"),
    p("2025-10-01", 3, "2025-10-31"),
    p("2025-11-01", 4, "2025-11-30"),
    p("2026-10-01", 5, "2026-10-31"),
  ];
  it("1y keeps points ending on or after today minus 1 year", () => {
    expect(filterRange(pts, "1y", today).map((x) => x.value)).toEqual([4, 5]);
  });
  it("10y counts back ten years", () => {
    expect(filterRange(pts, "10y", today).map((x) => x.value)).toEqual([2, 3, 4, 5]);
  });
  it("max returns all", () => {
    expect(filterRange(pts, "max", today)).toEqual(pts);
  });
  it("custom range is inclusive on both ends by start date", () => {
    expect(
      filterRange(pts, { start: "2016-11-01", end: "2025-11-01" }, today).map((x) => x.value),
    ).toEqual([2, 3, 4]);
  });
});
