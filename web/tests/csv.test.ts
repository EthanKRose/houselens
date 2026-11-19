import { describe, expect, it } from "vitest";
import { toCsv, type CsvRow } from "@/lib/csv";

const row: CsvRow = {
  series_id: "zillow.zhvi",
  source: "Zillow, Inc.",
  method_family: 'hedonic "smoothed"',
  seasonal_adj: true,
  geo_id: "CBSA:12420",
  period_start: "2024-01-01",
  period_end: "2024-01-31",
  value: 412345.5,
  transform: "level",
  vintage_date: "2024-02-15",
  release_date: null,
  quality_flags: ["prelim", "imputed"],
};

describe("toCsv", () => {
  it("writes attribution headers, columns and RFC 4180 quoting", () => {
    const lines = toCsv([row], ["Data from Zillow"]).split("\n");
    expect(lines[0]).toBe("# Data from Zillow");
    expect(lines[1]).toBe("# release_date/vintage_date apply to the latest point of each series");
    expect(lines[2]).toBe(
      "series_id,source,method_family,seasonal_adj,geo_id,period_start,period_end,value,transform,vintage_date,release_date,quality_flags",
    );
    expect(lines[3]).toBe(
      'zillow.zhvi,"Zillow, Inc.","hedonic ""smoothed""",true,CBSA:12420,2024-01-01,2024-01-31,412345.5,level,2024-02-15,,prelim;imputed',
    );
  });
});
