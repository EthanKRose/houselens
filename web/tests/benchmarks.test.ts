import { describe, expect, it } from "vitest";
import { bedroomSeries, changePct, pickBenchmarks } from "@/lib/benchmarks";
import type { GeoFile, ZipEntry } from "@/lib/types";

const b = (value: number) => ({
  start: "2026-09-01", end: "2026-09-30", value, y1: value * 0.9, y5: null,
  vintage_date: "2026-11-01", release_date: null, flags: [],
}); // prettier-ignore
const zip: ZipEntry = {
  name: "78704 · Travis County, TX", county: "Travis County", cbsa: "CBSA:12420",
  non_disclosure: true,
  series: { "zillow.zhvi.all.mid.sa": b(700_000), "zillow.zhvi.b3.mid.sa": b(850_000) },
}; // prettier-ignore
const metro: GeoFile = {
  geo_id: "CBSA:12420",
  series: {
    "zillow.zori.all.sa": {
      vintage_date: "2026-11-02",
      release_date: null,
      points: [["2026-09-01", "2026-09-30", 1800, []]],
    },
    "zillow.zhvi.all.mid.sa": {
      vintage_date: "2026-11-02",
      release_date: null,
      points: [["2026-09-01", "2026-09-30", 450_000, []]],
    },
  },
};

describe("pickBenchmarks", () => {
  it("prefers the same bedroom count in the ZIP", () => {
    const got = pickBenchmarks(zip, metro, 3);
    expect(got.value).toMatchObject({
      seriesId: "zillow.zhvi.b3.mid.sa",
      value: 850_000,
      from: "zip",
    });
  });
  it("falls back to all homes in the ZIP when that bedroom count is missing", () => {
    expect(pickBenchmarks(zip, metro, 4).value).toMatchObject({
      seriesId: "zillow.zhvi.all.mid.sa",
      from: "zip",
    });
    expect(pickBenchmarks(zip, metro).value?.value).toBe(700_000);
  });
  it("falls back to the metro when the ZIP lacks a figure, and says so", () => {
    expect(pickBenchmarks(zip, metro, 3).rent).toMatchObject({
      value: 1800,
      from: "metro",
      y1: null,
    });
    expect(pickBenchmarks(undefined, metro).value).toMatchObject({ value: 450_000, from: "metro" });
  });
  it("leaves out figures nobody has", () => {
    expect(pickBenchmarks(undefined, undefined, 3)).toEqual({});
    expect(pickBenchmarks(zip, undefined).ppsf).toBeUndefined();
  });
});

it("maps bedrooms to Zillow's 1 to 5+ files", () => {
  expect([0, 1, 3, 5, 7].map(bedroomSeries)).toEqual([
    "zillow.zhvi.b1.mid.sa", "zillow.zhvi.b1.mid.sa", "zillow.zhvi.b3.mid.sa",
    "zillow.zhvi.b5.mid.sa", "zillow.zhvi.b5.mid.sa",
  ]); // prettier-ignore
  expect(changePct(110, 100)).toBeCloseTo(10);
  expect(changePct(110, null)).toBeNull();
});
